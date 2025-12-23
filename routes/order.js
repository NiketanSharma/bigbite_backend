import express from 'express';
import Order from '../models/Order.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { io, activeOrdersPool, activeRidersPool } from '../server.js';

const router = express.Router();

// Haversine formula to calculate distance between two coordinates
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// POST /api/orders/pending - Create pending order before payment
router.post('/pending', async (req, res) => {
  try {
    const {
      customerId,
      restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      pricing,
    } = req.body;

    console.log('📝 Creating pending order for online payment');

    // Validate required fields
    if (!customerId || !restaurantId || !items || !deliveryAddress || !paymentMethod || !pricing) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Get restaurant details
    const restaurant = await User.findById(restaurantId);
    
    if (!restaurant || restaurant.role !== 'restaurant') {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found',
      });
    }

    // Create pending order
    const order = new Order({
      customer: customerId,
      restaurant: restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      paymentStatus: 'pending',
      status: 'pending_payment',
      ...pricing,
    });

    await order.save();

    console.log('✅ Pending order created:', order._id);

    res.status(201).json({
      success: true,
      order: {
        _id: order._id,
        totalAmount: order.totalAmount,
      },
    });
  } catch (error) {
    console.error('❌ Error creating pending order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create pending order',
      error: error.message,
    });
  }
});

// POST /api/orders/:orderId/confirm - Confirm order after successful payment
router.post('/:orderId/confirm', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    console.log('✅ Confirming order after payment:', orderId);

    // Find pending order
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Verify payment
    const payment = await Payment.findOne({ razorpay_order_id });
    
    if (!payment || payment.status !== 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed',
      });
    }

    // Update order - change from pending_payment to pending (waiting for restaurant)
    order.status = 'pending';
    order.paymentStatus = 'paid';
    order.razorpay_payment_id = razorpay_payment_id;
    await order.save();

    // Populate order details for socket emission
    await order.populate('customer restaurant items.menuItem');

    console.log('✅ Order confirmed:', orderId);

    // Format order data for socket emission (same format as COD orders)
    const orderSocketData = {
      _id: order._id,
      orderNumber: order.orderNumber,
      customer: order.customer,
      restaurant: order.restaurant,
      items: order.items,
      totalAmount: order.totalAmount,
      deliveryAddress: order.deliveryAddress,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      createdAt: order.createdAt,
    };

    // Emit socket event to restaurant for new order notification
    console.log(`📡 Emitting new_order_received to restaurant_${order.restaurant._id}`);
    io.to(`restaurant_${order.restaurant._id}`).emit('new_order_received', orderSocketData);

    res.json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('❌ Error confirming order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to confirm order',
      error: error.message,
    });
  }
});

