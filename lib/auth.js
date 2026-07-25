// Authentication: password hashing, stateless session cookies, and the route
// guards that keep the three audiences apart.
//
// Sessions are HMAC-signed tokens in httpOnly cookies rather than DB rows, so
// they cost no query on a serverless cold start. Each audience gets its OWN
// cookie name, so an admin checking the client portal never clobbers their
// admin session.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("./../config");
const db = require("./../db");

const COOKIES = { scout: "mc_scout", admin: "mc_admin", client: "mc_client" };

// A missing SESSION_SECRET is fatal in production — without it, anyone could
// mint their own session cookie. Locally we fall back to an ephemeral secret
// (which simply logs you out on restart) so `npm start` works out of the box.
let secret = config.session.secret;
if (!secret) {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET must be set in production. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  secret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[auth] SESSION_SECRET not set — using a random dev secret. " +
      "Sessions will not survive a restart."
  );
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");

function sign(payloadObj) {
  const body = b64u(JSON.stringify(payloadObj));
  const mac = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  // Constant-time compare so the signature can't be brute-forced by timing.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ---- passwords ----
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
async function verifyPassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// Opaque single-use-ish secrets (client portal links). Stored hashed, so a
// database leak doesn't hand over working portal links.
function randomToken(len = 32) {
  return crypto.randomBytes(len).toString("base64url");
}
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

// ---- cookies ----
function setSession(res, role, id, extra = {}) {
  const exp = Date.now() + config.session.ttlDays * 24 * 60 * 60 * 1000;
  const token = sign({ role, id, exp, ...extra });
  res.cookie(COOKIES[role], token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !!process.env.VERCEL || process.env.NODE_ENV === "production",
    maxAge: config.session.ttlDays * 24 * 60 * 60 * 1000,
    path: "/",
  });
  return token;
}
function clearSession(res, role) {
  res.clearCookie(COOKIES[role], { path: "/" });
}
function readSession(req, role) {
  const raw = req.cookies?.[COOKIES[role]];
  if (!raw) return null;
  const payload = verify(raw);
  if (!payload || payload.role !== role) return null;
  return payload;
}

// ---- guards ----
// Each guard loads the live row, so a suspended Scout or a deleted account is
// rejected immediately even though the cookie itself is still valid.
function requireScout(req, res, next) {
  const s = readSession(req, "scout");
  if (!s) return res.status(401).json({ ok: false, error: "Please sign in." });
  db.q(`SELECT * FROM scouts WHERE id = $1`, [s.id])
    .then(({ rows }) => {
      const scout = rows[0];
      if (!scout) {
        clearSession(res, "scout");
        return res.status(401).json({ ok: false, error: "Please sign in." });
      }
      if (scout.status === "suspended") {
        return res.status(403).json({
          ok: false,
          error: "Your account is suspended. Contact Meji Builds.",
        });
      }
      req.scout = scout;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  const s = readSession(req, "admin");
  if (!s) return res.status(401).json({ ok: false, error: "Admin sign-in required." });
  db.q(`SELECT id, name, email FROM admins WHERE id = $1`, [s.id])
    .then(({ rows }) => {
      if (!rows[0]) {
        clearSession(res, "admin");
        return res.status(401).json({ ok: false, error: "Admin sign-in required." });
      }
      req.admin = rows[0];
      next();
    })
    .catch(next);
}

function requireClient(req, res, next) {
  const s = readSession(req, "client");
  if (!s) return res.status(401).json({ ok: false, error: "Open your project link to continue." });
  db.q(`SELECT * FROM clients WHERE id = $1`, [s.id])
    .then(({ rows }) => {
      if (!rows[0]) {
        clearSession(res, "client");
        return res.status(401).json({ ok: false, error: "Link no longer valid." });
      }
      req.client = rows[0];
      next();
    })
    .catch(next);
}

module.exports = {
  COOKIES,
  sign,
  verify,
  hashPassword,
  verifyPassword,
  randomToken,
  hashToken,
  setSession,
  clearSession,
  readSession,
  requireScout,
  requireAdmin,
  requireClient,
};
