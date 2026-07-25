// Client portal: the conversation, the quote, and paying for it.

let deals = [];
let current = null;
let poll = null;

// The portal link carries a token the first time. Exchange it for a session
// cookie, then strip it from the URL so it doesn't linger in history or get
// pasted into a screenshot.
async function boot() {
  const token = new URLSearchParams(location.search).get("t");
  if (token) {
    try {
      await POST("/api/client/auth", { token });
      history.replaceState({}, "", location.pathname);
    } catch {
      /* fall through — an existing cookie may still be valid */
    }
  }
  try {
    const r = await GET("/api/client/deals");
    deals = r.deals;
    $("#clientName").textContent = r.client.name;
    $("#loading").style.display = "none";
    $("#main").style.display = "";
    if (!deals.length) {
      $("#main").innerHTML = `<div class="empty">No projects yet.</div>`;
      return;
    }
    renderTabs();
    select(deals[0].id);
  } catch {
    $("#loading").style.display = "none";
    $("#denied").style.display = "";
  }
}

// Only show the project switcher when there's more than one.
function renderTabs() {
  const el = $("#dealTabs");
  if (deals.length < 2) return (el.style.display = "none");
  el.innerHTML = deals
    .map((d) => `<button data-id="${d.id}">${esc(d.title)}</button>`)
    .join("");
  $$("#dealTabs button").forEach((b) => (b.onclick = () => select(Number(b.dataset.id))));
}

function select(id) {
  current = deals.find((d) => d.id === id);
  $$("#dealTabs button").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.id) === id)
  );
  renderSummary();
  renderPayments();
  if (poll) poll.stop();
  poll = pollThread({
    container: $("#thread"),
    url: `/api/client/deals/${id}/messages`,
    mine: "client",
  });
}

function renderSummary() {
  const d = current;
  const rows = [];
  if (d.quotedKobo)
    rows.push(["Quoted", `<span class="money">${money(d.quotedKobo)}</span>`]);
  if (d.agreedKobo)
    rows.push(["Agreed", `<span class="money">${money(d.agreedKobo)}</span>`]);
  if (d.paidKobo)
    rows.push(["Paid so far", `<span class="money pos">${money(d.paidKobo)}</span>`]);
  if (d.agreedKobo && d.outstandingKobo)
    rows.push(["Outstanding", `<span class="money">${money(d.outstandingKobo)}</span>`]);

  $("#summary").innerHTML = `
    <div class="panel-head">
      <div>
        <h2 style="margin-bottom:4px">${esc(d.title)}</h2>
        <div class="meta" style="color:var(--muted);font-size:12.5px">
          Reference ${esc(d.ref)}
        </div>
      </div>
      ${badge(d.status)}
    </div>
    ${
      rows.length
        ? `<div class="table-scroll"><table>${rows
            .map(
              ([k, v]) =>
                `<tr><td style="color:var(--muted)">${k}</td><td class="num">${v}</td></tr>`
            )
            .join("")}</table></div>`
        : `<p class="hint" style="margin:0">
             We're reviewing your brief and will come back with a price shortly.
           </p>`
    }
    ${actionsFor(d)}`;

  const accept = $("#acceptQuote");
  if (accept) accept.onclick = busy(accept, acceptQuote);
  const pay = $("#payNow");
  if (pay) pay.onclick = busy(pay, () => startPayment("deposit"));
  const payFull = $("#payFull");
  if (payFull) payFull.onclick = busy(payFull, () => startPayment("full"));
}

