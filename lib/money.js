// Money helpers.
//
// Everything is integer KOBO (100 kobo = ₦1) and rates are BASIS POINTS
// (10000 bps = 100%). Nothing here returns a float, because 0.1 + 0.2 problems
// in a commission ledger are indistinguishable from theft.

const KOBO_PER_NAIRA = 100;

// Parse user input into kobo. Accepts "1000000", "1,000,000", "₦1,000,000.50",
// "1000000.5". Returns null when the input isn't a usable positive amount.
function parseNairaToKobo(input) {
  if (input === null || input === undefined) return null;
  const cleaned = String(input).replace(/[₦,\s]/g, "").trim();
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const kobo =
    BigInt(whole) * BigInt(KOBO_PER_NAIRA) + BigInt(frac.padEnd(2, "0"));
  if (kobo <= 0n) return null;
  const n = Number(kobo);
  return Number.isSafeInteger(n) ? n : null;
}

// "₦1,000,000" — the .00 is dropped when the amount is whole naira, which is
// how everyone in this market actually writes prices.
function formatKobo(kobo) {
  if (kobo === null || kobo === undefined) return "—";
  const neg = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const naira = Math.floor(abs / KOBO_PER_NAIRA);
  const rem = abs % KOBO_PER_NAIRA;
  const body = naira.toLocaleString("en-NG");
  const tail = rem === 0 ? "" : "." + String(rem).padStart(2, "0");
  return `${neg ? "-" : ""}₦${body}${tail}`;
}

// Commission on an amount. Floors, so rounding always favours the studio by at
// most one kobo rather than paying out money that was never collected.
function commissionOf(amountKobo, bps) {
  return Math.floor((Math.trunc(amountKobo) * Math.trunc(bps)) / 10000);
}

// A share of an amount by basis points — used for the 80% deposit.
function shareOf(amountKobo, bps) {
  return Math.floor((Math.trunc(amountKobo) * Math.trunc(bps)) / 10000);
}

function bpsToPercent(bps) {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2);
}

// Accepts 10, "10", "10%", 12.5 → bps. Rejects anything outside 0–100%.
function percentToBps(input) {
  const cleaned = String(input ?? "").replace("%", "").trim();
  if (!cleaned || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  if (bps < 0 || bps > 10000) return null;
  return bps;
}

module.exports = {
  KOBO_PER_NAIRA,
  parseNairaToKobo,
  formatKobo,
  commissionOf,
  shareOf,
  bpsToPercent,
  percentToBps,
};
