// Reddit shows a blocking "dynamic upsell" modal that locks page scrolling
// while it's open. Just hiding it (reddit.css) leaves the scroll lock in
// place, so we dismiss it for real. This is written to be cheap and safe:
//   - Detection is document.getElementById (an O(1) lookup) on a plain
//     poll. We deliberately do NOT use a MutationObserver: on Reddit's
//     infinite feed the browser allocates a MutationRecord for every node
//     inserted/removed anywhere in the page, and that record churn -- not
//     any work in our callback -- starved the main thread the further you
//     scrolled (or after the tab sat idle and a mutation burst arrived),
//     freezing the tab. The CSS rule hides the modal instantly; the poll
//     only needs to release the scroll lock, which a sub-second delay
//     handles imperceptibly.
//   - We only ever touch the modal itself (and its own dialog wrapper). We
//     never remove feed containers like <shreddit-async-loader>, which would
//     break Reddit's own scrolling.

(function () {
  const MODAL_ID = "desktop-dynamic-upsell-dialog";

  function clearScrollLock() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (el.style.overflow === "hidden") el.style.overflow = "";
      if (el.style.position === "fixed") el.style.position = "";
    }
  }

  function dismiss() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // If a native <dialog> wraps it, closing it releases the browser's scroll
    // lock / page inertness. This is the safe, intended API.
    const dialog = modal.closest("dialog");
    if (dialog && dialog.open) {
      try { dialog.close(); } catch (e) { /* ignore */ }
    }

    // Reddit's custom dialog element, if that's the wrapper instead.
    const faceplate = modal.closest("faceplate-dialog");
    if (faceplate && typeof faceplate.close === "function") {
      try { faceplate.close(); } catch (e) { /* ignore */ }
    }

    // Remove only the modal (or its own dialog wrapper) so it can't reappear
    // or be reprocessed -- never a feed/loader ancestor.
    (faceplate || modal).remove();

    // Safety net for when the lock was applied via body/html styles rather
    // than a native <dialog>.
    clearScrollLock();
  }

  // A cheap O(1) poll is all we need: getElementById costs nothing, and the
  // modal only has to be caught within a fraction of a second (CSS already
  // hides it on sight). No MutationObserver, so infinite-scroll node churn
  // can never reach us.
  setInterval(dismiss, 500);
  // Catch a modal that popped up while the tab was hidden, the moment we
  // return -- before the next poll tick.
  document.addEventListener("visibilitychange", dismiss);
  dismiss();
})();
