// Light/dark theme toggle, shared by every page. The data-theme attribute
// itself is already set by the no-flash script in <head> (inline on most
// pages, /theme-init.js on admin.html) before this ever runs — this just
// wires up the button(s) and keeps following the system setting live until
// the visitor picks a theme of their own.
//
// Dashboard pages carry two toggle buttons — one in the desktop rail, one in
// the mobile header — only one of which is ever visible at a time, so both
// need to stay in sync with whichever one gets clicked.
(function () {
  "use strict";
  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var themeBtns = document.querySelectorAll(".theme-toggle");
  var darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

  var currentTheme = function () {
    return root.getAttribute("data-theme") || (darkQuery.matches ? "dark" : "light");
  };
  var paintTheme = function () {
    var dark = currentTheme() === "dark";
    themeBtns.forEach(function (btn) {
      btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
      btn.setAttribute("aria-pressed", String(dark));
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#161513" : "#eeebe5";
  };

  var toggle = function () {
    var next = currentTheme() === "dark" ? "light" : "dark";
    if (!reduceMotion) {
      root.classList.add("theme-anim");
      setTimeout(function () { root.classList.remove("theme-anim"); }, 450);
    }
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("mb_theme", next); } catch (e) {}
    paintTheme();
  };
  themeBtns.forEach(function (btn) { btn.addEventListener("click", toggle); });

  // Until the visitor picks a theme, keep following the system setting live.
  darkQuery.addEventListener("change", function () {
    try { if (localStorage.getItem("mb_theme")) return; } catch (e) {}
    root.setAttribute("data-theme", darkQuery.matches ? "dark" : "light");
    paintTheme();
  });

  paintTheme();
})();
