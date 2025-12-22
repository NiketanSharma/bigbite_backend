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
    const maxAttempts = GEMINI_API_KEYS.length * 2; // Allow retries with each key

    while (attempts < maxAttempts) {
      try {
        const apiUrl = getGeminiApiUrl();
        console.log(`🔑 Attempt ${attempts + 1}/${maxAttempts}: Using API key ${currentKeyIndex + 1}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`❌ API key ${currentKeyIndex + 1} failed (${response.status})`);
          
          if (response.status === 429 || response.status === 403) {
            console.log(`⚠️ Rate limit/Auth error on key ${currentKeyIndex + 1}`);
            attempts++;
            if (attempts < maxAttempts && switchToNextKey()) {
              console.log(`🔄 Switched to API key ${currentKeyIndex + 1}, retrying...`);
              continue;
            } else {
              console.log('❌ No more API keys available or max attempts reached');
              throw new Error(`All API keys exhausted: ${response.status}`);
            }
          }
          attempts++;
          throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        console.log(`✅ Success with API key ${currentKeyIndex + 1}`);
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
        console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
        
        if ((error.message.includes('429') || error.message.includes('403')) && attempts < maxAttempts - 1) {
          if (switchToNextKey()) {
            attempts++;
            console.log(`🔄 Error caught, switched to key ${currentKeyIndex + 1}, retrying...`);
            continue;
          }
        }
        
        // If we've exhausted retries, break
        if (attempts >= maxAttempts - 1) {
          console.log('❌ All retry attempts exhausted');
          break;
        }
        
        attempts++;
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

// Detect confirmation/cancellation intent with AI
router.post('/detect-confirmation', protect, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const prompt = `You are analyzing a user's response to determine if they are confirming or canceling an action.

User message: "${message}"

Analyze the message and determine the user's intent:
- "confirm" if they are agreeing, confirming, or saying yes (examples: "yes", "sure", "ok", "definitely", "of course", "proceed", "go ahead", "yup", "yeah", "affirmative", "absolutely", "correct", "right", "confirm")
- "cancel" if they are refusing, canceling, or saying no (examples: "no", "cancel", "stop", "nope", "nah", "don't", "abort", "nevermind", "no thanks")
- "unclear" if the intent is ambiguous or unrelated

Respond with ONLY ONE WORD in lowercase: confirm, cancel, or unclear

No explanation, just the intent word.`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    let attempts = 0;
    const maxAttempts = GEMINI_API_KEYS.length * 2;

    while (attempts < maxAttempts) {
      try {
        const apiUrl = getGeminiApiUrl();
        console.log(`🔑 Confirmation detection - Attempt ${attempts + 1}/${maxAttempts}: Using API key ${currentKeyIndex + 1}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          console.log(`❌ API key ${currentKeyIndex + 1} failed (${response.status})`);
          
          if (response.status === 429 || response.status === 403) {
            console.log(`⚠️ Rate limit/Auth error on key ${currentKeyIndex + 1}`);
            attempts++;
            if (attempts < maxAttempts && switchToNextKey()) {
              console.log(`🔄 Switched to API key ${currentKeyIndex + 1}, retrying...`);
              continue;
            } else {
              throw new Error(`All API keys exhausted: ${response.status}`);
            }
          }
          attempts++;
          throw new Error(`Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        console.log(`✅ Confirmation detection success with API key ${currentKeyIndex + 1}`);
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() || 'unclear';

        // Extract just the intent word (confirm, cancel, or unclear)
        let intent = 'unclear';
        if (aiResponse.includes('confirm')) {
          intent = 'confirm';
        } else if (aiResponse.includes('cancel')) {
          intent = 'cancel';
        }

        console.log(`🤔 User said: "${message}" → Intent: ${intent}`);

        return res.json({
          success: true,
          intent: intent
        });

      } catch (error) {
        console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
        attempts++;
        
        if ((error.message.includes('429') || error.message.includes('403')) && attempts < maxAttempts) {
          if (switchToNextKey()) {
            console.log(`🔄 Error caught, switched to key ${currentKeyIndex + 1}, retrying...`);
            continue;
          }
        }
        
        if (attempts >= maxAttempts) {
          break;
        }
      }
    }

    // Fallback: return unclear if all attempts fail
    res.json({
      success: true,
      intent: 'unclear'
    });

  } catch (error) {
    console.error('Error in detect-confirmation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process confirmation detection'
    });
  }
});

// General chatbot conversation
router.post('/chat', protect, async (req, res) => {
  try {
    const { message } = req.body;
    console.log('\n========== CHATBOT BACKEND REQUEST ==========');
    console.log('💬 Received message:', message);
    console.log('👤 User ID:', req.user.id);

    if (!message) {
      console.log('❌ No message provided');
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const prompt = `You are BigBite AI Assistant, a friendly and helpful chatbot for BigBite food delivery service.

IMPORTANT - OFFICIAL CONTACT INFORMATION:
- Phone: 9729024316
- Email: bharatkumar19030@gmail.com
DO NOT use any other phone numbers or contact details. ONLY use the above contact information.

GUIDELINES:
1. For food delivery related queries (restaurants, orders, menu, delivery, etc.) - Answer helpfully and provide relevant information
2. For casual conversation and greetings - Respond warmly and engage naturally  
3. For topics completely unrelated to food delivery (politics, sports, weather, etc.) - Politely inform: "I'm BigBite's food delivery assistant. I can help you with ordering food, tracking deliveries, restaurant information, and related queries. For other topics, I may not be the best help!"
4. If user asks for helpline/contact/support/help/customer care/customer service - MUST provide ONLY these exact details: "You can reach our support team at:\n📞 Phone: 9729024316\n📧 Email: bharatkumar19030@gmail.com\n\nWe're here to help! 😊"
5. If user asks about their order status, issues with orders, order problems, or wants to enquire about an order - MUST provide: "For order enquiries and support, please contact us at:\n📞 Phone: 9729024316\n📧 Email: bharatkumar19030@gmail.com\n\nOur support team will assist you with your order!"
6. For order placement - Guide them to say things like "order my lunch" or "get me dinner" if they have saved wishlists
7. Keep responses concise, friendly, and helpful. Use emojis appropriately.
8. NEVER make up phone numbers or contact information. ALWAYS use: 9729024316 and bharatkumar19030@gmail.com

User message: "${message}"

Respond naturally and helpfully:`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }]
    };

    let attempts = 0;
    const maxAttempts = GEMINI_API_KEYS.length * 2; // Allow retries with each key
    let aiResponse = '';

    console.log(`🚀 Starting chat request. Available API keys: ${GEMINI_API_KEYS.length}, Max attempts: ${maxAttempts}`);
    
    if (GEMINI_API_KEYS.length === 0) {
      console.error('❌ No Gemini API keys configured');
      return res.status(500).json({
        success: false,
        message: 'AI assistant is not available. Please contact support.'
      });
    }

    console.log('🔑 Current API key index:', currentKeyIndex);

    while (attempts < maxAttempts) {
      try {
        const apiUrl = getGeminiApiUrl();
        console.log(`🔑 Attempt ${attempts + 1}/${maxAttempts}: Using API key ${currentKeyIndex + 1} of ${GEMINI_API_KEYS.length}`);
        
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        console.log(`📡 Gemini API response status: ${response.status}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`❌ API key ${currentKeyIndex + 1} failed:`, response.status);
          
          if (response.status === 429 || response.status === 403 || response.status === 400) {
            console.log(`⚠️ Rate limit/Auth/Bad request error on key ${currentKeyIndex + 1}`);
            attempts++;
            
            if (attempts < maxAttempts && switchToNextKey()) {
              console.log(`🔄 Switched to API key ${currentKeyIndex + 1}, retrying...`);
              continue;
            } else {
              console.log('❌ No more API keys available or max attempts reached');
              throw new Error(`All API keys exhausted: ${response.status}`);
            }
          }
          attempts++;
          throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log(`✅ Success with API key ${currentKeyIndex + 1}`);
        console.log('📦 Raw Gemini response:', JSON.stringify(data, null, 2));
        aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, I could not process that request.';
        console.log('🤖 Extracted AI Response:', aiResponse.substring(0, 200) + (aiResponse.length > 200 ? '...' : ''));
        break;

      } catch (error) {
        console.error(`❌ Attempt ${attempts + 1} failed:`, error.message);
        attempts++;
        
        if ((error.message.includes('429') || error.message.includes('403') || error.message.includes('400')) && attempts < maxAttempts) {
          if (switchToNextKey()) {
            console.log(`🔄 Error caught, switched to key ${currentKeyIndex + 1}, retrying...`);
            continue;
          }
        }
        
        // Set fallback response on final attempt
        if (attempts >= maxAttempts) {
          console.log('❌ All retry attempts exhausted');
          aiResponse = 'Sorry, the AI assistant is currently experiencing issues. Please try again later or contact support if the problem persists.';
          break;
        }
      }
    }

    console.log('\n📤 Preparing to send response to client');
    console.log('✅ Success: true');
    console.log('📝 Message length:', aiResponse.length);
    console.log('📝 Message preview:', aiResponse.substring(0, 100) + (aiResponse.length > 100 ? '...' : ''));
    
    const responseData = {
      success: true,
      message: aiResponse
    };
    
    console.log('📦 Full response object:', JSON.stringify(responseData, null, 2));
    console.log('=============================================\n');
    
    res.json(responseData);

  } catch (error) {
    console.error('\n❌ ERROR in chat endpoint:', error);
    console.error('📊 Error stack:', error.stack);
    console.log('=============================================\n');
    res.status(500).json({
      success: false,
      message: 'Failed to process chat message'
    });
  }
});

export default router;