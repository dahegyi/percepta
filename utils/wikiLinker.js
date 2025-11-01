/**
 * Wikipedia Entity Linker
 * Detects entities marked with hidden tags and links them to Wikipedia
 */

import { getWikipediaBaseUrl } from "./wikiUtils.js";

// In-memory cache fallback (used if chrome.storage is not available)
const memoryCache = new Map();

// Storage key for Wikipedia cache
const WIKI_CACHE_KEY = "wikiEntityCache";
const MAX_CACHE_SIZE = 100; // Maximum number of entities to cache

/**
 * Get cached Wikipedia results
 */
async function getCachedResults() {
  try {
    const result = await chrome.storage.local.get([WIKI_CACHE_KEY]);
    const cache = result[WIKI_CACHE_KEY] || {};

    // Check cache size and clean if needed
    const entries = Object.entries(cache);
    if (entries.length > MAX_CACHE_SIZE) {
      // Keep only the last MAX_CACHE_SIZE entries (assuming newer entries are more relevant)
      const trimmedEntries = entries.slice(-MAX_CACHE_SIZE);
      const trimmedCache = Object.fromEntries(trimmedEntries);
      await setCachedResults(trimmedCache);
      return trimmedCache;
    }

    return cache;
  } catch (error) {
    console.warn(
      "Could not access chrome.storage.local, using memory cache:",
      error,
    );
    return Object.fromEntries(memoryCache);
  }
}

/**
 * Save cached Wikipedia results
 */
async function setCachedResults(cache) {
  try {
    // Enforce cache size limit before saving
    const entries = Object.entries(cache);
    if (entries.length > MAX_CACHE_SIZE) {
      // Keep only the last MAX_CACHE_SIZE entries
      const trimmedEntries = entries.slice(-MAX_CACHE_SIZE);
      cache = Object.fromEntries(trimmedEntries);
    }

    await chrome.storage.local.set({ [WIKI_CACHE_KEY]: cache });
  } catch (error) {
    console.warn(
      "Could not save to chrome.storage.local, using memory cache:",
      error,
    );
    // Update memory cache as fallback
    Object.entries(cache).forEach(([key, value]) => {
      memoryCache.set(key, value);
    });
  }
}

/**
 * Extract entity names from markdown text with WIKI tags
 * @param {string} markdownText - The markdown text with [[WIKI:Entity Name]] or [[Entity Name]] tags
 * @returns {string[]} - Array of unique entity names
 */
export function extractWikiEntities(markdownText) {
  if (!markdownText) return [];

  const entitySet = new Set();
  // Match both [[WIKI:Entity]] and [[Entity]] formats
  const regex = /\[\[(?:WIKI:)?([^\]]+)\]\]/g;
  let match;

  while ((match = regex.exec(markdownText)) !== null) {
    // Use the entity name from the tag
    const entityName = match[1].trim();
    if (entityName) {
      entitySet.add(entityName);
    }
  }

  return Array.from(entitySet);
}

/**
 * Check which entities exist on Wikipedia using batched API request
 * @param {string[]} entities - Array of entity names to check
 * @returns {Promise<Object>} - Object mapping entity names to boolean (exists or not)
 */
