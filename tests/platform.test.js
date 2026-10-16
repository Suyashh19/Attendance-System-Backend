const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { setup, mockResponse } = require("./helpers/mockModules");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const PASSWORD = "correct-password";
const WEB_ORIGIN = "https://attendance-web.vercel.app";

async function buildUsers() {
  const password = await bcrypt.hash(PASSWORD, 4);
  return [
    { id: 1, email: "student@example.com", role: "student", password, deviceId: "phone-1", deviceLocked: true },
    { id: 2, email: "faculty@example.com", role: "faculty", password, deviceId: "phone-2", deviceLocked: true },
  ];
}

function buildPrisma(users) {
  return {
    user: { findUnique: async ({ where }) => users.find((u) => u.email === where.email) || null },
  };
}

async function login(body, headers = {}) {
  const controller = setup(buildPrisma(await buildUsers())).load("controllers/authController.js");
  const res = mockResponse();
  await controller.login({ body: { password: PASSWORD, ...body }, headers }, res);
  return res;
}

function runAuthMiddleware(tokenPayload) {
  const authMiddleware = setup({}).load("middleware/authMiddleware.js");
  const token = jwt.sign(tokenPayload, process.env.JWT_SECRET);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockResponse();
  let nextCalled = false;
  authMiddleware(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

// ── Login ─────────────────────────────────────────────────────────────────────

test("a student cannot log in on the web app", async () => {
  const res = await login({ email: "student@example.com", platform: "web" });

  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /mobile app/i);
});

test("a student is treated as web when the browser omits platform but sends an Origin", async () => {
  const res = await login({ email: "student@example.com" }, { origin: WEB_ORIGIN });

  assert.equal(res.statusCode, 403);
});

test("faculty can log in on the web app and get a web token", async () => {
  const res = await login({ email: "faculty@example.com", platform: "web" }, { origin: WEB_ORIGIN });

  assert.equal(res.statusCode, 200);
  assert.equal(jwt.decode(res.body.token).platform, "web");
  assert.equal(res.body.user.password, undefined);
});

test("the current app (no platform, no deviceId, no Origin) still logs students in", async () => {
  const res = await login({ email: "student@example.com" });

  assert.equal(res.statusCode, 200);
  assert.equal(jwt.decode(res.body.token).platform, "app");
});

test("the app still logs faculty in", async () => {
  const res = await login({ email: "faculty@example.com", platform: "android" });

  assert.equal(res.statusCode, 200);
  assert.equal(jwt.decode(res.body.token).platform, "app");
});

// ── Tokens ────────────────────────────────────────────────────────────────────

test("a student web token is rejected on protected routes", () => {
  const { res, nextCalled } = runAuthMiddleware({ userId: 1, role: "student", platform: "web" });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("a faculty web token is accepted", () => {
  const { req, nextCalled } = runAuthMiddleware({ userId: 2, role: "faculty", platform: "web" });

  assert.equal(nextCalled, true);
  assert.equal(req.user.platform, "web");
});

test("tokens issued before the platform claim keep working", () => {
  const { nextCalled } = runAuthMiddleware({ userId: 1, role: "student" });

  assert.equal(nextCalled, true);
});

// ── App-only routes ───────────────────────────────────────────────────────────

function runRejectWeb(req) {
  const { rejectWeb } = setup({}).load("middleware/platformMiddleware.js");
  const res = mockResponse();
  let nextCalled = false;
  rejectWeb({ body: {}, headers: {}, ...req }, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test("sign-up is refused from the web app", () => {
  const { res, nextCalled } = runRejectWeb({ body: { platform: "web" } });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test("sign-up is refused from a browser that omits platform", () => {
  const { nextCalled } = runRejectWeb({ headers: { origin: WEB_ORIGIN } });

  assert.equal(nextCalled, false);
});

test("a device change is refused with a web token", () => {
  const { nextCalled } = runRejectWeb({ user: { role: "faculty", platform: "web" } });

  assert.equal(nextCalled, false);
});

test("app requests pass the app-only routes", () => {
  const { nextCalled } = runRejectWeb({ body: { email: "a@example.com" }, user: { role: "student" } });

  assert.equal(nextCalled, true);
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

function connectSocket(tokenPayload, origin) {
  const { registerSocketHandlers } = setup({}).load("sockets/index.js");
  const socket = {
    id: "s1",
    handshake: { auth: { token: jwt.sign(tokenPayload, process.env.JWT_SECRET) }, headers: { origin } },
    disconnected: false,
    disconnect() { this.disconnected = true; },
    join() {},
    on() {},
  };
  registerSocketHandlers({}, socket);
  return socket;
}

test("a student web token cannot open a socket", () => {
  const socket = connectSocket({ userId: 1, role: "student", platform: "web" });

  assert.equal(socket.disconnected, true);
});

test("an app socket stays connected even though React Native sends an Origin", () => {
  const socket = connectSocket({ userId: 1, role: "student", platform: "app" }, "https://backend.example.com");

  assert.equal(socket.disconnected, false);
});

test("a faculty web socket stays connected", () => {
  const socket = connectSocket({ userId: 2, role: "faculty", platform: "web" }, WEB_ORIGIN);

  assert.equal(socket.disconnected, false);
});
