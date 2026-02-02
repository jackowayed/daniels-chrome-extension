// Function to click the Continue button on GitHub SSO pages
function clickContinueButton() {
    // Look for the Continue button specifically within the SSO form
    const continueButton = document.querySelector('form[action*="saml/initiate"] button[type="submit"].btn-primary');
    if (continueButton) {
        continueButton.click();
    }
}

// Run the function when the page loads
clickContinueButton();

// Also set up a MutationObserver to handle dynamic page changes
const observer = new MutationObserver((mutations) => {
    clickContinueButton();
});

// Start observing the document with the configured parameters
observer.observe(document.body, {
    childList: true,
    subtree: true
}); 