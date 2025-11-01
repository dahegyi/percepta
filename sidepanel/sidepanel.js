/**
 * Percepta Side Panel
 * Handles UI logic and communication with the background script
 */

import { applyFontSize, DEFAULT_SETTINGS } from "../constants.js";
import { linkWikipediaEntities } from "../utils/wikiLinker.js";
import { initWikiPreviews, removeWikiTooltip } from "../utils/wikiPreview.js";
import { initStreamingAccessibility } from "../utils/streamAccessibility.js";

// State management
let currentActiveTabId = null; // Which tab is currently active in the browser
let conversationsByTab = new Map(); // Map of tabId -> conversation state
let currentAccessibilityController = null;
let idlePromptTimer = null;
let lastActivityTime = Date.now();
let idlePromptElement = null;
let autoResizeTextarea = null; // Function to resize the textarea

/**
 * Get or create conversation state for a tab
 */
function getTabState(tabId) {
  if (!conversationsByTab.has(tabId)) {
    conversationsByTab.set(tabId, {
      hasActiveConversation: false,
      messages: [],
      isStreaming: false,
      hasThinkingIndicator: false, // Track if thinking indicator is shown
    });
  }
  return conversationsByTab.get(tabId);
}

/**
 * Get current active tab's state
 */
function getCurrentTabState() {
  if (!currentActiveTabId) return null;
  return getTabState(currentActiveTabId);
}

/**
 * Update input state based on current tab's streaming/thinking status
 */
function updateInputState() {
  const input = document.getElementById("inputField");
  const sendBtn = document.getElementById("sendBtn");

  const currentTabState = getCurrentTabState();
  const shouldDisable =
    currentTabState &&
    (currentTabState.isStreaming || currentTabState.hasThinkingIndicator);

  if (input) input.disabled = shouldDisable;
  if (sendBtn) sendBtn.disabled = shouldDisable;
}

/**
 * Get user's theme preference from storage
 */
async function getUserTheme() {
  try {
    let result;
    try {
      result = await chrome.storage.sync.get(["colorScheme"]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.sync:", storageError);
      return DEFAULT_SETTINGS.colorScheme;
    }
    return result.colorScheme || DEFAULT_SETTINGS.colorScheme;
  } catch (error) {
    console.error("Error getting theme preference:", error);
    return DEFAULT_SETTINGS.colorScheme;
  }
}

/**
 * Apply theme to the document
 */
function applyTheme(theme) {
  if (theme === "auto") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

/**
 * Get user's font size preference from storage
 */
async function getUserFontSize() {
  try {
    let result;
    try {
      result = await chrome.storage.sync.get(["fontSize"]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.sync:", storageError);
      return DEFAULT_SETTINGS.fontSize;
    }
    return result.fontSize || DEFAULT_SETTINGS.fontSize;
  } catch (error) {
    console.error("Error getting font size preference:", error);
    return DEFAULT_SETTINGS.fontSize;
  }
}

/**
 * Markdown to HTML converter
 */
function markdownToHtml(markdown) {
  if (!markdown) return "";

  // SECURITY: Escape all HTML tags first to prevent XSS and unintended rendering
  let html = escapeHtml(markdown);

  // Process code blocks FIRST to protect their content
  const codeBlockPlaceholders = [];
  html = html.replace(/```(\w+)?\n([\s\S]+?)```/g, (match, lang, code) => {
    const placeholder = `\x00CODEBLOCK${codeBlockPlaceholders.length}\x00`;
    // Code is already escaped, keep it that way
    codeBlockPlaceholders.push(`<pre><code>${code.trim()}</code></pre>`);
    return placeholder;
  });

  // Process inline code (already escaped)
  const inlineCodePlaceholders = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const placeholder = `\x00INLINECODE${inlineCodePlaceholders.length}\x00`;
    // Code is already escaped, keep it that way
    inlineCodePlaceholders.push(`<code>${code}</code>`);
    return placeholder;
  });

  // Process links - protect URLs from markdown formatting
  const linkPlaceholders = [];
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const placeholder = `\x00LINKPLACEHOLDER${linkPlaceholders.length}\x00`;
    // text and url are already escaped, use them safely
    linkPlaceholders.push({ text, url });
    return placeholder;
  });

  // Now process bold and italic (safe from URLs and code)
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Restore links with proper HTML
  linkPlaceholders.forEach((link, index) => {
    const placeholder = `\x00LINKPLACEHOLDER${index}\x00`;
    html = html.replace(
      placeholder,
      `<a href="${link.url}" target="_blank" rel="noopener noreferrer">${link.text}</a>`,
    );
  });

  // Restore inline code
  inlineCodePlaceholders.forEach((code, index) => {
    const placeholder = `\x00INLINECODE${index}\x00`;
    html = html.replace(placeholder, code);
  });

  // Restore code blocks
  codeBlockPlaceholders.forEach((code, index) => {
    const placeholder = `\x00CODEBLOCK${index}\x00`;
    html = html.replace(placeholder, code);
  });

  // Process lists
  html = html.replace(/^\s*[-*+]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>");
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>)/s, "<ol>$1</ol>");

  // Process paragraphs
  html = html
    .split("\n\n")
    .map((para) => {
      if (
        !para.startsWith("<") &&
        para.trim() &&
        !para.match(/^[-*+]\s/) &&
        !para.match(/^\d+\.\s/)
      ) {
        return `<p>${para}</p>`;
      }
      return para;
    })
    .join("\n");

  return html;
}

