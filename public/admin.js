// Studio console — where Meji Builds runs the pipeline: replies to clients,
// sends quotes, closes deals, records money and approves payouts.

let poll = null;
let statusFilter = "all";

// ---- session ----
GET("/api/me")
  .then((me) => (me.admin ? start() : $("#loginWrap").classList.remove("hidden")))
  .catch(() => $("#loginWrap").classList.remove("hidden"));

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#loginForm button[type=submit]");
  await busy(btn, async () => {
    await POST("/api/auth/login", {
      email: $("#alEmail").value,
      password: $("#alPassword").value,
      role: "admin",
    });
    start();
  })();
};

function start() {
  $("#loginWrap").classList.add("hidden");
  $("#console").classList.remove("hidden");
  hydrateIcons($("#console"));
  navigate("pipeline", onView);
  refreshOverview();
}

const signOut = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.reload();
};
$("#logoutRail").onclick = signOut;
$("#logoutBar").onclick = signOut;

// ---- navigation ----
const CRUMBS = { pipeline: "Pipeline", deal: "Deal", payouts: "Payouts", scouts: "Scouts", settings: "Settings" };
function onView(view) {
  $("#mobileCrumb").textContent = CRUMBS[view] || "";
  // The overview tiles are pipeline-level context; hide them inside a deal.
  $("#overview").classList.toggle("hidden", view === "deal");
  if (poll && view !== "deal") { poll.stop(); poll = null; }
  if (view !== "deal") openDealId = null;
  pipelinePoll(view === "pipeline");
  if (view === "pipeline") loadDeals();
  if (view === "payouts") loadPayouts();
  if (view === "scouts") loadScouts();
  if (view === "settings") loadSettings();
}

// The pipeline list used to only ever load once per visit — a payment landing,
// a client accepting a quote, none of it showed up until the admin re-clicked
// into the tab. Polls it quietly in the background instead: no skeleton, no
// scroll jump, just a fresh table every few seconds while it's the open view.
let pipelineTimer = null;
function pipelinePoll(on) {
  clearInterval(pipelineTimer);
  pipelineTimer = null;
  if (!on) return;
  pipelineTimer = setInterval(() => {
    if (!document.hidden) { loadDeals(true); refreshOverview(); }
  }, 8000);
}
wireNav(onView);
$("#backBtn").onclick = () => navigate("pipeline", onView);

async function refreshOverview() {
  const o = await GET("/api/admin/overview");
  const owed = o.money.commissionEarnedKobo - o.money.commissionPaidKobo;
  $("#overview").innerHTML = `
    <div class="tile"><div class="k">Open deals</div><div class="v">${o.deals.open}</div>
      <div class="n">${o.deals.won} won · ${o.deals.lost} lost</div></div>
    <div class="tile"><div class="k">Collected</div><div class="v jade">${money(o.money.collectedKobo)}</div>
      <div class="n">${o.money.awaitingKobo ? money(o.money.awaitingKobo) + " awaiting" : "nothing pending"}</div></div>
    <div class="tile"><div class="k">Commission owed</div><div class="v gold">${money(owed)}</div>
      <div class="n">${money(o.money.commissionPaidKobo)} already paid</div></div>
    <div class="tile"><div class="k">Payout requests</div><div class="v ${o.pendingWithdrawals ? "blue" : ""}">${o.pendingWithdrawals}</div>
      <div class="n">${o.activeScouts} active Scouts</div></div>`;
}

// ---- pipeline ----
$$("#statusFilter button").forEach((b) => {
  b.onclick = () => {
    statusFilter = b.dataset.status;
    $$("#statusFilter button").forEach((x) => x.classList.toggle("is-on", x === b));
    loadDeals();
  };
});

