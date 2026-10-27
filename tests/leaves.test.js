const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, mockResponse } = require("./helpers/mockModules");

const STUDENT_ID = 1;
const OTHER_STUDENT_ID = 2;
const FACULTY_ID = 7;
const OTHER_FACULTY_ID = 8;

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);

// ─── A small in-memory stand-in for the database ─────────────────────────────

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("in" in cond && !cond.in.includes(row[key])) return false;
      if ("lte" in cond && !(row[key] <= cond.lte)) return false;
      if ("gte" in cond && !(row[key] >= cond.gte)) return false;
      return true;
    }
    return row[key] === cond;
  });
}

function buildPrisma({ leaves = [], sessions = [], attendances = [] } = {}) {
  const subjects = [
    { id: 10, name: "Data Structures", code: "CS201", type: "theory", facultyId: FACULTY_ID, faculty: { pushToken: null } },
    { id: 11, name: "Networks", code: "CN301", type: "theory", facultyId: FACULTY_ID, faculty: { pushToken: null } },
    { id: 12, name: "Compilers", code: "CS402", type: "theory", facultyId: OTHER_FACULTY_ID, faculty: { pushToken: null } },
  ];
  const enrollments = [
    { studentId: STUDENT_ID, subjectId: 10, status: "APPROVED" },
    { studentId: STUDENT_ID, subjectId: 11, status: "APPROVED" },
    { studentId: STUDENT_ID, subjectId: 12, status: "PENDING" },
    { studentId: OTHER_STUDENT_ID, subjectId: 10, status: "APPROVED" },
  ];
  const students = [
    { id: STUDENT_ID, name: "Asha", rollNo: "1", prn: "P1", pushToken: null },
    { id: OTHER_STUDENT_ID, name: "Ravi", rollNo: "2", prn: "P2", pushToken: null },
  ];
  const rows = leaves.map((l, i) => ({ id: i + 1, status: "PENDING", reviewNote: null, createdAt: new Date(2026, 9, 20 + i), ...l }));

  const withRelations = (row, include) => {
    if (!row) return row;
    const out = { ...row };
    if (include?.subject) out.subject = subjects.find((s) => s.id === row.subjectId);
    if (include?.student) out.student = students.find((s) => s.id === row.studentId);
    return out;
  };

  return {
    rows,
    attendances,
    subject: {
      findFirst: async ({ where }) => subjects.find((s) => matches(s, where)) || null,
    },
    user: {
      findUnique: async ({ where }) => students.find((s) => s.id === where.id) || null,
    },
    enrollment: {
      findMany: async ({ where }) =>
        enrollments
          .filter((e) => matches(e, where))
          .map((e) => ({ ...e, subject: subjects.find((s) => s.id === e.subjectId) })),
    },
    session: {
      findMany: async ({ where }) => sessions.filter((s) => matches(s, where)),
    },
    attendance: {
      updateMany: async ({ where, data }) => {
        const hit = attendances.filter((a) => matches(a, where));
        hit.forEach((a) => Object.assign(a, data));
        return { count: hit.length };
      },
    },
    leaveRequest: {
      findMany: async ({ where, include }) => rows.filter((r) => matches(r, where)).map((r) => withRelations(r, include)),
      findUnique: async ({ where, include }) => withRelations(rows.find((r) => r.id === where.id), include) || null,
      create: async ({ data }) => {
        const row = { id: rows.length + 1, status: "PENDING", reviewNote: null, createdAt: new Date(), ...data };
        rows.push(row);
        return { ...row };
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    $transaction: async (ops) => Promise.all(ops),
  };
}

async function call(prisma, handler, { params = {}, body = {}, user }) {
  const { load } = setup(prisma);
  const controller = load("controllers/leaveController.js");
  const res = mockResponse();
  await controller[handler]({ params, body, user }, res, (err) => { throw err; });
  return res;
}

const student = (userId = STUDENT_ID) => ({ userId, role: "student" });
const faculty = (userId = FACULTY_ID) => ({ userId, role: "faculty" });

function today() {
  return setup(buildPrisma()).load("services/leaveService.js").localDay(new Date());
}

// ─── Checking a request ──────────────────────────────────────────────────────

test("a request is checked: subjects, real dates, order, limits and a reason", () => {
  const { validateLeaveInput } = setup(buildPrisma()).load("services/leaveService.js");
  const base = { subjectIds: [10, 11], fromDate: "2026-10-27", toDate: "2026-10-29", reason: "  Fever   and rest " };

  const ok = validateLeaveInput(base, "2026-10-27");
  assert.deepEqual(ok.value, { subjectIds: [10, 11], fromDate: "2026-10-27", toDate: "2026-10-29", reason: "Fever and rest" });

  const bad = (patch, text) => assert.match(validateLeaveInput({ ...base, ...patch }, "2026-10-27").error, text);
  bad({ subjectIds: [] }, /at least one subject/);
  bad({ subjectIds: ["x"] }, /Invalid subject/);
  bad({ fromDate: "2026-02-30" }, /valid from and to/);
  bad({ fromDate: "27/10/2026" }, /valid from and to/);
  bad({ toDate: "2026-10-26" }, /cannot be before/);
  bad({ fromDate: "2026-10-10", toDate: "2026-10-11" }, /in the past/);
  bad({ fromDate: "2026-11-01", toDate: "2027-03-01" }, /from now|at most 30/);
  bad({ fromDate: "2026-10-27", toDate: "2026-12-05" }, /at most 30 days/);
  bad({ reason: "  " }, /reason/);
});

test("leave may start up to a week back, and a one-day request is fine", () => {
  const { validateLeaveInput } = setup(buildPrisma()).load("services/leaveService.js");
  const input = (from, to) => ({ subjectIds: [10], fromDate: from, toDate: to, reason: "Medical" });
  assert.ok(validateLeaveInput(input("2026-10-20", "2026-10-20"), "2026-10-27").value);
  assert.ok(validateLeaveInput(input("2026-10-27", "2026-10-27"), "2026-10-27").value);
  assert.ok(validateLeaveInput(input("2026-10-19", "2026-10-19"), "2026-10-27").error);
});

test("a class late in the evening UTC falls on the next local day", () => {
  const { localDay } = setup(buildPrisma()).load("services/leaveService.js");
  assert.equal(localDay(new Date("2026-10-27T20:00:00Z")), "2026-10-28");
  assert.equal(localDay(new Date("2026-10-27T05:00:00Z")), "2026-10-27");
});

// ─── Student applies ─────────────────────────────────────────────────────────

test("applying creates one waiting request per subject and tells the faculty", async () => {
  const prisma = buildPrisma();
  const day = today();
  const { load, emitted } = setup(prisma);
  const controller = load("controllers/leaveController.js");
  const res = mockResponse();

  await controller.applyForLeave(
    { user: student(), body: { subjectIds: [10, 11], fromDate: day, toDate: addDays(day, 1), reason: "Fever" } },
    res,
    (err) => { throw err; }
  );

  assert.equal(res.statusCode, 201);
  assert.equal(prisma.rows.length, 2);
  assert.ok(prisma.rows.every((r) => r.status === "PENDING" && r.studentId === STUDENT_ID));
  assert.deepEqual(prisma.rows.map((r) => r.subjectId), [10, 11]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(emitted.filter((e) => e.event === "leave_updated" && e.room === `user_${FACULTY_ID}`).length, 1, "one nudge per faculty member");
});

test("applying for a subject the student is not approved in is refused", async () => {
  const day = today();
  const res = await call(buildPrisma(), "applyForLeave", {
    user: student(),
    body: { subjectIds: [10, 12], fromDate: day, toDate: day, reason: "Fever" },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /enrolled/);
});

test("a second request over the same days in a subject is refused", async () => {
  const day = today();
  const prisma = buildPrisma({ leaves: [{ studentId: STUDENT_ID, subjectId: 10, fromDate: day, toDate: addDays(day, 2), status: "APPROVED" }] });
  const res = await call(prisma, "applyForLeave", {
    user: student(),
    body: { subjectIds: [10], fromDate: addDays(day, 2), toDate: addDays(day, 3), reason: "More rest" },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Data Structures/);
  assert.equal(prisma.rows.length, 1);
});

test("a rejected or withdrawn request does not block a new one", async () => {
  const day = today();
  const prisma = buildPrisma({ leaves: [
    { studentId: STUDENT_ID, subjectId: 10, fromDate: day, toDate: day, status: "REJECTED" },
    { studentId: STUDENT_ID, subjectId: 10, fromDate: day, toDate: day, status: "CANCELLED" },
  ] });
  const res = await call(prisma, "applyForLeave", {
    user: student(),
    body: { subjectIds: [10], fromDate: day, toDate: day, reason: "Try again" },
  });
  assert.equal(res.statusCode, 201);
});

test("a student can withdraw only their own waiting request", async () => {
  const day = today();
  const prisma = buildPrisma({ leaves: [
    { studentId: STUDENT_ID, subjectId: 10, fromDate: day, toDate: day },
    { studentId: STUDENT_ID, subjectId: 11, fromDate: day, toDate: day, status: "APPROVED" },
    { studentId: OTHER_STUDENT_ID, subjectId: 10, fromDate: day, toDate: day },
  ] });

  const ok = await call(prisma, "cancelLeave", { user: student(), params: { id: "1" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(prisma.rows[0].status, "CANCELLED");

  assert.equal((await call(prisma, "cancelLeave", { user: student(), params: { id: "2" } })).statusCode, 400);
  assert.equal((await call(prisma, "cancelLeave", { user: student(), params: { id: "3" } })).statusCode, 404);
});

// ─── Faculty reviews ─────────────────────────────────────────────────────────

const SESSION_DAY = "2026-10-27";
const sessionsOn = () => [
  { id: 100, subjectId: 10, isActive: false, startTime: new Date("2026-10-26T05:00:00Z") }, // 26 Oct
  { id: 101, subjectId: 10, isActive: false, startTime: new Date("2026-10-27T05:00:00Z") }, // 27 Oct
  { id: 102, subjectId: 10, isActive: false, startTime: new Date("2026-10-28T05:00:00Z") }, // 28 Oct
  { id: 103, subjectId: 10, isActive: false, startTime: new Date("2026-10-30T05:00:00Z") }, // outside the leave
];
const attendanceRows = () => [
  { sessionId: 100, studentId: STUDENT_ID, status: "ABSENT", reason: "Did not submit attendance", editedByFaculty: false },
  { sessionId: 101, studentId: STUDENT_ID, status: "ABSENT", reason: "Did not submit attendance", editedByFaculty: false },
  { sessionId: 102, studentId: STUDENT_ID, status: "PRESENT", reason: null, editedByFaculty: false },
  { sessionId: 103, studentId: STUDENT_ID, status: "ABSENT", reason: "Did not submit attendance", editedByFaculty: false },
  { sessionId: 101, studentId: OTHER_STUDENT_ID, status: "ABSENT", reason: "Did not submit attendance", editedByFaculty: false },
];

function leaveFixture() {
  return buildPrisma({
    leaves: [{ studentId: STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-28" }],
    sessions: sessionsOn(),
    attendances: attendanceRows(),
  });
}

test("approving excuses the missed classes in the period and nothing else", async () => {
  const prisma = leaveFixture();
  const res = await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "APPROVED", note: "Get well soon" } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.excused, 1);
  assert.equal(prisma.rows[0].status, "APPROVED");
  assert.equal(prisma.rows[0].reviewNote, "Get well soon");

  const status = (sessionId, studentId = STUDENT_ID) =>
    prisma.attendances.find((a) => a.sessionId === sessionId && a.studentId === studentId).status;
  assert.equal(status(100), "ABSENT", "before the leave");
  assert.equal(status(101), "EXCUSED", "inside the leave");
  assert.equal(status(102), "PRESENT", "a class the student attended stays present");
  assert.equal(status(103), "ABSENT", "after the leave");
  assert.equal(status(101, OTHER_STUDENT_ID), "ABSENT", "another student is untouched");
});

test("a record the faculty edited by hand is left alone", async () => {
  const prisma = leaveFixture();
  prisma.attendances[1].editedByFaculty = true;
  const res = await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "APPROVED" } });
  assert.equal(res.body.excused, 0);
  assert.equal(prisma.attendances[1].status, "ABSENT");
});

test("rejecting a request changes no attendance", async () => {
  const prisma = leaveFixture();
  const res = await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "REJECTED", note: "Needs a certificate" } });
  assert.equal(res.statusCode, 200);
  assert.equal(prisma.rows[0].status, "REJECTED");
  assert.ok(prisma.attendances.every((a) => a.status !== "EXCUSED"));
});

test("withdrawing an approval turns the excused classes back into absences", async () => {
  const prisma = leaveFixture();
  await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "APPROVED" } });
  const res = await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "REJECTED" } });

  assert.equal(res.body.restored, 1);
  assert.equal(prisma.attendances[1].status, "ABSENT");
  assert.equal(prisma.attendances[1].reason, "Did not submit attendance");
});

