#!/usr/bin/env node
// End-to-end check of the money path.
//
// Drives the real HTTP API exactly as a browser would — Scout signs up, client
// claims the invite, admin quotes, client accepts and pays, commission accrues,
// the hold expires, the payout goes out, a refund claws it back. Every step
// asserts the ledger, because the ledger is the part that must never be wrong.
//
//   node scripts/check-flow.js            # against http://localhost:3000
//   BASE=https://your-app.vercel.app node scripts/check-flow.js
//
// DESTRUCTIVE: it truncates every table first. Never point it at production.
require("dotenv").config();
const db = require("./../db");
const { formatKobo } = require("./../lib/money");

const BASE = process.env.BASE || "http://localhost:3000";
const NAIRA = 100; // kobo per naira

let passed = 0;
const failures = [];

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
  }
}
function checkTrue(label, cond) {
  check(label, !!cond, true);
}

// Minimal cookie jar — one per "browser" so Scout, client and admin sessions
// stay independent, which is also what we're testing.
function browser() {
  const jar = new Map();
  return async function req(method, path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(jar.size
          ? { Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON response */
    }
    return { status: res.status, body: json };
  };
}

async function main() {
  console.log(`\nMeji Connect — end-to-end check against ${BASE}\n`);

  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);
  // Re-seed the admin the app would have created on first boot.
  const auth = require("./../lib/auth");
  await db.q(
    `INSERT INTO admins (name, email, password_hash) VALUES ('Test Admin', $1, $2)`,
    ["admin@test.local", await auth.hashPassword("adminpass123")]
  );
  await db.setSetting("hold_days", 10);
  await db.setSetting("min_withdrawal_kobo", 500000);
  await db.setSetting("default_commission_bps", 1000);

  const scout = browser();
  const client = browser();
  const admin = browser();
  const stranger = browser();

  // ---- 1. Scout signs up ----
  console.log("1. Scout signup");
  let r = await scout("POST", "/api/scouts/signup", {
    name: "Ada Scout",
    email: "ada@scout.test",
    phone: "08011112222",
    password: "supersecret",
  });
  check("signup succeeds", r.status, 200);
  const referralCode = r.body.scout.referralCode;
  checkTrue("referral code issued", /^MC-[A-Z0-9]{6}$/.test(referralCode));
  check("default commission is 10%", r.body.scout.commissionPercent, "10");

  // ---- 2. Self-referral is refused ----
  console.log("\n2. Fraud guards");
  r = await stranger("POST", `/api/invite/${referralCode}/claim`, {
    name: "Ada Herself",
    email: "ada@scout.test",
    description: "Trying to refer myself",
  });
  check("scout cannot refer themselves", r.status, 400);

  // ---- 3. Client claims the invite ----
  console.log("\n3. Client intake");
  r = await client("GET", `/api/invite/${referralCode}`);
  check("invite page resolves the scout", r.body.scoutName, "Ada Scout");

  r = await client("POST", `/api/invite/${referralCode}/claim`, {
    name: "Bola Client",
    email: "bola@client.test",
    phone: "08033334444",
    company: "Bola Ventures",
    projectType: "Web app",
    description: "We need a booking platform.",
    budgetRange: "₦500k–₦1m",
    timeline: "2 months",
  });
  check("claim succeeds", r.status, 200);
  const dealRef = r.body.dealRef;
  checkTrue("deal reference issued", /^PJ-[A-Z0-9]{6}$/.test(dealRef));

  r = await client("GET", "/api/client/deals");
  const deal = r.body.deals[0];
  check("deal starts as new", deal.status, "new");
  const dealId = deal.id;

  // ---- 4. Chat ----
  console.log("\n4. Negotiation");
  r = await client("POST", `/api/client/deals/${dealId}/messages`, {
    body: "Hi! What would this cost?",
  });
  check("client can post a message", r.status, 200);

  r = await admin("POST", "/api/auth/login", {
    email: "admin@test.local",
    password: "adminpass123",
    role: "admin",
  });
  check("admin login succeeds", r.status, 200);

  r = await admin("GET", `/api/admin/deals/${dealId}`);
  check("deal moved to in_discussion", r.body.deal.status, "in_discussion");
  checkTrue(
    "admin sees the client's message",
    r.body.messages.some((m) => m.body === "Hi! What would this cost?")
  );

  r = await admin("POST", `/api/admin/deals/${dealId}/messages`, {
    body: "Happy to help — quote coming.",
  });
  check("admin can reply", r.status, 200);

  // ---- 5. Scout is walled off from the conversation ----
  console.log("\n5. Scout permissions");
  r = await scout("GET", `/api/admin/deals/${dealId}`);
  check("scout cannot read the admin deal view", r.status, 401);
  r = await scout("POST", `/api/admin/deals/${dealId}/status`, { status: "won", amount: "999999" });
  check("scout cannot set deal status", r.status, 401);
  r = await scout("POST", "/api/admin/payments", { dealId, amount: "500000" });
  check("scout cannot record payments", r.status, 401);

  // ---- 6. Quote and acceptance ----
  console.log("\n6. Quote and close");
  r = await admin("POST", `/api/admin/deals/${dealId}/quote`, { amount: "1,000,000" });
  check("quote accepted", r.status, 200);
  check("quote stored in kobo", r.body.deal.quoted_amount_kobo, 1_000_000 * NAIRA);

  r = await client("POST", `/api/client/deals/${dealId}/accept`);
  check("client accepts the quote", r.status, 200);
  check("deal is won", r.body.deal.status, "won");
  check("agreed amount carried over", r.body.deal.agreedKobo, 1_000_000 * NAIRA);
  check("deposit due is 80%", r.body.deal.depositDueKobo, 800_000 * NAIRA);

  // ---- 7. First payment: pro-rata commission ----
  console.log("\n7. Deposit paid — pro-rata commission");
  r = await admin("POST", "/api/admin/payments", {
    dealId,
    amount: "800000",
    kind: "deposit",
    note: "80% upfront",
  });
  check("deposit recorded", r.status, 200);
  check(
    "commission is 10% of what was COLLECTED, not of the deal",
    r.body.commission.amount_kobo,
    80_000 * NAIRA
  );

  r = await scout("GET", "/api/scout/wallet");
  check("commission is held, not available", r.body.balances.available, 0);
  check("commission shows as pending", r.body.balances.pending, 80_000 * NAIRA);
  check("lifetime earnings recorded", r.body.balances.lifetime, 80_000 * NAIRA);

  // Idempotency: replaying the same settlement must not pay twice.
  const { rows: pay1 } = await db.q(`SELECT provider_ref FROM payments WHERE deal_id=$1`, [dealId]);
  r = await admin("POST", `/api/admin/payments/1/confirm`);
  check("re-confirming a settled payment is refused", r.status, 400);
  r = await scout("GET", "/api/scout/wallet");
  check("balance unchanged after replay", r.body.balances.lifetime, 80_000 * NAIRA);

  // ---- 8. Withdrawal is blocked while held ----
  console.log("\n8. The 10-day hold");
  r = await scout("POST", "/api/scout/bank", {
    bankName: "GTBank",
    bankCode: "058",
    accountNumber: "0123456789",
    accountName: "Ada Scout",
  });
  check("bank details saved", r.status, 200);

  r = await scout("POST", "/api/scout/withdrawals", { amount: "80000" });
  check("cannot withdraw money still on hold", r.status, 400);
  checkTrue("refusal explains why", /available balance/i.test(r.body.error));

  // Simulate the 10 days elapsing.
  await db.q(
    `UPDATE ledger_entries SET available_at = now() - interval '1 minute' WHERE type = 'commission'`
  );
  r = await scout("GET", "/api/scout/wallet");
  check("hold expiry releases the money", r.body.balances.available, 80_000 * NAIRA);
  check("nothing left pending", r.body.balances.pending, 0);

  // ---- 9. Double-withdrawal race ----
  console.log("\n9. Concurrent withdrawal race");
  const [a, b] = await Promise.all([
    scout("POST", "/api/scout/withdrawals", { amount: "80000" }),
    scout("POST", "/api/scout/withdrawals", { amount: "80000" }),
  ]);
  const wins = [a, b].filter((x) => x.status === 200).length;
  check("exactly one of two simultaneous withdrawals succeeds", wins, 1);

  r = await scout("GET", "/api/scout/wallet");
  check("available drops to zero after payout request", r.body.balances.available, 0);

  // ---- 10. Payout lifecycle ----
  console.log("\n10. Payout");
  r = await admin("GET", "/api/admin/withdrawals");
  const wd = r.body.withdrawals.find((w) => w.status === "requested");
  checkTrue("admin sees the payout request", !!wd);
  r = await admin("POST", `/api/admin/withdrawals/${wd.id}/approve`);
  check("payout approved", r.body.withdrawal.status, "approved");
  r = await admin("POST", `/api/admin/withdrawals/${wd.id}/paid`, { note: "Sent via GTBank" });
  check("payout marked paid", r.body.withdrawal.status, "paid");

  r = await scout("GET", "/api/scout/wallet");
  check("withdrawn total recorded", r.body.balances.withdrawn, 80_000 * NAIRA);

  // ---- 11. Final instalment ----
  console.log("\n11. Balance instalment");
  r = await admin("POST", "/api/admin/payments", {
    dealId,
    amount: "200000",
    kind: "balance",
  });
  check("balance payment recorded", r.status, 200);
  check("second accrual is 10% of the balance", r.body.commission.amount_kobo, 20_000 * NAIRA);

  r = await scout("GET", "/api/scout/wallet");
  check("lifetime is now the full 10% of the deal", r.body.balances.lifetime, 100_000 * NAIRA);

  // ---- 12. Refund and clawback ----
  console.log("\n12. Refund clawback");
  r = await admin("POST", `/api/admin/payments/1/refund`, { note: "Client cancelled" });
  check("refund processed", r.status, 200);
  check("clawback reverses the exact commission", r.body.clawback.amount_kobo, -80_000 * NAIRA);

  r = await scout("GET", "/api/scout/wallet");
  check("clawback total recorded", r.body.balances.clawedBack, 80_000 * NAIRA);
  // Available = released ₦80k − withdrawn ₦80k − clawback ₦80k = −₦80k.
  // The second ₦20k accrual is still inside its own 10-day hold, so it counts
  // as pending and correctly does NOT offset the debt yet.
  check("available goes negative, as a real debt", r.body.balances.available, -80_000 * NAIRA);
  check("newer accrual stays on hold and doesn't mask the debt", r.body.balances.pending, 20_000 * NAIRA);

  r = await scout("POST", "/api/scout/withdrawals", { amount: "5000" });
  check("withdrawals blocked while in debt", r.status, 400);

  // ---- 13. Repeat referral keeps first-touch attribution ----
  console.log("\n13. First-touch attribution");
  const scout2 = browser();
  r = await scout2("POST", "/api/scouts/signup", {
    name: "Chidi Scout",
    email: "chidi@scout.test",
    password: "supersecret",
  });
  const code2 = r.body.scout.referralCode;
  const poacher = browser();
  r = await poacher("POST", `/api/invite/${code2}/claim`, {
    name: "Bola Client",
    email: "bola@client.test",
    description: "Another project",
  });
  check("second scout can still open the project", r.status, 200);
  const { rows: d2 } = await db.q(`SELECT scout_id FROM deals WHERE ref = $1`, [r.body.dealRef]);
  check("but it stays attributed to the first scout", d2[0].scout_id, 1);
  const { rows: c2 } = await db.q(`SELECT attribution FROM clients WHERE email = 'bola@client.test'`);
  check("client is flagged contested for review", c2[0].attribution, "contested");

  // ---- summary ----
  const total = passed + failures.length;
  console.log(`\n${"─".repeat(56)}`);
  if (failures.length) {
    console.log(`FAILED — ${passed}/${total} checks passed\n`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  } else {
    console.log(`PASSED — all ${total} checks green`);
    console.log(`\nLedger reconciles: earned ${formatKobo(100_000 * NAIRA)}, ` +
      `paid out ${formatKobo(80_000 * NAIRA)}, clawed back ${formatKobo(80_000 * NAIRA)}.`);
  }
  console.log("");
  await db.pool.end();
}

main().catch((e) => {
  console.error("\nCheck aborted:", e);
  process.exit(1);
});
