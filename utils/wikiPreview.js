/**
 * Wikipedia Preview Tooltip
 * Shows a preview of Wikipedia articles on hover
 */

import { getWikipediaBaseUrl } from "./wikiUtils.js";

// In-memory cache for Wikipedia previews
const previewCache = new Map();

// Storage key for Wikipedia preview cache
const WIKI_PREVIEW_CACHE_KEY = "wikiPreviewCache";

// Active tooltip reference
let activeTooltip = null;
let hoverTimeout = null;

/**
 * Get cached Wikipedia preview results
 */
async function getCachedPreviews() {
  try {
    const result = await chrome.storage.local.get([WIKI_PREVIEW_CACHE_KEY]);
    return result[WIKI_PREVIEW_CACHE_KEY] || {};
  } catch (error) {
    console.warn(
      "Could not access chrome.storage.local for previews, using memory cache:",
      error,
    );
    return Object.fromEntries(previewCache);
  }
}

/**
 * Save cached Wikipedia preview results
 */
async function setCachedPreviews(cache) {
  try {
    await chrome.storage.local.set({ [WIKI_PREVIEW_CACHE_KEY]: cache });
  } catch (error) {
    console.warn(
      "Could not save previews to chrome.storage.local, using memory cache:",
      error,
    );
    Object.entries(cache).forEach(([key, value]) => {
      previewCache.set(key, value);
    });
  }
}

/**
 * Fetch Wikipedia preview for a given title
 * @param {string} title - The Wikipedia article title
 * @returns {Promise<Object|null>} - Preview data or null if not found
 */
export async function fetchWikiPreview(title) {
  if (!title) return null;

  // Check memory cache first
  if (previewCache.has(title)) {
    return previewCache.get(title);
  }

  // Check storage cache
  const cache = await getCachedPreviews();
  if (cache[title]) {
    previewCache.set(title, cache[title]);
    return cache[title];
  }

  try {
    // Fetch from Wikipedia REST API
    const encodedTitle = encodeURIComponent(title);
    const baseUrl = await getWikipediaBaseUrl();
    const url = `${baseUrl}/api/rest_v1/page/summary/${encodedTitle}`;

    const response = await fetch(url);

    if (!response.ok) {
      // Article not found or error
      const errorResult = { error: true, title };
      previewCache.set(title, errorResult);
      cache[title] = errorResult;
      await setCachedPreviews(cache);
      return null;
    }

    const data = await response.json();

    // Extract relevant preview data
    const preview = {
      title: data.title || title,
      extract:
        data.extract ||
        chrome.i18n.getMessage("wiki_no_summary_available") ||
        "No summary available.",
      thumbnail: data.thumbnail?.source || null,
      url:
        data.content_urls?.desktop?.page || `${baseUrl}/wiki/${encodedTitle}`,
    };

    // Cache the result
    previewCache.set(title, preview);
    cache[title] = preview;
    await setCachedPreviews(cache);

    return preview;
  } catch (error) {
    console.error("Error fetching Wikipedia preview:", error);
    return null;
  }
}

/**
 * Show Wikipedia tooltip near the link element
 * @param {HTMLElement} link - The link element being hovered
 * @param {Object} preview - The preview data
 */
export function showWikiTooltip(link, preview) {
  // Remove any existing tooltip
  removeWikiTooltip();

  if (!preview || preview.error) return;

  // Create tooltip element
  const tooltip = document.createElement("div");
  tooltip.className = "wiki-preview-tooltip";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.setAttribute("role", "tooltip");

  // Build tooltip content
  let thumbnailHTML = "";
  if (preview.thumbnail) {
    thumbnailHTML = `
      <div class="wiki-preview-thumbnail">
        <img src="${preview.thumbnail}" alt="" />
      </div>
    `;
  }

  tooltip.innerHTML = `
    ${thumbnailHTML}
    <div class="wiki-preview-content">
      <h4 class="wiki-preview-title">${escapeHtml(preview.title)}</h4>
      <p class="wiki-preview-extract">${escapeHtml(preview.extract)}</p>
    </div>
  `;

  // Add to document
  document.body.appendChild(tooltip);

  // Position tooltip
  positionTooltip(tooltip, link);

  // Store reference
  activeTooltip = tooltip;

  // Add fade-in animation
  requestAnimationFrame(() => {
    tooltip.classList.add("wiki-preview-visible");
  });
}

