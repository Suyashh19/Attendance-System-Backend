const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers/mockModules");

const SESSION_ID = 10;
const STUDENT_ID = 7;
const DEVICE = "device-abc";

// `expiresInMs` is when the window closes, relative to now (negative = already closed).
function buildPrisma({ expiresInMs = 15000, isActive = true } = {}) {
  const attendances = [];
  const session = {
    id: SESSION_ID,
    subjectId: 3,
    facultyId: 99,
    isActive,
    correctCode: "4721",
    windowExpiry: new Date(Date.now() + expiresInMs),
  };
  let nextId = 1;

  return {
    attendances,
    session: { findUnique: async () => ({ ...session }) },
    user: {
      findUnique: async () => ({
        id: STUDENT_ID,
        deviceId: DEVICE,
        deviceLocked: true,
        enrollments: [{ id: 1, status: "APPROVED" }],
        attendances: attendances.filter((a) => a.studentId === STUDENT_ID).map((a) => ({ ...a })),
      }),
    },
    attendance: {
      create: async ({ data }) => {
        if (attendances.some((a) => a.studentId === data.studentId)) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        const row = { id: nextId++, ...data };
        attendances.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = attendances.find((a) => a.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      findUnique: async () => attendances[0] ?? null,
      upsert: async ({ create }) => {
        const existing = attendances.find((a) => a.studentId === create.studentId);
        if (existing) return existing;
        const row = { id: nextId++, ...create };
        attendances.push(row);
        return row;
      },
    },
  };
}

function load(opts) {
  const prisma = buildPrisma(opts);
  return { prisma, service: setup(prisma).load("services/attendanceService.js") };
}

function submit(service, code, violation) {
  return service.submitAttendance({ sessionId: SESSION_ID, studentId: STUDENT_ID, code, deviceId: DEVICE, violation });
}

test("a student on a phone call is INVALID with the reason, even with the right code", async () => {
  const { prisma, service } = load();
  const result = await submit(service, "4721", "PHONE_CALL");
  assert.equal(result.status, "INVALID");
  assert.equal(result.reason, "Was on a phone call during attendance");
  assert.equal(prisma.attendances[0].status, "INVALID");
  assert.equal(prisma.attendances[0].reason, "Was on a phone call during attendance");
});

test("a student who left the app is INVALID with the reason, even without typing a code", async () => {
  const { prisma, service } = load();
  const result = await submit(service, "", "LEFT_APP");
  assert.equal(result.status, "INVALID");
  assert.equal(result.reason, "Left the app during attendance");
  assert.equal(prisma.attendances[0].reason, "Left the app during attendance");
});

test("a student marked PRESENT who then leaves the app while the window is open becomes INVALID", async () => {
  const { prisma, service } = load();
  assert.equal((await submit(service, "4721")).status, "PRESENT");

  const result = await submit(service, "", "LEFT_APP");

  assert.equal(result.status, "INVALID");
  assert.equal(result.facultyId, 99, "the faculty's live count must be refreshed");
  assert.equal(prisma.attendances.length, 1);
  assert.equal(prisma.attendances[0].status, "INVALID");
  assert.equal(prisma.attendances[0].reason, "Left the app during attendance");
});

test("a PRESENT student who takes a call while the window is open becomes INVALID", async () => {
  const { prisma, service } = load();
  await submit(service, "4721");
  const result = await submit(service, "", "PHONE_CALL");
  assert.equal(result.status, "INVALID");
  assert.equal(prisma.attendances[0].reason, "Was on a phone call during attendance");
});

test("leaving the app after the window has closed does not take away PRESENT", async () => {
  const { prisma, service } = load({ expiresInMs: 0 });
  await submit(service, "4721");
  prisma.session.findUnique = async () => ({
    id: SESSION_ID, subjectId: 3, facultyId: 99, isActive: true, correctCode: "4721",
    windowExpiry: new Date(Date.now() - 5000),
  });
  service.invalidateSessionCache(SESSION_ID); // the window has now closed
  const result = await submit(service, "", "LEFT_APP");
  assert.equal(result.status, "PRESENT");
  assert.equal(prisma.attendances[0].status, "PRESENT");
});

test("an unknown violation is ignored, so a correct code is still PRESENT", async () => {
  const { service } = load();
  assert.equal((await submit(service, "4721", "SOMETHING_ELSE")).status, "PRESENT");
});

test("no violation keeps the normal rules", async () => {
  const { service } = load();
  assert.equal((await submit(service, "4721")).status, "PRESENT");
});

test("a violation after the window closed is still recorded with its reason", async () => {
  const { prisma, service } = load({ expiresInMs: -5000 });
  const result = await submit(service, "4721", "LEFT_APP");
  assert.equal(result.status, "INVALID");
  assert.equal(prisma.attendances[0].reason, "Left the app during attendance");
});
