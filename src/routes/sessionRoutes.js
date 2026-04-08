const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateStartSession } = require("../middleware/validationMiddleware");
const sessionController = require("../controllers/sessionController");

router.use(authMiddleware);

// POST /api/sessions/start
router.post(
  "/start",
  requireRole("faculty"),
  validateStartSession,
  sessionController.startSession
);

// POST /api/sessions/:sessionId/end
router.post(
  "/:sessionId/end",
  requireRole("faculty"),
  sessionController.endSession
);

// GET /api/sessions/recent (Faculty Only)
router.get(
  "/recent",
  requireRole("faculty"),
  sessionController.getRecentSessions
);

// GET /api/sessions/:subjectId/history
router.get(
  "/:subjectId/history",
  requireRole("faculty", "student"), // mostly faculty, but maybe students can view history
  sessionController.getSessionHistory
);

// GET /api/sessions/:subjectId/active
router.get(
  "/:subjectId/active",
  sessionController.getActiveSession
);

module.exports = router;
