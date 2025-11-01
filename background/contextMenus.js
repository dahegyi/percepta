/**
 * Creates the "Describe image with Percepta" context menu and handles clicks
 */

import { PROMPT_IMAGE, DETAIL_LEVEL_MAP } from "../constants.js";
import { sendMessageToOffscreen } from "./offscreenBridge.js";
import { storeSessionMetadata } from "./sessionMetadata.js";
import { blobToBase64 } from "../ai/imageUtils.js";
import { initializeConversationData } from "./messageHandlers.js";

/**
 * Create context menu on install
 */
export function createContextMenus() {
  chrome.contextMenus.create({
    id: "generateFromImage",
    title: chrome.i18n.getMessage("context_menu_describe_image"),
    contexts: ["image"],
  });
}

/**
 * Generate description from an image URL
 */
async function generateFromImage(imgSrc, context, tabId, pageUrl) {
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

  const initialPrompt = PROMPT_IMAGE(maxWords * 0.8, maxWords, userLanguage);

  const response = await fetch(imgSrc);
  const blob = await response.blob();

  // Convert blob to base64 for reliable message passing
  const base64 = await blobToBase64(blob);
  const blobType = blob.type;

  // Store session metadata before streaming starts
  if (tabId) {
    await storeSessionMetadata(tabId, "image");
  }

  // Initialize conversation data for this tab
  await initializeConversationData(
    tabId,
    "image_analysis",
    { context, imgSrc },
    base64,
    blobType,
    pageUrl,
  );

  // Create session in offscreen document (will stream results back)
  const result = await sendMessageToOffscreen({
    action: "createSession",
    tabId,
    type: "image",
    initialPrompt,
    imageBase64: base64,
    imageType: blobType,
    context: {
      context,
      imgSrc,
    },
    userLanguage, // Pass user language to offscreen
  });

  if (!result.success) {
    throw new Error(result.error || "Failed to create language model");
  }

  // Generation is streaming, don't return response (it will come via streamComplete)
  return;
}

/**
 * Handle context menu clicks
 */
export async function handleContextMenuClick(info, tab) {
  const { srcUrl, frameId, menuItemId, mediaType } = info;
  const tabId = tab?.id;

  if (menuItemId !== "generateFromImage" || !tabId || !srcUrl) return;

  let context;

  if (mediaType === "image") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: (srcUrl) => {
        const imgs = [...document.querySelectorAll("img")];
        const img = imgs.find(
          (i) => i.currentSrc === srcUrl || i.src === srcUrl,
        );
        if (img) {
          const alt = img?.getAttribute("alt") || null;
          const caption =
            img.closest("figure")?.querySelector("figcaption")?.innerText || "";
          const heading =
            img.closest("article, section")?.querySelector("h1, h2, h3")
              ?.innerText || "";
          const context =
            img.closest("article, section, div")?.innerText?.slice(0, 300) ||
            "";
          const meta =
            document.querySelector('meta[property="og:description"]')
              ?.content || "";
          const site = location.hostname.replace("www.", "");
          const title = document.title;

          let contextString = "";

          if (alt) contextString += `Image alt text: ${alt} \n`;
          if (caption) contextString += `Caption: ${caption} \n`;
          if (heading) contextString += `Heading: ${heading} \n`;
          if (context) contextString += `Website context: ${context} \n`;
          if (meta) contextString += `Meta: ${meta} \n`;
          if (site) contextString += `Site: ${site} \n`;
          if (title) contextString += `Document title: ${title}`;

          return contextString;
        }
        return null;
      },
      args: [srcUrl],
    });

    context = result?.result;
  }

  // Enable side panel for this tab
  try {
    // Set panel options for this specific tab
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel/sidepanel.html",
      enabled: true,
    });

    // Inject a script to open the side panel (preserves user gesture context)
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // This runs in the page context and can trigger the side panel
        // We'll use a small delay to ensure the background has time to set up
        setTimeout(() => {
          // Send a message to background to open the panel
          chrome.runtime.sendMessage({ action: "openSidePanelFromPage" });
        }, 50);
      },
    });

    // Give the panel more time to initialize and open
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Send tab ID to side panel
    try {
      await chrome.runtime.sendMessage({
        action: "setTabId",
        tabId: tabId,
      });
    } catch (e) {
      // Panel might not be ready yet, will set on first stream update
    }
  } catch (error) {
    console.error("Error setting up side panel:", error);
  }

  // Wait a bit more before starting generation to ensure everything is ready
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    await generateFromImage(srcUrl, context, tabId, tab.url);

    // Result will be stored in handleStreamComplete when streaming finishes
  } catch (err) {
    console.error("Error generating alt text:", err);
  }
}
