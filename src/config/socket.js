/**
 * config/socket.js
 *
 * Socket.IO singleton.
 *
 * Usage:
 *   // In server.js (once, at startup):
 *   const { initSocket } = require("./src/config/socket");
 *   initSocket(httpServer);
 *
 *   // Anywhere else:
 *   const { getIO } = require("./src/config/socket");
 *   getIO().emit("event", data);
 */

const { Server } = require("socket.io");

let io = null;

/**
 * Initialize the Socket.IO server.
 * Must be called once in server.js after creating the HTTP server.
 * @param {import("http").Server} httpServer
 * @returns {import("socket.io").Server}
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // lock this down in production
      methods: ["GET", "POST"],
    },
  });

  // Attach connection handlers
  const { registerSocketHandlers } = require("../sockets");
  io.on("connection", (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);
    registerSocketHandlers(io, socket);

    socket.on("disconnect", () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
    });
  });

  console.log("[Socket.IO] Server initialized");
  return io;
}

/**
 * Get the Socket.IO instance (after initSocket has been called).
 * @returns {import("socket.io").Server}
 */
function getIO() {
  if (!io) throw new Error("Socket.IO has not been initialized. Call initSocket(server) first.");
  return io;
}

module.exports = { initSocket, getIO };
