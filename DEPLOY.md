# Deploying Meji Connect (Neon → Vercel → Paystack)

Three steps to a live URL: create the database, deploy the app, then switch on
payments when you're ready. You can run the whole platform after step 2, since
the payment gateway is optional.

---

## What you need to gather first

Work through this before starting. Nothing here costs money except the Paystack
account, which is free to open.

**Required to go live at all**

| What | Where to get it | Notes |
|---|---|---|
| Neon database URL | <https://neon.tech>, free tier | Use the **pooled** string |
| Vercel account | <https://vercel.com>, sign in with GitHub | Free Hobby plan is enough |
| A session secret | Generate it, see step 2 | Any long random string |
| Admin email + password | Your choice | This is how you sign into the studio console |

**Required before anyone can pay you**

| What | Where to get it | Notes |
|---|---|---|
| Meji Builds bank details | Your bank | Bank name, account number, account name. Shown to clients paying by transfer |
| Paystack account | <https://dashboard.paystack.com> | Only if you want card checkout. Needs CAC docs for a business account |
| Paystack secret key | Paystack → Settings → API Keys | Start with the **test** key |

**Optional, but worth doing early**

| What | Where to get it | Notes |
|---|---|---|
| A custom domain | Your registrar | e.g. `connect.mejibuilds.com` |
| Resend API key | <https://resend.com> | Sends clients their portal link. Needs a verified domain |
| Your brand colours | The Meji Builds site | Hex values and font. One-file swap in `public/styles.css` |

**Decisions only you can make**

- Commission rate for your first Scouts (the default is 10%)
- Whether any Scout gets 20%, and what earns it
- Upfront deposit percentage (default 80%)
- How long commission is held before withdrawal (default 10 days)
- Minimum withdrawal amount (default ₦5,000)

All five are editable from **admin → Settings** after launch, without a redeploy.

### A safe order to test in

1. Deploy with `PAYMENT_PROVIDER=manual` and no Paystack account at all.
2. Sign up as a Scout yourself. Send your own invite link to a second email you
   control and run a fake project end to end: brief, chat, quote, accept.
3. Record a small payment by hand from the studio console and watch the
   commission appear in the Scout wallet, on hold.
4. Temporarily set the hold period to 0 days in Settings, request a withdrawal,
   approve it, mark it paid. Then set the hold back to 10.
5. Only once that all behaves, invite a real Scout.
6. Add Paystack **test** keys and repeat the payment step with test card
   `4084 0840 8408 4081`. Switch to live keys last.

Steps 1 to 4 involve no real money and no real people.

---

## 1. Create the database (Neon)

1. Go to <https://neon.tech> and sign up (the free tier is plenty to start).
2. **Create project** → name it `meji-connect` → pick the region closest to your
   clients (`AWS eu-west` / Frankfurt works well for Nigeria).
3. Open **Connection Details**, toggle **Pooled connection** ON, and copy the
   string. It looks like:
   ```
   postgresql://neondb_owner:xxxx@ep-name-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require
   ```
   Treat it like a password.

> Tables are created automatically on the first request — there is no SQL to run
> and no migration step.

> **Paste Neon's string exactly as given.** Neon's copy button includes
> `?sslmode=require&channel_binding=require`. The app strips `channel_binding`
> itself (the Postgres driver mishandles it and would fail the handshake) and
> enforces TLS on its own, so you don't need to edit the string by hand.

---

## 2. Deploy on Vercel

1. Push this repo to GitHub if it isn't already.
2. At <https://vercel.com> → **Add New → Project** → import the repo.
3. Before deploying, add these **Environment Variables**:

   | Name | Value |
   |------|-------|
   | `DATABASE_URL` | the Neon pooled string from step 1 |
   | `SESSION_SECRET` | a long random string — see below |
   | `ADMIN_EMAIL` | the email you'll sign into the studio console with |
   | `ADMIN_PASSWORD` | a strong password — **change it after first login** |
   | `ADMIN_NAME` | `Meji Builds` |
   | `PAYMENT_PROVIDER` | `manual` for now |

   Generate the session secret locally with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   `SESSION_SECRET` is required in production and the app refuses to boot without
   it — with a guessable secret, anyone could mint their own admin cookie.

