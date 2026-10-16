/**
 * config/cors.js
 * Browser origins allowed to call the API, shared by REST and Socket.IO.
 *
 * Set FRONTEND_URL to the web app's URL (several may be comma-separated).
 * CORS only governs browsers: the mobile app is unaffected either way.
 */

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn("[CORS] FRONTEND_URL is not set; allowing every origin");
}

const corsOrigin = allowedOrigins.length > 0 ? allowedOrigins : "*";

module.exports = { corsOrigin };
