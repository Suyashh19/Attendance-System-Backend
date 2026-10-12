const test = require("node:test");
const assert = require("node:assert/strict");
const { setup } = require("./helpers/mockModules");

const SESSION_ID = 10;
const STUDENT_ID = 7;
const DEVICE = "device-abc";

function buildPrisma({ session, enrollmentStatus = "APPROVED", registeredDevice = DEVICE } = {}) {
  const attendances = [];

  const activeSession = session === undefined
    ? {
        id: SESSION_ID,
        subjectId: 3,
        facultyId: 99,
        isActive: true,
        correctCode: "4721",
        windowExpiry: new Date(Date.now() + 15000),
      }
    : session;

  return {
    attendances,
    session: {
      findUnique: async () => activeSession,
    },
    user: {
      findUnique: async () => ({
        id: STUDENT_ID,
        deviceId: registeredDevice,
        deviceLocked: true,
        enrollments: enrollmentStatus ? [{ id: 1, status: enrollmentStatus }] : [],
        attendances: attendances.filter((a) => a.sessionId === SESSION_ID && a.studentId === STUDENT_ID),
      }),
    },
    attendance: {
      create: async ({ data }) => {
        attendances.push(data);
        return data;
      },
      upsert: async ({ where, create }) => {
        const { sessionId, studentId } = where.sessionId_studentId;
        const existing = attendances.find((a) => a.sessionId === sessionId && a.studentId === studentId);
        if (existing) return existing;
        attendances.push(create);
        return create;
      },
    },
  };
}

function submit(service, code, deviceId = DEVICE) {
  return service.submitAttendance({ sessionId: SESSION_ID, studentId: STUDENT_ID, code, deviceId });
}

test("correct code from the registered device is marked PRESENT", async () => {
  const prisma = buildPrisma();
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "PRESENT");
  assert.equal(result.facultyId, 99);
  assert.equal(prisma.attendances.length, 1);
  assert.equal(prisma.attendances[0].status, "PRESENT");
});

test("a typo leaves attempts; the third wrong code is recorded as INVALID", async () => {
  const prisma = buildPrisma();
  const service = setup(prisma).load("services/attendanceService.js");

  const first = await submit(service, "0000");
  const second = await submit(service, "1111");
  assert.equal(first.status, "WRONG_CODE");
  assert.equal(first.attemptsLeft, 2);
  assert.equal(second.attemptsLeft, 1);
  assert.equal(prisma.attendances.length, 0, "a typo must not create a record");

  const third = await submit(service, "2222");
  assert.equal(third.status, "INVALID");
  assert.equal(prisma.attendances.length, 1);
  assert.equal(prisma.attendances[0].status, "INVALID");
});

test("a student can still be marked PRESENT after one wrong attempt", async () => {
  const prisma = buildPrisma();
  const service = setup(prisma).load("services/attendanceService.js");

  await submit(service, "0000");
  const result = await submit(service, "4721");

  assert.equal(result.status, "PRESENT");
});

test("a student who is not enrolled is rejected without storing anything", async () => {
  const prisma = buildPrisma({ enrollmentStatus: null });
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "INVALID");
  assert.equal(prisma.attendances.length, 0);
});

test("a pending enrollment is rejected without storing anything", async () => {
  const prisma = buildPrisma({ enrollmentStatus: "PENDING" });
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /pending/i);
  assert.equal(prisma.attendances.length, 0);
});

test("a submission from a different device is INVALID", async () => {
  const prisma = buildPrisma();
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721", "someone-elses-phone");

  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /device/i);
});

test("a submission after the window (plus grace) is INVALID", async () => {
  const prisma = buildPrisma({
    session: {
      id: SESSION_ID,
      subjectId: 3,
      facultyId: 99,
      isActive: true,
      correctCode: "4721",
      windowExpiry: new Date(Date.now() - 5000),
    },
  });
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /expired/i);
});

test("a closed session is INVALID", async () => {
  const prisma = buildPrisma({
    session: { id: SESSION_ID, subjectId: 3, facultyId: 99, isActive: false, correctCode: "4721", windowExpiry: new Date() },
  });
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "INVALID");
  assert.match(result.reason, /no longer active/i);
});

test("a session that does not exist is rejected without storing anything", async () => {
  const prisma = buildPrisma({ session: null });
  const service = setup(prisma).load("services/attendanceService.js");

  const result = await submit(service, "4721");

  assert.equal(result.status, "INVALID");
  assert.equal(prisma.attendances.length, 0);
});

test("a second submission returns the first result instead of a new record", async () => {
  const prisma = buildPrisma();
  const service = setup(prisma).load("services/attendanceService.js");

  await submit(service, "4721");
  const again = await submit(service, "4721");

  assert.equal(again.status, "PRESENT");
  assert.match(again.reason, /already submitted/i);
  assert.equal(prisma.attendances.length, 1);
});

test("a burst of students arriving together looks the session up once", async () => {
  const prisma = buildPrisma();
  let lookups = 0;
  const findSession = prisma.session.findUnique;
  prisma.session.findUnique = async (args) => {
    lookups += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return findSession(args);
  };
  const service = setup(prisma).load("services/attendanceService.js");

  const results = await Promise.all(Array.from({ length: 50 }, () => submit(service, "0000")));

  assert.equal(lookups, 1);
  assert.ok(results.every((r) => r.status === "WRONG_CODE" || r.status === "INVALID"));
});

test("closing a session is seen by the very next submission", async () => {
  const session = {
    id: SESSION_ID,
    subjectId: 3,
    facultyId: 99,
    isActive: true,
    correctCode: "4721",
    windowExpiry: new Date(Date.now() + 15000),
  };
  const prisma = buildPrisma({ session });
  prisma.session.findUnique = async () => ({ ...session });
  const service = setup(prisma).load("services/attendanceService.js");

  const before = await submit(service, "0000");
  assert.equal(before.status, "WRONG_CODE");

  session.isActive = false;
  service.invalidateSessionCache(SESSION_ID);
  const after = await submit(service, "4721");

  assert.equal(after.status, "INVALID");
  assert.match(after.reason, /no longer active/i);
});

test("a failed session lookup is not cached", async () => {
  const prisma = buildPrisma();
  const findSession = prisma.session.findUnique;
  let fail = true;
  prisma.session.findUnique = async (args) => {
    if (fail) throw new Error("database unavailable");
    return findSession(args);
  };
  const service = setup(prisma).load("services/attendanceService.js");

  await assert.rejects(submit(service, "4721"), /database unavailable/);

  fail = false;
  const result = await submit(service, "4721");
  assert.equal(result.status, "PRESENT");
});
