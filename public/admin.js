// Studio console — where Meji Builds actually runs the pipeline: replies to
// clients, sends quotes, closes deals, records money and approves payouts.

let poll = null;
let currentDeal = null;
let statusFilter = "all";

// ---- session ----
GET("/api/me")
  .then((me) => (me.admin ? start() : ($("#loginWrap").style.display = "")))
  .catch(() => ($("#loginWrap").style.display = ""));

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
  $("#loginWrap").style.display = "none";
  $("#app").style.display = "";
  $("#nav").style.display = "";
  show("pipeline");
  refreshOverview();
}

$("#logout").onclick = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.reload();
};

// ---- navigation ----
function show(view) {
  $$("section[data-panel]").forEach((s) => (s.style.display = s.dataset.panel === view ? "" : "none"));
  $$("nav button[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (poll && view !== "deal") {
    poll.stop();
    poll = null;
  }
  if (view === "pipeline") loadDeals();
  if (view === "payouts") loadPayouts();
  if (view === "scouts") loadScouts();
  if (view === "settings") loadSettings();
}
$$("nav button[data-view]").forEach((b) => (b.onclick = () => show(b.dataset.view)));
$("#backToPipeline").onclick = () => show("pipeline");

async function refreshOverview() {
  const o = await GET("/api/admin/overview");
  $("#overview").innerHTML = `
    <div class="stat accent">
      <div class="lbl">Open deals</div><div class="num">${o.deals.open}</div>
      <div class="note">${o.deals.won} won · ${o.deals.lost} lost</div>
    </div>
    <div class="stat green">
      <div class="lbl">Collected</div><div class="num">${money(o.money.collectedKobo)}</div>
      <div class="note">${money(o.money.awaitingKobo)} awaiting confirmation</div>
    </div>
    <div class="stat amber">
      <div class="lbl">Commission owed</div>
      <div class="num">${money(o.money.commissionEarnedKobo - o.money.commissionPaidKobo)}</div>
      <div class="note">${money(o.money.commissionPaidKobo)} paid out</div>
    </div>
    <div class="stat">
      <div class="lbl">Payout requests</div><div class="num">${o.pendingWithdrawals}</div>
      <div class="note">${o.activeScouts} active Scouts</div>
    </div>`;
}

// ---- pipeline ----
$$("#statusFilter button").forEach((b) => {
  b.onclick = () => {
    statusFilter = b.dataset.status;
    $$("#statusFilter button").forEach((x) => x.classList.toggle("active", x === b));
    loadDeals();
  };
});

async function loadDeals() {
  const r = await GET(`/api/admin/deals?status=${encodeURIComponent(statusFilter)}`);
  const table = $("#dealsTable");
  if (!r.deals.length) {
    table.innerHTML = `<tbody><tr><td><div class="empty">Nothing here yet.</div></td></tr></tbody>`;
    return;
  }
  table.innerHTML = `
    <thead><tr>
      <th>Client</th><th>Project</th><th>Scout</th><th>Status</th>
      <th class="num">Value</th><th class="num">Paid</th>
    </tr></thead>
    <tbody>${r.deals
      .map(
        (d) => `<tr class="clickable" data-id="${d.id}">
          <td>
            <div class="strong">${esc(d.client_name)}
              ${d.unread ? `<span class="badge in_discussion" style="margin-left:6px">${d.unread} new</span>` : ""}
            </div>
            <div class="meta">${esc(d.client_company || d.client_email)}</div>
          </td>
          <td>
            <div>${esc(d.title)}</div>
            <div class="meta">${esc(d.ref)} · ${when(d.created_at)}</div>
          </td>
          <td>
            ${d.scout_name ? esc(d.scout_name) : `<span class="meta">Direct</span>`}
            ${d.attribution === "contested" ? `<div>${badge("contested")}</div>` : ""}
            ${!d.commission_eligible ? `<div class="meta" style="color:var(--amber)">No commission</div>` : ""}
          </td>
          <td>${badge(d.status)}</td>
          <td class="num money">${d.agreed_amount_kobo || d.quoted_amount_kobo ? money(d.agreed_amount_kobo || d.quoted_amount_kobo) : "—"}</td>
          <td class="num money">${Number(d.paid_kobo) ? money(Number(d.paid_kobo)) : "—"}</td>
        </tr>`
      )
      .join("")}</tbody>`;
  $$("#dealsTable tr.clickable").forEach((tr) => (tr.onclick = () => openDeal(Number(tr.dataset.id))));
}

