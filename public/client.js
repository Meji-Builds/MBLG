// Client portal: the conversation, the quote, and paying for it.

let deals = [];
let current = null;
let poll = null;

// The portal link carries a token the first time. Exchange it for a session
// cookie, then strip it from the URL so it doesn't linger in browser history.
async function boot() {
  const token = new URLSearchParams(location.search).get("t");
  if (token) {
    try {
      await POST("/api/client/auth", { token });
      history.replaceState({}, "", location.pathname);
    } catch {
      /* an existing cookie may still be valid — fall through */
    }
  }
  try {
    const r = await GET("/api/client/deals");
    deals = r.deals;
    $("#clientName").textContent = r.client.name;
    $("#loading").classList.add("hidden");
    $("#main").classList.remove("hidden");
    if (!deals.length) {
      $("#main").innerHTML = empty("inbox", "No projects yet", "Once you start a project it appears here.");
      return;
    }
    renderTabs();
    select(deals[0].id);
    await confirmReturnFromPaystack();
  } catch {
    $("#loading").classList.add("hidden");
    $("#denied").classList.remove("hidden");
  }
}

// Only show the project switcher when there's more than one.
function renderTabs() {
  const el = $("#dealTabs");
  if (deals.length < 2) return;
  el.classList.remove("hidden");
  el.innerHTML = deals.map((d) => `<button data-id="${d.id}">${esc(d.title)}</button>`).join("");
  $$("#dealTabs button").forEach((b) => (b.onclick = () => select(Number(b.dataset.id))));
}

function select(id) {
  current = deals.find((d) => d.id === id);
  $$("#dealTabs button").forEach((b) => b.classList.toggle("is-on", Number(b.dataset.id) === id));
  renderSummary();
  renderPayments();
  if (poll) poll.stop();
  poll = pollThread({
    container: $("#thread"),
    url: `/api/client/deals/${id}/messages`,
    mine: "client",
    // A quote, an acceptance, a payment being recorded — every one of these
    // reaches the client as a chat message the moment it happens server side.
    // Without this, the message shows up in the thread (that part already
    // polled live) but the price/status card above it stays exactly as it
    // was at page load, because nothing was re-checking the deal itself.
    onNew: () => refreshCurrentDeal(id),
  });
}

// Paystack redirects back here with ?paid=1&reference=... . Rather than
// blindly waiting a couple of seconds and hoping the webhook has landed by
// then, ask Paystack directly whether the transaction succeeded — that's
// authoritative immediately, and doesn't depend on the webhook URL being
// configured at all.
async function confirmReturnFromPaystack() {
  const params = new URLSearchParams(location.search);
  if (!params.get("paid")) return;
  const reference = params.get("reference") || params.get("trxref");
  history.replaceState({}, "", location.pathname);
  if (!reference) return;

  toast("Confirming your payment…");
  try {
    const r = await POST(`/api/client/payments/${encodeURIComponent(reference)}/verify`, {});
    if (r.status === "success") {
      if (current?.id !== r.dealId) select(r.dealId);
      else await refreshCurrentDeal(r.dealId);
      toast("Payment confirmed. Thank you!");
    } else {
      toast("Still confirming your payment — this updates on its own in a moment.");
    }
  } catch {
    toast("Couldn't confirm the payment yet. It'll update automatically shortly.", true);
  }
}

// Re-pulls this deal's own state (status, quoted/agreed amount, payments) and
// re-renders just the summary + payments cards — never touches the thread or
// resets the poll, so an in-progress conversation is never disturbed by its
// own trigger for refreshing.
async function refreshCurrentDeal(id) {
  try {
    const r = await GET("/api/client/deals");
    deals = r.deals;
    const fresh = deals.find((d) => d.id === id);
    if (!fresh || !current || current.id !== id) return; // switched tabs mid-flight
    current = fresh;
    renderSummary();
    renderPayments();
  } catch {
    /* the next chat poll will trigger another attempt */
  }
}

