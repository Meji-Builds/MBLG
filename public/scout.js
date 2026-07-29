// Scout dashboard.
//
// Read-only on everything that decides money: deal status, amounts and
// commission all come from the studio. The only things a Scout writes here are
// their own payout account and a withdrawal request.

let data = null;
let wallet = null;

// ---- load ----
async function load() {
  try {
    data = await GET("/api/scout/dashboard");
  } catch (e) {
    if (e.status === 401) return location.replace("/");
    $("#loading").innerHTML = `<div class="notice bad">
      <span class="ico">${icon("alert")}</span>
      <div><strong>Couldn't load your dashboard.</strong><br />${esc(e.message)}</div>
    </div>`;
    return;
  }

  $("#loading").classList.add("hidden");
  $("#app").classList.remove("hidden");

  const s = data.scout;
  $("#railName").textContent = s.name;
  $("#barName").textContent = s.name;
  $("#inviteUrl").value = s.inviteUrl;
  $("#codeText").textContent = s.referralCode;
  $("#rateBadge").textContent = `${s.commissionPercent}% commission`;
  $("#holdDays").textContent = `· ${data.settings.holdDays} days`;

  $("#bkName").value = s.bank.bankName;
  $("#bkCode").value = s.bank.bankCode;
  $("#bkNumber").value = s.bank.accountNumber;
  $("#bkAccName").value = s.bank.accountName;

  $("#terms").innerHTML = `
    <div><span class="k">Your rate</span><span class="v strong">${esc(s.commissionPercent)}% of what the client pays</span></div>
    <div><span class="k">When it's earned</span><span class="v">Each time a client you introduced actually pays</span></div>
    <div><span class="k">Hold period</span><span class="v">${data.settings.holdDays} days from the client's payment</span></div>
    <div><span class="k">Minimum withdrawal</span><span class="v money">${money(data.settings.minWithdrawalKobo)}</span></div>`;

  renderBalances(data.balances);
  renderTiles();
  renderDeals();
  renderRecent();
}

function renderBalances(b) {
  const av = $("#bAvailable");
  av.textContent = money(b.available);
  av.classList.toggle("neg", b.available < 0);
  $("#bPending").textContent = money(b.pending);
  $("#bLifetime").textContent = money(b.lifetime);

  // A negative balance means a refund clawed back more than was left. Say that
  // plainly instead of showing a mystifying minus number.
  $("#debtNotice").innerHTML =
    b.available < 0
      ? `<div class="notice warn">
           <span class="ico">${icon("alert")}</span>
           <div>A client refund reversed commission that had already been paid out, so your
           balance is <strong>${money(b.available)}</strong>. Future commission clears this
           automatically — you don't owe anything out of pocket.</div>
         </div>`
      : "";
}

function renderTiles() {
  const b = data.balances;
  $("#tiles").innerHTML = `
    <div class="tile"><div class="k">Referrals</div><div class="v">${data.stats.total}</div>
      <div class="n">${data.stats.open} still open</div></div>
    <div class="tile"><div class="k">Won</div><div class="v jade">${data.stats.won}</div>
      <div class="n">${data.stats.lost} didn't go ahead</div></div>
    <div class="tile"><div class="k">Withdrawn</div><div class="v">${money(b.withdrawn)}</div>
      <div class="n">paid to your bank</div></div>`;
}

// ---- referrals ----
const DEAL_COLS = "2fr 2.2fr 1.1fr 1fr 1fr";

function renderDeals() {
  const rows = data.deals;
  const el = $("#dealsList");
  if (!rows.length) {
    el.innerHTML = empty(
      "link",
      "No referrals yet",
      "Share your invite link and any project that starts from it shows up here."
    );
    return;
  }
  el.innerHTML = `
    <div class="dl" style="--cols:${DEAL_COLS}">
      <div class="dl-head">
        <span>Client</span><span>Project</span><span>Status</span>
        <span style="text-align:right">Deal value</span><span style="text-align:right">Your cut</span>
      </div>
      ${rows.map(dealRow).join("")}
    </div>`;
}

