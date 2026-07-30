#!/usr/bin/env node
// A client paying automatically (Paystack webhook, or the client's own
// return-trip verification) used to update the database with no visible
// trace anywhere else — no chat message, nothing for the admin's live
// pipeline/deal-view polling to react to. That silence is what led an admin
// to not notice a real payment and record it again by hand, producing a
// duplicate. This proves both automatic settlement paths now post the same
// kind of system message the manual "record payment" flow already does.
//
//   node scripts/check-payment-visibility.js
//
// DESTRUCTIVE: truncates every table first. Never point it at production.
require("dotenv").config();
const crypto = require("crypto");
const db = require("./../db");
const auth = require("./../lib/auth");

const BASE = process.env.BASE || "http://localhost:3000";
const SECRET = process.env.PAYSTACK_SECRET_KEY;
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

async function rawPost(path, bodyObj, headers) {
  const raw = Buffer.from(JSON.stringify(bodyObj));
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: raw });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json };
}

function sign(rawBody) {
  return crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");
}

async function freshWonDeal(admin, clientEmail) {
  const scout = browser();
  let r = await scout("POST", "/api/scouts/signup", {
    name: "PV Scout", email: `pv-scout-${Date.now()}-${Math.random()}@test.com`, password: "supersecret",
  });
  const code = r.body.scout.referralCode;
  const client = browser();
  r = await client("POST", `/api/invite/${code}/claim`, {
    name: "PV Client", email: clientEmail, description: "Need a site.",
  });
  const dealId = (await client("GET", "/api/client/deals")).body.deals[0].id;
  await admin("POST", `/api/admin/deals/${dealId}/quote`, { amount: "1,000,000" });
  await client("POST", `/api/client/deals/${dealId}/accept`);
  return { client, dealId };
}

async function main() {
  console.log(`\nPayment-visibility check against ${BASE}\n`);
  if (!SECRET) throw new Error("PAYSTACK_SECRET_KEY must be set for this check.");
  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);
  await db.q(`INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', $1, $2)`,
    ["admin@test.local", await auth.hashPassword("adminpass123")]);

  const admin = browser();
  await admin("POST", "/api/auth/login", { email: "admin@test.local", password: "adminpass123", role: "admin" });

  // ---- 1. webhook settlement announces itself in the thread ----
  console.log("1. Webhook-settled payment");
  let { client, dealId } = await freshWonDeal(admin, "webhook@test.com");
  const reference = `MC-PJ-TEST-${Date.now().toString(36).toUpperCase()}`;
  await db.q(
    `INSERT INTO payments (deal_id, client_id, provider, provider_ref, amount_kobo, kind, status)
     SELECT $1, client_id, 'paystack', $2, 80000000, 'deposit', 'pending' FROM deals WHERE id = $1`,
    [dealId, reference]
  );

  const eventBody = { event: "charge.success", data: { reference, amount: 80000000, paid_at: new Date().toISOString() } };
  const raw = Buffer.from(JSON.stringify(eventBody));
  let r = await rawPost("/api/webhooks/paystack", eventBody, {
    "Content-Type": "application/json",
    "x-paystack-signature": sign(raw),
  });
  check("webhook accepted", r.status, 200);

  const announcement = (m) => m.sender_type === "system" && m.body.startsWith("Payment of ₦800,000 received");
  let msgs = await client("GET", `/api/client/deals/${dealId}/messages?since=0`);
  check(
    "a system message announces the payment, same as the manual-record path",
    msgs.body.messages.some((m) => announcement(m) && m.body.includes("paystack")),
    true
  );

  r = await admin("GET", `/api/admin/deals/${dealId}`);
  check("admin's deal view reflects the paid amount without any manual recording", r.body.money.paidKobo, 80000000);

  r = await admin("GET", "/api/admin/deals?status=all");
  const row = r.body.deals.find((d) => d.id === dealId);
  check("the pipeline list also reflects it", Number(row.paid_kobo), 80000000);

  // ---- 2. a retried/duplicate webhook must not double-announce ----
  r = await rawPost("/api/webhooks/paystack", eventBody, {
    "Content-Type": "application/json",
    "x-paystack-signature": sign(raw),
  });
  check("a replayed webhook is still accepted (200, no error)", r.status, 200);
  msgs = await client("GET", `/api/client/deals/${dealId}/messages?since=0`);
  check(
    "but it does not post a second payment-received message",
    msgs.body.messages.filter(announcement).length,
    1
  );

  // ---- 3. admin's explicit "Confirm" button also announces itself ----
  console.log("\n2. Admin-confirmed payment (manual-mode style pending payment)");
  ({ client, dealId } = await freshWonDeal(admin, "confirm@test.com"));
  const ref2 = `MC-PJ-TEST2-${Date.now().toString(36).toUpperCase()}`;
  const ins = await db.q(
    `INSERT INTO payments (deal_id, client_id, provider, provider_ref, amount_kobo, kind, status)
     SELECT $1, client_id, 'manual', $2, 80000000, 'deposit', 'pending' FROM deals WHERE id = $1
     RETURNING id`,
    [dealId, ref2]
  );
  const paymentId = ins.rows[0].id;
  r = await admin("POST", `/api/admin/payments/${paymentId}/confirm`);
  check("confirm succeeds", r.status, 200);
  msgs = await client("GET", `/api/client/deals/${dealId}/messages?since=0`);
  check(
    "confirming a pending payment also announces it in the thread",
    msgs.body.messages.some(announcement),
    true
  );

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
