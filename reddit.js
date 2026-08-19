// Reddit shows a blocking "dynamic upsell" modal that locks page scrolling
// while it's open. Just hiding it (reddit.css) leaves the scroll lock in
// place, so we dismiss it for real. This is written to be cheap and safe:
//   - Detection is document.getElementById (an O(1) lookup), NOT a
//     querySelector run per inserted node. Reddit's infinite feed injects
//     huge numbers of nodes, and the old per-node scan starved the main
//     thread the further you scrolled, freezing the tab.
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

  // Coalesced observer: the callback does almost nothing (sets a flag) and
  // does the actual O(1) check at most once per frame, so infinite-scroll
  // node churn can't starve the main thread.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      dismiss();
    });
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Backstops for cases with no DOM insertion to observe: the modal being
  // opened on an element that's already present, or appearing after the tab
  // has sat idle. getElementById is cheap enough to poll cheaply.
  setInterval(dismiss, 1000);
  document.addEventListener("visibilitychange", dismiss);
  dismiss();
})();