function dealRow(d) {
  const value = d.agreedKobo || d.quotedKobo;
  return `
    <div class="dl-row">
      <div class="dl-cell primary">
        <div class="t">${esc(d.clientName)}</div>
        ${d.clientCompany ? `<div class="s">${esc(d.clientCompany)}</div>` : ""}
      </div>
      <div class="dl-cell">
        <span class="dl-k">Project</span>
        <div><div class="t" style="font-weight:500">${esc(d.title)}</div>
        <div class="s ref">${esc(d.ref)} · ${when(d.createdAt)}</div></div>
      </div>
      <div class="dl-cell">
        <span class="dl-k">Status</span>
        <div>${pill(d.status)}
        ${
          !d.eligible
            ? `<div class="s" style="color:var(--gold);margin-top:4px">No commission — ${esc(d.ineligibleReason || "ruled out")}</div>`
            : ""
        }
        ${d.lostReason ? `<div class="s" style="margin-top:4px">${esc(d.lostReason)}</div>` : ""}</div>
      </div>
      <div class="dl-cell right">
        <span class="dl-k">Deal value</span>
        <span class="money">${value ? money(value) : "—"}</span>
      </div>
      <div class="dl-cell right">
        <span class="dl-k">Your cut</span>
        ${
          d.earnedKobo
            ? `<span class="money pos">${money(d.earnedKobo)}</span>`
            : `<span class="s">${esc(d.commissionPercent)}% when paid</span>`
        }
      </div>
    </div>`;
}

// A short preview of the ledger on the overview screen.
function renderRecent() {
  const won = data.deals.filter((d) => d.earnedKobo > 0).slice(0, 4);
  $("#recent").innerHTML = won.length
    ? `<div class="dl" style="--cols:2.4fr 1fr 1fr">
         <div class="dl-head"><span>Client</span><span>They paid</span>
           <span style="text-align:right">You earned</span></div>
         ${won
           .map(
             (d) => `<div class="dl-row">
               <div class="dl-cell primary">
                 <div class="t">${esc(d.clientName)}</div>
                 <div class="s ref">${esc(d.ref)}</div>
               </div>
               <div class="dl-cell"><span class="dl-k">Client paid</span>
                 <span class="money">${money(d.paidKobo)}</span></div>
               <div class="dl-cell right"><span class="dl-k">You earned</span>
                 <span class="money pos">${money(d.earnedKobo)}</span></div>
             </div>`
           )
           .join("")}
       </div>`
    : empty("clock", "Nothing earned yet", "Commission appears the moment a client you introduced makes a payment.");
}

// ---- wallet ----
async function loadWallet() {
  wallet = await GET("/api/scout/wallet");
  renderBalances(wallet.balances);

  const b = wallet.balances;
  $("#walletTiles").innerHTML = `
    <div class="tile"><div class="k">Available</div><div class="v jade">${money(b.available)}</div>
      <div class="n">ready to withdraw</div></div>
    <div class="tile"><div class="k">On hold</div><div class="v blue">${money(b.pending)}</div>
      <div class="n">clears ${wallet.settings.holdDays} days after payment</div></div>
    <div class="tile"><div class="k">Earned</div><div class="v">${money(b.lifetime)}</div>
      <div class="n">all time</div></div>
    <div class="tile"><div class="k">Withdrawn</div><div class="v">${money(b.withdrawn)}</div>
      <div class="n">${b.clawedBack ? money(b.clawedBack) + " clawed back" : "no clawbacks"}</div></div>`;

  const e = wallet.entries;
  $("#ledgerList").innerHTML = e.length
    ? `<div class="dl" style="--cols:2.6fr 1.2fr 1fr">
         <div class="dl-head"><span>Detail</span><span>Status</span><span style="text-align:right">Amount</span></div>
         ${e.map(ledgerRow).join("")}
       </div>`
    : empty("cash", "Your wallet is empty", "Commission shows up here as soon as a client you introduced pays.");

  const w = wallet.withdrawals;
  $("#withdrawalsList").innerHTML = w.length
    ? `<div class="dl" style="--cols:2fr 1.6fr 1.2fr 1fr">
         <div class="dl-head"><span>Requested</span><span>Account</span><span>Status</span><span style="text-align:right">Amount</span></div>
         ${w
           .map(
             (x) => `<div class="dl-row">
               <div class="dl-cell primary"><div class="t">${when(x.requested_at)}</div>
                 <div class="s">Withdrawal #${x.id}</div></div>
               <div class="dl-cell"><span class="dl-k">Account</span>
                 <div><div>${esc(x.bank_name || "—")}</div>
                 <div class="s mono">${esc(x.account_number || "")}</div></div></div>
               <div class="dl-cell"><span class="dl-k">Status</span>
                 <div>${pill(x.status)}${x.note ? `<div class="s" style="margin-top:4px">${esc(x.note)}</div>` : ""}</div></div>
               <div class="dl-cell right"><span class="dl-k">Amount</span>
                 <span class="money">${money(x.amount_kobo)}</span></div>
             </div>`
           )
           .join("")}
       </div>`
    : empty("out", "No withdrawals yet", "Once your balance clears its hold you can send it to your bank.");
}

