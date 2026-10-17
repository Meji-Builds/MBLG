// Light/dark theme toggle, shared by every page. The data-theme attribute
// itself is already set by the no-flash script in <head> (inline on most
// pages, /theme-init.js on admin.html) before this ever runs — this just
// wires up the button and keeps following the system setting live until the
// visitor picks a theme of their own.
(function () {
  "use strict";
  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var themeBtn = document.getElementById("themeToggle");
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  var currentTheme = function () {
    return root.getAttribute("data-theme") || (darkQuery.matches ? "dark" : "light");
  };
  var paintTheme = function () {
    var dark = currentTheme() === "dark";
    if (themeBtn) {
      themeBtn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      themeBtn.setAttribute("aria-pressed", String(dark));
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#161513" : "#eeebe5";
  };

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      if (!reduceMotion) {
        root.classList.add("theme-anim");
        setTimeout(function () { root.classList.remove("theme-anim"); }, 450);
      }
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("mb_theme", next); } catch (e) {}
      paintTheme();
    });
  }

  // Until the visitor picks a theme, keep following the system setting live.
  darkQuery.addEventListener("change", function () {
    try { if (localStorage.getItem("mb_theme")) return; } catch (e) {}
    root.setAttribute("data-theme", darkQuery.matches ? "dark" : "light");
    paintTheme();
  });

  paintTheme();
})();
