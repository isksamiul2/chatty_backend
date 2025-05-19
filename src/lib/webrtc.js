// WebRTC socket handlers
import { io } from "./socket.js";

// Map to store WebRTC user socket IDs
const webRTCUsers = new Map();

export const setupWebRTCHandlers = (socket) => {
  // Register user for WebRTC
  socket.on('webrtc-register', (data) => {
    const { userId } = data;
    webRTCUsers.set(userId, socket.id);
    console.log(`User ${userId} registered for WebRTC with socket ID ${socket.id}`);
  });
  
  // Handle call initiation
  socket.on('webrtc-start-call', (data) => {
    const { to, from, callType } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-incoming-call', {
        from,
        callType
      });
      console.log(`Call initiated from ${from} to ${to} (${callType})`);
    } else {
      // User is offline
      socket.emit('webrtc-user-unavailable', { userId: to });
    }
  });
  
  // Handle call acceptance
  socket.on('webrtc-call-accepted', (data) => {
    const { to } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-call-accepted', {});
      console.log(`Call accepted by ${socket.id} for user ${to}`);
    }
  });
  
  // Handle call rejection
  socket.on('webrtc-call-rejected', (data) => {
    const { to } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-call-rejected', {});
      console.log(`Call rejected by ${socket.id} for user ${to}`);
    }
  });
  
  // Handle call end
  socket.on('webrtc-call-ended', (data) => {
    const { to } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-call-ended', {});
      console.log(`Call ended by ${socket.id} for user ${to}`);
    }
  });
  
  // Handle ICE candidates
  socket.on('webrtc-ice-candidate', (data) => {
    const { to, candidate } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-ice-candidate', { candidate });
    }
  });
  
  // Handle session descriptions (SDP)
  socket.on('webrtc-session-description', (data) => {
    const { to, sdp } = data;
    const toSocketId = webRTCUsers.get(to);
    
    if (toSocketId) {
      io.to(toSocketId).emit('webrtc-session-description', { sdp });
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    // Remove user from WebRTC users map
    for (const [userId, socketId] of webRTCUsers.entries()) {
      if (socketId === socket.id) {
        webRTCUsers.delete(userId);
        console.log(`User ${userId} unregistered from WebRTC`);
        break;
      }
    }
  });
};

// Get WebRTC socket ID for a user
export const getWebRTCSocketId = (userId) => {
  return webRTCUsers.get(userId);
};