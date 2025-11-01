/**
 * Manages session storage, creation, and deletion
 */

import { createLanguageModel } from "./modelFactory.js";
import { base64ToBlob, createImageBitmapFromBlob } from "./imageUtils.js";

// Store language model sessions by tabId
// This persists even when the service worker restarts
// Structure: { session, userLanguage, outputLanguage }
const sessionStore = new Map();

/**
 * Fallback error messages (used when chrome.i18n is not available, e.g., in offscreen)
 */
const FALLBACK_ERROR_MESSAGES = {
  en: {
    error_language_model_unavailable:
      "AI language model is not available. Please ensure your browser supports the Prompt API.",
    error_language_model_failed:
      "Failed to create language model. Please try again.",
    error_quota_exceeded: "AI quota exceeded. Please wait and try again later.",
    error_network: "Network error occurred. Please check your connection.",
    error_image_processing: "Failed to process image. Please try again.",
    error_session_not_found: "Session not found. Please start a new analysis.",
    error_generic: "An error occurred. Please try again.",
    error_input_too_large:
      "The content is too large to process. Please try on a simpler page.",
  },
  es: {
    error_language_model_unavailable:
      "El modelo de lenguaje de IA no está disponible. Asegúrate de que tu navegador sea compatible con la API de Prompt.",
    error_language_model_failed:
      "No se pudo crear el modelo de lenguaje. Por favor, inténtalo de nuevo.",
    error_quota_exceeded:
      "Se ha excedido la cuota de IA. Por favor, espera e inténtalo de nuevo más tarde.",
    error_network:
      "Se produjo un error de red. Por favor, verifica tu conexión.",
    error_image_processing:
      "No se pudo procesar la imagen. Por favor, inténtalo de nuevo.",
    error_session_not_found:
      "Sesión no encontrada. Por favor, inicia un nuevo análisis.",
    error_generic: "Ocurrió un error. Por favor, inténtalo de nuevo.",
    error_input_too_large:
      "El contenido es demasiado grande para procesar. Por favor, inténtalo en una página más simple.",
  },
};

/**
 * Helper to get user-friendly error message based on error code
 */
function getErrorMessage(error, userLanguage = "en") {
  // Determine which language to use (only en and es supported)
  const lang = userLanguage === "es" ? "es" : "en";
  const messages = FALLBACK_ERROR_MESSAGES[lang];

  // Map error codes/names to message keys
  let messageKey = "error_generic";

  if (error.code === "LANGUAGE_MODEL_UNAVAILABLE") {
    messageKey = "error_language_model_unavailable";
  } else if (error.code === "LANGUAGE_MODEL_CREATION_FAILED") {
    messageKey = "error_language_model_failed";
  } else if (
    error.code === "QUOTA_EXCEEDED" ||
    error.name === "QuotaExceededError"
  ) {
    // Check if it's an input size quota error
    if (error.message && error.message.includes("input is too large")) {
      messageKey = "error_input_too_large";
    } else {
      messageKey = "error_quota_exceeded";
    }
  } else if (error.code === "NETWORK_ERROR" || error.name === "NetworkError") {
    messageKey = "error_network";
  } else if (error.code === "IMAGE_PROCESSING_ERROR") {
    messageKey = "error_image_processing";
  } else if (error.code === "SESSION_NOT_FOUND") {
    messageKey = "error_session_not_found";
  }

  return messages[messageKey];
}

/**
 * Check if session has exceeded quota
 */
async function checkQuota(session) {
  try {
    if (!session) return { exceeded: false };

    // Check if the session has usage/quota properties
    if (
      typeof session.inputUsage === "number" &&
      typeof session.inputQuota === "number"
    ) {
      const usage = session.inputUsage;
      const quota = session.inputQuota;

      if (usage >= quota) {
        console.error("❌ Quota exceeded!", { usage, quota });
        return {
          exceeded: true,
          usage,
          quota,
          message: chrome.i18n.getMessage("error_quota_exceeded"),
        };
      }

      // Warning if approaching quota (90%)
      if (usage >= quota * 0.9) {
        console.warn("⚠️ Approaching quota limit!", { usage, quota });
      }
    }

    return { exceeded: false };
  } catch (error) {
    console.error("Error checking quota:", error);
    // Don't fail if quota check fails, continue operation
    return { exceeded: false };
  }
}

