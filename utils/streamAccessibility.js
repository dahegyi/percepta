/**
 * Stream Accessibility Utility
 * Manages ARIA live regions and screen reader announcements for streaming AI responses
 */

// Accessibility configuration
const ACCESSIBILITY_CONFIG = {
  // Verbosity modes control how much content is announced
  verbosityModes: {
    short: {
      // Only announce start/end of streaming
      announceChunks: false,
      announceStart: true,
      announceComplete: true,
      liveRegionMode: "polite",
    },
    normal: {
      // Announce periodically during streaming
      announceChunks: true,
      chunkInterval: 3000, // Announce every 3 seconds
      announceStart: true,
      announceComplete: true,
      liveRegionMode: "polite",
    },
    detailed: {
      // Announce more frequently
      announceChunks: true,
      chunkInterval: 1500, // Announce every 1.5 seconds
      announceStart: true,
      announceComplete: true,
      liveRegionMode: "polite",
    },
  },
};

// Current verbosity mode (can be configured via settings)
let currentVerbosity = "normal";

// Track active streaming states per message element
const streamingStates = new WeakMap();

/**
 * Set the verbosity mode for screen reader announcements
 * @param {string} mode - One of: "short", "normal", "detailed"
 */
export function setAccessibilityVerbosity(mode) {
  if (ACCESSIBILITY_CONFIG.verbosityModes[mode]) {
    currentVerbosity = mode;
  }
}

/**
 * Get current accessibility configuration
 * @returns {Object} Current config based on verbosity mode
 */
function getConfig() {
  return ACCESSIBILITY_CONFIG.verbosityModes[currentVerbosity];
}

/**
 * Initialize accessibility for a message element that will receive streaming content
 * @param {HTMLElement} messageElement - The message container element
 * @param {Object} options - Configuration options
 * @returns {Object} Accessibility controller for this message
 */
export function initStreamingAccessibility(messageElement, options = {}) {
  if (!messageElement) return null;

  const config = getConfig();
  const isFollowup = options.isFollowup || false;

  // Find or create the message bubble (content container)
  let contentElement = messageElement.querySelector(".message-bubble");
  if (!contentElement) {
    contentElement = document.createElement("div");
    contentElement.className = "message-bubble";
    messageElement.appendChild(contentElement);
  }

  // Set up ARIA attributes for the message container
  // aria-live="polite" ensures updates are announced without interrupting
  contentElement.setAttribute("aria-live", config.liveRegionMode);
  // aria-atomic="true" means the entire region is announced as a whole
  // This is important when content has nested HTML elements (code, links, etc.)
  contentElement.setAttribute("aria-atomic", "true");
  // aria-relevant="additions text" announces new text as it's added
  contentElement.setAttribute("aria-relevant", "additions text");
  // Ensure the content is accessible as a single unit
  contentElement.setAttribute("role", "status");

  // Mark the message as busy while streaming
  messageElement.setAttribute("aria-busy", "true");
  messageElement.setAttribute(
    "aria-label",
    chrome.i18n.getMessage("aria_response_streaming"),
  );

  // Create a state object for this streaming session
  const state = {
    messageElement,
    contentElement,
    isStreaming: true,
    lastAnnouncementTime: 0,
    accumulatedText: "",
    config,
  };

  streamingStates.set(messageElement, state);

  // Announce streaming start if configured
  if (config.announceStart) {
    const message = isFollowup
      ? chrome.i18n.getMessage("aria_followup_streaming")
      : chrome.i18n.getMessage("aria_response_streaming");
    announceToScreenReader(message, "polite");
  }

  return {
    updateContent: (newContent) => updateStreamContent(state, newContent),
    complete: () => completeStream(state),
    cancel: () => cancelStream(state),
  };
}

/**
 * Update streaming content incrementally
 * @param {Object} state - The streaming state object
 * @param {string} newContent - The new content to add/update
 */
function updateStreamContent(state, newContent) {
  if (!state || !state.isStreaming) return;

  const { contentElement, config } = state;
  const currentTime = Date.now();

  // Store accumulated text for potential re-announcement
  state.accumulatedText = newContent;

  // Update the content element
  // Using innerHTML allows for rich content (markdown converted to HTML)
  contentElement.innerHTML = newContent;

  // Announce chunks periodically if configured
  if (config.announceChunks) {
    const timeSinceLastAnnouncement = currentTime - state.lastAnnouncementTime;

    if (timeSinceLastAnnouncement >= config.chunkInterval) {
      // Extract plain text for announcement (strip HTML)
      const plainText = contentElement.textContent || "";

      // Announce a snippet of recent content (last ~50 characters)
      const snippet = plainText.slice(-50).trim();
      if (snippet) {
        const message = chrome.i18n.getMessage("aria_streaming_snippet", [
          snippet,
        ]);
        announceToScreenReader(message, "polite");
        state.lastAnnouncementTime = currentTime;
      }
    }
  }
}

/**
 * Mark streaming as complete
 * @param {Object} state - The streaming state object
 */
