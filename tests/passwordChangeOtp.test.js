const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { setup, mockResponse } = require("./helpers/mockModules");

const EMAIL = "faculty@example.com";
const USER_ID = 5;

function buildPrisma({ recentOtps = [] } = {}) {
  const state = {
    sentTo: [],
    password: "old-hash",
    deletedFor: [],
    otp: { id: "otp-1", email: EMAIL, code: "123456", attempts: 0, expiresAt: new Date(Date.now() + 60000) },
  };

  return {
    state,
    user: {
      findUnique: async ({ where }) =>
        where.id === USER_ID ? { id: USER_ID, email: EMAIL, role: "faculty", password: state.password } : null,
      update: async ({ data }) => {
        state.password = data.password;
        return {};
      },
    },
    otp: {
      findMany: async () => recentOtps,
      deleteMany: async ({ where }) => {
        state.deletedFor.push(where.email);
        return { count: 1 };
      },
      create: async ({ data }) => {
        state.sentTo.push(data.email);
        state.otp = { ...state.otp, ...data };
        return data;
      },
      findFirst: async () => state.otp,
      update: async ({ data }) => {
        if (data.attempts?.increment) state.otp.attempts += data.attempts.increment;
        return state.otp;
      },
    },
  };
}

const req = (body = {}) => ({ user: { userId: USER_ID }, body });

test("the code goes to the registered email, which the user never types", async () => {
  const prisma = buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.requestPasswordChange(req({ email: "someone-else@example.com" }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(prisma.state.sentTo, [EMAIL]);
});

test("asking for codes too quickly is refused", async () => {
  const prisma = buildPrisma({ recentOtps: [{ createdAt: new Date() }] });
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.requestPasswordChange(req(), res);

  assert.equal(res.statusCode, 429);
  assert.deepEqual(prisma.state.sentTo, []);
});

test("the right code sets the new password and uses up the codes", async () => {
  const prisma = buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.confirmPasswordChange(req({ otp: "123456", newPassword: "brand-new-pass" }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(await bcrypt.compare("brand-new-pass", prisma.state.password), true);
  assert.ok(prisma.state.deletedFor.includes(EMAIL));
});

test("a wrong code leaves the password alone", async () => {
  const prisma = buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.confirmPasswordChange(req({ otp: "000000", newPassword: "brand-new-pass" }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "Invalid OTP");
  assert.equal(prisma.state.password, "old-hash");
});

test("an expired code is refused", async () => {
  const prisma = buildPrisma();
  prisma.state.otp.expiresAt = new Date(Date.now() - 1000);
  const controller = setup(prisma).load("controllers/authController.js");
  const res = mockResponse();

  await controller.confirmPasswordChange(req({ otp: "123456", newPassword: "brand-new-pass" }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /expired/i);
  assert.equal(prisma.state.password, "old-hash");
});

test("the code locks after 5 wrong guesses", async () => {
  const prisma = buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");

  for (let i = 0; i < 5; i++) {
    await controller.confirmPasswordChange(req({ otp: "000000", newPassword: "brand-new-pass" }), mockResponse());
  }
  const res = mockResponse();
  await controller.confirmPasswordChange(req({ otp: "123456", newPassword: "brand-new-pass" }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /too many/i);
  assert.equal(prisma.state.password, "old-hash");
});

test("a short or missing new password is refused before the code is checked", async () => {
  for (const body of [{ otp: "123456" }, { newPassword: "longenough" }, { otp: "123456", newPassword: "12345" }]) {
    const prisma = buildPrisma();
    const controller = setup(prisma).load("controllers/authController.js");
    const res = mockResponse();

    await controller.confirmPasswordChange(req(body), res);

    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(prisma.state.password, "old-hash");
    assert.equal(prisma.state.otp.attempts, 0);
  }
});
