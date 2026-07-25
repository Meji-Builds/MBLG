// Picks the payment provider from config and exposes one interface to app.js.
//
// Every provider implements: initCheckout, verifySignature, parseWebhook,
// createTransfer. Paystack adds optional helpers (resolveAccount, listBanks)
// which callers must feature-detect, since manual mode has no such concept.
const config = require("./../../config");
const manual = require("./manual");
const paystack = require("./paystack");

const providers = { manual, paystack };

function provider() {
  const chosen = providers[config.payments.provider];
  if (!chosen) {
    console.warn(
      `[payments] unknown PAYMENT_PROVIDER "${config.payments.provider}", falling back to manual.`
    );
    return manual;
  }
  // Guard against a half-finished setup: "paystack" selected but no key yet.
  if (chosen === paystack && !config.payments.paystack.secretKey) {
    console.warn(
      "[payments] PAYMENT_PROVIDER=paystack but PAYSTACK_SECRET_KEY is missing — using manual mode."
    );
    return manual;
  }
  return chosen;
}

module.exports = { provider, providers };
