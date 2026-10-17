// Fades .reveal elements up into place as they scroll into view. Opt-in per
// element (add the class), staggered with a --d delay on siblings. Entirely
// inert under prefers-reduced-motion — styles.css shows reveals at full
// opacity immediately in that case, so this observer has nothing to do.
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var groups = document.querySelectorAll("[data-reveal-group]");
  groups.forEach(function (group) {
    var items = group.querySelectorAll(".reveal");
    items.forEach(function (el, i) { el.style.setProperty("--d", (i % 3) * 0.08 + "s"); });
  });

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });

  // Belt and suspenders: an element that somehow never intersects (a very
  // short page, a non-scrolling viewport, a browser quirk) must not stay
  // invisible forever.
  setTimeout(function () {
    document.querySelectorAll(".reveal:not(.in-view)").forEach(function (el) {
      el.classList.add("in-view");
    });
  }, 4000);
})();
