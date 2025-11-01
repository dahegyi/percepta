/**
 * Percepta Popup
 * Handles popup UI, navigation, and settings management
 */

import {
  LANGUAGE_MAP,
  detectBrowserLanguage,
  applyFontSize,
  DEFAULT_SETTINGS,
} from "./constants.js";
import {
  getConversationsList,
  deleteConversation,
  clearAllConversations,
  getConversation,
} from "./background/conversationStorage.js";

const state = {
  currentPage: "home",
  settings: {
    language: DEFAULT_SETTINGS.language,
    theme: DEFAULT_SETTINGS.colorScheme,
    detailLevel: DEFAULT_SETTINGS.detailLevel,
    fontSize: DEFAULT_SETTINGS.fontSize,
  },
  conversations: [],
  visibleHistoryCount: 5,
  isDeletingConversation: false, // Flag to prevent reload during deletion
};

// Utility function to format time ago
async function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  // Load translations
  const langCode = state.settings.language || detectBrowserLanguage();
  const translations = await loadTranslations(langCode);

  if (minutes < 1) {
    return translations.popup_time_just_now?.message || "just now";
  } else if (minutes < 60) {
    const key =
      minutes === 1 ? "popup_time_minute_ago" : "popup_time_minutes_ago";
    const message = translations[key]?.message || "";
    return minutes === 1
      ? message
      : message.replace("$COUNT$", minutes.toString());
  } else if (hours < 24) {
    const key = hours === 1 ? "popup_time_hour_ago" : "popup_time_hours_ago";
    const message = translations[key]?.message || "";
    return hours === 1 ? message : message.replace("$COUNT$", hours.toString());
  } else {
    const key = days === 1 ? "popup_time_day_ago" : "popup_time_days_ago";
    const message = translations[key]?.message || "";
    return days === 1 ? message : message.replace("$COUNT$", days.toString());
  }
}

// Show status message to user
function showStatusMessage(message, type = "info") {
  // Could add a UI element to display this, but for now just log it
  // In a real implementation, this would show a toast/notification
}

// Check AI availability
async function checkAIAvailability() {
  const noticeElement = document.getElementById("aiUnavailableNotice");
  const describeBtn = document.getElementById("describeBtn");

  try {
    // Check if LanguageModel API exists
    if (typeof self.LanguageModel === "undefined") {
      console.warn("LanguageModel API is not available");
      if (noticeElement) noticeElement.hidden = false;
      if (describeBtn) describeBtn.disabled = true;
      return "unavailable";
    }

    // Check availability
    const availability = await self.LanguageModel.availability();

    if (availability !== "available") {
      console.warn("AI model is not available:", availability);
      if (noticeElement) noticeElement.hidden = false;
      if (describeBtn) describeBtn.disabled = true;
      return availability;
    }

    // AI is available - but also check if any tab is streaming
    if (noticeElement) noticeElement.hidden = true;

    // Check streaming status
    try {
      const response = await chrome.runtime.sendMessage({
        action: "isAnyTabStreaming",
      });
      if (describeBtn) {
        describeBtn.disabled = response && response.isStreaming;
      }
    } catch (error) {
      console.error("Error checking streaming status:", error);
      if (describeBtn) describeBtn.disabled = false;
    }

    return "available";
  } catch (error) {
    console.error("Error checking AI availability:", error);
    if (noticeElement) noticeElement.hidden = false;
    if (describeBtn) describeBtn.disabled = true;
    return "unavailable";
  }
}

