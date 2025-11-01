/**
 * Cleans up session metadata when tabs close
 */

import { removeSessionMetadata } from "./sessionMetadata.js";

/**
 * Setup tab event listeners
 */
export function setupTabEventListeners() {
  // Clean up sessions when tabs are closed
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await removeSessionMetadata(tabId);
  });
}
