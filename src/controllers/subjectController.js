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