function actionsFor(d) {
  if (d.status === "quoted" && d.quotedKobo) {
    const deposit = Math.floor((d.quotedKobo * d.depositBps) / 10000);
    return `
      <hr class="divider" />
      <div class="notice">
        To get started we ask for ${money(deposit)} upfront
        (${d.depositBps / 100}%), with the rest on delivery.
      </div>
      <button class="full" id="acceptQuote">Accept ${money(d.quotedKobo)} and start</button>`;
  }
  if (d.status === "won" && d.outstandingKobo > 0) {
    const deposit = d.depositDueKobo;
    return `
      <hr class="divider" />
      <div class="row" style="gap:10px">
        ${
          deposit > 0
            ? `<button id="payNow">Pay ${money(deposit)} deposit</button>`
            : ""
        }
        <button class="ghost" id="payFull">Pay full ${money(d.outstandingKobo)}</button>
      </div>`;
  }
  if (d.status === "won" && d.outstandingKobo === 0 && d.paidKobo > 0) {
    return `<hr class="divider" /><div class="notice good">Fully paid — thank you!</div>`;
  }
  return "";
}

async function acceptQuote() {
  const r = await POST(`/api/client/deals/${current.id}/accept`);
  deals = deals.map((d) => (d.id === r.deal.id ? r.deal : d));
  current = r.deal;
  renderSummary();
  poll.refresh();
  toast("Quote accepted — let's go!");
}

// Manual mode returns bank details to show; Paystack returns a checkout URL.
async function startPayment(kind) {
  const r = await POST(`/api/client/deals/${current.id}/pay`, { kind });
  if (r.mode === "redirect") return location.assign(r.url);

  modal({
    title: `Pay ${money(r.amountKobo)}`,
    sub: esc(r.instructions),
    html: r.bank?.accountNumber
      ? `<div class="panel tight" style="margin:0">
           <div class="field" style="margin:0 0 10px">
             <label>Bank</label><div class="strong">${esc(r.bank.bank)}</div>
           </div>
           <div class="field" style="margin:0 0 10px">
             <label>Account number</label>
             <div class="codechip" style="font-size:17px">${esc(r.bank.accountNumber)}</div>
           </div>
           <div class="field" style="margin:0">
             <label>Account name</label><div class="strong">${esc(r.bank.accountName)}</div>
           </div>
         </div>
         <div class="hint">Use <strong>${esc(current.ref)}</strong> as the narration so we can match it fast.</div>`
      : `<div class="hint">Send us a message and we'll share account details right away.</div>`,
    confirmLabel: "I've sent it",
    onConfirm: async () => {
      await POST(`/api/client/deals/${current.id}/messages`, {
        body: `I've sent ${money(r.amountKobo)} for ${current.ref}.`,
      });
      poll.refresh();
      toast("Thanks — we'll confirm once it lands.");
    },
  });
}

function renderPayments() {
  const pays = (current.payments || []).filter((p) => p.status !== "pending");
  if (!pays.length) return ($("#paymentsPanel").style.display = "none");
  $("#paymentsPanel").style.display = "";
  $("#paymentsTable").innerHTML = `
    <thead><tr><th>Date</th><th>Type</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>${pays
      .map(
        (p) => `<tr>
          <td>${when(p.paid_at || p.created_at)}</td>
          <td style="text-transform:capitalize">${esc(p.kind)}</td>
          <td class="num money">${money(p.amount_kobo)}</td>
          <td>${badge(p.status)}</td>
        </tr>`
      )
      .join("")}</tbody>`;
}

// ---- composer ----
$("#send").onclick = send;
$("#msgBox").addEventListener("keydown", (e) => {
  // Enter sends, Shift+Enter makes a new line.
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
async function send() {
  const box = $("#msgBox");
  const body = box.value.trim();
  if (!body || !current) return;
  box.value = "";
  try {
    const r = await POST(`/api/client/deals/${current.id}/messages`, { body });
    poll.push(r.message);
  } catch (e) {
    box.value = body; // don't lose what they typed
    toast(e.message, true);
  }
}

$("#logout").onclick = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.href = "/";
};

// Coming back from a Paystack redirect: the webhook may still be in flight, so
// give it a moment before reloading the payment state.
if (new URLSearchParams(location.search).get("paid")) {
  toast("Payment received — confirming now…");
  setTimeout(() => location.replace("/client.html"), 2500);
}

boot();
