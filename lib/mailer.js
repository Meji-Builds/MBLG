// Optional transactional email (Resend).
//
// With no API key configured this logs to the server console and reports back
// that it didn't send, so callers always fall back to showing the link on
// screen. Nothing in the product is allowed to depend on email working.
const config = require("./../config");

const enabled = () => !!config.mail.resendApiKey;

async function send({ to, subject, html, text }) {
  if (!enabled()) {
    console.log(`[mail] (not configured) would send "${subject}" to ${to}`);
    return { sent: false, reason: "not_configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [to],
        subject,
        html: html || undefined,
        text: text || undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[mail] send failed", res.status, body);
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[mail] send threw", e.message);
    return { sent: false, reason: e.message };
  }
}

const shell = (body) => `
  <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0c0d12;padding:32px;color:#e7e9f0">
    <div style="max-width:520px;margin:0 auto;background:#14161f;border:1px solid #262a3a;border-radius:14px;padding:28px">
      <div style="font-weight:700;font-size:17px;color:#fff;margin-bottom:18px">${config.brand.platform}</div>
      ${body}
      <div style="margin-top:26px;padding-top:16px;border-top:1px solid #262a3a;font-size:12px;color:#8a8fa3">
        ${config.brand.studio} · ${config.brand.supportEmail}
      </div>
    </div>
  </div>`;

const button = (url, label) =>
  `<a href="${url}" style="display:inline-block;background:#7c6bff;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:600;font-size:14px">${label}</a>`;

// Sent to a client the moment they finish the intake form. This link IS their
// account — there is no password to forget.
async function sendClientPortalLink({ to, name, url, dealRef }) {
  return send({
    to,
    subject: `Your project with ${config.brand.studio} (${dealRef})`,
    text: `Hi ${name},\n\nYour project space is open: ${url}\n\nKeep this link — it's how you get back in.\n\n${config.brand.studio}`,
    html: shell(`
      <p style="margin:0 0 14px;font-size:15px">Hi ${name},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">
        Your project space is open. Tell us what you need and we'll take it from there.
      </p>
      <p style="margin:0 0 20px">${button(url, "Open my project")}</p>
      <p style="margin:0;font-size:13px;color:#8a8fa3">
        Keep this link — it's how you get back in. Reference <strong style="color:#e7e9f0">${dealRef}</strong>.
      </p>`),
  });
}

async function sendNewMessageAlert({ to, name, url, from }) {
  return send({
    to,
    subject: `New message from ${from}`,
    text: `Hi ${name},\n\n${from} sent you a message: ${url}`,
    html: shell(`
      <p style="margin:0 0 14px;font-size:15px">Hi ${name},</p>
      <p style="margin:0 0 18px;font-size:15px">${from} just sent you a message.</p>
      <p style="margin:0">${button(url, "Read it")}</p>`),
  });
}

async function sendScoutDealUpdate({ to, name, url, dealRef, status, amount }) {
  const line =
    status === "won"
      ? `Deal <strong style="color:#e7e9f0">${dealRef}</strong> closed${amount ? ` at ${amount}` : ""}. Your commission appears in your wallet as the client pays.`
      : `Deal <strong style="color:#e7e9f0">${dealRef}</strong> didn't go ahead this time.`;
  return send({
    to,
    subject:
      status === "won" ? `Deal closed — ${dealRef}` : `Deal update — ${dealRef}`,
    text: `Hi ${name},\n\n${line.replace(/<[^>]+>/g, "")}\n\n${url}`,
    html: shell(`
      <p style="margin:0 0 14px;font-size:15px">Hi ${name},</p>
      <p style="margin:0 0 18px;font-size:15px;line-height:1.55">${line}</p>
      <p style="margin:0">${button(url, "Open dashboard")}</p>`),
  });
}

module.exports = {
  enabled,
  send,
  sendClientPortalLink,
  sendNewMessageAlert,
  sendScoutDealUpdate,
};
