const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, mockResponse } = require("./helpers/mockModules");

const SESSION_ID = 10;
const FACULTY_ID = 99;
const STUDENTS = 40;

function buildPrisma() {
  const attendances = [];
  const counts = { queries: 0 };

  return {
    counts,
    session: {
      findUnique: async () => ({
        id: SESSION_ID,
        subjectId: 3,
        facultyId: FACULTY_ID,
        isActive: true,
        correctCode: "4721",
        windowExpiry: new Date(Date.now() + 15000),
      }),
    },
    user: {
      findUnique: async ({ where }) => ({
        id: where.id,
        deviceId: `device-${where.id}`,
        deviceLocked: true,
        enrollments: [{ id: where.id, status: "APPROVED" }],
        attendances: attendances.filter((a) => a.studentId === where.id),
      }),
    },
    attendance: {
      create: async ({ data }) => {
        attendances.push(data);
        return data;
      },
      count: async () => {
        counts.queries += 1;
        return attendances.filter((a) => a.status === "PRESENT").length;
      },
    },
  };
}

test("the faculty's live count is pushed once for a burst, with the final number", async () => {
  const prisma = buildPrisma();
  const { load, emitted } = setup(prisma);
  const controller = load("controllers/attendanceController.js");

  await Promise.all(
    Array.from({ length: STUDENTS }, (_, i) => {
      const studentId = i + 1;
      const req = {
        user: { userId: studentId },
        body: { sessionId: SESSION_ID, code: "4721", deviceId: `device-${studentId}` },
      };
      return controller.submitAttendance(req, mockResponse(), (err) => { throw err; });
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 700));

  const countEvents = emitted.filter((e) => e.event === "attendance_count");
  assert.equal(prisma.counts.queries, 1);
  assert.equal(countEvents.length, 1);
  assert.equal(countEvents[0].room, `user_${FACULTY_ID}`);
  assert.deepEqual(countEvents[0].payload, { sessionId: SESSION_ID, presentCount: STUDENTS });
});
