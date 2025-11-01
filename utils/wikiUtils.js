/**
 * Wikipedia Utilities
 * Shared utilities for Wikipedia-related functionality
 */

import { DEFAULT_SETTINGS } from "../constants.js";

/**
 * Get user's language preference
 * @returns {Promise<string>} - User's language code (en, es, or ja)
 */
export async function getUserLanguage() {
  try {
    const result = await chrome.storage.sync.get(["language"]);
    return result.language || DEFAULT_SETTINGS.language;
  } catch (error) {
    console.warn("Error getting language preference:", error);
    return DEFAULT_SETTINGS.language;
  }
}

/**
 * Get Wikipedia base URL based on user's language preference
 * @returns {Promise<string>} - Wikipedia base URL (e.g., https://en.wikipedia.org)
 */
export async function getWikipediaBaseUrl() {
  const language = await getUserLanguage();
  return `https://${language}.wikipedia.org`;
}
