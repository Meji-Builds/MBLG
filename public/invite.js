// Client intake, reached from a Scout's invite link (/r/MC-XXXXXX).

// The code sits in the path in production and may be a ?code= query during
// local testing — accept both.
const code =
  location.pathname.split("/r/")[1]?.split(/[/?#]/)[0] ||
  new URLSearchParams(location.search).get("code") ||
  "";

const show = (id) => {
  ["loading", "invalid", "form", "done"].forEach((x) =>
    $(`#${x}`).classList.toggle("hidden", x !== id)
  );
};

GET(`/api/invite/${encodeURIComponent(code)}`)
  .then((r) => {
    show("form");
    $("#referrer").textContent = r.scoutName;
    document.title = `${r.scoutName} invited you · Meji Builds`;
  })
  .catch(() => {
    show("invalid");
    // Shows exactly what code the page tried, so a real mismatch (mistyped,
    // stale, or a Scout account that no longer exists) is visible on screen
    // instead of a silent guess.
    $("#invalidCode").textContent = code ? `Code tried: ${code}` : "No code was found in this link.";
  });

$("#intake").onsubmit = async (e) => {
  e.preventDefault();
  const btn = $("#intake button[type=submit]");
  await busy(btn, async () => {
    const r = await POST(`/api/invite/${encodeURIComponent(code)}/claim`, {
      name: $("#fName").value,
      email: $("#fEmail").value,
      phone: $("#fPhone").value,
      company: $("#fCompany").value,
      projectType: $("#fType").value,
      timeline: $("#fTimeline").value,
      budgetRange: $("#fBudget").value,
      description: $("#fDesc").value,
    });

    // The portal link is shown on screen whether or not email is configured —
    // a client must never be locked out because a mail provider is missing.
    show("done");
    $("#portalUrl").value = r.portalUrl;
    $("#goPortal").href = absolutize(r.portalUrl);
    if (!r.emailed) {
      $("#done .notice div").innerHTML =
        "<strong>Your project is open.</strong> Save the link below. It's how you get back in.";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  })();
};

$("#copyLink").onclick = () => copy($("#portalUrl").value, "Project link copied");
