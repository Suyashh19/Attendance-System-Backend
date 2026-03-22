/**
 * roleMiddleware.js
 * Factory function that returns a middleware guarding routes by user role.
 *
 * Usage:
 *   router.post("/start", authMiddleware, requireRole("faculty"), sessionController.startSession);
 */

/**
 * @param {...string} roles - Allowed roles (e.g. "faculty", "student")
 * @returns {import("express").RequestHandler}
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized: No user context" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Requires one of [${roles.join(", ")}] role`,
      });
    }
    next();
  };
};

module.exports = { requireRole };
