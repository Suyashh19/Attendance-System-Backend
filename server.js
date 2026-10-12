require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const { initSocket } = require("./src/config/socket");

// Create standard HTTP server wrapping Express
const server = http.createServer(app);

// Initialize Socket.IO on top of the HTTP server
initSocket(server);

// Server Port
const PORT = process.env.PORT || 5000;

// Start Server using the wrapped `server` rather than `app`
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Ready for REST and Socket.IO connections`);

  // Sessions left open by a restart are closed (or re-armed) here
  const { closeStaleSessions } = require("./src/services/sessionLifecycle");
  closeStaleSessions().catch((err) => console.error("[Session Close] Startup sweep failed:", err));
});