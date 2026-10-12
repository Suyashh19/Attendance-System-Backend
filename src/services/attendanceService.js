/**
 * attendanceService.js
 *
 * Core multi-layer verification pipeline for intelligent attendance submission.
 *
 * Layers (executed in order):
 *   1. Session active check
 *   2. Enrollment validation
 *   3. Device ID validation
 *   4. Time-bound check (session.windowExpiry, set when the session starts)
 *   5. Correct code validation (code typed manually by the student)
 *
 * Returns: { status: "PRESENT"|"INVALID"|"WRONG_CODE", reason?: string, attendance }
 */

const prisma = require("../config/db");
const { validateDevice } = require("./deviceService");

const MAX_CODE_ATTEMPTS = 3;

// Wrong-code tries per student per session (RAM only; the window is a few seconds)
const codeAttempts = new Map();

// Simple internal session cache (lives purely in RAM, highly efficient)
const sessionCache = new Map();

async function getSessionCached(sessionId) {
  const now = Date.now();
  const cached = sessionCache.get(sessionId);
  
  // Cache for only 2 seconds. Limits DB hits without causing stale state issues if a professor ends the session.
  if (cached && (now - cached.timestamp < 2000)) {
    return cached.data;
  }

  const session = await prisma.session.findUnique({
    where: { id: Number(sessionId) },
    include: { subject: { select: { id: true, name: true, code: true } } },
  });

  if (session) {
    sessionCache.set(sessionId, { data: session, timestamp: now });
  }
  
  return session;
}

/**
 * Submit and verify a student's attendance.
 *
 * @param {Object} params
 * @param {number} params.sessionId
 * @param {number} params.studentId
 * @param {string} params.code          - Code typed by the student
 * @param {string} params.deviceId
 * @returns {Promise<{ status: string, reason?: string, attendance: Object }>}
 */