function completeStream(state) {
  if (!state) return;

  const { messageElement, contentElement, config } = state;

  // Mark streaming as complete
  state.isStreaming = false;
  messageElement.setAttribute("aria-busy", "false");
  messageElement.removeAttribute("aria-label");

  // Set a descriptive label for the completed message
  // Using role="region" makes it a landmark for navigation
  messageElement.setAttribute("role", "region");
  messageElement.setAttribute(
    "aria-label",
    chrome.i18n.getMessage("aria_response_read"),
  );

  // Ensure the complete content is available for review
  // aria-live="off" after completion prevents re-announcements when user navigates
  contentElement.setAttribute("aria-live", "off");
  contentElement.removeAttribute("role");

  // Ensure nested interactive elements (links, code) are accessible
  const links = contentElement.querySelectorAll("a");
  links.forEach((link) => {
    if (!link.hasAttribute("aria-label") && link.textContent) {
      link.setAttribute("tabindex", "0");
    }
  });

  // Announce completion if configured
  if (config.announceComplete) {
    const wordCount = (contentElement.textContent || "").split(/\s+/).length;
    const message = chrome.i18n.getMessage("aria_response_complete_words", [
      wordCount.toString(),
    ]);
    announceToScreenReader(message, "polite");
  }

  // Clean up state
  streamingStates.delete(messageElement);
}

/**
 * Cancel streaming (e.g., if user navigates away or error occurs)
 * @param {Object} state - The streaming state object
 */
function cancelStream(state) {
  if (!state) return;

  const { messageElement, contentElement } = state;

  state.isStreaming = false;
  messageElement.setAttribute("aria-busy", "false");
  messageElement.removeAttribute("aria-label");
  contentElement.setAttribute("aria-live", "off");

  streamingStates.delete(messageElement);
}

/**
 * Announce text to screen readers using a live region
 * @param {string} message - The message to announce
 * @param {string} priority - "polite" or "assertive"
 */
function announceToScreenReader(message, priority = "polite") {
  // Create or reuse a global announcement region
  let announcer = document.getElementById("percepta-sr-announcer");

  if (!announcer) {
    announcer = document.createElement("div");
    announcer.id = "percepta-sr-announcer";
    announcer.className = "sr-only";
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-live", priority);
    announcer.setAttribute("aria-atomic", "true");
    // Visually hidden but accessible to screen readers
    announcer.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    document.body.appendChild(announcer);
  }

  // Update the live region priority if needed
  if (announcer.getAttribute("aria-live") !== priority) {
    announcer.setAttribute("aria-live", priority);
  }

  // Clear and set new message (triggers screen reader announcement)
  announcer.textContent = "";
  // Use setTimeout to ensure the clear is processed before the new content
  setTimeout(() => {
    announcer.textContent = message;
  }, 100);
}

/**
 * Initialize accessibility for a restored (non-streaming) message
 * @param {HTMLElement} messageElement - The message container element
 */
export function initStaticMessageAccessibility(messageElement) {
  if (!messageElement) return;

  // Find the message bubble
  const contentElement = messageElement.querySelector(".message-bubble");
  if (!contentElement) return;

  // Static messages don't need live regions
  contentElement.setAttribute("aria-live", "off");
  contentElement.removeAttribute("aria-atomic");
  contentElement.removeAttribute("aria-relevant");
  contentElement.removeAttribute("role");

  // Set up message as a readable article
  // Using role="region" with aria-label makes it a landmark for navigation
  messageElement.setAttribute("role", "region");
  messageElement.setAttribute("aria-busy", "false");
  messageElement.setAttribute(
    "aria-label",
    chrome.i18n.getMessage("aria_response_read"),
  );

  // Ensure nested interactive elements (links, code) are accessible
  // Screen readers will navigate through them naturally
  const links = contentElement.querySelectorAll("a");
  links.forEach((link) => {
    if (!link.hasAttribute("aria-label") && link.textContent) {
      // Links are already accessible, just ensure they have proper context
      link.setAttribute("tabindex", "0");
    }
  });
}

/**
 * Announce action buttons availability
 * @param {number} count - Number of action buttons available
 */
export function announceActionButtons(count) {
  if (count > 0) {
    const message =
      count === 1
        ? chrome.i18n.getMessage("aria_action_buttons_singular")
        : chrome.i18n.getMessage("aria_action_buttons_plural", [
            count.toString(),
          ]);
    announceToScreenReader(message, "polite");
  }
}

/**
 * Announce when user activates an action button
 * @param {string} actionText - The text of the action button
 */
export function announceActionActivated(actionText) {
  const message = chrome.i18n.getMessage("aria_action_activated", [actionText]);
  announceToScreenReader(message, "polite");
}

/**
 * Clean up all accessibility states (e.g., when clearing conversation)
 */
export function cleanupAccessibility() {
  // Remove the global announcer if it exists
  const announcer = document.getElementById("percepta-sr-announcer");
  if (announcer) {
    announcer.remove();
  }
}

/**
 * Get accessibility verbosity from storage
 */
export async function loadAccessibilitySettings() {
  try {
    const result = await chrome.storage.sync.get(["accessibilityVerbosity"]);
    if (result.accessibilityVerbosity) {
      setAccessibilityVerbosity(result.accessibilityVerbosity);
    }
  } catch (error) {
    console.warn("Could not load accessibility settings:", error);
  }
}

/**
 * Save accessibility verbosity to storage
 * @param {string} mode - The verbosity mode to save
 */
export async function saveAccessibilitySettings(mode) {
  try {
    await chrome.storage.sync.set({ accessibilityVerbosity: mode });
    setAccessibilityVerbosity(mode);
  } catch (error) {
    console.warn("Could not save accessibility settings:", error);
  }
}
