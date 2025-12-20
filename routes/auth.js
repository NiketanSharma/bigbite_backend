import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { sendTokenResponse } from '../utils/auth.js';
import { protect } from '../middleware/auth.js';
import passport from 'passport';

const router = express.Router();

// @route   POST /api/auth/signup
// @desc    Register a new user
// @access  Public
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // Validate required fields (phone is optional)
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password',
      });
    }

    // Check if user already exists by email
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // Check if phone is provided and already exists
    if (phone) {
      const phoneExists = await User.findOne({ phone });
      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already registered',
        });
      }
    }

    // Validate role
    const validRoles = ['customer', 'rider', 'restaurant'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified',
      });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      phone: phone || '0000000000', // Default phone if not provided
      password,
      role: role || 'customer',
      authProvider: 'local',
    });

    // Send token response
    sendTokenResponse(user, 201, res);
  } catch (error) {
    console.error('Signup error:', error);

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages[0],
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating user account',
    });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password',
      });
    }

    // Check for user (include password field)
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if user signed up with Google
    if (user.authProvider === 'google' && !user.password) {
      return res.status(401).json({
        success: false,
        message: 'Please login with Google',
      });
    }

    // Check if password matches
    const isPasswordMatch = await user.comparePassword(password);

    if (!isPasswordMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated',
      });
    }

    // Send token response
    sendTokenResponse(user, 200, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current logged in user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        address: user.address,
        restaurantDetails: user.restaurantDetails,
        riderDetails: user.riderDetails,
        authProvider: user.authProvider,
        isEmailVerified: user.isEmailVerified,
        isPhoneVerified: user.isPhoneVerified,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data',
    });
  }
});

// @route   POST /api/auth/logout
// @desc    Logout user / clear cookie
// @access  Public
router.post('/logout', (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    expires: new Date(0),
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
  };

  if (process.env.COOKIE_DOMAIN) {
    cookieOptions.domain = process.env.COOKIE_DOMAIN;
  }

  res.cookie('token', '', cookieOptions);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private
router.put('/update-profile', protect, async (req, res) => {
  try {
    const { name, phone, address, avatar, role, restaurantDetails, riderDetails } = req.body;

    console.log('📥 Update Profile Request:', {
      name,
      phone,
      address,
      restaurantDetails: restaurantDetails ? {
        kitchenName: restaurantDetails.kitchenName,
        address: restaurantDetails.address,
        addressCoordinates: restaurantDetails.address ? {
          latitude: restaurantDetails.address.latitude,
          longitude: restaurantDetails.address.longitude
        } : null,
      } : null,
      riderDetails: riderDetails ? {
        vehicleType: riderDetails.vehicleType,
        vehicleNumber: riderDetails.vehicleNumber,
        licenseNumber: riderDetails.licenseNumber,
      } : null,
    });

    const fieldsToUpdate = {};
    if (name) fieldsToUpdate.name = name;
    if (phone) fieldsToUpdate.phone = phone;
    if (address) fieldsToUpdate.address = address;
    if (avatar) fieldsToUpdate.avatar = avatar;
    if (restaurantDetails) fieldsToUpdate.restaurantDetails = restaurantDetails;
    if (riderDetails) {
      fieldsToUpdate.riderDetails = riderDetails;
      // Mark nested object as modified for MongoDB
      fieldsToUpdate.$set = { riderDetails };
    }
    
    // Allow role change
    if (role) {
      const validRoles = ['customer', 'rider', 'restaurant', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role specified',
        });
      }
      fieldsToUpdate.role = role;
    }

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        address: user.address,
        restaurantDetails: user.restaurantDetails,
        riderDetails: user.riderDetails,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);

    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: messages[0],
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating profile',
    });
  }
});

// @route   GET /api/auth/google
// @desc    Initiate Google OAuth
// @access  Public
router.get('/google', (req, res, next) => {
  // Store redirect URL in session
  const redirectUrl = req.query.redirect || '/';
  req.session.redirectUrl = redirectUrl;
  
  passport.authenticate('google', {
    scope: ['profile', 'email'],
  })(req, res, next);
});

// @route   GET /api/auth/google/callback
// @desc    Google OAuth callback
// @access  Public
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${process.env.FRONTEND_URL}/?error=google-auth-failed`,
    session: true,
  }),
  (req, res) => {
    // Successful authentication - generate JWT token
    const token = jwt.sign(
      { id: req.user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );
    
    // Get redirect URL from session or use default
    const redirectUrl = req.session.redirectUrl || '/';
    delete req.session.redirectUrl;
    
    // Redirect to frontend with token in URL fragment
    res.redirect(`${process.env.FRONTEND_URL}${redirectUrl}#token=${token}`);
  }
);

export default router;
