/**
 * sockets/index.js
 * Main entry point for Socket.IO event delegation and middleware.
 */

const jwt = require("jsonwebtoken");
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

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // { userId, role, ... }
  } catch (err) {
    console.error(`[Socket ${socket.id}] Invalid token, disconnecting...`);
    return socket.disconnect(true);
  }

  // 2. Automatically join the user's private notification room
  joinUserPrivateRoom(socket);

  // 3. Register feature-specific handlers
  registerAttendanceHandlers(io, socket);
}

module.exports = { registerSocketHandlers };
