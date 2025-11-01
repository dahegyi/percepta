/**
 * Handles runtime messages for follow-up questions and page analysis
 */

import { sendMessageToOffscreen } from "./offscreenBridge.js";
import {
  getSessionMetadata,
  storeAnalysisResult,
  storeSessionMetadata,
} from "./sessionMetadata.js";
import {
  generateFromScreenshot,
  generateFromScreenshotWithQuestion,
} from "./screenshot.js";
import { ACTION_BUTTON_PROMPT, TITLE_GENERATION_PROMPT } from "../constants.js";
import {
  storeConversation,
  updateConversation,
  parseTitleFromResponse,
  parseActionsFromResponse,
  getConversation,
} from "./conversationStorage.js";

// Track streaming state per tab
const streamingState = new Map();

// Track active (non-archived) conversations by tab ID
const activeConversations = new Map(); // tabId -> conversationId

// Use chrome.storage.session for conversation data to persist across service worker restarts
const CONV_DATA_PREFIX = "convData_";

// Helper functions for conversation data
async function getConversationData(tabId) {
  try {
    const key = `${CONV_DATA_PREFIX}${tabId}`;
    const result = await chrome.storage.session.get([key]);
    return result[key] || null;
  } catch (error) {
    console.error(
      "Error reading conversation data from chrome.storage.session:",
      error,
    );
    return null;
  }
}

async function setConversationData(tabId, data) {
  try {
    const key = `${CONV_DATA_PREFIX}${tabId}`;
    await chrome.storage.session.set({ [key]: data });
  } catch (error) {
    console.error(
      "Error writing conversation data to chrome.storage.session:",
      error,
    );
    // Don't throw - this is session data, not critical to fail
  }
}

async function deleteConversationData(tabId) {
  try {
    const key = `${CONV_DATA_PREFIX}${tabId}`;
    await chrome.storage.session.remove([key]);
  } catch (error) {
    console.error(
      "Error deleting conversation data from chrome.storage.session:",
      error,
    );
    // Don't throw - this is cleanup
  }
}

/**
 * Generate action buttons and title after first response completes
 */
async function generateActionButtons(tabId, fullText) {
  try {
    // Get user's language preference
    let userLanguage = "en";
    try {
      const langResult = await chrome.storage.sync.get(["language"]);
      userLanguage = langResult.language || "en";
    } catch (error) {
      console.warn("Could not get user language, defaulting to 'en':", error);
    }

    // Mark that we're generating action buttons AND title (streaming enabled)
    streamingState.set(tabId, {
      isFollowup: true,
      isActionButtons: true,
      generatingTitle: true,
    });

    // Send combined prompt for both action buttons and title

    const combinedPrompt = `${ACTION_BUTTON_PROMPT(
      userLanguage,
    )}\n\nAlso, ${TITLE_GENERATION_PROMPT(userLanguage)}`;

    sendMessageToOffscreen({
      action: "sendPrompt",
      tabId,
      prompt: [
        {
          role: "system",
          content: [{ type: "text", value: combinedPrompt }],
        },
      ],
    }).catch((error) => {
      console.error("🎯 Error generating action buttons and title:", error);
      streamingState.delete(tabId);
    });
  } catch (error) {
    console.error("🎯 Error in generateActionButtons:", error);
    streamingState.delete(tabId);
  }
}

/**
 * Save conversation with AI-generated title and first assistant message
 */
async function saveConversationWithTitle(tabId, firstResponse, titleResponse) {
  try {
    const convData = await getConversationData(tabId);
    if (!convData) {
      console.warn("💾 No conversation data found for tab:", tabId);
      return;
    }

    // Parse title from AI response
    const title = parseTitleFromResponse(titleResponse);

    // Parse action buttons from AI response
    const actionButtons = parseActionsFromResponse(titleResponse);

    // Get current tab info
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (error) {
      console.warn("💾 Could not get tab info:", error);
    }

    const conversationToStore = {
      title,
      messages: [
        {
          role: "assistant",
          content: firstResponse,
          timestamp: Date.now(),
        },
      ],
      actionButtons,
      pageUrl: tab?.url || convData.pageUrl,
      tabId,
      context: convData.context,
      imageData: convData.imageData,
      imageType: convData.imageType,
      type: convData.type || "screenshot",
    };

    // Store the conversation with the first assistant message
    const conversationId = await storeConversation(conversationToStore);

    // Update conversation data with ID for future updates
    await setConversationData(tabId, {
      ...convData,
      conversationId,
      title,
    });

    // Mark conversation as active (not archived)
    activeConversations.set(tabId, conversationId);
  } catch (error) {
    console.error("💾 Error saving conversation with title:", error);
    console.error("💾 Error stack:", error.stack);
  }
}

/**
 * Handle follow-up question
 */