test("only the subject's faculty can review; a withdrawn request cannot be reviewed", async () => {
  const prisma = leaveFixture();
  const stranger = await call(prisma, "reviewLeave", { user: faculty(OTHER_FACULTY_ID), params: { id: "1" }, body: { status: "APPROVED" } });
  assert.equal(stranger.statusCode, 403);

  prisma.rows[0].status = "CANCELLED";
  const cancelled = await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "APPROVED" } });
  assert.equal(cancelled.statusCode, 400);

  assert.equal((await call(prisma, "reviewLeave", { user: faculty(), params: { id: "1" }, body: { status: "MAYBE" } })).statusCode, 400);
  assert.equal((await call(prisma, "reviewLeave", { user: faculty(), params: { id: "99" }, body: { status: "APPROVED" } })).statusCode, 404);
});

test("approve all approves every waiting request for the subject and excuses their classes", async () => {
  const prisma = buildPrisma({
    leaves: [
      { studentId: STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-28" },
      { studentId: OTHER_STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-27" },
      { studentId: STUDENT_ID, subjectId: 11, fromDate: "2026-10-27", toDate: "2026-10-27" }, // another subject
      { studentId: OTHER_STUDENT_ID, subjectId: 10, fromDate: "2026-10-01", toDate: "2026-10-02", status: "REJECTED" },
    ],
    sessions: sessionsOn(),
    attendances: attendanceRows(),
  });

  const res = await call(prisma, "approveAllLeaves", { user: faculty(), params: { subjectId: "10" } });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.approved, 2);
  assert.deepEqual(prisma.rows.map((r) => r.status), ["APPROVED", "APPROVED", "PENDING", "REJECTED"]);
  assert.equal(res.body.excused, 2);
  assert.equal(prisma.attendances.find((a) => a.sessionId === 101 && a.studentId === OTHER_STUDENT_ID).status, "EXCUSED");

  const stranger = await call(prisma, "approveAllLeaves", { user: faculty(OTHER_FACULTY_ID), params: { subjectId: "10" } });
  assert.equal(stranger.statusCode, 403);
});

test("approve all with nothing waiting says so", async () => {
  const res = await call(buildPrisma(), "approveAllLeaves", { user: faculty(), params: { subjectId: "10" } });
  assert.equal(res.body.approved, 0);
});

test("the faculty's list shows waiting requests first, with a count", async () => {
  const prisma = buildPrisma({ leaves: [
    { studentId: STUDENT_ID, subjectId: 10, fromDate: "2026-10-01", toDate: "2026-10-02", status: "APPROVED" },
    { studentId: OTHER_STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-27" },
    { studentId: STUDENT_ID, subjectId: 10, fromDate: "2026-10-05", toDate: "2026-10-05", status: "CANCELLED" },
  ] });

  const res = await call(prisma, "getSubjectLeaves", { user: faculty(), params: { subjectId: "10" } });

  assert.equal(res.body.pending, 1);
  assert.deepEqual(res.body.leaves.map((l) => l.status), ["PENDING", "APPROVED"], "withdrawn requests are not listed");
  assert.equal(res.body.leaves[0].student.name, "Ravi");

  assert.equal((await call(prisma, "getSubjectLeaves", { user: faculty(OTHER_FACULTY_ID), params: { subjectId: "10" } })).statusCode, 403);
});

test("a student sees only their own requests", async () => {
  const prisma = buildPrisma({ leaves: [
    { studentId: STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-27" },
    { studentId: OTHER_STUDENT_ID, subjectId: 10, fromDate: "2026-10-27", toDate: "2026-10-27" },
  ] });
  const res = await call(prisma, "getMyLeaves", { user: student() });
  assert.equal(res.body.leaves.length, 1);
  assert.equal(res.body.leaves[0].subject.name, "Data Structures");
});

// ─── Excused classes and percentages ─────────────────────────────────────────

test("excused classes do not count toward a student's total", async () => {
  const prisma = {
    attendance: {
      findMany: async () => [
        { id: 1, status: "PRESENT", reason: null, submittedAt: null, session: { startTime: new Date(), subject: { id: 10, name: "DS", code: "CS201", type: "theory" } } },
        { id: 2, status: "ABSENT", reason: null, submittedAt: null, session: { startTime: new Date(), subject: { id: 10, name: "DS", code: "CS201", type: "theory" } } },
        { id: 3, status: "EXCUSED", reason: "On approved leave", submittedAt: null, session: { startTime: new Date(), subject: { id: 10, name: "DS", code: "CS201", type: "theory" } } },
        { id: 4, status: "EXCUSED", reason: "On approved leave", submittedAt: null, session: { startTime: new Date(), subject: { id: 10, name: "DS", code: "CS201", type: "theory" } } },
      ],
    },
  };
  const { getHierarchicalHistory } = setup(prisma).load("services/analyticsService.js");

  const [subject] = await getHierarchicalHistory(STUDENT_ID);

  assert.equal(subject.records.length, 4, "every class still shows in the list");
  assert.deepEqual(subject.stats, { PRESENT: 1, ABSENT: 1, INVALID: 0, EXCUSED: 2, total: 2 });
});

test("the faculty can excuse a class by hand", async () => {
  const prisma = {
    session: { findFirst: async () => ({ id: 5, subjectId: 10, facultyId: FACULTY_ID }) },
    enrollment: { findFirst: async () => ({ id: 1 }) },
    attendance: {
      upsert: async ({ create }) => ({ ...create }),
      count: async () => 0,
    },
  };
  const { load } = setup(prisma);
  const controller = load("controllers/attendanceController.js");
  const res = mockResponse();

  await controller.editAttendance(
    { params: { sessionId: "5", studentId: String(STUDENT_ID) }, body: { status: "EXCUSED" }, user: faculty() },
    res,
    (err) => { throw err; }
  );

  assert.equal(res.statusCode, 200);

  const bad = mockResponse();
  await controller.editAttendance(
    { params: { sessionId: "5", studentId: String(STUDENT_ID) }, body: { status: "MAYBE" }, user: faculty() },
    bad,
    (err) => { throw err; }
  );
  assert.equal(bad.statusCode, 400);
  assert.match(bad.body.error, /EXCUSED/);
});
