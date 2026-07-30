// Meji Connect — Express app (shared by local dev and Vercel serverless).
//
// Three audiences share one API, separated by their own session cookie:
//   Scout   refers clients, watches deal status, withdraws commission
//   Client  fills the intake form, negotiates in chat, pays
//   Admin   (Meji Builds) quotes, closes deals, records money, approves payouts
//
// The single most important authorisation rule in this file: a Scout can never
// write deal status. Anyone paid on success will mark everything successful, so
// status is admin-and-client-only and the Scout dashboard is strictly read-only
// on it. Scouts also cannot read the client chat — that negotiation is between
// the studio and the client.
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { customAlphabet } = require("nanoid");

const config = require("./config");
const db = require("./db");
const auth = require("./lib/auth");
const ledger = require("./lib/ledger");
const mailer = require("./lib/mailer");
const rl = require("./lib/ratelimit");
const { provider } = require("./lib/payments");
const {
  parseNairaToKobo,
  formatKobo,
  shareOf,
  commissionOf,
  percentToBps,
  bpsToPercent,
} = require("./lib/money");

const app = express();
app.set("trust proxy", true); // so req.protocol respects x-forwarded-proto on Vercel

// Small async wrapper so thrown errors become clean 500s.
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent)
      res.status(500).json({ ok: false, error: e.message || "Server error" });
  });