/**
 * Escape HTML attribute values
 */
function escapeHtmlAttr(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape HTML content
 */
function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Parse actions from text
 */
function parseActions(text, isActionButtons = false) {
  let actions = null;

  if (isActionButtons) {
    const buttonRegex = /perceptaActions:\s*\[(.*?)\]/s;
    const buttonMatch = text.match(buttonRegex);

    if (buttonMatch) {
      const arrayContent = buttonMatch[1];
      // Updated regex to handle apostrophes and quotes inside strings
      // Matches strings in quotes, allowing escaped quotes and apostrophes inside
      const items = arrayContent.match(
        /"([^"\\]*(\\.[^"\\]*)*)"|'([^'\\]*(\\.[^'\\]*)*)'/g,
      );

      if (items) {
        actions = items.map((item) => {
          // Remove outer quotes and unescape any escaped characters
          const content = item.slice(1, -1);
          return content.replace(/\\(.)/g, "$1");
        });
      }
    }
  }

  // Always remove perceptaActions from display text
  const actionRegex = /perceptaActions:\s*\[(.*?)\]/s;
  let cleanedText = text.replace(actionRegex, "").trim();

  return {
    text: cleanedText,
    actions: actions,
  };
}

/**
 * Show typing indicator
 */
function showTypingIndicator() {
  const typingIndicator = document.querySelector(".typing-indicator");
  if (typingIndicator) {
    typingIndicator.style.display = "flex";
    typingIndicator.setAttribute("aria-hidden", "false");
  }

  // Mark that this tab has thinking indicator
  if (currentActiveTabId) {
    const tabState = getTabState(currentActiveTabId);
    tabState.hasThinkingIndicator = true;
    updateInputState();
  }
}

/**
 * Hide typing indicator
 */
function hideTypingIndicator() {
  const typingIndicator = document.querySelector(".typing-indicator");
  if (typingIndicator) {
    typingIndicator.style.display = "none";
    typingIndicator.setAttribute("aria-hidden", "true");
  }

  // Mark that this tab no longer has thinking indicator
  if (currentActiveTabId) {
    const tabState = getTabState(currentActiveTabId);
    tabState.hasThinkingIndicator = false;
    updateInputState();
  }
}

/**
 * Add user message to conversation
 */
function addUserMessage(text) {
  const conversation = document.querySelector(".conversation");
  if (!conversation) return;

  // Remove idle prompt if it exists
  removeIdlePrompt();

  // Reset idle timer
  resetIdleTimer();

  const userMsg = document.createElement("div");
  userMsg.className = "message user";
  userMsg.innerHTML = `
    <div class="message-bubble">${text}</div>
  `;
  conversation.appendChild(userMsg);

  // Scroll to bottom
  scrollToBottom();
}

/**
 * Remove idle prompt if it exists
 */
function removeIdlePrompt() {
  if (idlePromptElement) {
    idlePromptElement.remove();
    idlePromptElement = null;
  }
}

/**
 * Get a random idle prompt message
 */
function getRandomIdlePrompt() {
  const prompts = [
    "idle_prompt_1",
    "idle_prompt_2",
    "idle_prompt_3",
    "idle_prompt_4",
    "idle_prompt_5",
    "idle_prompt_6",
  ];
  const randomIndex = Math.floor(Math.random() * prompts.length);
  const promptKey = prompts[randomIndex];
  return chrome.i18n.getMessage(promptKey) || prompts[randomIndex];
}

/**
 * Show idle prompt message
 */
function showIdlePrompt() {
  const conversation = document.querySelector(".conversation");
  if (!conversation) return;

  // Don't show if there's already an idle prompt
  if (idlePromptElement) return;

  // Don't show if there's a typing indicator
  const typingIndicator = document.querySelector(".typing-indicator");
  if (typingIndicator && typingIndicator.style.display !== "none") return;

  // Get random prompt message
  const promptText = getRandomIdlePrompt();

  // Create idle prompt element
  idlePromptElement = document.createElement("div");
  idlePromptElement.className = "message assistant idle-prompt";
  idlePromptElement.dataset.idlePrompt = "true";
  idlePromptElement.innerHTML = `
    <div class="message-bubble"><i>${escapeHtml(promptText)}</i></div>
  `;
  conversation.appendChild(idlePromptElement);

  // Scroll to bottom
  scrollToBottom();
}

/**
 * Reset idle timer
 */
function resetIdleTimer() {
  // Clear existing timer
  if (idlePromptTimer) {
    clearTimeout(idlePromptTimer);
    idlePromptTimer = null;
  }

  // Remove existing idle prompt
  removeIdlePrompt();

  // Update last activity time
  lastActivityTime = Date.now();

  // Set new timer for 5 minutes
  idlePromptTimer = setTimeout(() => {
    const timeSinceLastActivity = Date.now() - lastActivityTime;
    if (timeSinceLastActivity >= 300000) {
      showIdlePrompt();
    }
  }, 300000);
}

/**
 * Update streaming text
 */
function updateStreamingText(
  partial,
  isFollowup = false,
  isActionButtons = false,
) {
  const conversation = document.querySelector(".conversation");
  if (!conversation) return;

  // Remove idle prompt when assistant starts responding
  removeIdlePrompt();

  // Reset idle timer
  resetIdleTimer();

  // For action button generation, only process if we have valid actions
  // This prevents any text from being displayed during action button streaming
  if (isActionButtons) {
    const { text: cleanedText, actions } = parseActions(
      partial,
      isActionButtons,
    );

    // Only proceed if we successfully parsed actions
    if (!actions) {
      // Still streaming, don't show anything yet
      return;
    }

    // Hide typing indicator once we have the actions
    hideTypingIndicator();

    // Get the last assistant message to append actions to
    const allAssistant = conversation.querySelectorAll(".message.assistant");
    const assistantMessage = allAssistant[allAssistant.length - 1];

    if (!assistantMessage) return;

    const existingBubble = assistantMessage.querySelector(".message-bubble");

    if (existingBubble) {
      // Check if actions already exist to prevent flicker during streaming
      const existingActions = assistantMessage.querySelector(".actions");

      // Only add buttons if they don't exist yet, or if actions have changed
      if (!existingActions) {
        // Add new actions with inline styles to prevent flicker
        const actionsHTML = `
          <div class="actions">
            ${actions
              .map(
                (action) =>
                  `<button class="action-btn" data-action="${escapeHtmlAttr(
                    action,
                  )}" style="opacity: 0; transform: translateY(10px); will-change: opacity, transform;">${escapeHtml(
                    action,
                  )}</button>`,
              )
              .join("")}
          </div>
        `;
        existingBubble.insertAdjacentHTML("afterend", actionsHTML);

        // Setup action button handlers
        setupActionButtons(assistantMessage);

        // Scroll to bottom
        scrollToBottom();
      }
    }

    return;
  }

  // Regular message handling (not action buttons)
  const { text: cleanedText, actions } = parseActions(partial, isActionButtons);

  // Hide typing indicator when message stream starts
  hideTypingIndicator();

  // Get all existing assistant messages
  const allAssistant = conversation.querySelectorAll(".message.assistant");

  // For both initial and follow-up messages, get the last incomplete message or create new
  // Find the last message that isn't marked as complete
  let assistantMessage;
  let foundIncomplete = false;
  let isNewMessage = false;
  for (let i = allAssistant.length - 1; i >= 0; i--) {
    if (allAssistant[i].dataset.streamComplete !== "true") {
      assistantMessage = allAssistant[i];
      foundIncomplete = true;
      break;
    }
  }

  // If no incomplete message found, create a new one
  if (!foundIncomplete) {
    assistantMessage = document.createElement("div");
    assistantMessage.className = "message assistant";
    conversation.appendChild(assistantMessage);
    isNewMessage = true;

    // Initialize accessibility for this new streaming message
    currentAccessibilityController = initStreamingAccessibility(
      assistantMessage,
      { isFollowup },
    );
  }

  // Remove Wikipedia markers for initial render (they'll be replaced with links later)
  const textWithoutMarkers = cleanedText.replace(
    /\[\[(?:WIKI:)?([^\]]+)\]\]/g,
    "$1",
  );

  // Render message immediately without waiting for Wikipedia links
  assistantMessage.innerHTML = `
    <div class="message-bubble">
      ${markdownToHtml(textWithoutMarkers)}
    </div>
    ${
      actions
        ? `
      <div class="actions">
        ${actions
          .map(
            (action) =>
              `<button class="action-btn" data-action="${escapeHtmlAttr(
                action,
              )}" style="opacity: 0; transform: translateY(10px); will-change: opacity, transform;">${escapeHtml(
                action,
              )}</button>`,
          )
          .join("")}
      </div>
    `
        : ""
    }
  `;

  // Setup action button handlers if actions exist
  if (actions) {
    setupActionButtons(assistantMessage);
  }

  // Scroll to bottom immediately
  scrollToBottom();

  // Update empty state
  // updateEmptyState(); // REMOVED: Function doesn't exist and was causing ReferenceError

  // Store the cleaned text for Wikipedia linking after stream completes
  // Always update to have the latest complete text (each chunk has more text)
  assistantMessage.dataset.originalText = cleanedText;
}

