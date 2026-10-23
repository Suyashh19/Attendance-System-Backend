/**
 * controllers/subjectController.js
 */

const prisma = require("../config/db");

const SUBJECT_TYPES = ["theory", "practical"];
const MAX_NAME_LENGTH = 100;
const MAX_CODE_LENGTH = 20;
const MAX_SPAN_LENGTH = 40;

// The optional semester / academic-year label. undefined = not sent, null = cleared.
function cleanSpan(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed.slice(0, MAX_SPAN_LENGTH);
}

exports.createSubject = async (req, res, next) => {
  try {
    const { name, code, type } = req.body;
    const facultyId = req.user.userId;

    const normalizedCode = code.trim().toUpperCase();
    const normalizedType = (type || "theory").toLowerCase();

    if (!SUBJECT_TYPES.includes(normalizedType)) {
      return res.status(400).json({ error: "Type must be theory or practical" });
    }

    const existing = await prisma.subject.findFirst({
      where: { code: normalizedCode, type: normalizedType }
    });
    if (existing) {
      return res.status(400).json({ error: "Self-same subject (code + type) already exists" });
    }

    const subject = await prisma.subject.create({
      data: {
        name,
        code: normalizedCode,
        facultyId,
        type: normalizedType,
        span: cleanSpan(req.body.span) ?? null,
      },
    });

    res.status(201).json({ message: "Subject created successfully", subject });
  } catch (err) {
    next(err);
  }
};

// Faculty: change a subject's name, code, type or semester label (send only what changes)
exports.updateSubject = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.id);
    const facultyId = req.user.userId;

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (subject.facultyId !== facultyId) {
      return res.status(403).json({ error: "You do not have permission to edit this subject" });
    }

    const body = req.body || {};
    const data = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) {
        return res.status(400).json({ error: "Subject name cannot be empty" });
      }
      data.name = body.name.trim().slice(0, MAX_NAME_LENGTH);
    }

    if (body.code !== undefined) {
      if (typeof body.code !== "string" || !body.code.trim()) {
        return res.status(400).json({ error: "Subject code cannot be empty" });
      }
      data.code = body.code.trim().toUpperCase().slice(0, MAX_CODE_LENGTH);
    }

    if (body.type !== undefined) {
      const type = typeof body.type === "string" ? body.type.toLowerCase() : "";
      if (!SUBJECT_TYPES.includes(type)) {
        return res.status(400).json({ error: "Type must be theory or practical" });
      }
      data.type = type;
    }

    const span = cleanSpan(body.span);
    if (span !== undefined) data.span = span;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // (code + type) is unique across the app, so a clash with another subject is refused
    const nextCode = data.code ?? subject.code;
    const nextType = data.type ?? subject.type;
    if (nextCode !== subject.code || nextType !== subject.type) {
      const clash = await prisma.subject.findFirst({
        where: { code: nextCode, type: nextType, id: { not: subjectId } },
      });
      if (clash) {
        return res.status(400).json({ error: "Self-same subject (code + type) already exists" });
      }
    }

    const updated = await prisma.subject.update({ where: { id: subjectId }, data });
    res.json({ message: "Subject updated successfully", subject: updated });
  } catch (err) {
    next(err);
  }
};

// Faculty: how much data a subject holds, shown before it is deleted
exports.getSubjectSummary = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.id);
    const facultyId = req.user.userId;

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) return res.status(404).json({ error: "Subject not found" });
    if (subject.facultyId !== facultyId) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    const [lectures, records, students] = await Promise.all([
      prisma.session.count({ where: { subjectId } }),
      prisma.attendance.count({ where: { session: { subjectId } } }),
      prisma.enrollment.count({ where: { subjectId } }),
    ]);

    res.json({ subjectId, lectures, records, students });
  } catch (err) {
    next(err);
  }
};

exports.getSubjects = async (req, res, next) => {
  try {
    const { role, userId } = req.user;
    let subjects = [];

    if (role === "faculty") {
      subjects = await prisma.subject.findMany({
        where: { facultyId: Number(userId) },
        include: { _count: { select: { enrollments: true } } },
      });
    } else {
      // Student: return subjects they are enrolled in, including their enrollment status
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: Number(userId) },
        include: { subject: { include: { faculty: { select: { name: true } } } } },
      });

      // Map to subjects but attach the enrollment status to each one
      subjects = enrollments
        .filter(e => e.subject) // Safety check: skip if subject was deleted
        .map((e) => ({
          ...e.subject,
          enrollmentStatus: e.status, // "PENDING", "APPROVED", etc.
        }));
    }

    res.json({ subjects });
  } catch (err) {
    next(err);
  }
};

exports.deleteSubject = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.id);
    const facultyId = req.user.userId;

    const subject = await prisma.subject.findUnique({
      where: { id: subjectId },
    });

    if (!subject) {
      return res.status(404).json({ error: "Subject not found" });
    }
    if (subject.facultyId !== facultyId) {
      return res.status(403).json({ error: "You do not have permission to delete this subject" });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Delete all attendances for sessions under this subject
      await tx.attendance.deleteMany({
        where: { session: { subjectId } },
      });

      // 2. Delete all sessions under this subject
      await tx.session.deleteMany({
        where: { subjectId },
      });

      // 3. Delete all enrollments under this subject
      await tx.enrollment.deleteMany({
        where: { subjectId },
      });

      // 4. Delete the subject itself
      await tx.subject.delete({
        where: { id: subjectId },
      });
    });

    res.json({ message: "Subject permanently deleted" });
  } catch (err) {
    next(err);
  }
};

exports.cleanSpan = cleanSpan;
