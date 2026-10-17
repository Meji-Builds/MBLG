// Sets data-theme on <html> before first paint, so there's no flash of the
// wrong theme. Must run before styles.css, which is why it's the very first
// thing loaded in <head> on every page.
//
// This is an external file rather than the inline <script> the design brief
// describes (and which every other page here uses verbatim) for exactly one
// reason: admin.html runs under a strict Content-Security-Policy with no
// 'unsafe-inline' on script-src, so an inline block would simply be blocked
// by the browser. A same-origin external file achieves the identical
// no-flash effect — loaded first, parsed synchronously, blocks nothing it
// shouldn't — without weakening that page's CSP. See app.js and vercel.json
// for the policy itself.
(function () {
  try {
    var t = null;
    try { t = localStorage.getItem("mb_theme"); } catch (e) {}
    if (t !== "dark" && t !== "light") {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
