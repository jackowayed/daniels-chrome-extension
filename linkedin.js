chrome.storage.local.get(['linkedinFeedHidden'], (result) => {
  // Default to true (hidden) for backward compatibility
  const hidden = result.linkedinFeedHidden !== false;

  if (hidden) {
    const style = document.createElement('style');
    style.textContent = `
      /* Main feed container */
      [data-testid="mainFeed"] {
        display: none;
      }
      /* LinkedIn News */
      [data-view-name="news-module-storyline-card-click"],
      [data-view-name="news-module-toggle-storyline"],
      div.news-module {
        display: none;
      }
    `;
    document.head.appendChild(style);
  }
});