// ---------------------------------------------------------------------------
// Webhook FIRST, with the raw body.
//
// Paystack signs the exact bytes it sent. express.json() would parse and
// discard them, making the signature uncheckable — so this route is mounted
// ahead of the JSON parser deliberately. Do not move it below.
// ---------------------------------------------------------------------------
app.post(
  "/api/webhooks/paystack",
  express.raw({ type: "*/*" }),
  wrap(async (req, res) => {
    const pay = provider();
    const signature = req.get("x-paystack-signature");
    if (!pay.verifySignature(req.body, signature)) {
      return res.status(401).json({ ok: false, error: "Bad signature." });
    }
    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch {
      return res.status(400).json({ ok: false, error: "Bad payload." });
    }
    const event = pay.parseWebhook(body);
    // Always 200 an authentic webhook we simply don't care about, or Paystack
    // will retry it forever.
    if (!event) return res.json({ ok: true, ignored: true });

    if (event.kind === "payment") {
      await settlePayment(event.reference, {
        amountKobo: event.amountKobo,
        paidAt: event.paidAt,
        actor: { type: "system", label: "paystack-webhook" },
      });
    } else if (event.kind === "refund") {
      await refundPayment(event.reference, {
        actor: { type: "system", label: "paystack-webhook" },
      });
    } else if (event.kind === "transfer") {
      await settleTransfer(event.reference, event.status);
    }
    res.json({ ok: true });
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// Human-friendly codes: no 0/O/1/I to survive being read aloud or copied by hand.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const code6 = customAlphabet(CODE_ALPHABET, 6);

// Generate a code that isn't taken yet. Collisions are vanishingly unlikely but
// a UNIQUE constraint blowing up in a signup form is a bad first impression.
async function uniqueCode(table, column, prefix) {
  for (let i = 0; i < 8; i++) {
    const candidate = `${prefix}-${code6()}`;
    const { rows } = await db.q(
      `SELECT 1 FROM ${table} WHERE ${column} = $1`,
      [candidate]
    );
    if (!rows[0]) return candidate;
  }
  throw new Error("Could not allocate a unique code, please retry.");
}

// Resolve the public origin from the actual incoming request, so invite links
// always point at the domain people are really using.
function baseUrlFrom(req) {
  if (config.publicBaseUrl && !/localhost/.test(config.publicBaseUrl)) {
    return config.publicBaseUrl;
  }
  return `${req.protocol}://${req.get("host")}`;
}

const normEmail = (v) => String(v || "").trim().toLowerCase();
const normPhone = (v) => String(v || "").replace(/[^\d]/g, "");
const clean = (v, max = 500) => String(v ?? "").trim().slice(0, max) || null;

// Seed the first admin once, on first boot, from env vars. Without this there
// is no way into the admin console on a fresh deployment.
let bootstrapped;
function bootstrap() {
  if (!bootstrapped) {
    bootstrapped = (async () => {
      await db.ensureSchema();
      const { email, password, name } = config.seedAdmin;
      if (!email || !password) return;
      const { rows } = await db.q(`SELECT count(*)::int AS n FROM admins`);
      if (rows[0].n > 0) return;
      await db.q(
        `INSERT INTO admins (name, email, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [name, email, await auth.hashPassword(password)]
      );
      console.log(`[bootstrap] created first admin: ${email}`);
    })().catch((e) => {
      // Don't cache a failure — let the next request try again.
      bootstrapped = null;
      throw e;
    });
  }
  return bootstrapped;
}
app.use((req, res, next) => {
  bootstrap().then(() => next(), next);
});

async function totalPaid(dealId, runner = db) {
  const run = runner.query ? runner.query.bind(runner) : runner.q;
  const { rows } = await run(
    `SELECT COALESCE(SUM(amount_kobo), 0)::bigint AS n
     FROM payments WHERE deal_id = $1 AND status = 'success'`,
    [dealId]
  );
  return Number(rows[0].n);
}

// Everything a UI needs about a deal's money position, in one place so the
// client portal, the Scout dashboard and the admin console can never disagree.
async function dealMoney(deal) {
  const settings = await db.getSettings();
  const paid = await totalPaid(deal.id);
  const agreed = deal.agreed_amount_kobo || 0;
  const depositDue = agreed ? shareOf(agreed, deal.deposit_bps) : 0;
  return {
    paidKobo: paid,
    outstandingKobo: Math.max(0, agreed - paid),
    depositDueKobo: Math.max(0, depositDue - paid),
    depositBps: deal.deposit_bps,
    settings,
  };
}

// Post a message into a deal thread. `system` messages are how the platform
// narrates itself into the conversation — quote sent, deal closed, payment
// received — so the thread doubles as the deal's audit trail for the client.
//
// `clientRef` makes a person-composed message safe to retry: a slow mobile
// connection can drop the response after the server already wrote the row,
// which looks like a failure to the sender and invites a manual resend of the
// same text. Reusing the same clientRef on that resend hits the unique index
// on (deal_id, client_ref) instead of inserting a second row — the original
// message comes back either way, so the caller never has to know which
// attempt actually landed. System messages never pass one; they're
// server-triggered exactly once, nothing to retry against.
// Returns { row, isNew }. isNew is false only when clientRef matched an
// existing message — callers that trigger a side effect per message (the
// "you have a new message" email, in particular) must check it, or a retried
// send double-notifies the client even though the thread itself stayed
// correct.
async function postMessage(dealId, sender, body, clientRef = null) {
  if (clientRef) {
    const { rows } = await db.q(
      `INSERT INTO messages (deal_id, sender_type, sender_id, sender_name, body, client_ref)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (deal_id, client_ref) WHERE client_ref IS NOT NULL DO NOTHING
       RETURNING *`,
      [dealId, sender.type, sender.id || null, sender.name || null, body, clientRef]
    );
    if (rows[0]) return { row: rows[0], isNew: true };
    const existing = await db.q(
      `SELECT * FROM messages WHERE deal_id = $1 AND client_ref = $2`,
      [dealId, clientRef]
    );
    return { row: existing.rows[0], isNew: false };
  }
  const { rows } = await db.q(
    `INSERT INTO messages (deal_id, sender_type, sender_id, sender_name, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [dealId, sender.type, sender.id || null, sender.name || null, body]
  );
  return { row: rows[0], isNew: true };
}

// ---------------------------------------------------------------------------
// public config
// ---------------------------------------------------------------------------
app.get(
  "/api/config",
  wrap(async (req, res) => {
    const s = await db.getSettings();
    res.json({
      ok: true,
      brand: config.brand,
      baseUrl: baseUrlFrom(req),
      paymentProvider: provider().name,
      defaultCommissionPercent: bpsToPercent(s.default_commission_bps),
      holdDays: s.hold_days,
      minWithdrawalKobo: s.min_withdrawal_kobo,
      depositPercent: bpsToPercent(s.deposit_bps),
    });
  })
);

// ---------------------------------------------------------------------------
// auth — Scouts and admins
// ---------------------------------------------------------------------------
app.post(
  "/api/scouts/signup",
  rl.limit("signup", { limit: 5, windowSeconds: 3600 }),
  wrap(async (req, res) => {
    const name = clean(req.body?.name, 120);
    const email = normEmail(req.body?.email);
    const phone = clean(req.body?.phone, 40);
    const password = String(req.body?.password || "");

    if (!name) return res.status(400).json({ ok: false, error: "Your name is required." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ ok: false, error: "Enter a valid email address." });
    if (password.length < 8)
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });

    const { rows: existing } = await db.q(
      `SELECT 1 FROM scouts WHERE email = $1`,
      [email]
    );
    if (existing[0])
      return res.status(409).json({ ok: false, error: "That email is already registered." });

    const settings = await db.getSettings();
    const referral_code = await uniqueCode("scouts", "referral_code", "MC");
    const { rows } = await db.q(
      `INSERT INTO scouts (name, email, phone, password_hash, referral_code, commission_rate_bps)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        name,
        email,
        phone,
        await auth.hashPassword(password),
        referral_code,
        settings.default_commission_bps,
      ]
    );
    const scout = rows[0];
    auth.setSession(res, "scout", scout.id);
    await db.audit(
      { type: "scout", id: scout.id, label: scout.email },
      "scout.signup",
      { type: "scout", id: scout.id }
    );
    res.json({ ok: true, scout: publicScout(scout, baseUrlFrom(req)) });
  })
);

app.post(
  "/api/auth/login",
  rl.limit("login", { limit: 10, windowSeconds: 900 }),
  wrap(async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const asAdmin = req.body?.role === "admin";
    const table = asAdmin ? "admins" : "scouts";

    const { rows } = await db.q(`SELECT * FROM ${table} WHERE email = $1`, [email]);
    const user = rows[0];
    // One message for both "no such account" and "wrong password" so the form
    // can't be used to discover who has an account.
    const ok = user && (await auth.verifyPassword(password, user.password_hash));
    if (!ok)
      return res.status(401).json({ ok: false, error: "Email or password is incorrect." });
    if (!asAdmin && user.status === "suspended")
      return res.status(403).json({ ok: false, error: "Your account is suspended." });

    await db.q(`UPDATE ${table} SET last_login_at = now() WHERE id = $1`, [user.id]);
    await rl.clear(`login:${rl.ipOf(req)}`);
    auth.setSession(res, asAdmin ? "admin" : "scout", user.id);
    res.json({
      ok: true,
      role: asAdmin ? "admin" : "scout",
      user: asAdmin
        ? { id: user.id, name: user.name, email: user.email }
        : publicScout(user, baseUrlFrom(req)),
    });
  })
);

app.post(
  "/api/auth/logout",
  wrap(async (req, res) => {
    for (const role of ["scout", "admin", "client"]) auth.clearSession(res, role);
    res.json({ ok: true });
  })
);

// Which sessions does this browser hold? Lets every page decide where to send
// the visitor without a redirect loop.
app.get(
  "/api/me",
  wrap(async (req, res) => {
    const out = { ok: true, scout: null, admin: null, client: null };
    const s = auth.readSession(req, "scout");
    if (s) {
      const { rows } = await db.q(`SELECT * FROM scouts WHERE id = $1`, [s.id]);
      if (rows[0]) out.scout = publicScout(rows[0], baseUrlFrom(req));
    }
    const a = auth.readSession(req, "admin");
    if (a) {
      const { rows } = await db.q(`SELECT id, name, email FROM admins WHERE id = $1`, [a.id]);
      if (rows[0]) out.admin = rows[0];
    }
    const c = auth.readSession(req, "client");
    if (c) {
      const { rows } = await db.q(`SELECT id, name, email FROM clients WHERE id = $1`, [c.id]);
      if (rows[0]) out.client = rows[0];
    }
    res.json(out);
  })
);

// Never leak password_hash or the raw bank record to the browser.
function publicScout(s, baseUrl) {
  return {
    id: s.id,
    name: s.name,
    email: s.email,
    phone: s.phone,
    referralCode: s.referral_code,
    inviteUrl: `${baseUrl}/r/${s.referral_code}`,
    commissionPercent: bpsToPercent(s.commission_rate_bps),
    commissionBps: s.commission_rate_bps,
    status: s.status,
    bank: {
      bankName: s.bank_name || "",
      bankCode: s.bank_code || "",
      accountNumber: s.account_number || "",
      accountName: s.account_name || "",
    },
    createdAt: s.created_at,
  };
}

// ---------------------------------------------------------------------------
// invite → client intake
// ---------------------------------------------------------------------------
app.get(
  "/api/invite/:code",
  wrap(async (req, res) => {
    const { rows } = await db.q(
      `SELECT name, status FROM scouts WHERE referral_code = $1`,
      [String(req.params.code || "").toUpperCase()]
    );
    const scout = rows[0];
    if (!scout || scout.status !== "active")
      return res.status(404).json({ ok: false, error: "This invite link isn't valid." });
    res.json({ ok: true, scoutName: scout.name, brand: config.brand });
  })
);

app.post(
  "/api/invite/:code/claim",
  rl.limit("claim", { limit: 12, windowSeconds: 3600 }),
  wrap(async (req, res) => {
    const codeIn = String(req.params.code || "").toUpperCase();
    const { rows: srows } = await db.q(
      `SELECT * FROM scouts WHERE referral_code = $1`,
      [codeIn]
    );
    const scout = srows[0];
    if (!scout || scout.status !== "active")
      return res.status(404).json({ ok: false, error: "This invite link isn't valid." });

    const name = clean(req.body?.name, 120);
    const email = normEmail(req.body?.email);
    const phone = normPhone(req.body?.phone);
    const company = clean(req.body?.company, 160);
    const projectType = clean(req.body?.projectType, 80);
    const description = clean(req.body?.description, 4000);
    const budgetRange = clean(req.body?.budgetRange, 80);
    const timeline = clean(req.body?.timeline, 80);

    if (!name) return res.status(400).json({ ok: false, error: "Your name is required." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ ok: false, error: "Enter a valid email address." });
    if (!description)
      return res.status(400).json({ ok: false, error: "Tell us briefly what you need." });

    // Self-referral guard: a Scout must not be able to open a second identity
    // and pay themselves commission for work they brought in as themselves.
    if (email === scout.email || (phone && normPhone(scout.phone) === phone)) {
      return res.status(400).json({
        ok: false,
        error: "This invite link is your own. A Scout can't refer themselves.",
      });
    }

    const settings = await db.getSettings();

    // First-touch attribution. If we already know this person, the Scout who
    // introduced them originally keeps them; a second Scout's code is recorded
    // as contested for an admin to settle rather than silently reassigned.
    const { rows: crows } = await db.q(
      `SELECT * FROM clients
       WHERE lower(email) = $1 OR ($2 <> '' AND regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g') = $2)
       ORDER BY id ASC LIMIT 1`,
      [email, phone]
    );
    let client = crows[0];
    let attributionNote = null;
    let dealScoutId = scout.id;
    let eligible = true;
    let ineligibleReason = null;

    if (client) {
      if (client.scout_id === scout.id) {
        // Repeat business from a client this Scout already introduced.
        dealScoutId = scout.id;
        const ageDays =
          (Date.now() - new Date(client.created_at).getTime()) / 86400000;
        if (ageDays > settings.attribution_window_days) {
          eligible = false;
          ineligibleReason = `Outside the ${settings.attribution_window_days}-day attribution window.`;
        }
      } else if (client.scout_id) {
        // Someone else introduced them first — first touch wins.
        dealScoutId = client.scout_id;
        attributionNote = `Also claimed by ${scout.referral_code}; first touch kept.`;
        await db.q(`UPDATE clients SET attribution = 'contested' WHERE id = $1`, [
          client.id,
        ]);
      } else {
        // Already a direct Meji Builds client — nobody earns commission for
        // introducing someone the studio already had.
        dealScoutId = null;
        eligible = false;
        ineligibleReason = "Client already existed as a direct Meji Builds contact.";
        attributionNote = `Claimed by ${scout.referral_code} but client pre-existed.`;
        await db.q(`UPDATE clients SET attribution = 'contested' WHERE id = $1`, [
          client.id,
        ]);
      }
      // Keep the freshest contact details.
      await db.q(
        `UPDATE clients SET name = $2, phone = COALESCE(NULLIF($3,''), phone),
                            company = COALESCE($4, company), last_seen_at = now()
         WHERE id = $1`,
        [client.id, name, phone, company]
      );
    } else {
      const { rows } = await db.q(
        `INSERT INTO clients (scout_id, referral_code_used, name, email, phone, company, attribution)
         VALUES ($1, $2, $3, $4, $5, $6, 'locked') RETURNING *`,
        [scout.id, codeIn, name, email, phone || null, company]
      );
      client = rows[0];
    }

    const ref = await uniqueCode("deals", "ref", "PJ");
    const title = projectType
      ? `${projectType}${company ? ` for ${company}` : ""}`
      : `Project for ${company || name}`;

    const { rows: drows } = await db.q(
      `INSERT INTO deals
         (ref, client_id, scout_id, title, project_type, description, budget_range,
          timeline, status, commission_rate_bps, deposit_bps, commission_eligible, ineligible_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'new',$9,$10,$11,$12)
       RETURNING *`,
      [
        ref,
        client.id,
        dealScoutId,
        title,
        projectType,
        description,
        budgetRange,
        timeline,
        // Snapshot the rate now — a later promotion must not rewrite this deal.
        dealScoutId ? scout.commission_rate_bps : settings.default_commission_bps,
        settings.deposit_bps,
        eligible,
        ineligibleReason,
      ]
    );
    const deal = drows[0];

    await postMessage(
      deal.id,
      { type: "system" },
      `${name} started this project via ${scout.name}. Reference ${ref}.`
    );
    if (description) {
      await postMessage(deal.id, { type: "client", id: client.id, name }, description);
    }

    // The client's portal link is their account — there is no password to
    // forget. Stored hashed so a database leak doesn't hand over live links.
    const token = auth.randomToken(24);
    await db.q(`UPDATE clients SET access_token_hash = $2 WHERE id = $1`, [
      client.id,
      auth.hashToken(token),
    ]);
    auth.setSession(res, "client", client.id);

    const portalUrl = `${baseUrlFrom(req)}/client.html?t=${token}`;
    mailer
      .sendClientPortalLink({ to: client.email, name, url: portalUrl, dealRef: ref })
      .catch(() => {});

    await db.audit(
      { type: "client", id: client.id, label: client.email },
      "deal.created",
      { type: "deal", id: deal.id },
      { via: codeIn, attributed_to: dealScoutId, eligible, note: attributionNote }
    );

    res.json({ ok: true, dealRef: ref, portalUrl, emailed: mailer.enabled() });
  })
);

// ---------------------------------------------------------------------------
// client portal
// ---------------------------------------------------------------------------

// Exchange a portal link token for a session cookie.
app.post(
  "/api/client/auth",
  rl.limit("clientauth", { limit: 20, windowSeconds: 900 }),
  wrap(async (req, res) => {
    const token = String(req.body?.token || "");
    if (!token) return res.status(400).json({ ok: false, error: "Missing link token." });
    const { rows } = await db.q(
      `SELECT * FROM clients WHERE access_token_hash = $1`,
      [auth.hashToken(token)]
    );
    const client = rows[0];
    if (!client)
      return res.status(401).json({ ok: false, error: "This link is no longer valid." });
    await db.q(`UPDATE clients SET last_seen_at = now() WHERE id = $1`, [client.id]);
    auth.setSession(res, "client", client.id);
    res.json({ ok: true, client: { id: client.id, name: client.name } });
  })
);

app.get(
  "/api/client/deals",
  auth.requireClient,
  wrap(async (req, res) => {
    const { rows } = await db.q(
      `SELECT * FROM deals WHERE client_id = $1 ORDER BY id DESC`,
      [req.client.id]
    );
    const deals = [];
    for (const d of rows) deals.push(await clientDealView(d));
    res.json({
      ok: true,
      client: { id: req.client.id, name: req.client.name, email: req.client.email },
      deals,
    });
  })
);

async function clientDealView(deal) {
  const money = await dealMoney(deal);
  const { rows: pays } = await db.q(
    `SELECT id, amount_kobo, kind, status, paid_at, created_at, note
     FROM payments WHERE deal_id = $1 ORDER BY id DESC`,
    [deal.id]
  );
  return {
    id: deal.id,
    ref: deal.ref,
    title: deal.title,
    status: deal.status,
    projectType: deal.project_type,
    description: deal.description,
    quotedKobo: deal.quoted_amount_kobo,
    agreedKobo: deal.agreed_amount_kobo,
    depositBps: deal.deposit_bps,
    createdAt: deal.created_at,
    ...money,
    settings: undefined, // internal only
    payments: pays,
  };
}

// Chat. Short-poll with ?since=<last id> — Vercel serverless can't hold a
// WebSocket open, and polling is the right tool at this scale anyway.
app.get(
  "/api/client/deals/:id/messages",
  auth.requireClient,
  wrap(async (req, res) => {
    const deal = await ownedDeal(req.params.id, { clientId: req.client.id });
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });
    const since = Number(req.query.since) || 0;
    const { rows } = await db.q(
      `SELECT id, sender_type, sender_name, body, created_at
       FROM messages WHERE deal_id = $1 AND id > $2 ORDER BY id ASC`,
      [deal.id, since]
    );
    await db.q(
      `UPDATE messages SET read_by_client_at = now()
       WHERE deal_id = $1 AND sender_type = 'admin' AND read_by_client_at IS NULL`,
      [deal.id]
    );
    res.json({ ok: true, messages: rows });
  })
);

app.post(
  "/api/client/deals/:id/messages",
  auth.requireClient,
  wrap(async (req, res) => {
    const deal = await ownedDeal(req.params.id, { clientId: req.client.id });
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });
    const body = clean(req.body?.body, 4000);
    if (!body) return res.status(400).json({ ok: false, error: "Message is empty." });
    const clientRef = clean(req.body?.clientRef, 80);
    const { row: msg } = await postMessage(
      deal.id,
      { type: "client", id: req.client.id, name: req.client.name },
      body,
      clientRef
    );
    // Nudge the deal out of 'new' the moment a real conversation starts.
    if (deal.status === "new") {
      await db.q(
        `UPDATE deals SET status = 'in_discussion', updated_at = now() WHERE id = $1`,
        [deal.id]
      );
    }
    res.json({ ok: true, message: msg });
  })
);

// The client accepting their own quote is what closes the deal. This is safe:
// the client has no financial incentive to lie about agreeing to pay, whereas a
// Scout would. It also means a deal closes the moment the client says yes,
// rather than waiting for an admin to notice.
app.post(
  "/api/client/deals/:id/accept",
  auth.requireClient,
  wrap(async (req, res) => {
    const deal = await ownedDeal(req.params.id, { clientId: req.client.id });
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });
    if (deal.status !== "quoted" || !deal.quoted_amount_kobo)
      return res.status(400).json({ ok: false, error: "There's no quote to accept yet." });

    const { rows } = await db.q(
      `UPDATE deals SET status = 'won', agreed_amount_kobo = quoted_amount_kobo,
                        won_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [deal.id]
    );
    const updated = rows[0];
    await postMessage(
      deal.id,
      { type: "system" },
      `${req.client.name} accepted the quote of ${formatKobo(updated.agreed_amount_kobo)}.`
    );
    await db.audit(
      { type: "client", id: req.client.id, label: req.client.email },
      "deal.accepted",
      { type: "deal", id: deal.id },
      { amount_kobo: updated.agreed_amount_kobo }
    );
    await notifyScoutOfStatus(updated, "won", baseUrlFrom(req));
    res.json({ ok: true, deal: await clientDealView(updated) });
  })
);

// Start a payment. In manual mode this records a pending payment and returns
// the studio's bank details; in Paystack mode it returns a checkout URL. Either
// way a `payments` row exists first, so an admin can always see that a client
// intended to pay even if they never finished.
app.post(
  "/api/client/deals/:id/pay",
  auth.requireClient,
  wrap(async (req, res) => {
    const deal = await ownedDeal(req.params.id, { clientId: req.client.id });
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });
    if (deal.status !== "won")
      return res.status(400).json({ ok: false, error: "This project isn't agreed yet." });

    const money = await dealMoney(deal);
    const kind = req.body?.kind === "full" ? "full" : "deposit";
    const amountKobo =
      kind === "full" ? money.outstandingKobo : money.depositDueKobo || money.outstandingKobo;

    if (amountKobo <= 0)
      return res.status(400).json({ ok: false, error: "This project is already paid in full." });

    const pay = provider();
    const init = await pay.initCheckout({
      deal,
      client: req.client,
      amountKobo,
      callbackUrl: `${baseUrlFrom(req)}/client.html?paid=1`,
    });

    await db.q(
      `INSERT INTO payments (deal_id, client_id, provider, provider_ref, amount_kobo, kind, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [
        deal.id,
        req.client.id,
        pay.name,
        init.reference,
        amountKobo,
        kind === "full" ? "balance" : "deposit",
      ]
    );

    res.json({ ok: true, ...init });
  })
);

// A deal row the caller is actually allowed to see.
async function ownedDeal(id, { clientId, scoutId } = {}) {
  const params = [Number(id)];
  let sql = `SELECT * FROM deals WHERE id = $1`;
  if (clientId) {
    sql += ` AND client_id = $2`;
    params.push(clientId);
  }
  if (scoutId) {
    sql += ` AND scout_id = $${params.length + 1}`;
    params.push(scoutId);
  }
  const { rows } = await db.q(sql, params);
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Scout dashboard — READ-ONLY on everything except their own bank details and
// withdrawal requests. There is deliberately no route here that writes deal
// status, quotes, or payments.
// ---------------------------------------------------------------------------
app.get(
  "/api/scout/dashboard",
  auth.requireScout,
  wrap(async (req, res) => {
    const scout = req.scout;
    const settings = await db.getSettings();
    const bal = await ledger.balances(scout.id);

    // Scouts see status and money, never the client conversation.
    const { rows: deals } = await db.q(
      `SELECT d.id, d.ref, d.title, d.status, d.agreed_amount_kobo, d.quoted_amount_kobo,
              d.commission_rate_bps, d.commission_eligible, d.ineligible_reason,
              d.created_at, d.won_at, d.lost_reason,
              c.name AS client_name, c.company AS client_company,
              COALESCE((SELECT SUM(p.amount_kobo) FROM payments p
                        WHERE p.deal_id = d.id AND p.status = 'success'), 0)::bigint AS paid_kobo,
              COALESCE((SELECT SUM(le.amount_kobo) FROM ledger_entries le
                        WHERE le.deal_id = d.id AND le.scout_id = d.scout_id
                          AND le.type IN ('commission','clawback') AND le.status = 'active'), 0)::bigint AS earned_kobo
       FROM deals d
       JOIN clients c ON c.id = d.client_id
       WHERE d.scout_id = $1
       ORDER BY d.id DESC`,
      [scout.id]
    );

    const stats = {
      total: deals.length,
      open: deals.filter((d) => ["new", "in_discussion", "quoted"].includes(d.status)).length,
      won: deals.filter((d) => d.status === "won").length,
      lost: deals.filter((d) => ["lost", "cancelled"].includes(d.status)).length,
    };

    res.json({
      ok: true,
      scout: publicScout(scout, baseUrlFrom(req)),
      balances: bal,
      stats,
      deals: deals.map((d) => ({
        id: d.id,
        ref: d.ref,
        title: d.title,
        status: d.status,
        clientName: d.client_name,
        clientCompany: d.client_company,
        quotedKobo: d.quoted_amount_kobo,
        agreedKobo: d.agreed_amount_kobo,
        paidKobo: Number(d.paid_kobo),
        earnedKobo: Number(d.earned_kobo),
        commissionPercent: bpsToPercent(d.commission_rate_bps),
        eligible: d.commission_eligible,
        ineligibleReason: d.ineligible_reason,
        lostReason: d.lost_reason,
        createdAt: d.created_at,
        wonAt: d.won_at,
      })),
      settings: {
        holdDays: settings.hold_days,
        minWithdrawalKobo: settings.min_withdrawal_kobo,
      },
    });
  })
);

app.get(
  "/api/scout/wallet",
  auth.requireScout,
  wrap(async (req, res) => {
    const [bal, entries, wrows, settings] = await Promise.all([
      ledger.balances(req.scout.id),
      ledger.history(req.scout.id),
      db.q(`SELECT * FROM withdrawals WHERE scout_id = $1 ORDER BY id DESC`, [req.scout.id]),
      db.getSettings(),
    ]);
    res.json({
      ok: true,
      balances: bal,
      entries,
      withdrawals: wrows.rows,
      settings: {
        holdDays: settings.hold_days,
        minWithdrawalKobo: settings.min_withdrawal_kobo,
      },
    });
  })
);

app.post(
  "/api/scout/bank",
  auth.requireScout,
  wrap(async (req, res) => {
    const bankName = clean(req.body?.bankName, 80);
    const bankCode = clean(req.body?.bankCode, 10);
    const accountNumber = normPhone(req.body?.accountNumber).slice(0, 20);
    const accountName = clean(req.body?.accountName, 120);

    if (!bankName || !accountNumber || !accountName)
      return res.status(400).json({ ok: false, error: "Bank, account number and account name are all required." });
    if (accountNumber.length < 10)
      return res.status(400).json({ ok: false, error: "Account number looks too short." });

    const { rows } = await db.q(
      `UPDATE scouts SET bank_name = $2, bank_code = $3, account_number = $4,
                         account_name = $5, payout_recipient_ref = NULL
       WHERE id = $1 RETURNING *`,
      [req.scout.id, bankName, bankCode, accountNumber, accountName]
    );
    // Clearing payout_recipient_ref forces a fresh Paystack recipient next time,
    // so money can never go to the previously stored account.
    await db.audit(
      { type: "scout", id: req.scout.id, label: req.scout.email },
      "scout.bank_updated",
      { type: "scout", id: req.scout.id },
      { bank: bankName, account: accountNumber.slice(-4) }
    );
    res.json({ ok: true, scout: publicScout(rows[0], baseUrlFrom(req)) });
  })
);

app.post(
  "/api/scout/withdrawals",
  auth.requireScout,
  wrap(async (req, res) => {
    const amountKobo = parseNairaToKobo(req.body?.amount);
    if (!amountKobo)
      return res.status(400).json({ ok: false, error: "Enter a valid amount." });
    const settings = await db.getSettings();
    try {
      const w = await ledger.requestWithdrawal(req.scout.id, amountKobo, {
        minWithdrawalKobo: settings.min_withdrawal_kobo,
      });
      await db.audit(
        { type: "scout", id: req.scout.id, label: req.scout.email },
        "withdrawal.requested",
        { type: "withdrawal", id: w.id },
        { amount_kobo: amountKobo }
      );
      res.json({ ok: true, withdrawal: w, balances: await ledger.balances(req.scout.id) });
    } catch (e) {
      // These are user-facing validation failures from the ledger, not bugs.
      res.status(400).json({ ok: false, error: e.message });
    }
  })
);

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------
app.get(
  "/api/admin/overview",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows: d } = await db.q(`
      SELECT
        count(*)::int AS deals,
        count(*) FILTER (WHERE status IN ('new','in_discussion','quoted'))::int AS open,
        count(*) FILTER (WHERE status = 'won')::int AS won,
        count(*) FILTER (WHERE status IN ('lost','cancelled'))::int AS lost
      FROM deals`);
    const { rows: m } = await db.q(`
      SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'success'), 0)::bigint AS collected,
             COALESCE(SUM(amount_kobo) FILTER (WHERE status = 'pending'), 0)::bigint AS awaiting
      FROM payments`);
    const { rows: l } = await db.q(`
      SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type = 'commission' AND status='active'), 0)::bigint AS earned,
             COALESCE(-SUM(amount_kobo) FILTER (WHERE type = 'withdrawal' AND status='active'), 0)::bigint AS paid_out
      FROM ledger_entries`);
    const { rows: w } = await db.q(
      `SELECT count(*)::int AS n FROM withdrawals WHERE status IN ('requested','approved','processing')`
    );
    const { rows: s } = await db.q(`SELECT count(*)::int AS n FROM scouts WHERE status = 'active'`);
    res.json({
      ok: true,
      deals: d[0],
      money: {
        collectedKobo: Number(m[0].collected),
        awaitingKobo: Number(m[0].awaiting),
        commissionEarnedKobo: Number(l[0].earned),
        commissionPaidKobo: Number(l[0].paid_out),
      },
      pendingWithdrawals: w[0].n,
      activeScouts: s[0].n,
    });
  })
);

app.get(
  "/api/admin/deals",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const status = clean(req.query?.status, 30);
    const params = [];
    let where = "";
    if (status && status !== "all") {
      params.push(status);
      where = `WHERE d.status = $1`;
    }
    const { rows } = await db.q(
      `SELECT d.*, c.name AS client_name, c.email AS client_email, c.company AS client_company,
              c.attribution,
              s.name AS scout_name, s.referral_code,
              COALESCE((SELECT SUM(p.amount_kobo) FROM payments p
                        WHERE p.deal_id = d.id AND p.status='success'),0)::bigint AS paid_kobo,
              (SELECT count(*) FROM messages m
                WHERE m.deal_id = d.id AND m.sender_type='client' AND m.read_by_admin_at IS NULL)::int AS unread
       FROM deals d
       JOIN clients c ON c.id = d.client_id
       LEFT JOIN scouts s ON s.id = d.scout_id
       ${where}
       ORDER BY d.updated_at DESC, d.id DESC
       LIMIT 200`,
      params
    );
    res.json({ ok: true, deals: rows });
  })
);

app.get(
  "/api/admin/deals/:id",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(
      `SELECT d.*, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
              c.company AS client_company, c.attribution,
              s.name AS scout_name, s.email AS scout_email, s.referral_code
       FROM deals d
       JOIN clients c ON c.id = d.client_id
       LEFT JOIN scouts s ON s.id = d.scout_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    const deal = rows[0];
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });

    const [msgs, pays, money] = await Promise.all([
      db.q(
        `SELECT id, sender_type, sender_name, body, created_at
         FROM messages WHERE deal_id = $1 ORDER BY id ASC`,
        [deal.id]
      ),
      db.q(`SELECT * FROM payments WHERE deal_id = $1 ORDER BY id DESC`, [deal.id]),
      dealMoney(deal),
    ]);
    await db.q(
      `UPDATE messages SET read_by_admin_at = now()
       WHERE deal_id = $1 AND sender_type = 'client' AND read_by_admin_at IS NULL`,
      [deal.id]
    );
    res.json({
      ok: true,
      deal,
      messages: msgs.rows,
      payments: pays.rows,
      money: { paidKobo: money.paidKobo, outstandingKobo: money.outstandingKobo, depositDueKobo: money.depositDueKobo },
      projectedCommissionKobo: deal.agreed_amount_kobo
        ? commissionOf(deal.agreed_amount_kobo, deal.commission_rate_bps)
        : null,
    });
  })
);

