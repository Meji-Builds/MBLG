// Scout dashboard.
//
// Read-only on everything that decides money: deal status, amounts and
// commission all come from the studio. The only things a Scout writes here are
// their own payout account and a withdrawal request.

let data = null;
let wallet = null;

async function load() {
  try {
    data = await GET("/api/scout/dashboard");
  } catch (e) {
    if (e.status === 401) return location.replace("/");
    throw e;
  }
  $("#loading").style.display = "none";
  $("#app").style.display = "";

  const s = data.scout;
  $("#scoutName").textContent = s.name;
  $("#inviteUrl").value = s.inviteUrl;
  $("#codeText").textContent = s.referralCode;
  $("#rateBadge").textContent = `${s.commissionPercent}% commission`;

  $("#bkName").value = s.bank.bankName;
  $("#bkCode").value = s.bank.bankCode;
  $("#bkNumber").value = s.bank.accountNumber;
  $("#bkAccName").value = s.bank.accountName;

  $("#holdNote").textContent = `Clears ${data.settings.holdDays} days after the client pays`;
  $("#dealsNote").textContent = `${data.stats.won} won · ${data.stats.open} open`;
  $("#terms").innerHTML = `
    You earn <strong>${s.commissionPercent}%</strong> of what each client you
    introduced actually pays Meji Builds — so if they pay in instalments, your
    commission arrives the same way.<br /><br />
    Each amount is held for <strong>${data.settings.holdDays} days</strong> after
    the client's payment clears, in case the project is cancelled or refunded.
    After that it moves to your available balance and you can withdraw any amount
    from <strong>${money(data.settings.minWithdrawalKobo)}</strong> upwards.`;

  renderBalances(data.balances);
  renderDeals();
}

function renderBalances(b) {
  $("#stAvailable").textContent = money(b.available);
  $("#stAvailable").classList.toggle("neg", b.available < 0);
  $("#stPending").textContent = money(b.pending);
  $("#stLifetime").textContent = money(b.lifetime);
  $("#stDeals").textContent = data.stats.total;
  $("#paidOutNote").textContent = `${money(b.withdrawn)} withdrawn`;

  // A negative balance means a refund clawed back more than is left. Say so
  // plainly rather than showing a mystifying minus number.
  const debt = b.available < 0;
  $("#debtNotice").innerHTML = debt
    ? `<div class="notice warn">
         A client refund reversed commission that had already been paid out, so
         your balance is ${money(b.available)}. Future commission clears this
         automatically — nothing is owed out of pocket.
       </div>`
    : "";
}

function renderDeals() {
  const rows = data.deals;
  const table = $("#dealsTable");
  if (!rows.length) {
    table.innerHTML = `<tbody><tr><td><div class="empty">
      No referrals yet. Share your link above to get started.
    </div></td></tr></tbody>`;
    return;
  }
  table.innerHTML = `
    <thead><tr>
      <th>Client</th><th>Project</th><th>Status</th>
      <th class="num">Deal value</th><th class="num">Paid</th><th class="num">Your commission</th>
    </tr></thead>
    <tbody>${rows
      .map((d) => {
        const value = d.agreedKobo || d.quotedKobo;
        return `<tr>
          <td>
            <div class="strong">${esc(d.clientName)}</div>
            ${d.clientCompany ? `<div class="meta">${esc(d.clientCompany)}</div>` : ""}
          </td>
          <td>
            <div>${esc(d.title)}</div>
            <div class="meta">${esc(d.ref)} · ${when(d.createdAt)}</div>
          </td>
          <td>
            ${badge(d.status)}
            ${
              !d.eligible
                ? `<div class="meta" style="margin-top:4px;color:var(--amber)">
                     No commission — ${esc(d.ineligibleReason || "ruled out")}
                   </div>`
                : ""
            }
            ${d.lostReason ? `<div class="meta" style="margin-top:4px">${esc(d.lostReason)}</div>` : ""}
          </td>
          <td class="num money">${value ? money(value) : "—"}</td>
          <td class="num money">${d.paidKobo ? money(d.paidKobo) : "—"}</td>
          <td class="num money ${d.earnedKobo > 0 ? "pos" : ""}">
            ${d.earnedKobo ? money(d.earnedKobo) : `<span style="color:var(--muted);font-weight:400">${d.commissionPercent}% when paid</span>`}
          </td>
        </tr>`;
      })
      .join("")}</tbody>`;
}

