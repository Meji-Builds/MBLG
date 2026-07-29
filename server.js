// Local development launcher. On Vercel, api/index.js is the entry instead.
//
// Before listening we check the things that silently break everything if they
// are wrong. A misconfigured DATABASE_URL used to let the page load and then
// fail every single request with an opaque 500 — this turns that into one
// clear message at startup.
const app = require("./app");
const config = require("./config");
const db = require("./db");

const RED = "\x1b[31m";
const YEL = "\x1b[33m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

async function preflight() {
  if (!process.env.DATABASE_URL) {
    console.error(`
${RED}✗  DATABASE_URL is not set.${OFF}

   Meji Connect stores everything in Postgres, so it can't start without one.

   1. Create a free database at ${DIM}https://neon.tech${OFF} (takes about a minute)
   2. Copy the ${DIM}pooled${OFF} connection string
   3. Put it in a file called ${DIM}.env${OFF} next to package.json:

      DATABASE_URL=postgresql://user:pass@host/db?sslmode=require

   ${DIM}cp .env.example .env${OFF} gives you a template with every option.
`);
    process.exit(1);
  }

  try {
    await db.ensureSchema();
  } catch (e) {
    console.error(`
${RED}✗  Couldn't connect to the database.${OFF}

   ${e.message}

   Common causes:
     · the connection string was pasted with a missing character
     · you copied the ${DIM}direct${OFF} string instead of the ${DIM}pooled${OFF} one
     · the database is paused (Neon sleeps free projects — open the dashboard to wake it)
     · no internet connection
`);
    process.exit(1);
  }

  const { rows } = await db.q(`SELECT count(*)::int AS n FROM admins`);
  if (rows[0].n === 0 && !config.seedAdmin.email) {
    console.warn(`
${YEL}!  No admin account, and ADMIN_EMAIL / ADMIN_PASSWORD aren't set.${OFF}
   You won't be able to sign in at /admin.html. Add them to .env and restart,
   or run ${DIM}npm run seed${OFF} to create demo accounts.
`);
  }
}

preflight().then(() => {
  app.listen(config.server.port, () => {
    const url = `http://localhost:${config.server.port}`;
    console.log(
      `\n  ${config.brand.platform} is running\n` +
        `\n  Scout signup    ${url}/` +
        `\n  Studio console  ${url}/admin.html` +
        `\n  Payments        ${config.payments.provider}\n`
    );
  });
});
