// Manual payment provider — the default, and a complete system on its own.
//
// The client is shown the studio's bank details and pays by transfer; an admin
// then records the payment from the dashboard. Everything downstream (deal
// status, commission accrual, holds, payouts) behaves identically to the
// gateway path, so Meji Connect is fully usable on day one and switching to
// Paystack later changes nothing but how the money arrives.
const db = require("./../../db");

const name = "manual";

async function initCheckout({ deal, amountKobo }) {
  const bank = {
    bank: await db.getSetting("payin_bank_name", ""),
    accountNumber: await db.getSetting("payin_account_number", ""),
    accountName: await db.getSetting("payin_account_name", ""),
  };
  return {
    mode: "manual",
    amountKobo,
    reference: `MC-${deal.ref}-${Date.now().toString(36).toUpperCase()}`,
    bank,
    // Shown verbatim to the client.
    instructions: bank.accountNumber
      ? `Transfer the amount to the account below, using ${deal.ref} as the narration. ` +
        `Your project updates here as soon as we confirm it.`
      : `Bank details haven't been published yet — send us a message here and we'll ` +
        `share them right away.`,
  };
}

// Nothing calls back to us in manual mode.
function verifySignature() {
  return false;
}
function parseWebhook() {
  return null;
}

// Payouts are done by hand from the studio's own bank, then marked paid.
async function createTransfer() {
  return { mode: "manual", ref: null, status: "manual" };
}

module.exports = { name, initCheckout, verifySignature, parseWebhook, createTransfer };
