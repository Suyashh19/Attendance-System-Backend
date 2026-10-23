/**
 * controllers/sessionController.js

 */

const {
  CODE_LENGTH,
  WINDOW_SECONDS,
  createSession,
  getActiveSession,
  getSessionHistory,
} = require("../services/sessionService");
const {
  finalizeSession,
  scheduleAutoClose,
  closeOpenSessionsForSubject,
} = require("../services/sessionLifecycle");
const { broadcastSessionStarted } = require("../services/notificationService");
const prisma = require("../config/db");

// Faculty: Start a new attendance session
exports.startSession = async (req, res, next) => {
  try {
    const { date, startTime, endTime } = req.body;
    const subjectId = Number(req.body.subjectId);
    const facultyId = req.user.userId;

    if (!Number.isInteger(subjectId) || subjectId <= 0) {
      return res.status(400).json({ error: "subjectId is required" });
    }

    // Verify ownership
    const subject = await prisma.subject.findFirst({ where: { id: subjectId, facultyId } });
    if (!subject) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

    // Reject a double tap before touching the session that is already running
    const recentSession = await prisma.session.findFirst({
      where: { subjectId, startTime: { gte: new Date(Date.now() - 10000) } },
    });
    if (recentSession) {
      return res.status(409).json({
        error: "A session for this subject was started very recently. Please wait a moment.",
      });
    }

    // A session left open from earlier must be closed properly (absentees included)
    await closeOpenSessionsForSubject(subjectId);

    const session = await createSession({ subjectId, facultyId, date, startTime, endTime });

    scheduleAutoClose(session);

    // 1. Fetch approved students' push tokens
    const enrollments = await prisma.enrollment.findMany({
      where: { subjectId, status: "APPROVED" },
      include: { student: { select: { pushToken: true } } }
    });

    const pushTokens = enrollments
      .map(e => e.student.pushToken)
      .filter(token => !!token);

    // 2. Emit via Socket.IO and Send Push Notifications
    broadcastSessionStarted(subjectId, session, pushTokens)
      .catch((err) => console.error("[Session Start] Failed to notify students:", err));

    res.status(201).json({
      message: "Session started successfully",
      session: {
        id: session.id,
        subjectId: session.subjectId,
        correctCode: session.correctCode,
        codeLength: CODE_LENGTH,
        startTime: session.startTime,
        windowExpiry: session.windowExpiry, // Authoritative source
        windowSeconds: WINDOW_SECONDS,
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

    if (!Number.isInteger(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const existing = await prisma.session.findFirst({
      where: { id: sessionId, facultyId }
    });

    if (!existing) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Also covers a session the server already closed by itself: the faculty still gets the roster
    const result = await finalizeSession(sessionId);

    res.json({
      message: result.alreadyClosed ? "Session is already closed" : "Session ended successfully",
      session: {
        ...result.session,
        serverTime: new Date().toISOString()
      },
      markedAbsent: result.markedAbsent,
      attendances: result.attendances,
    });
  } catch (err) {
    next(err);
  }
};

// Faculty: The session they currently have open, so the app can reopen it after a restart
exports.getMyActiveSession = async (req, res, next) => {
  try {
    const session = await prisma.session.findFirst({
      where: { facultyId: req.user.userId, isActive: true },
      orderBy: { startTime: "desc" },
      include: { subject: { select: { name: true, code: true } } },
    });

    if (!session) {
      return res.json({ active: false });
    }

    const presentCount = await prisma.attendance.count({
      where: { sessionId: session.id, status: "PRESENT" },
    });

    res.json({
      active: true,
      session: {
        id: session.id,
        subjectId: session.subjectId,
        subjectName: session.subject?.name,
        correctCode: session.correctCode,
        codeLength: CODE_LENGTH,
        startTime: session.startTime,
        windowExpiry: session.windowExpiry,
        windowSeconds: WINDOW_SECONDS,
        serverTime: new Date().toISOString(),
        presentCount,
      },
    });
  } catch (err) {
    next(err);
  }
};

const DEFAULT_RECENT_LIMIT = 10;
const MAX_RECENT_LIMIT = 100;

// ?limit= picks how many sessions come back; anything unusable falls back to the default
function parseRecentLimit(value) {
  const limit = parseInt(value, 10);
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_RECENT_LIMIT;
  return Math.min(limit, MAX_RECENT_LIMIT);
}

// Faculty: View the latest sessions across all subjects (10 unless ?limit= asks for more, up to 100)
exports.getRecentSessions = async (req, res, next) => {
  try {
    const facultyId = req.user.userId;

    const sessions = await prisma.session.findMany({
      where: { facultyId },
      orderBy: { startTime: "desc" },
      take: parseRecentLimit(req.query?.limit),
      include: {
        subject: {
          select: { name: true, code: true, type: true }
        }
      }
    });

    // Two grouped counts for the whole list instead of two queries per session
    const subjectIds = [...new Set(sessions.map((s) => s.subjectId))];
    const sessionIds = sessions.map((s) => s.id);

    const [enrolledRows, presentRows] = sessions.length === 0 ? [[], []] : await Promise.all([
      prisma.enrollment.groupBy({
        by: ["subjectId"],
        where: { subjectId: { in: subjectIds }, status: "APPROVED" },
        _count: { _all: true },
      }),
      prisma.attendance.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: sessionIds }, status: "PRESENT" },
        _count: { _all: true },
      }),
    ]);

    const enrolledBySubject = new Map(enrolledRows.map((r) => [r.subjectId, r._count._all]));
    const presentBySession = new Map(presentRows.map((r) => [r.sessionId, r._count._all]));

    const sessionsWithStats = sessions.map((session) => ({
      id: session.id,
      subjectId: session.subjectId,
      subjectName: session.subject.name,
      subjectCode: session.subject.code,
      subjectType: session.subject.type,
      startTime: session.startTime,
      endTime: session.endTime,
      presentCount: presentBySession.get(session.id) || 0,
      totalEnrolled: enrolledBySubject.get(session.subjectId) || 0,
    }));

    res.json({ sessions: sessionsWithStats });
  } catch (err) {
    next(err);
  }
};

// Faculty: View session history for one of their subjects
exports.getSessionHistory = async (req, res, next) => {
  try {
    const subjectId = Number(req.params.subjectId);

    const subject = await prisma.subject.findFirst({
      where: { id: subjectId, facultyId: req.user.userId },
    });
    if (!subject) {
      return res.status(403).json({ error: "You do not have permission for this subject" });
    }

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
        codeLength: CODE_LENGTH,
        startTime: session.startTime,
        windowExpiry: session.windowExpiry,
        windowSeconds: WINDOW_SECONDS,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
};
