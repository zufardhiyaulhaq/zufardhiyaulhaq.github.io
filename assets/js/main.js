/* Zufar Dhiyaulhaq — site behavior
   - Home: one continuous dense bento panned left -> right (wheel, drag, keys)
   - Header: live Jakarta clock
   - Writing: client-side tag filter
   Everything degrades to a plain vertical page with JS off or on mobile. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var isDesktop = function () { return window.matchMedia("(min-width: 861px)").matches; };

  /* ------------------------------------------------------------------ *
   * Live local clock (Asia/Jakarta)
   * ------------------------------------------------------------------ */
  var clockEl = document.getElementById("clock");
  if (clockEl) {
    var tick = function () {
      try {
        var t = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Jakarta", hour: "numeric", minute: "2-digit", hour12: true
        }).format(new Date());
        clockEl.innerHTML = "Jakarta <b>" + t + "</b>";
      } catch (e) { clockEl.textContent = "Jakarta"; }
    };
    tick();
    setInterval(tick, 15000);
  }

  /* ------------------------------------------------------------------ *
   * HOME — continuous horizontal pan
   * ------------------------------------------------------------------ */
  var home = document.querySelector(".home");
  if (home && home.querySelector(".card")) {
    var fill = document.querySelector(".hscroll-fill");
    var hint = document.querySelector(".scroll-hint");

    var update = function () {
      var max = home.scrollWidth - home.clientWidth;
      var ratio = max > 0 ? home.scrollLeft / max : 0;
      if (fill) fill.style.width = (ratio * 100).toFixed(2) + "%";
      if (hint && home.scrollLeft > 40) hint.classList.add("is-hidden");
    };
    home.addEventListener("scroll", update, { passive: true });

    /* Smooth programmatic scroll (rAF tween; instant if reduced motion) */
    var tweenId = 0;
    var animateTo = function (target) {
      cancelAnimationFrame(tweenId);
      target = Math.max(0, Math.min(home.scrollWidth - home.clientWidth, target));
      if (reduceMotion) { home.scrollLeft = target; return; }
      var start = home.scrollLeft, dist = target - start;
      if (Math.abs(dist) < 1) return;
      var t0 = performance.now();
      var dur = Math.min(680, 240 + Math.abs(dist) * 0.3);
      var step = function (now) {
        var p = Math.min(1, (now - t0) / dur);
        var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        home.scrollLeft = start + dist * e;
        if (p < 1) tweenId = requestAnimationFrame(step);
      };
      tweenId = requestAnimationFrame(step);
    };

    /* Mouse wheel -> horizontal pan */
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
      var step = home.clientWidth * 0.8;
      if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); animateTo(home.scrollLeft + step); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); animateTo(home.scrollLeft - step); }
      else if (e.key === "Home") { e.preventDefault(); animateTo(0); }
      else if (e.key === "End") { e.preventDefault(); animateTo(home.scrollWidth); }
    });

    /* Drag to pan (mouse; leaves links + buttons clickable) */
    var dragging = false, moved = false, startX = 0, startLeft = 0;
    home.addEventListener("pointerdown", function (e) {
      if (!isDesktop() || e.pointerType === "touch") return;
      if (e.target.closest("a, button")) return;
      dragging = true; moved = false;
      startX = e.clientX; startLeft = home.scrollLeft;
      home.classList.add("is-grabbing");
    });
    window.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      home.scrollLeft = startLeft - dx;
    });
    window.addEventListener("pointerup", function () {
      if (!dragging) return;
      dragging = false;
      home.classList.remove("is-grabbing");
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
        chips.forEach(function (c) { c.classList.remove("is-active"); c.setAttribute("aria-pressed", "false"); });
        chip.classList.add("is-active");
        chip.setAttribute("aria-pressed", "true");
        applyFilter(chip.getAttribute("data-tag"));
      });
    });
  }
})();
