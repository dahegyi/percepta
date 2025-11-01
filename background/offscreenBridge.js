/**
 * Manages creation, health checks, and messaging with the offscreen document
 */

/**
 * Utility function for delays
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ensure the offscreen document exists and is responsive
 * This is called on service worker startup and when needed
 */
export async function ensureOffscreenDocument() {
  try {
    // Check if offscreen document already exists
    const clients = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (clients.length > 0) {
      // Verify it's responsive
      try {
        const pingResult = await Promise.race([
          chrome.runtime.sendMessage({ action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Ping timeout")), 2000),
          ),
        ]);
        if (pingResult?.success) {
          return true;
        }
      } catch (error) {
        // Offscreen exists but not responsive, close it and recreate
        try {
          await chrome.offscreen.closeDocument();
        } catch (closeError) {
          // Ignore close errors
        }
      }
    }

    // Create offscreen document
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Maintain persistent AI model session for chat context",
    });

    // Wait for it to initialize
    await delay(500);

    // Verify it's ready with a ping
    let ready = false;
    for (let i = 0; i < 5; i++) {
      try {
        const pingResult = await Promise.race([
          chrome.runtime.sendMessage({ action: "ping" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Ping timeout")), 2000),
          ),
        ]);
        if (pingResult?.success) {
          ready = true;
          break;
        }
      } catch (error) {
        if (i < 4) {
          await delay(200);
        }
      }
    }

    if (!ready) {
      throw new Error("Offscreen document created but not responsive");
    }

    return true;
  } catch (error) {
    console.error("Error creating offscreen document:", error);
    return false;
  }
}

/**
 * Send a message to the offscreen document with automatic retry logic
 */
export async function sendMessageToOffscreen(message) {
  try {
    // Ensure offscreen document exists
    await ensureOffscreenDocument();

    // Wait a bit more to ensure offscreen document is ready
    await delay(200);

    // For streaming actions, check if generation started
    const isStreamingAction =
      message.action === "createSession" ||
      (message.action === "sendPrompt" &&
        (!message.prompt ||
          !message.prompt[0] ||
          !message.prompt[0].content ||
          !message.prompt[0].content[0] ||
          !message.prompt[0].content[0].value ||
          !message.prompt[0].content[0].value.includes("perceptaActions:")));

    if (isStreamingAction) {
      // Track if we've received stream updates
      let hasReceivedStreamUpdate = false;
      const streamUpdateListener = (msg) => {
        if (msg.action === "streamUpdate" && msg.tabId === message.tabId) {
          hasReceivedStreamUpdate = true;
        }
      };

      // Set up listener BEFORE sending message to catch early stream updates
      chrome.runtime.onMessage.addListener(streamUpdateListener);

      try {
        // Wait for initial acknowledgment (should be quick)
        const response = await Promise.race([
          chrome.runtime.sendMessage(message),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Timeout waiting for generation start")),
              5000,
            ),
          ),
        ]);

        if (!response || !response.started) {
          console.error("❌ Invalid response from offscreen:", response);
          throw new Error(
            response?.error || "No acknowledgment from offscreen document",
          );
        }

        // Check if we already received a stream update (fast path)
        if (hasReceivedStreamUpdate) {
          return response;
        }

        // Wait a bit longer to confirm generation actually started (stream updates)
        // This ensures generation didn't just fail silently
        await new Promise((resolve, reject) => {
          const checkInterval = setInterval(() => {
            if (hasReceivedStreamUpdate) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);

          setTimeout(() => {
            clearInterval(checkInterval);
            resolve();
          }, 10000); // Give 10 seconds for first stream update
        });

        return response;
      } finally {
        chrome.runtime.onMessage.removeListener(streamUpdateListener);
      }
    } else {
      // For non-streaming actions, use the standard timeout
      const response = await Promise.race([
        chrome.runtime.sendMessage(message),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout after 30s")), 30000),
        ),
      ]);

      if (!response) {
        throw new Error("No response from offscreen document");
      }

      return response;
    }
  } catch (error) {
    console.error("Error sending message to offscreen:", error);
    // If it's a connection error, try to recreate the offscreen document
    if (
      error.message?.includes("Receiving end does not exist") ||
      error.message?.includes("Could not establish connection") ||
      error.message?.includes("Timeout") ||
      error.message?.includes("did not start")
    ) {
      try {
        await chrome.offscreen.closeDocument();
      } catch (e) {
        // Ignore errors when closing
      }
      await ensureOffscreenDocument();
      await delay(500);
      // Retry once
      try {
        const isStreamingAction =
          message.action === "createSession" ||
          (message.action === "sendPrompt" &&
            (!message.prompt ||
              !message.prompt[0] ||
              !message.prompt[0].content ||
              !message.prompt[0].content[0] ||
              !message.prompt[0].content[0].value ||
              !message.prompt[0].content[0].value.includes(
                "perceptaActions:",
              )));
        const timeout = isStreamingAction ? 5000 : 30000;
        const retryResponse = await Promise.race([
          chrome.runtime.sendMessage(message),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timeout on retry")), timeout),
          ),
        ]);
        if (!retryResponse) {
          throw new Error("No response from offscreen document on retry");
        }
        return retryResponse;
      } catch (retryError) {
        throw new Error(`Failed after retry: ${retryError.message}`);
      }
    }
    throw error;
  }
}
