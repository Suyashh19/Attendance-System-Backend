/**
 * errorMiddleware.js
 * Global Express error handler. Must be registered LAST in app.js.
 *
 * Usage:  app.use(errorMiddleware);
 */

const errorMiddleware = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message || err);

  const isPrismaError = typeof err.code === "string" && /^P\d{4}$/.test(err.code);
  const isBadJson = err.type === "entity.parse.failed";

  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";

  // Detailed logging for Prisma errors; the client only gets a generic message
  if (isPrismaError) {
    console.error(`[PRISMA ERROR] Code: ${err.code}, Meta:`, err.meta);
    statusCode = err.code === "P2025" ? 404 : 500;
    message = err.code === "P2025" ? "Record not found" : "Something went wrong. Please try again.";
  } else if (isBadJson) {
    statusCode = 400;
    message = "Invalid request body";
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === "development" && { 
      stack: err.stack,
      details: err.details,
      code: err.code,
      meta: err.meta
    }),
  });
};

// Helper to create structured errors with a status code
const createError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

module.exports = { errorMiddleware, createError };
