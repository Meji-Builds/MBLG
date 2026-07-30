// Landing page: Scout signup and sign-in.

// Anyone already signed in skips the form entirely.
GET("/api/me")
  .then((me) => {
    if (me.scout) location.replace("/scout.html");
    else if (me.admin) location.replace("/admin.html");
  })
  .catch(() => {});

// Show the live commission rate and hold period rather than hard-coded copy, so
// changing them in the studio settings updates the pitch too.
//
// A free-tier Neon database suspends itself after a few minutes idle and takes
// a moment to wake back up on the next query — the very first request after a
// quiet spell can fail for that reason alone, with nothing actually wrong. One
// silent retry absorbs that instead of showing a real visitor a scary error
// for something that fixes itself half a second later.
async function loadConfig(isRetry) {
  try {
    const c = await GET("/api/config");
    $("#pctLabel").textContent = `${c.defaultCommissionPercent}%`;
    $("#holdLabel").textContent = `${c.holdDays}-day`;
  } catch (e) {
    if (!isRetry) return setTimeout(() => loadConfig(true), 1500);

    const local = /localhost|127\.0\.0\.1/.test(location.hostname);
    $("#authCard").insertAdjacentHTML(
      "afterbegin",
      `<div class="notice bad" style="margin-bottom:16px">
         <span class="ico">${icon("alert")}</span>
         <div><strong>Can't reach the server right now.</strong> ${
           local
             ? `Check that <code class="mono">DATABASE_URL</code> is set in your <code class="mono">.env</code> file.`
             : `Please refresh, or try again in a moment.`
         }</div>
       </div>`
    );
  }
}
loadConfig();

$$(".linktabs button").forEach((btn) => {
  btn.onclick = () => {
    $$(".linktabs button").forEach((b) => b.classList.toggle("is-on", b === btn));
    const signup = btn.dataset.tab === "signup";
    $("#signupForm").classList.toggle("hidden", !signup);
    $("#loginForm").classList.toggle("hidden", signup);
  };
});

$("#signupForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#signupForm button[type=submit]");
  await busy(btn, async () => {
    await POST("/api/scouts/signup", {
      name: $("#suName").value,
      email: $("#suEmail").value,
      phone: $("#suPhone").value,
      password: $("#suPassword").value,
    });
    location.href = "/scout.html";
  })();
};

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#loginForm button[type=submit]");
  await busy(btn, async () => {
    await POST("/api/auth/login", {
      email: $("#liEmail").value,
      password: $("#liPassword").value,
    });
    location.href = "/scout.html";
  })();
};
