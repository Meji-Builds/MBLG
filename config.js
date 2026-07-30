// Central configuration for Meji Connect.
//
// Anything an operator might reasonably want to change *after* launch lives in
// the `settings` table instead (see db.js) so it can be edited from the admin
// dashboard without a redeploy. This file holds boot-time wiring only:
// credentials, the public origin, and the seed values used the first time the
// settings table is created.
require("dotenv").config();

// Guards against the single most damaging misconfiguration for this app: a
// PUBLIC_BASE_URL pasted without a scheme. Vercel's own dashboard displays a
// project's domain as bare text ("meji-connect.vercel.app"), which is exactly
// what someone copies into the env var — and a scheme-less base silently
// poisons every invite link, portal link and email link built from it.
//
// Copy-paste survives it, because WhatsApp's linkifier tolerates a missing
// scheme. The Web Share API does not: per spec, navigator.share({ url })
// resolves a scheme-less value as a RELATIVE reference against the current
// page, which turns "meji-connect.vercel.app/r/CODE" shared from
// https://meji-connect.vercel.app/scout.html into
// https://meji-connect.vercel.app/meji-connect.vercel.app/r/CODE — a real bug
// this shipped with, reported from production. Normalizing once, here, is
// cheaper than chasing every place a base URL gets used.
function normalizeBaseUrl(raw) {
  let url = String(raw || "").trim().replace(/\/+$/, "");
  if (!url) return url;
  if (!/^https?:\/\//i.test(url)) {
    console.warn(
      `[config] PUBLIC_BASE_URL "${url}" has no scheme — prepending https://. ` +
        `Set it to "https://${url}" to remove this warning.`
    );
    url = `https://${url}`;
  }
  return url;
}

module.exports = {
  brand: {
    // The platform clients and Scouts see.
    platform: "Meji Connect",
    studio: "Meji Builds",
    // What we call someone who refers business to the studio.
    role: "Scout",
    rolePlural: "Scouts",
    supportEmail: process.env.SUPPORT_EMAIL || "hello@mejibuilds.com",
  },

  // Priority: explicit PUBLIC_BASE_URL → Vercel's auto URL → localhost.
  // Invite links and client portal links are built from this, so it must match
  // the domain people actually open.
  publicBaseUrl: normalizeBaseUrl(
    process.env.PUBLIC_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
      "http://localhost:3000"
  ),

  server: {
    port: Number(process.env.PORT) || 3000,
  },

  session: {
    // Sessions are stateless HMAC tokens in an httpOnly cookie. Rotating this
    // secret logs everybody out, which is the intended panic button.
    secret: process.env.SESSION_SECRET || "",
    ttlDays: Number(process.env.SESSION_TTL_DAYS) || 30,
  },

  payments: {
    // "paystack" once keys are in place, "manual" until then. Manual mode is a
    // complete, usable system — an admin records payments they received by bank
    // transfer and every downstream behaviour (commission, holds, payouts) is
    // identical. Nothing about the platform is blocked on merchant approval.
    provider: (process.env.PAYMENT_PROVIDER || "manual").toLowerCase(),
    paystack: {
      secretKey: process.env.PAYSTACK_SECRET_KEY || "",
      publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",
    },
  },

  mail: {
    // Optional. With no provider configured the app logs links to the server
    // console and always shows them on screen, so the flow still completes.
    resendApiKey: process.env.RESEND_API_KEY || "",
    from: process.env.MAIL_FROM || "Meji Connect <onboarding@resend.dev>",
  },

  // Seed values for the `settings` table. Editable later from /admin.
  defaults: {
    commissionBps: Number(process.env.DEFAULT_COMMISSION_BPS) || 1000, // 10.00%
    holdDays: Number(process.env.HOLD_DAYS) || 10,
    minWithdrawalKobo: Number(process.env.MIN_WITHDRAWAL_KOBO) || 500000, // ₦5,000
    depositBps: Number(process.env.DEPOSIT_BPS) || 8000, // 80% upfront
    attributionWindowDays: Number(process.env.ATTRIBUTION_WINDOW_DAYS) || 365,
  },

  // First admin, created on first boot when the admins table is empty.
  seedAdmin: {
    name: process.env.ADMIN_NAME || "Meji Builds",
    email: (process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    password: process.env.ADMIN_PASSWORD || "",
  },
};
