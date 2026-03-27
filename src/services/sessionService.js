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
  console.log(`[DEBUG] Generated 4 shuffled options (including ${correctCode}):`, arr);
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

  console.log("[DEBUG] createSession called with:", {
    targetSubjectId,
    facultyId,
    date,
    startTime,
    endTime,
    latitude,
    longitude
  });

  if (!targetSubjectId) {
    throw new Error("Subject ID (classId) is required to start a session.");
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
  const fakeOptions = generateFakeOptions(correctCode);

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
      windowExpiry: new Date(Date.now() + 15000), // 15-second attendance window
      endTime: null,         // To be set when session ends
      
      // 3. Store the scheduled string times in correct TEXT fields
      scheduledStartTime: startTime || null, 
      scheduledEndTime: endTime || null,   
      
      correctCode,
      fakeOptions: JSON.stringify(fakeOptions),
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      isActive: true,
      status: "active",
    };

    console.log("[DEBUG] Prepared session data:", JSON.stringify(sessionData, null, 2));

    const session = await prisma.session.create({
      data: sessionData,
      include: { subject: { select: { name: true, code: true } } },
    });

    console.log("[DEBUG] Session created successfully:", session.id);

    return {
      ...session,
      fakeOptions, // parsed array for convenience
    };
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
