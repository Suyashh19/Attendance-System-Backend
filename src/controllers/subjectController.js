/**
 * controllers/subjectController.js
 */

const prisma = require("../config/db");

exports.createSubject = async (req, res, next) => {
  try {
    const { name, code, type } = req.body;
    const facultyId = req.user.userId;

    const existing = await prisma.subject.findUnique({ where: { code } });
    if (existing) {
      return res.status(400).json({ error: "Subject code already exists" });
    }

    const subject = await prisma.subject.create({
      data: { 
        name, 
        code, 
        facultyId,
        type: type || "theory"
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
