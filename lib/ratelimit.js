// Database-backed rate limiting.
//
// In-memory counters are useless on Vercel — each serverless invocation may be
// a fresh process, so an attacker gets a clean allowance every request. Keeping
// the counter in Postgres makes the limit real across the whole deployment.
//
// Applied to sign-in (password guessing), sign-up (bulk fake Scouts) and invite
// claims (someone hammering a referral code).
const db = require("./../db");

// Returns { ok, retryAfterSeconds }. Never throws — a rate limiter that breaks
// the app when the DB hiccups is worse than the abuse it prevents.
async function hit(key, { limit = 10, windowSeconds = 300 } = {}) {
  try {
    const { rows } = await db.q(
      `INSERT INTO rate_limits (key, count, window_start)
       VALUES ($1, 1, now())
       ON CONFLICT (key) DO UPDATE SET
         -- Restart the window if the old one has expired, else increment.
         count = CASE
           WHEN rate_limits.window_start < now() - ($2 || ' seconds')::interval THEN 1
           ELSE rate_limits.count + 1
         END,
         window_start = CASE
           WHEN rate_limits.window_start < now() - ($2 || ' seconds')::interval THEN now()
           ELSE rate_limits.window_start
         END
       RETURNING count, window_start`,
      [key, String(windowSeconds)]
    );
    const row = rows[0];
    if (row.count > limit) {
      const elapsed = (Date.now() - new Date(row.window_start).getTime()) / 1000;
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(windowSeconds - elapsed)) };
    }
    return { ok: true };
  } catch (e) {
    console.error("[ratelimit] failed open:", e.message);
    return { ok: true };
  }
}

// Clear the counter after a legitimate success, so one honest user who fat
// fingered their password twice isn't locked out.
async function clear(key) {
  try {
    await db.q(`DELETE FROM rate_limits WHERE key = $1`, [key]);
  } catch {
    /* non-critical */
  }
}

// Client IP, honouring Vercel's proxy header.
function ipOf(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.ip || "unknown";
}

// Express middleware factory.
function limit(name, opts) {
  return async (req, res, next) => {
    const r = await hit(`${name}:${ipOf(req)}`, opts);
    if (!r.ok) {
      res.set("Retry-After", String(r.retryAfterSeconds));
      return res.status(429).json({
        ok: false,
        error: `Too many attempts. Try again in ${r.retryAfterSeconds}s.`,
      });
    }
    next();
  };
}

module.exports = { hit, clear, limit, ipOf };