app.get(
  "/api/admin/deals/:id/messages",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const since = Number(req.query.since) || 0;
    const { rows } = await db.q(
      `SELECT id, sender_type, sender_name, body, created_at
       FROM messages WHERE deal_id = $1 AND id > $2 ORDER BY id ASC`,
      [req.params.id, since]
    );
    await db.q(
      `UPDATE messages SET read_by_admin_at = now()
       WHERE deal_id = $1 AND sender_type = 'client' AND read_by_admin_at IS NULL`,
      [req.params.id]
    );
    res.json({ ok: true, messages: rows });
  })
);

app.post(
  "/api/admin/deals/:id/messages",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const body = clean(req.body?.body, 4000);
    if (!body) return res.status(400).json({ ok: false, error: "Message is empty." });
    const deal = await ownedDeal(req.params.id);
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });

    const clientRef = clean(req.body?.clientRef, 80);
    const { row: msg, isNew } = await postMessage(
      deal.id,
      { type: "admin", id: req.admin.id, name: req.admin.name },
      body,
      clientRef
    );
    if (deal.status === "new") {
      await db.q(
        `UPDATE deals SET status = 'in_discussion', updated_at = now() WHERE id = $1`,
        [deal.id]
      );
    }
    // Skip the email on a deduped retry — the client already has this message
    // in their thread from the original attempt and does not need telling twice.
    if (isNew) {
      const { rows: crows } = await db.q(`SELECT * FROM clients WHERE id = $1`, [deal.client_id]);
      if (crows[0]) {
        mailer
          .sendNewMessageAlert({
            to: crows[0].email,
            name: crows[0].name,
            url: `${baseUrlFrom(req)}/client.html`,
            from: config.brand.studio,
          })
          .catch(() => {});
      }
    }
    res.json({ ok: true, message: msg });
  })
);

