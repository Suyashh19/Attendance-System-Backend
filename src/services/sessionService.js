/**
 * sessionService.js
 * Handles attendance session lifecycle: creation, code generation,
 * and retrieval.
 */

const crypto = require("crypto");
const prisma = require("../config/db");

// ─── Code Generation ──────────────────────────────────────────────────────────

const CODE_LENGTH = 4;
const WINDOW_SECONDS = 15;

/**
 * Generate the numeric code the faculty shows and students type in.
 * @returns {string} e.g. "4721"
 */
function generateCode() {
  const min = 10 ** (CODE_LENGTH - 1);
  return String(crypto.randomInt(min, min * 10));
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new attendance session for a subject.
 * The caller is responsible for closing any session that is still open.
 *
 * @param {Object} data
 * @param {number} data.subjectId
 * @param {number} data.facultyId
 * @param {string} data.date
 * @param {string} data.startTime
 * @param {string} data.endTime
 * @returns {Promise<Object>} The created Session
 */
async function createSession({ subjectId, classId, facultyId, date, startTime, endTime }) {
  // Use subjectId or classId (for backward/forward compatibility)
  const targetSubjectId = Number(subjectId || classId);

  if (!targetSubjectId) {
    throw new Error("Subject ID (classId) is required to start a session.");
  }

  const scheduledDate = date ? new Date(date) : new Date();
  const correctCode = generateCode();

  try {
    return await prisma.session.create({
      data: {
        subjectId: targetSubjectId,
        facultyId: Number(facultyId),
        date: isNaN(scheduledDate.getTime()) ? new Date() : scheduledDate,

        // startTime and endTime in DB are DateTime: the session really starts NOW.
        // The "10:00"-style strings from the frontend go into the scheduled* TEXT fields.
        startTime: new Date(),
        windowExpiry: new Date(Date.now() + WINDOW_SECONDS * 1000),
        endTime: null,

        scheduledStartTime: startTime || null,
        scheduledEndTime: endTime || null,

        correctCode,
        isActive: true,
        status: "active",
      },
      include: { subject: { select: { name: true, code: true } } },
    });
  } catch (error) {
    console.error("[Session] Creation failed:", error.message, error.code || "", error.meta || "");
    // Mask raw database error for the frontend
    throw new Error("Failed to start session. Please try again.");
  }
}

/**
 * Get the currently active session for a subject.
 * @param {number} subjectId
 * @returns {Promise<Object|null>}
 */
async function getActiveSession(subjectId) {
  return prisma.session.findFirst({
    where: { subjectId, isActive: true },
    orderBy: { startTime: "desc" },
    include: { subject: { select: { name: true, code: true } } },
  });
}

/**
 * Get a session by ID.
 * @param {number} sessionId
 * @returns {Promise<Object|null>}
 */
async function getSessionById(sessionId) {
  return prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      subject: { select: { name: true, code: true } },
      faculty: { select: { name: true, email: true } },
    },
  });
}

/**
 * Fetch session history for a subject (all sessions, ordered newest first).
 * The attendance code is never part of the result.
 * @param {number} subjectId
 * @returns {Promise<Object[]>}
 */
async function getSessionHistory(subjectId) {
  const sessions = await prisma.session.findMany({
    where: { subjectId },
    orderBy: { startTime: "desc" },
    select: {
      id: true,
      subjectId: true,
      isActive: true,
      startTime: true,
      windowExpiry: true,
      endTime: true,
      date: true,
      scheduledStartTime: true,
      scheduledEndTime: true,
      _count: {
        select: { attendances: true },
      },
    },
  });

  return sessions.map(({ _count, ...s }) => ({
    ...s,
    attendanceCount: _count.attendances,
  }));
}

module.exports = {
  CODE_LENGTH,
  WINDOW_SECONDS,
  generateCode,
  createSession,
  getActiveSession,
  getSessionById,
  getSessionHistory,
};
