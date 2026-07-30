// Shared browser helpers for every Meji Connect page.
// Plain <script src> — no build step, no modules.

// ---- API ----
// Every endpoint answers { ok, ... } or { ok:false, error }. api() throws on
// failure so callers can try/catch instead of checking a flag each time.
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok || !json || json.ok === false) {
    // A 500 with no JSON almost always means the database isn't reachable.
    // Say that, rather than showing a bare status code.
    const fallback =
      res.status >= 500
        ? "The server hit an error. If you're running this locally, check DATABASE_URL in your .env."
        : `Request failed (${res.status})`;
    const err = new Error(json?.error || fallback);
    err.status = res.status;
    throw err;
  }
  return json;
}
const GET = (p) => api("GET", p);
const POST = (p, b) => api("POST", p, b);

// ---- money ----
// Mirrors lib/money.js formatKobo so an amount reads identically on the server
// (emails, system messages) and in the browser.
function money(kobo) {
  if (kobo === null || kobo === undefined) return "—";
  const neg = kobo < 0;
  const abs = Math.abs(Math.trunc(kobo));
  const naira = Math.floor(abs / 100);
  const rem = abs % 100;
  const tail = rem === 0 ? "" : "." + String(rem).padStart(2, "0");
  return `${neg ? "-" : ""}₦${naira.toLocaleString("en-NG")}${tail}`;
}
const naira = (kobo) => Math.floor(Math.abs(kobo || 0) / 100);

// ---- dates ----
function when(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "2-digit" });
}
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

// Use for anything a person typed. Client names, company names and chat
// messages all reach the DOM, and none of them are trustworthy.
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ---- icons ----
// Inline 24px stroke icons. Kept here so no page fetches an icon font, which
// would be blocked on a locked-down network anyway.
const ICONS = {
  link: '<path d="M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.8 1.7"/><path d="M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.8-1.7"/>',
  wallet: '<path d="M19 7V5a2 2 0 00-2-2H5a2 2 0 000 4h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5"/><circle cx="17" cy="12" r="1.2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 5.3a3.2 3.2 0 010 5.4M18 20a6.5 6.5 0 00-2.2-4.9"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0115 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004 15a2 2 0 010-4 1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0011 4.6a2 2 0 014 0 1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0020 11a2 2 0 010 4z"/>',
  out: '<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>',
  chat: '<path d="M21 12a8 8 0 01-11.4 7.2L3 21l1.8-6.6A8 8 0 1121 12z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L2 18.4A2 2 0 003.7 21.4h16.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  inbox: '<path d="M21 12h-5l-2 3h-4l-2-3H3"/><path d="M5.5 5h13l2.5 7v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6z"/>',
  send: '<path d="M21 3L3 10.5l7 3 3 7L21 3z"/>',
  back: '<path d="M15 19l-7-7 7-7"/>',
};
const icon = (n, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;

// Markup declares icons as <i data-icon="wallet"></i> and this swaps in the
// SVG once the page loads, keeping the HTML readable.
function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => {
    el.outerHTML = icon(el.dataset.icon);
  });
}
document.addEventListener("DOMContentLoaded", () => hydrateIcons());

// ---- status ----
const STATUS = {
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
  pending: "Awaiting confirmation",
  success: "Paid",
  refunded: "Refunded",
  active: "Active",
  suspended: "Suspended",
  held: "On hold",
  cleared: "Cleared",
  contested: "Contested",
};
const pill = (s, label) =>
  `<span class="pill ${esc(s)}">${esc(label || STATUS[s] || s)}</span>`;

// ---- toast ----
let toastTimer;
function toast(msg, bad = false) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("bad", !!bad);
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 4000);
}

// Disable a button while its handler runs, so a double-tap can't create two
// withdrawals or two payments.
function busy(btn, fn) {
  return async (...args) => {
    if (btn.disabled) return;
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = "Working…";
    try {
      return await fn(...args);
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  };
}

// Upgrades a genuinely relative path (e.g. "/r/CODE") to an absolute URL
// before it reaches navigator.share or an href.
//
// This does NOT catch a scheme-less domain like "site.app/r/CODE" — the URL
// parser can't tell that apart from an actual relative path, and resolves it
// against the current page exactly like a relative path would, silently
// producing "https://current-page.app/site.app/r/CODE". That was the real bug
// reported in production: PUBLIC_BASE_URL was set without "https://", and
// navigator.share's relative-URL resolution turned it into a doubled path.
// The only real fix for that shape is config.js's normalizeBaseUrl, which
// guarantees the server never emits a scheme-less URL in the first place.
// This helper stays as a safety net for the narrower, still-real case of an
// actually-relative path slipping through client-side.
function absolutize(url) {
  try {
    return new URL(url, location.origin).href;
  } catch {
    return url;
  }
}

async function copy(text, label = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Couldn't copy. Select the text and copy it manually.", true);
  }
}

// ---- dialog ----
// A centred sheet on desktop, a bottom sheet on phones. Escape and a click on
// the scrim both close it.
function sheet({ title, sub, html, confirmLabel = "Confirm", danger, onConfirm }) {
  let scrim = $(".scrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.className = "scrim";
    document.body.appendChild(scrim);
  }
  scrim.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      ${sub ? `<span class="sub">${sub}</span>` : ""}
      <div class="sheet-body">${html || ""}</div>
      <div class="sheet-actions">
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn ${danger ? "danger" : ""}" data-go>${esc(confirmLabel)}</button>
      </div>
    </div>`;
  scrim.classList.add("is-on");

  const close = () => {
    scrim.classList.remove("is-on");
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  $("[data-close]", scrim).onclick = close;
  scrim.onclick = (e) => { if (e.target === scrim) close(); };

  const go = $("[data-go]", scrim);
  go.onclick = busy(go, async () => {
    const ok = await onConfirm(scrim);
    if (ok !== false) close();
  });

  const first = $("input, textarea, select", scrim);
  if (first) setTimeout(() => first.focus(), 60);
  return { close, root: scrim };
}

// ---- empty state ----
const empty = (ico, title, body) => `
  <div class="empty">
    <div class="ico">${icon(ico)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(body)}</p>
  </div>`;

const skeleton = (n = 3) =>
  Array.from({ length: n }, () => `<div class="skel skel-row"></div>`).join("");

// ---- navigation shared by the rail and the mobile tab bar ----
// Both controls drive the same view, so they can never disagree about which
// one is active.
function navigate(view, onChange) {
  $$("[data-view]").forEach((b) => b.classList.toggle("is-on", b.dataset.view === view));
  $$("[data-panel]").forEach((s) => s.classList.toggle("hidden", s.dataset.panel !== view));
  window.scrollTo({ top: 0 });
  if (onChange) onChange(view);
}
function wireNav(onChange) {
  $$("[data-view]").forEach((b) => (b.onclick = () => navigate(b.dataset.view, onChange)));
}

// ---- chat ----
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

// Poll for new messages, appending only what's new. Serverless functions can't
// hold a WebSocket open, so this is how the thread stays live.
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
  const onVis = () => { if (!document.hidden) tick(); };
  document.addEventListener("visibilitychange", onVis);

  return {
    refresh: tick,
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    },
    push(msg) { all.push(msg); since = msg.id; renderThread(container, all, mine); },
  };
}

// Enter sends, Shift+Enter makes a new line, and the box grows with the text.
function wireComposer(textarea, send) {
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  textarea.addEventListener("input", () => {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + "px";
  });
}
