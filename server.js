import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Load env vars FIRST before any other imports that use them
dotenv.config();

import passport from './config/passport.js';
import { configurePassport } from './config/passport.js';
// Import models
import User from './models/User.js';
import Order from './models/Order.js';
// Import routes
import authRoutes from './routes/auth.js';
import restaurantRoutes from './routes/restaurant.js';
import cartRoutes from "./routes/cart.js";
import orderRoutes from "./routes/order.js";
import riderRoutes from "./routes/rider.js";
import ratingRoutes from "./routes/rating.js";
import wishlistRoutes from "./routes/wishlist.js";
import chatbotRoutes from "./routes/chatbot.js";
import paymentRoutes from "./routes/payment.js";

const app = express();
const httpServer = createServer(app);


console.log('🔧 Current FRONTEND_URL env:', process.env.FRONTEND_URL);
// For production, be more permissive with CORS
// Configure Socket.IO with same CORS as Express
export const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://bigbitefrontend-sigma.vercel.app",
      "https://bharat-kumar-19030.github.io"
    ],
    credentials: true,
  },
});



app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://bigbitefrontend-sigma.vercel.app",
      "https://bharat-kumar-19030.github.io"
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  })
);

// app.use(cors())
app.options('*', cors());
app.use(cookieParser()); 
app.use(express.json())

