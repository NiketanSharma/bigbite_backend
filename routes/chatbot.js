import express from 'express';
import fetch from 'node-fetch';
import { protect } from '../middleware/auth.js';

const router = express.Router();

// Gemini API configuration
const GEMINI_API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
].filter(Boolean); // Remove undefined keys

let currentKeyIndex = 0;

// Get current API URL with active key
const getGeminiApiUrl = (keyIndex = null) => {
  const index = keyIndex !== null ? keyIndex : currentKeyIndex;
  const apiKey = GEMINI_API_KEYS[index];
  if (!apiKey) {
    throw new Error('No Gemini API key available');
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
};

// Switch to next API key
const switchToNextKey = () => {
  if (GEMINI_API_KEYS.length > 1) {
    const oldIndex = currentKeyIndex;
    const nextIndex = (currentKeyIndex + 1) % GEMINI_API_KEYS.length;
    currentKeyIndex = nextIndex;
    console.log(`🔄 Switched from API key ${oldIndex + 1} to ${nextIndex + 1}`);
    return true;
  }
  return false;
};

// Detect order intent with AI
router.post('/detect-order-intent', protect, async (req, res) => {
  try {
    const { message } = req.body;
    const userId = req.user.id;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    // Get user's wishlists
    const Wishlist = (await import('../models/Wishlist.js')).default;
    const wishlists = await Wishlist.find({ user: userId });
    const wishlistNames = wishlists.map(w => w.name).join(', ');

    const prompt = `You are a food ordering assistant. Analyze the user's message and determine:\n1. Does the user want to place an order? (yes/no)\n2. If yes, which wishlist name are they referring to?\n\nAvailable wishlists: ${wishlistNames}\n\nUser message: "${message}"\n\nRespond in JSON format ONLY:\n{"wantsToOrder": true/false, "wishlistName": "exact wishlist name or null"}\n\nExamples:\n"order my lunch for me" -> {"wantsToOrder": true, "wishlistName": "lunch"}\n"get me dinner please" -> {"wantsToOrder": true, "wishlistName": "dinner"}\n"place the breakfast order" -> {"wantsToOrder": true, "wishlistName": "breakfast"}\n"what's the weather?" -> {"wantsToOrder": false, "wishlistName": null}`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    let attempts = 0;
    const maxAttempts = GEMINI_API_KEYS.length;

    while (attempts < maxAttempts) {
      try {
        const apiUrl = getGeminiApiUrl();
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          if (response.status === 429 || response.status === 403) {
            if (switchToNextKey()) {
              attempts++;
              continue;
            }
          }
          throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return res.json({
            success: true,
            wantsToOrder: result.wantsToOrder,
            wishlistName: result.wishlistName
          });
        }

        return res.json({
          success: true,
          wantsToOrder: false,
          wishlistName: null
        });

      } catch (error) {
        if ((error.message.includes('429') || error.message.includes('403')) && switchToNextKey()) {
          attempts++;
          continue;
        }
        break;
      }
    }

    // Fallback response
    res.json({
      success: true,
      wantsToOrder: false,
      wishlistName: null
    });

  } catch (error) {
    console.error('Error in detect-order-intent:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process order intent detection'
    });
  }
});

// General chatbot conversation
router.post('/chat', protect, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const prompt = `You are a helpful food delivery chatbot assistant for BigBite. Answer the user's question: ${message}. Keep responses concise and friendly. If they ask about orders, tell them they can place orders by saying things like "order lunch" or "get me dinner" if they have wishlists saved.`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    let attempts = 0;
    const maxAttempts = GEMINI_API_KEYS.length;
    let aiResponse = '';

    while (attempts < maxAttempts) {
      try {
        const apiUrl = getGeminiApiUrl();
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          if (response.status === 429 || response.status === 403) {
            if (switchToNextKey()) {
              attempts++;
              continue;
            }
          }
          throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process that request.';
        break;

      } catch (error) {
        if ((error.message.includes('429') || error.message.includes('403')) && switchToNextKey()) {
          attempts++;
          continue;
        }
        aiResponse = attempts >= maxAttempts - 1 ?
          'Sorry, the AI assistant is currently experiencing issues. Please try again later.' :
          'Sorry, I encountered an error. Please try again.';
        break;
      }
    }

    res.json({
      success: true,
      message: aiResponse
    });

  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process chat message'
    });
  }
});

export default router;