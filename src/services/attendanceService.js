/**
 * attendanceService.js
 *
 * Core multi-layer verification pipeline for intelligent attendance submission.
 *
 * Layers (executed in order):
 *   1. Session active check
 *   2. Enrollment validation
 *   3. Device ID validation
 *   4. Time-bound check (≤ 15 seconds from session start)
 *   5. GPS proximity check (≤ 50 m from session location)
 *   6. Correct code validation
 *
 * Returns: { status: "PRESENT"|"INVALID", reason?: string, attendance }
 */

const prisma = require("../config/db");
const { validateDevice } = require("./deviceService");
const { isWithinRadius } = require("./locationService");

const TIME_LIMIT_SECONDS = 20;
const LOCATION_RADIUS_METRES = 80;

/**
 * Submit and verify a student's attendance.
 *
 * @param {Object} params
 * @param {number} params.sessionId
 * @param {number} params.studentId
 * @param {string} params.selectedCode
 * @param {string} params.deviceId
 * @param {number} params.latitude
 * @param {number} params.longitude
 * @param {number} [params.accuracy]      - GPS accuracy (metres)
 * @returns {Promise<{ status: string, reason?: string, attendance: Object }>}
 */
async function submitAttendance({
  sessionId,
  studentId,
  selectedCode,
  deviceId,
  latitude,
  longitude,
  accuracy,
}) {
  const submittedAt = new Date();

  // ── Optimization: Parallel fetch for basic requirements ───────────────────
  // We fetch the session first because we need the subjectId to check enrollment in the next step.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { subject: { select: { id: true, name: true, code: true } } },
  });

  if (!session) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Session does not exist");
  }
  if (!session.isActive) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Session is no longer active");
  }

  // ── Optimization: Fetch enrollment, existing attendance, and user device in ONE parallel block ──
  const [enrollment, existing, user] = await Promise.all([
    prisma.enrollment.findFirst({
      where: { studentId, subjectId: session.subjectId },
    }),
    prisma.attendance.findFirst({
      where: { sessionId, studentId },
    }),
    prisma.user.findUnique({
      where: { id: studentId },
      select: { id: true, deviceId: true },
    })
  ]);

  // ── Layer 2: Enrollment validation ────────────────────────────────────────
  if (!enrollment) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Student is not enrolled in this subject");
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
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      deviceCheck.reason);
  }

  // ─── Layer 5: Time-bound check (Strict windowExpiry from DB) ──────────────
  // We add a tiny 2-second grace period purely for network transit.
  const gracePeriodMs = 2000;
  const expiryTime = new Date(session.windowExpiry).getTime() + gracePeriodMs;

  if (submittedAt.getTime() > expiryTime) {
    const overdue = Math.round((submittedAt.getTime() - expiryTime) / 1000);
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      `Attendance window expired (${overdue}s ago)`);
  }

  // ── Layer 6: GPS proximity check (radius check with accuracy handling) ────
  if (session.latitude !== null && session.longitude !== null) {
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
        "GPS location is required for this session");
    }

    const { valid: locationValid, distance, effectiveAccuracy } = isWithinRadius(
      session.latitude,
      session.longitude,
      latitude,
      longitude,
      accuracy,
      LOCATION_RADIUS_METRES
    );

    if (!locationValid) {
      return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
        `Location out of range (~${distance}m away). GPS drift adjusted by ${effectiveAccuracy}m.`);
    }
  }

  // ── Layer 7: Correct code validation ──────────────────────────────────────
  if (String(selectedCode) !== String(session.correctCode)) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Incorrect attendance code selected");
  }

  // ── All checks passed → Create PRESENT record ─────────────────────────────
  const attendance = await prisma.attendance.create({
    data: {
      sessionId,
      studentId,
      status: "PRESENT",
      submittedCode: String(selectedCode),
      deviceId,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      submittedAt,
    },
  });

  return { status: "PRESENT", attendance };
}

/**
 * Internal helper: create an INVALID attendance record and return a result.
 */
async function _markInvalid(
  sessionId, studentId, deviceId, latitude, longitude, submittedAt, submittedCode, reason
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
        latitude: latitude ?? null,
        longitude: longitude ?? null,
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

  // All enrolled students for this subject
  const enrollments = await prisma.enrollment.findMany({
    where: { subjectId: session.subjectId },
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

  if (absentees.length === 0) return 0;

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

/**
 * Delete all attendance records for a student in a specific subject.
 */
async function deleteSubjectHistory(studentId, subjectId) {
  return prisma.attendance.deleteMany({
    where: {
      studentId: Number(studentId),
      session: { subjectId: Number(subjectId) }
    }
  });
}

module.exports = { submitAttendance, markAbsentees, deleteSubjectHistory };
