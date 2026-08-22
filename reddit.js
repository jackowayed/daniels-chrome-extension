// Reddit shows a blocking "dynamic upsell" modal that locks page scrolling.
//
// HOW REDDIT LOCKS SCROLL (verified in-browser): while any of its modals is
// open, Reddit installs non-passive `wheel` and `touchmove` listeners on
// `document` -- a scroll-lock trap that calls preventDefault() -- and adds a
// `scroll-is-blocked` / `rpl-scroll-lock` class to <body>. Those document-level
// listeners are removed ONLY when the modal is dismissed through Reddit's own
// close path (native <dialog>.close(), faceplate-dialog.close(), or its Close
// button, all of which run Reddit's teardown).
//
// WHY THE OLD APPROACH FROZE SCROLLING: we hid the modal with CSS (reddit.css)
// and then removed its DOM node directly. That bypassed Reddit's teardown, so
// the `wheel`/`touchmove` scroll-trap listeners on `document` were orphaned and
// never removed -- leaving the page permanently unscrollable with no visible
// modal. That is the "tab locks up / can't scroll after idle or long scroll"
// report: the modal appears (often after idle or deep scrolling), we delete it
// out from under Reddit, and the orphaned scroll trap keeps eating every scroll.
//
// THE FIX: dismiss the modal through Reddit's own affordances so Reddit removes
// its own scroll-trap listeners and lock class. We only remove the node as a
// last resort, and then also strip the lock artifacts we know about.
//
// The dynamic upsell (#desktop-dynamic-upsell-dialog) is the hard case: it's a
// shadow-DOM <div> whose only controls are "Get Started" / "I already have an
// account" -- there is NO close button to click, so we always fall through to
// removing the node, which orphans the document-level scroll trap. This script
// can't remove that trap (it lives in the page's main world). So when we remove
// an un-closable modal we dispatch `daniels-ext:purge-scroll-trap`, which the
// main-world helper (reddit-trap-guard.js) listens for -- it recorded Reddit's
// non-passive wheel/touchmove listeners and removes exactly those, restoring
// scroll. See reddit-trap-guard.js for details.
//
// Detection is a cheap O(1) getElementById poll. We deliberately do NOT use a
// MutationObserver: a whole-document observer on Reddit's infinite feed churns
// MutationRecords for every inserted node and starved the main thread, freezing
// tabs the longer you scrolled (see git history). The CSS rule hides the modal
// on sight; the poll only needs to close it within a fraction of a second.