async function handleFollowupQuestion(message) {
  const tabId = message.tabId
    ? parseInt(message.tabId, 10)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

  if (!tabId) {
    console.error("No tab ID available for follow-up question");
    return;
  }

  // Check if session metadata exists
  const metadata = await getSessionMetadata(tabId);
  if (!metadata) {
    console.error("No session found for follow-up question");
    return;
  }

  const question = message.question;
  if (!question) {
    return;
  }

  try {
    // Mark that we're streaming a follow-up for this tab
    streamingState.set(tabId, { isFollowup: true });

    // Store the user's question in conversation data
    const convData = await getConversationData(tabId);
    if (convData && convData.conversationId) {
      // Get existing conversation
      const conversation = await getConversation(convData.conversationId);

      if (conversation) {
        const updatedMessages = [
          ...conversation.messages,
          {
            role: "user",
            content: question,
            timestamp: Date.now(),
          },
        ];

        await updateConversation(convData.conversationId, {
          messages: updatedMessages,
        });
      }
    }

    // Send prompt to offscreen document (which will stream back)
    sendMessageToOffscreen({
      action: "sendPrompt",
      tabId,
      prompt: [
        {
          role: "user",
          content: [{ type: "text", value: question }],
        },
      ],
    }).catch((error) => {
      console.error("Error sending follow-up prompt:", error);
    });
  } catch (error) {
    console.error("Error processing follow-up question:", error);
  }
}

/**
 * Handle streaming updates from offscreen document
 */
async function handleStreamUpdate(message) {
  const { tabId, partial } = message;
  let state = streamingState.get(tabId);

  if (!state) {
    // First chunk - initialize state (only if not already set by generateActionButtons)
    streamingState.set(tabId, {
      isFollowup: false,
      initialized: true,
      isActionButtons: false,
    });
    state = streamingState.get(tabId);
  }

  // Forward the stream update to the side panel with the current state
  try {
    await chrome.runtime.sendMessage({
      action: "streamUpdate",
      tabId,
      partial,
      isFollowup: state.isFollowup || false,
      isActionButtons: state.isActionButtons || false,
    });
  } catch (error) {
    console.error("Error forwarding stream update to side panel:", error);
  }
}

/**
 * Handle stream completion
 */
async function handleStreamComplete(message) {
  const { tabId, fullText } = message;
  const state = streamingState.get(tabId);

  // Handle action button and title generation completion
  if (state && state.isActionButtons && state.generatingTitle) {
    // Parse the title and save conversation
    const convData = await getConversationData(tabId);

    if (convData && !convData.conversationId) {
      // This is the first time - save with the AI-generated title
      // Get the first assistant response from the conversation data
      const firstResponse = convData.firstResponse;

      if (firstResponse) {
        await saveConversationWithTitle(tabId, firstResponse, fullText);
      } else {
        console.warn("🎯 No firstResponse found in convData");
      }
    }

    // Forward action buttons to side panel (title doesn't need to be shown)
    try {
      await chrome.runtime.sendMessage({
        action: "streamUpdate",
        tabId,
        partial: fullText,
        isFollowup: true,
        isActionButtons: true,
      });

      await chrome.runtime.sendMessage({
        action: "streamComplete",
        tabId,
        isFollowup: true,
      });
    } catch (error) {
      console.error("Error forwarding to side panel:", error);
    }

    // Clean up streaming state
    streamingState.delete(tabId);
    return;
  }

  // Handle initial response completion (first message)
  if (state && !state.isFollowup && !state.isActionButtons) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab) {
        const pageInfo = { title: tab.title, url: tab.url };

        // Store analysis result for backwards compatibility
        await storeAnalysisResult(fullText, null, pageInfo);

        // Store first response in conversation data for later saving
        const convData = await getConversationData(tabId);
        if (convData) {
          await setConversationData(tabId, {
            ...convData,
            firstResponse: fullText,
          });
        }

        // Forward to side panel
        await chrome.runtime.sendMessage({
          action: "streamComplete",
          tabId,
          isFollowup: false,
        });

        // Clean up state before starting action button/title generation
        streamingState.delete(tabId);

        // Generate action buttons and title for the first response
        await generateActionButtons(tabId, fullText);
        return;
      }
    } catch (error) {
      console.error("Error handling stream complete:", error);
    }
  }

  // Handle follow-up response completion
  if (state && state.isFollowup && !state.isActionButtons) {
    // Save assistant's response to conversation
    const convData = await getConversationData(tabId);
    if (convData && convData.conversationId) {
      try {
        const conversation = await getConversation(convData.conversationId);

        if (conversation) {
          const updatedMessages = [
            ...conversation.messages,
            {
              role: "assistant",
              content: fullText,
              timestamp: Date.now(),
            },
          ];

          await updateConversation(convData.conversationId, {
            messages: updatedMessages,
          });
        }
      } catch (error) {
        console.error("Error saving follow-up response:", error);
      }
    }

    // Forward to side panel
    try {
      await chrome.runtime.sendMessage({
        action: "streamComplete",
        tabId,
        isFollowup: true,
      });
    } catch (error) {
      console.error("Error forwarding to side panel:", error);
    }

    // Clean up state
    streamingState.delete(tabId);
    return;
  }

  // Fallback
  try {
    await chrome.runtime.sendMessage({
      action: "streamComplete",
      tabId,
      isFollowup: false,
    });
  } catch (error) {
    console.error("Error forwarding to side panel:", error);
  }
  streamingState.delete(tabId);
}

