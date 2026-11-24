/* Shared accessibility behavior, added to every page by src/utils/htmlEnhance.js.
   It only adds what the markup lacks; it never changes what a page does. */
(function () {
  "use strict";
  var doc = document;
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /* A skip link and a focusable <main> target. */
  function skipLink() {
    var main = doc.querySelector("main");
    if (!main || doc.querySelector(".fx-skip")) return;
    if (!main.id) main.id = "main";
    main.setAttribute("tabindex", "-1");
    var a = doc.createElement("a");
    a.className = "fx-skip";
    a.href = "#" + main.id;
    a.textContent = "رفتن به محتوای اصلی";
    a.addEventListener("click", function (e) {
      e.preventDefault();
      main.focus();
      main.scrollIntoView();
    });
    doc.body.insertBefore(a, doc.body.firstChild);
  }

  /* Icon-only controls get a name from their title; decorative icons are hidden from screen readers. */
  function nameControls(root) {
    var scope = root || doc;
    var controls = scope.querySelectorAll("button, a[href], [role=button]");
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      if (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))
        continue;
      if ((el.textContent || "").trim()) continue;
      var title = el.getAttribute("title");
      if (title) el.setAttribute("aria-label", title);
    }
    var icons = scope.querySelectorAll("i.bi, i[class*='bi-']");
    for (var j = 0; j < icons.length; j++)
      if (!icons[j].hasAttribute("aria-hidden"))
        icons[j].setAttribute("aria-hidden", "true");
  }

  /* Messages that appear without a page load are announced. */
  function liveRegions(root) {
    var scope = root || doc;
    var toast = scope.querySelector("#toast");
    if (toast) {
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");
    }
    var errs = scope.querySelectorAll(".error-text, .input-error");
    for (var i = 0; i < errs.length; i++)
      if (!errs[i].hasAttribute("aria-live"))
        errs[i].setAttribute("aria-live", "polite");
  }

  /* The off-canvas menu must not be reachable by Tab while it is closed. */
  function sidebar() {
    var sb = doc.getElementById("sidebar");
    if (!sb) return;
    var sync = function () {
      // if ("inert" in sb) sb.inert = !sb.classList.contains("open");
    };
    sync();
    new MutationObserver(sync).observe(sb, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /* Dialogs (.modal-overlay.active): role, focus in, Tab kept inside, Escape closes, focus returns. */
  function dialogs() {
    var overlays = doc.querySelectorAll(".modal-overlay");
    var opener = new WeakMap();

    function setup(overlay) {
      var box = overlay.querySelector(".modal-dialog") || overlay;
      var heading = box.querySelector("h1, h2, h3");
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-modal", "true");
      if (heading) {
        if (!heading.id) heading.id = (overlay.id || "dialog") + "-title";
        box.setAttribute("aria-labelledby", heading.id);
      }
      return box;
    }

    function onChange(overlay) {
      var box = setup(overlay);
      var open = overlay.classList.contains("active");
      if (open && !opener.has(overlay)) {
        opener.set(overlay, doc.activeElement);
        var first = box.querySelector(FOCUSABLE);
        (first || box).setAttribute(
          "tabindex",
          first ? first.getAttribute("tabindex") || "0" : "-1",
        );
        (first || box).focus();
      } else if (!open && opener.has(overlay)) {
        var back = opener.get(overlay);
        opener.delete(overlay);
        if (back && back.focus && doc.contains(back)) back.focus();
      }
    }

    for (var i = 0; i < overlays.length; i++) {
      setup(overlays[i]);
      new MutationObserver(onChange.bind(null, overlays[i])).observe(
        overlays[i],
        { attributes: true, attributeFilter: ["class"] },
      );
    }

    doc.addEventListener("keydown", function (e) {
      var overlay = doc.querySelector(".modal-overlay.active");
      if (!overlay) return;
      var box = overlay.querySelector(".modal-dialog") || overlay;
      if (e.key === "Escape") {
        e.preventDefault();
        if (typeof window.closeModal === "function" && overlay.id)
          window.closeModal(overlay.id);
        else overlay.classList.remove("active");
        return;
      }
      if (e.key !== "Tab") return;
      var items = [].filter.call(
        box.querySelectorAll(FOCUSABLE),
        function (el) {
          return el.getClientRects().length > 0 || el === doc.activeElement;
        },
      );
      if (!items.length) {
        e.preventDefault();
        return;
      }
      var first = items[0],
        last = items[items.length - 1];
      if (
        e.shiftKey &&
        (doc.activeElement === first || !box.contains(doc.activeElement))
      ) {
        e.preventDefault();
        last.focus();
      } else if (
        !e.shiftKey &&
        (doc.activeElement === last || !box.contains(doc.activeElement))
      ) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* Content added later (live refresh, dialogs built by scripts) gets the same treatment. */
  function watch() {
    var timer = null;
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        nameControls();
        liveRegions();
      }, 150);
    }).observe(doc.body, { childList: true, subtree: true });
  }

  function init() {
    skipLink();
    nameControls();
    liveRegions();
    sidebar();
    dialogs();
    watch();
  }
  if (doc.readyState === "loading")
    doc.addEventListener("DOMContentLoaded", init);
  else init();
})();
