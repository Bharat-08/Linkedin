//popup.js
document.addEventListener('DOMContentLoaded', () => {
    const statusMessageElement = document.getElementById('status-message');
    // NEW: Get the button from the HTML
    const startScrapeBtn = document.getElementById('startScrapeBtn');

    // NEW: Add a click listener to the button
    if (startScrapeBtn) {
        startScrapeBtn.addEventListener('click', () => {
            // Find the current active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];

                // Check if we are on a LinkedIn profile page before starting
                if (activeTab && activeTab.url && activeTab.url.includes("linkedin.com/in/")) {
                    console.log(`Sending START_INITIAL_SCRAPE to tab ${activeTab.id}`);
                    statusMessageElement.textContent = 'Starting scrape...';
                    startScrapeBtn.disabled = true; // Disable button after click

                    // Send the message to the content script to start the process
                    chrome.tabs.sendMessage(activeTab.id, { type: "START_INITIAL_SCRAPE" });
                } else {
                    statusMessageElement.textContent = 'Please navigate to a LinkedIn profile page.';
                }
            });
        });
    }

    // This part of the code remains the same
    const updateStatus = () => {
        chrome.storage.local.get(['status'], (result) => {
            if (chrome.runtime.lastError) {
                statusMessageElement.textContent = 'Error reading status.';
                console.error(chrome.runtime.lastError);
            } else {
                // Don't overwrite the initial "Starting..." message immediately
                if (result.status && statusMessageElement.textContent.includes('Starting...')) {
                    // Do nothing, wait for the next update
                } else {
                     statusMessageElement.textContent = result.status || 'Status unknown.';
                }
            }
        });
    };

    updateStatus();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.status) {
            updateStatus();
            startScrapeBtn.disabled = false; // Re-enable button on new status
        }
    });
});