/**
 * controllers/attendanceController.js
 */

const { submitAttendance } = require("../services/attendanceService");
const { getAttendanceSummary, getStudentRecord, getHierarchicalHistory } = require("../services/analyticsService");
const { notifyStudent, notifyFacultyCount } = require("../services/notificationService");
const prisma = require("../config/db");

const EDITABLE_STATUSES = ["PRESENT", "ABSENT", "EXCUSED"];

// The faculty's live count is refreshed at most once per interval per session,
// however many students are marked present in that time.
const COUNT_PUSH_INTERVAL_MS = 500;
const pendingCountPushes = new Map();

function scheduleFacultyCount(facultyId, sessionId) {
  if (pendingCountPushes.has(sessionId)) return;

  const timer = setTimeout(() => {
    // Cleared before counting, so a submission landing mid-query schedules the next push
    pendingCountPushes.delete(sessionId);
    prisma.attendance
      .count({ where: { sessionId, status: "PRESENT" } })
      .then((presentCount) => notifyFacultyCount(facultyId, sessionId, presentCount))
      .catch((err) => console.error("[Attendance Count Error]", err));
  }, COUNT_PUSH_INTERVAL_MS);
  timer.unref();
  pendingCountPushes.set(sessionId, timer);
}

// Student: Submit the attendance code typed from the faculty's screen
exports.submitAttendance = async (req, res, next) => {
  try {
    const studentId = req.user.userId;
    const { code, deviceId } = req.body;
    const sessionId = Number(req.body.sessionId);

    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    // Run the multi-layer pipeline
    const result = await submitAttendance({
      sessionId,
      studentId: Number(studentId),
      code,
      deviceId,
    });

    // A wrong code with attempts left is not a final result, so nothing is broadcast
    if (result.status !== "WRONG_CODE") {
      // Notify student via private socket room asynchronously
      notifyStudent(studentId, { ...result, sessionId })
        .catch((err) => console.error("[Notify Error]", err));
    }

    // Keep the faculty's live present count in sync
    if (result.status === "PRESENT" && result.facultyId) {
      scheduleFacultyCount(result.facultyId, sessionId);
    }

    res.json({
      message: `Attendance processing finished with status: ${result.status}`,
      status: result.status,
      reason: result.reason,
      attemptsLeft: result.attemptsLeft,
      sessionId,
    });
  } catch (err) {
    next(err);
  }
};

// Faculty: View analytics for one of their subjects
exports.getSubjectAnalytics = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);

    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, facultyId: req.user.userId },
    });
    if (!subject) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    const summary = await getAttendanceSummary(subjectId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
};

// Faculty: View attendance details for a specific session (all students)
exports.getSessionAttendance = async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const facultyId = req.user.userId;

    // Verify session belongs to faculty
    const session = await prisma.session.findFirst({
      where: { id: sessionId, facultyId },
      include: { subject: true }
    });

    if (!session) {
      return res.status(403).json({ error: "Unauthorized or session not found" });
    }

    // Get all enrolled students for this subject
    const enrollments = await prisma.enrollment.findMany({
      where: { subjectId: session.subjectId, status: "APPROVED" },
      include: {
        student: {
          select: { id: true, name: true, prn: true, rollNo: true }
        }
      }
    });

    // Get attendance records for this session
    const attendances = await prisma.attendance.findMany({
      where: { sessionId }
    });
    const byStudent = new Map(attendances.map((a) => [a.studentId, a]));

    // Merge: show students with their attendance status (if exists)
    const studentsWithStatus = enrollments
      .map(e => {
        const attendance = byStudent.get(e.studentId);
        return {
          ...e.student,
          status: attendance ? attendance.status : "ABSENT",
          reason: attendance ? attendance.reason : null,
          editedByFaculty: attendance ? attendance.editedByFaculty : false
        };
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    res.json({
      session: {
        id: session.id,
        date: session.startTime,
        isActive: session.isActive,
        subjectName: session.subject.name,
        subjectCode: session.subject.code,
        subjectType: session.subject.type
      },
      students: studentsWithStatus
    });
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

// Faculty: Edit attendance record manually
exports.editAttendance = async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const studentId = Number(req.params.studentId);
    const { status, reason } = req.body || {};
    const facultyId = req.user.userId;

    if (!EDITABLE_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status must be PRESENT, ABSENT or EXCUSED" });
    }

    // Verify faculty owns the session
    const session = await prisma.session.findFirst({
      where: { id: sessionId, facultyId }
    });

    if (!session) {
      return res.status(403).json({ error: "Unauthorized for this session" });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId, subjectId: session.subjectId, status: "APPROVED" },
    });
    if (!enrollment) {
      return res.status(400).json({ error: "This student is not enrolled in the subject" });
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
