/**
 * controllers/attendanceController.js
 */

const { submitAttendance, deleteSubjectHistory } = require("../services/attendanceService");
const { getAttendanceSummary, getStudentRecord, getGlobalHistory, getHierarchicalHistory } = require("../services/analyticsService");
const { notifyStudent } = require("../services/notificationService");
const prisma = require("../config/db");

// Student: Submit attendance code along with GPS coordinates
exports.submitAttendance = async (req, res, next) => {
  try {
    const studentId = req.user.userId;
    const { sessionId, selectedCode, deviceId, latitude, longitude, accuracy, isRetry } = req.body;
    
    // Run the multi-layer pipeline
    const result = await submitAttendance({
      sessionId: Number(sessionId),
      studentId: Number(studentId),
      selectedCode,
      deviceId,
      latitude,
      longitude,
      accuracy,
      isRetry: !!isRetry,
    });

    // Notify student via private socket room asynchronously
    notifyStudent(studentId, { ...result, sessionId });

    res.json({
      message: `Attendance processing finished with status: ${result.status}`,
      status: result.status,
      reason: result.reason,
    });
  } catch (err) {
    next(err);
  }
};

// Faculty: View analytics for an entire subject
exports.getSubjectAnalytics = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const summary = await getAttendanceSummary(subjectId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

// Student: View their own granular record for a subject
exports.getMyRecord = async (req, res, next) => {
  try {
    const studentId = req.user.userId;
    const subjectId = Number(req.params.subjectId);

    const record = await getStudentRecord(studentId, subjectId);
    res.json(record);
  } catch (err) {
    next(err);
  }
};

// Global history for student
exports.getAttendanceHistory = async (req, res, next) => {
  try {
    const { userId, role } = req.user;
    if (role !== "student") return res.status(403).json({ error: "Only students can view history" });

    const history = await getHierarchicalHistory(userId);
    res.json(history);
  } catch (err) {
    next(err);
  }
};

// Delete student's history for a specific subject
exports.deleteSubjectHistory = async (req, res, next) => {
  try {
    const studentId = req.user.userId;
    const subjectId = Number(req.params.subjectId);

    await deleteSubjectHistory(studentId, subjectId);
    res.json({ message: "Subject history deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// Faculty: Edit attendance record manually
exports.editAttendance = async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const studentId = Number(req.params.studentId);
    const { status, reason } = req.body;
    const facultyId = req.user.userId;

    // Verify faculty owns the session
    const session = await prisma.session.findFirst({
      where: { id: sessionId, facultyId }
    });

    if (!session) {
      return res.status(403).json({ error: "Unauthorized for this session" });
    }

    const attendance = await prisma.attendance.upsert({
      where: {
        sessionId_studentId: { sessionId, studentId }
      },
      create: {
        sessionId,
        studentId,
        status,
        reason: reason || "Manually set by faculty",
        editedByFaculty: true,
        submittedAt: new Date()
      },
      update: {
        status,
        reason: reason || "Manually set by faculty",
        editedByFaculty: true,
      }
    });

    res.json({ message: "Attendance updated successfully", attendance });
  } catch (err) {
    next(err);
  }
};
