const test = require("node:test");
const assert = require("node:assert/strict");
const { setup, mockResponse } = require("./helpers/mockModules");

const EMAIL = "student@example.com";

function buildPrisma({ users = [] } = {}) {
  const otp = { id: "otp-1", email: EMAIL, code: "123456", attempts: 0, expiresAt: new Date(Date.now() + 60000) };

  return {
    otpRow: otp,
    users,
    otp: {
      findFirst: async () => otp,
      update: async ({ data }) => {
        if (data.attempts?.increment) otp.attempts += data.attempts.increment;
        return otp;
      },
      deleteMany: async () => ({ count: 1 }),
    },
    user: {
      findUnique: async ({ where }) => users.find((u) => u.email === where.email || u.id === where.id) || null,
      findFirst: async ({ where }) =>
        users.find((u) => u.deviceId === where.deviceId && (!where.role || u.role === where.role)) || null,
    },
  };
}

test("the correct OTP is accepted", async () => {
  const controller = setup(buildPrisma()).load("controllers/authController.js");
  const res = mockResponse();

  await controller.verifySignupOtp({ body: { email: EMAIL, otp: "123456" } }, res);

  assert.equal(res.statusCode, 200);
});

test("an OTP locks after 5 wrong guesses, even for the right code", async () => {
  const prisma = buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");

  for (let i = 0; i < 5; i++) {
    const res = mockResponse();
    await controller.verifySignupOtp({ body: { email: EMAIL, otp: "000000" } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "Invalid OTP");
  }
  assert.equal(prisma.otpRow.attempts, 5);

  const res = mockResponse();
  await controller.verifySignupOtp({ body: { email: EMAIL, otp: "123456" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /too many/i);
});

test("an expired OTP is rejected", async () => {
  const prisma = buildPrisma();
  prisma.otpRow.expiresAt = new Date(Date.now() - 1000);
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.verifySignupOtp({ body: { email: EMAIL, otp: "123456" } }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /expired/i);
});

test("login gives the same answer for an unknown email and a wrong password", async () => {
  const bcrypt = require("bcrypt");
  const users = [{ id: 1, email: EMAIL, role: "student", password: await bcrypt.hash("correct-password", 4) }];
  const controller = setup(buildPrisma({ users })).load("controllers/authController.js");

  const unknown = mockResponse();
  await controller.login({ body: { email: "nobody@example.com", password: "whatever" } }, unknown);

  const wrong = mockResponse();
  await controller.login({ body: { email: EMAIL, password: "wrong-password" } }, wrong);

  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.body.error, wrong.body.error);
});

test("a second student cannot register on a phone that already has a student account", async () => {
  const users = [{ id: 1, email: "first@example.com", role: "student", deviceId: "shared-phone" }];
  const controller = setup(buildPrisma({ users })).load("controllers/authController.js");
  const res = mockResponse();

  await controller.register(
    {
      body: {
        email: EMAIL,
        password: "secret1",
        name: "Second Student",
        prn: "P2",
        role: "student",
        otp: "123456",
        deviceId: "shared-phone",
      },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /already registered/i);
});

test("an unknown role is rejected at registration", async () => {
  const controller = setup(buildPrisma()).load("controllers/authController.js");
  const res = mockResponse();

  await controller.register(
    { body: { email: EMAIL, password: "secret1", role: "admin", otp: "123456", deviceId: "phone-1" } },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Invalid role");
});

// Prisma fake that records which deletes ran inside the account-deletion transaction
function buildDeletionPrisma(users) {
  const deleted = [];
  const tx = {
    attendance: { deleteMany: async () => deleted.push("attendance") },
    enrollment: { deleteMany: async () => deleted.push("enrollment") },
    subject: { findMany: async () => [], deleteMany: async () => deleted.push("subject") },
    session: { deleteMany: async () => deleted.push("session") },
    otp: { deleteMany: async () => deleted.push("otp") },
    user: { delete: async ({ where }) => deleted.push(`user:${where.id}`) },
  };
  return {
    deleted,
    user: { findUnique: async ({ where }) => users.find((u) => u.email === where.email || u.id === where.id) || null },
    $transaction: async (fn) => fn(tx),
  };
}

test("the delete-account page removes the account when the password is right", async () => {
  const bcrypt = require("bcrypt");
  const users = [{ id: 7, email: EMAIL, role: "student", password: await bcrypt.hash("correct-password", 4) }];
  const prisma = buildDeletionPrisma(users);
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.deleteAccountWithPassword({ body: { email: EMAIL, password: "correct-password" } }, res);

  assert.equal(res.statusCode, 200);
  assert.ok(prisma.deleted.includes("user:7"));
  assert.ok(prisma.deleted.includes("otp"));
});

test("the delete-account page deletes nothing on a wrong password or unknown email", async () => {
  const bcrypt = require("bcrypt");
  const users = [{ id: 7, email: EMAIL, role: "student", password: await bcrypt.hash("correct-password", 4) }];
  const prisma = buildDeletionPrisma(users);
  const controller = setup(prisma).load("controllers/authController.js");

  const wrong = mockResponse();
  await controller.deleteAccountWithPassword({ body: { email: EMAIL, password: "nope" } }, wrong);
  const unknown = mockResponse();
  await controller.deleteAccountWithPassword({ body: { email: "nobody@example.com", password: "nope" } }, unknown);

  assert.equal(wrong.statusCode, 401);
  assert.equal(unknown.statusCode, 401);
  assert.equal(wrong.body.error, unknown.body.error);
  assert.deepEqual(prisma.deleted, []);
});
