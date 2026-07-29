// Postgres (Neon) data layer. Works both locally and on Vercel serverless.
// A single pool is reused across warm invocations. Schema is created lazily on
// first use so there is no separate migration step.
//
// MONEY RULE: every amount in this database is an integer number of KOBO stored
// in a BIGINT column. Every rate is in BASIS POINTS (1000 = 10.00%). Floating
// point never touches money — see lib/money.js.
require("dotenv").config();
const { Pool, types } = require("pg");
const { nanoid } = require("nanoid");
const config = require("./config");

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Set it in .env (local) or the Vercel dashboard."
  );
}

// node-postgres returns BIGINT as a string to avoid precision loss. Kobo
// amounts are far inside JS's safe integer range (₦90 trillion), so parsing
// them to numbers is safe and saves string maths at every call site.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const rawUrl = process.env.DATABASE_URL || "";
const isLocal = /localhost|127\.0\.0\.1/.test(rawUrl);

// Neon's copy button hands you a URL with `channel_binding=require`, and pg's
// driver mishandles that param — it forces SCRAM channel binding and then fails
// the handshake against the pooled endpoint. TLS is already enforced by the
// explicit `ssl` config below, so both `channel_binding` and `sslmode` are
// stripped here and SSL is governed in exactly one place. This means you can
// paste Neon's connection string verbatim and it just works.
function sanitizeDbUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("channel_binding");
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url; // not URL-shaped (unlikely) — hand it to pg untouched
  }
}

const pool = new Pool({
  connectionString: sanitizeDbUrl(rawUrl),
  // Neon requires TLS; its pooled endpoint terminates SSL for us.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

// Run schema creation exactly once per process (cached promise).
let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      // ---- people ----
      await pool.query(`
        CREATE TABLE IF NOT EXISTS scouts (
          id                  SERIAL PRIMARY KEY,
          name                TEXT NOT NULL,
          email               TEXT NOT NULL UNIQUE,
          phone               TEXT,
          password_hash       TEXT NOT NULL,
          referral_code       TEXT NOT NULL UNIQUE,
          commission_rate_bps INTEGER NOT NULL DEFAULT 1000,
          status              TEXT NOT NULL DEFAULT 'active',
          bank_code           TEXT,
          bank_name           TEXT,
          account_number      TEXT,
          account_name        TEXT,
          payout_recipient_ref TEXT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at       TIMESTAMPTZ
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admins (
          id            SERIAL PRIMARY KEY,
          name          TEXT NOT NULL,
          email         TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_login_at TIMESTAMPTZ
        );
      `);

      // A client belongs to at most one Scout. Attribution is FIRST TOUCH and
      // is locked on creation: a second Scout's code on a known client is
      // recorded as 'contested' for an admin to settle, never silently moved.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id                SERIAL PRIMARY KEY,
          scout_id          INTEGER REFERENCES scouts(id) ON DELETE SET NULL,
          referral_code_used TEXT,
          name              TEXT NOT NULL,
          email             TEXT NOT NULL,
          phone             TEXT,
          company           TEXT,
          attribution       TEXT NOT NULL DEFAULT 'locked',
          duplicate_of      INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          access_token_hash TEXT,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at      TIMESTAMPTZ
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(lower(email));`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_clients_scout ON clients(scout_id);`
      );

      // ---- pipeline ----
      // One deal = one project enquiry = one chat thread.
      // commission_rate_bps is a SNAPSHOT taken at creation, so promoting a
      // Scout from 10% to 20% never retroactively repays their old deals.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS deals (
          id                  SERIAL PRIMARY KEY,
          ref                 TEXT NOT NULL UNIQUE,
          client_id           INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
          scout_id            INTEGER REFERENCES scouts(id) ON DELETE SET NULL,
          title               TEXT NOT NULL,
          project_type        TEXT,
          description         TEXT,
          budget_range        TEXT,
          timeline            TEXT,
          status              TEXT NOT NULL DEFAULT 'new',
          quoted_amount_kobo  BIGINT,
          agreed_amount_kobo  BIGINT,
          commission_rate_bps INTEGER NOT NULL DEFAULT 1000,
          deposit_bps         INTEGER NOT NULL DEFAULT 8000,
          commission_eligible BOOLEAN NOT NULL DEFAULT TRUE,
          ineligible_reason   TEXT,
          won_at              TIMESTAMPTZ,
          lost_at             TIMESTAMPTZ,
          lost_reason         TEXT,
          created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_deals_scout ON deals(scout_id);`
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_deals_client ON deals(client_id);`
      );

      await pool.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id          SERIAL PRIMARY KEY,
          deal_id     INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          sender_type TEXT NOT NULL,
          sender_id   INTEGER,
          sender_name TEXT,
          body        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          read_by_client_at TIMESTAMPTZ,
          read_by_admin_at  TIMESTAMPTZ
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_messages_deal ON messages(deal_id, id);`
      );

      // ---- money in ----
      // provider_ref is UNIQUE so a replayed webhook can never create a second
      // payment row for the same transaction.
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id            SERIAL PRIMARY KEY,
          deal_id       INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
          client_id     INTEGER REFERENCES clients(id) ON DELETE SET NULL,
          provider      TEXT NOT NULL DEFAULT 'manual',
          provider_ref  TEXT NOT NULL UNIQUE,
          amount_kobo   BIGINT NOT NULL,
          kind          TEXT NOT NULL DEFAULT 'part',
          status        TEXT NOT NULL DEFAULT 'pending',
          paid_at       TIMESTAMPTZ,
          recorded_by   INTEGER REFERENCES admins(id) ON DELETE SET NULL,
          note          TEXT,
          meta          JSONB,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_payments_deal ON payments(deal_id);`
      );

      // ---- money out: the Scout wallet ----
      // Append-only ledger. amount_kobo is SIGNED: credits positive, debits
      // negative. A balance is always a SUM over this table, never a stored
      // column that could drift.
      //   available_at  when the money stops being held and can be withdrawn
      //   status        'active' | 'cancelled' (cancelled entries are ignored)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ledger_entries (
          id           SERIAL PRIMARY KEY,
          scout_id     INTEGER NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
          deal_id      INTEGER REFERENCES deals(id) ON DELETE SET NULL,
          payment_id   INTEGER REFERENCES payments(id) ON DELETE SET NULL,
          withdrawal_id INTEGER,
          type         TEXT NOT NULL,
          amount_kobo  BIGINT NOT NULL,
          available_at TIMESTAMPTZ,
          status       TEXT NOT NULL DEFAULT 'active',
          note         TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_ledger_scout ON ledger_entries(scout_id);`
      );
      // Idempotency: at most one commission and one clawback per payment, so a
      // duplicated webhook or a double-click on "record payment" cannot pay a
      // Scout twice for the same money.
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_commission_per_payment
        ON ledger_entries(payment_id) WHERE type = 'commission';
      `);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uniq_clawback_per_payment
        ON ledger_entries(payment_id) WHERE type = 'clawback';
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS withdrawals (
          id             SERIAL PRIMARY KEY,
          scout_id       INTEGER NOT NULL REFERENCES scouts(id) ON DELETE CASCADE,
          amount_kobo    BIGINT NOT NULL,
          status         TEXT NOT NULL DEFAULT 'requested',
          bank_code      TEXT,
          bank_name      TEXT,
          account_number TEXT,
          account_name   TEXT,
          provider       TEXT,
          provider_ref   TEXT,
          note           TEXT,
          requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at   TIMESTAMPTZ,
          processed_by   INTEGER REFERENCES admins(id) ON DELETE SET NULL
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_withdrawals_scout ON withdrawals(scout_id);`
      );

      // ---- operational ----
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id          SERIAL PRIMARY KEY,
          actor_type  TEXT NOT NULL,
          actor_id    INTEGER,
          actor_label TEXT,
          action      TEXT NOT NULL,
          entity_type TEXT,
          entity_id   INTEGER,
          meta        JSONB,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          key          TEXT PRIMARY KEY,
          count        INTEGER NOT NULL DEFAULT 0,
          window_start TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      // Seed tunables once. ON CONFLICT DO NOTHING means edits made in the
      // admin dashboard survive every subsequent boot.
      const seed = {
        default_commission_bps: config.defaults.commissionBps,
        hold_days: config.defaults.holdDays,
        min_withdrawal_kobo: config.defaults.minWithdrawalKobo,
        deposit_bps: config.defaults.depositBps,
        attribution_window_days: config.defaults.attributionWindowDays,
      };
      for (const [k, v] of Object.entries(seed)) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO NOTHING`,
          [k, String(v)]
        );
      }
    })();
  }
  return schemaReady;
}