// Helper function to manage tabindex for focusable elements
function updatePageTabindex() {
  const currentPageId = state.currentPage;
  document.querySelectorAll(".page").forEach((page) => {
    const pageId = page.getAttribute("data-page-id");
    const isActive = pageId === currentPageId;

    // Find all focusable elements in this page
    const focusableSelectors = [
      "button:not([disabled])",
      "[role='button']:not([disabled])",
      "a[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]",
    ];
    const focusableElements = page.querySelectorAll(
      focusableSelectors.join(", "),
    );

    focusableElements.forEach((element) => {
      if (isActive) {
        // Restore original tabindex for active page
        const originalTabindex = element.getAttribute("data-original-tabindex");
        if (originalTabindex !== null) {
          // Restore the original tabindex value
          if (originalTabindex === "") {
            // Element didn't have tabindex originally, remove it to restore native focusability
            element.removeAttribute("tabindex");
          } else {
            // Element had a specific tabindex, restore it
            element.setAttribute("tabindex", originalTabindex);
          }
          element.removeAttribute("data-original-tabindex");
        } else {
          // Element doesn't have data-original-tabindex - check if it needs restoration
          // If element has tabindex="-1" but should be focusable (native button, etc.), restore it
          const currentTabindex = element.getAttribute("tabindex");
          if (currentTabindex === "-1") {
            // Check if this is a native focusable element that shouldn't have tabindex="-1"
            // Skip elements that are meant to have tabindex="-1" (like select options)
            const isSelectOption = element.closest(".select-menu") !== null;
            if (!isSelectOption) {
              const isNativeFocusable =
                element.tagName === "BUTTON" ||
                element.tagName === "A" ||
                element.tagName === "INPUT" ||
                element.tagName === "SELECT" ||
                element.tagName === "TEXTAREA" ||
                element.getAttribute("role") === "button";
              // Only restore if it's a native focusable element that shouldn't have tabindex="-1"
              if (isNativeFocusable) {
                element.removeAttribute("tabindex");
              }
            }
          }
        }
        // If no data-original-tabindex exists and element already has correct tabindex, leave it as is
      } else {
        // Store original tabindex and set to -1 for inactive pages
        // Only process if we haven't already stored the original tabindex
        if (!element.hasAttribute("data-original-tabindex")) {
          if (element.hasAttribute("tabindex")) {
            // Store the current tabindex value
            element.setAttribute(
              "data-original-tabindex",
              element.getAttribute("tabindex"),
            );
          } else {
            // Mark that element didn't have tabindex (empty string means "no tabindex attribute")
            element.setAttribute("data-original-tabindex", "");
          }
        }
        // Set tabindex to -1 to prevent focus on inactive pages
        element.setAttribute("tabindex", "-1");
      }
    });
  });
}

// Page navigation
function navigateToPage(pageName) {
  // Blur any currently focused element to prevent focus on hidden elements
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }

  // Update body data-page attribute for CSS animations
  document.body.dataset.page = pageName;
  state.currentPage = pageName;

  // Remove hidden attribute from both pages to allow animation
  document.querySelectorAll(".page").forEach((page) => {
    page.hidden = false;
  });

  // Update tabindex for all pages
  updatePageTabindex();

  // Load content based on page
  if (pageName === "home") {
    // Reset visible count when entering home
    state.visibleHistoryCount = 5;
    loadConversations();
    // Focus the describe button after a short delay to allow page transition
    setTimeout(() => {
      const describeBtn = document.getElementById("describeBtn");
      if (describeBtn && !describeBtn.disabled) {
        describeBtn.focus();
      }
      // Ensure tabindex is updated after DOM is ready
      updatePageTabindex();
    }, 100);
  } else if (pageName === "settings") {
    loadSettings().then(() => {
      // Ensure tabindex is updated after settings are loaded
      updatePageTabindex();
      // Focus the back button after a short delay to allow page transition
      setTimeout(() => {
        const backBtn = document.getElementById("backBtn");
        if (backBtn) {
          backBtn.focus();
        }
        // Ensure tabindex is updated after DOM is ready
        updatePageTabindex();
      }, 100);
    });
  }
}

// Load and display conversations
async function loadConversations() {
  try {
    // Get active conversation IDs
    const { activeConversations } = await chrome.runtime.sendMessage({
      action: "getActiveConversations",
    });
    const activeConversationIds = new Set(activeConversations || []);

    // Get conversations list (metadata only) and filter out active ones
    const allConversations = await getConversationsList();
    state.conversations = allConversations
      .filter((conv) => !activeConversationIds.has(conv.id))
      .sort((a, b) => b.timestamp - a.timestamp); // Sort by timestamp, newest first

    const historyList = document.getElementById("historyList");

    // Clear existing items
    historyList.innerHTML = "";

    if (state.conversations.length > 0) {
      // Show only the most recent N conversations
      const conversationsToShow = state.conversations.slice(
        0,
        state.visibleHistoryCount,
      );

      // Process conversations sequentially to maintain order
      for (const conversation of conversationsToShow) {
        const li = await createConversationListItem(conversation, historyList);
        historyList.appendChild(li);
      }
    }

    // Update UI state (empty state, buttons)
    updateHistoryUIState();

    // Ensure newly created elements have correct tabindex
    updatePageTabindex();
  } catch (error) {
    console.error("Error loading conversations:", error);
  }
}

