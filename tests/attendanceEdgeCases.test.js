const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers/mockModules");

const SESSION_ID = 10;
const STUDENT_ID = 7;
const DEVICE = "device-abc";

// `expiresInMs` is when the 15 s window closes, relative to now (negative = already closed).
function buildPrisma({ expiresInMs = 15000, correctCode = "4721" } = {}) {
  const attendances = [];
  const session = {
    id: SESSION_ID,
    subjectId: 3,
    facultyId: 99,
    isActive: true,
    correctCode,
    windowExpiry: new Date(Date.now() + expiresInMs),
  };

  return {
    attendances,
    session: { findUnique: async () => ({ ...session }) },
    user: {
      findUnique: async () => ({
        id: STUDENT_ID,
        deviceId: DEVICE,
        deviceLocked: true,
        enrollments: [{ id: 1, status: "APPROVED" }],
        attendances: attendances.filter((a) => a.studentId === STUDENT_ID),
      }),
    },
    attendance: {
      // Like the real unique (sessionId, studentId) index: a second insert is refused
      create: async ({ data }) => {
        await Promise.resolve();
        if (attendances.some((a) => a.studentId === data.studentId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        attendances.push(data);
        return data;
      },
      findUnique: async () => attendances[0] ?? null,
      upsert: async ({ create }) => {
        const existing = attendances.find((a) => a.studentId === create.studentId);
        if (existing) return existing;
        attendances.push(create);
        return create;
      },
    },
  };
}

function load(opts) {
  const prisma = buildPrisma(opts);
  return { prisma, service: setup(prisma).load("services/attendanceService.js") };
}

function submit(service, code) {
  return service.submitAttendance({ sessionId: SESSION_ID, studentId: STUDENT_ID, code, deviceId: DEVICE });
}

// ── Last-second timing ──────────────────────────────────────────────────────

test("a correct code with the window still 1 s open is PRESENT", async () => {
  const { service } = load({ expiresInMs: 1000 });
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("a correct code at the exact moment the window closes is PRESENT", async () => {
  const { service } = load({ expiresInMs: 0 });
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("a correct code 1.5 s after the window closes is still PRESENT (2 s network grace)", async () => {
  const { service } = load({ expiresInMs: -1500 });
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("a correct code 2.5 s after the window closes is INVALID (past the grace)", async () => {
  const { prisma, service } = load({ expiresInMs: -2500 });
  const result = await submit(service, "4721");
  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /expired/i);
  assert.equal(prisma.attendances[0].status, "INVALID");
});

test("the window is checked before the code: a wrong code after the grace is INVALID, not WRONG_CODE", async () => {
  const { service } = load({ expiresInMs: -3000 });
  const result = await submit(service, "0000");
  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /expired/i);
});

// ── Half-typed or malformed codes ───────────────────────────────────────────

test("a half-typed code is WRONG_CODE and costs one attempt", async () => {
  const { prisma, service } = load();
  const result = await submit(service, "47");
  assert.equal(result.status, "WRONG_CODE");
  assert.equal(result.attemptsLeft, 2);
  assert.equal(prisma.attendances.length, 0);
});

test("a code one digit short, then the full code, is PRESENT", async () => {
  const { service } = load();
  assert.equal((await submit(service, "472")).status, "WRONG_CODE");
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("a code one digit too long is WRONG_CODE", async () => {
  const { service } = load();
  assert.equal((await submit(service, "47211")).status, "WRONG_CODE");
});

test("an empty, blank or missing code is WRONG_CODE, never PRESENT", async () => {
  for (const code of ["", "   ", null, undefined]) {
    const { service } = load();
    assert.equal((await submit(service, code)).status, "WRONG_CODE", `code=${JSON.stringify(code)}`);
  }
});

test("spaces around the code are ignored", async () => {
  const { service } = load();
  assert.equal((await submit(service, " 4721 ")).status, "PRESENT");
});

test("spaces inside the code are not ignored", async () => {
  const { service } = load();
  assert.equal((await submit(service, "47 21")).status, "WRONG_CODE");
});

test("a code sent as a number matches", async () => {
  const { service } = load();
  assert.equal((await submit(service, 4721)).status, "PRESENT");
});

test("leading zeros matter: 0472 is not 472", async () => {
  const { service } = load({ correctCode: "0472" });
  assert.equal((await submit(service, "472")).status, "WRONG_CODE");
  assert.equal((await submit(service, "0472")).status, "PRESENT");
});

// ── Attempts racing the clock ───────────────────────────────────────────────

test("two half-typed tries then the right code on the last attempt is PRESENT", async () => {
  const { service } = load({ expiresInMs: 500 });
  assert.equal((await submit(service, "4")).status, "WRONG_CODE");
  assert.equal((await submit(service, "47")).status, "WRONG_CODE");
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("three half-typed tries lock the student out, even if the right code follows", async () => {
  const { prisma, service } = load({ expiresInMs: 5000 });
  await submit(service, "4");
  await submit(service, "47");
  const third = await submit(service, "472");
  assert.equal(third.status, "INVALID");
  assert.equal(prisma.attendances[0].status, "INVALID");

  const afterLock = await submit(service, "4721");
  assert.equal(afterLock.status, "INVALID");
});

test("tapping submit twice at the last second records one PRESENT", async () => {
  const { prisma, service } = load({ expiresInMs: 100 });
  const [a, b] = await Promise.all([submit(service, "4721"), submit(service, "4721")]);
  assert.equal(a.status, "PRESENT");
  assert.equal(b.status, "PRESENT");
  assert.equal(prisma.attendances.filter((r) => r.status === "PRESENT").length, 1);
});

test("a wrong attempt does not stop a later correct attempt while the window is open", async () => {
  const { service } = load({ expiresInMs: 2000 });
  assert.equal((await submit(service, "9999")).status, "WRONG_CODE");
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});
