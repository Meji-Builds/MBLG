#!/usr/bin/env node
// Builds a single self-contained HTML prototype of every Meji Connect screen.
//
// It inlines public/styles.css verbatim, so the prototype can never drift from
// what the real app looks like — change the stylesheet and rebuild. All data is
// mocked in the page, so it needs no server, no database and no network.
//
//   node scripts/build-prototype.js [outfile]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
const out = process.argv[2] || path.join(ROOT, "prototype.html");

const shell = `<title>Meji Connect — interactive prototype</title>
<style>
${css}

/* ── prototype-only chrome ──────────────────────────────────────────────── */
/* The switcher is sticky rather than fixed, and the app's own bars keep their
   normal top:0. Offsetting both (body padding AND a sticky top) double-counts
   the height and drops the bar onto the content underneath it. */
.proto-bar {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 9px 16px;
  background: #05090B;
  border-bottom: 1px solid var(--line);
}
.proto-bar .tag {
  font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.12em;
  color: var(--muted); font-weight: 700; white-space: nowrap;
}
.proto-bar .seg { border-color: var(--line); background: var(--surface); }
/* The rail is fixed to the viewport, so it alone needs to clear the switcher. */
.rail { top: 51px; height: calc(100vh - 51px); }
@media (max-width: 900px) { .rail { top: 0; height: auto; } }
@media (max-width: 640px) {
  .proto-bar { padding: 7px 8px; gap: 8px; }
  .proto-bar .tag { display: none; }
  .proto-bar .seg button { padding: 7px 11px; font-size: 0.76rem; }
}
.screen { display: none; }
.screen.is-on { display: block; }
</style>`;

