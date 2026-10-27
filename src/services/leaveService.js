/**
 * leaveService.js
 * Leave requests: validating them, and turning approved leave into EXCUSED attendance.
 *
 * Days are "YYYY-MM-DD" strings in the college's time zone, so a class held at 11 pm UTC
 * still falls on the right local day. String comparison orders them correctly.
 */

const prisma = require("../config/db");

const REPORT_TIMEZONE = process.env.REPORT_TIMEZONE || "Asia/Kolkata";

const MAX_LEAVE_DAYS = 30;
const MAX_DAYS_BACK = 7;
const MAX_DAYS_AHEAD = 90;
const MAX_SUBJECTS = 20;
const MIN_REASON_LENGTH = 3;
const MAX_REASON_LENGTH = 300;
const MAX_NOTE_LENGTH = 200;

const EXCUSED_REASON = "On approved leave";
const ABSENT_REASON = "Did not submit attendance";

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The college-local calendar day of a moment, as YYYY-MM-DD. */
function localDay(date, timeZone = REPORT_TIMEZONE) {
  // The en-CA locale prints dates as YYYY-MM-DD
  return new Date(date).toLocaleDateString("en-CA", { timeZone });
}

function isRealDay(day) {
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function dayNumber(day) {
  return Math.round(new Date(`${day}T00:00:00Z`).getTime() / DAY_MS);
}

/**
 * Checks a new leave request. Returns { error } or { value } with cleaned fields.
 * @param {{ subjectIds: any, fromDate: any, toDate: any, reason: any }} input
 * @param {string} today - the local day "now", passed in so tests are not tied to the clock
 */
function validateLeaveInput(input, today) {
  const { subjectIds, fromDate, toDate, reason } = input || {};

  if (!Array.isArray(subjectIds) || subjectIds.length === 0) {
    return { error: "Choose at least one subject" };
  }
  const ids = [...new Set(subjectIds.map(Number))];
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) return { error: "Invalid subject" };
  if (ids.length > MAX_SUBJECTS) return { error: `Choose at most ${MAX_SUBJECTS} subjects` };

  if (!isRealDay(fromDate) || !isRealDay(toDate)) return { error: "Choose valid from and to dates" };
  if (toDate < fromDate) return { error: "The last day cannot be before the first day" };

  if (dayNumber(today) - dayNumber(fromDate) > MAX_DAYS_BACK) {
    return { error: `Leave can start at most ${MAX_DAYS_BACK} days in the past` };
  }
  if (dayNumber(toDate) - dayNumber(today) > MAX_DAYS_AHEAD) {
    return { error: `Leave cannot end more than ${MAX_DAYS_AHEAD} days from now` };
  }
  if (dayNumber(toDate) - dayNumber(fromDate) + 1 > MAX_LEAVE_DAYS) {
    return { error: `A single request can cover at most ${MAX_LEAVE_DAYS} days` };
  }

  const text = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
  if (text.length < MIN_REASON_LENGTH) return { error: "Please give a reason for the leave" };

  return {
    value: { subjectIds: ids, fromDate, toDate, reason: text.slice(0, MAX_REASON_LENGTH) },
  };
}

function cleanNote(note) {
  if (typeof note !== "string") return null;
  const text = note.trim().replace(/\s+/g, " ");
  return text ? text.slice(0, MAX_NOTE_LENGTH) : null;
}

/** True when two inclusive day ranges share at least one day. */
function overlaps(a, b) {
  return a.fromDate <= b.toDate && a.toDate >= b.fromDate;
}

/** Students with approved leave covering a day in a subject. */
async function approvedLeaveStudentIds(subjectId, day) {
  const leaves = await prisma.leaveRequest.findMany({
    where: { subjectId, status: "APPROVED", fromDate: { lte: day }, toDate: { gte: day } },
    select: { studentId: true },
  });
  return new Set(leaves.map((l) => l.studentId));
}

/** Closed sessions of a subject held on a day inside the leave. */
async function sessionsInLeave(leave) {
  // A day either side of the dates keeps the query simple; the exact local day is checked below
  const from = new Date(`${leave.fromDate}T00:00:00Z`);
  const to = new Date(`${leave.toDate}T00:00:00Z`);
  const sessions = await prisma.session.findMany({
    where: {
      subjectId: leave.subjectId,
      isActive: false,
      startTime: { gte: new Date(from.getTime() - DAY_MS), lte: new Date(to.getTime() + 2 * DAY_MS) },
    },
    select: { id: true, startTime: true },
  });
  return sessions.filter((s) => {
    const day = localDay(s.startTime);
    return day >= leave.fromDate && day <= leave.toDate;
  });
}

/**
 * Approved leave: the student's missed classes in that period become EXCUSED.
 * Only automatic ABSENT records change; a record the faculty edited by hand, and any
 * PRESENT or INVALID record, stays as it is.
 * @returns {Promise<number>} how many classes were excused
 */
async function excuseSessionsForLeave(leave) {
  const sessions = await sessionsInLeave(leave);
  if (sessions.length === 0) return 0;

  const result = await prisma.attendance.updateMany({
    where: {
      studentId: leave.studentId,
      sessionId: { in: sessions.map((s) => s.id) },
      status: "ABSENT",
      editedByFaculty: false,
    },
    data: { status: "EXCUSED", reason: EXCUSED_REASON },
  });
  return result.count;
}

/**
 * Leave withdrawn after approval: the classes it excused count as absences again.
 * @returns {Promise<number>}
 */
async function restoreSessionsForLeave(leave) {
  const sessions = await sessionsInLeave(leave);
  if (sessions.length === 0) return 0;

  const result = await prisma.attendance.updateMany({
    where: {
      studentId: leave.studentId,
      sessionId: { in: sessions.map((s) => s.id) },
      status: "EXCUSED",
      reason: EXCUSED_REASON,
      editedByFaculty: false,
    },
    data: { status: "ABSENT", reason: ABSENT_REASON },
  });
  return result.count;
}

module.exports = {
  EXCUSED_REASON,
  MAX_LEAVE_DAYS,
  approvedLeaveStudentIds,
  cleanNote,
  excuseSessionsForLeave,
  isRealDay,
  localDay,
  overlaps,
  restoreSessionsForLeave,
  validateLeaveInput,
};
