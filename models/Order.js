import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  // Customer Information
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Restaurant Information
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Order Items
  items: [{
    menuItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true
    },
    name: String,
    price: Number,
    quantity: {
      type: Number,
      required: true,
      min: 1
    }
  }],
  
  // Delivery Information
  deliveryAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String,
    latitude: Number,
    longitude: Number,
    fullAddress: String
  },
  
  deliveryInstructions: String,
  
  // Payment Information
  paymentMethod: {
    type: String,
    enum: ['cod', 'online'],
    default: 'cod'
  },
  
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },
  
  // Razorpay Payment ID (for online payments)
  razorpay_payment_id: {
    type: String,
    default: null
  },

  // Pricing
  subtotal: {
    type: Number,
    required: true
  },
  
  deliveryFee: {
    type: Number,
    default: 0
  },
  
  platformFee: {
    type: Number,
    default: 0
  },
  
  gst: {
    type: Number,
    default: 0
  },
  
  totalAmount: {
    type: Number,
    required: true
  },
  
  // Order Status
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'auto_rejected', 'rider_assigned', 'preparing', 'ready', 'picked_up', 'on_the_way', 'delivered', 'cancelled'],
    default: 'pending'
  },
  
  // Rider Information
  rider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  riderLocation: {
    latitude: Number,
    longitude: Number,
    lastUpdated: Date
  },

  // Distance and Earnings
  distanceToCustomer: {
    type: Number, // in km
    default: 0
  },

  riderEarnings: {
    type: Number, // ₹10 per km
    default: 0
  },
  
  // Timestamps
  orderedAt: {
    type: Date,
    default: Date.now
  },
  
  acceptedAt: Date,
  preparingAt: Date,
  readyAt: Date,
  pickedUpAt: Date,
  onTheWayAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  
  // Cancellation
  cancellationReason: String,
  cancelledBy: {
    type: String,
    enum: ['customer', 'restaurant', 'rider', 'admin']
  },
  
  // Estimated delivery time
  estimatedDeliveryTime: Number, // in minutes
  
  // Ratings
  restaurantRating: {
    value: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String,
    ratedAt: Date
  },

  riderRating: {
    value: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String,
    ratedAt: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, status: 1 });
orderSchema.index({ rider: 1, status: 1 });
orderSchema.index({ status: 1 });

const Order = mongoose.model('Order', orderSchema);
export default Order;
