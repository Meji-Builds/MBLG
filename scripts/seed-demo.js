#!/usr/bin/env node
// Populates a realistic set of Scouts, clients, deals, payments and payouts so
// the dashboards can be demoed (or shown to a prospective Scout) without
// touching real money.
//
//   node scripts/seed-demo.js
//
// DESTRUCTIVE: wipes every table first. Never run it against production.
require("dotenv").config();
const db = require("./../db");
const auth = require("./../lib/auth");
const ledger = require("./../lib/ledger");
const { commissionOf } = require("./../lib/money");

const PASSWORD = "demo12345";

async function main() {
  await db.ensureSchema();
  await db.q(`TRUNCATE ledger_entries, withdrawals, payments, messages, deals,
              clients, scouts, admins, audit_log, rate_limits RESTART IDENTITY CASCADE`);

  const settings = await db.getSettings();
  const hash = await auth.hashPassword(PASSWORD);

  await db.q(`INSERT INTO admins (name, email, password_hash) VALUES ($1,$2,$3)`, [
    "Meji Builds",
    "admin@mejibuilds.com",
    hash,
  ]);

  const scouts = [
    { name: "Ada Okeke", email: "ada@example.com", code: "MC-AD4K2P", rate: 1000 },
    { name: "Tunde Bakare", email: "tunde@example.com", code: "MC-TB7M9X", rate: 2000 },
  ];
  const scoutIds = [];
  for (const s of scouts) {
    const { rows } = await db.q(
      `INSERT INTO scouts (name, email, phone, password_hash, referral_code,
                           commission_rate_bps, bank_name, bank_code, account_number, account_name)
       VALUES ($1,$2,$3,$4,$5,$6,'GTBank','058','0123456789',$1) RETURNING id`,
      [s.name, s.email, "0801" + Math.floor(1000000 + Math.random() * 8999999), hash, s.code, s.rate]
    );
    scoutIds.push(rows[0].id);
  }

  // [scout index, client, company, title, status, agreed ₦, paid fraction, days since payment]
  //
  // The "days since payment" column is what makes the demo show both states of
  // the wallet at once: a payment older than the hold period has matured into
  // available balance, a recent one is still visibly counting down.
  const plan = [
    [0, "Bola Adewale", "Bola Ventures", "Web app, booking platform", "won", 1_000_000, 0.8, 15],
    [0, "Ngozi Eze", "Eze Foods", "E-commerce store", "won", 2_500_000, 1, 2],
    [0, "Kunle Ade", "Adex Logistics", "Website redesign", "quoted", 600_000, 0, 0],
    [1, "Femi Cole", "Cole & Sons", "Mobile app", "won", 4_000_000, 0.8, 20],
    [1, "Zainab Bello", "Bello Studios", "Branding and design", "lost", 350_000, 0, 0],
    [1, "Chinedu Obi", "Obi Tech", "Web app, internal tools", "in_discussion", null, 0, 0],
  ];

  let dealNo = 0;
  for (const [si, name, company, title, status, agreedNaira, paidFrac, paidDaysAgo] of plan) {
    dealNo++;
    const scoutId = scoutIds[si];
    const rate = scouts[si].rate;

    const { rows: c } = await db.q(
      `INSERT INTO clients (scout_id, referral_code_used, name, email, phone, company)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        scoutId,
        scouts[si].code,
        name,
        name.toLowerCase().replace(/[^a-z]/g, ".") + "@example.com",
        "0802" + Math.floor(1000000 + Math.random() * 8999999),
        company,
      ]
    );
    const clientId = c[0].id;
    const agreedKobo = agreedNaira ? agreedNaira * 100 : null;

    const { rows: d } = await db.q(
      `INSERT INTO deals (ref, client_id, scout_id, title, project_type, description,
                          status, quoted_amount_kobo, agreed_amount_kobo,
                          commission_rate_bps, deposit_bps, won_at, lost_reason,
                          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               now() - ($14 || ' days')::interval, now() - ($15 || ' days')::interval)
       RETURNING *`,
      [
        `PJ-DEMO${dealNo}`,
        clientId,
        scoutId,
        title,
        title.split(" ")[0],
        `Demo brief for ${company}.`,
        status,
        agreedKobo,
        status === "won" ? agreedKobo : null,
        rate,
        settings.deposit_bps,
        status === "won" ? new Date() : null,
        status === "lost" ? "Budget didn't work out" : null,
        String(30 - dealNo * 3),
        String(Math.max(0, 20 - dealNo * 3)),
      ]
    );
    const deal = d[0];

    await db.q(
      `INSERT INTO messages (deal_id, sender_type, sender_name, body) VALUES
        ($1,'system',NULL,$2),
        ($1,'client',$3,$4),
        ($1,'admin','Meji Builds',$5)`,
      [
        deal.id,
        `${name} started this project via ${scouts[si].name}. Reference ${deal.ref}.`,
        name,
        `Hi, we're looking at ${title.toLowerCase()}. What would this cost?`,
        "Thanks for reaching out. Reviewing the brief now, quote coming shortly.",
      ]
    );

    if (paidFrac > 0 && agreedKobo) {
      const amount = Math.floor(agreedKobo * paidFrac);
      await db.tx(async (client) => {
        const { rows: p } = await client.query(
          `INSERT INTO payments (deal_id, client_id, provider, provider_ref, amount_kobo,
                                 kind, status, paid_at)
           VALUES ($1,$2,'manual',$3,$4,$5,'success', now() - ($6 || ' days')::interval)
           RETURNING *`,
          [
            deal.id,
            clientId,
            `DEMO-${deal.ref}-1`,
            amount,
            paidFrac >= 1 ? "balance" : "deposit",
            String(paidDaysAgo),
          ]
        );
        await ledger.accrueForPayment(client, {
          payment: p[0],
          deal,
          holdDays: settings.hold_days,
        });
      });
      console.log(
        `  ${deal.ref}  ${name.padEnd(15)} paid ₦${(amount / 100).toLocaleString()} → ` +
          `₦${(commissionOf(amount, rate) / 100).toLocaleString()} commission`
      );
    }
  }

  // Leave one payout mid-flight so the admin payouts screen has something to
  // act on. The balance it draws from matured on its own, from the payment
  // dates above — no ledger rows are hand-edited here.
  const bal = await ledger.balances(scoutIds[0]);
  if (bal.available >= settings.min_withdrawal_kobo) {
    await ledger.requestWithdrawal(scoutIds[0], Math.floor(bal.available / 2), {
      minWithdrawalKobo: settings.min_withdrawal_kobo,
    });
  }

  await db.setSetting("payin_bank_name", "GTBank");
  await db.setSetting("payin_account_number", "0123456789");
  await db.setSetting("payin_account_name", "Meji Builds Ltd");

  console.log(`
Demo data ready.

  Admin    admin@mejibuilds.com / ${PASSWORD}
  Scout    ada@example.com      / ${PASSWORD}   (10%, has a payout pending)
  Scout    tunde@example.com    / ${PASSWORD}   (20%)

Client portals have no password. Open a deal in the admin console to chat.
`);
  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
