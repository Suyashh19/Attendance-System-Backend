/**
 * attemptLimiter.js
 * Counts wrong-password attempts so a password cannot be guessed endlessly.
 *
 * Only failures count, and a success clears the counter. State lives in memory: a server
 * restart resets it, which is acceptable for this app's size (see also the wrong-code
 * counter in attendanceService).
 */

const WINDOW_MS = 15 * 60 * 1000;

/**
 * @param {{ max: number, windowMs?: number, now?: () => number }} options
 */
function createAttemptLimiter({ max, windowMs = WINDOW_MS, now = Date.now }) {
  // key -> { count, resetAt }
  const entries = new Map();

  function live(key) {
    const entry = entries.get(key);
    if (entry && now() >= entry.resetAt) {
      entries.delete(key);
      return null;
    }
    return entry || null;
  }

  return {
    /** @returns {{ blocked: boolean, retryAfterSeconds: number }} */
    check(key) {
      const entry = live(key);
      if (entry && entry.count >= max) {
        return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now()) / 1000)) };
      }
      return { blocked: false, retryAfterSeconds: 0 };
    },

    /** Record a wrong attempt. The window starts at the first failure. */
    fail(key) {
      const entry = live(key);
      if (entry) {
        entry.count += 1;
      } else {
        entries.set(key, { count: 1, resetAt: now() + windowMs });
      }
    },

    /** Forget a key after a successful attempt. */
    reset(key) {
      entries.delete(key);
    },

    /** Drop expired entries so the map cannot grow without bound. */
    prune() {
      for (const key of [...entries.keys()]) live(key);
    },

    get size() {
      return entries.size;
    },
  };
}

// "Try again in 12 minutes."
function retryMessage(retryAfterSeconds) {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return `Too many attempts. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

// One limiter per kind of password check, each keyed by the account (and, more loosely, by the caller's IP)
const limiters = {
  login: { account: createAttemptLimiter({ max: 8 }), ip: createAttemptLimiter({ max: 100 }) },
  deleteWeb: { account: createAttemptLimiter({ max: 5 }), ip: createAttemptLimiter({ max: 50 }) },
  deleteApp: { account: createAttemptLimiter({ max: 5 }), ip: createAttemptLimiter({ max: 50 }) },
  changePassword: { account: createAttemptLimiter({ max: 5 }), ip: createAttemptLimiter({ max: 50 }) },
};

const pruneTimer = setInterval(() => {
  for (const group of Object.values(limiters)) {
    group.account.prune();
    group.ip.prune();
  }
}, 10 * 60 * 1000);
pruneTimer.unref();

/** Lowercased, trimmed email so "A@x.com" and "a@x.com " share one counter. */
function accountKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Is this kind of check currently blocked for this account or caller?
 * @returns {{ blocked: boolean, message?: string }}
 */
function isBlocked(kind, account, ip) {
  const group = limiters[kind];
  const byAccount = group.account.check(accountKey(account));
  const byIp = ip ? group.ip.check(ip) : { blocked: false, retryAfterSeconds: 0 };
  if (byAccount.blocked || byIp.blocked) {
    return { blocked: true, message: retryMessage(Math.max(byAccount.retryAfterSeconds, byIp.retryAfterSeconds)) };
  }
  return { blocked: false };
}

function recordFailure(kind, account, ip) {
  const group = limiters[kind];
  group.account.fail(accountKey(account));
  if (ip) group.ip.fail(ip);
}

function recordSuccess(kind, account) {
  limiters[kind].account.reset(accountKey(account));
}

module.exports = { createAttemptLimiter, retryMessage, isBlocked, recordFailure, recordSuccess };