async function loadDeals(background = false) {
  const el = $("#dealsList");
  if (!background) el.innerHTML = skeleton(4);
  const r = await GET(`/api/admin/deals?status=${encodeURIComponent(statusFilter)}`);
  if (!r.deals.length) {
    el.innerHTML = empty("inbox", "Nothing here", "No deals match this filter yet.");
    return;
  }
  el.innerHTML = `
    <div class="dl" style="--cols:2fr 2.2fr 1.4fr 1.1fr 1fr">
      <div class="dl-head">
        <span>Client</span><span>Project</span><span>Scout</span><span>Status</span>
        <span style="text-align:right">Value</span>
      </div>
      ${r.deals
        .map(
          (d) => `<div class="dl-row tap" data-id="${d.id}">
            <div class="dl-cell primary">
              <div class="t">${esc(d.client_name)}
                ${d.unread ? `<span class="pill in_discussion" style="margin-left:6px">${d.unread} new</span>` : ""}
              </div>
              <div class="s">${esc(d.client_company || d.client_email)}</div>
            </div>
            <div class="dl-cell"><span class="dl-k">Project</span>
              <div><div>${esc(d.title)}</div>
              <div class="s ref">${esc(d.ref)} · ${when(d.created_at)}</div></div></div>
            <div class="dl-cell"><span class="dl-k">Scout</span>
              <div>${d.scout_name ? esc(d.scout_name) : `<span class="s">Direct</span>`}
              ${d.attribution === "contested" ? `<div style="margin-top:4px">${pill("contested")}</div>` : ""}
              ${!d.commission_eligible ? `<div class="s" style="color:var(--gold)">No commission</div>` : ""}</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span>${pill(d.status)}</div>
            <div class="dl-cell right"><span class="dl-k">Value</span>
              <div><span class="money">${d.agreed_amount_kobo || d.quoted_amount_kobo ? money(d.agreed_amount_kobo || d.quoted_amount_kobo) : "—"}</span>
              ${Number(d.paid_kobo) ? `<div class="s money pos">${money(Number(d.paid_kobo))} paid</div>` : ""}</div></div>
          </div>`
        )
        .join("")}
    </div>`;
  $$("#dealsList .dl-row").forEach((row) => (row.onclick = () => openDeal(Number(row.dataset.id))));
}

// ---- one deal ----
// The id of whatever deal is currently open, so a background refresh whose
// request was already in flight when the admin navigated away (or into a
// different deal) has a cheap way to recognise that and discard its own
// result instead of overwriting a now-unrelated view.
let openDealId = null;