// Send a quote. Recorded as a system message so the client has a written trail
// of exactly what was offered and when.
app.post(
  "/api/admin/deals/:id/quote",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const amountKobo = parseNairaToKobo(req.body?.amount);
    if (!amountKobo) return res.status(400).json({ ok: false, error: "Enter a valid amount." });
    const deal = await ownedDeal(req.params.id);
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });
    if (["won", "lost", "cancelled"].includes(deal.status))
      return res.status(400).json({ ok: false, error: "This deal is already closed." });

    const { rows } = await db.q(
      `UPDATE deals SET quoted_amount_kobo = $2, status = 'quoted', updated_at = now()
       WHERE id = $1 RETURNING *`,
      [deal.id, amountKobo]
    );
    const depositKobo = shareOf(amountKobo, rows[0].deposit_bps);
    await postMessage(
      deal.id,
      { type: "system" },
      `Quote sent: ${formatKobo(amountKobo)} for ${rows[0].title}. ` +
        `To start, ${formatKobo(depositKobo)} (${bpsToPercent(rows[0].deposit_bps)}%) is due upfront.`
    );
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "deal.quoted",
      { type: "deal", id: deal.id },
      { amount_kobo: amountKobo }
    );
    res.json({ ok: true, deal: rows[0] });
  })
);