// POST /api/orders - Place a new order
router.post('/', async (req, res) => {
  try {
    const {
      customerId,
      restaurantId,
      items,
      deliveryAddress,
      paymentMethod,
      pricing,
      razorpay_order_id, // For online payments
    } = req.body;

    console.log('📦 Received order request:', { customerId, restaurantId, items: items?.length, deliveryAddress, paymentMethod, pricing });
    
    // If online payment, verify payment success before creating order
    if (paymentMethod === 'online') {
      if (!razorpay_order_id) {
        return res.status(400).json({
          success: false,
          message: 'Payment order ID is required for online payment',
        });
      }

      // Verify payment status from database
      const payment = await Payment.findOne({ razorpay_order_id });
      
      if (!payment) {
        return res.status(400).json({
          success: false,
          message: 'Payment record not found',
        });
      }

      if (payment.status !== 'SUCCESS') {
        return res.status(400).json({
          success: false,
          message: 'Payment verification failed. Please complete the payment first.',
        });
      }

      console.log('✅ Payment verified for order placement:', razorpay_order_id);
    }
    
    console.log('💰 PRICING DATA RECEIVED FROM FRONTEND:');
    console.log('   Subtotal:', pricing?.subtotal);
    console.log('   Delivery Fee:', pricing?.deliveryFee);
    console.log('   Platform Fee:', pricing?.platformFee);
    console.log('   GST:', pricing?.gst);
    console.log('   Total:', pricing?.totalAmount);

    // Validate required fields
    if (!customerId || !restaurantId || !items || !deliveryAddress || !paymentMethod || !pricing) {
      console.log('❌ VALIDATION FAILED - Missing fields:');
      console.log('   customerId:', customerId ? '✅' : '❌');
      console.log('   restaurantId:', restaurantId ? '✅' : '❌');
      console.log('   items:', items ? '✅' : '❌');
      console.log('   deliveryAddress:', deliveryAddress ? '✅' : '❌');
      console.log('   paymentMethod:', paymentMethod ? '✅' : '❌');
      console.log('   pricing:', pricing ? '✅' : '❌');
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
      });
    }

    // Get restaurant details
    const restaurant = await User.findById(restaurantId);
    console.log('🔍 Found user:', { id: restaurant?._id, role: restaurant?.role });
    
    if (!restaurant || restaurant.role !== 'restaurant') {
      console.log('❌ Restaurant validation failed:', { 
        found: !!restaurant, 
        role: restaurant?.role,
        expected: 'restaurant'
      });
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found',
      });
    }

    console.log('✅ Restaurant validated:', restaurant.restaurantDetails?.kitchenName);
    
    // Check if restaurant kitchen is open
    const isKitchenOpen = restaurant.restaurantDetails?.isKitchenOpen ?? true;
    
    if (!isKitchenOpen) {
      console.log('❌ Restaurant kitchen is closed');
      return res.status(400).json({
        success: false,
        message: 'This restaurant is currently closed and not accepting orders',
      });
    }
    
    console.log('📍 Delivery coordinates received:', { 
      latitude: deliveryAddress.latitude, 
      longitude: deliveryAddress.longitude,
      fullAddress: deliveryAddress.fullAddress 
    });
    console.log('📦 Items received from frontend:', JSON.stringify(items, null, 2));

    // Create the order with pricing fields extracted from pricing object
    const orderData = {
      customer: customerId,
      restaurant: restaurantId,
      items,
      deliveryAddress: {
        fullAddress: deliveryAddress.fullAddress,
        latitude: Number(deliveryAddress.latitude),
        longitude: Number(deliveryAddress.longitude),
        street: deliveryAddress.street || '',
        city: deliveryAddress.city || '',
        state: deliveryAddress.state || '',
        zipCode: deliveryAddress.zipCode || '',
        country: deliveryAddress.country || ''
      },
      deliveryInstructions: deliveryAddress.instructions,
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      subtotal: pricing.subtotal,
      deliveryFee: pricing.deliveryFee,
      platformFee: pricing.platformFee,
      gst: pricing.gst,
      totalAmount: pricing.totalAmount,
    };

    // If online payment, get payment details from Payment collection
    if (paymentMethod === 'online' && razorpay_order_id) {
      const payment = await Payment.findOne({ razorpay_order_id });
      if (payment && payment.razorpay_payment_id) {
        orderData.razorpay_payment_id = payment.razorpay_payment_id;
      }
    }

    const order = new Order(orderData);

    await order.save();

    console.log('✅ Order saved successfully:', order._id);
    console.log('💾 Order items in DB before populate:', JSON.stringify(order.items, null, 2));

    // Populate order details for response
    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'items.menuItem', select: 'name price image category' },
    ]);

    console.log("📋 Order items after populate:", JSON.stringify(order.items, null, 2));
    
    // Format items - handle case where menuItem might not populate
    const formattedItems = order.items.map(item => {
      if (!item.menuItem) {
        console.warn(`⚠️ MenuItem not found for item, using fallback data:`, item);
        // U se the name/price from the item itself (if they exist in schema)
        return {
          menuItem: null,
          name: item.name || 'Unknown Item',
          price: item.price || 0,
          quantity: item.quantity,
          _id: item._id
        };
      }
      
      return {
        menuItem: {
          _id: item.menuItem._id,
          name: item.menuItem.name,
          price: item.menuItem.price,
          image: item.menuItem.image,
          category: item.menuItem.category
        },
        name: item.menuItem.name,
        price: item.menuItem.price,
        quantity: item.quantity,
        _id: item._id
      };
    });
    
    const orderSocketData = {
      orderId: order._id.toString(),
      customerId,
      restaurantId,
      customerName: order.customer.name,
      customerPhone: order.customer.phone,
      restaurantName: restaurant.restaurantDetails.kitchenName,
      restaurantCoordinates: {
        latitude: restaurant.restaurantDetails.address.latitude,
        longitude: restaurant.restaurantDetails.address.longitude,
      },
      deliveryCoordinates: {
        latitude: order.deliveryAddress.latitude,
        longitude: order.deliveryAddress.longitude,
      },
      deliveryAddress: order.deliveryAddress,
      status: 'pending',
      items: formattedItems,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      platformFee: order.platformFee,
      gst: order.gst,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      riderId: null,
      riderDetails: null,
      riderCoordinates: null,
      distanceToRestaurant: 0,
    };

    // Add to active orders pool
    activeOrdersPool.set(order._id.toString(), orderSocketData);
    console.log("socket creating with data:", orderSocketData);

    console.log(`📦 Order added to pool. Pool size: ${activeOrdersPool.size}`);
    console.log(`🏪 Emitting to room: restaurant_${restaurantId}`);
    console.log(`🔍 Order socket data:`, JSON.stringify(orderSocketData, null, 2));

    // Emit to notify restaurant
    const emitted = io.to(`restaurant_${restaurantId}`).emit('new_order_received', orderSocketData);
    console.log(`✅ Emission result:`, emitted);

    // Notify customer via order room
    io.to(`order_${order._id}`).emit('order_placed', {
      orderId: order._id,
      status: 'pending',
      message: 'Order placed successfully! Waiting for restaurant confirmation...',
    });

    console.log(`📦 Order socket created for order: ${order._id}`);
    console.log(`🏪 Notified restaurant: ${restaurantId}`);

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error placing order:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Error placing order',
      error: error.message,
    });
  }
});

