setTimeout(function () {
    // Content scripts can't access the chrome.tabs API, 
    // so ask a Service Worker (background.js) to do it.
    chrome.runtime.sendMessage({ type: "closeme" }, () => { });
}, 2000);