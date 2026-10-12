/**
 * sessionLifecycle.js
 * Closes attendance sessions: marks absentees, notifies students, and makes
 * sure a session never stays open after its window (auto-close + startup sweep).
 */

const prisma = require("../config/db");
const { markAbsentees, invalidateSessionCache } = require("./attendanceService");
const {
  broadcastSessionEnded,
  notifyStudent,
  sendManyPushNotifications,
} = require("./notificationService");

// How long after the window expires the server closes a session on its own
const AUTO_CLOSE_GRACE_MS = 10000;
// Sessions left open longer than this are closed without touching attendance
const STALE_SESSION_MS = 60 * 60 * 1000;

const autoCloseTimers = new Map();

/**
 * Every approved student of the session's subject with their status for it.
 * @param {number} sessionId
 * @param {number} subjectId
 */
async function getSessionRoster(sessionId, subjectId) {
  const [enrollments, attendances] = await Promise.all([
    prisma.enrollment.findMany({
      where: { subjectId, status: "APPROVED" },
      include: {
        student: { select: { id: true, name: true, prn: true, rollNo: true, pushToken: true } },
      },
    }),
    prisma.attendance.findMany({ where: { sessionId } }),
  ]);

  const byStudent = new Map(attendances.map((a) => [a.studentId, a]));

  return enrollments.map((e) => {
    const attendance = byStudent.get(e.studentId);
    return {
      studentId: e.studentId,
      status: attendance ? attendance.status : "ABSENT",
      reason: attendance ? attendance.reason : "Did not submit attendance",
      editedByFaculty: attendance ? attendance.editedByFaculty : false,
      student: e.student,
    };
  });
}

function stripPushTokens(roster) {
  return roster.map(({ student, ...rest }) => {
    const { pushToken, ...publicStudent } = student;
    return { ...rest, student: publicStudent };
  });
}

/**
 * Close a session, mark absentees and tell everyone. Safe to call twice:
 * the second caller just gets the final roster back.
 *
 * @param {number} sessionId
 * @param {{ notify?: boolean }} [options]
 * @returns {Promise<{ session: Object, attendances: Object[], markedAbsent: number, alreadyClosed: boolean } | null>}
 */
async function finalizeSession(sessionId, { notify = true } = {}) {
  cancelAutoClose(sessionId);

  // Only one caller wins the close, so absentees and notifications happen once
  const closed = await prisma.session.updateMany({
    where: { id: sessionId, isActive: true },
    data: { isActive: false, endTime: new Date() },
  });
  invalidateSessionCache(sessionId);

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { subject: { select: { name: true, code: true } } },
  });
  if (!session) return null;

  if (closed.count === 0) {
    const roster = await getSessionRoster(sessionId, session.subjectId);
    return { session, attendances: stripPushTokens(roster), markedAbsent: 0, alreadyClosed: true };
  }

  const absentStudentIds = await markAbsentees(sessionId);
  const roster = await getSessionRoster(sessionId, session.subjectId);

  if (notify) {
    try {
      broadcastSessionEnded(session.subjectId, sessionId);

      const pushMessages = [];
      for (const entry of roster) {
        notifyStudent(entry.studentId, {
          status: entry.status,
          sessionId,
          reason: entry.reason,
          subjectName: session.subject?.name,
        }).catch((err) => console.error("[Notify Error]", err));

        if (entry.student.pushToken) {
          pushMessages.push({
            to: entry.student.pushToken,
            sound: "default",
            title: `Attendance: ${session.subject?.name || "Session Ended"}`,
            body: `Your attendance is marked as ${entry.status} for ${session.subject?.code || "class"}.`,
            data: { sessionId, status: entry.status, subjectId: session.subjectId },
          });
        }
      }

      if (pushMessages.length > 0) {
        sendManyPushNotifications(pushMessages).catch((err) => console.error("[Push Error]", err));
      }
    } catch (err) {
      console.error("[Session Close] Failed to notify students:", err);
    }
  }

  return {
    session,
    attendances: stripPushTokens(roster),
    markedAbsent: absentStudentIds.length,
    alreadyClosed: false,
  };
}

function cancelAutoClose(sessionId) {
  const timer = autoCloseTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    autoCloseTimers.delete(sessionId);
  }
}

/**
 * Close the session by itself shortly after its window, in case the faculty
 * never taps "End" (app closed, phone locked, network lost).
 * @param {{ id: number, windowExpiry: Date | null }} session
 */
function scheduleAutoClose(session) {
  cancelAutoClose(session.id);
  const expiry = session.windowExpiry ? new Date(session.windowExpiry).getTime() : Date.now();
  const delay = Math.max(0, expiry - Date.now()) + AUTO_CLOSE_GRACE_MS;

  const timer = setTimeout(() => {
    autoCloseTimers.delete(session.id);
    finalizeSession(session.id).catch((err) =>
      console.error(`[Session Close] Auto-close failed for session ${session.id}:`, err)
    );
  }, delay);
  autoCloseTimers.set(session.id, timer);
}

/**
 * Close whatever is still open for a subject before a new session starts.
 * @param {number} subjectId
 */
async function closeOpenSessionsForSubject(subjectId) {
  const open = await prisma.session.findMany({
    where: { subjectId, isActive: true },
    select: { id: true, startTime: true },
  });
  for (const session of open) {
    await closeLeftoverSession(session);
  }
}

/**
 * Timers do not survive a restart, so pick up every session that is still open.
 * Call once at startup.
 */
async function closeStaleSessions() {
  const open = await prisma.session.findMany({
    where: { isActive: true },
    select: { id: true, startTime: true, windowExpiry: true },
  });

  for (const session of open) {
    const expiry = session.windowExpiry ? new Date(session.windowExpiry).getTime() : 0;
    if (expiry + AUTO_CLOSE_GRACE_MS > Date.now()) {
      scheduleAutoClose(session);
    } else {
      await closeLeftoverSession(session);
    }
  }

  if (open.length > 0) {
    console.log(`[Session Close] Handled ${open.length} session(s) left open before startup`);
  }
}

// A recent leftover gets its absentees marked; an old one is only closed, because
// today's enrollment list says nothing about who was in that class back then.
async function closeLeftoverSession(session) {
  const age = Date.now() - new Date(session.startTime).getTime();
  if (age <= STALE_SESSION_MS) {
    await finalizeSession(session.id, { notify: false });
    return;
  }
  cancelAutoClose(session.id);
  await prisma.session.updateMany({
    where: { id: session.id, isActive: true },
    data: { isActive: false, endTime: new Date() },
  });
  invalidateSessionCache(session.id);
}

module.exports = {
  finalizeSession,
  scheduleAutoClose,
  closeOpenSessionsForSubject,
  closeStaleSessions,
};
