const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { setup, mockResponse } = require("./helpers/mockModules");

const EMAIL = "student@example.com";
const PASSWORD = "correct-password";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

async function buildPrisma() {
  const user = { id: 1, email: EMAIL, role: "student", password: await bcrypt.hash(PASSWORD, 4) };
  const state = { deleted: false };
  const tx = {
    attendance: { deleteMany: async () => ({}) },
    enrollment: { deleteMany: async () => ({}) },
    subject: { findMany: async () => [], deleteMany: async () => ({}) },
    otp: { deleteMany: async () => ({}) },
    user: { delete: async () => { state.deleted = true; } },
  };
  return {
    state,
    user: {
      findUnique: async ({ where }) => (where.email === user.email || where.id === user.id ? user : null),
      update: async () => ({}),
    },
    $transaction: async (fn) => fn(tx),
  };
}

async function loginStatus(controller, email, password, ip = "1.1.1.1") {
  const res = mockResponse();
  await controller.login({ body: { email, password }, headers: {}, ip }, res);
  return res;
}

// ── The limiter itself ────────────────────────────────────────────────────────

test("a key is blocked after max failures and freed when the window passes", () => {
  const { createAttemptLimiter } = setup({}).load("middleware/attemptLimiter.js");
  let now = 1000;
  const limiter = createAttemptLimiter({ max: 3, windowMs: 60000, now: () => now });

  limiter.fail("a");
  limiter.fail("a");
  assert.equal(limiter.check("a").blocked, false);
  limiter.fail("a");
  const blocked = limiter.check("a");
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.retryAfterSeconds, 60);

  now += 30000;
  assert.equal(limiter.check("a").retryAfterSeconds, 30);

  now += 30000;
  assert.equal(limiter.check("a").blocked, false);
});

test("keys are counted separately, and a success clears the counter", () => {
  const { createAttemptLimiter } = setup({}).load("middleware/attemptLimiter.js");
  const limiter = createAttemptLimiter({ max: 2 });

  limiter.fail("a");
  limiter.fail("a");
  assert.equal(limiter.check("a").blocked, true);
  assert.equal(limiter.check("b").blocked, false);

  limiter.reset("a");
  assert.equal(limiter.check("a").blocked, false);
});

test("expired entries are pruned so memory cannot grow without bound", () => {
  const { createAttemptLimiter } = setup({}).load("middleware/attemptLimiter.js");
  let now = 0;
  const limiter = createAttemptLimiter({ max: 5, windowMs: 1000, now: () => now });

  for (let i = 0; i < 100; i++) limiter.fail(`key-${i}`);
  assert.equal(limiter.size, 100);

  now = 5000;
  limiter.prune();
  assert.equal(limiter.size, 0);
});

// ── Login ─────────────────────────────────────────────────────────────────────

test("login locks an account after 8 wrong passwords, even for the right one", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");

  for (let i = 0; i < 8; i++) {
    const res = await loginStatus(controller, EMAIL, "wrong-password");
    assert.equal(res.statusCode, 401);
  }

  const locked = await loginStatus(controller, EMAIL, PASSWORD);
  assert.equal(locked.statusCode, 429);
  assert.match(locked.body.error, /too many attempts/i);
});

test("the lock follows the account, not the caller, and ignores email capitalisation", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");

  for (let i = 0; i < 8; i++) {
    await loginStatus(controller, i % 2 ? EMAIL.toUpperCase() : EMAIL, "wrong-password", `10.0.0.${i}`);
  }
  const res = await loginStatus(controller, EMAIL, PASSWORD, "99.99.99.99");
  assert.equal(res.statusCode, 429);
});

test("a correct login clears the failure count", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");

  for (let i = 0; i < 7; i++) await loginStatus(controller, EMAIL, "wrong-password");
  assert.equal((await loginStatus(controller, EMAIL, PASSWORD)).statusCode, 200);

  // Seven more wrong passwords are fine again: the earlier seven were forgotten
  for (let i = 0; i < 7; i++) {
    assert.equal((await loginStatus(controller, EMAIL, "wrong-password")).statusCode, 401);
  }
});

test("guessing at emails that do not exist is limited per email too", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");

  for (let i = 0; i < 8; i++) await loginStatus(controller, "nobody@example.com", "x-password");
  const res = await loginStatus(controller, "nobody@example.com", "x-password");
  assert.equal(res.statusCode, 429);
});

test("one caller spraying many accounts is stopped by the per-caller limit", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");

  for (let i = 0; i < 100; i++) await loginStatus(controller, `user${i}@example.com`, "x-password", "6.6.6.6");
  const res = await loginStatus(controller, EMAIL, PASSWORD, "6.6.6.6");
  assert.equal(res.statusCode, 429);

  // Someone else is unaffected
  assert.equal((await loginStatus(controller, EMAIL, PASSWORD, "7.7.7.7")).statusCode, 200);
});

// ── Deleting an account ───────────────────────────────────────────────────────

const deleteApp = async (controller, body) => {
  const res = mockResponse();
  await controller.deleteAccount({ user: { userId: 1 }, body, ip: "2.2.2.2" }, res);
  return res;
};

test("deleting from the app needs the password", async () => {
  const prisma = await buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");

  const missing = await deleteApp(controller, {});
  assert.equal(missing.statusCode, 400);
  assert.match(missing.body.error, /password is required/i);

  const wrong = await deleteApp(controller, { password: "nope-nope" });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.body.error, "Incorrect password");
  assert.equal(prisma.state.deleted, false);

  const right = await deleteApp(controller, { password: PASSWORD });
  assert.equal(right.statusCode, 200);
  assert.equal(prisma.state.deleted, true);
});

test("a wrong delete password is never a 401, which would sign the user out", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");
  const res = await deleteApp(controller, { password: "nope-nope" });
  assert.notEqual(res.statusCode, 401);
});

test("deleting from the app locks after 5 wrong passwords", async () => {
  const prisma = await buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");

  for (let i = 0; i < 5; i++) await deleteApp(controller, { password: "nope-nope" });
  const res = await deleteApp(controller, { password: PASSWORD });

  assert.equal(res.statusCode, 429);
  assert.equal(prisma.state.deleted, false);
});

test("the web delete page locks after 5 wrong passwords", async () => {
  const prisma = await buildPrisma();
  const controller = setup(prisma).load("controllers/authController.js");
  const web = async (password) => {
    const res = mockResponse();
    await controller.deleteAccountWithPassword({ body: { email: EMAIL, password }, ip: "3.3.3.3" }, res);
    return res;
  };

  for (let i = 0; i < 5; i++) assert.equal((await web("nope-nope")).statusCode, 401);
  assert.equal((await web(PASSWORD)).statusCode, 429);
  assert.equal(prisma.state.deleted, false);
});

// ── The old change-password endpoint ─────────────────────────────────────────

test("the old change-password endpoint locks after 5 wrong current passwords", async () => {
  const controller = setup(await buildPrisma()).load("controllers/authController.js");
  const change = async (currentPassword) => {
    const res = mockResponse();
    await controller.updatePassword(
      { user: { userId: 1 }, body: { currentPassword, newPassword: "another-pass" }, ip: "4.4.4.4" },
      res
    );
    return res;
  };

  for (let i = 0; i < 5; i++) assert.equal((await change("wrong-wrong")).statusCode, 400);
  assert.equal((await change(PASSWORD)).statusCode, 429);
});
