const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateEnrollment } = require("../middleware/validationMiddleware");
const enrollmentController = require("../controllers/enrollmentController");

router.use(authMiddleware);

// POST /api/enrollments
router.post(
  "/",
  requireRole("faculty"), // or allow students depending on use case
  validateEnrollment,
  enrollmentController.enrollStudent
);

// GET /api/enrollments/:subjectId
router.get(
  "/:subjectId",
  requireRole("faculty"),
  enrollmentController.getSubjectEnrollments
);

module.exports = router;
