const { test } = require("node:test");
const assert = require("node:assert");
const { setup } = require("./helpers/mockModules");

async function get(app, path) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

test("GET /health answers without touching the database", async () => {
  let queried = false;
  const app = setup({ $queryRaw: async () => { queried = true; } }).load("app.js");

  const res = await get(app, "/health");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true });
  assert.strictEqual(queried, false);
});

test("GET /health?db=1 pings the database", async () => {
  let queried = false;
  const app = setup({ $queryRaw: async () => { queried = true; } }).load("app.js");

  const res = await get(app, "/health?db=1");
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(res.body, { ok: true, db: true });
  assert.strictEqual(queried, true);
});

test("GET /health?db=1 reports 503 when the database is down", async () => {
  const app = setup({ $queryRaw: async () => { throw new Error("down"); } }).load("app.js");

  const res = await get(app, "/health?db=1");
  assert.strictEqual(res.status, 503);
  assert.deepStrictEqual(res.body, { ok: false, db: false });
});
