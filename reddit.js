// Reddit shows a blocking "dynamic upsell" modal that locks page scrolling
// while it's open. Hiding it with CSS leaves the scroll lock in place, so we
// dismiss it for real: remove the modal (and its dialog wrapper) and undo any
// scroll lock Reddit applied to the page.

(function () {
  const MODAL_ID = "desktop-dynamic-upsell-dialog";

  function unlockScroll() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      if (el.style.overflow === "hidden") el.style.overflow = "";
      if (el.style.position === "fixed") el.style.position = "";
    }
  }

  function dismiss(modal) {
    // If the modal lives inside a native <dialog>, close it so Reddit's own
    // logic releases the scroll lock and page inertness.
    const nativeDialog = modal.closest("dialog");
    if (nativeDialog && typeof nativeDialog.close === "function") {
      try { nativeDialog.close(); } catch (e) { /* ignore */ }
    }

    // Remove Reddit's custom dialog wrapper if there is one, otherwise the
    // modal element itself.
    const target = modal.closest("faceplate-dialog, shreddit-async-loader") || modal;
    target.remove();

    unlockScroll();
  }

  function check(root) {
    if (root.nodeType !== 1) return;
    const modal = root.id === MODAL_ID
      ? root
      : (root.querySelector && root.querySelector("#" + MODAL_ID));
    if (modal) dismiss(modal);
  }

  // Handle it if it's already in the DOM when we run.
  check(document.documentElement);

  // ...and whenever Reddit injects it later while browsing.
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        check(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
