/**
 * controllers/subjectController.js
 */

const prisma = require("../config/db");

exports.createSubject = async (req, res, next) => {
  try {
    const { name, code, type } = req.body;
    const facultyId = req.user.userId;

    const normalizedCode = code.trim().toUpperCase();
    const normalizedType = (type || "theory").toLowerCase();

    const existing = await prisma.subject.findFirst({ 
      where: { code: normalizedCode, type: normalizedType } 
    });
    if (existing) {
      return res.status(400).json({ error: "Self-same subject (code + type) already exists" });
    }

    console.log(`[DEBUG] createSubject called for faculty ${facultyId}:`, { name, code: normalizedCode, type: normalizedType });
    
    const subject = await prisma.subject.create({
      data: { 
        name, 
        code: normalizedCode, 
        facultyId,
        type: normalizedType
      },
    });

    res.status(201).json({ message: "Subject created successfully", subject });
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
        where: { facultyId: userId },
        include: { _count: { select: { enrollments: true } } },
      });
    } else {
      // Student: return subjects they are enrolled in
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: userId },
        include: { subject: { include: { faculty: { select: { name: true } } } } },
      });
      subjects = enrollments.map((e) => e.subject);
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
