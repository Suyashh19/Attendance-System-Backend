const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, mockResponse } = require("./helpers/mockModules");

const FACULTY_ID = 7;
const OTHER_FACULTY_ID = 8;

function buildPrisma(initialSubjects) {
  const subjects = initialSubjects.map((s) => ({ ...s }));
  const calls = { updateMany: null };

  return {
    calls,
    subjects,
    subject: {
      findUnique: async ({ where }) => subjects.find((s) => s.id === where.id) || null,
      findFirst: async ({ where }) =>
        subjects.find(
          (s) =>
            (where.code === undefined || s.code === where.code) &&
            (where.type === undefined || s.type === where.type) &&
            (where.id === undefined || (where.id.not !== undefined ? s.id !== where.id.not : s.id === where.id)) &&
            (where.facultyId === undefined || s.facultyId === where.facultyId)
        ) || null,
      create: async ({ data }) => {
        const created = { id: subjects.length + 1, ...data };
        subjects.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const subject = subjects.find((s) => s.id === where.id);
        Object.assign(subject, data);
        return subject;
      },
    },
    session: { count: async () => 12 },
    attendance: { count: async () => 480 },
    enrollment: {
      count: async () => 40,
      updateMany: async (args) => {
        calls.updateMany = args;
        return { count: 5 };
      },
    },
  };
}

const baseSubjects = [
  { id: 1, name: "Data Structures", code: "CS201", type: "theory", span: null, facultyId: FACULTY_ID },
  { id: 2, name: "Data Structures Lab", code: "CS201", type: "practical", span: null, facultyId: FACULTY_ID },
  { id: 3, name: "Someone Else's", code: "ZZ999", type: "theory", span: null, facultyId: OTHER_FACULTY_ID },
];

async function call(prisma, modulePath, handler, { params = {}, body = {}, userId = FACULTY_ID } = {}) {
  const { load } = setup(prisma);
  const controller = load(modulePath);
  const res = mockResponse();
  await controller[handler]({ params, body, user: { userId } }, res, (err) => { throw err; });
  return res;
}

test("a subject can be created with a semester label, which is tidied up", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "createSubject", {
    body: { name: "Networks", code: " cn301 ", type: "Theory", span: "  Sem   5  " },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.subject.code, "CN301");
  assert.equal(res.body.subject.span, "Sem 5");
});

test("creating without a label stores none", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "createSubject", {
    body: { name: "Networks", code: "CN301" },
  });
  assert.equal(res.body.subject.span, null);
});

test("editing changes only the fields that were sent", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "1" },
    body: { name: "  Data Structures & Algorithms ", span: "2026-27" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.subject.name, "Data Structures & Algorithms");
  assert.equal(res.body.subject.span, "2026-27");
  assert.equal(res.body.subject.code, "CS201");
  assert.equal(res.body.subject.type, "theory");
});

test("an empty label clears it", async () => {
  const prisma = buildPrisma([{ ...baseSubjects[0], span: "Sem 3" }]);
  const res = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "1" },
    body: { span: "   " },
  });
  assert.equal(res.body.subject.span, null);
});

test("the code is upper-cased on edit", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "1" },
    body: { code: "cs202" },
  });
  assert.equal(res.body.subject.code, "CS202");
});

test("editing into an existing code + type is refused", async () => {
  const prisma = buildPrisma(baseSubjects);
  // subject 1 is CS201 theory; making it practical would collide with subject 2
  const res = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "1" },
    body: { type: "practical" },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already exists/);
  assert.equal(prisma.subjects[0].type, "theory");
});

test("saving a subject with its own code and type unchanged is not a clash", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "1" },
    body: { name: "Renamed", code: "CS201", type: "theory" },
  });
  assert.equal(res.statusCode, 200);
});

test("editing rejects empty names, bad types and empty requests", async () => {
  for (const body of [{ name: "  " }, { code: "" }, { type: "lecture" }, {}]) {
    const prisma = buildPrisma(baseSubjects);
    const res = await call(prisma, "controllers/subjectController.js", "updateSubject", { params: { id: "1" }, body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test("only the owner can edit; unknown subjects are 404", async () => {
  const prisma = buildPrisma(baseSubjects);
  const notOwner = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "3" },
    body: { name: "Hijack" },
  });
  assert.equal(notOwner.statusCode, 403);
  assert.equal(prisma.subjects[2].name, "Someone Else's");

  const missing = await call(prisma, "controllers/subjectController.js", "updateSubject", {
    params: { id: "99" },
    body: { name: "x" },
  });
  assert.equal(missing.statusCode, 404);
});

test("the delete summary reports lectures, records and students, owner only", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/subjectController.js", "getSubjectSummary", { params: { id: "1" } });
  assert.deepEqual(res.body, { subjectId: 1, lectures: 12, records: 480, students: 40 });

  const forbidden = await call(prisma, "controllers/subjectController.js", "getSubjectSummary", { params: { id: "3" } });
  assert.equal(forbidden.statusCode, 403);
});

test("approve-all only touches pending requests of the faculty's own subject", async () => {
  const prisma = buildPrisma(baseSubjects);
  const res = await call(prisma, "controllers/enrollmentController.js", "approveAllPending", {
    params: { subjectId: "1" },
  });
  assert.equal(res.body.approved, 5);
  assert.deepEqual(prisma.calls.updateMany, {
    where: { subjectId: 1, status: "PENDING" },
    data: { status: "APPROVED" },
  });

  const other = buildPrisma(baseSubjects);
  const forbidden = await call(other, "controllers/enrollmentController.js", "approveAllPending", {
    params: { subjectId: "3" },
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(other.calls.updateMany, null);
});

test("the Excel tab is named after the code and semester, kept legal for Excel", () => {
  const { setup: setupModules } = require("./helpers/mockModules");
  const { load } = setupModules({});
  const { buildSheetName } = load("services/analyticsService.js");

  assert.equal(buildSheetName({ code: "CS402", span: "Sem 5" }), "CS402 Sem 5");
  assert.equal(buildSheetName({ code: "CS402", span: null }), "CS402");
  assert.equal(buildSheetName({ code: "CS402", span: "2026/27: Odd [A]" }), "CS402 2026 27 Odd A");
  assert.ok(buildSheetName({ code: "CS402", span: "x".repeat(80) }).length <= 31);
  assert.equal(buildSheetName({}), "Attendance Report");
});