// Reopen a saved conversation
async function reopenConversation(conversationId, isArchived = false) {
  try {
    // Get full conversation data
    const conversation = await getConversation(conversationId);
    if (!conversation) {
      console.error("Conversation not found");
      return;
    }

    // Use current tab
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      console.error("No active tab");
      return;
    }

    // Open side panel
    try {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: "sidepanel/sidepanel.html",
        enabled: true,
      });

      await chrome.sidePanel.open({ windowId: tab.windowId });

      // Give panel time to initialize
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error("Error opening side panel:", error);
    }

    // Send conversation data to side panel to restore
    chrome.runtime.sendMessage({
      action: "restoreConversation",
      tabId: tab.id,
      conversation: conversation,
      isArchived: isArchived,
    });

    // Close popup
    window.close();
  } catch (error) {
    console.error("Error reopening conversation:", error);
  }
}

// Delete individual conversation
async function deleteConversationItem(conversationId) {
  try {
    // Set flag to prevent storage listener from reloading
    state.isDeletingConversation = true;

    // Get the item to delete FIRST (before any async operations)
    const historyList = document.getElementById("historyList");
    const itemToDelete = historyList.querySelector(
      `[data-conversation-id="${conversationId}"]`,
    );

    if (!itemToDelete) {
      console.error("Item to delete not found:", conversationId);
      state.isDeletingConversation = false;
      return;
    }

    // Simple fade out animation
    itemToDelete.style.opacity = "0";
    itemToDelete.style.transform = "translateX(20px)";

    // Wait for fade out
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Remove from DOM
    itemToDelete.remove();

    // Delete from storage
    await deleteConversation(conversationId);

    // Update state
    state.conversations = state.conversations.filter(
      (conv) => conv.id !== conversationId,
    );

    // Update UI state
    updateHistoryUIState();

    announceToScreenReader("Conversation deleted");

    // Clear flag after a short delay to allow storage events to settle
    setTimeout(() => {
      state.isDeletingConversation = false;
    }, 100);
  } catch (error) {
    console.error("Error deleting conversation:", error);
    state.isDeletingConversation = false;
  }
}

// Update history UI state (empty state, buttons visibility)
async function updateHistoryUIState() {
  const historyList = document.getElementById("historyList");
  const emptyState = document.getElementById("emptyState");
  const clearHistoryBtn = document.getElementById("clearHistoryBtn");
  const showMoreBtn = document.getElementById("showMoreBtn");

  const hasItems = historyList && historyList.children.length > 0;

  if (emptyState) {
    emptyState.hidden = hasItems;
  }

  if (clearHistoryBtn) {
    clearHistoryBtn.style.display = hasItems ? "" : "none";
  }

  // Check if we need to load more items to maintain minimum of 5
  const visibleCount = historyList ? historyList.children.length : 0;
  const minItems = 5;

  if (visibleCount < minItems && visibleCount < state.conversations.length) {
    // We have fewer than 5 items visible but more in state, load more
    const itemsToAdd = Math.min(
      minItems - visibleCount,
      state.conversations.length - visibleCount,
    );

    // Get the conversations to add (skip already visible ones)
    const conversationsToAdd = state.conversations.slice(
      visibleCount,
      visibleCount + itemsToAdd,
    );

    // Add them to the list
    await addConversationsToList(conversationsToAdd);
  }

  if (showMoreBtn) {
    const updatedVisibleCount = historyList ? historyList.children.length : 0;
    showMoreBtn.hidden = updatedVisibleCount >= state.conversations.length;
  }
}

