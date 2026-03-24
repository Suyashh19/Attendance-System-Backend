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


module.exports = router;
