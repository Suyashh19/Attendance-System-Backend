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
