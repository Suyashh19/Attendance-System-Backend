/**
 * analyticsService.js
 * Attendance analytics and reporting utilities.
 */

const ExcelJS = require("exceljs");
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

async function getGlobalHistory(studentId) {
  return prisma.attendance.findMany({
    where: { studentId },
    include: {
      session: {
        include: {
          subject: {
            select: { name: true, code: true }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Generate an Excel matrix for subject attendance.
 * Columns: PRN, Name, Email, [Dates...]
 */
async function generateAttendanceMatrix(subjectId, filters = {}) {
  const { startDate, endDate, sessionIds } = filters;

  // 1. Fetch Subject & Enrolled Students
  const subject = await prisma.subject.findUnique({
    where: { id: Number(subjectId) },
    include: {
      enrollments: {
        include: {
          student: {
            select: { id: true, name: true, email: true, rollNo: true }
          }
        }
      }
    }
  });
  if (!subject) throw new Error("Subject not found");

  const students = subject.enrollments.map(e => e.student).sort((a, b) => a.name.localeCompare(b.name));

  // 2. Fetch Sessions for the subject
  const sessionQuery = {
    where: { 
      subjectId: Number(subjectId),
      isActive: false // Only closed sessions
    },
    orderBy: { startTime: "asc" }
  };

  if (sessionIds && sessionIds.length > 0) {
    sessionQuery.where.id = { in: sessionIds.map(Number) };
  } else if (startDate || endDate) {
    sessionQuery.where.startTime = {};
    if (startDate) sessionQuery.where.startTime.gte = new Date(startDate);
    if (endDate) sessionQuery.where.startTime.lte = new Date(endDate);
  }

  const sessions = await prisma.session.findMany(sessionQuery);

  // 3. Fetch Attendance Records
  const sessionIdsToFetch = sessions.map(s => s.id);
  const attendanceRecords = await prisma.attendance.findMany({
    where: { sessionId: { in: sessionIdsToFetch } }
  });

  // 4. Build Matrix Map: studentId -> sessionId -> status
  const matrix = {};
  attendanceRecords.forEach(record => {
    if (!matrix[record.studentId]) matrix[record.studentId] = {};
    matrix[record.studentId][record.sessionId] = record.status;
  });

  // 5. Create Excel Workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Attendance Report");

  // Define Columns
  const columns = [
    { header: "Roll No / PRN", key: "rollNo", width: 15 },
    { header: "Student Name", key: "name", width: 25 },
    { header: "Email", key: "email", width: 30 },
  ];

  // Add Date Columns
  sessions.forEach(session => {
    // Native JS format: dd/MM/yy HH:mm
    const d = new Date(session.startTime);
    const headerDate = `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear().toString().slice(-2)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    
    columns.push({ header: headerDate, key: `s_${session.id}`, width: 15 });
  });

  worksheet.columns = columns;

  // Add Rows
  students.forEach(student => {
    const row = {
      rollNo: student.rollNo || "N/A",
      name: student.name,
      email: student.email,
    };

    sessions.forEach(session => {
      const status = matrix[student.id]?.[session.id] || "ABSENT";
      row[`s_${session.id}`] = status;
    });

    const addedRow = worksheet.addRow(row);
    
    // Style alignment & colors
    sessions.forEach((session, idx) => {
      const cell = addedRow.getCell(idx + 4); // Columns 1-3 are info
      if (cell.value === "PRESENT") {
        cell.font = { color: { argb: "FF065F46" }, bold: true }; // dark green
      } else if (cell.value === "INVALID") {
        cell.font = { color: { argb: "FF991B1B" }, bold: true }; // dark red
      } else {
        cell.font = { color: { argb: "FF64748B" } }; // muted slate
      }
    });
  });

  // Style Header Row
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { horizontal: "center" };

  return workbook.xlsx.writeBuffer();
}

module.exports = { 
  getAttendanceSummary, 
  getStudentRecord, 
  getGlobalHistory,
  generateAttendanceMatrix 
};