function ledgerRow(e) {
  const held = e.available_at && new Date(e.available_at) > new Date();
  return `
    <div class="dl-row">
      <div class="dl-cell primary">
        <div class="t" style="font-weight:500">${esc(e.note || e.type)}</div>
        <div class="s">${e.deal_ref ? `<span class="ref">${esc(e.deal_ref)}</span> · ` : ""}${when(e.created_at)}</div>
      </div>
      <div class="dl-cell">
        <span class="dl-k">Status</span>
        <div>${held ? pill("held") : pill("cleared")}
        ${held ? `<div class="s" style="margin-top:4px">clears ${fromNow(e.available_at)}</div>` : ""}</div>
      </div>
      <div class="dl-cell right">
        <span class="dl-k">Amount</span>
        <span class="money ${e.amount_kobo < 0 ? "neg" : "pos"}">${e.amount_kobo > 0 ? "+" : ""}${money(e.amount_kobo)}</span>
      </div>
    </div>`;
}

// ---- withdraw ----
function openWithdraw() {
  const b = wallet?.balances || data.balances;
  const min = wallet?.settings.minWithdrawalKobo ?? data.settings.minWithdrawalKobo;

  if (!data.scout.bank.accountNumber) {
    toast("Add your payout account first.", true);
    return navigate("account", onView);
  }
  if (b.available < min) {
    return toast(
      b.available <= 0
        ? "Nothing available to withdraw yet."
        : `You need at least ${money(min)} available — you have ${money(b.available)}.`,
      true
    );
  }

  sheet({
    title: "Withdraw commission",
    sub: `Sent to ${esc(data.scout.bank.bankName)} · ${esc(data.scout.bank.accountNumber)}`,
    html: `
      <div class="field">
        <label for="wdAmount">Amount</label>
        <div class="naira"><input id="wdAmount" inputmode="decimal" value="${naira(b.available)}" /></div>
        <span class="help">${money(b.available)} available · minimum ${money(min)}</span>
      </div>`,
    confirmLabel: "Request withdrawal",
    onConfirm: async (root) => {
      const r = await POST("/api/scout/withdrawals", { amount: $("#wdAmount", root).value });
      data.balances = r.balances;
      renderBalances(r.balances);
      await loadWallet();
      toast("Withdrawal requested — we'll process it shortly.");
    },
  });
}

$("#withdrawBtn").onclick = openWithdraw;
$("#withdrawBtn2").onclick = openWithdraw;

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

// ---- sharing ----
$("#copyUrl").onclick = () => copy($("#inviteUrl").value, "Invite link copied");
$("#shareUrl").onclick = async () => {
  const url = $("#inviteUrl").value;
  const text = "Need a website or app built? Meji Builds does great work — start here:";
  if (navigator.share) {
    try {
      await navigator.share({ title: "Meji Builds", text, url });
      return;
    } catch {
      /* the user dismissed the share sheet */
    }
  }
  copy(`${text} ${url}`, "Invite message copied");
};

// ---- navigation ----
function onView(view) {
  if (view === "wallet") loadWallet().catch((e) => toast(e.message, true));
}
wireNav(onView);

const signOut = async () => {
  await POST("/api/auth/logout").catch(() => {});
  location.href = "/";
};
$("#logoutRail").onclick = signOut;
$("#logoutBar").onclick = signOut;

load();
