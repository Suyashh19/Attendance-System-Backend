/**
 * controllers/leaveController.js
 * Students ask for leave; the subject's faculty approves or rejects it.
 * Approved leave turns the student's missed classes in that period into EXCUSED.
 */

const prisma = require("../config/db");
const {
  cleanNote,
  excuseSessionsForLeave,
  localDay,
  overlaps,
  restoreSessionsForLeave,
  validateLeaveInput,
} = require("../services/leaveService");
const { notifyLeaveRequested, notifyLeaveReviewed } = require("../services/notificationService");

const REVIEW_STATUSES = ["APPROVED", "REJECTED"];
const LIST_LIMIT = 200;

// Notifications are a courtesy: a failed push must never fail the request
const quietly = (promise) => Promise.resolve(promise).catch((err) => console.error("[Leave Notify]", err));

// ─── Student ─────────────────────────────────────────────────────────────────

// POST /api/leaves  { subjectIds, fromDate, toDate, reason }
exports.applyForLeave = async (req, res, next) => {
  try {
    const studentId = req.user.userId;

    const checked = validateLeaveInput(req.body, localDay(new Date()));
    if (checked.error) return res.status(400).json({ error: checked.error });
    const { subjectIds, fromDate, toDate, reason } = checked.value;

    // Only subjects the student has been approved in
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId, subjectId: { in: subjectIds }, status: "APPROVED" },
      include: {
        subject: {
          select: { id: true, name: true, code: true, facultyId: true, faculty: { select: { pushToken: true } } },
        },
      },
    });
    if (enrollments.length !== subjectIds.length) {
      return res.status(400).json({ error: "You can only apply for leave in subjects you are enrolled in" });
    }
    const subjectById = new Map(enrollments.map((e) => [e.subjectId, e.subject]));

    // One request per subject and period: no stacking a second one over the same days
    const existing = await prisma.leaveRequest.findMany({
      where: { studentId, subjectId: { in: subjectIds }, status: { in: ["PENDING", "APPROVED"] } },
    });
    const clash = existing.find((l) => overlaps(l, { fromDate, toDate }));
    if (clash) {
      const name = subjectById.get(clash.subjectId)?.name || "a subject";
      return res.status(409).json({ error: `You already have a leave request for ${name} that overlaps these dates` });
    }

    const leaves = await prisma.$transaction(
      subjectIds.map((subjectId) =>
        prisma.leaveRequest.create({ data: { studentId, subjectId, fromDate, toDate, reason } })
      )
    );

    // One notification per faculty member, naming all of their subjects in the request
    const byFaculty = new Map();
    for (const subject of subjectById.values()) {
      const entry = byFaculty.get(subject.facultyId) || { pushToken: subject.faculty?.pushToken, names: [] };
      entry.names.push(subject.name);
      byFaculty.set(subject.facultyId, entry);
    }
    const student = await prisma.user.findUnique({ where: { id: studentId }, select: { name: true } });
    for (const [facultyId, entry] of byFaculty) {
      quietly(
        notifyLeaveRequested({
          facultyId,
          pushToken: entry.pushToken,
          studentName: student?.name,
          subjectNames: entry.names,
          fromDate,
          toDate,
        })
      );
    }

    res.status(201).json({ message: "Leave request sent", leaves });
  } catch (err) {
    next(err);
  }
};

// GET /api/leaves/mine
exports.getMyLeaves = async (req, res, next) => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: { studentId: req.user.userId },
      include: { subject: { select: { id: true, name: true, code: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
    });
    res.json({ leaves });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/leaves/:id  (withdraw a request that has not been answered yet)
exports.cancelLeave = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const leave = await prisma.leaveRequest.findUnique({ where: { id } });
    if (!leave || leave.studentId !== req.user.userId) {
      return res.status(404).json({ error: "Leave request not found" });
    }
    if (leave.status !== "PENDING") {
      return res.status(400).json({ error: "Only a request that is still waiting can be withdrawn" });
    }

    const updated = await prisma.leaveRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    res.json({ message: "Leave request withdrawn", leave: updated });
  } catch (err) {
    next(err);
  }
};

// ─── Faculty ─────────────────────────────────────────────────────────────────