// Everything about a deal that a client's OWN message can change — status,
// money, notices, the action buttons — as one HTML string. Used both for the
// first render and for the live background refresh, so the two can never
// drift out of sync with each other.
function dealTopHtml(d, r) {
  const closed = ["won", "lost", "cancelled"].includes(d.status);
  return `
    <div class="page-head">
      <div>
        <h1>${esc(d.client_name)}</h1>
        <p class="lead">${esc(d.title)} · <span class="ref">${esc(d.ref)}</span></p>
      </div>
      ${pill(d.status)}
    </div>

    ${
      d.attribution === "contested"
        ? `<div class="notice warn" style="margin-bottom:16px"><span class="ico">${icon("alert")}</span>
           <div><strong>Attribution is contested.</strong> More than one Scout claimed this
           client, or they already existed. Confirm who should be credited, if anyone.</div></div>`
        : ""
    }
    ${
      !d.commission_eligible
        ? `<div class="notice warn" style="margin-bottom:16px"><span class="ico">${icon("alert")}</span>
           <div><strong>No commission on this deal.</strong>${d.ineligible_reason ? ` ${esc(d.ineligible_reason)}` : ""}</div></div>`
        : ""
    }

    <div class="stack">
      <div class="card">
        <div class="card-head"><h2>Money</h2></div>
        <div class="tiles" style="grid-template-columns:1fr 1fr">
          <div class="tile"><div class="k">Agreed</div>
            <div class="v">${d.agreed_amount_kobo ? money(d.agreed_amount_kobo) : d.quoted_amount_kobo ? money(d.quoted_amount_kobo) : "—"}</div>
            <div class="n">${d.agreed_amount_kobo ? "agreed price" : "quoted, not accepted"}</div></div>
          <div class="tile"><div class="k">Collected</div><div class="v jade">${money(r.money.paidKobo)}</div>
            <div class="n">${money(r.money.outstandingKobo)} outstanding</div></div>
        </div>
        <div class="kv" style="margin-top:14px">
          <div><span class="k">Referred by</span><span class="v">${
            d.scout_name ? `${esc(d.scout_name)} <span class="ref">${esc(d.referral_code)}</span>` : "Direct (no Scout)"
          }</span></div>
          <div><span class="k">Commission at ${d.commission_rate_bps / 100}%</span>
            <span class="v money">${r.projectedCommissionKobo ? money(r.projectedCommissionKobo) : "—"}</span></div>
          <div><span class="k">Contact</span><span class="v">${esc(d.client_email)}${d.client_phone ? `<br /><span class="mono">${esc(d.client_phone)}</span>` : ""}</span></div>
          <div><span class="k">Budget hint</span><span class="v">${esc(d.budget_range || "—")}</span></div>
          <div><span class="k">Timeline</span><span class="v">${esc(d.timeline || "—")}</span></div>
        </div>
        <div class="btn-row" style="margin-top:18px">
          ${!closed ? `<button class="btn" id="btnQuote">${d.quoted_amount_kobo ? "Requote" : "Send quote"}</button>` : ""}
          ${d.status !== "won" ? `<button class="btn ghost" id="btnWon">Mark won</button>` : ""}
          ${d.status === "won" ? `<button class="btn" id="btnPayment">Record payment</button>` : ""}
          ${!["lost", "cancelled"].includes(d.status) ? `<button class="btn danger" id="btnLost">Mark lost</button>` : ""}
          ${d.scout_id ? `<button class="btn quiet" id="btnEligible">${d.commission_eligible ? "Remove commission" : "Restore commission"}</button>` : ""}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Brief</h2></div>
        <p style="margin:0;white-space:pre-wrap">${esc(d.description || "—")}</p>
      </div>

      ${
        r.payments.length
          ? `<div class="card" style="padding:6px 5px">
               <div class="card-head" style="padding:14px 12px 0"><h2>Payments</h2></div>
               <div class="dl" style="--cols:1.7fr 1fr 1fr 1.2fr">
                 <div class="dl-head"><span>Date</span><span>Type</span><span style="text-align:right">Amount</span><span></span></div>
                 ${r.payments
                   .map(
                     (p) => `<div class="dl-row">
                       <div class="dl-cell primary"><div class="t">${when(p.paid_at || p.created_at)}</div>
                         <div class="s">${pill(p.status)} <span class="ref">${esc(p.provider_ref)}</span></div></div>
                       <div class="dl-cell"><span class="dl-k">Type</span>
                         <span style="text-transform:capitalize">${esc(p.kind)}</span></div>
                       <div class="dl-cell right"><span class="dl-k">Amount</span>
                         <span class="money">${money(p.amount_kobo)}</span></div>
                       <div class="dl-cell actions">
                         ${p.status === "pending" ? `<button class="btn sm" data-confirm-pay="${p.id}">Confirm</button>` : ""}
                         ${p.status === "success" ? `<button class="btn sm danger" data-refund="${p.id}">Refund</button>` : ""}
                       </div>
                     </div>`
                   )
                   .join("")}
               </div>
             </div>`
          : ""
      }
    </div>`;
}