// Helper function to create a single conversation list item
async function createConversationListItem(conversation, historyList) {
  const li = document.createElement("li");
  li.className = "history-item conversation-item";
  li.dataset.conversationId = conversation.id;

  // Make item keyboard navigable and accessible
  li.setAttribute("role", "button");
  li.setAttribute("tabindex", "0");

  // Create header with text and delete button
  const headerDiv = document.createElement("div");
  headerDiv.className = "history-item-header";

  // Create title node
  const titleSpan = document.createElement("span");
  titleSpan.className = "history-item-text";
  titleSpan.textContent = conversation.title;
  headerDiv.appendChild(titleSpan);

  // Add delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "history-item-delete";
  deleteBtn.setAttribute("aria-label", "Delete this conversation");
  deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteConversationItem(conversation.id);
  });
  deleteBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.stopPropagation();
    }
  });
  headerDiv.appendChild(deleteBtn);

  // Container for URL and time
  const urlTimeContainer = document.createElement("div");
  urlTimeContainer.className = "history-item-url-time";

  // Build description text for aria-label
  let descriptionParts = [conversation.title];
  const timeAgo = await formatTimeAgo(conversation.timestamp);

  // Add page domain
  if (conversation.pageUrl) {
    let hostname;
    try {
      const url = new URL(conversation.pageUrl);
      hostname = url.hostname;
      if (hostname.startsWith("www.")) {
        hostname = hostname.substring(4);
      }
    } catch {
      hostname = conversation.pageUrl;
    }
    const urlSpan = document.createElement("span");
    urlSpan.className = "conversation-url";
    urlSpan.textContent = hostname;
    urlTimeContainer.appendChild(urlSpan);
    descriptionParts.push(`from ${hostname}`);
  }

  const timeSpan = document.createElement("span");
  timeSpan.className = "history-item-time";
  timeSpan.textContent = timeAgo;
  urlTimeContainer.appendChild(timeSpan);
  descriptionParts.push(timeAgo);

  // Set comprehensive aria-label
  const ariaLabel = `${descriptionParts.join(
    ", ",
  )}. Press Enter or Space to open.`;
  li.setAttribute("aria-label", ariaLabel);

  // Append elements
  li.appendChild(headerDiv);
  li.appendChild(urlTimeContainer);

  // Handle click and keyboard activation
  const activateItem = () => {
    reopenConversation(conversation.id, true);
  };

  li.addEventListener("click", activateItem);

  // Keyboard navigation support
  li.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activateItem();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const items = Array.from(historyList.querySelectorAll(".history-item"));
      const currentIndex = items.indexOf(li);
      const nextIndex = (currentIndex + 1) % items.length;
      items[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(historyList.querySelectorAll(".history-item"));
      const currentIndex = items.indexOf(li);
      const prevIndex = (currentIndex - 1 + items.length) % items.length;
      items[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      const items = Array.from(historyList.querySelectorAll(".history-item"));
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const items = Array.from(historyList.querySelectorAll(".history-item"));
      items[items.length - 1]?.focus();
    }
  });

  return li;
}

// Helper function to add conversations to the list
async function addConversationsToList(conversations) {
  const historyList = document.getElementById("historyList");
  if (!historyList) return;

  // Process conversations sequentially to maintain order
  for (const conversation of conversations) {
    const li = await createConversationListItem(conversation, historyList);
    historyList.appendChild(li);
  }

  // Update tabindex for new elements
  updatePageTabindex();
}

// Clear all conversations
async function clearAllConversationsUI() {
  try {
    // Set flag to prevent storage listener from reloading
    state.isDeletingConversation = true;

    const historyList = document.getElementById("historyList");
    const items = Array.from(historyList.children);

    if (items.length === 0) {
      state.isDeletingConversation = false;
      return;
    }

    // Animate all items out with staggered timing
    items.forEach((item, index) => {
      setTimeout(() => {
        item.style.opacity = "0";
        item.style.transform = "translateX(20px)";
      }, index * 30); // Stagger by 30ms
    });

    // Wait for all animations to complete
    await new Promise((resolve) =>
      setTimeout(resolve, 200 + items.length * 30),
    );

    try {
      await clearAllConversations();
    } catch (storageError) {
      console.error("Error clearing conversations from storage:", storageError);
      showStatusMessage(
        chrome.i18n.getMessage("error_storage_failed"),
        "error",
      );
      state.isDeletingConversation = false;
      return;
    }

    // Clear the list
    historyList.innerHTML = "";
    state.conversations = [];

    // Update UI state
    updateHistoryUIState();

    announceToScreenReader(await getTranslation("popup_history_cleared"));

    // Clear flag after a short delay
    setTimeout(() => {
      state.isDeletingConversation = false;
    }, 100);
  } catch (error) {
    console.error("Error clearing conversations:", error);
    showStatusMessage(chrome.i18n.getMessage("error_generic"), "error");
    state.isDeletingConversation = false;
  }
}

