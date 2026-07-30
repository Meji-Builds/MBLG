// The Scout wallet.
//
// One rule governs this file: a balance is always a SUM over `ledger_entries`,
// never a stored column. Stored balances drift; sums cannot. Every movement of
// money is an append-only row, so the wallet is fully reconstructible and
// auditable after the fact.
//
// Sign convention — credits positive, debits negative:
//   commission           +  earned when the client's money actually lands
//   clawback             -  a payment was refunded after commission accrued
//   withdrawal           -  written the instant a payout is REQUESTED, which is
//                           what makes double-withdrawal impossible
//   withdrawal_reversal  +  a rejected/failed payout returning the funds
//   adjustment           ±  manual correction by an admin, always with a note
const db = require("./../db");
const { commissionOf } = require("./money");

// Sum expressions shared by the balance query and the transactional check, so
// the number a Scout sees and the number we validate against can't disagree.
const SUM_AVAILABLE = `
  COALESCE(SUM(amount_kobo) FILTER (
    WHERE status = 'active' AND (available_at IS NULL OR available_at <= now())
  ), 0)`;
const SUM_PENDING = `
  COALESCE(SUM(amount_kobo) FILTER (
    WHERE status = 'active' AND amount_kobo > 0 AND available_at > now()
  ), 0)`;
const SUM_LIFETIME = `
  COALESCE(SUM(amount_kobo) FILTER (
    WHERE status = 'active' AND type = 'commission'
  ), 0)`;
const SUM_WITHDRAWN = `
  COALESCE(-SUM(amount_kobo) FILTER (
    WHERE status = 'active' AND type = 'withdrawal'
  ), 0)`;
const SUM_CLAWED = `
  COALESCE(-SUM(amount_kobo) FILTER (
    WHERE status = 'active' AND type = 'clawback'
  ), 0)`;

// Balances for one Scout. `runner` may be the pool wrapper or a transaction
// client, so the same maths runs inside and outside a transaction.
async function balances(scoutId, runner = db) {
  const sql = `
    SELECT ${SUM_AVAILABLE}  AS available,
           ${SUM_PENDING}    AS pending,
           ${SUM_LIFETIME}   AS lifetime,
           ${SUM_WITHDRAWN}  AS withdrawn,
           ${SUM_CLAWED}     AS clawed_back
    FROM ledger_entries WHERE scout_id = $1`;
  const run = runner.query ? runner.query.bind(runner) : runner.q;
  const { rows } = await run(sql, [scoutId]);
  const r = rows[0];
  return {
    available: Number(r.available),
    pending: Number(r.pending),
    lifetime: Number(r.lifetime),
    withdrawn: Number(r.withdrawn),
    clawedBack: Number(r.clawed_back),
  };
}

// Accrue commission for one successful payment — the pro-rata model.
//
// The Scout earns a share of money that has ACTUALLY been collected, not of the
// headline deal value. If the client pays 80% and then defaults, commission on
// the missing 20% simply never accrues; there is nothing to claw back and the
// studio is never out of pocket.
//
// Idempotent: the partial unique index on (payment_id) WHERE type='commission'
// means a replayed webhook or a double-clicked button is a no-op.
async function accrueForPayment(pgClient, { payment, deal, holdDays }) {
  if (!deal.scout_id) return null; // direct client, nobody to pay
  if (!deal.commission_eligible) return null; // admin ruled it out
  if (payment.status !== "success") return null;
  if (!payment.amount_kobo || payment.amount_kobo <= 0) return null;

  const amount = commissionOf(payment.amount_kobo, deal.commission_rate_bps);
  if (amount <= 0) return null;

  // The hold runs from the date the money landed, not the date the deal was
  // marked won — the clawback risk starts when the client pays.
  const paidAt = payment.paid_at || new Date();
  const { rows } = await pgClient.query(
    `INSERT INTO ledger_entries
       (scout_id, deal_id, payment_id, type, amount_kobo, available_at, note)
     VALUES ($1, $2, $3, 'commission', $4,
             ($5::timestamptz + ($6 || ' days')::interval), $7)
     ON CONFLICT (payment_id) WHERE type = 'commission' DO NOTHING
     RETURNING *`,
    [
      deal.scout_id,
      deal.id,
      payment.id,
      amount,
      paidAt,
      String(holdDays),
      `Commission on ${deal.ref}`,
    ]
  );
  return rows[0] || null;
}