// POST /api/orders/:id/accept - Rider accepts an order
router.post('/:id/accept', async (req, res) => {
  try {
    const { riderId } = req.body;
    const orderId = req.params.id;

    // Find the order
    const order = await Order.findById(orderId).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Check if order is still pending
    if (order.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Order has already been accepted',
      });
    }

    // Get rider details
    const rider = await User.findById(riderId);
    if (!rider || rider.role !== 'rider') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found',
      });
    }

    // Update order with rider
    order.rider = riderId;
    order.status = 'rider_assigned';
    order.acceptedAt = new Date();
    await order.save();

    // Notify other riders that order is no longer available
    activeRidersPool.forEach((otherRider) => {
      io.to(`rider_${otherRider.riderId}`).emit('order_taken', {
        orderId: order._id,
      });
    });

    // Emit to order room for customer tracking
    io.to(`order_${order._id}`).emit('order_accepted', {
      orderId: order._id,
      status: 'rider_assigned',
      message: `Rider ${rider.name} accepted your order!`,
      riderName: rider.name,
      riderPhone: rider.phone,
    });

    // Notify restaurant to refresh dashboard
    io.to(`restaurant_${order.restaurant}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'rider_assigned',
      riderName: rider.name,
      riderPhone: rider.phone,
    });

    res.status(200).json({
      success: true,
      message: 'Order accepted successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error accepting order:', error);
    res.status(500).json({
      success: false,
      message: 'Error accepting order',
      error: error.message,
    });
  }
});

// POST /api/orders/:id/verify-pickup-pin - Verify pickup PIN before marking as picked up
router.post('/:id/verify-pickup-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Verify PIN
    if (order.pickupPin !== pin) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickup PIN',
      });
    }

    // Update status to picked_up
    order.status = 'picked_up';
    order.pickedUpAt = new Date();
    await order.save();

    // Populate for socket emission
    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    // Emit status update to order room
    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'picked_up',
      timestamp: new Date(),
      message: 'Rider has picked up your order',
    });

    // Emit to restaurant
    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'picked_up',
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Pickup verified successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error verifying pickup PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying pickup PIN',
      error: error.message,
    });
  }
});

// POST /api/orders/:id/verify-delivery-pin - Verify delivery PIN before marking as delivered
router.post('/:id/verify-delivery-pin', async (req, res) => {
  try {
    const { pin } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Verify PIN
    if (order.deliveryPin !== pin) {
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery PIN',
      });
    }

    // Update status to delivered
    order.status = 'delivered';
    order.deliveredAt = new Date();

    // Update rider statistics
    if (order.rider) {
      const rider = await User.findById(order.rider);
      if (rider && rider.role === 'rider') {
        // Check if it's a new day, reset today's earnings
        const lastReset = new Date(rider.riderDetails.lastEarningsReset);
        const today = new Date();
        if (lastReset.toDateString() !== today.toDateString()) {
          rider.riderDetails.todayEarnings = 0;
          rider.riderDetails.lastEarningsReset = today;
        }
        
        // Update stats
        rider.riderDetails.totalDeliveries = (rider.riderDetails.totalDeliveries || 0) + 1;
        rider.riderDetails.totalEarnings = (rider.riderDetails.totalEarnings || 0) + (order.riderEarnings || 0);
        rider.riderDetails.todayEarnings = (rider.riderDetails.todayEarnings || 0) + (order.riderEarnings || 0);
        
        await rider.save();
        console.log(`💰 Rider ${rider.name} earned ₹${order.riderEarnings}. Today: ₹${rider.riderDetails.todayEarnings}, Total: ₹${rider.riderDetails.totalEarnings}`);
      }
    }

    await order.save();

    // Populate for socket emission
    await order.populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    // Emit status update to order room
    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date(),
      message: 'Your order has been delivered',
    });

    // Emit to restaurant
    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status: 'delivered',
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Delivery verified successfully',
      order,
    });
  } catch (error) {
    console.error('❌ Error verifying delivery PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying delivery PIN',
      error: error.message,
    });
  }
});

// PATCH /api/orders/:id/status - Update order status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;

    const validStatuses = [
      'preparing',
      'ready',
      'picked_up',
      'on_the_way',
      'delivered',
      'cancelled',
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
      });
    }

    const order = await Order.findById(orderId).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    // Update status and timestamp
    order.status = status;

    switch (status) {
      case 'preparing':
        order.preparingAt = new Date();
        break;
      case 'ready':
        order.readyAt = new Date();
        break;
      case 'picked_up':
        order.pickedUpAt = new Date();
        break;
      case 'on_the_way':
        order.onTheWayAt = new Date();
        break;
      case 'delivered':
        order.deliveredAt = new Date();
        
        // Update rider statistics
        if (order.rider) {
          const rider = await User.findById(order.rider);
          if (rider && rider.role === 'rider') {
            // Check if it's a new day, reset today's earnings
            const lastReset = new Date(rider.riderDetails.lastEarningsReset);
            const today = new Date();
            if (lastReset.toDateString() !== today.toDateString()) {
              rider.riderDetails.todayEarnings = 0;
              rider.riderDetails.lastEarningsReset = today;
            }
            
            // Update stats
            rider.riderDetails.totalDeliveries = (rider.riderDetails.totalDeliveries || 0) + 1;
            rider.riderDetails.totalEarnings = (rider.riderDetails.totalEarnings || 0) + (order.riderEarnings || 0);
            rider.riderDetails.todayEarnings = (rider.riderDetails.todayEarnings || 0) + (order.riderEarnings || 0);
            
            await rider.save();
            console.log(`\ud83d\udcb0 Rider ${rider.name} earned \u20b9${order.riderEarnings}. Today: \u20b9${rider.riderDetails.todayEarnings}, Total: \u20b9${rider.riderDetails.totalEarnings}`);
          }
        }
        break;
      case 'cancelled':
        order.cancelledAt = new Date();
        break;
    }

    await order.save();

    // Emit status update to order room
    io.to(`order_${orderId}`).emit('order_status_changed', {
      orderId: order._id,
      status,
      timestamp: new Date(),
      message: getStatusMessage(status),
    });

    // Also emit to restaurant room to update dashboard
    io.to(`restaurant_${order.restaurant._id}`).emit('order_status_changed', {
      orderId: order._id,
      status,
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Order status updated',
      order,
    });
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status',
      error: error.message,
    });
  }
});

// Helper function to get status message
const getStatusMessage = (status) => {
  const messages = {
    preparing: 'Your order is being prepared',
    ready: 'Your order is ready for pickup',
    picked_up: 'Rider has picked up your order',
    on_the_way: 'Your order is on the way',
    delivered: 'Your order has been delivered',
    cancelled: 'Your order has been cancelled',
  };
  return messages[status] || 'Order status updated';
};

// GET /api/orders/customer/:customerId - Get customer orders
router.get('/customer/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;

    // Exclude pending_payment orders (failed payments that were never confirmed)
    const orders = await Order.find({ 
      customer: customerId,
      status: { $ne: 'pending_payment' } // Exclude pending_payment status
    })
      .populate([
        { path: 'restaurant', select: 'restaurantDetails' },
        { path: 'rider', select: 'name phone' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
});

// GET /api/orders/available - Get all available orders from activeOrdersPool
router.get('/available', async (req, res) => {
  try {
    let { latitude, longitude } = req.query;
    const MAX_DISTANCE_KM = 1000;
    
    console.log(`📦 Fetching available orders from pool (${activeOrdersPool.size} total)`);
    console.log(`📍 Rider location from query: ${latitude}, ${longitude}`);
    
    // If location not provided in query, try to get from authenticated user
    if ((!latitude || !longitude) && req.user) {
      // Try to find rider in activeRidersPool
      const riderData = activeRidersPool.get(req.user.toString());
      if (riderData && riderData.coordinates) {
        latitude = riderData.coordinates.latitude;
        longitude = riderData.coordinates.longitude;
        console.log(`📍 Using rider location from activeRidersPool: ${latitude}, ${longitude}`);
      }
    }

    // Get orders from activeOrdersPool that are awaiting riders
    const availableOrdersFromPool = [];
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

    for (const [orderId, orderData] of activeOrdersPool.entries()) {
      // Only include orders awaiting riders and created within last 10 minutes
      if (orderData.status === 'awaiting_rider' && orderData.createdAt >= tenMinutesAgo) {
        availableOrdersFromPool.push(orderId);
      }
    }

    console.log(`✅ Found ${availableOrdersFromPool.length} awaiting_rider orders in pool`);

    if (availableOrdersFromPool.length === 0) {
      return res.json({
        success: true,
        orders: [],
      });
    }

    // Fetch full order details from database
    const orders = await Order.find({ 
      _id: { $in: availableOrdersFromPool }
    })
      .populate([
        { path: 'customer', select: 'name phone address' },
        { path: 'restaurant', select: 'restaurantDetails name' },
        { path: 'items.menuItem', select: 'name price image' },
      ])
      .sort({ createdAt: -1 });

    console.log(`📥 Populated ${orders.length} orders from database`);

    let filteredOrders = orders;

    // If rider location is provided or found, filter by distance
    if (latitude && longitude && !isNaN(parseFloat(latitude)) && !isNaN(parseFloat(longitude))) {
      const riderLat = parseFloat(latitude);
      const riderLon = parseFloat(longitude);
      console.log(`📍 Final rider location for filtering: ${riderLat}, ${riderLon}`);

      console.log(`🔍 Filtering orders within ${MAX_DISTANCE_KM}km radius`);

      filteredOrders = orders.filter(order => {
        const restaurant = order.restaurant;
        if (!restaurant?.restaurantDetails?.address?.latitude || !restaurant?.restaurantDetails?.address?.longitude) {
          console.log(`⚠️ Order ${order.orderNumber}: Missing restaurant coordinates`);
          return false;
        }

        const distance = calculateDistance(
          riderLat,
          riderLon,
          restaurant.restaurantDetails.address.latitude,
          restaurant.restaurantDetails.address.longitude
        );

        const withinRange = distance <= MAX_DISTANCE_KM;
        console.log(`📦 Order ${order.orderNumber}: ${distance.toFixed(2)}km - ${withinRange ? '✅ Within range' : '❌ Too far'}`);

        return withinRange;
      });

      console.log(`✅ ${filteredOrders.length} orders within ${MAX_DISTANCE_KM}km radius`);
    } else {
      console.log(`⚠️ No valid rider location provided - returning all available orders without distance filtering`);
          riderLat,
          riderLon,
          restaurant.restaurantDetails.address.latitude,
          restaurant.restaurantDetails.address.longitude
        );

        const withinRange = distance <= MAX_DISTANCE_KM;
        console.log(`📦 Order ${order.orderNumber}: ${distance.toFixed(2)}km - ${withinRange ? '✅ Within range' : '❌ Too far'}`);

        return withinRange;
      });

      console.log(`✅ ${filteredOrders.length} orders within ${MAX_DISTANCE_KM}km radius`);
    }

    // Format orders for rider view
    const formattedOrders = filteredOrders.map(order => ({
      orderId: order._id,
      orderNumber: order.orderNumber,
      restaurantName: order.restaurant?.restaurantDetails?.kitchenName || order.restaurant?.name || 'Unknown',
      restaurantAddress: order.restaurant?.restaurantDetails?.address,
      customerName: order.customer?.name,
      customerPhone: order.customer?.phone,
      deliveryAddress: order.deliveryAddress,
      totalAmount: order.totalAmount,
      deliveryFee: order.deliveryFee,
      items: order.items,
      status: order.status,
      createdAt: order.createdAt,
      pickupPin: order.pickupPin,
      distanceToCustomer: order.distanceToCustomer,
    }));

    console.log(`📤 Returning ${formattedOrders.length} formatted orders`);

    res.json({
      success: true,
      orders: formattedOrders,
    });
  } catch (error) {
    console.error('❌ Error fetching available orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available orders',
      error: error.message,
    });
  }
});

// GET /api/orders/rider/:riderId - Get rider orders
router.get('/rider/:riderId', async (req, res) => {
  try {
    const { riderId } = req.params;

    const orders = await Order.find({ rider: riderId })
      .populate([
        { path: 'customer', select: 'name phone' },
        { path: 'restaurant', select: 'restaurantDetails' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching rider orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
});

// GET /api/orders/:id - Get order details
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate([
      { path: 'customer', select: 'name email phone' },
      { path: 'restaurant', select: 'restaurantDetails' },
      { path: 'rider', select: 'name phone riderDetails' },
      { path: 'items.menuItem', select: 'name price' },
    ]);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    res.status(200).json({
      success: true,
      order,
    });
  } catch (error) {
    console.error('❌ Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching order',
      error: error.message,
    });
  }
});

// PATCH /api/orders/:id/rider-location - Update rider location
router.patch('/:id/rider-location', async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const orderId = req.params.id;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    order.riderLocation = {
      latitude,
      longitude,
      lastUpdated: new Date(),
    };

    await order.save();

    // Broadcast location to order room only
    io.to(`order_${orderId}`).emit('rider_location', {
      orderId,
      location: { latitude, longitude },
      timestamp: new Date(),
    });

    res.status(200).json({
      success: true,
      message: 'Rider location updated',
    });
  } catch (error) {
    console.error('❌ Error updating rider location:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating rider location',
      error: error.message,
    });
  }
});

// GET /api/orders/restaurant/:restaurantId - Get restaurant orders
router.get('/restaurant/:restaurantId', async (req, res) => {
  try {
    const { restaurantId } = req.params;

    const orders = await Order.find({ restaurant: restaurantId })
      .populate([
        { path: 'customer', select: 'name phone' },
        { path: 'rider', select: 'name phone' },
        { path: 'items.menuItem', select: 'name price' },
      ])
      .sort({ createdAt: -1 })
      .limit(50); // Limit to recent 50 orders

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.error('❌ Error fetching restaurant orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders',
      error: error.message,
    });
  }
});

export default router;