/**
 * Create a new session for a tab with streaming support
 * @param {string} userLanguage - User's preferred language (passed from background script)
 * @param {Array} additionalPrompts - Optional additional prompts to send after initial prompt
 */
export async function createSession(
  tabId,
  type,
  initialPrompt,
  imageBase64,
  imageType,
  context = null,
  onStream = null,
  userLanguage = "en",
  additionalPrompts = null,
) {
  try {
    // Use userLanguage directly since all supported languages work with LanguageModel

    const session = await createLanguageModel(initialPrompt, userLanguage);
    if (!session) {
      const errorMsg = getErrorMessage(
        { code: "LANGUAGE_MODEL_CREATION_FAILED" },
        userLanguage,
      );
      return {
        success: false,
        error: errorMsg,
        userMessage: errorMsg,
      };
    }

    // Check quota before processing
    const quotaCheck = await checkQuota(session);
    if (quotaCheck.exceeded) {
      return {
        success: false,
        error: "Quota exceeded",
        userMessage: quotaCheck.message,
        quotaExceeded: true,
        usage: quotaCheck.usage,
        quota: quotaCheck.quota,
      };
    }

    // Convert base64 back to blob
    let blob;
    try {
      blob = base64ToBlob(imageBase64, imageType);
    } catch (error) {
      console.error("Error converting base64 to blob:", error);
      const errorMsg = getErrorMessage(
        { code: "IMAGE_PROCESSING_ERROR" },
        userLanguage,
      );
      return {
        success: false,
        error: "Image processing failed",
        userMessage: errorMsg,
      };
    }

    // Send initial prompt with image
    let prompt;
    if (type === "screenshot") {
      const textContent = context?.context || "";

      prompt = [
        {
          role: "user",
          content: [
            {
              type: "text",
              value: textContent,
            },
            { type: "image", value: blob },
          ],
        },
      ];
    } else if (type === "image") {
      // Convert blob to ImageBitmap for image sessions
      let imageBitmap;
      try {
        imageBitmap = await createImageBitmapFromBlob(blob);
      } catch (error) {
        console.error("Error creating ImageBitmap:", error);
        const errorMsg = getErrorMessage(
          { code: "IMAGE_PROCESSING_ERROR" },
          userLanguage,
        );
        return {
          success: false,
          error: "Image bitmap creation failed",
          userMessage: errorMsg,
        };
      }
      const normalizedImgSrc =
        context?.imgSrc?.split("/").pop().split("?")[0] || "";

      prompt = [
        {
          role: "user",
          content: [
            {
              type: "text",
              value: context?.context || "",
            },
            {
              type: "text",
              value: `Image URL: ${normalizedImgSrc}`,
            },
            { type: "image", value: imageBitmap },
          ],
        },
      ];
    } else {
      return { success: false, error: "Invalid session type" };
    }

    // If there are additional prompts, add them to the prompt array
    // This allows the initial prompt to include the user's question
    if (
      additionalPrompts &&
      Array.isArray(additionalPrompts) &&
      additionalPrompts.length > 0
    ) {
      prompt = [...prompt, ...additionalPrompts];
    }

    // Use streaming API
    const stream = session.promptStreaming(prompt);
    let fullText = "";
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;

        // Check quota periodically during streaming
        if (chunkCount % 10 === 0) {
          const quotaCheck = await checkQuota(session);
          if (quotaCheck.exceeded) {
            console.error("❌ Quota exceeded during streaming");
            return {
              success: false,
              error: "Quota exceeded during streaming",
              userMessage: quotaCheck.message,
              quotaExceeded: true,
              partialResponse: fullText,
            };
          }
        }

        // Handle both cumulative and incremental chunks
        if (fullText && chunk.startsWith(fullText)) {
          // Chunk is cumulative (contains all previous text) - use as-is
          fullText = chunk;
        } else {
          // Chunk is incremental (new text only) - accumulate
          fullText += chunk;
        }

        // Call streaming callback with cumulative text
        if (onStream) {
          onStream(fullText);
        }
      }
    } catch (streamError) {
      console.error("❌ Error during streaming:", streamError);
      const errorMsg = getErrorMessage(streamError, userLanguage);
      return {
        success: false,
        error: streamError.message || "Streaming failed",
        userMessage: errorMsg,
        partialResponse: fullText,
      };
    }

    // Store session with language info for follow-ups
    sessionStore.set(tabId, {
      session,
      userLanguage,
    });

    return { success: true, response: fullText };
  } catch (error) {
    console.error("❌ Error creating session:", error);
    console.error("Error details:", error.message, error.stack);

    const userMessage = getErrorMessage(error, userLanguage);
    return {
      success: false,
      error: error.message || "Session creation failed",
      userMessage: userMessage,
      code: error.code,
    };
  }
}

