/**
 * controllers/enrollmentController.js
 */

const prisma = require("../config/db");

// Faculty enrolls a student (via numeric IDs)
exports.enrollStudent = async (req, res, next) => {
  try {
    const { subjectId, studentId } = req.body;
    const existing = await prisma.enrollment.findFirst({
      where: { subjectId: Number(subjectId), studentId: Number(studentId) },
    });
    if (existing) {
      return res.status(400).json({ error: "Student is already enrolled in this subject" });
    }
    const enrollment = await prisma.enrollment.create({
      data: { subjectId: Number(subjectId), studentId: Number(studentId) },
    });
    res.status(201).json({ message: "Enrollment successful", enrollment });
  } catch (err) {
    next(err);
  }
};

// Student enrolls via Subject Code (e.g. "CS101")
exports.enrollByCode = async (req, res, next) => {
  try {
    const { subjectCode } = req.body;
    const studentId = req.user.userId;

    const subject = await prisma.subject.findUnique({
      where: { code: subjectCode },
    });

    if (!subject) {
      return res.status(404).json({ error: "Subject not found with this code" });
    }

    const existing = await prisma.enrollment.findFirst({
      where: { subjectId: subject.id, studentId },
    });

    if (existing) {
      return res.status(400).json({ error: "You are already enrolled in this subject" });
    }

    const enrollment = await prisma.enrollment.create({
      data: { subjectId: subject.id, studentId },
    });

    res.status(201).json({ message: "Enrolled successfully", subjectName: subject.name });
  } catch (err) {
    next(err);
  }
};

// Get all enrolled students for a specific subject (Faculty only)
exports.getSubjectEnrollments = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);

    const enrollments = await prisma.enrollment.findMany({
      where: { subjectId },
      include: {
        student: { select: { id: true, name: true, rollNo: true, email: true } },
      },
    });

    res.json({
      subjectId,
      students: enrollments.map((e) => e.student),
    });
  } catch (err) {
    next(err);
  }
};