(function () {
  "use strict";

  const MODAL_ID = "desktop-dynamic-upsell-dialog";
  const LOCK_CLASSES = ["scroll-is-blocked", "rpl-scroll-lock"];
  // Flip to false once we've confirmed the fix in the wild. When true, the
  // script logs what it detected and which dismissal path it took, so a stuck
  // scroll can be diagnosed from the console.
  const DEBUG = true;

  // Modals we've already asked Reddit to close. If the same element is still
  // around on the next poll, Reddit's close didn't take, so we escalate to
  // removing it. A closed modal is a different element next time, so it won't
  // be in this set -- no risk of skipping a fresh one.
  const closeAttempted = new WeakSet();

  function log() {
    if (DEBUG) console.log.apply(console, ["[reddit-upsell]"].concat([].slice.call(arguments)));
  }

  // Ask the main-world helper (reddit-trap-guard.js) to remove the document-level
  // wheel/touchmove scroll-trap listeners Reddit installed for this modal. We
  // must do this whenever we remove a modal node ourselves, because removing the
  // node orphans those listeners and we can't reach them from the isolated world.
  function purgeScrollTrap() {
    try {
      window.dispatchEvent(new CustomEvent("daniels-ext:purge-scroll-trap"));
    } catch (e) { /* ignore */ }
  }

  // Fallback only: replicate the cleanup Reddit's own close performs, for the
  // case where we had to remove the node ourselves.
  function stripScrollLock() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const c of LOCK_CLASSES) el.classList.remove(c);
      if (el.style.overflow === "hidden") el.style.overflow = "";
      if (el.style.position === "fixed") el.style.position = "";
      if (el.style.paddingRight) el.style.paddingRight = "";
    }
  }

  // Text/label that identifies a control as "close/dismiss this modal". We
  // only auto-click controls that clearly say so -- clicking a mystery button
  // in an upsell (e.g. "Sign Up") would be worse than the scroll lock.
  const CLOSE_TEXT = /\b(close|dismiss|not now|no thanks|maybe later)\b/;

  // Decide whether a single element is unambiguously a close control, by its
  // accessible label, tooltip, class names, common data-* test ids, or the
  // dedicated faceplate-close-button element.
  function isCloseControl(el) {
    if (el.tagName.toLowerCase() === "faceplate-close-button") return true;
    const attrs = (
      (el.getAttribute("aria-label") || "") + " " +
      (el.getAttribute("title") || "") + " " +
      (el.getAttribute("data-testid") || "") + " " +
      (el.getAttribute("data-test-id") || "") + " " +
      (el.getAttribute("name") || "") + " " +
      (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "")
    ).toLowerCase();
    if (CLOSE_TEXT.test(attrs)) return true;
    const text = (el.textContent || "").trim().toLowerCase();
    if (text && CLOSE_TEXT.test(text)) return true;
    return false;
  }

  // Search a subtree (including shadow roots) for a control that closes the
  // modal. Scoped to the modal's own dialog/wrapper, so this stays cheap.
  function searchCloseButton(scope) {
    if (scope.shadowRoot) {
      const inShadow = searchCloseButton(scope.shadowRoot);
      if (inShadow) return inShadow;
    }
    const candidates = scope.querySelectorAll(
      "button, [role='button'], a, faceplate-close-button, [aria-label], [data-testid]"
    );
    for (const el of candidates) {
      if (isCloseControl(el)) return el;
      if (el.shadowRoot) {
        const inShadow = searchCloseButton(el.shadowRoot);
        if (inShadow) return inShadow;
      }
    }
    return null;
  }

  // Diagnostic: summarize the modal's structure so an un-closable variant can
  // be understood from the console without a live repro. Logged only when our
  // clean-close paths all fail.
  function describeModal(modal) {
    const chain = [];
    let node = modal;
    let depth = 0;
    while (node && depth < 8) {
      chain.push(
        node.tagName.toLowerCase() +
        (node.id ? "#" + node.id : "") +
        (node.getAttribute && node.getAttribute("open") !== null ? "[open]" : "") +
        (typeof node.close === "function" ? "{close()}" : "") +
        (node.shadowRoot ? "{shadow}" : "")
      );
      node = node.parentElement || (node.getRootNode && node.getRootNode().host);
      depth++;
    }
    const wrapper = modal.closest("dialog, faceplate-dialog") || modal;
    const buttons = [];
    const collect = (root) => {
      root.querySelectorAll("button, [role='button'], a, faceplate-close-button").forEach((b) => {
        buttons.push({
          tag: b.tagName.toLowerCase(),
          ariaLabel: b.getAttribute("aria-label") || null,
          testid: b.getAttribute("data-testid") || null,
          cls: (typeof b.className === "string" ? b.className : "") || null,
          text: (b.textContent || "").trim().slice(0, 30) || null,
          hasIcon: !!b.querySelector("svg, use, faceplate-icon"),
        });
        if (b.shadowRoot) collect(b.shadowRoot);
      });
      if (root.shadowRoot) collect(root.shadowRoot);
    };
    collect(wrapper);
    return { ancestors: chain, buttonCount: buttons.length, buttons: buttons.slice(0, 25) };
  }

  function findCloseButton(modal) {
    // Prefer the modal's own dialog/wrapper so a header "X" that's a sibling of
    // the modal content is in scope; fall back to the modal element itself.
    const wrapper = modal.closest("dialog, faceplate-dialog") || modal;
    return searchCloseButton(wrapper);
  }

  function dismiss() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Already asked Reddit to close this exact element and it's still here:
    // Reddit's close didn't take. Remove it and clean up what we can.
    if (closeAttempted.has(modal)) {
      log("close did not take; removing node + stripping lock");
      const wrapper = modal.closest("faceplate-dialog");
      (wrapper || modal).remove();
      stripScrollLock();
      purgeScrollTrap();
      return;
    }

    log("upsell detected; attempting clean dismiss");

    // 1. Native <dialog> wrapper -> close via API (runs Reddit's teardown,
    //    removing its scroll-trap listeners and lock class).
    const dialog = modal.closest("dialog");
    if (dialog && dialog.open) {
      closeAttempted.add(modal);
      try { dialog.close(); log("closed native <dialog>"); return; } catch (e) { /* fall through */ }
    }

    // 2. Reddit's custom dialog element.
    const faceplate = modal.closest("faceplate-dialog");
    if (faceplate && typeof faceplate.close === "function") {
      closeAttempted.add(modal);
      try { faceplate.close(); log("closed <faceplate-dialog>"); return; } catch (e) { /* fall through */ }
    }

    // 3. Click Reddit's own Close button so it tears down cleanly.
    const closeBtn = findCloseButton(modal);
    if (closeBtn) {
      closeAttempted.add(modal);
      try { closeBtn.click(); log("clicked Reddit's Close button"); return; } catch (e) { /* fall through */ }
    }

    // 4. No close affordance found: remove the node and strip the lock. This
    //    can orphan Reddit's scroll-trap listeners, so it's genuinely the last
    //    resort -- but it's better than a hidden, un-closable trap.
    log("no close affordance found; removing node + stripping lock");
    // Dump the structure so we can learn this variant's real close path. This
    // is the branch that orphans the scroll trap, so knowing the DOM here is
    // what lets us add a proper clean-close path and stop landing here.
    try { log("structure:", JSON.stringify(describeModal(modal))); } catch (e) { /* ignore */ }
    (faceplate || modal).remove();
    stripScrollLock();
    purgeScrollTrap();
  }

  // A cheap O(1) poll: getElementById costs nothing, and the modal only has to
  // be caught within a fraction of a second (CSS already hides it on sight).
  setInterval(dismiss, 500);
  // Catch a modal that popped up while the tab was hidden, the moment we return.
  document.addEventListener("visibilitychange", dismiss);
  dismiss();

  log("content script loaded");
})();
