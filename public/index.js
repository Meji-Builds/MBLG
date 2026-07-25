// Landing page: Scout signup and sign-in.

// Anyone already signed in skips the form entirely.
GET("/api/me")
  .then((me) => {
    if (me.scout) location.replace("/scout.html");
    else if (me.admin) location.replace("/admin.html");
  })
  .catch(() => {});

// Show the real commission rate and hold period rather than hard-coded copy,
// so changing them in the admin dashboard updates the pitch too.
GET("/api/config")
  .then((c) => {
    $("#pctLabel").textContent = `${c.defaultCommissionPercent}%`;
    $("#holdLabel").textContent = `${c.holdDays}-day`;
  })
  .catch(() => {});

$$(".tabs button").forEach((btn) => {
  btn.onclick = () => {
    $$(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    const signup = btn.dataset.tab === "signup";
    $("#signupForm").style.display = signup ? "" : "none";
    $("#loginForm").style.display = signup ? "none" : "";
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