function renderSummary() {
  const d = current;

  // A live quote is the most important thing on the screen, so it gets its own
  // treatment rather than being another row in a table.
  if (d.status === "quoted" && d.quotedKobo) {
    const deposit = Math.floor((d.quotedKobo * d.depositBps) / 10000);
    $("#summary").innerHTML = `
      <div class="offer">
        <div class="row-between" style="margin-bottom:6px">
          <span class="eyebrow">Your quote</span>${pill(d.status)}
        </div>
        <div class="price">${money(d.quotedKobo)}</div>
        <div class="sub">${esc(d.title)} · <span class="ref">${esc(d.ref)}</span></div>
        <p class="terms">
          To get started we ask for <strong>${money(deposit)}</strong>
          (${d.depositBps / 100}%) upfront, with the balance due on delivery.
        </p>
        <button class="btn lg full" id="acceptQuote">Accept and start</button>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn ghost" id="requestChanges">Ask for changes</button>
          <button class="btn quiet" id="declineQuote">Decline</button>
        </div>
      </div>`;
    $("#acceptQuote").onclick = busy($("#acceptQuote"), acceptQuote);
    $("#requestChanges").onclick = openRequestChanges;
    $("#declineQuote").onclick = openDecline;
    return;
  }

  if (d.status === "lost" || d.status === "cancelled") {
    $("#summary").innerHTML = `
      <div class="card">
        <div class="card-head">
          <div>
            <h2>${esc(d.title)}</h2>
            <span class="ref">${esc(d.ref)}</span>
          </div>
          ${pill(d.status)}
        </div>
        <p class="hint">This project isn't moving forward. If that's changed, just send us a message below.</p>
      </div>`;
    return;
  }

  const rows = [];
  if (d.agreedKobo) rows.push(["Agreed price", `<span class="money">${money(d.agreedKobo)}</span>`]);
  if (d.paidKobo) rows.push(["Paid so far", `<span class="money pos">${money(d.paidKobo)}</span>`]);
  if (d.agreedKobo && d.outstandingKobo) rows.push(["Outstanding", `<span class="money">${money(d.outstandingKobo)}</span>`]);

  $("#summary").innerHTML = `
    <div class="card">
      <div class="card-head">
        <div>
          <h2>${esc(d.title)}</h2>
          <span class="ref">${esc(d.ref)}</span>
        </div>
        ${pill(d.status)}
      </div>
      ${rows.length ? `<div class="kv">${rows.map(([k, v]) => `<div><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}</div>` : ""}
      ${
        !rows.length
          ? `<p class="hint">We're reviewing your brief and will come back with a price shortly.</p>`
          : ""
      }
      ${payActions(d)}
    </div>`;

  const pay = $("#payNow");
  if (pay) pay.onclick = busy(pay, () => startPayment("deposit"));
  const payFull = $("#payFull");
  if (payFull) payFull.onclick = busy(payFull, () => startPayment("full"));
}

function openRequestChanges() {
  sheet({
    title: "Ask for changes",
    sub: "Tell us what you'd like different and we'll come back with an updated price.",
    html: `<div class="field">
             <label for="rcNote">What would you like changed?</label>
             <textarea id="rcNote" placeholder="e.g. Could we do this in two phases to spread the cost?"></textarea>
           </div>`,
    confirmLabel: "Send",
    onConfirm: async (root) => {
      const note = $("#rcNote", root).value.trim();
      if (!note) { toast("Let us know what you'd like changed.", true); return false; }
      const r = await POST(`/api/client/deals/${current.id}/request-changes`, { note });
      deals = deals.map((d) => (d.id === r.deal.id ? r.deal : d));
      current = r.deal;
      renderSummary();
      poll.refresh();
      toast("Sent — we'll follow up with an updated quote.");
    },
  });
}

function openDecline() {
  sheet({
    title: "Decline this quote",
    sub: "This closes the project. You can still message us later if anything changes.",
    html: `<div class="field">
             <label for="dcReason">Let us know why, if you'd like (optional)</label>
             <input id="dcReason" placeholder="e.g. Went with someone else" />
           </div>`,
    confirmLabel: "Decline",
    danger: true,
    onConfirm: async (root) => {
      const reason = $("#dcReason", root).value.trim();
      const r = await POST(`/api/client/deals/${current.id}/decline`, { reason });
      deals = deals.map((d) => (d.id === r.deal.id ? r.deal : d));
      current = r.deal;
      renderSummary();
      poll.refresh();
      toast("Quote declined.");
    },
  });
}

function payActions(d) {
  if (d.status === "won" && d.outstandingKobo > 0) {
    return `<div class="btn-row" style="margin-top:18px">
        ${d.depositDueKobo > 0 ? `<button class="btn" id="payNow">Pay ${money(d.depositDueKobo)} deposit</button>` : ""}
        <button class="btn ghost" id="payFull">Pay full ${money(d.outstandingKobo)}</button>
      </div>`;
  }
  if (d.status === "won" && d.outstandingKobo === 0 && d.paidKobo > 0) {
    return `<div class="notice good" style="margin-top:18px">
        <span class="ico">${icon("check")}</span><div>Paid in full.</div>
      </div>`;
  }
  return "";
}

async function acceptQuote() {
  const r = await POST(`/api/client/deals/${current.id}/accept`);
  deals = deals.map((d) => (d.id === r.deal.id ? r.deal : d));
  current = r.deal;
  renderSummary();
  poll.refresh();
  toast("Quote accepted.");
}

// Manual mode returns bank details to display; Paystack returns a checkout URL.
async function startPayment(kind) {
  const r = await POST(`/api/client/deals/${current.id}/pay`, { kind });
  if (r.mode === "redirect") return location.assign(r.url);

  sheet({
    title: `Pay ${money(r.amountKobo)}`,
    sub: esc(r.instructions),
    html: r.bank?.accountNumber
      ? `<div class="kv">
           <div><span class="k">Bank</span><span class="v strong">${esc(r.bank.bank)}</span></div>
           <div><span class="k">Account number</span><span class="v strong mono">${esc(r.bank.accountNumber)}</span></div>
           <div><span class="k">Account name</span><span class="v strong">${esc(r.bank.accountName)}</span></div>
           <div><span class="k">Narration</span><span class="v strong ref">${esc(current.ref)}</span></div>
         </div>
         <button class="btn ghost sm" id="copyAcct">Copy account number</button>
         <p class="hint">Using <strong>${esc(current.ref)}</strong> as the narration helps us match your payment straight away.</p>`
      : `<p class="hint">Send us a message and we'll share account details right away.</p>`,
    confirmLabel: "I've sent it",
    onConfirm: async () => {
      await POST(`/api/client/deals/${current.id}/messages`, {
        body: `I've sent ${money(r.amountKobo)} for ${current.ref}.`,
      });
      poll.refresh();
      toast("Noted. We'll confirm once the transfer lands.");
    },
  });

  const c = $("#copyAcct");
  if (c) c.onclick = (e) => { e.preventDefault(); copy(r.bank.accountNumber, "Account number copied"); };
}