async function openDeal(id) {
  navigate("deal", onView);
  openDealId = id;
  $("#dealDetail").innerHTML = skeleton(3);
  const r = await GET(`/api/admin/deals/${id}`);
  const d = r.deal;

  $("#dealDetail").innerHTML = `
    <div class="grid-2 wide-first">
      <div id="dealTop">${dealTopHtml(d, r)}</div>
      <div class="card">
        <div class="card-head"><h2>Conversation</h2></div>
        <div class="thread" id="thread"></div>
        <div class="composer">
          <textarea id="msgBox" rows="1" placeholder="Reply to ${esc(d.client_name)}…" aria-label="Reply"></textarea>
          <button class="btn icon" id="send" aria-label="Send message">${icon("send")}</button>
        </div>
      </div>
    </div>`;

  wireDealButtons(d);
  wireChat({
    box: $("#msgBox"),
    sendBtn: $("#send"),
    getUrl: () => `/api/admin/deals/${d.id}/messages`,
    onSent: (m) => poll.push(m),
  });
  poll = pollThread({
    container: $("#thread"),
    url: `/api/admin/deals/${d.id}/messages`,
    mine: "admin",
    // A quote accepted, a status change, anything the CLIENT does reaches the
    // admin as a chat message the instant it happens. Without this, that
    // message shows up in the thread but the status pill and Money card next
    // to it stay exactly as they were when the deal was opened — which is
    // exactly how a "quote sent" system message could be visible while the
    // quote/offer UI it refers to was nowhere to be seen.
    onNew: () => refreshDealTop(id),
  });
}

// Re-pulls this deal and re-renders only #dealTop — status, money, notices,
// buttons. Never touches #thread or the composer, so a background update
// can't interrupt whatever the admin is in the middle of typing or reading.
async function refreshDealTop(id) {
  if (openDealId !== id) return; // navigated away before this resolved
  const r = await GET(`/api/admin/deals/${id}`);
  if (openDealId !== id) return; // navigated away while this was in flight
  $("#dealTop").innerHTML = dealTopHtml(r.deal, r);
  wireDealButtons(r.deal);
  refreshOverview();
}