// Convenience query wrapper that guarantees the schema exists first.
async function q(text, params) {
  await ensureSchema();
  return pool.query(text, params);
}

// Run `fn` inside a transaction, handing it a dedicated client. Used wherever
// money moves — a rolled-back transaction must leave the ledger untouched.
async function tx(fn) {
  await ensureSchema();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---- settings ----
async function getSetting(key, fallback = null) {
  const r = await q(`SELECT value FROM settings WHERE key = $1`, [key]);
  return r.rows[0]?.value ?? fallback;
}
async function getNumber(key, fallback) {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
async function setSetting(key, value) {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
  return value;
}
// Every tunable in one call, for the admin dashboard and the ledger.
async function getSettings() {
  const r = await q(`SELECT key, value FROM settings`);
  const m = Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
  const num = (k, d) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : d);
  return {
    default_commission_bps: num("default_commission_bps", config.defaults.commissionBps),
    hold_days: num("hold_days", config.defaults.holdDays),
    min_withdrawal_kobo: num("min_withdrawal_kobo", config.defaults.minWithdrawalKobo),
    deposit_bps: num("deposit_bps", config.defaults.depositBps),
    attribution_window_days: num(
      "attribution_window_days",
      config.defaults.attributionWindowDays
    ),
    // Where clients send money in manual mode. Set from the admin dashboard.
    payin_bank_name: m.payin_bank_name || "",
    payin_account_number: m.payin_account_number || "",
    payin_account_name: m.payin_account_name || "",
  };
}

// ---- audit ----
// Written on every admin action that touches money or attribution. Deliberately
// never throws: an audit failure must not roll back the thing being audited.
async function audit(actor, action, entity = {}, meta = null) {
  try {
    await q(
      `INSERT INTO audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        actor?.type || "system",
        actor?.id || null,
        actor?.label || null,
        action,
        entity.type || null,
        entity.id || null,
        meta ? JSON.stringify(meta) : null,
      ]
    );
  } catch (e) {
    console.error("[audit] failed to record", action, e.message);
  }
}

module.exports = {
  pool,
  q,
  tx,
  ensureSchema,
  nanoid,
  getSetting,
  getNumber,
  setSetting,
  getSettings,
  audit,
};
