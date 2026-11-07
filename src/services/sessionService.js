/**
 * sessionService.js
 * Handles attendance session lifecycle: creation, code generation,
 * and retrieval.
 */

const crypto = require("crypto");
const prisma = require("../config/db");

// ─── Code Generation ──────────────────────────────────────────────────────────

const CODE_LENGTH = 4;
// Default attendance window; the faculty can choose any length between MIN and MAX
const WINDOW_SECONDS = 15;
const MIN_WINDOW_SECONDS = 10;
const MAX_WINDOW_SECONDS = 15;

/**
 * Read the window length the faculty asked for.
 * Missing means the default (older app versions never send it).
 * @returns {number | null} whole seconds, or null when the value is unusable
 */
function parseWindowSeconds(value) {
  if (value === undefined || value === null || value === "") return WINDOW_SECONDS;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < MIN_WINDOW_SECONDS || seconds > MAX_WINDOW_SECONDS) return null;
  return seconds;
}

/** The window length a session actually got, read from its own start and expiry. */
function sessionWindowSeconds(session) {
  const start = session?.startTime ? new Date(session.startTime).getTime() : NaN;
  const expiry = session?.windowExpiry ? new Date(session.windowExpiry).getTime() : NaN;
  const seconds = Math.round((expiry - start) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : WINDOW_SECONDS;
}

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
 * @param {number} [data.windowSeconds] attendance window length, already validated
 * @returns {Promise<Object>} The created Session
 */
async function createSession({ subjectId, classId, facultyId, date, startTime, endTime, windowSeconds = WINDOW_SECONDS }) {
  // Use subjectId or classId (for backward/forward compatibility)
  const targetSubjectId = Number(subjectId || classId);

  if (!targetSubjectId) {
    throw new Error("Subject ID (classId) is required to start a session.");
  }

  const scheduledDate = date ? new Date(date) : new Date();
  const correctCode = generateCode();
  const startedAt = new Date();

  try {
    return await prisma.session.create({
      data: {
        subjectId: targetSubjectId,
        facultyId: Number(facultyId),
        date: isNaN(scheduledDate.getTime()) ? new Date() : scheduledDate,

        // startTime and endTime in DB are DateTime: the session really starts NOW.
        // The "10:00"-style strings from the frontend go into the scheduled* TEXT fields.
        startTime: startedAt,
        windowExpiry: new Date(startedAt.getTime() + windowSeconds * 1000),
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
  MIN_WINDOW_SECONDS,
  MAX_WINDOW_SECONDS,
  parseWindowSeconds,
  sessionWindowSeconds,
  generateCode,
  createSession,
  getActiveSession,
  getSessionById,
  getSessionHistory,
};