/**
 * Setup action button click handlers
 */
function setupActionButtons(messageElement) {
  const actionButtons = messageElement.querySelectorAll(".action-btn");
  actionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      handleActionButtonClick(action);
    });
  });
}

/**
 * Handle action button click
 */
function handleActionButtonClick(action) {
  if (!currentActiveTabId) return;

  // Add user message
  addUserMessage(action);

  // Update input state (will disable based on streaming status)
  updateInputState();

  // Show typing indicator
  showTypingIndicator();

  // Send message to background
  chrome.runtime.sendMessage({
    action: "followupQuestion",
    tabId: currentActiveTabId,
    question: action,
  });
}

/**
 * Complete streaming
 */
function completeStreaming(isFollowup = false) {
  hideTypingIndicator();

  // Mark the message as complete and process Wikipedia links
  const conversation = document.querySelector(".conversation");
  if (conversation) {
    let targetMessage = null;

    if (isFollowup) {
      const messages = conversation.querySelectorAll(".message.assistant");
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        lastMessage.dataset.streamComplete = "true";
        targetMessage = lastMessage;
      }
    } else {
      const firstMessage = conversation.querySelector(".message.assistant");
      if (firstMessage) {
        firstMessage.dataset.streamComplete = "true";
        targetMessage = firstMessage;
      }
    }

    // Now that streaming is complete, process Wikipedia links
    if (targetMessage && targetMessage.dataset.originalText) {
      const originalText = targetMessage.dataset.originalText;

      linkWikipediaEntities(originalText)
        .then((linkedText) => {
          // Check if Wikipedia linking actually added Wikipedia links
          const hasWikiLinks = linkedText.includes("wikipedia.org");

          // Only update if Wikipedia links were added
          if (hasWikiLinks) {
            const messageBubble =
              targetMessage.querySelector(".message-bubble");
            if (messageBubble) {
              messageBubble.innerHTML = markdownToHtml(linkedText);

              // Initialize Wikipedia preview tooltips for new links
              initWikiPreviews(targetMessage);
            }
          }
        })
        .catch((error) => {
          console.error("Error linking Wikipedia entities:", error);
          // No need to re-render - content is already displayed
        });
    }
  }

  // Re-enable input
  const input = document.getElementById("inputField");
  const sendBtn = document.getElementById("sendBtn");
  if (input && sendBtn) {
    input.disabled = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/**
 * Scroll to bottom of conversation
 */
function scrollToBottom() {
  const container = document.querySelector(".conversation-container");
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Load translations for a specific language
 */
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

/**
 * Get user's language preference
 */
async function getUserLanguage() {
  try {
    let result;
    try {
      result = await chrome.storage.sync.get(["language"]);
    } catch (storageError) {
      console.error(
        "Error reading language from chrome.storage.sync:",
        storageError,
      );
      return DEFAULT_SETTINGS.language;
    }
    return result.language || DEFAULT_SETTINGS.language;
  } catch (error) {
    console.error("Error getting language preference:", error);
    return DEFAULT_SETTINGS.language;
  }
}

/**
 * Apply translations to elements with data-i18n attributes
 */
async function applyTranslations() {
  // Get user's language preference
  const langCode = await getUserLanguage();
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

/**
 * Update input placeholder based on conversation state
 */
async function updateInputPlaceholder() {
  const input = document.getElementById("inputField");
  if (!input) return;

  const langCode = await getUserLanguage();
  const translations = await loadTranslations(langCode);

  const tabState = getCurrentTabState();
  const hasConversation = tabState?.hasActiveConversation || false;

  const key = hasConversation
    ? "sidepanel_input_placeholder"
    : "sidepanel_input_placeholder_no_conversation";

  const translation = translations[key];
  if (translation && translation.message) {
    input.setAttribute("placeholder", translation.message);
  }
}

/**
 * Check AI availability
 */
async function checkAIAvailability() {
  const noticeElement = document.getElementById("aiUnavailableNotice");

  try {
    // Check if LanguageModel API exists
    if (typeof self.LanguageModel === "undefined") {
      console.warn("LanguageModel API is not available");
      if (noticeElement) noticeElement.hidden = false;
      return "unavailable";
    }

    // Check availability
    const availability = await self.LanguageModel.availability();

    if (availability !== "available") {
      console.warn("AI model is not available:", availability);
      if (noticeElement) noticeElement.hidden = false;
      return availability;
    }

    // AI is available
    if (noticeElement) noticeElement.hidden = true;
    return "available";
  } catch (error) {
    console.error("Error checking AI availability:", error);
    if (noticeElement) noticeElement.hidden = false;
    return "unavailable";
  }
}

/**
 * Clear conversation
 * @param {number} tabId - Optional tab ID to clear (defaults to current active tab)
 */
async function clearConversation(tabId = null) {
  // Remove any active Wikipedia tooltips
  removeWikiTooltip();

  // Remove idle prompt
  removeIdlePrompt();

  const conversation = document.querySelector(".conversation");
  if (conversation) {
    conversation.innerHTML = "";
  }

  // Reset state for the specified tab (or current active tab)
  const targetTabId = tabId || currentActiveTabId;
  if (targetTabId) {
    const tabState = getTabState(targetTabId);
    tabState.hasActiveConversation = false;
    tabState.messages = [];
    tabState.isStreaming = false;
  }

  // Ensure input container is visible (in case an archived conversation was shown)
  const inputContainer = document.querySelector(".input-container");
  if (inputContainer) {
    inputContainer.style.display = "";
  }

  // Remove any archived notice
  const archivedNotice = document.querySelector(".archived-notice");
  if (archivedNotice) {
    archivedNotice.remove();
  }

  // Update input state based on global streaming status
  updateInputState();

  // Update placeholder to reflect no conversation state
  await updateInputPlaceholder();
}

/**
 * Restore a saved conversation
 */
async function restoreConversation(conversation, isArchived = false) {
  // Remove any active Wikipedia tooltips
  removeWikiTooltip();

  // Clear existing conversation
  await clearConversation();

  // Set current tab ID and mark as having active conversation
  if (conversation.tabId) {
    currentActiveTabId = conversation.tabId;
    const tabState = getTabState(conversation.tabId);
    tabState.hasActiveConversation = true;
  }

  const conversationEl = document.querySelector(".conversation");
  if (!conversationEl) return;

  // Restore all messages
  conversation.messages.forEach((msg, index) => {
    if (msg.role === "user") {
      // Add user message
      const userMsg = document.createElement("div");
      userMsg.className = "message user";
      userMsg.innerHTML = `
        <div class="message-bubble">${msg.content}</div>
      `;
      conversationEl.appendChild(userMsg);
    } else if (msg.role === "assistant") {
      // Add assistant message
      const assistantMsg = document.createElement("div");
      assistantMsg.className = "message assistant";
      assistantMsg.dataset.streamComplete = "true";

      // Remove Wikipedia markers for initial render (they'll be replaced with links later)
      const contentWithoutMarkers = msg.content.replace(
        /\[\[(?:WIKI:)?([^\]]+)\]\]/g,
        "$1",
      );

      // Render message immediately without Wikipedia links
      let messageHTML = `
        <div class="message-bubble">
          ${markdownToHtml(contentWithoutMarkers)}
        </div>
      `;

      // Add action buttons to first assistant message if they exist AND not archived
      if (
        !isArchived &&
        index === 0 &&
        conversation.actionButtons &&
        conversation.actionButtons.length > 0
      ) {
        messageHTML += `
          <div class="actions">
            ${conversation.actionButtons
              .map(
                (action) =>
                  `<button class="action-btn" data-action="${escapeHtmlAttr(
                    action,
                  )}">${escapeHtml(action)}</button>`,
              )
              .join("")}
          </div>
        `;
      }

      assistantMsg.innerHTML = messageHTML;
      conversationEl.appendChild(assistantMsg);

      // Setup action button handlers if they exist and not archived
      if (
        !isArchived &&
        index === 0 &&
        conversation.actionButtons &&
        conversation.actionButtons.length > 0
      ) {
        setupActionButtons(assistantMsg);
      }

      // Link Wikipedia entities asynchronously and update once ready
      linkWikipediaEntities(msg.content)
        .then((linkedContent) => {
          // Check if Wikipedia linking actually added Wikipedia links
          const hasWikiLinks = linkedContent.includes("wikipedia.org");

          // Only update if Wikipedia links were added
          if (hasWikiLinks) {
            const messageBubble = assistantMsg.querySelector(".message-bubble");
            if (messageBubble) {
              messageBubble.innerHTML = markdownToHtml(linkedContent);

              // Initialize Wikipedia preview tooltips for restored messages
              initWikiPreviews(assistantMsg);
            }
          }
        })
        .catch((error) => {
          console.error(
            "Error linking Wikipedia entities during restore:",
            error,
          );
          // No need to re-render - content is already displayed
        });
    }
  });

  const input = document.getElementById("inputField");
  const sendBtn = document.getElementById("sendBtn");
  const inputContainer = document.querySelector(".input-container");

  if (isArchived) {
    // Hide input container for archived conversations
    if (inputContainer) {
      inputContainer.style.display = "none";
    }

    // Add archived notice
    const archivedNotice = document.createElement("div");
    archivedNotice.className = "archived-notice";
    archivedNotice.innerHTML = `
      <p>${chrome.i18n.getMessage("archived_conversation_notice")}</p>
    `;
    conversationEl.appendChild(archivedNotice);
  } else {
    // Show input container for active conversations
    if (inputContainer) {
      inputContainer.style.display = "";
    }

    // Enable input for continued conversation
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
  }

  // Update placeholder for active conversation
  await updateInputPlaceholder();

  // Scroll to bottom
  scrollToBottom();

  // Reset idle timer for active conversations (not archived)
  if (!isArchived) {
    resetIdleTimer();
  }

  // Save the restored conversation to the tab's state
  if (conversation.tabId) {
    const tabState = getTabState(conversation.tabId);
    tabState.conversationHTML = conversationEl.innerHTML;
    tabState.hasActiveConversation = true;
  }
}

/**
 * Initialize side panel
 */
async function initializeSidePanel() {
  // Apply theme
  const theme = await getUserTheme();
  applyTheme(theme);

  // Apply font size
  const fontSize = await getUserFontSize();
  applyFontSize(fontSize);

  // Apply translations
  await applyTranslations();

  // Update input placeholder based on initial state (no conversation)
  await updateInputPlaceholder();

  // Check AI availability
  await checkAIAvailability();

  // Listen for settings changes
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "sync") {
      if (changes.colorScheme) {
        applyTheme(changes.colorScheme.newValue);
      }
      if (changes.fontSize) {
        applyFontSize(changes.fontSize.newValue);
      }
      if (changes.language) {
        // Re-apply translations when language changes
        applyTranslations();
      }
    }
  });

  // Initialize with current active tab
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (tab?.id) {
      currentActiveTabId = tab.id;

      const response = await chrome.runtime.sendMessage({
        action: "getActiveConversationForTab",
        tabId: tab.id,
      });

      if (response && response.conversation) {
        restoreConversation(response.conversation, false);
      }
    }
  } catch (error) {
    console.error("Error checking for existing conversation:", error);
  }

  // CRITICAL: Listen for tab activation changes
  // Since there's only one sidepanel per window, we must switch conversations when tabs change
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const newActiveTabId = activeInfo.tabId;

    // If switching to a different tab, save current state and load new tab's conversation
    if (currentActiveTabId !== newActiveTabId) {
      // Save current conversation HTML and thinking indicator state to the old tab's state
      if (currentActiveTabId) {
        const oldTabState = getTabState(currentActiveTabId);
        const conversationEl = document.querySelector(".conversation");
        if (conversationEl) {
          oldTabState.conversationHTML = conversationEl.innerHTML;
        }
        // Save thinking indicator state
        const typingIndicator = document.querySelector(".typing-indicator");
        oldTabState.hasThinkingIndicator =
          typingIndicator && typingIndicator.style.display !== "none";
      }

      // Update current active tab
      currentActiveTabId = newActiveTabId;

      // Load new tab's conversation from state
      const newTabState = getTabState(newActiveTabId);
      const conversationEl = document.querySelector(".conversation");
      if (conversationEl) {
        // If tab was streaming in background and has latest partial, render it
        if (newTabState.latestPartial && newTabState.isStreaming) {
          // Render the latest streaming content
          updateStreamingText(
            newTabState.latestPartial,
            newTabState.isFollowup || false,
            newTabState.isActionButtons || false,
          );

          // Save the rendered HTML
          newTabState.conversationHTML = conversationEl.innerHTML;
        } else {
          // Otherwise restore saved HTML
          conversationEl.innerHTML = newTabState.conversationHTML || "";
        }

        // Re-attach event listeners to action buttons after restoring HTML
        const actionButtons = conversationEl.querySelectorAll(".action-btn");
        if (actionButtons.length > 0) {
          actionButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
              const action = btn.dataset.action;
              handleActionButtonClick(action);
            });
          });
        }

        // Re-initialize Wikipedia preview tooltips for restored conversation
        if (newTabState.conversationHTML) {
          initWikiPreviews(conversationEl);
        }
      }

      // Restore thinking indicator state (or show if still streaming)
      const typingIndicator = document.querySelector(".typing-indicator");
      if (typingIndicator) {
        if (newTabState.hasThinkingIndicator || newTabState.isStreaming) {
          typingIndicator.style.display = "flex";
          typingIndicator.setAttribute("aria-hidden", "false");
        } else {
          typingIndicator.style.display = "none";
          typingIndicator.setAttribute("aria-hidden", "true");
        }
      }

      // Update UI
      await updateInputPlaceholder();
      updateInputState();

      // Scroll to bottom to show most recent messages
      scrollToBottom();

      // Check if the new tab has a stored conversation in the background
      try {
        const response = await chrome.runtime.sendMessage({
          action: "getActiveConversationForTab",
          tabId: newActiveTabId,
        });

        if (response?.conversation && !newTabState.hasActiveConversation) {
          restoreConversation(response.conversation, false);
        }
      } catch (error) {
        console.error("Error checking for active conversation:", error);
      }
    }
  });

  // Setup form submission
  const form = document.getElementById("inputForm");
  const input = document.getElementById("inputField");
  const sendBtn = document.getElementById("sendBtn");

  // Auto-resize textarea functionality
  if (input) {
    autoResizeTextarea = () => {
      // Reset height to recalculate
      input.style.height = "auto";

      // Get the scroll height (content height)
      const scrollHeight = input.scrollHeight;

      // Get computed styles to read max-height
      const computedStyle = window.getComputedStyle(input);
      const maxHeight = parseInt(computedStyle.maxHeight);

      // Set height to scrollHeight, capped at max-height
      if (scrollHeight <= maxHeight) {
        input.style.height = scrollHeight + "px";
        input.style.overflowY = "hidden";
      } else {
        input.style.height = maxHeight + "px";
        input.style.overflowY = "auto";
      }
    };

    // Auto-resize on input
    input.addEventListener("input", autoResizeTextarea);

    // Handle Enter key: submit on Enter, new line on Shift+Enter
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit"));
      }
    });

    // Initial resize
    autoResizeTextarea();
  }

  if (form && input) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;

      // Check if current tab has an active conversation
      const tabState = getCurrentTabState();
      const hasConversation = tabState?.hasActiveConversation || false;

      if (!hasConversation) {
        // Ensure we have currentActiveTabId
        if (!currentActiveTabId) {
          try {
            const [tab] = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            if (tab?.id) {
              currentActiveTabId = tab.id;
            }
          } catch (error) {
            console.error(
              "Error getting current tab for new conversation:",
              error,
            );
          }
        }

        // Mark that we now have an active conversation starting
        if (currentActiveTabId) {
          const state = getTabState(currentActiveTabId);
          state.hasActiveConversation = true;
          state.isStreaming = true;
        }

        // Add user message
        addUserMessage(question);

        // Clear input
        input.value = "";

        // Update input state (will disable based on streaming status)
        updateInputState();

        // Reset textarea height after clearing
        input.style.height = "auto";

        // Update placeholder for active conversation
        await updateInputPlaceholder();

        // Show typing indicator
        showTypingIndicator();

        // Send message to background to initiate screenshot with question
        chrome.runtime.sendMessage({
          action: "analyzePageWithQuestion",
          question: question,
          tabId: currentActiveTabId, // Send tabId to ensure proper routing
        });

        return;
      }

      // Normal follow-up question flow
      if (!currentActiveTabId) return;

      // Add user message
      addUserMessage(question);

      // Clear input
      input.value = "";

      // Update input state (will disable based on streaming status)
      updateInputState();

      // Reset textarea height after clearing
      input.style.height = "auto";
      // Show typing indicator
      showTypingIndicator();

      // Send message to background
      chrome.runtime.sendMessage({
        action: "followupQuestion",
        tabId: currentActiveTabId,
        question: question,
      });
    });
  }

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      // Handle conversation restoration (doesn't need active tab check)
      if (message.action === "restoreConversation") {
        restoreConversation(message.conversation, message.isArchived || false);
        sendResponse({ success: true });
        return true;
      }

      // Check if message is for currently active tab
      let isForActiveTab = false;
      if (message.tabId !== undefined && message.tabId !== null) {
        try {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          isForActiveTab = activeTab && activeTab.id === message.tabId;
        } catch (error) {
          console.error("Error checking active tab:", error);
          sendResponse({ success: true });
          return true;
        }
      }

      // Handle streaming messages - accept for ANY tab but only display for active tab
      if (message.action === "streamUpdate") {
        // Ignore messages coming directly from offscreen (they don't have context flags)
        // Only process messages forwarded by the background script (which include isFollowup/isActionButtons)
        if (
          message.isFollowup === undefined &&
          message.isActionButtons === undefined
        ) {
          // Don't respond - let the background handler process it
          return false;
        }

        // Get or create tab state for this message
        const messageTabState = getTabState(message.tabId);

        // Store the latest partial text for this tab
        messageTabState.latestPartial = message.partial;
        messageTabState.isFollowup = message.isFollowup || false;
        messageTabState.isActionButtons = message.isActionButtons || false;

        // Only update UI if this is for the active tab
        if (isForActiveTab) {
          updateStreamingText(
            message.partial,
            message.isFollowup || false,
            message.isActionButtons || false,
          );

          // Save the updated conversation to state
          const conversationEl = document.querySelector(".conversation");
          if (conversationEl) {
            messageTabState.conversationHTML = conversationEl.innerHTML;
          }
        }

        sendResponse({ success: true });
        return true;
      } else if (message.action === "streamComplete") {
        // Mark streaming as complete for the tab
        if (message.tabId) {
          const tabState = getTabState(message.tabId);
          tabState.isStreaming = false;

          // Keep latestPartial for background tabs - will be rendered when user switches back
        }

        // Only update UI if this is for the active tab
        if (isForActiveTab) {
          completeStreaming(message.isFollowup || false);

          // Save state and clear latestPartial since it's now in HTML
          if (currentActiveTabId) {
            const tabState = getTabState(currentActiveTabId);
            const conversationEl = document.querySelector(".conversation");
            if (conversationEl) {
              tabState.conversationHTML = conversationEl.innerHTML;
            }
            // Clear latestPartial since streaming is complete and rendered
            tabState.latestPartial = null;
          }

          // Update input state (may enable if no other tabs are streaming)
          updateInputState();

          // Reset idle timer after stream completes
          resetIdleTimer();
        }

        sendResponse({ success: true });
        return true;
      } else if (message.action === "clearPanel") {
        // Only clear if for active tab
        if (isForActiveTab) {
          clearConversation();
        }
        sendResponse({ success: true });
        return true;
      } else if (message.action === "setTabId") {
        // Mark tab as having active conversation and streaming
        const tabState = getTabState(message.tabId);
        tabState.hasActiveConversation = true;
        tabState.isStreaming = true;

        // Only update UI if this is for the active tab
        if (isForActiveTab) {
          // Only clear conversation if it's empty or archived
          // Don't clear if user already added a message
          const conversationEl = document.querySelector(".conversation");
          const hasMessages =
            conversationEl && conversationEl.children.length > 0;
          const archivedNotice = document.querySelector(".archived-notice");

          if (!hasMessages || archivedNotice) {
            // Clear archived conversations or empty conversations
            await clearConversation(message.tabId);
          }

          // Update currentActiveTabId
          currentActiveTabId = message.tabId;

          // Update input state (will disable since streaming started)
          updateInputState();

          // Update placeholder for active conversation
          updateInputPlaceholder();

          // Show typing indicator when a new analysis starts
          showTypingIndicator();

          // Reset idle timer for new analysis
          resetIdleTimer();
        }

        sendResponse({ success: true });
        return true;
      }

      // Don't respond to messages not meant for the side panel
      // This allows other listeners (like offscreen document) to handle them
      return false;
    },
  );

  // Initialize idle timer
  resetIdleTimer();
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeSidePanel);
} else {
  initializeSidePanel();
}