// ---- one deal ----
async function openDeal(id) {
  const r = await GET(`/api/admin/deals/${id}`);
  currentDeal = r;
  show("deal");
  const d = r.deal;
  const closed = ["won", "lost", "cancelled"].includes(d.status);

  $("#dealDetail").innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <div>
          <h2 style="margin-bottom:4px">${esc(d.title)}</h2>
          <div class="meta" style="color:var(--muted);font-size:12.5px">
            ${esc(d.ref)} · ${esc(d.client_name)} · ${esc(d.client_email)}
            ${d.client_phone ? ` · ${esc(d.client_phone)}` : ""}
          </div>
        </div>
        ${badge(d.status)}
      </div>

      ${d.attribution === "contested" ? `<div class="notice warn">
        Attribution is contested — more than one Scout claimed this client, or the
        client already existed. Confirm who (if anyone) should be credited.
      </div>` : ""}
      ${!d.commission_eligible ? `<div class="notice warn">
        No commission on this deal${d.ineligible_reason ? ` — ${esc(d.ineligible_reason)}` : ""}.
      </div>` : ""}

      <div class="table-scroll"><table>
        <tr><td style="color:var(--muted)">Referred by</td>
            <td class="num">${d.scout_name ? `${esc(d.scout_name)} <span class="meta">(${esc(d.referral_code)})</span>` : "Direct — no Scout"}</td></tr>
        <tr><td style="color:var(--muted)">Brief</td><td class="num">${esc(d.description || "—")}</td></tr>
        <tr><td style="color:var(--muted)">Budget hint</td><td class="num">${esc(d.budget_range || "—")}</td></tr>
        <tr><td style="color:var(--muted)">Timeline</td><td class="num">${esc(d.timeline || "—")}</td></tr>
        <tr><td style="color:var(--muted)">Quoted</td><td class="num money">${d.quoted_amount_kobo ? money(d.quoted_amount_kobo) : "—"}</td></tr>
        <tr><td style="color:var(--muted)">Agreed</td><td class="num money">${d.agreed_amount_kobo ? money(d.agreed_amount_kobo) : "—"}</td></tr>
        <tr><td style="color:var(--muted)">Collected</td><td class="num money pos">${money(r.money.paidKobo)}</td></tr>
        <tr><td style="color:var(--muted)">Outstanding</td><td class="num money">${money(r.money.outstandingKobo)}</td></tr>
        <tr><td style="color:var(--muted)">Commission at ${d.commission_rate_bps / 100}%</td>
            <td class="num money">${r.projectedCommissionKobo ? money(r.projectedCommissionKobo) : "—"}</td></tr>
      </table></div>

      <hr class="divider" />
      <div class="row" style="gap:8px">
        ${!closed ? `<button id="btnQuote">${d.quoted_amount_kobo ? "Requote" : "Send quote"}</button>` : ""}
        ${d.status !== "won" ? `<button class="ghost" id="btnWon">Mark won</button>` : ""}
        ${d.status === "won" ? `<button id="btnPayment">Record payment</button>` : ""}
        ${!["lost", "cancelled"].includes(d.status) ? `<button class="danger" id="btnLost">Mark lost</button>` : ""}
        ${d.scout_id ? `<button class="ghost" id="btnEligible">${d.commission_eligible ? "Remove commission" : "Restore commission"}</button>` : ""}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Conversation</h2></div>
      <div class="thread" id="thread"></div>
      <div class="composer">
        <textarea id="msgBox" placeholder="Reply to ${esc(d.client_name)}…" rows="1"></textarea>
        <button id="send">Send</button>
      </div>
    </div>

    ${r.payments.length ? `<div class="panel">
      <div class="panel-head"><h2>Payments</h2></div>
      <div class="table-scroll"><table>
        <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
        <tbody>${r.payments.map((p) => `<tr>
          <td>${when(p.paid_at || p.created_at)}</td>
          <td><span class="meta">${esc(p.provider_ref)}</span></td>
          <td style="text-transform:capitalize">${esc(p.kind)}</td>
          <td>${badge(p.status)}</td>
          <td class="num money">${money(p.amount_kobo)}</td>
          <td class="num">
            ${p.status === "pending" ? `<button class="sm" data-confirm-pay="${p.id}">Confirm</button>` : ""}
            ${p.status === "success" ? `<button class="sm danger" data-refund="${p.id}">Refund</button>` : ""}
          </td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>` : ""}`;

  wireDealActions(d);
  poll = pollThread({ container: $("#thread"), url: `/api/admin/deals/${d.id}/messages`, mine: "admin" });
}

function wireDealActions(d) {
  const on = (sel, fn) => {
    const el = $(sel);
    if (el) el.onclick = busy(el, fn);
  };

  on("#btnQuote", () =>
    modal({
      title: "Send a quote",
      sub: `${esc(d.client_name)} will see this in the conversation and can accept it.`,
      html: `<div class="field">
               <label for="qAmount">Total project price (₦)</label>
               <input id="qAmount" inputmode="decimal" placeholder="1,000,000"
                      value="${d.quoted_amount_kobo ? Math.floor(d.quoted_amount_kobo / 100) : ""}" />
             </div>`,
      confirmLabel: "Send quote",
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/quote`, { amount: $("#qAmount", root).value });
        toast("Quote sent.");
        openDeal(d.id);
      },
    })
  );

  on("#btnWon", () =>
    modal({
      title: "Mark this deal won",
      sub: "Set the amount the client actually agreed to pay.",
      html: `<div class="field">
               <label for="wAmount">Agreed amount (₦)</label>
               <input id="wAmount" inputmode="decimal"
                      value="${Math.floor((d.agreed_amount_kobo || d.quoted_amount_kobo || 0) / 100) || ""}" />
             </div>`,
      confirmLabel: "Mark won",
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/status`, {
          status: "won",
          amount: $("#wAmount", root).value,
        });
        toast("Deal marked won.");
        openDeal(d.id);
        refreshOverview();
      },
    })
  );

  on("#btnLost", () =>
    modal({
      title: "Close this deal",
      sub: "The Scout sees the outcome, but never the reason you type here.",
      html: `<div class="field">
               <label for="lReason">Reason (optional)</label>
               <input id="lReason" placeholder="Budget too low" />
             </div>`,
      confirmLabel: "Mark lost",
      onConfirm: async (root) => {
        await POST(`/api/admin/deals/${d.id}/status`, {
          status: "lost",
          reason: $("#lReason", root).value,
        });
        toast("Deal closed.");
        openDeal(d.id);
        refreshOverview();
      },
    })
  );

  on("#btnPayment", () =>
    modal({
      title: "Record a payment",
      sub: "Money that arrived by transfer or cash. Commission accrues immediately.",
      html: `<div class="field">
               <label for="pAmount">Amount received (₦)</label>
               <input id="pAmount" inputmode="decimal" />
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
               <label for="pNote">Note (optional)</label>
               <input id="pNote" placeholder="GTBank transfer ref 8823" />
             </div>`,
      confirmLabel: "Record payment",
      onConfirm: async (root) => {
        const r = await POST("/api/admin/payments", {
          dealId: d.id,
          amount: $("#pAmount", root).value,
          kind: $("#pKind", root).value,
          note: $("#pNote", root).value,
        });
        toast(
          r.commission
            ? `Recorded. ${money(r.commission.amount_kobo)} commission accrued.`
            : "Payment recorded."
        );
        openDeal(d.id);
        refreshOverview();
      },
    })
  );

  on("#btnEligible", () => {
    if (d.commission_eligible) {
      return modal({
        title: "Remove commission from this deal",
        sub: "Use when the client was already a direct Meji Builds contact.",
        html: `<div class="field">
                 <label for="eReason">Reason (required)</label>
                 <input id="eReason" placeholder="Existing client since March" />
               </div>
               <div class="hint">Commission already accrued is not removed — adjust the Scout's wallet if it must be reversed.</div>`,
        confirmLabel: "Remove commission",
        onConfirm: async (root) => {
          const reason = $("#eReason", root).value.trim();
          if (!reason) return toast("A reason is required.", true) || false;
          await POST(`/api/admin/deals/${d.id}/eligibility`, { eligible: false, reason });
          toast("Commission removed.");
          openDeal(d.id);
        },
      });
    }
    return POST(`/api/admin/deals/${d.id}/eligibility`, { eligible: true }).then(() => {
      toast("Commission restored.");
      openDeal(d.id);
    });
  });

  $$("[data-confirm-pay]").forEach((b) => {
    b.onclick = busy(b, async () => {
      await POST(`/api/admin/payments/${b.dataset.confirmPay}/confirm`);
      toast("Payment confirmed.");
      openDeal(d.id);
      refreshOverview();
    });
  });
  $$("[data-refund]").forEach((b) => {
    b.onclick = busy(b, () =>
      modal({
        title: "Refund this payment",
        sub: "Commission earned on it is clawed back from the Scout's wallet.",
        html: `<div class="field">
                 <label for="rNote">Reason</label>
                 <input id="rNote" placeholder="Client cancelled" />
               </div>`,
        confirmLabel: "Refund",
        onConfirm: async (root) => {
          await POST(`/api/admin/payments/${b.dataset.refund}/refund`, {
            note: $("#rNote", root).value,
          });
          toast("Refunded and commission reversed.");
          openDeal(d.id);
          refreshOverview();
        },
      })
    );
  });

  const send = $("#send");
  const box = $("#msgBox");
  const doSend = async () => {
    const body = box.value.trim();
    if (!body) return;
    box.value = "";
    try {
      const r = await POST(`/api/admin/deals/${d.id}/messages`, { body });
      poll.push(r.message);
    } catch (e) {
      box.value = body;
      toast(e.message, true);
    }
  };
  send.onclick = doSend;
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
}

