const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers/mockModules");

function load(prisma = {}) {
  return setup(prisma).load("services/sessionService.js");
}

test("a missing window length falls back to 15 seconds (older app versions)", () => {
  const { parseWindowSeconds } = load();
  assert.equal(parseWindowSeconds(undefined), 15);
  assert.equal(parseWindowSeconds(null), 15);
  assert.equal(parseWindowSeconds(""), 15);
});

test("the faculty can pick any whole number of seconds from 10 to 15", () => {
  const { parseWindowSeconds } = load();
  for (const s of [10, 11, 12, 13, 14, 15]) assert.equal(parseWindowSeconds(s), s);
  assert.equal(parseWindowSeconds("12"), 12);
});

test("window lengths outside 10-15 or not whole seconds are refused", () => {
  const { parseWindowSeconds } = load();
  for (const bad of [9, 16, 0, -5, 60, 12.5, "abc", true, {}]) {
    assert.equal(parseWindowSeconds(bad), null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test("a session expires after the length the faculty chose", async () => {
  let created;
  const prisma = {
    session: { create: async ({ data }) => (created = { id: 1, ...data }) },
  };
  const { createSession, sessionWindowSeconds } = load(prisma);

  await createSession({ subjectId: 3, facultyId: 9, windowSeconds: 10 });

  assert.equal(created.windowExpiry.getTime() - created.startTime.getTime(), 10_000);
  assert.equal(sessionWindowSeconds(created), 10);
});

test("a session started without a length still gets 15 seconds", async () => {
  let created;
  const prisma = {
    session: { create: async ({ data }) => (created = { id: 1, ...data }) },
  };
  const { createSession } = load(prisma);

  await createSession({ subjectId: 3, facultyId: 9 });

  assert.equal(created.windowExpiry.getTime() - created.startTime.getTime(), 15_000);
});

test("the window length reported for a session comes from its own start and expiry", () => {
  const { sessionWindowSeconds } = load();
  const start = new Date("2026-11-07T10:00:00Z");
  assert.equal(sessionWindowSeconds({ startTime: start, windowExpiry: new Date(start.getTime() + 12_000) }), 12);
  assert.equal(sessionWindowSeconds({ startTime: start, windowExpiry: null }), 15);
  assert.equal(sessionWindowSeconds(undefined), 15);
});
