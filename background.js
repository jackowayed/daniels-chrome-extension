// Close the tab that sends a `closeme` message
chrome.runtime.onMessage.addListener(({ type }, sender, sendResponse) => {
    if (type === "closeme") {
        chrome.tabs.remove(sender.tab.id);
    }
});