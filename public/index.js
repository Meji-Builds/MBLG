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
GET("/api/config")
  .then((c) => {
    $("#pctLabel").textContent = `${c.defaultCommissionPercent}%`;
    $("#holdLabel").textContent = `${c.holdDays}-day`;
  })
  .catch(() => {
    // The database is unreachable. Say so here rather than leaving someone
    // filling in a form that can't possibly submit.
    $("#authCard").insertAdjacentHTML(
      "afterbegin",
      `<div class="notice bad" style="margin-bottom:16px">
         <span class="ico">${icon("alert")}</span>
         <div><strong>Can't reach the server.</strong> If you're running this
         locally, check that <code class="mono">DATABASE_URL</code> is set in your
         <code class="mono">.env</code> file.</div>
       </div>`
    );
  });

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