const body = String.raw`
<div class="proto-bar">
  <span class="tag">Prototype</span>
  <div class="seg" id="personas">
    <button class="is-on" data-screen="landing">Landing</button>
    <button data-screen="invite">Invite</button>
    <button data-screen="client">Client</button>
    <button data-screen="scout">Scout</button>
    <button data-screen="studio">Studio</button>
  </div>
</div>

<!-- ══════════════ LANDING ══════════════ -->
<div class="screen is-on" data-screen="landing">
  <header class="topbar">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Connect<small>by Meji Builds</small></span></div>
    <button class="btn quiet sm" data-goto="studio">Studio sign-in</button>
  </header>
  <main class="main bare"><div class="page">
    <div class="split">
      <div>
        <section class="hero">
          <span class="eyebrow">Referral programme</span>
          <h1>Know someone who needs <span class="gold">building</span>?</h1>
          <p class="lead">Introduce them to Meji Builds. When their project closes, you earn
            <strong>10%</strong> of everything they pay — tracked here from the first hello
            to the money landing in your account.</p>
        </section>
        <div class="steps">
          <div class="step"><span class="n">STEP 01</span><h3>Get your link</h3>
            <p>Sign up and you're handed a personal invite link straight away.</p></div>
          <div class="step"><span class="n">STEP 02</span><h3>Share it</h3>
            <p>Send it to anyone who needs a website, app or brand built.</p></div>
          <div class="step"><span class="n">STEP 03</span><h3>We take over</h3>
            <p>They brief us directly and we handle the pitch and the pricing.</p></div>
          <div class="step"><span class="n">STEP 04</span><h3>Get paid</h3>
            <p>Your share lands as they pay, and withdraws after a 10-day hold.</p></div>
        </div>
        <div class="notice info" style="margin-top:20px">
          <span class="ico" data-ico="check"></span>
          <div>Free to join, and nothing to chase. You only earn when a project you
          introduced is actually paid for.</div>
        </div>
      </div>
      <div class="card">
        <div class="linktabs">
          <button class="is-on" data-ltab="signup">Become a Scout</button>
          <button data-ltab="login">Sign in</button>
        </div>
        <form class="form-grid" data-lpane="signup" onsubmit="return proto.go('scout',event)">
          <div class="field"><label>Full name</label><input value="Ada Okeke" /></div>
          <div class="field"><label>Email</label><input type="email" value="ada@example.com" /></div>
          <div class="field"><label>Phone <span class="help" style="display:inline">(optional)</span></label>
            <input value="0801 234 5678" /></div>
          <div class="field"><label>Password</label><input type="password" value="supersecret" /></div>
          <button class="btn lg full" type="submit">Create my account</button>
        </form>
        <form class="form-grid hidden" data-lpane="login" onsubmit="return proto.go('scout',event)">
          <div class="field"><label>Email</label><input type="email" value="ada@example.com" /></div>
          <div class="field"><label>Password</label><input type="password" value="supersecret" /></div>
          <button class="btn lg full" type="submit">Sign in</button>
        </form>
      </div>
    </div>
  </div></main>
</div>

<!-- ══════════════ INVITE ══════════════ -->
<div class="screen" data-screen="invite">
  <header class="topbar">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Builds<small>Design &amp; development studio</small></span></div>
  </header>
  <main class="main bare"><div class="page mid">
    <div class="page-head"><div>
      <span class="eyebrow">Invitation</span>
      <h1 style="margin-top:6px">Let's build it.</h1>
      <p class="lead"><strong>Ada Okeke</strong> pointed you our way. Tell us what you need and
      we'll come back with a plan and a price — usually same day.</p>
    </div></div>
    <form class="card" onsubmit="return proto.go('client',event)">
      <div class="form-grid two">
        <div class="field"><label>Your name *</label><input value="Grace Umeh" required /></div>
        <div class="field"><label>Company</label><input value="Umeh Interiors" /></div>
        <div class="field"><label>Email *</label><input type="email" value="grace@umeh.com" required /></div>
        <div class="field"><label>Phone</label><input value="0809 999 8888" /></div>
        <div class="field"><label>What do you need?</label>
          <select><option>Website</option><option>Web app</option><option>Mobile app</option>
            <option>Branding &amp; design</option><option>E-commerce</option></select></div>
        <div class="field"><label>How soon?</label>
          <select><option>As soon as possible</option><option>Within a month</option>
            <option>1–3 months</option></select></div>
        <div class="field span-2"><label>Rough budget</label>
          <select><option>₦1,000,000 – ₦3,000,000</option><option>Prefer to discuss</option></select>
          <span class="help">A range is fine — it just helps us scope sensibly.</span></div>
        <div class="field span-2"><label>Tell us about the project *</label>
          <textarea required>We need a portfolio site with an enquiry form and a simple CMS so the team can post projects themselves.</textarea></div>
        <div class="span-2">
          <button class="btn lg full" type="submit">Start my project</button>
          <p class="hint" style="margin-top:12px;text-align:center">
            You'll get a private link to chat with us directly. No account, no password.</p>
        </div>
      </div>
    </form>
  </div></main>
</div>

<!-- ══════════════ CLIENT ══════════════ -->
<div class="screen" data-screen="client">
  <header class="topbar">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Builds<small>Grace Umeh</small></span></div>
    <button class="btn quiet sm" data-goto="landing">Sign out</button>
  </header>
  <main class="main bare"><div class="page mid"><div class="stack">
    <div id="clientOffer"></div>
    <div class="card">
      <div class="card-head"><h2>Conversation with Meji Builds</h2>
        <span class="sub">Usually replies same day</span></div>
      <div class="thread" id="clientThread"></div>
      <div class="composer">
        <textarea id="clientBox" rows="1" placeholder="Write a message…"></textarea>
        <button class="btn icon" id="clientSend" aria-label="Send"><i data-ico="send"></i></button>
      </div>
    </div>
  </div></div></main>
</div>

<!-- ══════════════ SCOUT ══════════════ -->
<div class="screen" data-screen="scout">
  <nav class="rail">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Connect<small>Ada Okeke</small></span></div>
    <button data-sview="home" class="is-on"><i data-ico="wallet"></i> Overview</button>
    <button data-sview="referrals"><i data-ico="list"></i> Referrals</button>
    <button data-sview="wallet"><i data-ico="cash"></i> Wallet</button>
    <button data-sview="account"><i data-ico="user"></i> Account</button>
    <span class="spacer"></span>
    <button data-goto="landing"><i data-ico="out"></i> Sign out</button>
  </nav>
  <header class="mobilebar">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Connect<small>Ada Okeke</small></span></div>
    <button class="btn quiet sm" data-goto="landing">Sign out</button>
  </header>
  <main class="main"><div class="page">

    <section data-spanel="home" class="stack">
      <div class="balance">
        <div class="eyebrow">Available to withdraw</div>
        <div class="amount" id="sAvail">₦40,000</div>
        <div class="balance-actions">
          <button class="btn" id="sWithdraw">Withdraw</button>
          <button class="btn ghost" data-sview="referrals">View referrals</button>
        </div>
        <div class="balance-split">
          <div><div class="k">On hold · 10 days</div><div class="v hold">₦250,000</div></div>
          <div><div class="k">Earned all time</div><div class="v life">₦330,000</div></div>
        </div>
      </div>
      <div class="invite">
        <div class="eyebrow">Your invite code</div>
        <strong class="invite-code">MC-AD4K2P</strong>
        <div class="copyrow">
          <input value="https://connect.mejibuilds.com/r/MC-AD4K2P" readonly />
          <button class="btn" data-copy>Copy link</button>
          <button class="btn ghost" data-copy>Share</button>
        </div>
        <p class="hint" style="margin-top:12px">Anyone who starts a project through this link
          is tracked to you automatically.</p>
      </div>
      <div class="tiles">
        <div class="tile"><div class="k">Referrals</div><div class="v">3</div><div class="n">1 still open</div></div>
        <div class="tile"><div class="k">Won</div><div class="v jade">2</div><div class="n">0 didn't go ahead</div></div>
        <div class="tile"><div class="k">Withdrawn</div><div class="v">₦40,000</div><div class="n">paid to your bank</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Recent activity</h2>
          <button class="btn quiet sm" data-sview="wallet">Full wallet</button></div>
        <div class="dl" style="--cols:2.4fr 1fr 1fr">
          <div class="dl-head"><span>Client</span><span>They paid</span>
            <span style="text-align:right">You earned</span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Ngozi Eze</div><div class="s ref">PJ-DEMO2</div></div>
            <div class="dl-cell"><span class="dl-k">They paid</span><span class="money">₦2,500,000</span></div>
            <div class="dl-cell right"><span class="dl-k">You earned</span><span class="money pos">₦250,000</span></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Bola Adewale</div><div class="s ref">PJ-DEMO1</div></div>
            <div class="dl-cell"><span class="dl-k">They paid</span><span class="money">₦800,000</span></div>
            <div class="dl-cell right"><span class="dl-k">You earned</span><span class="money pos">₦80,000</span></div>
          </div>
        </div>
      </div>
    </section>

    <section data-spanel="referrals" class="hidden">
      <div class="page-head">
        <div><h1>Your referrals</h1><p class="lead">Every project that started from your link.</p></div>
        <span class="pill active">10% commission</span>
      </div>
      <div class="card" style="padding:6px 5px">
        <div class="dl" style="--cols:2fr 2.2fr 1.1fr 1fr 1fr">
          <div class="dl-head"><span>Client</span><span>Project</span><span>Status</span>
            <span style="text-align:right">Deal value</span><span style="text-align:right">Your cut</span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Ngozi Eze</div><div class="s">Eze Foods</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>E-commerce store</div>
              <div class="s ref">PJ-DEMO2 · 1 Jul 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill won">Won</span></div>
            <div class="dl-cell right"><span class="dl-k">Deal value</span><span class="money">₦2,500,000</span></div>
            <div class="dl-cell right"><span class="dl-k">Your cut</span><span class="money pos">₦250,000</span></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Bola Adewale</div><div class="s">Bola Ventures</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>Web app — booking platform</div>
              <div class="s ref">PJ-DEMO1 · 28 Jun 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill won">Won</span></div>
            <div class="dl-cell right"><span class="dl-k">Deal value</span><span class="money">₦1,000,000</span></div>
            <div class="dl-cell right"><span class="dl-k">Your cut</span><span class="money pos">₦80,000</span></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Kunle Ade</div><div class="s">Adex Logistics</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>Website redesign</div>
              <div class="s ref">PJ-DEMO3 · 4 Jul 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill quoted">Quoted</span></div>
            <div class="dl-cell right"><span class="dl-k">Deal value</span><span class="money">₦600,000</span></div>
            <div class="dl-cell right"><span class="dl-k">Your cut</span><span class="s">10% when paid</span></div>
          </div>
        </div>
      </div>
    </section>

    <section data-spanel="wallet" class="hidden">
      <div class="page-head">
        <div><h1>Wallet</h1><p class="lead">Every naira in and out, and when it clears.</p></div>
        <button class="btn" id="sWithdraw2">Withdraw</button>
      </div>
      <div class="tiles" style="margin-bottom:16px">
        <div class="tile"><div class="k">Available</div><div class="v jade">₦40,000</div><div class="n">ready to withdraw</div></div>
        <div class="tile"><div class="k">On hold</div><div class="v blue">₦250,000</div><div class="n">clears 10 days after payment</div></div>
        <div class="tile"><div class="k">Earned</div><div class="v">₦330,000</div><div class="n">all time</div></div>
        <div class="tile"><div class="k">Withdrawn</div><div class="v">₦40,000</div><div class="n">no clawbacks</div></div>
      </div>
      <div class="card" style="padding:6px 5px">
        <div class="dl" style="--cols:2.6fr 1.2fr 1fr">
          <div class="dl-head"><span>Detail</span><span>Status</span><span style="text-align:right">Amount</span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t" style="font-weight:500">Withdrawal #1</div>
              <div class="s">Today</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill cleared">Cleared</span></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span><span class="money neg">-₦40,000</span></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t" style="font-weight:500">Commission on PJ-DEMO2</div>
              <div class="s"><span class="ref">PJ-DEMO2</span> · E-commerce store</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span>
              <div><span class="pill held">On hold</span><div class="s" style="margin-top:4px">clears in 8 days</div></div></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span><span class="money pos">+₦250,000</span></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t" style="font-weight:500">Commission on PJ-DEMO1</div>
              <div class="s"><span class="ref">PJ-DEMO1</span> · Web app — booking platform</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill cleared">Cleared</span></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span><span class="money pos">+₦80,000</span></div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Withdrawals</h2></div>
        <div class="dl" style="--cols:2fr 1.6fr 1.2fr 1fr">
          <div class="dl-head"><span>Requested</span><span>Account</span><span>Status</span>
            <span style="text-align:right">Amount</span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Today</div><div class="s">Withdrawal #1</div></div>
            <div class="dl-cell"><span class="dl-k">Account</span><div><div>GTBank</div>
              <div class="s mono">0123456789</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill requested">Requested</span></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span><span class="money">₦40,000</span></div>
          </div>
        </div>
      </div>
    </section>

    <section data-spanel="account" class="hidden">
      <div class="page-head"><div><h1>Account</h1>
        <p class="lead">Where your commission gets sent.</p></div></div>
      <div class="card">
        <div class="card-head"><h2>Payout account</h2></div>
        <form class="form-grid two" onsubmit="return proto.saved(event)">
          <div class="field"><label>Bank</label><input value="GTBank" /></div>
          <div class="field"><label>Bank code</label><input class="mono" value="058" />
            <span class="help">Optional — speeds up automatic transfers.</span></div>
          <div class="field"><label>Account number</label><input class="mono" value="0123456789" /></div>
          <div class="field"><label>Account name</label><input value="Ada Okeke" />
            <span class="help">Must match the account exactly, or the bank rejects it.</span></div>
          <div class="span-2"><button class="btn" type="submit">Save payout account</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>How you get paid</h2></div>
        <div class="kv">
          <div><span class="k">Your rate</span><span class="v strong">10% of what the client pays</span></div>
          <div><span class="k">When it's earned</span><span class="v">Each time a client you introduced actually pays</span></div>
          <div><span class="k">Hold period</span><span class="v">10 days from the client's payment</span></div>
          <div><span class="k">Minimum withdrawal</span><span class="v money">₦5,000</span></div>
        </div>
      </div>
    </section>
  </div></main>
  <nav class="tabbar">
    <button data-sview="home" class="is-on"><i data-ico="wallet"></i><span>Overview</span></button>
    <button data-sview="referrals"><i data-ico="list"></i><span>Referrals</span></button>
    <button data-sview="wallet"><i data-ico="cash"></i><span>Wallet</span></button>
    <button data-sview="account"><i data-ico="user"></i><span>Account</span></button>
  </nav>
</div>

<!-- ══════════════ STUDIO ══════════════ -->
<div class="screen" data-screen="studio">
  <nav class="rail">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Meji Connect<small>Studio console</small></span></div>
    <button data-aview="pipeline" class="is-on"><i data-ico="inbox"></i> Pipeline</button>
    <button data-aview="payouts"><i data-ico="cash"></i> Payouts</button>
    <button data-aview="scouts"><i data-ico="people"></i> Scouts</button>
    <button data-aview="settings"><i data-ico="cog"></i> Settings</button>
    <span class="spacer"></span>
    <button data-goto="landing"><i data-ico="out"></i> Sign out</button>
  </nav>
  <header class="mobilebar">
    <div class="brand"><span class="mark">M</span>
      <span class="name">Studio console<small id="aCrumb">Pipeline</small></span></div>
    <button class="btn quiet sm" data-goto="landing">Sign out</button>
  </header>
  <main class="main"><div class="page">
    <div class="tiles" id="aOverview" style="margin-bottom:22px">
      <div class="tile"><div class="k">Open deals</div><div class="v">3</div><div class="n">3 won · 1 lost</div></div>
      <div class="tile"><div class="k">Collected</div><div class="v jade">₦6,500,000</div><div class="n">nothing pending</div></div>
      <div class="tile"><div class="k">Commission owed</div><div class="v gold">₦805,000</div><div class="n">₦40,000 already paid</div></div>
      <div class="tile"><div class="k">Payout requests</div><div class="v blue">1</div><div class="n">2 active Scouts</div></div>
    </div>

    <section data-apanel="pipeline">
      <div class="page-head"><div><h1>Pipeline</h1>
        <p class="lead">Every project, newest activity first.</p></div></div>
      <div class="seg" style="margin-bottom:16px" id="aFilter">
        <button class="is-on">All</button><button>New</button><button>In discussion</button>
        <button>Quoted</button><button>Won</button><button>Lost</button>
      </div>
      <div class="card" style="padding:6px 5px">
        <div class="dl" style="--cols:2fr 2.2fr 1.4fr 1.1fr 1fr">
          <div class="dl-head"><span>Client</span><span>Project</span><span>Scout</span>
            <span>Status</span><span style="text-align:right">Value</span></div>
          <div class="dl-row tap" id="openDeal">
            <div class="dl-cell primary"><div class="t">Grace Umeh
              <span class="pill in_discussion" style="margin-left:6px">2 new</span></div>
              <div class="s">Umeh Interiors</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>Website</div>
              <div class="s ref">PJ-YD3M89 · Today</div></div></div>
            <div class="dl-cell"><span class="dl-k">Scout</span><div>Ada Okeke</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill in_discussion">In discussion</span></div>
            <div class="dl-cell right"><span class="dl-k">Value</span><span class="money">—</span></div>
          </div>
          <div class="dl-row tap">
            <div class="dl-cell primary"><div class="t">Femi Cole</div><div class="s">Cole &amp; Sons</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>Mobile app</div>
              <div class="s ref">PJ-DEMO4 · 20 Jun 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Scout</span><div>Tunde Bakare</div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill won">Won</span></div>
            <div class="dl-cell right"><span class="dl-k">Value</span><div><span class="money">₦4,000,000</span>
              <div class="s money pos">₦3,200,000 paid</div></div></div>
          </div>
          <div class="dl-row tap">
            <div class="dl-cell primary"><div class="t">Ngozi Eze</div><div class="s">Eze Foods</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>E-commerce store</div>
              <div class="s ref">PJ-DEMO2 · 1 Jul 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Scout</span>
              <div>Ada Okeke<div>${""}</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill won">Won</span></div>
            <div class="dl-cell right"><span class="dl-k">Value</span><div><span class="money">₦2,500,000</span>
              <div class="s money pos">₦2,500,000 paid</div></div></div>
          </div>
          <div class="dl-row tap">
            <div class="dl-cell primary"><div class="t">Zainab Bello</div><div class="s">Bello Studios</div></div>
            <div class="dl-cell"><span class="dl-k">Project</span><div><div>Branding &amp; design</div>
              <div class="s ref">PJ-DEMO5 · 12 Jun 26</div></div></div>
            <div class="dl-cell"><span class="dl-k">Scout</span>
              <div>Tunde Bakare<div style="margin-top:4px"><span class="pill contested">Contested</span></div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill lost">Lost</span></div>
            <div class="dl-cell right"><span class="dl-k">Value</span><span class="money">₦350,000</span></div>
          </div>
        </div>
      </div>
    </section>

    <section data-apanel="deal" class="hidden">
      <button class="btn quiet sm" data-aview="pipeline" style="margin-bottom:16px">
        <i data-ico="back"></i> Pipeline</button>
      <div class="page-head">
        <div><h1>Grace Umeh</h1>
          <p class="lead">Website — Umeh Interiors · <span class="ref">PJ-YD3M89</span></p></div>
        <span class="pill in_discussion">In discussion</span>
      </div>
      <div class="grid-2 wide-first">
        <div class="stack">
          <div class="card">
            <div class="card-head"><h2>Money</h2></div>
            <div class="tiles" style="grid-template-columns:1fr 1fr">
              <div class="tile"><div class="k">Agreed</div><div class="v">—</div>
                <div class="n">no quote sent yet</div></div>
              <div class="tile"><div class="k">Collected</div><div class="v jade">₦0</div>
                <div class="n">₦0 outstanding</div></div>
            </div>
            <div class="kv" style="margin-top:14px">
              <div><span class="k">Referred by</span><span class="v">Ada Okeke <span class="ref">MC-AD4K2P</span></span></div>
              <div><span class="k">Commission at 10%</span><span class="v money">—</span></div>
              <div><span class="k">Contact</span><span class="v">grace@umeh.com<br /><span class="mono">08099998888</span></span></div>
              <div><span class="k">Budget hint</span><span class="v">₦1,000,000 – ₦3,000,000</span></div>
              <div><span class="k">Timeline</span><span class="v">As soon as possible</span></div>
            </div>
            <div class="btn-row" style="margin-top:18px">
              <button class="btn" id="aQuote">Send quote</button>
              <button class="btn ghost">Mark won</button>
              <button class="btn danger">Mark lost</button>
              <button class="btn quiet">Remove commission</button>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Brief</h2></div>
            <p style="margin:0;white-space:pre-wrap">We need a portfolio site with an enquiry form and a simple CMS so the team can post projects themselves.</p>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Conversation</h2></div>
          <div class="thread" id="aThread"></div>
          <div class="composer">
            <textarea id="aBox" rows="1" placeholder="Reply to Grace Umeh…"></textarea>
            <button class="btn icon" id="aSend" aria-label="Send"><i data-ico="send"></i></button>
          </div>
        </div>
      </div>
    </section>

    <section data-apanel="payouts" class="hidden">
      <div class="page-head"><div><h1>Payouts</h1>
        <p class="lead">Scouts waiting to be paid. Approve, then send the transfer.</p></div></div>
      <div class="card" style="padding:6px 5px">
        <div class="dl" style="--cols:1.6fr 1.8fr 1.2fr 1fr 1.4fr">
          <div class="dl-head"><span>Scout</span><span>Account</span><span>Status</span>
            <span style="text-align:right">Amount</span><span></span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Ada Okeke</div>
              <div class="s ref">MC-AD4K2P · Today</div></div>
            <div class="dl-cell"><span class="dl-k">Account</span><div><div>GTBank</div>
              <div class="s mono">0123456789 · Ada Okeke</div></div></div>
            <div class="dl-cell"><span class="dl-k">Status</span><span class="pill requested">Requested</span></div>
            <div class="dl-cell right"><span class="dl-k">Amount</span><span class="money">₦40,000</span></div>
            <div class="dl-cell actions">
              <button class="btn sm" id="aPayout">Mark paid</button>
              <button class="btn sm danger">Reject</button></div>
          </div>
        </div>
      </div>
    </section>

    <section data-apanel="scouts" class="hidden">
      <div class="page-head"><div><h1>Scouts</h1>
        <p class="lead">Rates, status and lifetime earnings.</p></div></div>
      <div class="card" style="padding:6px 5px">
        <div class="dl" style="--cols:1.9fr 1fr 1.2fr 1.1fr 1fr 1.3fr">
          <div class="dl-head"><span>Scout</span><span>Rate</span><span>Deals</span>
            <span style="text-align:right">Earned</span><span style="text-align:right">Available</span><span></span></div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Ada Okeke</div>
              <div class="s">ada@example.com · <span class="ref">MC-AD4K2P</span></div></div>
            <div class="dl-cell"><span class="dl-k">Rate</span><span class="mono">10%</span></div>
            <div class="dl-cell"><span class="dl-k">Deals</span><span>3 <span class="s">(2 won)</span></span></div>
            <div class="dl-cell right"><span class="dl-k">Earned</span><span class="money">₦330,000</span></div>
            <div class="dl-cell right"><span class="dl-k">Available</span><span class="money">₦40,000</span></div>
            <div class="dl-cell actions"><button class="btn sm ghost" id="aEditScout">Edit</button>
              <button class="btn sm quiet">Adjust</button></div>
          </div>
          <div class="dl-row">
            <div class="dl-cell primary"><div class="t">Tunde Bakare</div>
              <div class="s">tunde@example.com · <span class="ref">MC-TB7M9X</span></div></div>
            <div class="dl-cell"><span class="dl-k">Rate</span><span class="mono">20%</span></div>
            <div class="dl-cell"><span class="dl-k">Deals</span><span>3 <span class="s">(1 won)</span></span></div>
            <div class="dl-cell right"><span class="dl-k">Earned</span><span class="money">₦640,000</span></div>
            <div class="dl-cell right"><span class="dl-k">Available</span><span class="money">₦0</span></div>
            <div class="dl-cell actions"><button class="btn sm ghost">Edit</button>
              <button class="btn sm quiet">Adjust</button></div>
          </div>
        </div>
      </div>
    </section>

    <section data-apanel="settings" class="hidden">
      <div class="page-head"><div><h1>Settings</h1>
        <p class="lead">Changes apply to new deals and new commission — never retroactively.</p></div></div>
      <div class="card">
        <div class="card-head"><h2>Commission &amp; payouts</h2></div>
        <form class="form-grid two" onsubmit="return proto.saved(event)">
          <div class="field"><label>Default commission</label><input class="mono" value="10" />
            <span class="help">Percent. New Scouts only — existing deals keep their rate.</span></div>
          <div class="field"><label>Upfront deposit</label><input class="mono" value="80" />
            <span class="help">Percent a client pays to start.</span></div>
          <div class="field"><label>Hold period</label><input class="mono" value="10" />
            <span class="help">Days commission is locked after a client pays.</span></div>
          <div class="field"><label>Minimum withdrawal</label>
            <div class="naira"><input value="5000" /></div></div>
          <div class="field span-2"><label>Attribution window</label><input class="mono" value="365" />
            <span class="help">Days a Scout keeps earning on repeat projects from a client they introduced.</span></div>
          <div class="span-2"><button class="btn" type="submit">Save settings</button></div>
        </form>
      </div>
      <div class="card">
        <div class="card-head"><h2>Where clients send money</h2></div>
        <p class="hint" style="margin-bottom:16px">Shown to clients paying by bank transfer.</p>
        <form class="form-grid two" onsubmit="return proto.saved(event)">
          <div class="field"><label>Bank</label><input value="GTBank" /></div>
          <div class="field"><label>Account number</label><input class="mono" value="0123456789" /></div>
          <div class="field span-2"><label>Account name</label><input value="Meji Builds Ltd" /></div>
          <div class="span-2"><button class="btn" type="submit">Save account</button></div>
        </form>
      </div>
    </section>
  </div></main>
  <nav class="tabbar">
    <button data-aview="pipeline" class="is-on"><i data-ico="inbox"></i><span>Pipeline</span></button>
    <button data-aview="payouts"><i data-ico="cash"></i><span>Payouts</span></button>
    <button data-aview="scouts"><i data-ico="people"></i><span>Scouts</span></button>
    <button data-aview="settings"><i data-ico="cog"></i><span>Settings</span></button>
  </nav>
</div>
`;

