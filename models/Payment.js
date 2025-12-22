import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  // Razorpay Payment Details
  razorpay_order_id: {
    type: String,
    required: true
  },
  razorpay_payment_id: {
    type: String,
    default: null
  },
  razorpay_signature: {
    type: String,
    default: null
  },
  
  // Payment Information
  amount: {
    type: Number,
    required: true // amount in paise
  },
  currency: {
    type: String,
    default: 'INR'
  },
  
  // Status
  status: {
    type: String,
    enum: ['CREATED', 'SUCCESS', 'FAILED'],
    default: 'CREATED'
  },
  
  // User Reference
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Service Category (for compliance)
  notes: {
    category: {
      type: String,
      default: 'service'
    },
    purpose: {
      type: String,
      default: 'educational project demo'
    },
    type: {
      type: String,
      default: 'digital_service'
    }
  }
}, {
  timestamps: true
});

// Index for faster queries
paymentSchema.index({ razorpay_order_id: 1 });
paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ status: 1 });

const Payment = mongoose.model('Payment', paymentSchema);
export default Payment;