/**
 * Position tooltip relative to the link
 * @param {HTMLElement} tooltip - The tooltip element
 * @param {HTMLElement} link - The link element
 */
function positionTooltip(tooltip, link) {
  const linkRect = link.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  // Default: position below the link
  let top = linkRect.bottom + window.scrollY + 8;
  let left = linkRect.left + window.scrollX;

  // Check if tooltip would go off-screen to the right
  if (left + tooltipRect.width > window.innerWidth) {
    left = window.innerWidth - tooltipRect.width - 16;
  }

  // Check if tooltip would go off-screen to the left
  if (left < 8) {
    left = 8;
  }

  // Check if tooltip would go off-screen at the bottom
  if (top + tooltipRect.height > window.innerHeight + window.scrollY) {
    // Position above the link instead
    top = linkRect.top + window.scrollY - tooltipRect.height - 8;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

/**
 * Remove active Wikipedia tooltip
 */
export function removeWikiTooltip() {
  if (activeTooltip) {
    // Remove the visible class to trigger exit animation
    activeTooltip.classList.remove("wiki-preview-visible");

    // Wait for transition to complete before removing from DOM
    const tooltip = activeTooltip;
    setTimeout(() => {
      tooltip.remove();
    }, 400); // Match the transition duration in CSS

    activeTooltip = null;
  }

  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }
}

/**
 * Extract Wikipedia title from URL
 * @param {string} url - The Wikipedia URL
 * @returns {string|null} - The article title or null
 */
function extractWikiTitle(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes("wikipedia.org")) {
      const pathParts = urlObj.pathname.split("/");
      const wikiIndex = pathParts.indexOf("wiki");
      if (wikiIndex !== -1 && pathParts[wikiIndex + 1]) {
        return decodeURIComponent(pathParts[wikiIndex + 1].replace(/_/g, " "));
      }
    }
  } catch (error) {
    console.error("Error parsing Wikipedia URL:", error);
  }
  return null;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Handle link hover event
 * @param {Event} event - The mouse event
 */
function handleLinkHover(event) {
  const link = event.currentTarget;
  const url = link.getAttribute("href");

  if (!url) return;

  const title = extractWikiTitle(url);
  if (!title) return;

  // Clear any existing timeout
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
  }

  // Set a delay before showing the tooltip (200ms)
  hoverTimeout = setTimeout(async () => {
    const preview = await fetchWikiPreview(title);
    if (preview) {
      showWikiTooltip(link, preview);
    }
  }, 200);
}

/**
 * Handle link mouse leave event
 */
function handleLinkLeave() {
  // Clear timeout if user leaves before delay completes
  if (hoverTimeout) {
    clearTimeout(hoverTimeout);
    hoverTimeout = null;
  }

  // Remove tooltip
  removeWikiTooltip();
}

/**
 * Initialize Wikipedia preview listeners on all Wikipedia links
 * @param {HTMLElement} rootElement - The root element to search for links
 */
export function initWikiPreviews(rootElement) {
  if (!rootElement) return;

  // Find all Wikipedia links
  const wikiLinks = rootElement.querySelectorAll(
    'a[href*="wikipedia.org/wiki/"]',
  );

  wikiLinks.forEach((link) => {
    // Check if already initialized
    if (link.dataset.wikiPreviewInit === "true") {
      return;
    }

    // Mark as initialized
    link.dataset.wikiPreviewInit = "true";

    // Add event listeners
    link.addEventListener("mouseenter", handleLinkHover);
    link.addEventListener("mouseleave", handleLinkLeave);

    // Also handle when mouse moves to tooltip (keep it visible)
    link.addEventListener("mousemove", (e) => {
      // If tooltip is active and mouse is over it, keep it visible
      if (activeTooltip) {
        const tooltipRect = activeTooltip.getBoundingClientRect();
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Check if mouse is over tooltip
        if (
          mouseX >= tooltipRect.left &&
          mouseX <= tooltipRect.right &&
          mouseY >= tooltipRect.top &&
          mouseY <= tooltipRect.bottom
        ) {
          // Mouse is over tooltip, keep it visible
          return;
        }
      }
    });
  });
}

/**
 * Clear the Wikipedia preview cache
 */
export async function clearWikiPreviewCache() {
  try {
    await chrome.storage.local.remove([WIKI_PREVIEW_CACHE_KEY]);
    previewCache.clear();
  } catch (error) {
    console.warn("Could not clear preview cache:", error);
    previewCache.clear();
  }
}
