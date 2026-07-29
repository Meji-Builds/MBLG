# Meji Connect

A referral and commission platform for **Meji Builds**. People we trust — called
**Scouts** — introduce clients to the studio and earn a share of every project
that closes. Meji Connect tracks the whole thing: the introduction, the
conversation, the price, the money, and the payout.

---

## How it works

```
Scout signs up            →  gets a personal invite link  (MC-XXXXXX)
        ↓
Scout shares the link     →  client opens it and fills a short brief
        ↓
Client lands in a portal  →  chats directly with Meji Builds, no password needed
        ↓
Studio sends a quote      →  client accepts it in one click
        ↓
Client pays               →  80% upfront, balance on delivery
        ↓
Scout's wallet accrues    →  10% (or 20%) of what the client ACTUALLY paid
        ↓
10-day hold clears        →  Scout withdraws to their bank account
```

Three audiences, one app, each with their own session:

| Who | Where | What they can do |
|---|---|---|
| **Scout** | `/scout.html` | Invite link, referral status, wallet, withdrawals |
| **Client** | `/client.html` | Their brief, chat with the studio, quote, payment |
| **Studio** | `/admin.html` | Pipeline, chat, quoting, payments, payouts, settings |

---

## The rules that make it safe

Money attracts gaming. These are deliberate design decisions, not incidental:

- **A Scout can never mark their own deal successful.** Anyone paid on success
  will mark everything successful. Deal status is set by the studio, or by the
  client accepting a quote — never by the Scout. Their dashboard is read-only on
  it, and there is no API route that would let them.
- **A Scout never sees the client conversation.** Pricing negotiation is between
  the studio and the client. Scouts see status and amounts only.
- **Commission accrues on money collected, not on deal value.** The client pays
  80%, the Scout earns their percentage of that 80%. If the client defaults on
  the rest, commission on the rest simply never accrues — the studio is never out
  of pocket for money it didn't receive.
- **A Scout can't refer themselves.** Matching email or phone against the Scout's
  own is rejected at intake.
- **First touch wins.** If a client is already in the system, the Scout who
  introduced them keeps them. A second Scout's code is recorded as `contested`
  for an admin to settle, never silently reassigned — and the client can still
  start their project either way.
- **Pre-existing clients earn nobody a commission.** If someone was already a
  direct Meji Builds contact, the deal is flagged ineligible with a reason.
- **Rates are snapshotted per deal.** Promoting a Scout from 10% to 20% changes
  their next deals, never the ones already in flight.
- **Every amount is held for 10 days after the client's payment clears**, in case
  of a refund or cancellation.
- **A refund claws the commission back.** The balance can go negative — that's a
  real debt, and withdrawals stay blocked until future commission clears it.
- **Withdrawals can't be double-spent.** Requesting a payout locks the Scout row
  and writes the debit inside one transaction, so two simultaneous requests
  cannot both pass the balance check.
- **Every admin action touching money is written to an audit log.**

## The ledger

The wallet is an append-only `ledger_entries` table. A balance is always a `SUM`
over it, never a stored column — stored balances drift, sums can't. Credits are
positive, debits negative:

| Type | Sign | When |
|---|---|---|
| `commission` | + | A client payment succeeds |
| `clawback` | − | That payment is later refunded |
| `withdrawal` | − | The moment a payout is **requested** |
| `withdrawal_reversal` | + | A payout is rejected or fails at the bank |
| `adjustment` | ± | Manual correction by an admin (reason required) |

Balances derive from `available_at`: **pending** is money still inside its hold,
**available** is everything past it. All amounts are integer **kobo** in `BIGINT`
columns, all rates are **basis points** (1000 = 10%). No floating point ever
touches money.

---

## Stack

- **Node + Express**, deployed as a single **Vercel** serverless function (`api/index.js`)
- **Postgres (Neon)** — schema is created lazily on first request, no migration step
- **Vanilla HTML/CSS/JS** frontend, no build step
- **Paystack** for checkout and payouts, behind a provider interface with a
  fully-working `manual` mode