// Load settings from storage
async function loadSettings() {
  try {
    let result;
    try {
      result = await chrome.storage.sync.get([
        "language",
        "colorScheme",
        "detailLevel",
        "fontSize",
      ]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.sync:", storageError);
      // Use defaults if storage fails
      result = {};
    }

    // Use saved language or detect from browser
    state.settings.language = result.language || detectBrowserLanguage();
    state.settings.theme = result.colorScheme || DEFAULT_SETTINGS.colorScheme;
    state.settings.detailLevel =
      result.detailLevel || DEFAULT_SETTINGS.detailLevel;
    state.settings.fontSize = result.fontSize || DEFAULT_SETTINGS.fontSize;

    // Update custom select displays
    updateSelectValue(
      "languageSelect",
      state.settings.language,
      LANGUAGE_MAP[state.settings.language],
    );
    updateSelectValue("themeSelect", state.settings.theme);
    updateSelectValue("detailSelect", state.settings.detailLevel);
    updateSelectValue("fontSizeSelect", state.settings.fontSize);

    // Apply theme
    applyTheme(state.settings.theme);

    // Apply font size
    applyFontSize(state.settings.fontSize);
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Update custom select value display
function updateSelectValue(selectId, value, displayText = null) {
  const valueElement = document.getElementById(`${selectId}Value`);
  if (!valueElement) return;

  if (displayText) {
    valueElement.textContent = displayText;
  } else {
    // Get display text from the option element
    const menu = document.getElementById(`${selectId}Menu`);
    const option = menu?.querySelector(`[data-value="${value}"]`);
    if (option) {
      valueElement.textContent = option.textContent;
    }
  }

  // Update aria-selected
  const menu = document.getElementById(`${selectId}Menu`);
  if (menu) {
    menu.querySelectorAll(".select-option").forEach((opt) => {
      opt.setAttribute(
        "aria-selected",
        opt.getAttribute("data-value") === value ? "true" : "false",
      );
    });
  }
}

// Save setting to storage (silently, no message)
async function saveSetting(key, value) {
  try {
    try {
      await chrome.storage.sync.set({ [key]: value });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.sync:", storageError);
      // Show error to user but continue with local state update
      showStatusMessage(
        chrome.i18n.getMessage("error_storage_failed"),
        "error",
      );
    }

    state.settings[key === "colorScheme" ? "theme" : key] = value;

    // Apply theme immediately if changed
    if (key === "colorScheme") {
      applyTheme(value);
    }

    // Apply font size immediately if changed
    if (key === "fontSize") {
      applyFontSize(value);
    }
  } catch (error) {
    console.error("Error saving setting:", error);
  }
}

// Apply theme
function applyTheme(theme) {
  if (theme === "auto") {
    // Remove data-theme attribute to use system preference
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Get translation
async function getTranslation(key) {
  try {
    const message = chrome.i18n.getMessage(key);
    return message || key;
  } catch (error) {
    console.error("Error getting translation:", error);
    return key;
  }
}

// Load translations for a specific language
async function loadTranslations(langCode) {
  try {
    const response = await fetch(`/_locales/${langCode}/messages.json`);
    if (!response.ok) {
      throw new Error(`Failed to load ${langCode} translations`);
    }
    return await response.json();
  } catch (error) {
    console.warn(
      `Could not load ${langCode} translations, falling back to English`,
    );
    const response = await fetch(`/_locales/en/messages.json`);
    return await response.json();
  }
}

// Apply translations to page
async function applyTranslations() {
  // Get user's language preference
  const langCode = state.settings.language || detectBrowserLanguage();
  const translations = await loadTranslations(langCode);

  // Translate elements with data-i18n
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const translation = translations[key];
    if (translation && translation.message) {
      element.textContent = translation.message;
    }
  });

  // Translate elements with data-i18n-aria-label
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const key = element.getAttribute("data-i18n-aria-label");
    const translation = translations[key];
    if (translation && translation.message) {
      element.setAttribute("aria-label", translation.message);
    }
  });

  // Translate elements with data-i18n-placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    const key = element.getAttribute("data-i18n-placeholder");
    const translation = translations[key];
    if (translation && translation.message) {
      element.setAttribute("placeholder", translation.message);
    }
  });
}