4. **Deploy**, then copy the URL Vercel gives you
   (`https://meji-connect-xyz.vercel.app`).
5. Go back to **Settings → Environment Variables**, add
   `PUBLIC_BASE_URL` set to that exact URL **including `https://`**, and
   **Redeploy**. Invite links and client portal links are built from it, so
   this must match the domain people actually open.

   > Vercel's own dashboard displays your domain as bare text
   > (`meji-connect.vercel.app`), which is exactly what gets copied by
   > habit — but a value pasted without `https://` breaks invite links shared
   > through a native "Share" button (WhatsApp, etc.), even though copy-paste
   > still works. The app auto-corrects a missing scheme and logs a warning
   > if it has to, but setting it right avoids the warning and is one less
   > thing to think about.

### First login

Open `https://your-app.vercel.app/admin.html` and sign in with `ADMIN_EMAIL` /
`ADMIN_PASSWORD`. The first admin is created automatically on the first request
and only when no admin exists yet.

Then go to **Settings → Where clients send money** and add the studio's bank
account. That's what clients see when they pay by transfer.

---

## 3. You're live

At this point everything works:

- Scouts sign up at `/` and get their invite link
- Clients start projects, chat, and receive quotes
- You record payments from the deal page as they land in your bank
- Commission accrues, holds for 10 days, and Scouts request withdrawals
- You pay Scouts by bank transfer and mark the payout paid

Share the root URL with the people you want as Scouts.

---

## 4. Turn on card payments (Paystack) — optional

Do this whenever your Paystack account is ready. Nothing else changes.

1. At <https://dashboard.paystack.com> → **Settings → API Keys & Webhooks**.
2. Copy your **Secret Key** (`sk_live_...`).
3. In Vercel, set:

   | Name | Value |
   |------|-------|
   | `PAYMENT_PROVIDER` | `paystack` |
   | `PAYSTACK_SECRET_KEY` | `sk_live_...` |

4. Still in Paystack, set the **Webhook URL** to:
   ```
   https://your-app.vercel.app/api/webhooks/paystack
   ```
5. **Redeploy.**

Clients now get a checkout page instead of bank details, and a signed webhook
confirms payment automatically. Commission accrues the same way it always did.

> If `PAYMENT_PROVIDER=paystack` but the secret key is missing, the app logs a
> warning and stays in manual mode rather than failing at checkout.

### Testing it safely

Use your Paystack **test** keys first and pay with test card `4084 0840 8408 4081`
(any future expiry, any CVV). Confirm the payment shows as `Paid` on the deal and
that commission appears in the Scout's wallet before switching to live keys.

### Paying Scouts through Paystack

With Paystack configured, the payouts screen can send transfers directly. It
needs the Scout's **bank code** (not just the bank name) on their account — the
"Send" action tells you if it's missing. Otherwise pay by bank transfer and click
**Mark paid**, which works identically from the ledger's point of view.

---

## 5. Email (optional)

Without a mail provider the app still works — portal links are shown on screen
and logged. To send them by email:

1. Sign up at <https://resend.com>, verify your sending domain.
2. In Vercel set `RESEND_API_KEY` and `MAIL_FROM`
   (e.g. `Meji Connect <hello@mejibuilds.com>`), then redeploy.

---

## Custom domain

Vercel → **Settings → Domains** → add e.g. `connect.mejibuilds.com`. Then update
`PUBLIC_BASE_URL` to match and redeploy, so invite links use the new domain.

---

## Operating notes

- **Back up the database.** Neon has point-in-time restore on paid plans. This is
  a financial ledger — turn it on before real money flows through it.
- **Change the seeded admin password** after first login, and delete
  `ADMIN_PASSWORD` from Vercel once you have.
- **Cold starts.** The first request after idle may take an extra second.
- **The ledger is append-only.** Never edit `ledger_entries` by hand. To correct
  a balance use **admin → Scouts → Adjust**, which requires a reason and writes
  an audit entry.
- **Refunds.** Refunding a payment from the deal page automatically claws back
  the commission it produced. Don't refund outside the platform, or the ledger
  and your bank will disagree.
- **Never run `npm run seed` or `npm run test:ledger` against production** —
  both truncate every table.
