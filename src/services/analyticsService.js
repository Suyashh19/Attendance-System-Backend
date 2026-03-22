/**
 * analyticsService.js
 * Attendance analytics and reporting utilities.
 */

const prisma = require("../config/db");

/**
 * Get overall attendance summary for a subject.
 * Returns per-student: total sessions, present, absent, invalid, percentage.
 *
 * @param {number} subjectId
 * @returns {Promise<Object>}
 */
async function getAttendanceSummary(subjectId) {
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: { name: true, code: true, facultyId: true },
  });
  if (!subject) throw new Error("Subject not found");

  // Count total closed sessions
  const totalSessions = await prisma.session.count({
    where: { subjectId, isActive: false },
  });

  // Aggregate per student
  const records = await prisma.attendance.groupBy({
    by: ["studentId", "status"],
    where: { session: { subjectId } },
    _count: { status: true },
  });

  // Pivot into studentId → { PRESENT, ABSENT, INVALID }
  const pivot = {};
  for (const r of records) {
    if (!pivot[r.studentId]) {
      pivot[r.studentId] = { PRESENT: 0, ABSENT: 0, INVALID: 0 };
    }
    pivot[r.studentId][r.status] = r._count.status;
  }

  // Fetch student info
  const studentIds = Object.keys(pivot).map(Number);
  const students = await prisma.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, name: true, email: true, rollNo: true },
  });

  const summary = students.map((s) => {
    const counts = pivot[s.id] || { PRESENT: 0, ABSENT: 0, INVALID: 0 };
    const attended = counts.PRESENT || 0;
    const absents = counts.ABSENT || 0;
    const invalids = counts.INVALID || 0;
    
    // Total sessions calculated as sum of present, absent, invalid for this student,
    // OR the overall total sessions - whichever makes more sense
    // Usually total attendance records per student = total closed sessions they were enrolled for.
    const studentTotal = attended + absents + invalids;
    
    const percentage = studentTotal > 0 ? ((attended / studentTotal) * 100).toFixed(1) : "0.0";
    
    return { 
      ...s, 
      PRESENT: attended, 
      ABSENT: absents, 
      INVALID: invalids, 
      totalSessions: studentTotal, 
      attendancePercentage: `${percentage}%` 
    };
  });

  return { subject, totalSessions, summary };
}

/**
 * Get a single student's attendance record for a specific subject.
 *
 * @param {number} studentId
 * @param {number} subjectId
 * @returns {Promise<Object>}
 */
async function getStudentRecord(studentId, subjectId) {
  const attendances = await prisma.attendance.findMany({
    where: { studentId, session: { subjectId } },
    include: {
      session: {
        select: { id: true, startTime: true, endTime: true, isActive: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const totalSessions = await prisma.session.count({
    where: { subjectId, isActive: false },
  });

  const counts = { PRESENT: 0, ABSENT: 0, INVALID: 0 };
  for (const a of attendances) counts[a.status] = (counts[a.status] || 0) + 1;

  const percentage = totalSessions > 0 ? ((counts.PRESENT / totalSessions) * 100).toFixed(1) : "0.0";

  return {
    studentId,
    subjectId,
    totalSessions,
    PRESENT: counts.PRESENT,
    ABSENT: counts.ABSENT,
    INVALID: counts.INVALID,
    attendancePercentage: `${percentage}%`,
    records: attendances,
  };
}

module.exports = { getAttendanceSummary, getStudentRecord };
