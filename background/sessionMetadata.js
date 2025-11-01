/**
 * Handles storing, retrieving, and deleting session metadata in chrome.storage.local
 * Only stores minimal metadata - the actual session is in the offscreen document
 */

import { sendMessageToOffscreen } from "./offscreenBridge.js";

/**
 * Store session metadata for a tab
 */
export async function storeSessionMetadata(tabId, type) {
  try {
    try {
      await chrome.storage.local.set({
        [`session_${tabId}`]: {
          tabId,
          type,
          timestamp: Date.now(),
        },
      });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.local:", storageError);
      // Don't throw - this is metadata only, not critical
    }
  } catch (error) {
    console.error("Error storing session metadata:", error);
    // Don't throw - this is metadata only
  }
}

/**
 * Remove session metadata for a tab
 */
export async function removeSessionMetadata(tabId) {
  try {
    try {
      await chrome.storage.local.remove(`session_${tabId}`);
    } catch (storageError) {
      console.error("Error removing from chrome.storage.local:", storageError);
      // Don't throw - continue to try deleting offscreen session
    }

    // Also delete session from offscreen document (if it exists)
    try {
      await sendMessageToOffscreen({ action: "deleteSession", tabId });
    } catch (error) {
      // Offscreen document might not exist, which is fine
    }
  } catch (error) {
    console.error("Error removing session metadata:", error);
    // Don't throw - this is cleanup only
  }
}

/**
 * Get session metadata for a tab
 */
export async function getSessionMetadata(tabId) {
  try {
    let result;
    try {
      result = await chrome.storage.local.get(`session_${tabId}`);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      return null;
    }
    return result[`session_${tabId}`] || null;
  } catch (error) {
    console.error("Error getting session metadata:", error);
    return null;
  }
}

/**
 * Store analysis result in chrome.storage.local
 * Optimized to avoid quota issues - only store text, not images
 */
export async function storeAnalysisResult(text, imageUrl, pageInfo = null) {
  try {
    let result;
    let history;
    try {
      result = await chrome.storage.local.get(["history"]);
      history = result.history || [];
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      // If we can't read, don't crash - just skip storing
      return;
    }

    // Add new entry without storing full image data
    const entry = {
      text: text,
      timestamp: Date.now(),
      imageUrl: imageUrl ? "stored" : null, // Don't store actual data URL to save space
      type: "image_analysis",
    };

    // Add page info if provided
    if (pageInfo) {
      entry.pageTitle = pageInfo.title;
      entry.pageUrl = pageInfo.url;
    }

    history.unshift(entry);

    // Limit to 50 entries to avoid quota issues
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    // Save back to storage
    try {
      await chrome.storage.local.set({ history });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.local:", storageError);

      // Check for quota errors
      if (
        storageError.message?.includes("QUOTA") ||
        storageError.message?.includes("quota")
      ) {
        console.warn("Storage quota exceeded for history, truncating...");
        // Try with fewer entries
        history = history.slice(0, 25);
        try {
          await chrome.storage.local.set({ history });
        } catch (retryError) {
          console.error("Failed to save even truncated history:", retryError);
        }
      }
    }
  } catch (error) {
    console.error("Error storing analysis result:", error);
    // If storage fails, don't crash - just log the error
  }
}
