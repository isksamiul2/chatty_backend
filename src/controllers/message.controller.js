import User from "../models/user.model.js";
import Message from "../models/message.model.js";

import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

export const getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const filteredUsers = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");

    res.status(200).json(filteredUsers);
  } catch (error) {
    console.error("Error in getUsersForSidebar: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const myId = req.user._id;

    const messages = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    });

    // Find messages that need to be updated
    const messagesToUpdate = await Message.find({
      senderId: userToChatId, 
      receiverId: myId, 
      status: { $ne: "seen" }
    });
    
    console.log(`Found ${messagesToUpdate.length} messages to mark as seen`);
    
    // Update status of received messages to "seen"
    await Message.updateMany(
      { senderId: userToChatId, receiverId: myId, status: { $ne: "seen" } },
      { status: "seen" }
    );

    // Broadcast to ALL clients that these messages have been seen
    io.emit("messagesSeen", { 
      senderId: userToChatId, 
      receiverId: myId,
      timestamp: new Date().toISOString() // Add timestamp to force update
    });
    
    // Also send individual updates for each message
    for (const message of messagesToUpdate) {
      io.emit("messageStatusUpdated", { 
        messageId: message._id.toString(), 
        status: "seen",
        timestamp: new Date().toISOString() // Add timestamp to force update
      });
    }
    
    // Update and broadcast unread counts for the current user
    // This ensures the unread count badge is updated in real-time
    if (messagesToUpdate.length > 0) {
      await updateAndBroadcastUnreadCounts(myId);
    }

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendMessage = async (req, res) => {
  try {
    const { text, image, audio } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let imageUrl;
    let audioUrl;
    
    if (image) {
      // Upload base64 image to cloudinary
      const uploadResponse = await cloudinary.uploader.upload(image);
      imageUrl = uploadResponse.secure_url;
    }
    
    if (audio) {
      // Upload base64 audio to cloudinary
      const uploadResponse = await cloudinary.uploader.upload(audio, {
        resource_type: "auto",
        folder: "voice_messages"
      });
      audioUrl = uploadResponse.secure_url;
    }

    const newMessage = new Message({
      senderId,
      receiverId,
      text,
      image: imageUrl,
      audio: audioUrl,
      status: "sent"
    });

    await newMessage.save();

    const receiverSocketId = getReceiverSocketId(receiverId);
    
    // Broadcast to all clients once - this will reach both the receiver and everyone else
    // This ensures unread counts are updated and the message appears in all relevant UIs
    io.emit("newMessage", newMessage);
    
    // Update unread counts for the receiver and broadcast them
    await updateAndBroadcastUnreadCounts(receiverId);
    
    if (receiverSocketId) {
      // Update message status to delivered since receiver is online
      newMessage.status = "delivered";
      await newMessage.save();
      
      // Broadcast the delivery status update to all clients
      io.emit("messageDelivered", newMessage);
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Add a new endpoint to update message status
export const updateMessageStatus = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { status } = req.body;
    
    if (!["sent", "delivered", "seen"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    
    const message = await Message.findById(messageId);
    
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    message.status = status;
    await message.save();
    
    // Notify sender about status change
    const senderSocketId = getReceiverSocketId(message.senderId.toString());
    if (senderSocketId) {
      io.to(senderSocketId).emit("messageStatusUpdated", { messageId, status });
    }
    
    // Also broadcast to all clients to ensure everyone's UI is updated
    io.emit("messageStatusUpdated", { messageId, status });
    
    res.status(200).json(message);
  } catch (error) {
    console.log("Error in updateMessageStatus controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Helper function to calculate unread counts for a user
async function calculateUnreadCounts(userId) {
  try {
    // Find all messages sent to the user that haven't been seen
    const unreadMessages = await Message.find({
      receiverId: userId,
      status: { $ne: "seen" }
    });
    
    // Count messages by sender
    const unreadCounts = {};
    
    unreadMessages.forEach(message => {
      const senderId = message.senderId.toString();
      if (!unreadCounts[senderId]) {
        unreadCounts[senderId] = 0;
      }
      unreadCounts[senderId]++;
    });
    
    return unreadCounts;
  } catch (error) {
    console.error("Error calculating unread counts:", error);
    return {};
  }
}

// Helper function to update and broadcast unread counts for a user
export async function updateAndBroadcastUnreadCounts(userId) {
  try {
    const unreadCounts = await calculateUnreadCounts(userId);
    
    // Get the socket ID for the user
    const userSocketId = getReceiverSocketId(userId);
    
    // If the user is online, send them their updated unread counts
    if (userSocketId) {
      io.to(userSocketId).emit("unreadCountsUpdated", unreadCounts);
    }
    
    return unreadCounts;
  } catch (error) {
    console.error("Error updating and broadcasting unread counts:", error);
    return {};
  }
}

// Get unread message counts for the current user
export const getUnreadCounts = async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Use the helper function to calculate unread counts
    const unreadCounts = await calculateUnreadCounts(userId);
    
    res.status(200).json(unreadCounts);
  } catch (error) {
    console.log("Error in getUnreadCounts controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
