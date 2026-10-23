const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateCreateSubject, validateUpdateSubject } = require("../middleware/validationMiddleware");
const subjectController = require("../controllers/subjectController");

router.use(authMiddleware); // All subject routes require auth

// GET /api/subjects
router.get("/", subjectController.getSubjects);

// GET /api/subjects/my (Explicit alias for frontend)
router.get("/my", subjectController.getSubjects);

// POST /api/subjects
router.post(
  "/",
  requireRole("faculty"),
  validateCreateSubject,
  subjectController.createSubject
);

// GET /api/subjects/:id/summary (what a delete would remove)
router.get(
  "/:id/summary",
  requireRole("faculty"),
  subjectController.getSubjectSummary
);

// PUT /api/subjects/:id
router.put(
  "/:id",
  requireRole("faculty"),
  validateUpdateSubject,
  subjectController.updateSubject
);

// DELETE /api/subjects/:id
router.delete(
  "/:id",
  requireRole("faculty"),
  subjectController.deleteSubject
);

module.exports = router;
