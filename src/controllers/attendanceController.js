/**
 * controllers/attendanceController.js
 */

const { submitAttendance } = require("../services/attendanceService");
const { getAttendanceSummary, getStudentRecord, getGlobalHistory } = require("../services/analyticsService");
const { notifyStudent } = require("../services/notificationService");

// Student: Submit attendance code along with GPS coordinates
exports.submitAttendance = async (req, res, next) => {
  try {
    const studentId = req.user.userId;
    const { sessionId, selectedCode, deviceId, latitude, longitude } = req.body;

    // Run the multi-layer pipeline
    const result = await submitAttendance({
      sessionId: Number(sessionId),
      studentId: Number(studentId),
      selectedCode,
      deviceId,
      latitude,
      longitude,
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

    const history = await getGlobalHistory(userId);
    res.json(history);
  } catch (err) {
    next(err);
  }
};
