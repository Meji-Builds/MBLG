#!/usr/bin/env node
// The 10-day hold exists to cover refund risk on money that isn't fully
// settled yet. Two ways around it, both added after a request to let an
// admin skip the wait: an explicit "release now" action, and an automatic
// release the instant a deal is paid in full (there's nothing left for the
// client to default on, so the risk the hold protects against is gone).
//
//   node scripts/check-hold-release.js
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

async function wonDealViaScout(admin, clientEmail, amount) {
  const scout = browser();
  let r = await scout("POST", "/api/scouts/signup", {
    name: "HR Scout", email: `hr-scout-${Date.now()}-${Math.random()}@test.com`, password: "supersecret",
  });
  const scoutId = r.body.scout.id;
  const code = r.body.scout.referralCode;
  const client = browser();
  r = await client("POST", `/api/invite/${code}/claim`, {
    name: "HR Client", email: clientEmail, description: "Need a site.",
  });
  const dealId = (await client("GET", "/api/client/deals")).body.deals[0].id;
  await admin("POST", `/api/admin/deals/${dealId}/quote`, { amount: String(amount) });
  await client("POST", `/api/client/deals/${dealId}/accept`);
  return { scout, scoutId, client, dealId };
}

async function main() {
  console.log(`\nHold-release check against ${BASE}\n`);
  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);
  await db.q(`INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', $1, $2)`,
    ["admin@test.local", await auth.hashPassword("adminpass123")]);
  await db.q(`UPDATE settings SET value = '10' WHERE key = 'hold_days'`);

  const admin = browser();
  await admin("POST", "/api/auth/login", { email: "admin@test.local", password: "adminpass123", role: "admin" });

  // ---- 1. manual release, before the deal is fully paid ----
  console.log("1. Admin releases a hold early, by hand");
  let { scoutId, dealId } = await wonDealViaScout(admin, "manual@test.com", "1,000,000");
  await admin("POST", "/api/admin/payments", { dealId, amount: "800,000", kind: "deposit" });

  let r = await admin("GET", `/api/admin/scouts`);
  let scoutRow = r.body.scouts.find((s) => s.id === scoutId);
  check("commission starts out held, not available", Number(scoutRow.available_kobo), 0);

  r = await admin("GET", `/api/admin/deals/${dealId}`);
  check("the deal view shows what's on hold", r.body.commissionHoldKobo, 8_000_000);

  r = await admin("POST", `/api/admin/deals/${dealId}/release-hold`);
  check("release succeeds", r.status, 200);
  check("the full held amount is reported back", r.body.releasedKobo, 8_000_000);

  r = await admin("GET", `/api/admin/scouts`);
  scoutRow = r.body.scouts.find((s) => s.id === scoutId);
  check("it's available immediately, without waiting out the 10 days", Number(scoutRow.available_kobo), 8_000_000);

  r = await admin("POST", `/api/admin/deals/${dealId}/release-hold`);
  check("releasing again with nothing left on hold is refused, not silently repeated", r.status, 400);

  // ---- 2. automatic release the moment a deal is paid in full ----
  console.log("\n2. Full payment releases the hold automatically");
  ({ scoutId, dealId } = await wonDealViaScout(admin, "auto@test.com", "1,000,000"));
  await admin("POST", "/api/admin/payments", { dealId, amount: "800,000", kind: "deposit" });

  r = await admin("GET", "/api/admin/scouts");
  scoutRow = r.body.scouts.find((s) => s.id === scoutId);
  check("the deposit's commission is held, same as any other deal", Number(scoutRow.available_kobo), 0);

  // The balance lands later — hours later, in the real scenario the platform
  // needed to support, but nothing here depends on elapsed time.
  await admin("POST", "/api/admin/payments", { dealId, amount: "200,000", kind: "balance" });

  r = await admin("GET", `/api/admin/deals/${dealId}`);
  check("the deal now shows nothing on hold — both accruals released themselves", r.body.commissionHoldKobo, 0);

  r = await admin("GET", "/api/admin/scouts");
  scoutRow = r.body.scouts.find((s) => s.id === scoutId);
  check(
    "the Scout can withdraw the full 10% the instant the deal is fully paid, no admin action needed",
    Number(scoutRow.available_kobo),
    10_000_000
  );

  // ---- 3. guards ----
  console.log("\n3. Guards");
  r = await admin("POST", "/api/admin/deals/999999/release-hold");
  check("releasing a hold on an unknown deal 404s", r.status, 404);

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