// Deal status. Admin-only by design — see the note at the top of this file.
app.post(
  "/api/admin/deals/:id/status",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const status = clean(req.body?.status, 20);
    const allowed = ["new", "in_discussion", "quoted", "won", "lost", "cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({ ok: false, error: "Unknown status." });

    const deal = await ownedDeal(req.params.id);
    if (!deal) return res.status(404).json({ ok: false, error: "Not found." });

    let agreed = deal.agreed_amount_kobo;
    if (status === "won") {
      agreed = parseNairaToKobo(req.body?.amount) || deal.agreed_amount_kobo || deal.quoted_amount_kobo;
      if (!agreed)
        return res.status(400).json({
          ok: false,
          error: "Set the agreed amount before marking this won.",
        });
    }
    const reason = clean(req.body?.reason, 300);

    const { rows } = await db.q(
      `UPDATE deals SET status = $2,
                        agreed_amount_kobo = $3,
                        won_at  = CASE WHEN $2 = 'won'  THEN COALESCE(won_at, now())  ELSE won_at  END,
                        lost_at = CASE WHEN $2 IN ('lost','cancelled') THEN now() ELSE NULL END,
                        lost_reason = CASE WHEN $2 IN ('lost','cancelled') THEN $4 ELSE NULL END,
                        updated_at = now()
       WHERE id = $1 RETURNING *`,
      [deal.id, status, agreed, reason]
    );
    const updated = rows[0];

    if (status === "won")
      await postMessage(
        deal.id,
        { type: "system" },
        `Project agreed at ${formatKobo(agreed)}.`
      );
    if (status === "lost" || status === "cancelled")
      await postMessage(
        deal.id,
        { type: "system" },
        `This project was closed.${reason ? ` Reason: ${reason}` : ""}`
      );

    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "deal.status",
      { type: "deal", id: deal.id },
      { status, agreed_amount_kobo: agreed, reason }
    );
    await notifyScoutOfStatus(updated, status, baseUrlFrom(req));
    res.json({ ok: true, deal: updated });
  })
);