/**
 * Handle opening side panel from content script (preserves user gesture)
 */
async function handleOpenSidePanelFromPage(sender) {
  try {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    if (windowId) {
      await chrome.sidePanel.open({ windowId });
    }
  } catch (error) {
    console.error("Error opening side panel from page:", error);
  }
}

/**
 * Initialize conversation data for a new session
 */
export async function initializeConversationData(
  tabId,
  type,
  context,
  imageData,
  imageType,
  pageUrl,
) {
  await setConversationData(tabId, {
    type,
    context,
    imageData,
    imageType,
    pageUrl,
    conversationId: null, // Will be set when conversation is saved
  });
}

/**
 * Get list of active conversation IDs
 */
export function getActiveConversations() {
  return Array.from(activeConversations.values());
}

/**
 * Remove conversation from active list (when archived or closed)
 */
export function deactivateConversation(tabId) {
  activeConversations.delete(tabId);
}

/**
 * Clean up streaming state for a tab (used when starting a new conversation)
 */
export function cleanupStreamingState(tabId) {
  if (streamingState.has(tabId)) {
    streamingState.delete(tabId);
  }
}

/**
 * Setup message listeners
 */
export function setupMessageListeners() {
  chrome.runtime.onMessage.addListener(
    async (message, sender, sendResponse) => {
      if (message.action === "analyzePage") {
        generateFromScreenshot();
      } else if (message.action === "analyzePageWithQuestion") {
        await generateFromScreenshotWithQuestion(
          message.question,
          message.tabId,
        );
      } else if (message.action === "followupQuestion") {
        await handleFollowupQuestion(message);
      } else if (message.action === "streamUpdate") {
        await handleStreamUpdate(message);
      } else if (message.action === "streamComplete") {
        await handleStreamComplete(message);
      } else if (message.action === "openSidePanelFromPage") {
        await handleOpenSidePanelFromPage(sender);
      } else if (message.action === "initConversationData") {
        await initializeConversationData(
          message.tabId,
          message.type,
          message.context,
          message.imageData,
          message.imageType,
          message.pageUrl,
        );
        sendResponse({ success: true });
        return true; // Keep channel open for async
      } else if (message.action === "restoreConversation") {
        await handleRestoreConversation(message);
        sendResponse({ success: true });
        return true; // Keep channel open for async
      } else if (message.action === "getActiveConversations") {
        sendResponse({ activeConversations: getActiveConversations() });
        return true;
      } else if (message.action === "deactivateConversation") {
        deactivateConversation(message.tabId);
        sendResponse({ success: true });
        return true;
      } else if (message.action === "isAnyTabStreaming") {
        // Check if any tab is currently streaming
        let isStreaming = false;
        for (const [tabId, state] of streamingState.entries()) {
          if (state) {
            isStreaming = true;
            break;
          }
        }
        sendResponse({ isStreaming });
        return true;
      }
    },
  );
}

/**
 * Handle restoring a saved conversation
 */
async function handleRestoreConversation(message) {
  const { tabId, conversation } = message;

  try {
    // Get user's language preference
    let userLanguage = "en";
    try {
      const langResult = await chrome.storage.sync.get(["language"]);
      userLanguage = langResult.language || "en";
    } catch (error) {
      console.warn("Could not get user language, defaulting to 'en':", error);
    }

    // Recreate the session with the stored context and image
    const initialPrompt = "";

    // Store session metadata
    await storeSessionMetadata(tabId, conversation.type);

    // Initialize conversation data (so follow-ups work)
    await setConversationData(tabId, {
      type: conversation.type,
      context: conversation.context,
      imageData: conversation.imageData,
      imageType: conversation.imageType,
      pageUrl: conversation.pageUrl,
      conversationId: conversation.id,
      title: conversation.title,
    });

    // Create session in offscreen document
    // await sendMessageToOffscreen({
    //   action: "createSession",
    //   tabId,
    //   type: conversation.type,
    //   initialPrompt,
    //   imageBase64: conversation.imageData,
    //   imageType: conversation.imageType,
    //   context: conversation.context,
    //   skipInitialPrompt: true, // Don't send initial prompt, just set up session
    // });
  } catch (error) {
    console.error("Error restoring conversation session:", error);
  }
}
