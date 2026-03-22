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

const TIME_LIMIT_SECONDS = 15;
const LOCATION_RADIUS_METRES = 50;

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
 * @returns {Promise<{ status: string, reason?: string, attendance: Object }>}
 */
async function submitAttendance({
  sessionId,
  studentId,
  selectedCode,
  deviceId,
  latitude,
  longitude,
}) {
  const submittedAt = new Date();

  // ── Layer 1: Session active check ──────────────────────────────────────────
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

  // ── Layer 2: Enrollment validation ────────────────────────────────────────
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, subjectId: session.subjectId },
  });
  if (!enrollment) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Student is not enrolled in this subject");
  }

  // ── Layer 3: Duplicate submission check ─────────────────────────────────––
  const existing = await prisma.attendance.findFirst({
    where: { sessionId, studentId },
  });
  if (existing) {
    return {
      status: existing.status,
      reason: "Attendance already submitted for this session",
      attendance: existing,
    };
  }

  // ── Layer 4: Device ID validation ─────────────────────────────────────────
  const deviceCheck = await validateDevice(studentId, deviceId);
  if (!deviceCheck.valid) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      deviceCheck.reason);
  }

  // ── Layer 5: Time-bound check (≤ 15 seconds from session start) ───────────
  const elapsedSeconds = (submittedAt.getTime() - new Date(session.startTime).getTime()) / 1000;
  if (elapsedSeconds > TIME_LIMIT_SECONDS) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      `Response too late (${Math.round(elapsedSeconds)}s elapsed, limit is ${TIME_LIMIT_SECONDS}s)`);
  }

  // ── Layer 6: GPS proximity check (≤ 50 m) ─────────────────────────────────
  if (session.latitude !== null && session.longitude !== null) {
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
        "GPS location is required for this session");
    }

    const { valid: locationValid, distance } = isWithinRadius(
      session.latitude,
      session.longitude,
      latitude,
      longitude,
      LOCATION_RADIUS_METRES
    );

    if (!locationValid) {
      return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
        `Location out of range (${distance}m from session, limit is ${LOCATION_RADIUS_METRES}m)`);
    }
  }

  // ── Layer 7: Correct code validation ──────────────────────────────────────
  if (String(selectedCode) !== String(session.correctCode)) {
    return _markInvalid(sessionId, studentId, deviceId, latitude, longitude, submittedAt, selectedCode,
      "Incorrect attendance code selected");
  }

  // ── All checks passed → PRESENT ───────────────────────────────────────────
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

module.exports = { submitAttendance, markAbsentees };