async function ownedSubject(subjectId, facultyId) {
  return prisma.subject.findFirst({ where: { id: subjectId, facultyId } });
}

// GET /api/leaves/subject/:subjectId
exports.getSubjectLeaves = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    if (!(await ownedSubject(subjectId, req.user.userId))) {
      return res.status(403).json({ error: "Unauthorized for this subject" });
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: { subjectId, status: { in: ["PENDING", "APPROVED", "REJECTED"] } },
      include: { student: { select: { id: true, name: true, rollNo: true, prn: true } } },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
    });

    // Waiting requests first, then the rest newest first
    leaves.sort((a, b) => (a.status === "PENDING" ? 0 : 1) - (b.status === "PENDING" ? 0 : 1));
    res.json({ leaves, pending: leaves.filter((l) => l.status === "PENDING").length });
  } catch (err) {
    next(err);
  }
};

// GET /api/leaves/pending (Faculty: every waiting request across their subjects, oldest first)
exports.getPendingLeaves = async (req, res, next) => {
  try {
    const leaves = await prisma.leaveRequest.findMany({
      where: { status: "PENDING", subject: { facultyId: req.user.userId } },
      include: {
        student: { select: { id: true, name: true, rollNo: true, prn: true } },
        subject: { select: { id: true, name: true, code: true, type: true } },
      },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT,
    });
    res.json({ leaves, pending: leaves.length });
  } catch (err) {
    next(err);
  }
};

// PUT /api/leaves/:id/review  { status: "APPROVED" | "REJECTED", note? }
exports.reviewLeave = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body || {};

    if (!REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status must be APPROVED or REJECTED" });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        subject: { select: { id: true, name: true, facultyId: true } },
        student: { select: { pushToken: true } },
      },
    });
    if (!leave) return res.status(404).json({ error: "Leave request not found" });
    if (leave.subject.facultyId !== req.user.userId) {
      return res.status(403).json({ error: "Unauthorized for this subject" });
    }
    if (leave.status === "CANCELLED") {
      return res.status(400).json({ error: "The student withdrew this request" });
    }
    if (leave.status === status) {
      return res.json({ message: "Already " + status.toLowerCase(), leave, excused: 0, restored: 0 });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id },
      data: { status, reviewNote: cleanNote(note), reviewedAt: new Date() },
    });

    let excused = 0;
    let restored = 0;
    if (status === "APPROVED") excused = await excuseSessionsForLeave(updated);
    else if (leave.status === "APPROVED") restored = await restoreSessionsForLeave(updated);

    quietly(
      notifyLeaveReviewed({
        studentId: leave.studentId,
        pushToken: leave.student?.pushToken,
        status,
        subjectName: leave.subject.name,
        fromDate: leave.fromDate,
        toDate: leave.toDate,
        note: updated.reviewNote,
      })
    );

    res.json({ message: `Leave ${status.toLowerCase()}`, leave: updated, excused, restored });
  } catch (err) {
    next(err);
  }
};

// PUT /api/leaves/subject/:subjectId/approve-all  (every request still waiting)
exports.approveAllLeaves = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const subject = await ownedSubject(subjectId, req.user.userId);
    if (!subject) return res.status(403).json({ error: "Unauthorized for this subject" });

    const pending = await prisma.leaveRequest.findMany({
      where: { subjectId, status: "PENDING" },
      include: { student: { select: { pushToken: true } } },
    });
    if (pending.length === 0) return res.json({ message: "Nothing to approve", approved: 0, excused: 0 });

    await prisma.leaveRequest.updateMany({
      where: { id: { in: pending.map((l) => l.id) }, status: "PENDING" },
      data: { status: "APPROVED", reviewedAt: new Date() },
    });

    let excused = 0;
    for (const leave of pending) {
      excused += await excuseSessionsForLeave(leave);
      quietly(
        notifyLeaveReviewed({
          studentId: leave.studentId,
          pushToken: leave.student?.pushToken,
          status: "APPROVED",
          subjectName: subject.name,
          fromDate: leave.fromDate,
          toDate: leave.toDate,
        })
      );
    }

    res.json({ message: `Approved ${pending.length} request(s)`, approved: pending.length, excused });
  } catch (err) {
    next(err);
  }
};
