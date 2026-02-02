const toggleBtn = document.getElementById('toggle');

function updateButton(hidden) {
  if (hidden) {
    toggleBtn.textContent = 'Hidden';
    toggleBtn.className = 'toggle-btn hidden';
  } else {
    toggleBtn.textContent = 'Shown';
    toggleBtn.className = 'toggle-btn shown';
  }
}

chrome.storage.local.get(['linkedinFeedHidden'], (result) => {
  // Default to true (hidden) for backward compatibility
  const hidden = result.linkedinFeedHidden !== false;
  updateButton(hidden);
});

toggleBtn.addEventListener('click', () => {
  chrome.storage.local.get(['linkedinFeedHidden'], (result) => {
    const currentlyHidden = result.linkedinFeedHidden !== false;
    const newValue = !currentlyHidden;
    chrome.storage.local.set({ linkedinFeedHidden: newValue }, () => {
      updateButton(newValue);
    });
  });
});
