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
    console.log("[DEBUG] Received startSession request:", req.body);
    const { subjectId, date, startTime, endTime, latitude, longitude } = req.body;
    const facultyId = req.user.userId;

    if (!subjectId) {
      console.warn("[DEBUG] Missing subjectId in request body");
      return res.status(400).json({ error: "subjectId is required" });
    }

    // Verify ownership
    const subject = await prisma.subject.findFirst({ where: { id: Number(subjectId), facultyId } });
    if (!subject) {
      console.warn(`[DEBUG] Faculty ${facultyId} does not own subject ${subjectId}`);
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    console.log(`[DEBUG] Faculty ${facultyId} verified for subject ${subjectId}. Calling createSession...`);

    const session = await createSession({ 
      subjectId: Number(subjectId), 
      facultyId, 
      date, 
      startTime, 
      endTime, 
      latitude: latitude != null ? Number(latitude) : null, 
      longitude: longitude != null ? Number(longitude) : null 
    });

    // 1. Fetch enrolled students' push tokens
    const enrollments = await prisma.enrollment.findMany({
      where: { subjectId: Number(subjectId) },
      include: { student: { select: { pushToken: true } } }
    });
    
    const pushTokens = enrollments
      .map(e => e.student.pushToken)
      .filter(token => !!token);

    // 2. Emit via Socket.IO and Send Push Notifications
    broadcastSessionStarted(subjectId, session, pushTokens);

    res.status(201).json({
      message: "Session started successfully",
      session: {
        id: session.id,
        subjectId: session.subjectId,
        correctCode: session.correctCode,
        options: session.fakeOptions, // shuffled codes including correct one
        startTime: session.startTime,
        windowExpiry: session.windowExpiry, // Authoritative source
        windowSeconds: 15,
        serverTime: new Date().toISOString(),
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
      session: {
        ...session,
        serverTime: new Date().toISOString()
      },
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
        windowExpiry: session.windowExpiry,
        windowSeconds: 15,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};