// ---- wallet ----
async function loadWallet() {
  wallet = await GET("/api/scout/wallet");
  renderBalances(wallet.balances);

  const entries = wallet.entries;
  $("#ledgerTable").innerHTML = entries.length
    ? `<thead><tr><th>Date</th><th>Detail</th><th>Status</th><th class="num">Amount</th></tr></thead>
       <tbody>${entries
         .map((e) => {
           const held = e.available_at && new Date(e.available_at) > new Date();
           return `<tr>
             <td>${when(e.created_at)}</td>
             <td>
               <div>${esc(e.note || e.type)}</div>
               ${e.deal_ref ? `<div class="meta">${esc(e.deal_ref)} · ${esc(e.deal_title || "")}</div>` : ""}
             </td>
             <td>${held ? `${badge("held")}<div class="meta" style="margin-top:4px">clears ${fromNow(e.available_at)}</div>` : badge("active")}</td>
             <td class="num money ${e.amount_kobo < 0 ? "neg" : "pos"}">
               ${e.amount_kobo > 0 ? "+" : ""}${money(e.amount_kobo)}
             </td>
           </tr>`;
         })
         .join("")}</tbody>`
    : `<tbody><tr><td><div class="empty">
         Nothing here yet. Commission shows up as soon as a client you introduced pays.
       </div></td></tr></tbody>`;

  const ws = wallet.withdrawals;
  $("#withdrawalsTable").innerHTML = ws.length
    ? `<thead><tr><th>Requested</th><th>Account</th><th>Status</th><th class="num">Amount</th></tr></thead>
       <tbody>${ws
         .map(
           (w) => `<tr>
             <td>${when(w.requested_at)}</td>
             <td>
               <div>${esc(w.bank_name || "—")}</div>
               <div class="meta">${esc(w.account_number || "")}</div>
             </td>
             <td>${badge(w.status)}${w.note ? `<div class="meta" style="margin-top:4px">${esc(w.note)}</div>` : ""}</td>
             <td class="num money">${money(w.amount_kobo)}</td>
           </tr>`
         )
         .join("")}</tbody>`
    : `<tbody><tr><td><div class="empty">No withdrawals yet.</div></td></tr></tbody>`;
}

$("#withdrawBtn").onclick = () => {
  const b = wallet?.balances || data.balances;
  const min = wallet?.settings.minWithdrawalKobo ?? data.settings.minWithdrawalKobo;

  if (b.available < min) {
    return toast(
      b.available <= 0
        ? "Nothing available to withdraw yet."
        : `You need at least ${money(min)} available.`,
      true
    );
  }
  if (!data.scout.bank.accountNumber) {
    toast("Add your payout account first.", true);
    return show("account");
  }

  modal({
    title: "Withdraw commission",
    sub: `${money(b.available)} available · paid to ${esc(data.scout.bank.bankName)} ${esc(
      data.scout.bank.accountNumber
    )}`,
    html: `<div class="field">
             <label for="wdAmount">Amount (₦)</label>
             <input id="wdAmount" inputmode="decimal" value="${Math.floor(b.available / 100)}" />
             <div class="help">Minimum ${money(min)}</div>
           </div>`,
    confirmLabel: "Request withdrawal",
    onConfirm: async (root) => {
      const r = await POST("/api/scout/withdrawals", {
        amount: $("#wdAmount", root).value,
      });
      data.balances = r.balances;
      await loadWallet();
      toast("Withdrawal requested — we'll process it shortly.");
    },
  });
};

$("#bankForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#bankForm button[type=submit]");
  await busy(btn, async () => {
    const r = await POST("/api/scout/bank", {
      bankName: $("#bkName").value,
      bankCode: $("#bkCode").value,
      accountNumber: $("#bkNumber").value,
      accountName: $("#bkAccName").value,
    });
    data.scout = r.scout;
    toast("Payout account saved.");
  })();
};

// ---- navigation ----
function show(view) {
  $$("section[data-panel]").forEach((s) => {
    s.style.display = s.dataset.panel === view ? "" : "none";
  });
  $$("nav button[data-view]").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view)
  );
  if (view === "wallet") loadWallet().catch((e) => toast(e.message, true));
}
$$("nav button[data-view]").forEach((b) => (b.onclick = () => show(b.dataset.view)));

$("#copyUrl").onclick = () => copy($("#inviteUrl").value, "Invite link copied");
$("#shareUrl").onclick = async () => {
  const url = $("#inviteUrl").value;
  const text = "Need a website or app built? Meji Builds does great work — start here:";
  // navigator.share only exists on mobile/HTTPS; fall back to the clipboard.
  if (navigator.share) {
    try {
      await navigator.share({ title: "Meji Builds", text, url });
      return;
    } catch {
      /* user dismissed the sheet */
    }
  }
  copy(`${text} ${url}`, "Invite message copied");
};

$("#logout").onclick = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.href = "/";
};

load().catch((e) => toast(e.message, true));