async function checkWikipediaEntities(entities) {
  if (!entities || entities.length === 0) {
    return {};
  }

  try {
    // Get cached results
    const cache = await getCachedResults();

    // Separate cached and uncached entities
    const uncachedEntities = [];
    const results = {};

    for (const entity of entities) {
      if (cache.hasOwnProperty(entity)) {
        results[entity] = cache[entity];
      } else {
        uncachedEntities.push(entity);
      }
    }

    // If all entities are cached, return immediately
    if (uncachedEntities.length === 0) {
      return results;
    }

    const baseUrl = await getWikipediaBaseUrl();
    const newCacheEntries = {};

    // Batch entities to avoid URL length limits (max 50 entities per request)
    const BATCH_SIZE = 50;
    for (let i = 0; i < uncachedEntities.length; i += BATCH_SIZE) {
      const batch = uncachedEntities.slice(i, i + BATCH_SIZE);

      // Build Wikipedia API query for this batch
      const titles = batch.join("|");
      const url = `${baseUrl}/w/api.php?action=query&titles=${encodeURIComponent(
        titles,
      )}&format=json&origin=*`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.warn(
            `Wikipedia API returned ${response.status} for batch ${
              i / BATCH_SIZE + 1
            }`,
          );
          // Mark entities in failed batch as not existing
          batch.forEach((entity) => {
            results[entity] = false;
            newCacheEntries[entity] = false;
          });
          continue;
        }

        const data = await response.json();
        const pages = data.query?.pages || {};

        // Process results for this batch
        for (const entity of batch) {
          let exists = false;

          // Find the page for this entity
          for (const pageId in pages) {
            const page = pages[pageId];
            // Normalize titles for comparison (Wikipedia API returns normalized titles)
            const normalizedEntity = entity.replace(/_/g, " ");
            const normalizedPageTitle = page.title.replace(/_/g, " ");

            if (
              normalizedPageTitle.toLowerCase() ===
              normalizedEntity.toLowerCase()
            ) {
              exists = parseInt(pageId) > 0 && !page.missing;
              break;
            }
          }

          results[entity] = exists;
          newCacheEntries[entity] = exists;
        }
      } catch (fetchError) {
        console.error(
          `Error fetching batch ${i / BATCH_SIZE + 1}:`,
          fetchError,
        );
        // Mark entities in failed batch as not existing
        batch.forEach((entity) => {
          results[entity] = false;
          newCacheEntries[entity] = false;
        });
      }
    }

    // Update cache
    const updatedCache = { ...cache, ...newCacheEntries };
    await setCachedResults(updatedCache);

    return results;
  } catch (error) {
    console.error("Error checking Wikipedia entities:", error);
    // Return empty object on error - entities will be shown as plain text
    return {};
  }
}

/**
 * Link Wikipedia entities in markdown text
 * @param {string} markdownText - The markdown text with [[WIKI:Entity Name]] or [[Entity Name]] tags
 * @returns {Promise<string>} - Markdown with linked entities and tags removed
 */
export async function linkWikipediaEntities(markdownText) {
  if (!markdownText) return "";

  // Extract entities
  const entities = extractWikiEntities(markdownText);

  if (entities.length === 0) {
    // No entities found, just remove any stray markers
    return markdownText.replace(/\[\[(?:WIKI:)?[^\]]+\]\]/g, "");
  }

  try {
    // Add timeout to prevent hanging (5 seconds should be enough)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Wikipedia linking timeout")), 5000);
    });

    // Check which entities exist on Wikipedia with timeout
    const entityExists = await Promise.race([
      checkWikipediaEntities(entities),
      timeoutPromise,
    ]);

    // Get Wikipedia base URL based on user's language preference
    const baseUrl = await getWikipediaBaseUrl();

    // Replace entities with links (or plain text if they don't exist)
    let result = markdownText;

    // Match both [[WIKI:Entity]] and [[Entity]] formats
    const regex = /\[\[(?:WIKI:)?([^\]]+)\]\]/g;
    result = result.replace(regex, (match, entityName) => {
      const entity = entityName.trim();

      if (entityExists[entity]) {
        // Entity exists - create Wikipedia link
        // Encode spaces as underscores for Wikipedia URLs
        const wikiTitle = entity.replace(/ /g, "_");
        const encodedTitle = encodeURIComponent(wikiTitle).replace(/%20/g, "_");
        return `[${entity}](${baseUrl}/wiki/${encodedTitle})`;
      } else {
        // Entity doesn't exist - show as plain text
        return entity;
      }
    });

    // Remove any remaining markers (cleanup)
    result = result.replace(/\[\[(?:WIKI:)?[^\]]+\]\]/g, "");

    return result;
  } catch (error) {
    console.error("Error linking Wikipedia entities:", error);
    // On timeout or error, just return text with markers removed
    return markdownText.replace(
      /\[\[(?:WIKI:)?([^\]]+)\]\]/g,
      (match, entityName) => {
        return entityName.trim();
      },
    );
  }
}

/**
 * Clear the Wikipedia entity cache
 * Useful for testing or if cache gets corrupted
 */
export async function clearWikipediaCache() {
  try {
    await chrome.storage.local.remove([WIKI_CACHE_KEY]);
    memoryCache.clear();
  } catch (error) {
    console.warn("Could not clear cache:", error);
    memoryCache.clear();
  }
}
