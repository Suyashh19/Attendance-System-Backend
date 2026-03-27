/**
 * routes/analyticsRoutes.js
 */

const express = require("express");
const router = express.Router();
const analyticsController = require("../controllers/analyticsController");
const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");

router.use(authMiddleware);

// GET /api/analytics/export/:subjectId
router.get(
  "/export/:subjectId",
  requireRole("faculty"),
  analyticsController.exportAttendance
);

module.exports = router;