function wireDealButtons(d) {
  const on = (sel, fn) => {
    const el = $(sel);
    if (el) el.onclick = busy(el, fn);
  };
  const reload = () => { openDeal(d.id); refreshOverview(); };

  on("#btnQuote", () =>
    sheet({
      title: "Send a quote",
      sub: `${esc(d.client_name)} sees this in the conversation and can accept it in one tap.`,
      html: `<div class="field">
               <label for="qAmount">Total project price</label>
               <div class="naira"><input id="qAmount" inputmode="decimal" placeholder="1000000"
                 value="${d.quoted_amount_kobo ? naira(d.quoted_amount_kobo) : ""}" /></div>
               <span class="help">They'll be asked for ${d.deposit_bps / 100}% of this upfront.</span>
             </div>`,
      confirmLabel: "Send quote",
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/quote`, { amount: $("#qAmount", root).value });
        toast("Quote sent.");
        reload();
      },
    })
  );

  on("#btnWon", () =>
    sheet({
      title: "Mark this deal won",
      sub: "Set the amount the client actually agreed to pay.",
      html: `<div class="field">
               <label for="wAmount">Agreed amount</label>
               <div class="naira"><input id="wAmount" inputmode="decimal"
                 value="${naira(d.agreed_amount_kobo || d.quoted_amount_kobo || 0) || ""}" /></div>
             </div>`,
      confirmLabel: "Mark won",
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/status`, { status: "won", amount: $("#wAmount", root).value });
        toast("Deal marked won.");
        reload();
      },
    })
  );

  on("#btnLost", () =>
    sheet({
      title: "Close this deal",
      sub: "The Scout sees the outcome, but never the reason you write here.",
      html: `<div class="field">
               <label for="lReason">Reason (optional)</label>
               <input id="lReason" placeholder="Budget didn't work out" />
             </div>`,
      confirmLabel: "Mark lost",
      danger: true,
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/status`, { status: "lost", reason: $("#lReason", root).value });
        toast("Deal closed.");
        reload();
      },
    })
  );

  on("#btnPayment", () =>
    sheet({
      title: "Record a payment",
      sub: "Money that arrived by transfer or cash. Commission accrues immediately.",
      html: `<div class="field">
               <label for="pAmount">Amount received</label>
               <div class="naira"><input id="pAmount" inputmode="decimal" /></div>
             </div>
             <div class="field">
               <label for="pKind">Type</label>
               <select id="pKind">
                 <option value="deposit">Upfront deposit</option>
                 <option value="balance">Final balance</option>
                 <option value="part">Part payment</option>
               </select>
             </div>
             <div class="field">
               <label for="pNote">Reference (optional)</label>
               <input id="pNote" placeholder="GTBank transfer 8823" />
             </div>`,
      confirmLabel: "Record payment",
      onConfirm: async (root) => {
        const r = await POST("/api/admin/payments", {
          dealId: d.id,
          amount: $("#pAmount", root).value,
          kind: $("#pKind", root).value,
          note: $("#pNote", root).value,
        });
        toast(r.commission ? `Recorded. ${money(r.commission.amount_kobo)} commission accrued.` : "Payment recorded.");
        reload();
      },
    })
  );

  on("#btnEligible", () => {
    if (!d.commission_eligible) {
      return POST(`/api/admin/deals/${d.id}/eligibility`, { eligible: true }).then(() => {
        toast("Commission restored.");
        reload();
      });
    }
    return sheet({
      title: "Remove commission from this deal",
      sub: "Use when the client was already a direct Meji Builds contact.",
      html: `<div class="field">
               <label for="eReason">Reason (required)</label>
               <input id="eReason" placeholder="Existing client since March" />
             </div>
             <p class="hint">Commission already accrued isn't removed. Adjust the Scout's
             wallet if it genuinely has to be reversed.</p>`,
      confirmLabel: "Remove commission",
      danger: true,
      onConfirm: async (root) => {
        const reason = $("#eReason", root).value.trim();
        if (!reason) { toast("A reason is required.", true); return false; }
        await POST(`/api/admin/deals/${d.id}/eligibility`, { eligible: false, reason });
        toast("Commission removed.");
        reload();
      },
    });
  });

  $$("[data-confirm-pay]").forEach((b) => {
    b.onclick = busy(b, async () => {
      await POST(`/api/admin/payments/${b.dataset.confirmPay}/confirm`);
      toast("Payment confirmed.");
      reload();
    });
  });
  $$("[data-refund]").forEach((b) => {
    b.onclick = busy(b, () =>
      sheet({
        title: "Refund this payment",
        sub: "Commission earned on it is clawed back from the Scout's wallet.",
        html: `<div class="field"><label for="rNote">Reason</label>
                 <input id="rNote" placeholder="Client cancelled" /></div>`,
        confirmLabel: "Refund",
        danger: true,
        onConfirm: async (root) => {
          await POST(`/api/admin/payments/${b.dataset.refund}/refund`, { note: $("#rNote", root).value });
          toast("Refunded and commission reversed.");
          reload();
        },
      })
    );
  });
}

// ---- payouts ----
async function loadPayouts() {
  const el = $("#payoutsList");
  el.innerHTML = skeleton(3);
  const r = await GET("/api/admin/withdrawals");
  if (!r.withdrawals.length) {
    el.innerHTML = empty("cash", "No payout requests", "Scouts' withdrawal requests land here for approval.");
    return;
  }
  el.innerHTML = `
    <div class="dl" style="--cols:1.6fr 1.8fr 1.2fr 1fr 1.4fr">
      <div class="dl-head"><span>Scout</span><span>Account</span><span>Status</span>
        <span style="text-align:right">Amount</span><span></span></div>
      ${r.withdrawals
        .map(
          (w) => `<div class="dl-row">
            <div class="dl-cell primary"><div class="t">${esc(w.scout_name)}</div>
              <div class="s ref">${esc(w.referral_code)} · ${when(w.requested_at)}</div></div>
            <div class="dl-cell"><span class="dl-k">Account</span>
              <div><div>${esc(w.bank_name || "—")}</div>
              <div class="s mono">${esc(w.account_number || "")} · ${esc(w.account_name || "")}</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span>
              <div>${pill(w.status)}${w.note ? `<div class="s">${esc(w.note)}</div>` : ""}</div></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span>
              <span class="money">${money(w.amount_kobo)}</span></div>
            <div class="dl-cell actions">
              ${
                ["requested", "approved", "processing"].includes(w.status)
                  ? `<button class="btn sm" data-paid="${w.id}">Mark paid</button>
                     <button class="btn sm danger" data-reject="${w.id}">Reject</button>`
                  : ""
              }
            </div>
          </div>`
        )
        .join("")}
    </div>`;

  $$("[data-paid]").forEach((b) => {
    b.onclick = busy(b, () =>
      sheet({
        title: "Mark payout as paid",
        sub: "Confirm the transfer has actually left your bank.",
        html: `<div class="field"><label for="pdNote">Transfer reference</label>
                 <input id="pdNote" class="mono" placeholder="GTBank 99213" /></div>`,
        confirmLabel: "Mark paid",
        onConfirm: async (root) => {
          await POST(`/api/admin/withdrawals/${b.dataset.paid}/paid`, { note: $("#pdNote", root).value });
          toast("Marked paid.");
          loadPayouts();
          refreshOverview();
        },
      })
    );
  });
  $$("[data-reject]").forEach((b) => {
    b.onclick = busy(b, () =>
      sheet({
        title: "Reject this payout",
        sub: "The money goes straight back to the Scout's available balance.",
        html: `<div class="field"><label for="rjNote">Reason</label>
                 <input id="rjNote" placeholder="Account details didn't match" /></div>`,
        confirmLabel: "Reject",
        danger: true,
        onConfirm: async (root) => {
          await POST(`/api/admin/withdrawals/${b.dataset.reject}/reject`, { note: $("#rjNote", root).value });
          toast("Rejected and returned to their balance.");
          loadPayouts();
          refreshOverview();
        },
      })
    );
  });
}

// ---- scouts ----
async function loadScouts() {
  const el = $("#scoutsList");
  el.innerHTML = skeleton(3);
  const r = await GET("/api/admin/scouts");
  if (!r.scouts.length) {
    el.innerHTML = empty("people", "No Scouts yet", "People who sign up to refer clients appear here.");
    return;
  }
  el.innerHTML = `
    <div class="dl" style="--cols:1.9fr 1fr 1.2fr 1.1fr 1fr 1.3fr">
      <div class="dl-head"><span>Scout</span><span>Rate</span><span>Deals</span>
        <span style="text-align:right">Earned</span><span style="text-align:right">Available</span><span></span></div>
      ${r.scouts
        .map(
          (s) => `<div class="dl-row">
            <div class="dl-cell primary"><div class="t">${esc(s.name)} ${s.status !== "active" ? pill(s.status) : ""}</div>
              <div class="s">${esc(s.email)} · <span class="ref">${esc(s.referral_code)}</span></div></div>
            <div class="dl-cell"><span class="dl-k">Rate</span><span class="mono">${s.commission_rate_bps / 100}%</span></div>
            <div class="dl-cell"><span class="dl-k">Deals</span><span>${s.deals} <span class="s">(${s.won} won)</span></span></div>
            <div class="dl-cell right"><span class="dl-k">Earned</span>
              <span class="money">${money(Number(s.earned_kobo))}</span></div>
            <div class="dl-cell right"><span class="dl-k">Available</span>
              <span class="money ${Number(s.available_kobo) < 0 ? "neg" : ""}">${money(Number(s.available_kobo))}</span></div>
            <div class="dl-cell actions">
              <button class="btn sm ghost" data-edit="${s.id}" data-rate="${s.commission_rate_bps / 100}" data-status="${s.status}">Edit</button>
              <button class="btn sm quiet" data-adjust="${s.id}" data-name="${esc(s.name)}">Adjust</button>
            </div>
          </div>`
        )
        .join("")}
    </div>`;

  $$("[data-edit]").forEach((b) => {
    b.onclick = busy(b, () =>
      sheet({
        title: "Edit Scout",
        sub: "A new rate applies to future deals only. Deals already running keep theirs.",
        html: `<div class="field">
                 <label for="eRate">Commission (%)</label>
                 <input id="eRate" class="mono" inputmode="decimal" value="${b.dataset.rate}" />
               </div>
               <div class="field">
                 <label for="eStatus">Status</label>
                 <select id="eStatus">
                   <option value="active" ${b.dataset.status === "active" ? "selected" : ""}>Active</option>
                   <option value="suspended" ${b.dataset.status === "suspended" ? "selected" : ""}>Suspended</option>
                 </select>
               </div>`,
        confirmLabel: "Save",
        onConfirm: async (root) => {
          await POST(`/api/admin/scouts/${b.dataset.edit}`, {
            commissionPercent: $("#eRate", root).value,
            status: $("#eStatus", root).value,
          });
          toast("Scout updated.");
          loadScouts();
        },
      })
    );
  });

  $$("[data-adjust]").forEach((b) => {
    b.onclick = busy(b, () =>
      sheet({
        title: `Adjust ${b.dataset.name}'s wallet`,
        sub: "Use a minus sign to deduct. Every adjustment is recorded in the audit log.",
        html: `<div class="field">
                 <label for="aAmount">Amount</label>
                 <div class="naira"><input id="aAmount" placeholder="5000 or -5000" /></div>
               </div>
               <div class="field">
                 <label for="aNote">Reason (required)</label>
                 <input id="aNote" placeholder="Goodwill bonus for Q3" />
               </div>`,
        confirmLabel: "Apply adjustment",
        onConfirm: async (root) => {
          await POST(`/api/admin/scouts/${b.dataset.adjust}/adjust`, {
            amount: $("#aAmount", root).value,
            note: $("#aNote", root).value,
          });
          toast("Wallet adjusted.");
          loadScouts();
        },
      })
    );
  });
}

