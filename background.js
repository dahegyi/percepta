import { ensureOffscreenDocument } from "./background/offscreenBridge.js";
import {
  createContextMenus,
  handleContextMenuClick,
} from "./background/contextMenus.js";
import { setupTabEventListeners } from "./background/tabEvents.js";
import { setupMessageListeners } from "./background/messageHandlers.js";

// Ensure offscreen document exists on startup
chrome.runtime.onStartup.addListener(async () => {
  await ensureOffscreenDocument();

  // Ensure side panel doesn't open on action click (we want popup instead)
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    // Ignore error
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    chrome.runtime.openOptionsPage();
  }

  await ensureOffscreenDocument();

  // Ensure side panel doesn't open on action click (we want popup instead)
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    // Ignore error
  }

  createContextMenus();
});

// Setup event listeners
setupTabEventListeners();
setupMessageListeners();

// Context menu handler
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// Ensure side panel behavior is set correctly on service worker initialization
(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  } catch (error) {
    // Ignore error
  }
})();
