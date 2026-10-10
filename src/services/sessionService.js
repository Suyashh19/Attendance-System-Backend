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
 * Automatically closes any existing active session for the same subject
 * before creating a new one (prevents orphaned sessions).
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

  console.log("[DEBUG] createSession called with:", {
    targetSubjectId,
    facultyId,
    date,
    startTime,
    endTime
  });
  
  if (!targetSubjectId) {
    throw new Error("Subject ID (classId) is required to start a session.");
  }

  // Lock: Reject if a session was created VERY recently (e.g., < 10 seconds ago)
  // This prevents rapid-fire duplicate sessions from multiple clicks or network retries.
  const recentSession = await prisma.session.findFirst({
    where: { 
      subjectId: targetSubjectId, 
      startTime: { gte: new Date(Date.now() - 10000) } 
    }
  });

  if (recentSession) {
    console.warn(`[DEBUG] Rejecting session start for subject ${targetSubjectId}: Already started ${Math.round((Date.now() - recentSession.startTime.getTime())/1000)}s ago.`);
    throw new Error("A session for this subject was started very recently. Please wait a moment.");
  }

  // Close any lingering active session for this subject
  try {
    const closedCount = await prisma.session.updateMany({
      where: { subjectId: targetSubjectId, isActive: true },
      data: { isActive: false, endTime: new Date() },
    });
    console.log(`[DEBUG] Closed ${closedCount.count} existing active sessions for subject ${targetSubjectId}`);
  } catch (err) {
    console.error("[DEBUG] Error closing existing sessions:", err);
  }

  const correctCode = generateCode();

  try {
    console.log("[DEBUG] Attempting prisma.session.create with data mapping...");
    const sessionData = {
      subjectId: targetSubjectId,
      facultyId: Number(facultyId),
      // 1. Handle Date: Convert string date to Date object
      date: date ? new Date(date) : new Date(),
      
      // 2. IMPORTANT: startTime and endTime in DB are DateTime. 
      // Do NOT pass strings from frontend ("10:00") directly to them.
      startTime: new Date(), // Actual start is NOW
      windowExpiry: new Date(Date.now() + WINDOW_SECONDS * 1000), // 15-second attendance window
      endTime: null,         // To be set when session ends
      
      // 3. Store the scheduled string times in correct TEXT fields
      scheduledStartTime: startTime || null, 
      scheduledEndTime: endTime || null,   
      
      correctCode,
      fakeOptions: "[]", // legacy NOT NULL column, no longer used
      isActive: true,
      status: "active",
    };

    console.log("[DEBUG] Prepared session data:", JSON.stringify(sessionData, null, 2));

    const session = await prisma.session.create({
      data: sessionData,
      include: { subject: { select: { name: true, code: true } } },
    });

    console.log("[DEBUG] Session created successfully:", session.id);

    return session;
  } catch (error) {
    // CRITICAL: Log the actual error for debugging
    console.error("❌ Prisma Session Creation Failed!");
    console.error("Error Name:", error.name);
    console.error("Error Message:", error.message);
    if (error.code) console.error("Prisma Error Code:", error.code);
    if (error.meta) console.error("Prisma Error Meta:", JSON.stringify(error.meta));
    
    // Mask raw database error for frontend security, but provide better internal logs
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
  return prisma.session.findFirst({
    where: { subjectId, isActive: true },
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
    attendanceCount: s._count.attendances,
  }));
}

module.exports = {
  CODE_LENGTH,
  WINDOW_SECONDS,
  generateCode,
  createSession,
  endSession,
  getActiveSession,
  getSessionById,
  getSessionHistory,
};