// Release the hold on every commission entry still waiting on one for a deal,
// whether an admin chose to skip the wait or the client has now paid in full.
// Nothing here invents new money — it only pulls forward the `available_at` a
// held commission entry already has, which is exactly the lever the hold is
// built on (see accrueForPayment above).
async function releaseHold(pgClient, dealId) {
  const { rows } = await pgClient.query(
    `UPDATE ledger_entries SET available_at = now()
     WHERE deal_id = $1 AND type = 'commission' AND status = 'active' AND available_at > now()
     RETURNING *`,
    [dealId]
  );
  return rows;
}

// The hold exists to cover the risk of a refund before a payment is truly
// settled. Once a client has paid a deal in full there is nothing left for
// them to default on, so the risk the hold protects against is already gone —
// the commission on it releases the moment full payment lands, rather than
// waiting out a timer that no longer means anything.
async function releaseHoldIfFullyPaid(pgClient, deal) {
  if (!deal.scout_id || !deal.agreed_amount_kobo) return [];
  const { rows } = await pgClient.query(
    `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS paid
     FROM payments WHERE deal_id = $1 AND status = 'success'`,
    [deal.id]
  );
  if (Number(rows[0].paid) < Number(deal.agreed_amount_kobo)) return [];
  return releaseHold(pgClient, deal.id);
}

// How much commission on this deal is still on hold, and when the earliest of
// it would otherwise have cleared — enough for the admin UI to show a
// "release now" action only when there's actually something to release.
async function heldForDeal(dealId, runner = db) {
  const run = runner.query ? runner.query.bind(runner) : runner.q;
  const { rows } = await run(
    `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS kobo, MIN(available_at) AS earliest
     FROM ledger_entries
     WHERE deal_id = $1 AND type = 'commission' AND status = 'active' AND available_at > now()`,
    [dealId]
  );
  return { kobo: Number(rows[0].kobo), earliest: rows[0].earliest };
}

// Reverse commission when a payment is refunded. The balance is allowed to go
// negative — that is a real debt the Scout owes, and withdrawals stay blocked
// until it clears (a future commission covers it, or an admin adjusts).
async function clawbackForPayment(pgClient, { payment, deal }) {
  if (!deal.scout_id) return null;
  const { rows: existing } = await pgClient.query(
    `SELECT amount_kobo FROM ledger_entries
     WHERE payment_id = $1 AND type = 'commission' AND status = 'active'`,
    [payment.id]
  );
  if (!existing[0]) return null; // nothing ever accrued
  const amount = Number(existing[0].amount_kobo);

  const { rows } = await pgClient.query(
    `INSERT INTO ledger_entries
       (scout_id, deal_id, payment_id, type, amount_kobo, available_at, note)
     VALUES ($1, $2, $3, 'clawback', $4, now(), $5)
     ON CONFLICT (payment_id) WHERE type = 'clawback' DO NOTHING
     RETURNING *`,
    [deal.scout_id, deal.id, payment.id, -amount, `Refund reversal on ${deal.ref}`]
  );
  return rows[0] || null;
}

