/**
 * errorMiddleware.js
 * Global Express error handler. Must be registered LAST in app.js.
 *
 * Usage:  app.use(errorMiddleware);
 */

const errorMiddleware = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message || err);

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "Internal Server Error";

  // Detailed logging for Prisma errors
  if (err.code) {
    console.error(`[PRISMA ERROR] Code: ${err.code}, Meta:`, err.meta);
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