Chat is short-polled (`?since=<id>`) rather than WebSockets — serverless
functions can't hold a socket open, and polling is the right tool at this scale.

---

## See it without installing anything

```bash
npm run prototype        # writes prototype.html — open it in any browser
```

One self-contained file with every screen and mock data: no server, no
database, no network. It inlines `public/styles.css` verbatim, so it always
matches the real app's look. Use it to review the interface, or to show someone
what the platform does before it's deployed.

## Local setup

```bash
npm install
cp .env.example .env      # add your DATABASE_URL, SESSION_SECRET, ADMIN_* vars
npm start
```

If anything is missing or wrong, `npm start` says exactly what and how to fix it
rather than starting up and failing every request.

Then open:

- **Landing / Scout signup** → http://localhost:3000/
- **Studio console** → http://localhost:3000/admin.html
- **Invite link** → http://localhost:3000/r/YOUR-CODE

### Demo data

```bash
npm run seed
```

Creates two Scouts (10% and 20%), six deals across every status, real payments,
a matured balance, one commission still visibly counting down its hold, and a
payout waiting for approval. Sign in as `admin@mejibuilds.com` / `demo12345`.

**Both scripts wipe every table first — never point them at production.**

### Verifying the money path

```bash
npm start              # in one terminal
npm run test:ledger    # in another
```

`scripts/check-flow.js` drives the real HTTP API exactly as a browser would and
asserts 52 checks across the whole lifecycle: signup, self-referral rejection,
intake, chat, Scout permission boundaries, quoting, pro-rata accrual, webhook
replay idempotency, the hold, the concurrent-withdrawal race, payout, refund
clawback, and first-touch attribution.

---

## Payments

Set `PAYMENT_PROVIDER` to choose:

**`manual`** (default) — the client sees your bank details and transfers; an
admin records the payment from the deal page. Commission, holds, balances and
payouts all behave identically. This is a complete, usable system — nothing is
blocked on merchant approval.

**`paystack`** — the client checks out by card/transfer/USSD and a signed webhook
confirms it. Payouts can be sent through Paystack Transfers. Set
`PAYSTACK_SECRET_KEY` and point your Paystack webhook at
`https://your-app.vercel.app/api/webhooks/paystack`.

The webhook route is mounted with `express.raw()` **before** `express.json()` so
Paystack's signature can be checked against the exact bytes it sent. Don't move it.

If `PAYMENT_PROVIDER=paystack` but no key is set, the app logs a warning and
falls back to manual rather than failing at checkout.

---

## Email

Optional. Set `RESEND_API_KEY` to send clients their portal link and notify
Scouts when a deal closes. **Without it nothing breaks** — links are always shown
on screen and logged to the server console. No part of the product depends on
email working.

---

## Changing the look

Every colour lives in the `:root` block at the top of `public/styles.css`.
Change those values to match the Meji Builds site; no other file hard-codes a
colour.

---

## Configuration

Boot-time wiring lives in `.env` (see `.env.example`). Anything you might want to
change after launch lives in the `settings` table and is editable from
**admin → Settings**, no redeploy needed:

| Setting | Default | Notes |
|---|---|---|
| Default commission | 10% | New Scouts only; existing deals keep their snapshot |
| Upfront deposit | 80% | What a client pays to start |
| Hold period | 10 days | Applies to newly accrued commission only |
| Minimum withdrawal | ₦5,000 | |
| Attribution window | 365 days | How long repeat business still earns the Scout |
| Pay-in bank details | — | Shown to clients paying by transfer |

Changing the hold period deliberately does **not** retroactively re-hold or
release commission that already accrued — Scouts keep the terms they earned under.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for the full Neon → Vercel → Paystack walkthrough.

## Not built yet

Flagged deliberately rather than half-done: withholding tax handling,
multi-currency, Scout tiers and leaderboards, and contract e-signing.
