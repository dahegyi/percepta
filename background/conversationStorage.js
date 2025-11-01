/**
 * Conversation Storage Manager
 * Handles storing, retrieving, and managing full conversations in chrome.storage.local
 */

const MAX_CONVERSATIONS = 50;
const STORAGE_KEY = "conversations";

/**
 * Parse title from AI response
 */
export function parseTitleFromResponse(response) {
  // Try with quotes first
  let titleRegex = /perceptaTitle:\s*["']([^"']+)["']/;
  let match = response.match(titleRegex);

  // If no match, try without quotes (match until end of line)
  if (!match) {
    titleRegex = /perceptaTitle:\s*(.+?)(?:\n|$)/;
    match = response.match(titleRegex);
  }

  if (match && match[1]) {
    let title = match[1].trim();
    // Ensure max 50 chars
    if (title.length > 50) {
      title = title.substring(0, 47) + "...";
    }
    return title;
  }

  return "Untitled Conversation";
}

/**
 * Parse action buttons from AI response
 */
export function parseActionsFromResponse(response) {
  const buttonRegex = /perceptaActions:\s*\[(.*?)\]/s;
  const buttonMatch = response.match(buttonRegex);

  if (buttonMatch) {
    const arrayContent = buttonMatch[1];
    const items = arrayContent.match(/["']([^"']+)["']/g);

    if (items) {
      return items.map((item) => item.slice(1, -1));
    }
  }

  return null;
}

/**
 * Store a new conversation
 * @param {Object} conversationData
 * @param {string} conversationData.title - Short title (max 50 chars)
 * @param {Array} conversationData.messages - Array of {role, content, timestamp}
 * @param {string} conversationData.pageUrl - URL where conversation was created
 * @param {number} conversationData.tabId - Tab ID where conversation was created
 * @param {Object} conversationData.context - Page context data
 * @param {string} conversationData.imageData - Base64 image data (if any)
 * @param {string} conversationData.imageType - Image MIME type
 * @param {string} conversationData.type - "screenshot" or "image_analysis"
 */
export async function storeConversation(conversationData) {
  try {
    let result;
    let conversations;
    try {
      result = await chrome.storage.local.get([STORAGE_KEY]);
      conversations = result[STORAGE_KEY] || [];
    } catch (storageError) {
      console.error(
        "🗄️ Error reading from chrome.storage.local:",
        storageError,
      );
      throw new Error("Failed to read storage: " + storageError.message);
    }

    const conversation = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: conversationData.title,
      messages: conversationData.messages || [],
      actionButtons: conversationData.actionButtons || null,
      pageUrl: conversationData.pageUrl,
      tabId: conversationData.tabId,
      context: conversationData.context || null,
      imageData: conversationData.imageData || null,
      imageType: conversationData.imageType || null,
      type: conversationData.type || "screenshot",
      timestamp: Date.now(),
    };

    // Add to beginning of array (most recent first)
    conversations.unshift(conversation);

    // Sort by timestamp to ensure consistent order
    conversations.sort((a, b) => b.timestamp - a.timestamp);

    // Limit to MAX_CONVERSATIONS
    if (conversations.length > MAX_CONVERSATIONS) {
      conversations = conversations.slice(0, MAX_CONVERSATIONS);
    }

    // Save back to storage
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    } catch (storageError) {
      console.error("🗄️ Error writing to chrome.storage.local:", storageError);

      // Check for quota exceeded errors
      if (
        storageError.message?.includes("QUOTA") ||
        storageError.message?.includes("quota")
      ) {
        throw new Error("Storage quota exceeded. Please clear some history.");
      }

      throw new Error("Failed to save to storage: " + storageError.message);
    }

    // Verify it was saved
    try {
      const verify = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (verifyError) {
      console.warn("🗄️ Could not verify storage write:", verifyError);
      // Don't fail if verification fails, we already saved successfully
    }

    return conversation.id;
  } catch (error) {
    console.error("🗄️ Error storing conversation:", error);
    console.error("🗄️ Error stack:", error.stack);
    throw error;
  }
}

/**
 * Update an existing conversation (e.g., to add messages or update title)
 */
export async function updateConversation(conversationId, updates) {
  try {
    let result;
    try {
      result = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      throw new Error("Failed to read storage: " + storageError.message);
    }

    let conversations = result[STORAGE_KEY] || [];

    const index = conversations.findIndex((c) => c.id === conversationId);
    if (index === -1) {
      throw new Error("Conversation not found");
    }

    // Update the conversation
    conversations[index] = {
      ...conversations[index],
      ...updates,
      // Don't allow changing id or timestamp
      id: conversations[index].id,
      timestamp: conversations[index].timestamp,
    };

    // Sort by timestamp to ensure consistent order
    conversations.sort((a, b) => b.timestamp - a.timestamp);

    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.local:", storageError);

      if (
        storageError.message?.includes("QUOTA") ||
        storageError.message?.includes("quota")
      ) {
        throw new Error("Storage quota exceeded. Please clear some history.");
      }

      throw new Error("Failed to save to storage: " + storageError.message);
    }
  } catch (error) {
    console.error("Error updating conversation:", error);
    throw error;
  }
}

/**
 * Get all conversations (returns only metadata, not full messages)
 */
export async function getConversationsList() {
  try {
    let result;
    try {
      result = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      // Return empty array instead of throwing to avoid breaking UI
      return [];
    }

    const conversations = result[STORAGE_KEY] || [];

    // Return only metadata for list display, sorted by timestamp (newest first)
    return conversations
      .map((c) => ({
        id: c.id,
        title: c.title,
        pageUrl: c.pageUrl,
        tabId: c.tabId,
        type: c.type,
        timestamp: c.timestamp,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error("Error getting conversations list:", error);
    return [];
  }
}

/**
 * Get full conversation data by ID
 */
export async function getConversation(conversationId) {
  try {
    let result;
    try {
      result = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      return null;
    }

    const conversations = result[STORAGE_KEY] || [];

    return conversations.find((c) => c.id === conversationId) || null;
  } catch (error) {
    console.error("Error getting conversation:", error);
    return null;
  }
}

/**
 * Delete a conversation by ID
 */
export async function deleteConversation(conversationId) {
  try {
    let result;
    try {
      result = await chrome.storage.local.get([STORAGE_KEY]);
    } catch (storageError) {
      console.error("Error reading from chrome.storage.local:", storageError);
      throw new Error("Failed to read storage: " + storageError.message);
    }

    let conversations = result[STORAGE_KEY] || [];

    conversations = conversations.filter((c) => c.id !== conversationId);

    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.local:", storageError);
      throw new Error("Failed to save to storage: " + storageError.message);
    }
  } catch (error) {
    console.error("Error deleting conversation:", error);
    throw error;
  }
}

/**
 * Clear all conversations
 */
export async function clearAllConversations() {
  try {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    } catch (storageError) {
      console.error("Error writing to chrome.storage.local:", storageError);
      throw new Error("Failed to clear storage: " + storageError.message);
    }
  } catch (error) {
    console.error("Error clearing conversations:", error);
    throw error;
  }
}

/**
 * Check if a conversation can be reopened on the current page
 */
export function canReopenConversation(conversation, currentPageUrl) {
  if (!conversation || !currentPageUrl) return false;

  // Normalize URLs for comparison (remove hash and query params)
  const normalizeUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch {
      return url;
    }
  };

  return normalizeUrl(conversation.pageUrl) === normalizeUrl(currentPageUrl);
}
