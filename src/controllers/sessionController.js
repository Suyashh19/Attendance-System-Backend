/**
 * controllers/sessionController.js
 */

const {
  createSession,
  endSession,
  getActiveSession,
  getSessionHistory,
} = require("../services/sessionService");
const { markAbsentees } = require("../services/attendanceService");
const {
  broadcastSessionStarted,
  broadcastSessionEnded,
  notifyStudent
} = require("../services/notificationService");
const prisma = require("../config/db");

// Faculty: Start a new attendance session
exports.startSession = async (req, res, next) => {
  try {
    const { subjectId, date, startTime, endTime, latitude, longitude } = req.body;
    const facultyId = req.user.userId;

    // Verify ownership
    const subject = await prisma.subject.findFirst({ where: { id: Number(subjectId), facultyId } });
    if (!subject) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    const session = await createSession({ 
      subjectId: Number(subjectId), 
      facultyId, 
      date, 
      startTime, 
      endTime, 
      latitude, 
      longitude 
    });

    // Emit via Socket.IO
    broadcastSessionStarted(subjectId, session);

    res.status(201).json({
      message: "Session started successfully",
      session: {
        id: session.id,
        subjectId: session.subjectId,
        correctCode: session.correctCode,
        options: session.fakeOptions, // shuffled codes including correct one
        startTime: session.startTime,
        timeLimitSeconds: 15, // matches UI representation
        date: session.date,
        scheduledStartTime: session.scheduledStartTime,
        scheduledEndTime: session.scheduledEndTime,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Faculty: End an active attendance session
exports.endSession = async (req, res, next) => {
  try {
    const sessionId = Number(req.params.sessionId);
    const facultyId = req.user.userId;

    // Check if session exists and is already closed
    const existing = await prisma.session.findFirst({
      where: { id: sessionId, facultyId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (!existing.isActive) {
      return res.json({ 
        message: "Session is already closed", 
        session: existing 
      });
    }

    const session = await endSession(sessionId, facultyId);

    // Auto-mark non-submitters as ABSENT
    const absentStudentIds = await markAbsentees(sessionId);

    // Notify all students in subject that session ended
    broadcastSessionEnded(session.subjectId, sessionId);
    
    // Also explicitly notify the now-absent students
    absentStudentIds.forEach((studentId) => {
      notifyStudent(studentId, {
        status: "ABSENT",
        reason: "Did not submit attendance",
        attendance: null,
        sessionId
      });
    });

    res.json({
      message: "Session ended successfully",
      session,
      markedAbsent: absentStudentIds.length,
    });
  } catch (err) {
    next(err);
  }
};

// Generic: View session history for a subject (Faculty)
exports.getSessionHistory = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const history = await getSessionHistory(subjectId);
    res.json({ history });
  } catch (err) {
    next(err);
  }
};

// Student: REST fallback to poll if there is an active session
exports.getActiveSession = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);
    const session = await getActiveSession(subjectId);

    if (!session) {
      return res.json({ active: false });
    }

    res.json({
      active: true,
      session: {
        id: session.id,
        subjectId: session.subjectId,
        options: session.fakeOptions,
        startTime: session.startTime,
        timeLimitSeconds: 15,
      },
    });
  } catch (err) {
    next(err);
  }
};
