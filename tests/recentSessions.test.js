const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, mockResponse } = require("./helpers/mockModules");

const FACULTY_ID = 7;

function buildPrisma(sessionCount) {
  const calls = { take: null, groupBys: 0, counts: 0 };
  const sessions = Array.from({ length: sessionCount }, (_, i) => ({
    id: i + 1,
    subjectId: i % 2 === 0 ? 100 : 200,
    startTime: new Date(2026, 9, 20 - i),
    endTime: null,
    subject: { name: i % 2 === 0 ? "Data Structures" : "Operating Systems", code: i % 2 === 0 ? "CS201" : "CS301", type: "theory" },
  }));

  return {
    calls,
    session: {
      findMany: async ({ where, take }) => {
        assert.equal(where.facultyId, FACULTY_ID);
        calls.take = take;
        return sessions.slice(0, take);
      },
    },
    enrollment: {
      count: async () => { calls.counts += 1; return 0; },
      groupBy: async () => {
        calls.groupBys += 1;
        return [
          { subjectId: 100, _count: { _all: 40 } },
          { subjectId: 200, _count: { _all: 30 } },
        ];
      },
    },
    attendance: {
      count: async () => { calls.counts += 1; return 0; },
      groupBy: async () => {
        calls.groupBys += 1;
        return [{ sessionId: 1, _count: { _all: 35 } }];
      },
    },
  };
}

async function recent(prisma, query) {
  const { load } = setup(prisma);
  const controller = load("controllers/sessionController.js");
  const res = mockResponse();
  await controller.getRecentSessions({ user: { userId: FACULTY_ID }, query }, res, (err) => { throw err; });
  return res;
}

test("recent sessions default to the latest 10", async () => {
  const prisma = buildPrisma(30);
  const res = await recent(prisma, {});
  assert.equal(prisma.calls.take, 10);
  assert.equal(res.body.sessions.length, 10);
});

test("?limit= asks for more, capped at 100, and bad values fall back to 10", async () => {
  for (const [limit, expected] of [["50", 50], ["500", 100], ["0", 10], ["-3", 10], ["abc", 10], [undefined, 10]]) {
    const prisma = buildPrisma(5);
    await recent(prisma, { limit });
    assert.equal(prisma.calls.take, expected, `limit=${limit}`);
  }
});

test("counts come from two grouped queries, not two per session", async () => {
  const prisma = buildPrisma(20);
  const res = await recent(prisma, { limit: "20" });
  assert.equal(prisma.calls.groupBys, 2);
  assert.equal(prisma.calls.counts, 0);

  const first = res.body.sessions[0];
  assert.equal(first.presentCount, 35);
  assert.equal(first.totalEnrolled, 40);

  const second = res.body.sessions[1];
  assert.equal(second.presentCount, 0);
  assert.equal(second.totalEnrolled, 30);
});

test("a faculty with no sessions gets an empty list without any count queries", async () => {
  const prisma = buildPrisma(0);
  const res = await recent(prisma, {});
  assert.deepEqual(res.body.sessions, []);
  assert.equal(prisma.calls.groupBys, 0);
});
