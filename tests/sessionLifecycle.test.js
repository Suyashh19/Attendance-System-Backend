const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers/mockModules");

const SESSION_ID = 42;
const SUBJECT_ID = 5;

// Two approved students: one already PRESENT, one who never submitted
function buildPrisma() {
  const session = {
    id: SESSION_ID,
    subjectId: SUBJECT_ID,
    isActive: true,
    endTime: null,
    subject: { name: "Distributed Systems", code: "CS402" },
  };
  const attendances = [{ sessionId: SESSION_ID, studentId: 1, status: "PRESENT", reason: null, editedByFaculty: false }];
  const enrollments = [
    { studentId: 1, student: { id: 1, name: "Asha", prn: "P1", rollNo: null, pushToken: null } },
    { studentId: 2, student: { id: 2, name: "Ravi", prn: "P2", rollNo: null, pushToken: null } },
  ];

  return {
    sessionRow: session,
    attendances,
    session: {
      updateMany: async ({ where, data }) => {
        if (where.id !== session.id || !session.isActive) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      },
      findUnique: async () => session,
      findMany: async () => (session.isActive ? [session] : []),
    },
    enrollment: {
      findMany: async () => enrollments,
    },
    attendance: {
      findMany: async () => attendances,
      createMany: async ({ data }) => {
        attendances.push(...data);
        return { count: data.length };
      },
    },
  };
}

test("finalizing a session closes it, marks absentees and returns the roster", async () => {
  const prisma = buildPrisma();
  const { load, emitted } = setup(prisma);
  const { finalizeSession } = load("services/sessionLifecycle.js");

  const result = await finalizeSession(SESSION_ID);

  assert.equal(prisma.sessionRow.isActive, false);
  assert.ok(prisma.sessionRow.endTime instanceof Date);
  assert.equal(result.alreadyClosed, false);
  assert.equal(result.markedAbsent, 1);

  const byStudent = Object.fromEntries(result.attendances.map((a) => [a.studentId, a]));
  assert.equal(byStudent[1].status, "PRESENT");
  assert.equal(byStudent[2].status, "ABSENT");
  assert.equal(byStudent[2].student.name, "Ravi");
  assert.ok(!("pushToken" in byStudent[1].student), "push tokens must not be sent to the faculty app");

  assert.ok(emitted.some((e) => e.event === "session_ended" && e.room === `subject_${SUBJECT_ID}`));
  assert.equal(emitted.filter((e) => e.event === "attendance_result").length, 2);
});

test("finalizing twice does not mark absentees or notify again", async () => {
  const prisma = buildPrisma();
  const { load, emitted } = setup(prisma);
  const { finalizeSession } = load("services/sessionLifecycle.js");

  await finalizeSession(SESSION_ID);
  const recordsAfterFirst = prisma.attendances.length;
  const eventsAfterFirst = emitted.length;

  const second = await finalizeSession(SESSION_ID);

  assert.equal(second.alreadyClosed, true);
  assert.equal(second.markedAbsent, 0);
  assert.equal(second.attendances.length, 2, "the roster is still returned for the summary screen");
  assert.equal(prisma.attendances.length, recordsAfterFirst);
  assert.equal(emitted.length, eventsAfterFirst);
});

test("a silent close (leftover session) does not notify students", async () => {
  const prisma = buildPrisma();
  const { load, emitted } = setup(prisma);
  const { finalizeSession } = load("services/sessionLifecycle.js");

  const result = await finalizeSession(SESSION_ID, { notify: false });

  assert.equal(result.markedAbsent, 1);
  assert.equal(emitted.length, 0);
});

test("session history never includes the attendance code", async () => {
  const prisma = {
    session: {
      findMany: async ({ select }) => {
        assert.ok(!select.correctCode, "correctCode must not be selected");
        return [{ id: 1, subjectId: SUBJECT_ID, isActive: false, _count: { attendances: 3 } }];
      },
    },
  };
  const { getSessionHistory } = setup(prisma).load("services/sessionService.js");

  const history = await getSessionHistory(SUBJECT_ID);

  assert.equal(history[0].attendanceCount, 3);
  assert.ok(!("correctCode" in history[0]));
});
