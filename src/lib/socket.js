import { Server } from "socket.io";
import http from "http";
import express from "express";
import Message from "../models/message.model.js";
import { setupWebRTCHandlers } from "./webrtc.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"],
    // origin: ["*"],
  },
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

// used to store online users
const userSocketMap = {}; // {userId: socketId}

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;
  if (userId) userSocketMap[userId] = socket.id;

  // io.emit() is used to send events to all the connected clients
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // When a user connects, update all their unread messages to "delivered"
  if (userId) {
    updateMessagesToDelivered(userId);
  }
  
  // Set up WebRTC handlers for this socket
  setupWebRTCHandlers(socket);

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    delete userSocketMap[userId];
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
  
  // Handle message read event
  socket.on("markMessagesAsSeen", async ({ senderId, receiverId }) => {
    try {
      console.log(`Marking messages as seen from ${senderId} to ${receiverId}`);
      
      // Find all messages that need to be updated
      const messagesToUpdate = await Message.find({
        senderId, 
        receiverId, 
        status: { $ne: "seen" }
      });
      
      // Update messages from sender to receiver as seen
      await Message.updateMany(
        { senderId, receiverId, status: { $ne: "seen" } },
        { status: "seen" }
      );
      
      console.log(`Updated ${messagesToUpdate.length} messages to seen status`);
      
      // Broadcast to ALL clients that these messages have been seen
      io.emit("messagesSeen", { 
        senderId, 
        receiverId,
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
      
      // Import the function dynamically to avoid circular dependency
      const { updateAndBroadcastUnreadCounts } = await import('../controllers/message.controller.js');
      
      // Update and broadcast unread counts for the receiver
      // This ensures the unread count badge is updated in real-time
      if (messagesToUpdate.length > 0) {
        await updateAndBroadcastUnreadCounts(receiverId);
      }
    } catch (error) {
      console.error("Error marking messages as seen:", error);
    }
  });
});

// Helper function to update messages to delivered when a user comes online
async function updateMessagesToDelivered(userId) {
  try {
    // Find all messages sent to this user that are still in "sent" status
    const messagesToUpdate = await Message.find({
      receiverId: userId,
      status: "sent"
    });
    
    // Update status to delivered
    await Message.updateMany(
      { receiverId: userId, status: "sent" },
      { status: "delivered" }
    );
    
    // Notify senders that their messages were delivered
    for (const message of messagesToUpdate) {
      const senderSocketId = getReceiverSocketId(message.senderId.toString());
      if (senderSocketId) {
        io.to(senderSocketId).emit("messageDelivered", message);
      }
      
      // Also broadcast to all clients to ensure everyone's UI is updated
      io.emit("messageDelivered", message);
    }
  } catch (error) {
    console.error("Error updating messages to delivered:", error);
  }
}

export { io, app, server };