// Announce to screen readers
function announceToScreenReader(message) {
  const announcement = document.createElement("div");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.className = "sr-only";
  announcement.textContent = message;

  document.body.appendChild(announcement);

  setTimeout(() => {
    announcement.remove();
  }, 1000);
}

async function handleDescribePage() {
  try {
    // Check if any tab is currently streaming
    const response = await chrome.runtime.sendMessage({
      action: "isAnyTabStreaming",
    });
    if (response && response.isStreaming) {
      return; // Don't start if any tab is streaming
    }

    // Get current tab and window
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab) {
      // Open side panel first (this is a direct user gesture from popup)
      try {
        await chrome.sidePanel.setOptions({
          tabId: tab.id,
          path: "sidepanel/sidepanel.html",
          enabled: true,
        });

        await chrome.sidePanel.open({ windowId: tab.windowId });

        // Give panel time to initialize
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (error) {
        console.error("Error opening side panel:", error);
      }

      // Then trigger the analysis
      chrome.runtime.sendMessage({ action: "analyzePage" });
    }

    // Close popup after triggering
    window.close();
  } catch (error) {
    console.error("Error describing page:", error);
  }
}

function openSetupWizard() {
  chrome.runtime.openOptionsPage();
}

// Setup custom select
function setupCustomSelect(selectId, onChangeFn) {
  const trigger = document.getElementById(`${selectId}Trigger`);
  const menu = document.getElementById(`${selectId}Menu`);
  /** @type {NodeListOf<HTMLElement>|undefined} */
  const options = menu?.querySelectorAll(".select-option");

  if (!trigger || !menu || !options) return;

  const openMenu = () => {
    trigger.setAttribute("aria-expanded", "true");

    // Temporarily show menu to measure its actual height
    menu.style.visibility = "hidden";
    menu.classList.add("open");
    const menuHeight = menu.offsetHeight;
    menu.classList.remove("open");
    menu.style.visibility = "";

    // Check if there's enough space below
    const triggerRect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    // If not enough space below but enough space above, open upward
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      menu.classList.add("open-upward");
    } else {
      menu.classList.remove("open-upward");
    }

    menu.classList.add("open");
    // Focus first selected option or first option
    /** @type {HTMLElement|null} */
    const selectedOption =
      menu.querySelector('[aria-selected="true"]') || options[0];
    selectedOption?.focus();
  };

  const closeMenu = () => {
    trigger.setAttribute("aria-expanded", "false");
    menu.classList.remove("open");
  };

  const toggleMenu = () => {
    const isExpanded = trigger.getAttribute("aria-expanded") === "true";
    if (isExpanded) closeMenu();
    else openMenu();
  };

  trigger.addEventListener("click", toggleMenu);

  trigger.addEventListener("keydown", (e) => {
    /** @type {KeyboardEvent} */
    const keyEvent = e;
    if (
      keyEvent.key === "Enter" ||
      keyEvent.key === " " ||
      keyEvent.key === "ArrowDown" ||
      keyEvent.key === "ArrowUp"
    ) {
      keyEvent.preventDefault();
      toggleMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener("click", () => {
      const value = option.getAttribute("data-value");

      options.forEach((opt) => opt.setAttribute("aria-selected", "false"));
      option.setAttribute("aria-selected", "true");

      // Update display text
      const valueElement = document.getElementById(`${selectId}Value`);
      if (valueElement) {
        valueElement.textContent = option.textContent;
      }

      closeMenu();
      trigger.focus();

      // Call onChange callback
      if (onChangeFn) {
        onChangeFn(value);
      }
    });

    option.addEventListener("keydown", (e) => {
      /** @type {KeyboardEvent} */
      const keyEvent = e;
      const currentIndex = Array.from(options).indexOf(option);

      const key = keyEvent.key;

      if (key === "Enter" || key === " ") {
        keyEvent.preventDefault();
        option.click();
      } else if (key === "Escape") {
        closeMenu();
        trigger.focus();
      } else if (key === "ArrowDown") {
        keyEvent.preventDefault();
        const nextIndex = (currentIndex + 1) % options.length;
        options[nextIndex].focus();
      } else if (key === "ArrowUp") {
        keyEvent.preventDefault();
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        options[prevIndex].focus();
      } else if (key === "Home") {
        keyEvent.preventDefault();
        options[0].focus();
      } else if (key === "End") {
        keyEvent.preventDefault();
        options[options.length - 1].focus();
      }
    });
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!trigger.contains(e.target) && !menu.contains(e.target)) {
      closeMenu();
    }
  });
}

