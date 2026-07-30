#!/usr/bin/env node
// Proves the fix for a real production bug: on a slow connection, the server
// can write a message successfully and then lose the response on the way
// back. That looks like a failure to the sender, who then retries with the
// same text — and used to create a second, real duplicate message.
//
// This drives the actual HTTP API twice with the same clientRef, simulating
// exactly that retry, and asserts only one row lands.
//
//   node scripts/check-message-idempotency.js
//
// DESTRUCTIVE: truncates every table first. Never point it at production.
require("dotenv").config();
const db = require("./../db");
const auth = require("./../lib/auth");

const BASE = process.env.BASE || "http://localhost:3000";
let passed = 0;
const failures = [];
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  ok ? passed++ : failures.push(label);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`}`);
}

function browser() {
  const jar = new Map();
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(jar.size ? { Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, body: json };
  };
}

async function main() {
  console.log(`\nMessage idempotency check against ${BASE}\n`);
  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);
  await db.q(`INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', $1, $2)`,
    ["admin@test.local", await auth.hashPassword("adminpass123")]);

  const scout = browser();
  const client = browser();
  const admin = browser();

  let r = await scout("POST", "/api/scouts/signup", {
    name: "Ada Scout", email: "ada@idem.test", password: "supersecret",
  });
  const code = r.body.scout.referralCode;

  r = await client("POST", `/api/invite/${code}/claim`, {
    name: "Bola Client", email: "bola@idem.test", description: "Need a site.",
  });
  const dealId = (await client("GET", "/api/client/deals")).body.deals[0].id;

  await admin("POST", "/api/auth/login", { email: "admin@test.local", password: "adminpass123", role: "admin" });

  // ---- client side: two identical POSTs, same clientRef, simulating a retry ----
  console.log("1. Client composer retry");
  const ref1 = "test-ref-client-abc123";
  const first = await client("POST", `/api/client/deals/${dealId}/messages`, { body: "Hello there", clientRef: ref1 });
  check("first send succeeds", first.status, 200);
  const second = await client("POST", `/api/client/deals/${dealId}/messages`, { body: "Hello there", clientRef: ref1 });
  check("retried send also succeeds (not an error)", second.status, 200);
  check("both responses reference the same message id", second.body.message.id, first.body.message.id);

  let rows = await db.q(`SELECT count(*)::int n FROM messages WHERE deal_id=$1 AND body=$2`, [dealId, "Hello there"]);
  check("exactly one row was written despite two requests", rows.rows[0].n, 1);

  // A genuinely new message (different text) must NOT be swallowed by the ref reuse.
  const third = await client("POST", `/api/client/deals/${dealId}/messages`, { body: "Second message", clientRef: "test-ref-client-def456" });
  check("a different message with a different ref still sends", third.status, 200);
  rows = await db.q(`SELECT count(*)::int n FROM messages WHERE deal_id=$1`, [dealId]);
  const expectedRows = 1 /* system: project started */ + 1 /* client intake description */ + 1 /* Hello there */ + 1 /* Second message */;
  check("total message count is exactly right (no phantom extra)", rows.rows[0].n, expectedRows);

  // ---- admin side: same guarantee, plus the email-notification-skip path ----
  console.log("\n2. Admin composer retry (this is the exact surface from the bug report)");
  const ref2 = "test-ref-admin-xyz789";
  const a1 = await admin("POST", `/api/admin/deals/${dealId}/messages`, { body: "We'll send you the quote, please review it.", clientRef: ref2 });
  check("admin first send succeeds", a1.status, 200);
  const a2 = await admin("POST", `/api/admin/deals/${dealId}/messages`, { body: "We'll send you the quote, please review it.", clientRef: ref2 });
  check("admin retried send succeeds", a2.status, 200);
  check("same message id both times", a2.body.message.id, a1.body.message.id);

  rows = await db.q(`SELECT count(*)::int n FROM messages WHERE deal_id=$1 AND body=$2`, [dealId, "We'll send you the quote, please review it."]);
  check("admin retry produced exactly one row (the bug from the screenshot)", rows.rows[0].n, 1);

  // ---- a message with no clientRef at all (system messages) is unaffected ----
  console.log("\n3. System messages (no clientRef) still work normally");
  rows = await db.q(`SELECT count(*)::int n FROM messages WHERE deal_id=$1 AND sender_type='system'`, [dealId]);
  check("the system message from intake is present", rows.rows[0].n >= 1, true);

  const total = passed + failures.length;
  console.log(`\n${"─".repeat(56)}`);
  if (failures.length) {
    console.log(`FAILED — ${passed}/${total} checks passed\n`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`PASSED — all ${total} checks green`);
  }
  console.log("");
  await db.pool.end();
}

main().catch((e) => {
  console.error("\nCheck aborted:", e);
  process.exit(1);
});
