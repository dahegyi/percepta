/**
 * Handles screenshot capture and analysis
 */

import { PROMPT_SCREENSHOT, DETAIL_LEVEL_MAP } from "../constants.js";
import { sendMessageToOffscreen } from "./offscreenBridge.js";
import { storeSessionMetadata } from "./sessionMetadata.js";
import { blobToBase64 } from "../ai/imageUtils.js";
import {
  initializeConversationData,
  cleanupStreamingState,
} from "./messageHandlers.js";
import { chunkContext, getContextStats } from "../ai/contextChunker.js";

/**
 * Common screenshot capture and processing logic
 */
async function captureAndProcessScreenshot(tab, additionalPrompts = null) {
  if (!tab?.id) {
    console.error("No active tab found");
    return;
  }

  try {
    // Ensure side panel is set up for this tab
    try {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: "sidepanel/sidepanel.html",
        enabled: true,
      });

      // Send tab ID to side panel BEFORE starting any operations
      // This ensures the sidepanel knows which tab it belongs to
      try {
        await chrome.runtime.sendMessage({
          action: "setTabId",
          tabId: tab.id,
        });
        // Give sidepanel a moment to process setTabId before messages start flowing
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.warn("Could not send setTabId to sidepanel:", error);
        // Continue anyway - sidepanel will get tabId from first streamUpdate
      }
    } catch (error) {
      console.error("Error setting up side panel:", error);
    }

    // Capture screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
      quality: 90,
    });

    const response = await fetch(dataUrl);
    let blob = await response.blob();

    // Base64 encoding adds ~33% overhead, so keep blob under 750KB to ensure base64 stays under 1MB
    const MAX_BLOB_SIZE = 750 * 1024; // 750KB in bytes

    // Resize image if too large
    if (blob.size > MAX_BLOB_SIZE) {
      // Create image bitmap and resize
      const imageBitmap = await createImageBitmap(blob);

      // Calculate target dimensions to achieve desired file size
      // Start with a conservative scale factor
      let quality = 0.85;
      let scale = Math.sqrt(MAX_BLOB_SIZE / blob.size);

      const canvas = new OffscreenCanvas(
        Math.floor(imageBitmap.width * scale),
        Math.floor(imageBitmap.height * scale),
      );
      const ctx = canvas.getContext("2d");
      ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);

      // Try converting with initial quality
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality });

      // If still too large, reduce quality iteratively
      let attempts = 0;
      while (blob.size > MAX_BLOB_SIZE && quality > 0.5 && attempts < 5) {
        quality -= 0.1;
        blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        attempts++;
      }
    }

    // Convert blob to base64 for reliable message passing
    const base64 = await blobToBase64(blob);
    const blobType = blob.type;

    // Get user's language preference and detail level
    let userLanguage = "en";
    let detailLevel = "medium";
    try {
      const result = await chrome.storage.sync.get(["language", "detailLevel"]);
      userLanguage = result.language || "en";
      detailLevel = result.detailLevel || "medium";
    } catch (error) {
      console.warn("Could not get user settings, using defaults:", error);
    }

    // Get max word count from detail level
    const maxWords = DETAIL_LEVEL_MAP[detailLevel] || 50;

    const initialPrompt = PROMPT_SCREENSHOT(
      maxWords * 0.8,
      maxWords,
      userLanguage,
    );

    // Clean up any existing streaming state for this tab before starting new conversation
    // This prevents issues when starting a new conversation while another is ongoing
    cleanupStreamingState(tab.id);

    // Store session metadata before streaming starts
    await storeSessionMetadata(tab.id, "screenshot");

    // Create session in offscreen document (will stream results back)
    try {
      // Inject article extractor and gather page context in one go
      const [{ result: contextData }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // Article extraction functions (inlined)
          function extractArticleContent() {
            const articleSelectors = [
              "article",
              '[role="article"]',
              '[itemtype*="Article"]',
              ".article-content",
              ".post-content",
              ".entry-content",
              ".content",
              "main article",
              "main",
            ];

            let articleElement = null;
            for (const selector of articleSelectors) {
              const element = document.querySelector(selector);
              if (element) {
                articleElement = element;
                break;
              }
            }

            if (!articleElement) {
              const candidates = document.querySelectorAll("div, section");
              let maxTextLength = 0;
              let bestCandidate = null;

              candidates.forEach((element) => {
                if (
                  element.matches(
                    "header, footer, nav, aside, .sidebar, .menu, .navigation, .comments",
                  )
                ) {
                  return;
                }

                const textLength = element.innerText?.length || 0;
                if (textLength > maxTextLength && textLength > 500) {
                  maxTextLength = textLength;
                  bestCandidate = element;
                }
              });

              articleElement = bestCandidate;
            }

            if (!articleElement) return null;

            const clone = articleElement.cloneNode(true);
            const unwantedSelectors = [
              "script",
              "style",
              "noscript",
              "iframe",
              "nav",
              "aside",
              "footer",
              "header",
              ".advertisement",
              ".ad",
              ".social-share",
              ".comments",
              ".related-posts",
              '[class*="sidebar"]',
              '[class*="menu"]',
              '[class*="navigation"]',
            ];

            unwantedSelectors.forEach((selector) => {
              clone.querySelectorAll(selector).forEach((el) => el.remove());
            });

            let text = clone.innerText || clone.textContent || "";
            text = text
              .replace(/\n\s*\n\s*\n/g, "\n\n")
              .replace(/[ \t]+/g, " ")
              .trim();

            return text;
          }

          function isArticlePage() {
            const hasArticleElement = !!document.querySelector("article");
            const hasArticleRole = !!document.querySelector('[role="article"]');
            const hasArticleSchema = !!document.querySelector(
              '[itemtype*="Article"]',
            );
            const url = location.pathname.toLowerCase();
            const articleUrlPatterns = [
              /\/article\//,
              /\/post\//,
              /\/blog\//,
              /\/news\//,
              /\/story\//,
              /\/\d{4}\/\d{2}\//,
            ];
            const hasArticleUrl = articleUrlPatterns.some((pattern) =>
              pattern.test(url),
            );
            const hasArticleMeta =
              !!document.querySelector(
                'meta[property="article:published_time"]',
              ) ||
              !!document.querySelector(
                'meta[property="og:type"][content="article"]',
              );
            const bodyText = document.body.innerText || "";
            const hasSignificantContent = bodyText.length > 1000;

            const indicators = [
              hasArticleElement,
              hasArticleRole,
              hasArticleSchema,
              hasArticleUrl,
              hasArticleMeta,
              hasSignificantContent,
            ].filter(Boolean).length;

            return indicators >= 2;
          }

          // Build context for page
          const title = document.title;
          const url = location.href;

          // Check if this is an article page
          const isArticle = isArticlePage();
          let articleContent = null;

          if (isArticle) {
            articleContent = extractArticleContent();
          }

          // collect visible links
          const links = [...document.querySelectorAll("a[href]")]
            .map((a, i) => {
              const rect = a.getBoundingClientRect();
              const visible =
                rect.width > 10 &&
                rect.height > 10 &&
                rect.bottom > 0 &&
                rect.top < window.innerHeight * 3;
              if (!visible) return null;

              const text =
                a.innerText?.trim() ||
                a.getAttribute("aria-label") ||
                a.getAttribute("title") ||
                a.href;
              return `${i + 1}. ${text} — ${a.href}`;
            })
            .filter(Boolean);

          // collect headings
          const headings = [
            ...document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
          ]
            .map((h) => h.innerText.trim())
            .filter(Boolean);

          // collect meta
          const meta = [
            ...document.querySelectorAll("meta[name], meta[property]"),
          ]
            .map(
              (m) =>
                `${m.getAttribute("name") || m.getAttribute("property")}: ${
                  m.content
                }`,
            )
            .filter(Boolean);

          // get a body text snapshot (only if not an article)
          const snippet =
            !isArticle && !articleContent
              ? document.body.innerText
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 4000)
              : "";

          // Return structured data for chunking
          return {
            title,
            url,
            meta,
            headings,
            links,
            snippet,
            articleContent,
            isArticle,
          };
        },
      });

      // Chunk context to stay under API limits
      const pageContext = chunkContext(contextData);

      // Initialize conversation data for this tab
      await initializeConversationData(
        tab.id,
        "screenshot",
        { context: pageContext },
        base64,
        blobType,
        tab.url,
      );

      // Create session with initial prompt and optional additional prompts
      const result = await sendMessageToOffscreen({
        action: "createSession",
        tabId: tab.id,
        type: "screenshot",
        initialPrompt,
        imageBase64: base64,
        imageType: blobType,
        context: { context: pageContext },
        userLanguage,
        additionalPrompts, // Pass additional prompts if provided
      });

      if (!result || !result.success) {
        console.error("Failed to create session:", result);
        throw new Error(result?.error || "Failed to create language model");
      }

      // Result will be stored in handleStreamComplete when streaming finishes
    } catch (error) {
      console.error("Error sending message to offscreen:", error);
      throw new Error(
        `Failed to communicate with offscreen document: ${error.message}`,
      );
    }
  } catch (error) {
    console.error("Error generating from screenshot:", error);
    // Error will be shown in overlay if it exists
  }
}

/**
 * Generate description from screenshot with user's initial question
 */
export async function generateFromScreenshotWithQuestion(
  userQuestion,
  providedTabId = null,
) {
  // Use provided tabId if available, otherwise query for active tab
  let tab;
  if (providedTabId) {
    try {
      tab = await chrome.tabs.get(providedTabId);
    } catch (error) {
      console.warn(
        "Could not get tab with provided tabId, falling back to active tab:",
        error,
      );
      tab = null;
    }
  }

  if (!tab) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
  }

  if (!tab?.id) {
    console.error("No active tab found");
    return;
  }

  // Create additional prompts array with user's question
  const additionalPrompts = [
    {
      role: "user",
      content: [{ type: "text", value: userQuestion }],
    },
  ];

  // Use common function with additional prompts
  return captureAndProcessScreenshot(tab, additionalPrompts);
}

/**
 * Generate description from screenshot of current page
 */
export async function generateFromScreenshot() {
  const tab = await chrome.tabs
    .query({ active: true, currentWindow: true })
    .then((t) => t[0]);

  if (!tab?.id) {
    console.error("No active tab found");
    return;
  }

  // Use common function without additional prompts
  return captureAndProcessScreenshot(tab, null);
}
