const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateSubmitAttendance } = require("../middleware/validationMiddleware");
const attendanceController = require("../controllers/attendanceController");

router.use(authMiddleware);

// POST /api/attendance/submit (Student only)
router.post(
  "/submit",
  requireRole("student"),
  validateSubmitAttendance,
  attendanceController.submitAttendance
);

// GET /api/attendance/subject/:subjectId/analytics (Faculty only)
router.get(
  "/subject/:subjectId/analytics",
  requireRole("faculty"),
  attendanceController.getSubjectAnalytics
);

// GET /api/attendance/session/:sessionId (Faculty only)
router.get(
  "/session/:sessionId",
  requireRole("faculty"),
  attendanceController.getSessionAttendance
);

// GET /api/attendance/subject/:subjectId/my-record (Student only)
router.get(
  "/subject/:subjectId/my-record",
  requireRole("student"),
  attendanceController.getMyRecord
);

// GET /api/attendance/history (Student only)
router.get(
  "/history",
  requireRole("student"),
  attendanceController.getAttendanceHistory
);

// DELETE /api/attendance/subject/:subjectId (Student only)
router.delete(
  "/subject/:subjectId",
  requireRole("student"),
  attendanceController.deleteSubjectHistory
);

// PUT /api/attendance/session/:sessionId/student/:studentId (Faculty only)
router.put(
  "/session/:sessionId/student/:studentId",
  requireRole("faculty"),
  attendanceController.editAttendance
);

module.exports = router;
