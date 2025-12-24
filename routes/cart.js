import express from 'express'
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
const router =express.Router();
router.put("/",protect, async(req,res)=>{
    try{
        const {cart}= req.body;
        if(!Array.isArray(cart)){
            return res.status(400).json({
                success:false,
                message:'cart must be an array',
            });
        }
        for(const item of cart){
            if(!item.menuItem||!item.quantity||!item.restaurantId){
                return res.status(400).json({
                    success:false,
                    message:'Each cart item must have menuItem ,quantity and restaurantId',
                });
            }
            if(item.quantity<1){
                return res.status(400).json({
                    success:false,
                    message:'Quantity must be at least 1',
                });
            }
        }
        const user= await User.findByIdAndUpdate(
            req.user.id,
            {cart},
            {new:true, runValidators:true} //new:true to return updated document
        ).populate('cart.menuItem');
        res.status(200).json({
            success:true,
            cart:user.cart,
            message:'Cart updated successfully',
        });
    }catch(error){
        console.log("Update cart error: ",error)
        res.status(500).json({
            success:false,
            message:'Error updating cart',
        });
    }
})
router.get("/",protect,async(req,res)=>{
    try{
        const user=await User.findById(req.user.id)
        .populate({
            path:'cart.menuItem',
            select:'name description price image isVeg category subCategory cuisine isAvailable',
        }).populate({
            path:'cart.restaurantId',
            select:'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address',
        });
        res.status(200).json({
            success:true,
            cart:user.cart,
        });
    }catch(error){
        console.log("Get cart error: ",error)
        res.status(500).json({
            success:false,
            message:'Error getting cart',
        });
    }
})
router.post("/add",protect,async(req,res)=>{
    try{
        const{ menuItem, quantity, restaurantId}=req.body;
        console.log("📝 Add to cart request:", { menuItem, quantity, restaurantId, userId: req.user.id });
        
        if(!menuItem||!quantity||!restaurantId){
            return res.status(400).json({
                success:false,
                message:'menuItem, quantity and restaurantId are required',
            });
        }
        if(quantity<1){
            return res.status(400).json({
                success:false,
                message:'Quantity must be at least 1',
            });
        }
        
        const user=await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }
        
        // Find if item already exists in cart (only check menuItem, not restaurantId)
        const existingItemIndex = user.cart.findIndex(
            item => item.menuItem.toString() === menuItem.toString()
        );
        
        if(existingItemIndex > -1){
            user.cart[existingItemIndex].quantity += quantity;
            console.log('✅ Updated existing cart item quantity');
        } else {
            user.cart.push({menuItem, quantity, restaurantId});
            console.log('✅ Added new item to cart with restaurantId:', restaurantId);
        }
        
        await user.save();
        console.log('✅ Cart saved. Total items:', user.cart.length);
        
        // Populate cart items before sending response
        await user.populate({
            path: 'cart.menuItem',
            select: 'name description price image isVeg category subCategory cuisine isAvailable'
        });
        await user.populate({
            path: 'cart.restaurantId',
            select: 'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address'
        });
        
        console.log('✅ Cart populated. First item restaurantId:', user.cart[0]?.restaurantId);
        
        res.status(200).json({
            success:true,
            cart:user.cart,
            message:'Item added to cart',
        });
    }catch(error){
        console.log("Add to cart error: ",error)
        res.status(500).json({
            success:false,
            message:'Error adding item to cart',
        });
    }
})
router.delete("/remove/:menuItemId",protect,async(req,res)=>{
    try{
        const user=await User.findById(req.user.id);
        user.cart=user.cart.filter(item=>item.menuItem.toString()!==req.params.menuItemId);
        await user.save();
        
        // Populate cart items before sending response
        await user.populate({
            path: 'cart.menuItem',
            select: 'name description price image isVeg category subCategory cuisine isAvailable'
        });
        await user.populate({
            path: 'cart.restaurantId',
            select: 'restaurantDetails.kitchenName restaurantDetails.isKitchenOpen restaurantDetails.address'
        });
        
        res.status(200).json({
            success:true,
            cart:user.cart,
            message:'Item removed from cart',
        });
    }catch(error){
        console.log("Remove from cart error: ",error)
        res.status(500).json({
            success:false,
            message:'Error removing item from cart',    
        });
    }
})
router.delete('/clear',protect,async(req,res)=>{
    try{
        const user=await User.findById(req.user.id);
        user.cart = [];
            await user.save();
        res.status(200).json({
            success:true,
            cart:user.cart,
            message:'Cart cleared successfully',
        });
    }catch(error){
        console.log("Clear cart error: ",error)
        res.status(500).json({
            success:false,
            message:'Error clearing cart',
        });
    }
})
export default router