// The prototype's own behaviour. Deliberately small: enough interaction to
// judge the flow and the layout, with no server behind it.
const script = String.raw`
const ICONS = {
  wallet:'<path d="M19 7V5a2 2 0 00-2-2H5a2 2 0 000 4h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5"/><circle cx="17" cy="12" r="1.2"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  cash:'<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/>',
  user:'<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0115 0"/>',
  people:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 5.3a3.2 3.2 0 010 5.4M18 20a6.5 6.5 0 00-2.2-4.9"/>',
  cog:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004 15a2 2 0 010-4 1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0011 4.6a2 2 0 014 0 1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0020 11a2 2 0 010 4z"/>',
  out:'<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 20H6a2 2 0 01-2-2V6a2 2 0 012-2h6"/>',
  inbox:'<path d="M21 12h-5l-2 3h-4l-2-3H3"/><path d="M5.5 5h13l2.5 7v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6z"/>',
  send:'<path d="M21 3L3 10.5l7 3 3 7L21 3z"/>',
  back:'<path d="M15 19l-7-7 7-7"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
};
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const svg=n=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[n]||'')+'</svg>';
$$('[data-ico]').forEach(el=>el.outerHTML=svg(el.dataset.ico));

let toastTimer;
function toast(m){
  let t=$('.toast');
  if(!t){t=document.createElement('div');t.className='toast';t.setAttribute('role','status');document.body.appendChild(t);}
  t.textContent=m;t.classList.add('is-on');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('is-on'),3200);
}
function sheet({title,sub,html,confirmLabel='Confirm',danger,onConfirm}){
  let sc=$('.scrim');
  if(!sc){sc=document.createElement('div');sc.className='scrim';document.body.appendChild(sc);}
  sc.innerHTML='<div class="sheet" role="dialog" aria-modal="true"><h3>'+esc(title)+'</h3>'+
    (sub?'<span class="sub">'+sub+'</span>':'')+'<div class="sheet-body">'+(html||'')+'</div>'+
    '<div class="sheet-actions"><button class="btn ghost" data-close>Cancel</button>'+
    '<button class="btn '+(danger?'danger':'')+'" data-go>'+esc(confirmLabel)+'</button></div></div>';
  sc.classList.add('is-on');
  const close=()=>{sc.classList.remove('is-on');document.removeEventListener('keydown',key);};
  const key=e=>{if(e.key==='Escape')close();};
  document.addEventListener('keydown',key);
  $('[data-close]',sc).onclick=close;
  sc.onclick=e=>{if(e.target===sc)close();};
  $('[data-go]',sc).onclick=()=>{if(onConfirm)onConfirm(sc);close();};
  const f=$('input,textarea,select',sc); if(f)setTimeout(()=>f.focus(),60);
}

// ---- screens ----
function screen(name){
  $$('.screen').forEach(s=>s.classList.toggle('is-on',s.dataset.screen===name));
  $$('#personas button').forEach(b=>b.classList.toggle('is-on',b.dataset.screen===name));
  window.scrollTo({top:0});
}
$$('#personas button').forEach(b=>b.onclick=()=>screen(b.dataset.screen));
$$('[data-goto]').forEach(b=>b.onclick=()=>screen(b.dataset.goto));

const proto={
  go(name,e){ if(e)e.preventDefault(); screen(name); return false; },
  saved(e){ e.preventDefault(); toast('Saved.'); return false; },
};

// landing tabs
$$('[data-ltab]').forEach(b=>b.onclick=()=>{
  $$('[data-ltab]').forEach(x=>x.classList.toggle('is-on',x===b));
  $$('[data-lpane]').forEach(p=>p.classList.toggle('hidden',p.dataset.lpane!==b.dataset.ltab));
});

// scout + studio nav (rail and tab bar share the same handler)
function panelNav(viewAttr,panelAttr,after){
  $$('['+viewAttr+']').forEach(b=>b.onclick=()=>{
    const v=b.getAttribute(viewAttr);
    $$('['+viewAttr+']').forEach(x=>x.classList.toggle('is-on',x.getAttribute(viewAttr)===v));
    $$('['+panelAttr+']').forEach(p=>p.classList.toggle('hidden',p.getAttribute(panelAttr)!==v));
    window.scrollTo({top:0});
    if(after)after(v);
  });
}
panelNav('data-sview','data-spanel');
panelNav('data-aview','data-apanel',v=>{
  $('#aCrumb').textContent={pipeline:'Pipeline',deal:'Deal',payouts:'Payouts',scouts:'Scouts',settings:'Settings'}[v]||'';
  $('#aOverview').classList.toggle('hidden',v==='deal');
});

$$('#aFilter button').forEach(b=>b.onclick=()=>
  $$('#aFilter button').forEach(x=>x.classList.toggle('is-on',x===b)));

$$('[data-copy]').forEach(b=>b.onclick=()=>toast('Invite link copied'));

// ---- withdraw ----
const withdraw=()=>sheet({
  title:'Withdraw commission',
  sub:'Sent to GTBank · 0123456789',
  html:'<div class="field"><label>Amount</label><div class="naira"><input value="40000" /></div>'+
       '<span class="help">₦40,000 available · minimum ₦5,000</span></div>',
  confirmLabel:'Request withdrawal',
  onConfirm:()=>toast("Withdrawal requested — we'll process it shortly."),
});
$('#sWithdraw').onclick=withdraw; $('#sWithdraw2').onclick=withdraw;

// ---- studio: open a deal, send a quote ----
$('#openDeal').onclick=()=>{
  $$('[data-aview]').forEach(x=>x.classList.remove('is-on'));
  $$('[data-apanel]').forEach(p=>p.classList.toggle('hidden',p.getAttribute('data-apanel')!=='deal'));
  $('#aOverview').classList.add('hidden');
  $('#aCrumb').textContent='Deal';
  window.scrollTo({top:0});
};
$('#aQuote').onclick=()=>sheet({
  title:'Send a quote',
  sub:'Grace Umeh sees this in the conversation and can accept it in one tap.',
  html:'<div class="field"><label>Total project price</label>'+
       '<div class="naira"><input id="qA" value="1200000" /></div>'+
       '<span class="help">They\'ll be asked for 80% of this upfront.</span></div>',
  confirmLabel:'Send quote',
  onConfirm:sc=>{
    const v=Number(String($('#qA',sc).value).replace(/[^0-9]/g,''))||1200000;
    state.quote=v; renderClient();
    push(aMsgs,{who:'system',body:'Quote sent: '+ngn(v)+' for Website — Umeh Interiors. To start, '+ngn(v*0.8)+' (80%) is due upfront.'});
    renderThread($('#aThread'),aMsgs,'admin');
    toast('Quote sent — switch to the Client tab to see it land.');
  },
});
$('#aPayout').onclick=()=>sheet({
  title:'Mark payout as paid',
  sub:'Confirm the transfer has actually left your bank.',
  html:'<div class="field"><label>Transfer reference</label><input class="mono" placeholder="GTBank 99213" /></div>',
  confirmLabel:'Mark paid',
  onConfirm:()=>toast('Marked paid.'),
});
$('#aEditScout').onclick=()=>sheet({
  title:'Edit Scout',
  sub:'A new rate applies to future deals only — deals already running keep theirs.',
  html:'<div class="field"><label>Commission (%)</label><input class="mono" value="10" /></div>'+
       '<div class="field"><label>Status</label><select><option>Active</option><option>Suspended</option></select></div>',
  confirmLabel:'Save',
  onConfirm:()=>toast('Scout updated.'),
});

// ---- shared chat ----
const ngn=n=>'₦'+Math.round(n).toLocaleString('en-NG');
const now=()=>new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
function push(arr,m){arr.push(Object.assign({t:now()},m));}
function renderThread(el,msgs,mine){
  el.innerHTML=msgs.map(m=>{
    if(m.who==='system')return '<div class="msg system"><div class="bubble">'+esc(m.body)+'</div></div>';
    const isMine=m.who===mine;
    return '<div class="msg '+(isMine?'mine':'')+'"><div class="who">'+esc(m.who==='client'?'Grace Umeh':'Meji Builds')+' · '+m.t+
      '</div><div class="bubble">'+esc(m.body)+'</div></div>';
  }).join('');
  el.scrollTop=el.scrollHeight;
}
const seed=[
  {who:'system',body:'Grace Umeh started this project via Ada Okeke. Reference PJ-YD3M89.',t:'01:14 PM'},
  {who:'client',body:'We need a portfolio site with an enquiry form and a simple CMS so the team can post projects themselves.',t:'01:14 PM'},
  {who:'client',body:'Hi! Roughly what would this cost, and how long would it take?',t:'01:16 PM'},
];
const cMsgs=seed.map(m=>({...m}));
const aMsgs=seed.map(m=>({...m}));
const state={quote:null,accepted:false,paid:false};

function renderClient(){
  const el=$('#clientOffer');
  if(state.paid){
    el.innerHTML='<div class="card"><div class="card-head"><div><h2>Website — Umeh Interiors</h2>'+
      '<span class="ref">PJ-YD3M89</span></div><span class="pill won">Won</span></div>'+
      '<div class="kv"><div><span class="k">Agreed price</span><span class="v"><span class="money">'+ngn(state.quote)+'</span></span></div>'+
      '<div><span class="k">Paid so far</span><span class="v"><span class="money pos">'+ngn(state.quote*0.8)+'</span></span></div>'+
      '<div><span class="k">Outstanding</span><span class="v"><span class="money">'+ngn(state.quote*0.2)+'</span></span></div></div></div>';
    return;
  }
  if(state.accepted){
    el.innerHTML='<div class="card"><div class="card-head"><div><h2>Website — Umeh Interiors</h2>'+
      '<span class="ref">PJ-YD3M89</span></div><span class="pill won">Won</span></div>'+
      '<div class="kv"><div><span class="k">Agreed price</span><span class="v"><span class="money">'+ngn(state.quote)+'</span></span></div></div>'+
      '<div class="btn-row" style="margin-top:18px"><button class="btn" id="payNow">Pay '+ngn(state.quote*0.8)+' deposit</button>'+
      '<button class="btn ghost">Pay full '+ngn(state.quote)+'</button></div></div>';
    $('#payNow').onclick=()=>sheet({
      title:'Pay '+ngn(state.quote*0.8),
      sub:'Transfer the amount to the account below, using PJ-YD3M89 as the narration.',
      html:'<div class="kv"><div><span class="k">Bank</span><span class="v strong">GTBank</span></div>'+
        '<div><span class="k">Account number</span><span class="v strong mono">0123456789</span></div>'+
        '<div><span class="k">Account name</span><span class="v strong">Meji Builds Ltd</span></div>'+
        '<div><span class="k">Narration</span><span class="v strong ref">PJ-YD3M89</span></div></div>',
      confirmLabel:"I've sent it",
      onConfirm:()=>{
        state.paid=true;renderClient();
        push(cMsgs,{who:'client',body:"I've sent "+ngn(state.quote*0.8)+' for PJ-YD3M89.'});
        renderThread($('#clientThread'),cMsgs,'client');
        toast("Thanks — we'll confirm as soon as it lands.");
      },
    });
    return;
  }
  if(state.quote){
    el.innerHTML='<div class="offer"><div class="row-between" style="margin-bottom:6px">'+
      '<span class="eyebrow">Your quote</span><span class="pill quoted">Quoted</span></div>'+
      '<div class="price">'+ngn(state.quote)+'</div>'+
      '<div class="sub">Website — Umeh Interiors · <span class="ref">PJ-YD3M89</span></div>'+
      '<p class="terms">To get started we ask for <strong>'+ngn(state.quote*0.8)+'</strong> (80%) upfront, '+
      'with the balance due on delivery.</p><button class="btn lg full" id="accept">Accept and start</button></div>';
    $('#accept').onclick=()=>{
      state.accepted=true;renderClient();
      push(cMsgs,{who:'system',body:'Grace Umeh accepted the quote of '+ngn(state.quote)+'.'});
      renderThread($('#clientThread'),cMsgs,'client');
      toast("Quote accepted — let's go!");
    };
    return;
  }
  el.innerHTML='<div class="card"><div class="card-head"><div><h2>Website — Umeh Interiors</h2>'+
    '<span class="ref">PJ-YD3M89</span></div><span class="pill in_discussion">In discussion</span></div>'+
    '<p class="hint">We\'re reviewing your brief and will come back with a price shortly. '+
    '<strong>Try it:</strong> open the Studio tab above and send a quote.</p></div>';
}

function composer(box,btn,onSend){
  const send=()=>{const v=box.value.trim();if(!v)return;box.value='';box.style.height='auto';onSend(v);};
  btn.onclick=send;
  box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  box.addEventListener('input',()=>{box.style.height='auto';box.style.height=Math.min(box.scrollHeight,150)+'px';});
}
composer($('#clientBox'),$('#clientSend'),v=>{
  push(cMsgs,{who:'client',body:v});renderThread($('#clientThread'),cMsgs,'client');
  push(aMsgs,{who:'client',body:v});renderThread($('#aThread'),aMsgs,'admin');
});
composer($('#aBox'),$('#aSend'),v=>{
  push(aMsgs,{who:'admin',body:v});renderThread($('#aThread'),aMsgs,'admin');
  push(cMsgs,{who:'admin',body:v});renderThread($('#clientThread'),cMsgs,'client');
});

renderThread($('#clientThread'),cMsgs,'client');
renderThread($('#aThread'),aMsgs,'admin');
renderClient();
`;

fs.writeFileSync(out, `${shell}\n${body}\n<script>${script}<\/script>\n`);
console.log(`Prototype written to ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
