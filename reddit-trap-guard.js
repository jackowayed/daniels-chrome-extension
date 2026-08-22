// MAIN-world helper for the Reddit content script (reddit.js runs in the
// isolated world; this one runs in the page's own world).
//
// Reddit locks page scrolling while a modal is open by installing non-passive
// `wheel` / `touchmove` listeners on the document that call preventDefault().
// Normally Reddit removes them when the modal closes. But the dynamic upsell
// (#desktop-dynamic-upsell-dialog) is a shadow-DOM <div> with only two CTA
// buttons ("Get Started" / "I already have an account") and NO close control
// our content script can click -- so reddit.js has to remove the modal's DOM
// node directly, which orphans those document-level listeners and leaves the
// page permanently unscrollable with no visible modal (the "tab locks up after
// idle / long scroll" report).
//
// The isolated-world content script can't remove those listeners itself: they
// were registered here in the page's main world with function references it has
// no access to (isolated and main worlds don't share JS objects). So this script
// runs in the MAIN world at document_start -- before Reddit's own scripts -- and
// records every non-passive wheel/touchmove listener added to the document,
// window, <html>, or <body>. When reddit.js dismisses an un-closable upsell it
// dispatches a `daniels-ext:purge-scroll-trap` event (DOM events cross worlds),
// and we remove exactly those recorded listeners -- restoring scroll without
// touching anything else on the page. Normal browsing is never affected: we only
// record refs, and only remove them when the content script explicitly asks.

(function () {
  "use strict";
  if (window.__danielsScrollTrapGuard) return;
  window.__danielsScrollTrapGuard = true;

  const TRAP_TYPES = new Set(["wheel", "touchmove", "mousewheel"]);
  const origAdd = EventTarget.prototype.addEventListener;
  const origRemove = EventTarget.prototype.removeEventListener;

  // Recorded (target, type, listener, capture) tuples for non-passive scroll
  // listeners on scroll roots, so we can remove the exact same listeners later.
  const traps = [];

  function isScrollRoot(target) {
    return target === window || target === document ||
      target === document.documentElement || target === document.body;
  }
  function captureOf(options) {
    return typeof options === "boolean" ? options : !!(options && options.capture);
  }
  function isTrapOptions(options) {
    // For wheel/touchmove on scroll roots the browser defaults passive to true,
    // so only an explicit passive:false listener is a scroll-lock trap.
    return !!(options && typeof options === "object" && options.passive === false);
  }

  EventTarget.prototype.addEventListener = function (type, listener, options) {
    try {
      if (listener && TRAP_TYPES.has(type) && isTrapOptions(options) && isScrollRoot(this)) {
        traps.push({ target: this, type, listener, capture: captureOf(options) });
      }
    } catch (e) { /* bookkeeping must never break the page */ }
    return origAdd.call(this, type, listener, options);
  };

  // Stay in sync when Reddit removes a trap on its own, so the record doesn't
  // grow without bound and a later purge doesn't touch already-gone listeners.
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    try {
      if (TRAP_TYPES.has(type)) {
        const capture = captureOf(options);
        for (let i = traps.length - 1; i >= 0; i--) {
          const t = traps[i];
          if (t.target === this && t.type === type && t.listener === listener && t.capture === capture) {
            traps.splice(i, 1);
          }
        }
      }
    } catch (e) { /* ignore */ }
    return origRemove.call(this, type, listener, options);
  };

  function purge() {
    const removed = traps.splice(0);
    for (const t of removed) {
      try { origRemove.call(t.target, t.type, t.listener, t.capture); } catch (e) { /* ignore */ }
    }
    return removed.length;
  }

  // reddit.js signals us right after it removes an un-closable modal. Purge
  // immediately, then again shortly after in case a trap is (re)added a tick
  // later as part of the modal-open sequence.
  origAdd.call(window, "daniels-ext:purge-scroll-trap", function () {
    // A purge only happens when the content script removed an un-closable modal,
    // so it's rare and worth logging as confirmation the fix engaged.
    console.log("[reddit-trap-guard] purged scroll traps:", purge());
    setTimeout(purge, 100);
    setTimeout(purge, 400);
  }, false);
})();
