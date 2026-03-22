/**
 * controllers/enrollmentController.js
 */

const prisma = require("../config/db");

// Faculty enrolls a student or Student enrolls via some open endpoint
exports.enrollStudent = async (req, res, next) => {
  try {
    const { subjectId, studentId } = req.body;

    const existing = await prisma.enrollment.findFirst({
      where: { subjectId, studentId },
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