// Listen for storage changes
function setupStorageListener() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    // Update theme if it changed
    if (areaName === "sync" && changes.colorScheme) {
      state.settings.theme =
        changes.colorScheme.newValue || DEFAULT_SETTINGS.colorScheme;
      applyTheme(state.settings.theme);
    }

    // Update font size if it changed
    if (areaName === "sync" && changes.fontSize) {
      state.settings.fontSize =
        changes.fontSize.newValue || DEFAULT_SETTINGS.fontSize;
      applyFontSize(state.settings.fontSize);
    }

    // Update language if it changed
    if (areaName === "sync" && changes.language) {
      state.settings.language =
        changes.language.newValue || DEFAULT_SETTINGS.language;
      await applyTranslations();
    }

    // Reload conversations if they changed (in case another window modified them)
    // But skip if we're currently deleting to avoid interrupting the animation
    if (
      areaName === "local" &&
      changes.conversations &&
      state.currentPage === "home" &&
      !state.isDeletingConversation
    ) {
      loadConversations();
    }
  });
}

// Initialize event listeners
function initializeEventListeners() {
  // Navigation buttons
  document.getElementById("settingsBtn")?.addEventListener("click", () => {
    navigateToPage("settings");
  });

  document.getElementById("backBtn")?.addEventListener("click", () => {
    navigateToPage("home");
  });

  // Home page buttons
  document.getElementById("describeBtn")?.addEventListener("click", () => {
    handleDescribePage();
  });

  document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
    clearAllConversationsUI();
  });

  document.getElementById("showMoreBtn")?.addEventListener("click", () => {
    state.visibleHistoryCount += 5;

    if (state.visibleHistoryCount >= state.conversations.length) {
      state.visibleHistoryCount = state.conversations.length;
    }

    loadConversations();
  });

  // Setup custom selects
  setupCustomSelect("languageSelect", async (value) => {
    await saveSetting("language", value);
    updateSelectValue("languageSelect", value, LANGUAGE_MAP[value]);
    // Apply translations to update all text on the page
    await applyTranslations();
    // Update the display values for other selects to use the new language
    updateSelectValue("themeSelect", state.settings.theme);
    updateSelectValue("detailSelect", state.settings.detailLevel);
    updateSelectValue("fontSizeSelect", state.settings.fontSize);
  });

  setupCustomSelect("themeSelect", (value) => {
    saveSetting("colorScheme", value);
  });

  setupCustomSelect("detailSelect", (value) => {
    saveSetting("detailLevel", value);
  });

  setupCustomSelect("fontSizeSelect", (value) => {
    saveSetting("fontSize", value);
  });

  // Open setup wizard
  document.getElementById("openSetupBtn")?.addEventListener("click", () => {
    openSetupWizard();
  });
}

// Initialize popup
async function initialize() {
  // Load initial settings to apply theme and font size
  await loadSettings();

  // Apply translations
  await applyTranslations();

  // Check AI availability
  await checkAIAvailability();

  // Initialize event listeners
  initializeEventListeners();

  // Setup storage change listener
  setupStorageListener();

  // Load initial page content
  navigateToPage("home");

  // Focus the describe button when popup opens
  const describeBtn = document.getElementById("describeBtn");
  if (describeBtn && !describeBtn.disabled) {
    describeBtn.focus();
  }
}

// Run initialization when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
