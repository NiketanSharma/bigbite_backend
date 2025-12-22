import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Payment from '../models/Payment.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Lazy initialization - Razorpay instance will be created when first needed
let razorpay = null;
let razorpayInitialized = false;

// Function to initialize Razorpay (called on first request)
const initializeRazorpay = () => {
  if (razorpayInitialized) return;
  
  const KEY_ID = process.env.RAZORPAY_KEY_ID?.trim();
  const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET?.trim();

  if (KEY_ID && KEY_SECRET) {
    razorpay = new Razorpay({
      key_id: KEY_ID,
      key_secret: KEY_SECRET,
    });
    console.log('✅ Razorpay payment gateway initialized');
  } else {
    console.warn('⚠️ Razorpay credentials not configured. Payment routes will return errors.');
  }
  
  razorpayInitialized = true;
};

// POST /api/payment/create-order - Create Razorpay order
router.post('/create-order', protect, async (req, res) => {
  try {
    // Initialize Razorpay on first use
    initializeRazorpay();
    
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway not configured. Please use Cash on Delivery.',
      });
    }
    
    const { amount } = req.body; // amount should be in rupees from frontend
    const customerId = req.user.id;

    console.log('💳 Creating payment order for amount:', amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount',
      });
    }

    // Convert amount to paise (Razorpay requires amount in paise)
    const amountInPaise = Math.round(amount * 100);

    // Generate unique receipt ID
    const receiptId = `edu_proj_${Date.now()}_${customerId.slice(-6)}`;

    // STRICT COMPLIANCE: Create Razorpay order with service-based structure
    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: receiptId,
      notes: {
        category: 'service',
        purpose: 'educational project demo',
        type: 'digital_service',
      },
    };

    console.log('📝 Creating Razorpay order with options:', options);

    const razorpayOrder = await razorpay.orders.create(options);

    console.log('✅ Razorpay order created:', razorpayOrder.id);

    // Store payment record in database with CREATED status
    const payment = new Payment({
      razorpay_order_id: razorpayOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      status: 'CREATED',
      customer: customerId,
      notes: {
        category: 'service',
        purpose: 'educational project demo',
        type: 'digital_service',
      },
    });

    await payment.save();

    console.log('💾 Payment record created in database');

    res.status(200).json({
      success: true,
      order: {
        id: razorpayOrder.id,
        amount: amountInPaise,
        currency: razorpayOrder.currency,
      },
      key: process.env.RAZORPAY_KEY_ID, // Send key_id to frontend
    });
  } catch (error) {
    console.error('❌ Error creating payment order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
      error: error.message,
    });
  }
});

// POST /api/payment/verify - Verify payment signature
router.post('/verify', protect, async (req, res) => {
  try {
    // Initialize Razorpay on first use
    initializeRazorpay();
    
    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway not configured.',
      });
    }
    
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    console.log('🔐 Verifying payment:', {
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
    });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment details',
      });
    }

    // Find payment record
    const payment = await Payment.findOne({ razorpay_order_id });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found',
      });
    }

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    console.log('🔍 Signature verification:', {
      generated: generatedSignature,
      received: razorpay_signature,
      match: generatedSignature === razorpay_signature,
    });

    if (generatedSignature === razorpay_signature) {
      // Update payment record with SUCCESS status
      payment.razorpay_payment_id = razorpay_payment_id;
      payment.razorpay_signature = razorpay_signature;
      payment.status = 'SUCCESS';
      await payment.save();

      console.log('✅ Payment verified and marked as SUCCESS');

      res.status(200).json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: razorpay_payment_id,
      });
    } else {
      // Mark payment as FAILED
      payment.status = 'FAILED';
      await payment.save();

      console.log('❌ Payment verification failed - signature mismatch');

      res.status(400).json({
        success: false,
        message: 'Payment verification failed',
      });
    }
  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment',
      error: error.message,
    });
  }
});

// GET /api/payment/status/:orderId - Get payment status
router.get('/status/:orderId', protect, async (req, res) => {
  try {
    const { orderId } = req.params;

    const payment = await Payment.findOne({ razorpay_order_id: orderId });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found',
      });
    }

    res.status(200).json({
      success: true,
      payment: {
        orderId: payment.razorpay_order_id,
        paymentId: payment.razorpay_payment_id,
        amount: payment.amount / 100, // Convert back to rupees
        status: payment.status,
        createdAt: payment.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message,
    });
  }
});

export default router;
