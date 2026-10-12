/**
 * Test helpers: swap the Prisma client and Socket.IO singleton for fakes,
 * so services can be tested without a database or a running server.
 */

const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

function mockModule(relativePath, exports) {
  const filename = require.resolve(path.join(SRC, relativePath));
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

// Drop every cached src module (except the mocks about to be installed) so each test starts clean
function resetSrcModules() {
  for (const filename of Object.keys(require.cache)) {
    if (filename.startsWith(SRC)) delete require.cache[filename];
  }
}

/**
 * @param {Object} prisma - fake Prisma client
 * @returns {{ load: (relativePath: string) => any, emitted: Array<{ room: string, event: string, payload: any }> }}
 */
function setup(prisma) {
  resetSrcModules();

  const emitted = [];
  mockModule("config/db.js", prisma);
  mockModule("config/socket.js", {
    initSocket: () => {},
    getIO: () => ({
      to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
    }),
  });

  return {
    load: (relativePath) => require(path.join(SRC, relativePath)),
    emitted,
  };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

module.exports = { setup, mockResponse };
