const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { requireRole } = require("../middleware/roleMiddleware");
const leaveController = require("../controllers/leaveController");

router.use(authMiddleware);

// POST /api/leaves (Student asks for leave in one or more subjects)
router.post("/", requireRole("student"), leaveController.applyForLeave);

// GET /api/leaves/mine (Student's own requests)
router.get("/mine", requireRole("student"), leaveController.getMyLeaves);

// DELETE /api/leaves/:id (Student withdraws a request that is still waiting)
router.delete("/:id", requireRole("student"), leaveController.cancelLeave);

// GET /api/leaves/pending (Faculty: waiting requests across all their subjects)
router.get("/pending", requireRole("faculty"), leaveController.getPendingLeaves);

// GET /api/leaves/subject/:subjectId (Faculty: the subject's requests, waiting ones first)
router.get("/subject/:subjectId", requireRole("faculty"), leaveController.getSubjectLeaves);

// PUT /api/leaves/subject/:subjectId/approve-all (Faculty: every request still waiting)
router.put("/subject/:subjectId/approve-all", requireRole("faculty"), leaveController.approveAllLeaves);

// PUT /api/leaves/:id/review (Faculty approves or rejects one request)
router.put("/:id/review", requireRole("faculty"), leaveController.reviewLeave);

module.exports = router;