// Request a payout.
//
// The whole operation is one transaction that starts by locking the Scout row.
// Two concurrent requests therefore serialise: the second one re-reads a
// balance that already includes the first one's debit and is refused. Without
// the lock, both could read the same balance and both pass.
async function requestWithdrawal(scoutId, amountKobo, { minWithdrawalKobo }) {
  return db.tx(async (client) => {
    const { rows: locked } = await client.query(
      `SELECT * FROM scouts WHERE id = $1 FOR UPDATE`,
      [scoutId]
    );
    const scout = locked[0];
    if (!scout) throw new Error("Scout not found.");
    if (!scout.account_number || !scout.bank_name) {
      throw new Error("Add your bank account details before withdrawing.");
    }
    if (amountKobo < minWithdrawalKobo) {
      throw new Error("Amount is below the minimum withdrawal.");
    }

    const bal = await balances(scoutId, client);
    if (amountKobo > bal.available) {
      throw new Error("Amount is more than your available balance.");
    }

    const { rows: wrows } = await client.query(
      `INSERT INTO withdrawals
         (scout_id, amount_kobo, status, bank_code, bank_name, account_number, account_name)
       VALUES ($1, $2, 'requested', $3, $4, $5, $6)
       RETURNING *`,
      [
        scoutId,
        amountKobo,
        scout.bank_code,
        scout.bank_name,
        scout.account_number,
        scout.account_name,
      ]
    );
    const withdrawal = wrows[0];

    // Debit immediately, at request time. The money is spoken for the moment
    // the Scout asks for it — not when an admin gets around to approving.
    await client.query(
      `INSERT INTO ledger_entries
         (scout_id, withdrawal_id, type, amount_kobo, available_at, note)
       VALUES ($1, $2, 'withdrawal', $3, now(), $4)`,
      [scoutId, withdrawal.id, -amountKobo, `Withdrawal #${withdrawal.id}`]
    );

    return withdrawal;
  });
}

// Return the funds when a payout is rejected or fails at the bank. The original
// debit is left in place and a matching credit is posted, so the history shows
// what happened instead of pretending it never did.
async function reverseWithdrawal(withdrawalId, { status, note }) {
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM withdrawals WHERE id = $1 FOR UPDATE`,
      [withdrawalId]
    );
    const w = rows[0];
    if (!w) throw new Error("Withdrawal not found.");
    if (w.status === "paid") throw new Error("This payout was already paid.");
    if (w.status === "rejected") throw new Error("This payout was already rejected.");

    await client.query(
      `INSERT INTO ledger_entries
         (scout_id, withdrawal_id, type, amount_kobo, available_at, note)
       VALUES ($1, $2, 'withdrawal_reversal', $3, now(), $4)`,
      [w.scout_id, w.id, w.amount_kobo, note || `Withdrawal #${w.id} returned`]
    );
    const { rows: updated } = await client.query(
      `UPDATE withdrawals SET status = $2, note = $3, processed_at = now()
       WHERE id = $1 RETURNING *`,
      [withdrawalId, status || "rejected", note || null]
    );
    return updated[0];
  });
}

// A manual correction. Always requires a note — an unexplained adjustment in a
// commission ledger is the thing you least want to find six months later.
async function adjust(scoutId, amountKobo, note) {
  if (!note) throw new Error("An adjustment needs a reason.");
  const { rows } = await db.q(
    `INSERT INTO ledger_entries
       (scout_id, type, amount_kobo, available_at, note)
     VALUES ($1, 'adjustment', $2, now(), $3) RETURNING *`,
    [scoutId, amountKobo, note]
  );
  return rows[0];
}

// Wallet history, newest first, with the deal each entry came from.
async function history(scoutId, limit = 100) {
  const { rows } = await db.q(
    `SELECT le.*, d.ref AS deal_ref, d.title AS deal_title
     FROM ledger_entries le
     LEFT JOIN deals d ON d.id = le.deal_id
     WHERE le.scout_id = $1
     ORDER BY le.id DESC
     LIMIT $2`,
    [scoutId, limit]
  );
  return rows;
}

module.exports = {
  balances,
  accrueForPayment,
  releaseHold,
  releaseHoldIfFullyPaid,
  heldForDeal,
  clawbackForPayment,
  requestWithdrawal,
  reverseWithdrawal,
  adjust,
  history,
};
