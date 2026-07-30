// Paystack provider — checkout for clients, transfers for Scout payouts.
//
// Paystack works in kobo natively, which is the same unit this codebase stores,
// so no conversion happens anywhere in this file.
const crypto = require("crypto");
const config = require("./../../config");

const name = "paystack";
const API = "https://api.paystack.co";

function secret() {
  const k = config.payments.paystack.secretKey;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  return k;
}

async function call(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === false) {
    throw new Error(json.message || `Paystack ${path} failed (${res.status})`);
  }
  return json.data;
}

// Start a checkout. The reference embeds the deal ref so a payment can still be
// traced back by hand from the Paystack dashboard.
async function initCheckout({ deal, client, amountKobo, callbackUrl }) {
  const reference = `MC-${deal.ref}-${Date.now().toString(36).toUpperCase()}`;
  const data = await call("/transaction/initialize", {
    method: "POST",
    body: {
      email: client.email,
      amount: amountKobo, // already kobo
      reference,
      callback_url: callbackUrl,
      metadata: { deal_id: deal.id, deal_ref: deal.ref, client_id: client.id },
    },
  });
  return { mode: "redirect", url: data.authorization_url, reference, amountKobo };
}

// Ask Paystack directly whether a transaction succeeded, rather than only
// waiting on the webhook. A client's browser calls this the moment they're
// redirected back from checkout — the webhook may be slow, or never arrive at
// all if the URL isn't configured in the Paystack dashboard, and a payment
// that really went through must not be left looking unpaid because of that.
async function verifyTransaction(reference) {
  const data = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
  return {
    status: data.status === "success" ? "success" : data.status || "unknown",
    amountKobo: Number(data.amount),
    paidAt: data.paid_at ? new Date(data.paid_at) : new Date(),
  };
}

// Paystack signs the webhook with HMAC-SHA512 of the RAW request body. The body
// must not have been parsed and re-serialised first, which is why the webhook
// route is mounted with express.raw() ahead of express.json().
function verifySignature(rawBody, signature) {
  if (!signature || !rawBody) return false;
  const expected = crypto
    .createHmac("sha512", secret())
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Normalise the events we care about into the shape app.js expects.
function parseWebhook(body) {
  const event = body?.event;
  const d = body?.data || {};
  if (event === "charge.success") {
    return {
      kind: "payment",
      reference: d.reference,
      amountKobo: Number(d.amount),
      status: "success",
      paidAt: d.paid_at ? new Date(d.paid_at) : new Date(),
    };
  }
  if (event === "refund.processed" || event === "charge.refunded") {
    return {
      kind: "refund",
      reference: d.transaction_reference || d.reference,
      amountKobo: Number(d.amount),
      status: "refunded",
    };
  }
  if (event === "transfer.success" || event === "transfer.failed" || event === "transfer.reversed") {
    return {
      kind: "transfer",
      reference: d.reference,
      status: event === "transfer.success" ? "paid" : "failed",
    };
  }
  return null;
}

// Pay a Scout. Paystack needs a stored "recipient" before it can transfer, so
// we create one on first payout and reuse the code afterwards.
async function createRecipient({ accountName, accountNumber, bankCode }) {
  const data = await call("/transferrecipient", {
    method: "POST",
    body: {
      type: "nuban",
      name: accountName,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: "NGN",
    },
  });
  return data.recipient_code;
}

async function createTransfer({ withdrawal, recipientCode }) {
  const data = await call("/transfer", {
    method: "POST",
    body: {
      source: "balance",
      amount: withdrawal.amount_kobo,
      recipient: recipientCode,
      reason: `Meji Connect payout #${withdrawal.id}`,
      reference: `MCW-${withdrawal.id}-${Date.now().toString(36).toUpperCase()}`,
    },
  });
  return { mode: "api", ref: data.reference, status: data.status };
}

// Confirms an account number really belongs to the named person before we send
// money to it — cheap insurance against a typo'd account number.
async function resolveAccount({ accountNumber, bankCode }) {
  const data = await call(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`
  );
  return { accountName: data.account_name };
}

async function listBanks() {
  return call("/bank?currency=NGN");
}

module.exports = {
  name,
  initCheckout,
  verifyTransaction,
  verifySignature,
  parseWebhook,
  createRecipient,
  createTransfer,
  resolveAccount,
  listBanks,
};