// Rule a deal in or out of commission — e.g. the client was already a direct
// Meji Builds contact and no Scout should be paid for the introduction.
app.post(
  "/api/admin/deals/:id/eligibility",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const eligible = !!req.body?.eligible;
    const reason = clean(req.body?.reason, 300);
    if (!eligible && !reason)
      return res.status(400).json({ ok: false, error: "Give a reason when removing commission." });

    const { rows } = await db.q(
      `UPDATE deals SET commission_eligible = $2, ineligible_reason = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, eligible, eligible ? null : reason]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found." });
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "deal.eligibility",
      { type: "deal", id: rows[0].id },
      { eligible, reason }
    );
    // Existing accruals are left alone on purpose — money already earned is not
    // silently removed. Use a ledger adjustment if it truly must be reversed.
    res.json({ ok: true, deal: rows[0] });
  })
);

// Reassign attribution after settling a contested claim.
app.post(
  "/api/admin/deals/:id/attribution",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const scoutId = req.body?.scoutId ? Number(req.body.scoutId) : null;
    const { rows: existing } = await db.q(
      `SELECT COALESCE(SUM(amount_kobo),0)::bigint AS n FROM ledger_entries
       WHERE deal_id = $1 AND type = 'commission' AND status = 'active'`,
      [req.params.id]
    );
    if (Number(existing[0].n) > 0)
      return res.status(400).json({
        ok: false,
        error: "Commission has already accrued on this deal. Adjust the wallet instead.",
      });

    const { rows } = await db.q(
      `UPDATE deals SET scout_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, scoutId]
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found." });
    await db.q(`UPDATE clients SET attribution = 'locked' WHERE id = $1`, [rows[0].client_id]);
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "deal.attribution",
      { type: "deal", id: rows[0].id },
      { scout_id: scoutId }
    );
    res.json({ ok: true, deal: rows[0] });
  })
);

// ---- payments (admin) ----

// Record money that arrived outside the platform (bank transfer, cash). This is
// the whole payment path in manual mode, and the correction path in Paystack
// mode. Commission accrues here exactly as it does from a webhook.
app.post(
  "/api/admin/payments",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const dealId = Number(req.body?.dealId);
    const amountKobo = parseNairaToKobo(req.body?.amount);
    const kind = ["deposit", "balance", "part"].includes(req.body?.kind)
      ? req.body.kind
      : "part";
    const note = clean(req.body?.note, 300);
    if (!amountKobo) return res.status(400).json({ ok: false, error: "Enter a valid amount." });

    const deal = await ownedDeal(dealId);
    if (!deal) return res.status(404).json({ ok: false, error: "Deal not found." });
    if (deal.status !== "won")
      return res.status(400).json({
        ok: false,
        error: "Mark the deal won (with an agreed amount) before recording payment.",
      });

    const reference = `MAN-${deal.ref}-${Date.now().toString(36).toUpperCase()}`;
    const result = await db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO payments (deal_id, client_id, provider, provider_ref, amount_kobo,
                               kind, status, paid_at, recorded_by, note)
         VALUES ($1,$2,'manual',$3,$4,$5,'success',now(),$6,$7) RETURNING *`,
        [deal.id, deal.client_id, reference, amountKobo, kind, req.admin.id, note]
      );
      const payment = rows[0];
      const settings = await db.getSettings();
      const entry = await ledger.accrueForPayment(client, {
        payment,
        deal,
        holdDays: settings.hold_days,
      });
      return { payment, entry };
    });

    await postMessage(
      deal.id,
      { type: "system" },
      `Payment of ${formatKobo(amountKobo)} received.`
    );
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "payment.recorded",
      { type: "payment", id: result.payment.id },
      { deal_id: deal.id, amount_kobo: amountKobo, commission_kobo: result.entry?.amount_kobo || 0 }
    );
    res.json({ ok: true, payment: result.payment, commission: result.entry });
  })
);

// Confirm a payment the client started (manual mode: they said they'd transfer).
app.post(
  "/api/admin/payments/:id/confirm",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(`SELECT provider_ref FROM payments WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Payment not found." });
    const out = await settlePayment(rows[0].provider_ref, {
      actor: { type: "admin", id: req.admin.id, label: req.admin.email },
    });
    if (!out) return res.status(400).json({ ok: false, error: "That payment is already settled." });
    res.json({ ok: true, ...out });
  })
);

