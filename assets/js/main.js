/* Zufar Dhiyaulhaq — site behavior
   - Home: pan left→right (wheel, drag, keys, ruler)
   - Writing: client-side tag filter
   Everything degrades to a plain vertical page if JS is off or on mobile. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var behavior = reduceMotion ? "auto" : "smooth";
  var isDesktop = function () { return window.matchMedia("(min-width: 861px)").matches; };

  /* ------------------------------------------------------------------ *
   * HOME — horizontal navigation
   * ------------------------------------------------------------------ */
  var home = document.querySelector(".home");
  if (home) {
    var panels = Array.prototype.slice.call(home.querySelectorAll(".panel"));
    var ticks = Array.prototype.slice.call(document.querySelectorAll(".ruler-tick"));
    var progress = document.querySelector(".ruler-progress");

    var currentIndex = function () {
      return Math.round(home.scrollLeft / home.clientWidth);
    };

    var update = function () {
      var max = home.scrollWidth - home.clientWidth;
      var ratio = max > 0 ? home.scrollLeft / max : 0;
      if (progress) progress.style.width = (ratio * 100).toFixed(2) + "%";
      var idx = currentIndex();
      for (var i = 0; i < ticks.length; i++) {
        ticks[i].classList.toggle("is-active", i === idx);
        ticks[i].setAttribute("aria-current", i === idx ? "true" : "false");
      }
    };

    /* Manual tween — scroll-snap:mandatory cancels native smooth scrollTo,
       so animate scrollLeft frame by frame instead. */
    var tweenId = 0;
    var animateTo = function (target) {
      cancelAnimationFrame(tweenId);
      if (reduceMotion) { home.scrollLeft = target; return; }
      var start = home.scrollLeft;
      var dist = target - start;
      if (Math.abs(dist) < 1) return;
      var t0 = performance.now();
      var dur = Math.min(720, 260 + Math.abs(dist) * 0.28);
      var tick = function (now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        home.scrollLeft = start + dist * eased;
        if (p < 1) tweenId = requestAnimationFrame(tick);
      };
      tweenId = requestAnimationFrame(tick);
    };

    var goTo = function (i) {
      var clamped = Math.max(0, Math.min(panels.length - 1, i));
      animateTo(clamped * home.clientWidth);
    };

    home.addEventListener("scroll", update, { passive: true });

    /* Mouse wheel → horizontal pan (desktop only) */
    home.addEventListener("wheel", function (e) {
      if (!isDesktop()) return;
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        home.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });

    /* Keyboard */
    window.addEventListener("keydown", function (e) {
      if (!isDesktop()) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") { e.preventDefault(); goTo(currentIndex() + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(currentIndex() - 1); }
      else if (e.key === "Home") { e.preventDefault(); goTo(0); }
      else if (e.key === "End") { e.preventDefault(); goTo(panels.length - 1); }
    });

    /* Drag to pan (mouse only; leave links + buttons clickable) */
    var dragging = false, moved = false, startX = 0, startLeft = 0;
    home.addEventListener("pointerdown", function (e) {
      if (!isDesktop() || e.pointerType === "touch") return;
      if (e.target.closest("a, button")) return;
      dragging = true; moved = false;
      startX = e.clientX; startLeft = home.scrollLeft;
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      home.scrollLeft = startLeft - dx;
      home.style.cursor = "grabbing";
    });
    window.addEventListener("pointerup", function () {
      if (!dragging) return;
      dragging = false;
      home.style.cursor = "";
      if (moved && !reduceMotion) goTo(currentIndex()); // settle to nearest panel
    });

    /* Ruler ticks */
    ticks.forEach(function (t, i) {
      t.addEventListener("click", function () { goTo(i); });
    });

    window.addEventListener("resize", update);
    update();
  }

  /* ------------------------------------------------------------------ *
   * WRITING — tag filter
   * ------------------------------------------------------------------ */
  var chips = Array.prototype.slice.call(document.querySelectorAll(".chip"));
  if (chips.length) {
    var entries = Array.prototype.slice.call(document.querySelectorAll(".entry"));
    var empty = document.querySelector(".filter-empty");

    var applyFilter = function (tag) {
      var shown = 0;
      entries.forEach(function (en) {
        var tags = (en.getAttribute("data-tags") || "").split(" ");
        var show = tag === "all" || tags.indexOf(tag) !== -1;
        en.classList.toggle("is-hidden", !show);
        if (show) shown++;
      });
      if (empty) empty.hidden = shown > 0;
    };

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) {
          c.classList.remove("is-active");
          c.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("is-active");
        chip.setAttribute("aria-pressed", "true");
        applyFilter(chip.getAttribute("data-tag"));
      });
    });
  }
})();
