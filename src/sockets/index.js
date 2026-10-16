/**
 * sockets/index.js
 * Main entry point for Socket.IO event delegation and middleware.
 */

const jwt = require("jsonwebtoken");
const { isAllowedToken } = require("../middleware/platformMiddleware");
const { joinUserPrivateRoom } = require("./rooms");
const { registerAttendanceHandlers } = require("./attendanceSocket");

/**
 * Authenticate and initialize a new socket connection.
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function registerSocketHandlers(io, socket) {
  // 1. Authenticate via token passed in handshake auth or query
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    console.warn(`[Socket ${socket.id}] No token provided, disconnecting...`);
    return socket.disconnect(true);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    console.error(`[Socket ${socket.id}] Invalid token, disconnecting...`);
    return socket.disconnect(true);
  }

  // Judged by the token, not the Origin header: React Native's WebSocket sends an Origin too
  if (!isAllowedToken(decoded)) {
    console.warn(`[Socket ${socket.id}] Web token for a non-faculty account, disconnecting...`);
    return socket.disconnect(true);
  }
  socket.user = decoded; // { userId, role, platform, ... }

  // 2. Automatically join the user's private notification room
  joinUserPrivateRoom(socket);

  // 3. Register feature-specific handlers
  registerAttendanceHandlers(io, socket);
}

module.exports = { registerSocketHandlers };