app.post(
  "/api/admin/payments/:id/refund",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(`SELECT provider_ref FROM payments WHERE id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Payment not found." });
    const out = await refundPayment(rows[0].provider_ref, {
      actor: { type: "admin", id: req.admin.id, label: req.admin.email },
      note: clean(req.body?.note, 300),
    });
    if (!out) return res.status(400).json({ ok: false, error: "That payment can't be refunded." });
    res.json({ ok: true, ...out });
  })
);

// Mark a pending payment successful and accrue commission. Shared by the
// Paystack webhook and the admin confirm button so both paths behave the same.
// Idempotent at two levels: the status guard here, and the unique index on
// commission entries in the ledger.
async function settlePayment(reference, { amountKobo, paidAt, actor } = {}) {
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE provider_ref = $1 FOR UPDATE`,
      [reference]
    );
    const payment = rows[0];
    if (!payment || payment.status === "success") return null;

    const { rows: updated } = await client.query(
      `UPDATE payments SET status = 'success', paid_at = COALESCE($2, now()),
                           amount_kobo = COALESCE($3, amount_kobo)
       WHERE id = $1 RETURNING *`,
      [payment.id, paidAt || null, amountKobo || null]
    );
    const settled = updated[0];

    const { rows: drows } = await client.query(`SELECT * FROM deals WHERE id = $1`, [
      settled.deal_id,
    ]);
    const deal = drows[0];
    const settings = await db.getSettings();
    const entry = await ledger.accrueForPayment(client, {
      payment: settled,
      deal,
      holdDays: settings.hold_days,
    });

    await db.audit(actor, "payment.settled", { type: "payment", id: settled.id }, {
      deal_id: deal.id,
      amount_kobo: settled.amount_kobo,
      commission_kobo: entry?.amount_kobo || 0,
    });
    return { payment: settled, commission: entry };
  });
}

// Refund a settled payment and claw back the commission it produced.
async function refundPayment(reference, { actor, note } = {}) {
  return db.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE provider_ref = $1 FOR UPDATE`,
      [reference]
    );
    const payment = rows[0];
    if (!payment || payment.status !== "success") return null;

    const { rows: updated } = await client.query(
      `UPDATE payments SET status = 'refunded', note = COALESCE($2, note)
       WHERE id = $1 RETURNING *`,
      [payment.id, note || null]
    );
    const { rows: drows } = await client.query(`SELECT * FROM deals WHERE id = $1`, [
      payment.deal_id,
    ]);
    const entry = await ledger.clawbackForPayment(client, {
      payment,
      deal: drows[0],
    });
    await db.audit(actor, "payment.refunded", { type: "payment", id: payment.id }, {
      deal_id: payment.deal_id,
      amount_kobo: payment.amount_kobo,
      clawback_kobo: entry?.amount_kobo || 0,
    });
    return { payment: updated[0], clawback: entry };
  });
}

// ---- withdrawals (admin) ----
app.get(
  "/api/admin/withdrawals",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(
      `SELECT w.*, s.name AS scout_name, s.email AS scout_email, s.referral_code
       FROM withdrawals w JOIN scouts s ON s.id = w.scout_id
       ORDER BY CASE WHEN w.status = 'requested' THEN 0 ELSE 1 END, w.id DESC
       LIMIT 200`
    );
    res.json({ ok: true, withdrawals: rows });
  })
);

app.post(
  "/api/admin/withdrawals/:id/:action",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const action = req.params.action;
    const id = Number(req.params.id);
    const note = clean(req.body?.note, 300);
    const actor = { type: "admin", id: req.admin.id, label: req.admin.email };

    if (action === "reject") {
      const w = await ledger.reverseWithdrawal(id, { status: "rejected", note });
      await db.audit(actor, "withdrawal.rejected", { type: "withdrawal", id }, { note });
      return res.json({ ok: true, withdrawal: w });
    }

    if (action === "approve") {
      const { rows } = await db.q(
        `UPDATE withdrawals SET status = 'approved', processed_by = $2
         WHERE id = $1 AND status = 'requested' RETURNING *`,
        [id, req.admin.id]
      );
      if (!rows[0])
        return res.status(400).json({ ok: false, error: "Only a requested payout can be approved." });
      await db.audit(actor, "withdrawal.approved", { type: "withdrawal", id });
      return res.json({ ok: true, withdrawal: rows[0] });
    }

    if (action === "paid") {
      // The debit is already on the ledger from request time, so marking paid
      // only records that the money physically left.
      const { rows } = await db.q(
        `UPDATE withdrawals SET status = 'paid', processed_at = now(), processed_by = $2,
                                note = COALESCE($3, note), provider = COALESCE(provider,'manual')
         WHERE id = $1 AND status IN ('requested','approved','processing') RETURNING *`,
        [id, req.admin.id, note]
      );
      if (!rows[0])
        return res.status(400).json({ ok: false, error: "That payout can't be marked paid." });
      await db.audit(actor, "withdrawal.paid", { type: "withdrawal", id }, { note });
      return res.json({ ok: true, withdrawal: rows[0] });
    }

    // Send the money through Paystack Transfers. Only available when the
    // gateway is configured; otherwise pay by bank transfer and mark it paid.
    if (action === "send") {
      const pay = provider();
      if (pay.name !== "paystack")
        return res.status(400).json({
          ok: false,
          error: "Automatic transfers need Paystack configured. Pay manually and mark it paid.",
        });

      const { rows } = await db.q(
        `SELECT w.*, s.payout_recipient_ref, s.account_name, s.account_number, s.bank_code
         FROM withdrawals w JOIN scouts s ON s.id = w.scout_id WHERE w.id = $1`,
        [id]
      );
      const w = rows[0];
      if (!w) return res.status(404).json({ ok: false, error: "Not found." });
      if (!["requested", "approved"].includes(w.status))
        return res.status(400).json({ ok: false, error: "That payout can't be sent." });
      if (!w.bank_code)
        return res.status(400).json({ ok: false, error: "This Scout has no bank code saved." });

      let recipient = w.payout_recipient_ref;
      if (!recipient) {
        recipient = await pay.createRecipient({
          accountName: w.account_name,
          accountNumber: w.account_number,
          bankCode: w.bank_code,
        });
        await db.q(`UPDATE scouts SET payout_recipient_ref = $2 WHERE id = $1`, [
          w.scout_id,
          recipient,
        ]);
      }
      const t = await pay.createTransfer({ withdrawal: w, recipientCode: recipient });
      const { rows: up } = await db.q(
        `UPDATE withdrawals SET status = 'processing', provider = 'paystack', provider_ref = $2,
                                processed_by = $3
         WHERE id = $1 RETURNING *`,
        [id, t.ref, req.admin.id]
      );
      await db.audit(actor, "withdrawal.sent", { type: "withdrawal", id }, { ref: t.ref });
      return res.json({ ok: true, withdrawal: up[0] });
    }

    res.status(400).json({ ok: false, error: "Unknown action." });
  })
);

// Paystack transfer outcome. A failed transfer must put the money back.
async function settleTransfer(reference, status) {
  const { rows } = await db.q(`SELECT * FROM withdrawals WHERE provider_ref = $1`, [reference]);
  const w = rows[0];
  if (!w) return;
  if (status === "paid") {
    await db.q(
      `UPDATE withdrawals SET status = 'paid', processed_at = now() WHERE id = $1 AND status <> 'paid'`,
      [w.id]
    );
  } else if (w.status !== "paid") {
    await ledger
      .reverseWithdrawal(w.id, { status: "rejected", note: "Bank transfer failed" })
      .catch((e) => console.error("[transfer] reversal failed", e.message));
  }
}

// ---- scouts (admin) ----
app.get(
  "/api/admin/scouts",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(`
      SELECT s.id, s.name, s.email, s.phone, s.referral_code, s.commission_rate_bps,
             s.status, s.bank_name, s.account_number, s.account_name, s.created_at,
             (SELECT count(*) FROM deals d WHERE d.scout_id = s.id)::int AS deals,
             (SELECT count(*) FROM deals d WHERE d.scout_id = s.id AND d.status='won')::int AS won,
             COALESCE((SELECT SUM(le.amount_kobo) FROM ledger_entries le
                       WHERE le.scout_id = s.id AND le.type='commission' AND le.status='active'),0)::bigint AS earned_kobo,
             COALESCE((SELECT SUM(le.amount_kobo) FROM ledger_entries le
                       WHERE le.scout_id = s.id AND le.status='active'
                         AND (le.available_at IS NULL OR le.available_at <= now())),0)::bigint AS available_kobo
      FROM scouts s ORDER BY s.id DESC`);
    res.json({ ok: true, scouts: rows });
  })
);

app.post(
  "/api/admin/scouts/:id",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const fields = [];
    const params = [Number(req.params.id)];

    if (req.body?.commissionPercent !== undefined) {
      const bps = percentToBps(req.body.commissionPercent);
      if (bps === null)
        return res.status(400).json({ ok: false, error: "Commission must be between 0 and 100%." });
      params.push(bps);
      fields.push(`commission_rate_bps = $${params.length}`);
    }
    if (req.body?.status !== undefined) {
      const st = clean(req.body.status, 20);
      if (!["active", "pending", "suspended"].includes(st))
        return res.status(400).json({ ok: false, error: "Unknown status." });
      params.push(st);
      fields.push(`status = $${params.length}`);
    }
    if (!fields.length) return res.status(400).json({ ok: false, error: "Nothing to update." });

    const { rows } = await db.q(
      `UPDATE scouts SET ${fields.join(", ")} WHERE id = $1 RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ ok: false, error: "Not found." });
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "scout.updated",
      { type: "scout", id: rows[0].id },
      { commissionPercent: req.body?.commissionPercent, status: req.body?.status }
    );
    // Note: existing deals keep their snapshotted rate — see deals.commission_rate_bps.
    res.json({ ok: true, scout: publicScout(rows[0], baseUrlFrom(req)) });
  })
);