/**
 * Send a prompt to an existing session with streaming support
 */
export async function sendPromptStreaming(tabId, prompt, onStream = null) {
  const sessionData = sessionStore.get(tabId);
  if (!sessionData) {
    console.error("Session not found for tabId:", tabId);
    const errorMsg = getErrorMessage({ code: "SESSION_NOT_FOUND" }, "en");
    return {
      success: false,
      error: "Session not found",
      userMessage: errorMsg,
      code: "SESSION_NOT_FOUND",
    };
  }

  const { session, userLanguage } = sessionData;

  // Check quota before sending prompt
  const quotaCheck = await checkQuota(session);
  if (quotaCheck.exceeded) {
    console.error("❌ Quota exceeded before sending prompt");
    return {
      success: false,
      error: "Quota exceeded",
      userMessage: quotaCheck.message,
      quotaExceeded: true,
      usage: quotaCheck.usage,
      quota: quotaCheck.quota,
    };
  }

  // For follow-up prompts (text only, no images), extract just the text string
  // The Chrome Prompt API session.promptStreaming() expects a string for follow-ups
  let promptInput = prompt;
  if (Array.isArray(prompt) && prompt.length > 0) {
    const firstMessage = prompt[0];
    if (firstMessage.content && Array.isArray(firstMessage.content)) {
      // Check if this is a text-only follow-up (no images)
      const hasImage = firstMessage.content.some((c) => c.type === "image");
      if (
        !hasImage &&
        firstMessage.content.length === 1 &&
        firstMessage.content[0].type === "text"
      ) {
        // Text-only follow-up - extract the string
        promptInput = firstMessage.content[0].value;
      }
    }
  }

  try {
    const stream = session.promptStreaming(promptInput);
    let fullText = "";
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;

        // Check quota periodically during streaming
        if (chunkCount % 10 === 0) {
          const quotaCheck = await checkQuota(session);
          if (quotaCheck.exceeded) {
            console.error("❌ Quota exceeded during follow-up streaming");
            return {
              success: false,
              error: "Quota exceeded during streaming",
              userMessage: quotaCheck.message,
              quotaExceeded: true,
              partialResponse: fullText,
            };
          }
        }

        // Handle both cumulative and incremental chunks
        if (fullText && chunk.startsWith(fullText)) {
          // Chunk is cumulative (contains all previous text) - use as-is
          fullText = chunk;
        } else {
          // Chunk is incremental (new text only) - accumulate
          fullText += chunk;
        }

        // Call streaming callback with cumulative text
        if (onStream) {
          onStream(fullText);
        }
      }
    } catch (streamError) {
      console.error("❌ Error during prompt streaming:", streamError);
      const errorMsg = getErrorMessage(streamError, userLanguage);
      return {
        success: false,
        error: streamError.message || "Streaming failed",
        userMessage: errorMsg,
        partialResponse: fullText,
      };
    }

    if (chunkCount === 0) {
      // Fallback to non-streaming prompt() method
      try {
        const response = await session.prompt(promptInput);

        // Call the streaming callback with the full response
        if (onStream && response) {
          onStream(response);
        }

        return { success: true, response: response || "" };
      } catch (fallbackError) {
        console.error("Error in fallback prompt:", fallbackError);
        const errorMsg = getErrorMessage(fallbackError, userLanguage);
        return {
          success: false,
          error: fallbackError.message || "Prompt failed",
          userMessage: errorMsg,
        };
      }
    }

    return { success: true, response: fullText };
  } catch (error) {
    console.error("Error sending prompt:", error);
    const errorMsg = getErrorMessage(error, userLanguage);
    return {
      success: false,
      error: error.message || "Prompt failed",
      userMessage: errorMsg,
      code: error.code,
    };
  }
}

/**
 * Delete a session
 */
export function deleteSession(tabId) {
  sessionStore.delete(tabId);
  return { success: true };
}