// ---- payouts ----
async function loadPayouts() {
  const r = await GET("/api/admin/withdrawals");
  const table = $("#payoutsTable");
  if (!r.withdrawals.length) {
    table.innerHTML = `<tbody><tr><td><div class="empty">No withdrawal requests.</div></td></tr></tbody>`;
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Scout</th><th>Account</th><th>Requested</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead>
    <tbody>${r.withdrawals
      .map(
        (w) => `<tr>
          <td><div class="strong">${esc(w.scout_name)}</div><div class="meta">${esc(w.referral_code)}</div></td>
          <td><div>${esc(w.bank_name || "—")}</div><div class="meta">${esc(w.account_number || "")} · ${esc(w.account_name || "")}</div></td>
          <td>${when(w.requested_at)}</td>
          <td>${badge(w.status)}${w.note ? `<div class="meta">${esc(w.note)}</div>` : ""}</td>
          <td class="num money">${money(w.amount_kobo)}</td>
          <td class="num">
            ${["requested", "approved", "processing"].includes(w.status)
              ? `<div class="row" style="gap:6px;flex-wrap:nowrap;justify-content:flex-end">
                   <button class="sm" data-paid="${w.id}">Mark paid</button>
                   <button class="sm danger" data-reject="${w.id}">Reject</button>
                 </div>`
              : ""}
          </td>
        </tr>`
      )
      .join("")}</tbody>`;

  $$("[data-paid]").forEach((b) => {
    b.onclick = busy(b, () =>
      modal({
        title: "Mark payout as paid",
        sub: "Confirm the transfer has actually left your bank.",
        html: `<div class="field"><label for="pdNote">Transfer reference</label>
                 <input id="pdNote" placeholder="GTBank ref 99213" /></div>`,
        confirmLabel: "Mark paid",
        onConfirm: async (root) => {
          await POST(`/api/admin/withdrawals/${b.dataset.paid}/paid`, {
            note: $("#pdNote", root).value,
          });
          toast("Marked paid.");
          loadPayouts();
          refreshOverview();
        },
      })
    );
  });
  $$("[data-reject]").forEach((b) => {
    b.onclick = busy(b, () =>
      modal({
        title: "Reject this payout",
        sub: "The money goes straight back to the Scout's available balance.",
        html: `<div class="field"><label for="rjNote">Reason</label>
                 <input id="rjNote" placeholder="Account details didn't match" /></div>`,
        confirmLabel: "Reject",
        onConfirm: async (root) => {
          await POST(`/api/admin/withdrawals/${b.dataset.reject}/reject`, {
            note: $("#rjNote", root).value,
          });
          toast("Rejected and refunded to their balance.");
          loadPayouts();
          refreshOverview();
        },
      })
    );
  });
}

// ---- scouts ----
async function loadScouts() {
  const r = await GET("/api/admin/scouts");
  const table = $("#scoutsTable");
  if (!r.scouts.length) {
    table.innerHTML = `<tbody><tr><td><div class="empty">No Scouts yet.</div></td></tr></tbody>`;
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Scout</th><th>Code</th><th>Rate</th><th class="num">Deals</th>
      <th class="num">Earned</th><th class="num">Available</th><th>Status</th><th></th></tr></thead>
    <tbody>${r.scouts
      .map(
        (s) => `<tr>
          <td><div class="strong">${esc(s.name)}</div><div class="meta">${esc(s.email)}</div></td>
          <td><span class="meta">${esc(s.referral_code)}</span></td>
          <td>${s.commission_rate_bps / 100}%</td>
          <td class="num">${s.deals} <span class="meta">(${s.won} won)</span></td>
          <td class="num money">${money(Number(s.earned_kobo))}</td>
          <td class="num money">${money(Number(s.available_kobo))}</td>
          <td>${badge(s.status)}</td>
          <td class="num">
            <div class="row" style="gap:6px;flex-wrap:nowrap;justify-content:flex-end">
              <button class="sm ghost" data-edit="${s.id}" data-rate="${s.commission_rate_bps / 100}" data-status="${s.status}">Edit</button>
              <button class="sm ghost" data-adjust="${s.id}" data-name="${esc(s.name)}">Adjust</button>
            </div>
          </td>
        </tr>`
      )
      .join("")}</tbody>`;

  $$("[data-edit]").forEach((b) => {
    b.onclick = busy(b, () =>
      modal({
        title: "Edit Scout",
        sub: "Changing the rate affects new deals only — existing deals keep the rate they were created with.",
        html: `<div class="field">
                 <label for="eRate">Commission (%)</label>
                 <input id="eRate" inputmode="decimal" value="${b.dataset.rate}" />
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
      modal({
        title: `Adjust ${b.dataset.name}'s wallet`,
        sub: "Use a minus sign to deduct. Every adjustment is recorded in the audit log.",
        html: `<div class="field">
                 <label for="aAmount">Amount (₦)</label>
                 <input id="aAmount" placeholder="5000 or -5000" />
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
  $("#setMin").value = Math.floor(s.min_withdrawal_kobo / 100);
  $("#setWindow").value = s.attribution_window_days;
  $("#setBank").value = s.payin_bank_name;
  $("#setAcctNo").value = s.payin_account_number;
  $("#setAcctName").value = s.payin_account_name;

  const a = await GET("/api/admin/audit");
  $("#auditTable").innerHTML = a.entries.length
    ? `<thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
       <tbody>${a.entries
         .slice(0, 60)
         .map(
           (e) => `<tr>
             <td>${when(e.created_at)}</td>
             <td>${esc(e.actor_label || e.actor_type)}</td>
             <td><span class="meta">${esc(e.action)}</span></td>
             <td class="meta">${esc(JSON.stringify(e.meta || {}).slice(0, 120))}</td>
           </tr>`
         )
         .join("")}</tbody>`
    : `<tbody><tr><td><div class="empty">Nothing logged yet.</div></td></tr></tbody>`;
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
