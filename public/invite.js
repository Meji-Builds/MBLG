// Client intake, reached via a Scout's invite link (/r/MC-XXXXXX).

// The code is in the path (/r/CODE) in production and may be a ?code= query
// during local testing — accept both.
const code =
  location.pathname.split("/r/")[1]?.split(/[/?#]/)[0] ||
  new URLSearchParams(location.search).get("code") ||
  "";

GET(`/api/invite/${encodeURIComponent(code)}`)
  .then((r) => {
    $("#loading").style.display = "none";
    $("#form").style.display = "";
    $("#referrer").textContent = r.scoutName;
    document.title = `${r.scoutName} invited you — Meji Builds`;
  })
  .catch(() => {
    $("#loading").style.display = "none";
    $("#invalid").style.display = "";
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
    // the client must never be locked out because a mail provider is missing.
    $("#form").style.display = "none";
    $("#done").style.display = "";
    $("#portalUrl").value = r.portalUrl;
    $("#goPortal").href = r.portalUrl;
    if (!r.emailed) {
      $("#done .notice").textContent =
        "Your project is open. Save the link below — it's how you get back in.";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  })();
};

$("#copyLink").onclick = () => copy($("#portalUrl").value, "Project link copied");
