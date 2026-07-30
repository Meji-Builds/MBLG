#!/usr/bin/env node
// Checks the two ways a client can respond to a quote besides accepting it:
// decline it outright (closes the deal) and ask for changes (reopens the
// conversation without closing anything). Neither existed until a client
// pointed out there was no way to say no.
//
//   node scripts/check-quote-response.js
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

async function freshDeal(admin, clientEmail) {
  const scout = browser();
  let r = await scout("POST", "/api/scouts/signup", {
    name: "QR Scout", email: `qr-scout-${Date.now()}-${Math.random()}@test.com`, password: "supersecret",
  });
  const code = r.body.scout.referralCode;
  const client = browser();
  r = await client("POST", `/api/invite/${code}/claim`, {
    name: "QR Client", email: clientEmail, description: "Need a site.",
  });
  const dealId = (await client("GET", "/api/client/deals")).body.deals[0].id;
  await admin("POST", `/api/admin/deals/${dealId}/quote`, { amount: "1,000,000" });
  return { client, dealId };
}

async function main() {
  console.log(`\nQuote response check against ${BASE}\n`);
  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);
  await db.q(`INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', $1, $2)`,
    ["admin@test.local", await auth.hashPassword("adminpass123")]);

  const admin = browser();
  await admin("POST", "/api/auth/login", { email: "admin@test.local", password: "adminpass123", role: "admin" });

  // ---- decline ----
  console.log("1. Decline");
  let { client, dealId } = await freshDeal(admin, "decline@test.com");
  let r = await client("GET", "/api/client/deals");
  check("deal is quoted before declining", r.body.deals[0].status, "quoted");

  r = await client("POST", `/api/client/deals/${dealId}/decline`, { reason: "Too expensive" });
  check("decline succeeds", r.status, 200);
  check("deal moves to lost", r.body.deal.status, "lost");

  r = await client("POST", `/api/client/deals/${dealId}/accept`);
  check("a declined quote can no longer be accepted", r.status, 400);

  r = await client("POST", `/api/client/deals/${dealId}/decline`, {});
  check("declining an already-declined deal is refused, not silently repeated", r.status, 400);

  const msgs = await client("GET", `/api/client/deals/${dealId}/messages?since=0`);
  check(
    "the decline reason appears in the thread",
    msgs.body.messages.some((m) => m.body.includes("Too expensive")),
    true
  );

  // ---- request changes ----
  console.log("\n2. Ask for changes");
  ({ client, dealId } = await freshDeal(admin, "changes@test.com"));

  r = await client("POST", `/api/client/deals/${dealId}/request-changes`, { note: "" });
  check("an empty request is refused", r.status, 400);

  r = await client("POST", `/api/client/deals/${dealId}/request-changes`, { note: "Can we phase this?" });
  check("request-changes succeeds", r.status, 200);
  check("deal reopens to in_discussion, not closed", r.body.deal.status, "in_discussion");
  check("the original quote amount is kept as a record, not cleared", r.body.deal.quotedKobo, 1_000_000 * 100);

  const msgs2 = await client("GET", `/api/client/deals/${dealId}/messages?since=0`);
  check(
    "the note appears as the client's own chat message",
    msgs2.body.messages.some((m) => m.sender_type === "client" && m.body === "Can we phase this?"),
    true
  );

  // The admin can still requote after this — reopening must not have broken anything.
  r = await admin("POST", `/api/admin/deals/${dealId}/quote`, { amount: "800,000" });
  check("admin can requote after the client asked for changes", r.status, 200);
  r = await client("GET", "/api/client/deals");
  check("deal is quoted again with the new amount", r.body.deals[0].quotedKobo, 800_000 * 100);

  // A deal that's already won can't be declined or asked-about — both actions
  // require an active, unanswered quote.
  console.log("\n3. Guards on a deal that's already moved on");
  ({ client, dealId } = await freshDeal(admin, "won@test.com"));
  await client("POST", `/api/client/deals/${dealId}/accept`);
  r = await client("POST", `/api/client/deals/${dealId}/decline`, {});
  check("cannot decline a won deal", r.status, 400);
  r = await client("POST", `/api/client/deals/${dealId}/request-changes`, { note: "hi" });
  check("cannot ask for changes on a won deal", r.status, 400);

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
