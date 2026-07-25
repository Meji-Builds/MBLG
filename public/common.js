// Shared browser helpers for every Meji Connect page.
// Plain ES modules-free script — loaded with a <script src> tag, no build step.

// ---- API ----
// Every endpoint answers { ok, ... } or { ok:false, error }. api() throws on
// failure so callers can just try/catch instead of checking a flag each time.
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok || !json || json.ok === false) {
    const err = new Error(json?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}
const GET = (p) => api("GET", p);
const POST = (p, b) => api("POST", p, b);

// ---- money ----
// Mirrors lib/money.js formatKobo so the same amount reads identically on the
// server (emails, system messages) and in the browser.
function money(kobo) {
  if (kobo === null || kobo === undefined) return "—";
  const neg = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const naira = Math.floor(abs / 100);
  const rem = abs % 100;
  const tail = rem === 0 ? "" : "." + String(rem).padStart(2, "0");
  return `${neg ? "-" : ""}₦${naira.toLocaleString("en-NG")}${tail}`;
}

// ---- dates ----
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" });
}
// "in 6 days" / "3 days ago" — used for hold countdowns.
function fromNow(iso) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.ceil(Math.abs(diff) / 86400000);
  if (Math.abs(diff) < 3600000) return diff > 0 ? "within the hour" : "just now";
  if (diff > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ---- dom ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Always use this for anything a user typed. Client names, company names and
// chat messages all reach the DOM, and none of them are trustworthy.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const STATUS_LABELS = {
  new: "New",
  in_discussion: "In discussion",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
  requested: "Requested",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  rejected: "Rejected",
  pending: "Pending",
  success: "Paid",
  refunded: "Refunded",
  active: "Active",
  suspended: "Suspended",
  held: "On hold",
};
const badge = (status) =>
  `<span class="badge ${esc(status)}">${esc(STATUS_LABELS[status] || status)}</span>`;

// ---- toast ----
let toastTimer;
function toast(msg, bad = false) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("bad", !!bad);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

// Wrap a click handler so the button disables while it runs. Stops the
// double-submit that would otherwise create two withdrawals or two payments.
function busy(btn, fn) {
  return async (...args) => {
    if (btn.disabled) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed — select and copy manually", true);
  }
}

// ---- modal ----
function modal({ title, sub, html, confirmLabel = "Confirm", onConfirm }) {
  let bg = $(".modal-bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.className = "modal-bg";
    document.body.appendChild(bg);
  }
  bg.innerHTML = `
    <div class="modal">
      <h3>${esc(title)}</h3>
      ${sub ? `<div class="sub">${sub}</div>` : ""}
      <div class="modal-body">${html || ""}</div>
      <div class="modal-actions">
        <button class="ghost" data-close>Cancel</button>
        <button data-confirm>${esc(confirmLabel)}</button>
      </div>
    </div>`;
  bg.classList.add("show");
  const close = () => bg.classList.remove("show");
  $("[data-close]", bg).onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };
  const confirmBtn = $("[data-confirm]", bg);
  confirmBtn.onclick = busy(confirmBtn, async () => {
    const ok = await onConfirm(bg);
    if (ok !== false) close();
  });
  const firstInput = $("input, textarea, select", bg);
  if (firstInput) firstInput.focus();
  return { close, root: bg };
}

// ---- chat rendering, shared by the client portal and the admin console ----
// `mine` names the sender_type that should appear on the right.
function renderThread(container, messages, mine) {
  container.innerHTML = messages
    .map((m) => {
      if (m.sender_type === "system")
        return `<div class="msg system"><div class="bubble">${esc(m.body)}</div></div>`;
      const isMine = m.sender_type === mine;
      return `<div class="msg ${isMine ? "mine" : ""}">
        <div class="who">${esc(m.sender_name || m.sender_type)} · ${when(m.created_at)}</div>
        <div class="bubble">${esc(m.body)}</div>
      </div>`;
    })
    .join("");
  container.scrollTop = container.scrollHeight;
}

// Poll a thread endpoint, appending only what's new. Serverless can't hold a
// WebSocket open, so this is how the chat stays live.
function pollThread({ container, url, mine, intervalMs = 4000 }) {
  let since = 0;
  let all = [];
  let stopped = false;

  async function tick() {
    if (stopped || document.hidden) return;
    try {
      const r = await GET(`${url}?since=${since}`);
      if (r.messages.length) {
        all = all.concat(r.messages);
        since = r.messages[r.messages.length - 1].id;
        renderThread(container, all, mine);
      }
    } catch {
      /* transient — the next tick retries */
    }
  }
  tick();
  const timer = setInterval(tick, intervalMs);
  // Catch up immediately when the user comes back to the tab.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
  return {
    refresh: tick,
    stop() { stopped = true; clearInterval(timer); },
    push(msg) { all.push(msg); since = msg.id; renderThread(container, all, mine); },
  };
}