// A manual wallet correction. Requires a note, and every one is audited.
app.post(
  "/api/admin/scouts/:id/adjust",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const raw = String(req.body?.amount ?? "");
    const negative = raw.trim().startsWith("-");
    const magnitude = parseNairaToKobo(raw.replace("-", ""));
    const note = clean(req.body?.note, 300);
    if (!magnitude) return res.status(400).json({ ok: false, error: "Enter a valid amount." });
    if (!note) return res.status(400).json({ ok: false, error: "Give a reason for this adjustment." });

    const entry = await ledger.adjust(
      Number(req.params.id),
      negative ? -magnitude : magnitude,
      note
    );
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "wallet.adjusted",
      { type: "scout", id: Number(req.params.id) },
      { amount_kobo: entry.amount_kobo, note }
    );
    res.json({ ok: true, entry });
  })
);

// ---- settings & audit (admin) ----
app.get(
  "/api/admin/settings",
  auth.requireAdmin,
  wrap(async (req, res) => {
    res.json({ ok: true, settings: await db.getSettings(), paymentProvider: provider().name });
  })
);

app.post(
  "/api/admin/settings",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const numeric = {
      default_commission_bps: (v) => percentToBps(v),
      hold_days: (v) => (/^\d{1,3}$/.test(String(v)) ? Number(v) : null),
      min_withdrawal_kobo: (v) => parseNairaToKobo(v),
      deposit_bps: (v) => percentToBps(v),
      attribution_window_days: (v) => (/^\d{1,5}$/.test(String(v)) ? Number(v) : null),
    };
    const text = ["payin_bank_name", "payin_account_number", "payin_account_name"];

    for (const [key, parse] of Object.entries(numeric)) {
      if (req.body?.[key] === undefined || req.body[key] === "") continue;
      const parsed = parse(req.body[key]);
      if (parsed === null)
        return res.status(400).json({ ok: false, error: `"${key}" isn't a valid value.` });
      await db.setSetting(key, parsed);
    }
    for (const key of text) {
      if (req.body?.[key] === undefined) continue;
      await db.setSetting(key, clean(req.body[key], 120) || "");
    }
    await db.audit(
      { type: "admin", id: req.admin.id, label: req.admin.email },
      "settings.updated",
      { type: "settings" },
      req.body
    );
    res.json({ ok: true, settings: await db.getSettings() });
  })
);

app.get(
  "/api/admin/audit",
  auth.requireAdmin,
  wrap(async (req, res) => {
    const { rows } = await db.q(
      `SELECT * FROM audit_log ORDER BY id DESC LIMIT 200`
    );
    res.json({ ok: true, entries: rows });
  })
);

// Tell a Scout their deal moved. Fire-and-forget: an email outage must never
// break the request that triggered it.
async function notifyScoutOfStatus(deal, status, baseUrl) {
  if (!deal.scout_id || !["won", "lost", "cancelled"].includes(status)) return;
  const { rows } = await db.q(`SELECT name, email FROM scouts WHERE id = $1`, [deal.scout_id]);
  if (!rows[0]) return;
  mailer
    .sendScoutDealUpdate({
      to: rows[0].email,
      name: rows[0].name,
      url: `${baseUrl}/scout.html`,
      dealRef: deal.ref,
      status,
      amount: deal.agreed_amount_kobo ? formatKobo(deal.agreed_amount_kobo) : null,
    })
    .catch(() => {});
}

// Pretty invite URLs (/r/MC-ABC123). Vercel rewrites these too — see vercel.json.
app.get("/r/:code", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "invite.html"));
});

module.exports = app;
