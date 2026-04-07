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
      data: { subjectId: Number(subjectId), studentId: Number(studentId), status: "APPROVED" },
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
    const normalizedCode = subjectCode.trim().toUpperCase();

    const subjects = await prisma.subject.findMany({
      where: { code: normalizedCode },
    });
    
    if (subjects.length === 0) {
      return res.status(404).json({ error: "No subject found with this code" });
    }

    // Enroll in all matching subjects (Theory, Practical, etc.)
    const results = await Promise.all(subjects.map(async (subj) => {
      const existing = await prisma.enrollment.findFirst({
        where: { subjectId: subj.id, studentId },
      });
      
      if (!existing) {
        return prisma.enrollment.create({
          data: { subjectId: subj.id, studentId },
        });
      }
      return null;
    }));

    const enrolledCount = results.filter(r => !!r).length;
    
    res.status(201).json({ 
      message: enrolledCount > 0 ? `Successfully enrolled in ${enrolledCount} subject(s)` : "You are already enrolled in all matching classes",
      subjects: subjects.map(s => s.name)
    });
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
      students: enrollments.map((e) => ({
        ...e.student,
        status: e.status,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// Student unenrolls from a subject
exports.unenrollSubject = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const studentId = req.user.userId;

    const enrollment = await prisma.enrollment.findFirst({
      where: { subjectId, studentId },
    });

    if (!enrollment) {
      return res.status(404).json({ error: "You are not enrolled in this subject" });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Delete student's attendance for this subject
      await tx.attendance.deleteMany({
        where: {
          studentId,
          session: { subjectId },
        },
      });

      // 2. Delete the enrollment record
      await tx.enrollment.delete({
        where: { id: enrollment.id },
      });
    });

    res.json({ message: "Successfully unenrolled from subject" });
  } catch (err) {
    next(err);
  }
};

// Faculty updates enrollment status (Approve/Reject)
exports.updateEnrollmentStatus = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const studentId = Number(req.params.studentId);
    const { status } = req.body;

    if (!["APPROVED", "REJECTED", "PENDING"].includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    // Verify faculty owns the subject
    const facultyId = req.user.userId;
    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, facultyId }
    });

    if (!subject) {
      return res.status(403).json({ error: "Unauthorized for this subject" });
    }

    const updated = await prisma.enrollment.update({
      where: {
        studentId_subjectId: {
          studentId,
          subjectId
        }
      },
      data: { status }
    });

    res.json({ 
      message: `Enrollment status updated to ${status}`, 
      enrollment: updated 
    });
  } catch (err) {
    next(err);
  }
};