function renderPayments() {
  const pays = (current.payments || []).filter((p) => p.status !== "pending");
  const panel = $("#paymentsPanel");
  if (!pays.length) return panel.classList.add("hidden");
  panel.classList.remove("hidden");
  $("#paymentsList").innerHTML = `
    <div class="dl" style="--cols:2fr 1fr 1fr">
      <div class="dl-head"><span>Date</span><span>Type</span><span style="text-align:right">Amount</span></div>
      ${pays
        .map(
          (p) => `<div class="dl-row">
            <div class="dl-cell primary">
              <div class="t">${when(p.paid_at || p.created_at)}</div>
              <div class="s">${pill(p.status)}</div>
            </div>
            <div class="dl-cell"><span class="dl-k">Type</span>
              <span style="text-transform:capitalize">${esc(p.kind)}</span></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span>
              <span class="money">${money(p.amount_kobo)}</span></div>
          </div>`
        )
        .join("")}
    </div>`;
}

// ---- composer ----
// getUrl re-reads `current` on every send, and onSent reads the module-level
// `poll` by closure — so this is wired once and stays correct even as the
// project switcher changes which deal (and which live poll) is active.
wireChat({
  box: $("#msgBox"),
  sendBtn: $("#send"),
  getUrl: () => current && `/api/client/deals/${current.id}/messages`,
  onSent: (m) => poll.push(m),
});

$("#logout").onclick = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.href = "/";
};

boot();