async function submitAttendance({
  sessionId,
  studentId,
  code,
  deviceId,
}) {
  const submittedAt = new Date();
  const submittedCode = code != null ? String(code).trim() : null;

  // ── Optimization: In-Memory cache for session ─────────────────────────────
  // We fetch the session using our 2-second RAM cache to prevent DB connection exhaustion under high load.
  const session = await getSessionCached(sessionId);

  if (!session) {
    return { status: "INVALID", reason: "Session does not exist" };
  }
  if (!session.isActive) {
    return _markInvalid(sessionId, studentId, deviceId, submittedAt, submittedCode,
      "Session is no longer active");
  }

  // ── Optimization: Fetch user, enrollment, and attendance in ONE DB connection ──
  const user = await prisma.user.findUnique({
    where: { id: Number(studentId) },
    select: {
      id: true,
      deviceId: true,
      deviceLocked: true,
      enrollments: { 
        where: { subjectId: session.subjectId },
        select: { id: true, status: true } 
      },
      attendances: { 
        where: { sessionId: Number(sessionId) },
        select: { id: true, status: true, submittedCode: true, reason: true } 
      }
    }
  });

  const enrollment = user?.enrollments && user.enrollments.length > 0;
  const existing = user?.attendances && user.attendances.length > 0 ? user.attendances[0] : null;

  // ── Layer 2: Enrollment validation ────────────────────────────────────────
  // Nothing is stored here: only approved students belong in a session's records.
  if (!enrollment) {
    return { status: "INVALID", reason: "You are not enrolled in this subject" };
  }

  if (user.enrollments[0].status !== "APPROVED") {
    return { status: "INVALID", reason: "Your enrollment is pending approval or was rejected" };
  }

  // ── Layer 3: Duplicate submission check ─────────────────────────────────––
  if (existing) {
    return {
      status: existing.status,
      reason: "Attendance already submitted for this session",
      attendance: existing,
    };
  }

  // ── Layer 4: Device ID validation ─────────────────────────────────────────
  // Optimized: Use already fetched 'user' data to avoid findUnique inside validateDevice
  const deviceCheck = await validateDevice(studentId, deviceId, user);
  if (!deviceCheck.valid) {
    return _markInvalid(sessionId, studentId, deviceId, submittedAt, submittedCode,
      deviceCheck.reason);
  }

  // ─── Layer 5: Time-bound check (Strict windowExpiry from DB) ──────────────
  // We add a tiny 2-second grace period purely for network transit.
  const gracePeriodMs = 2000;
  const expiryTime = new Date(session.windowExpiry).getTime() + gracePeriodMs;

  if (submittedAt.getTime() > expiryTime) {
    const overdue = Math.round((submittedAt.getTime() - expiryTime) / 1000);
    return _markInvalid(sessionId, studentId, deviceId, submittedAt, submittedCode,
      `Attendance window expired (${overdue}s ago)`);
  }

  // ── Layer 6: Correct code validation ──────────────────────────────────────
  if (submittedCode !== String(session.correctCode)) {
    const key = `${sessionId}:${studentId}`;
    const used = (codeAttempts.get(key) || 0) + 1;

    // A typo should not cost the student the lecture: allow a few tries before locking.
    if (used < MAX_CODE_ATTEMPTS) {
      if (used === 1) setTimeout(() => codeAttempts.delete(key), 60000).unref();
      codeAttempts.set(key, used);
      const attemptsLeft = MAX_CODE_ATTEMPTS - used;
      return {
        status: "WRONG_CODE",
        reason: `Incorrect code. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
        attemptsLeft,
      };
    }

    codeAttempts.delete(key);
    return _markInvalid(sessionId, studentId, deviceId, submittedAt, submittedCode,
      "Incorrect attendance code entered");
  }

  // ── All checks passed → Create PRESENT record (Safely handling race conditions) ─────────────────────────────
  try {
    const attendance = await prisma.attendance.create({
      data: {
        sessionId: Number(sessionId),
        studentId: Number(studentId),
        status: "PRESENT",
        submittedCode,
        deviceId,
        submittedAt,
      },
    });
    codeAttempts.delete(`${sessionId}:${studentId}`);
    return { status: "PRESENT", attendance, facultyId: session.facultyId };
  } catch (error) {
    if (error.code === 'P2002') {
      console.warn(`[Attendance Warning] Prevented duplicate submission race condition for session ${sessionId}, student ${studentId}.`);
      const existingRecord = await prisma.attendance.findUnique({
        where: { sessionId_studentId: { sessionId: Number(sessionId), studentId: Number(studentId) } }
      });
      return { 
        status: existingRecord?.status || "PRESENT", 
        reason: "Attendance already submitted", 
        attendance: existingRecord 
      };
    }
    console.error(`[Attendance Error] DB error during submission:`, error);
    throw error;
  }
}

/**
 * Internal helper: create an INVALID attendance record and return a result.
 */
async function _markInvalid(
  sessionId, studentId, deviceId, submittedAt, submittedCode, reason
) {
  try {
    const attendance = await prisma.attendance.upsert({
      where: {
        sessionId_studentId: { sessionId: Number(sessionId), studentId: Number(studentId) },
      },
      create: {
        sessionId: Number(sessionId),
        studentId: Number(studentId),
        status: "INVALID",
        reason,
        submittedCode: submittedCode ? String(submittedCode) : null,
        deviceId: deviceId ?? null,
        submittedAt,
      },
      update: {}, // don't overwrite an existing PRESENT record
    });
    return { status: "INVALID", reason, attendance };
  } catch {
    return { status: "INVALID", reason };
  }
}

/**
 * Mark enrolled students who did not submit as ABSENT after a session ends.
 * Call this when a faculty member ends a session.
 * @param {number} sessionId
 * @returns {Promise<number[]>} Array of student IDs who were marked ABSENT
 */
async function markAbsentees(sessionId) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { subjectId: true },
  });
  if (!session) throw new Error("Session not found");

  // All enrolled and APPROVED students for this subject
  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId: session.subjectId, status: "APPROVED" },
    select: { studentId: true },
  });

  // Students who already submitted (PRESENT or INVALID)
  const submitted = await prisma.attendance.findMany({
    where: { sessionId },
    select: { studentId: true },
  });
  const submittedIds = new Set(submitted.map((a) => a.studentId));

  // Create ABSENT records for those who did NOT submit
  const absentees = enrollments.filter((e) => !submittedIds.has(e.studentId));

  if (absentees.length === 0) return [];

  await prisma.attendance.createMany({
    data: absentees.map((e) => ({
      sessionId,
      studentId: e.studentId,
      status: "ABSENT",
      reason: "Did not submit attendance",
    })),
    skipDuplicates: true,
  });

  return absentees.map((e) => e.studentId);
}

module.exports = { submitAttendance, markAbsentees };
