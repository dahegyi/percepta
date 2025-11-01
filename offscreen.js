/**
 * Minimal offscreen document listener that delegates to helper modules
 */

import {
  createSession,
  sendPromptStreaming,
  deleteSession,
} from "./ai/sessionManager.js";

// Handle messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle async operations
  (async () => {
    try {
      switch (message.action) {
        case "createSession":
          const {
            tabId,
            type,
            initialPrompt,
            imageBase64,
            imageType,
            context,
            userLanguage,
            additionalPrompts,
          } = message;

          // Stream callback to send updates to background
          const onStream = (partial) => {
            chrome.runtime
              .sendMessage({
                action: "streamUpdate",
                tabId,
                partial,
              })
              .catch((err) => {
                // Ignore stream update send failures
              });
          };

          // Immediately acknowledge that generation has started
          sendResponse({ success: true, started: true });

          // Continue generation in the background
          createSession(
            tabId,
            type,
            initialPrompt,
            imageBase64,
            imageType,
            context,
            onStream,
            userLanguage, // Pass user language to session manager
            additionalPrompts, // Pass additional prompts
          )
            .then((result) => {
              // Send completion message
              if (result.success) {
                chrome.runtime
                  .sendMessage({
                    action: "streamComplete",
                    tabId,
                    fullText: result.response,
                  })
                  .catch((err) => {
                    // Ignore stream complete send failures
                  });
              } else {
                // Send user-friendly error message
                const errorMessage =
                  result.userMessage ||
                  result.error ||
                  chrome.i18n.getMessage("error_generic");
                console.error("Session creation failed:", result);

                chrome.runtime
                  .sendMessage({
                    action: "streamUpdate",
                    tabId,
                    partial: errorMessage,
                  })
                  .catch((err) => {
                    // Ignore error update send failures
                  });

                // Send stream complete to stop loading state
                chrome.runtime
                  .sendMessage({
                    action: "streamComplete",
                    tabId,
                    fullText: errorMessage,
                  })
                  .catch((err) => {
                    // Ignore stream complete send failures
                  });
              }
            })
            .catch((error) => {
              console.error("Error in createSession:", error);
              const errorMessage =
                error.userMessage ||
                error.message ||
                chrome.i18n.getMessage("error_generic");

              chrome.runtime
                .sendMessage({
                  action: "streamUpdate",
                  tabId,
                  partial: errorMessage,
                })
                .catch((err) => {
                  // Ignore error update send failures
                });

              // Send stream complete to stop loading state
              chrome.runtime
                .sendMessage({
                  action: "streamComplete",
                  tabId,
                  fullText: errorMessage,
                })
                .catch((err) => {
                  // Ignore stream complete send failures
                });
            });
          break;

        case "sendPrompt":
          const promptTabId = message.tabId;

          // Stream callback for all prompts
          const onPromptStream = (partial) => {
            chrome.runtime
              .sendMessage({
                action: "streamUpdate",
                tabId: promptTabId,
                partial,
              })
              .catch((err) => {
                // Ignore stream update send failures
              });
          };

          // Immediately acknowledge that generation has started
          sendResponse({ success: true, started: true });

          // Continue generation in the background
          sendPromptStreaming(promptTabId, message.prompt, onPromptStream)
            .then((promptResult) => {
              // Send completion message
              if (promptResult.success) {
                chrome.runtime
                  .sendMessage({
                    action: "streamComplete",
                    tabId: promptTabId,
                    fullText: promptResult.response,
                  })
                  .catch((err) => {
                    // Ignore stream complete send failures
                  });
              } else {
                // Send user-friendly error message
                const errorMessage =
                  promptResult.userMessage ||
                  promptResult.error ||
                  chrome.i18n.getMessage("error_generic");
                console.error("Prompt streaming failed:", promptResult);

                chrome.runtime
                  .sendMessage({
                    action: "streamUpdate",
                    tabId: promptTabId,
                    partial: errorMessage,
                  })
                  .catch((err) => {
                    // Ignore error update send failures
                  });

                // Send stream complete to stop loading state
                chrome.runtime
                  .sendMessage({
                    action: "streamComplete",
                    tabId: promptTabId,
                    fullText: errorMessage,
                  })
                  .catch((err) => {
                    // Ignore stream complete send failures
                  });
              }
            })
            .catch((error) => {
              console.error("Error in sendPromptStreaming:", error);
              const errorMessage =
                error.userMessage ||
                error.message ||
                chrome.i18n.getMessage("error_generic");

              chrome.runtime
                .sendMessage({
                  action: "streamUpdate",
                  tabId: promptTabId,
                  partial: errorMessage,
                })
                .catch((err) => {
                  // Ignore error update send failures
                });

              // Send stream complete to stop loading state
              chrome.runtime
                .sendMessage({
                  action: "streamComplete",
                  tabId: promptTabId,
                  fullText: errorMessage,
                })
                .catch((err) => {
                  // Ignore stream complete send failures
                });
            });
          break;

        case "deleteSession":
          sendResponse(deleteSession(message.tabId));
          break;

        case "ping":
          // Health check to verify offscreen document is alive
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  // Return true to indicate we will send a response asynchronously
  return true;
});
