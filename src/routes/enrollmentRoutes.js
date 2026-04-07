const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateEnrollment, validateEnrollByCode } = require("../middleware/validationMiddleware");
const enrollmentController = require("../controllers/enrollmentController");

router.use(authMiddleware);

// POST /api/enrollments/ (Faculty only)
router.post(
  "/",
  requireRole("faculty"),
  validateEnrollment,
  enrollmentController.enrollStudent
);

// POST /api/enrollments/enroll (Student joins by code)
router.post(
  "/enroll",
  requireRole("student"),
  validateEnrollByCode,
  enrollmentController.enrollByCode
);

// GET /api/enrollments/:subjectId
router.get(
  "/:subjectId",
  requireRole("faculty"),
  enrollmentController.getSubjectEnrollments
);

// DELETE /api/enrollments/:subjectId/unenroll
router.delete(
  "/:subjectId/unenroll",
  requireRole("student"),
  enrollmentController.unenrollSubject
);

// PUT /api/enrollments/subject/:subjectId/student/:studentId/status
router.put(
  "/subject/:subjectId/student/:studentId/status",
  requireRole("faculty"),
  enrollmentController.updateEnrollmentStatus
);

module.exports = router;