// Express session with MongoDB-backed store (recommended for production)
const sessionStore = MongoStore.create({
  mongoUrl: process.env.MONGODB_URI,
  collectionName: process.env.SESSIONS_COLLECTION || 'sessions',
  ttl: 24 * 60 * 60, // 1 day
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change_this_secret',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    proxy: process.env.TRUST_PROXY === 'true' || process.env.NODE_ENV === 'production',
    cookie: {
    httpOnly: true,
    secure: true,      // Render is HTTPS
    sameSite: "none",  // REQUIRED for cross-origin cookies
    maxAge: 24 * 60 * 60 * 1000,
}

  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Configure passport strategies
configurePassport();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected successfully');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/rating", ratingRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/payment", paymentRoutes);

// Active riders pool - stores rider socket connections with live data
export const activeRidersPool = new Map();
// Active orders pool - stores order details with real-time updates
export const activeOrdersPool = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  
  // User authentication
  socket.on('authenticate', (userId) => {
    try {
      socket.userId = userId;
      socket.join(`user_${userId}`);
      console.log(`✅ User ${userId} authenticated`);
    } catch (error) {
      console.error('❌ Error in authenticate:', error);
    }
  });

  // Rider authentication - join rider room
  socket.on('rider_authenticate', (userId) => {
    try {
      socket.userId = userId;
      socket.riderId = userId;
      socket.join(`user_${userId}`);
      socket.join(`rider_${userId}`);
      console.log(`✅ Rider ${userId} authenticated and joined rider room`);
    } catch (error) {
      console.error('❌ Error in rider_authenticate:', error);
    }
  });
  
  // Rider joins active pool when available
  socket.on('rider_join_pool', async ({ riderId, coordinates }) => {
    try {
      const rider = await User.findById(riderId);
      if (!rider || rider.role !== 'rider') {
        socket.emit('error', { message: 'Invalid rider' });
        return;
      }

      // Use coordinates from the emit or fallback to database
      const riderCoords = coordinates || {
        latitude: rider.riderDetails?.currentLocation?.latitude || 0,
        longitude: rider.riderDetails?.currentLocation?.longitude || 0,
      };

      // Add rider to active pool
      activeRidersPool.set(riderId, {
        socketId: socket.id,
        riderId,
        name: rider.name,
        phone: rider.phone,
        coordinates: riderCoords,
        activeOrders: [],
        lastUpdate: new Date(),
      });

      socket.riderId = riderId;
      socket.join(`rider_${riderId}`);
      
      console.log(`🏍️ Rider ${rider.name} (${riderId}) joined active pool at [${riderCoords.latitude}, ${riderCoords.longitude}]`);
      console.log(`📊 Total active riders: ${activeRidersPool.size}`);
      socket.emit('joined_pool', { message: 'Successfully joined active riders pool' });
    } catch (error) {
      console.error('❌ Error in rider_join_pool:', error);
    }
  });

  // Rider leaves active pool when unavailable
  socket.on('rider_leave_pool', ({ riderId }) => {
    try {
      activeRidersPool.delete(riderId);
      socket.leave(`rider_${riderId}`);
      console.log(`🚫 Rider ${riderId} left active pool. Total active: ${activeRidersPool.size}`);
      socket.emit('left_pool', { message: 'Left active riders pool' });
    } catch (error) {
      console.error('❌ Error in rider_leave_pool:', error);
    }
  });

  // Rider live location update (every 10 seconds, not saved to DB)
  socket.on('rider_location_update', ({ riderId, coordinates }) => {
    try {
      const riderData = activeRidersPool.get(riderId);
      if (riderData) {
        riderData.coordinates = coordinates;
        riderData.lastUpdate = new Date();
        activeRidersPool.set(riderId, riderData);

        // Broadcast location to all active orders this rider is handling
        riderData.activeOrders.forEach(orderId => {
          const orderSocket = activeOrdersPool.get(orderId);
          if (orderSocket) {
            orderSocket.riderCoordinates = coordinates;
            activeOrdersPool.set(orderId, orderSocket);
            
            // Emit to customer tracking the order
            io.to(`order_${orderId}`).emit('rider_location_live', {
              orderId,
              latitude: coordinates.latitude,
              longitude: coordinates.longitude,
              timestamp: new Date(),
            });
          }
        });
      }
    } catch (error) {
      console.error('❌ Error in rider_location_update:', error);
    }
  });

  // Customer joins order tracking room
  socket.on('join_order_tracking', (orderId) => {
    try {
      socket.join(`order_${orderId}`);
      
      // Send current order status if exists
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        socket.emit('order_status', orderSocket);
      }
      
      console.log(`👤 Customer joined order tracking: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in join_order_tracking:', error);
    }
  });

  // Restaurant authentication
  socket.on('restaurant_authenticate', ({ restaurantId }) => {
    try {
      socket.restaurantId = restaurantId;
      socket.join(`restaurant_${restaurantId}`);
      console.log(`🏪 Restaurant ${restaurantId} authenticated and joined room`);
      socket.emit('authenticated', { message: 'Restaurant authenticated successfully' });
    } catch (error) {
      console.error('❌ Error in restaurant_authenticate:', error);
    }
  });

  // Restaurant accepts order
  socket.on('restaurant_accept_order', async ({ orderId, restaurantId }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('error', { message: 'Order not found' });
        return;
      }

      order.status = 'accepted';
      order.acceptedAt = new Date();
      await order.save();

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = 'accepted';
        orderSocket.acceptedAt = new Date();
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Notify customer
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status: 'accepted',
        message: 'Restaurant accepted your order',
      });

      // Notify restaurant to update their UI
      io.to(`restaurant_${restaurantId}`).emit('order_status_changed', {
        orderId,
        status: 'accepted',
        message: 'Order accepted successfully',
      });

      // Notify nearby riders
      await notifyNearbyRiders(order);

      console.log(`✅ Restaurant accepted order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in restaurant_accept_order:', error);
    }
  });

  // Restaurant rejects order
  socket.on('restaurant_reject_order', async ({ orderId, reason }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) return;

      order.status = 'rejected';
      order.cancelledAt = new Date();
      order.cancellationReason = reason;
      order.cancelledBy = 'restaurant';
      await order.save();

      // Remove from active orders
      activeOrdersPool.delete(orderId);

      // Notify customer
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status: 'rejected',
        message: 'Restaurant rejected your order',
        reason,
      });

      console.log(`❌ Restaurant rejected order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in restaurant_reject_order:', error);
    }
  });

  // Rider accepts order
  socket.on('rider_accept_order', async ({ orderId, riderId }) => {
    try {
      const order = await Order.findById(orderId).populate('restaurant customer rider');
      if (!order || order.status !== 'accepted') {
        socket.emit('error', { message: 'Order not available' });
        return;
      }

      // Calculate distance from restaurant to customer
      const restaurant = await User.findById(order.restaurant._id);
      const distanceToCustomer = calculateDistance(
        restaurant.restaurantDetails.address.latitude,
        restaurant.restaurantDetails.address.longitude,
        order.deliveryAddress.latitude,
        order.deliveryAddress.longitude
      );
      
      // Rider earnings logic:
      // - If customer paid delivery fee (order < ₹500): rider gets same amount
      // - If customer got free delivery (order ≥ ₹500): calculate rider earnings separately (₹8/km)
      const riderEarnings = order.deliveryFee > 0 
        ? order.deliveryFee 
        : Math.round(distanceToCustomer * 8);

      order.rider = riderId;
      order.status = 'rider_assigned';
      order.acceptedAt = new Date();
      order.distanceToCustomer = distanceToCustomer;
      order.riderEarnings = riderEarnings;
      await order.save();

      // Get rider details
      const riderData = activeRidersPool.get(riderId);
      const riderUser = await User.findById(riderId);

      // Update rider's active orders
      if (riderData) {
        riderData.activeOrders.push(orderId);
        activeRidersPool.set(riderId, riderData);
      }

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = 'rider_assigned';
        orderSocket.riderId = riderId;
        orderSocket.riderDetails = riderData;
        orderSocket.riderCoordinates = riderData?.coordinates;
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Remove from other riders' available list
      Array.from(activeRidersPool.keys()).forEach(otherId => {
        if (otherId !== riderId) {
          io.to(`rider_${otherId}`).emit('order_taken', { orderId });
        }
      });

      // Notify customer via order room - only use order_accepted event
      io.to(`order_${orderId}`).emit('order_accepted', {
        orderId,
        status: 'rider_assigned',
        message: `Rider ${riderUser?.name || 'A rider'} accepted your order!`,
        riderName: riderUser?.name,
        riderPhone: riderUser?.phone,
      });

      // Notify restaurant to refresh dashboard
      io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
        orderId,
        status: 'rider_assigned',
        riderName: riderUser?.name,
        riderPhone: riderUser?.phone,
      });

      // Confirm acceptance to the rider
      socket.emit('order_accepted_confirmation', {
        orderId,
        success: true,
        message: 'Order accepted successfully'
      });

      console.log(`🏍️ Rider ${riderId} accepted order: ${orderId}`);
    } catch (error) {
      console.error('❌ Error in rider_accept_order:', error);
      socket.emit('order_accept_error', {
        message: 'Failed to accept order',
        error: error.message
      });
    }
  });

  // Update order status
  socket.on('update_order_status', async ({ orderId, status }) => {
    try {
      const order = await Order.findById(orderId);
      if (!order) return;

      order.status = status;
      
      // Update timestamps based on status
      if (status === 'accepted') order.acceptedAt = new Date();
      if (status === 'picked_up') order.pickedUpAt = new Date();
      if (status === 'delivered') order.deliveredAt = new Date();
      if (status === 'cancelled') {
        order.cancelledAt = new Date();
        order.cancelledBy = 'rider';
      }
      
      await order.save();

      // Update order socket
      const orderSocket = activeOrdersPool.get(orderId);
      if (orderSocket) {
        orderSocket.status = status;
        activeOrdersPool.set(orderId, orderSocket);
      }

      // Broadcast to all parties
      io.to(`order_${orderId}`).emit('order_status_changed', {
        orderId,
        status,
        timestamp: new Date(),
      });

      // If delivered, remove from active pools
      if (status === 'delivered') {
        const riderId = order.rider;
        const riderData = activeRidersPool.get(riderId?.toString());
        if (riderData) {
          riderData.activeOrders = riderData.activeOrders.filter(id => id !== orderId);
          activeRidersPool.set(riderId.toString(), riderData);
        }
        activeOrdersPool.delete(orderId);
      }

      console.log(`📊 Order ${orderId} status updated to: ${status}`);
    } catch (error) {
      console.error('❌ Error in update_order_status:', error);
    }
  });

  socket.on('disconnect', () => {
    // Remove rider from pool if disconnected
    if (socket.riderId) {
      activeRidersPool.delete(socket.riderId);
      console.log(`🔌 Rider ${socket.riderId} disconnected. Total active: ${activeRidersPool.size}`);
    }
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Helper function to notify nearby riders
async function notifyNearbyRiders(order) {
  try {
    console.log('🔔 notifyNearbyRiders called for order:', order._id);
    
    const restaurant = await User.findById(order.restaurant);
    if (!restaurant) {
      console.error('❌ Restaurant not found:', order.restaurant);
      return;
    }
    
    console.log('🏪 Restaurant found:', restaurant.restaurantDetails?.kitchenName);
    console.log('📍 Restaurant address:', restaurant.restaurantDetails?.address);
    
    if (!restaurant.restaurantDetails?.address?.latitude || !restaurant.restaurantDetails?.address?.longitude) {
      console.error('❌ Restaurant does not have valid coordinates');
      return;
    }
    
    const restaurantLat = restaurant.restaurantDetails.address.latitude;
    const restaurantLon = restaurant.restaurantDetails.address.longitude;

    const nearbyRiders = [];
    
    console.log(`\n🔍 Searching for riders within 200km radius...`);
    console.log(`📍 Restaurant Location: Lat ${restaurantLat}, Lon ${restaurantLon}`);
    console.log(`👥 Total active riders in pool: ${activeRidersPool.size}`);
    
    activeRidersPool.forEach((riderData, riderId) => {
      // Calculate distance from rider to restaurant
      const distance = calculateDistance(
        restaurantLat,
        restaurantLon,
        riderData.coordinates.latitude,
        riderData.coordinates.longitude
      );

      console.log(`\n🏍️ Rider: ${riderData.name} (ID: ${riderId})`);
      console.log(`   📍 Location: Lat ${riderData.coordinates.latitude}, Lon ${riderData.coordinates.longitude}`);
      console.log(`   📏 Distance: ${distance.toFixed(2)} km`);
      console.log(`   ${distance <= 1000 ? '✅ Within range!' : '❌ Too far'}`);

      if (distance <= 1000) {
        nearbyRiders.push({ riderId, riderName: riderData.name, distance });
      }
    });

    console.log(`\n✅ Found ${nearbyRiders.length} riders within 1000km:`);
    nearbyRiders.forEach(({ riderName, distance }) => {
      console.log(`   🏍️ ${riderName} - ${distance.toFixed(2)} km away`);
    });

    // Send notification to nearby riders
    nearbyRiders.forEach(({ riderId, riderName, distance }) => {
      console.log(`📤 Sending order notification to: ${riderName} (rider_${riderId})`);
      
      // Calculate distance from restaurant to customer for display
      const distanceToCustomer = calculateDistance(
        restaurantLat,
        restaurantLon,
        order.deliveryAddress.latitude,
        order.deliveryAddress.longitude
      );
      
      // Rider earnings logic:
      // - If customer paid delivery fee (order < ₹500): rider gets same amount
      // - If customer got free delivery (order ≥ ₹500): calculate rider earnings separately
      const riderEarnings = order.deliveryFee > 0 
        ? order.deliveryFee 
        : Math.round(distanceToCustomer * 8);
      
      io.to(`rider_${riderId}`).emit('new_order_available', {
        orderId: order._id,
        restaurantName: restaurant.restaurantDetails.kitchenName,
        restaurantAddress: restaurant.restaurantDetails.address,
        deliveryAddress: order.deliveryAddress,
        totalAmount: order.totalAmount,
        distance: distance.toFixed(2), // Distance from rider to restaurant
        distanceToCustomer: distanceToCustomer.toFixed(2), // Distance from restaurant to customer
        riderEarnings, // Earnings based on delivery distance
        paymentMethod: order.paymentMethod, // Payment mode (cod or online)
        items: order.items,
      });
    });
    
    console.log('✅ Notification process completed');
  } catch (error) {
    console.error('❌ Error notifying nearby riders:', error);
  }
}

// Haversine formula for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // c is the angular distance in radians
  return R * c;
}

// Auto-reject orders after 10 minutes of no action
setInterval(async () => {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const pendingOrders = await Order.find({
      status: 'pending',
      createdAt: { $lt: tenMinutesAgo },
    });

    for (const order of pendingOrders) {
      order.status = 'auto_rejected';
      order.rejectionReason = 'Restaurant did not respond within 10 minutes';
      await order.save();

      activeOrdersPool.delete(order._id.toString());

      io.to(`order_${order._id}`).emit('order_status_changed', {
        orderId: order._id,
        status: 'auto_rejected',
        message: 'Order automatically rejected due to no response',
      });

      console.log(`⏱️ Auto-rejected order: ${order._id}`);
    }
  } catch (error) {
    console.error('❌ Error in auto-reject interval:', error);
  }
}, 60000); // Check every minute

// Health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// Debug route to check socket pools
app.get('/api/debug/pools', (req, res) => {
  const connectedSockets = [];
  io.sockets.sockets.forEach((socket) => {
    connectedSockets.push({
      id: socket.id,
      userId: socket.userId,
      riderId: socket.riderId,
      restaurantId: socket.restaurantId,
      rooms: Array.from(socket.rooms),
    });
  });

  res.json({
    activeRiders: activeRidersPool.size,
    activeOrders: activeOrdersPool.size,
    connectedSockets: connectedSockets.length,
    sockets: connectedSockets,
    riderPool: Array.from(activeRidersPool.entries()).map(([id, data]) => ({
      riderId: id,
      socketId: data.socketId,
      coordinates: data.coordinates,
      activeOrders: data.activeOrders,
    })),
    orderPool: Array.from(activeOrdersPool.entries()).map(([id, data]) => ({
      orderId: id,
      status: data.status,
      restaurantId: data.restaurantId,
      riderId: data.riderId,
    })),
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
  });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
}); 

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL}`);
  console.log(`API Base URL: http://localhost:${PORT}/api`);
  console.log(`Socket.IO enabled`);
}).on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  console.error(err.stack);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  console.error(err.stack);
});
