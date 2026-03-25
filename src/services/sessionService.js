/**
 * sessionService.js
 * Handles attendance session lifecycle: creation, code generation,
 * option shuffling, and retrieval.
 */

const prisma = require("../config/db");

// ─── Code Generation ──────────────────────────────────────────────────────────

/**
 * Generate a 3-digit code string (100–999).
 * @returns {string} e.g. "472"
 */
function generateCode() {
  return String(Math.floor(Math.random() * 900) + 100);
}

/**
 * Build a shuffled option array including the correct code + 3 fake decoys.
 * All codes are unique 3-digit numbers.
 * @param {string} correctCode
 * @returns {string[]} 4-element shuffled array
 */
function generateFakeOptions(correctCode) {
  const options = new Set([correctCode]);
  while (options.size < 4) {
    options.add(String(Math.floor(Math.random() * 900) + 100));
  }
  // Fisher-Yates shuffle
  const arr = Array.from(options);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Session CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new attendance session for a subject.
 * Automatically closes any existing active session for the same subject
 * before creating a new one (prevents orphaned sessions).
 *
 * @param {Object} data
 * @param {number} data.subjectId
 * @param {number} data.facultyId
 * @param {string} data.date
 * @param {string} data.startTime
 * @param {string} data.endTime
 * @param {number} [data.latitude]  - Faculty GPS anchor latitude
 * @param {number} [data.longitude] - Faculty GPS anchor longitude
 * @returns {Promise<Object>} The created Session with parsed fakeOptions
 */
async function createSession({ subjectId, classId, facultyId, date, startTime, endTime, latitude, longitude }) {
  // Use subjectId or classId (for backward/forward compatibility)
  const targetSubjectId = Number(subjectId || classId);

  if (!targetSubjectId) {
    throw new Error("Subject ID (classId) is required to start a session.");
  }

  // Close any lingering active session for this subject
  await prisma.session.updateMany({
    where: { subjectId: targetSubjectId, isActive: true },
    data: { isActive: false, endTime: new Date() },
  });

  const correctCode = generateCode();
  const fakeOptions = generateFakeOptions(correctCode);

  try {
    const session = await prisma.session.create({
      data: {
        subjectId: targetSubjectId,
        facultyId: Number(facultyId),
        date: date ? new Date(date) : new Date(),
        startTime: startTime || null,
        endTime: endTime || null,
        scheduledStartTime: startTime || null, // Sync with existing fields
        scheduledEndTime: endTime || null,   // Sync with existing fields
        correctCode,
        fakeOptions: JSON.stringify(fakeOptions),
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        isActive: true,
        status: "active",
      },
      include: { subject: { select: { name: true, code: true } } },
    });

    return {
      ...session,
      fakeOptions, // parsed array for convenience
    };
  } catch (error) {
    console.error("Prisma Session Creation Error:", error);
    // Mask raw database error as requested
    throw new Error("Failed to start session. Please try again.");
  }
}

/**
 * End (deactivate) an attendance session.
 * @param {number} sessionId
 * @param {number} facultyId - Verify ownership
 * @returns {Promise<Object>} Updated session
 */
async function endSession(sessionId, facultyId) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, facultyId },
  });
  if (!session) {
    throw new Error("Session not found or you are not the owner");
  }
  if (!session.isActive) {
    throw new Error("Session is already closed");
  }

  return prisma.session.update({
    where: { id: sessionId },
    data: { isActive: false, endTime: new Date() },
  });
}

/**
 * Get the currently active session for a subject.
 * @param {number} subjectId
 * @returns {Promise<Object|null>}
 */
async function getActiveSession(subjectId) {
  const session = await prisma.session.findFirst({
    where: { subjectId, isActive: true },
    include: { subject: { select: { name: true, code: true } } },
  });

  if (!session) return null;

  return {
    ...session,
    fakeOptions: JSON.parse(session.fakeOptions),
  };
}

/**
 * Get a session by ID with parsed fakeOptions.
 * @param {number} sessionId
 * @returns {Promise<Object|null>}
 */
async function getSessionById(sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      subject: { select: { name: true, code: true } },
      faculty: { select: { name: true, email: true } },
    },
  });
  if (!session) return null;

  return { ...session, fakeOptions: JSON.parse(session.fakeOptions) };
}

/**
 * Fetch session history for a subject (all sessions, ordered newest first).
 * @param {number} subjectId
 * @returns {Promise<Object[]>}
 */
async function getSessionHistory(subjectId) {
  const sessions = await prisma.session.findMany({
    where: { subjectId },
    orderBy: { startTime: "desc" },
    include: {
      _count: {
        select: { attendances: true },
      },
    },
  });

  return sessions.map((s) => ({
    ...s,
    fakeOptions: JSON.parse(s.fakeOptions),
    attendanceCount: s._count.attendances,
  }));
}

module.exports = {
  generateCode,
  generateFakeOptions,
  createSession,
  endSession,
  getActiveSession,
  getSessionById,
  getSessionHistory,
};