// ---- settings ----
async function loadSettings() {
  const r = await GET("/api/admin/settings");
  const s = r.settings;
  $("#setCommission").value = s.default_commission_bps / 100;
  $("#setDeposit").value = s.deposit_bps / 100;
  $("#setHold").value = s.hold_days;
  $("#setMin").value = naira(s.min_withdrawal_kobo);
  $("#setWindow").value = s.attribution_window_days;
  $("#setBank").value = s.payin_bank_name;
  $("#setAcctNo").value = s.payin_account_number;
  $("#setAcctName").value = s.payin_account_name;

  const a = await GET("/api/admin/audit");
  $("#auditList").innerHTML = a.entries.length
    ? `<div class="dl" style="--cols:1.4fr 1.6fr 2fr">
         <div class="dl-head"><span>When</span><span>Who</span><span>Action</span></div>
         ${a.entries
           .slice(0, 40)
           .map(
             (e) => `<div class="dl-row">
               <div class="dl-cell primary"><div class="t">${when(e.created_at)}</div></div>
               <div class="dl-cell"><span class="dl-k">Who</span><span>${esc(e.actor_label || e.actor_type)}</span></div>
               <div class="dl-cell"><span class="dl-k">Action</span>
                 <div><span class="ref">${esc(e.action)}</span>
                 <div class="s">${esc(JSON.stringify(e.meta || {}).slice(0, 90))}</div></div></div>
             </div>`
           )
           .join("")}
       </div>`
    : empty("list", "Nothing logged yet", "Actions that touch money are recorded here.");
}

$("#settingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#settingsForm button[type=submit]");
  await busy(btn, async () => {
    await POST("/api/admin/settings", {
      default_commission_bps: $("#setCommission").value,
      deposit_bps: $("#setDeposit").value,
      hold_days: $("#setHold").value,
      min_withdrawal_kobo: $("#setMin").value,
      attribution_window_days: $("#setWindow").value,
    });
    toast("Settings saved.");
  })();
};

$("#bankSettingsForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#bankSettingsForm button[type=submit]");
  await busy(btn, async () => {
    await POST("/api/admin/settings", {
      payin_bank_name: $("#setBank").value,
      payin_account_number: $("#setAcctNo").value,
      payin_account_name: $("#setAcctName").value,
    });
    toast("Account details saved.");
  })();
};
