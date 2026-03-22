const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const { validateCreateSubject } = require("../middleware/validationMiddleware");
const subjectController = require("../controllers/subjectController");

router.use(authMiddleware); // All subject routes require auth

// GET /api/subjects
router.get("/", subjectController.getSubjects);

// POST /api/subjects
router.post(
  "/",
  requireRole("faculty"),
  validateCreateSubject,
  subjectController.createSubject
);

module.exports = router;
