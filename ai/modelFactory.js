/**
 * Create a language model session with the given initial prompt
 * @param {string} initialPrompt - The system prompt
 * @param {string} userLanguage - The user's language code (en, es, ja supported)
 */
export async function createLanguageModel(initialPrompt, userLanguage = "en") {
  if (!initialPrompt) {
    throw new Error("Initial prompt is required");
  }

  // Check if LanguageModel API is available
  if (!self.LanguageModel || typeof self.LanguageModel.create !== "function") {
    const error = new Error("LanguageModel API is not available");
    error.code = "LANGUAGE_MODEL_UNAVAILABLE";
    console.error("LanguageModel API not available:", error);
    throw error;
  }

  // Ensure outputLanguage is one of the supported languages
  const supportedOutputLanguages = ["en", "es", "ja"];
  if (!supportedOutputLanguages.includes(userLanguage)) {
    console.warn(
      `Unsupported userLanguage: ${userLanguage}, defaulting to 'en'`,
    );
    userLanguage = "en";
  }

  try {
    const session = await self.LanguageModel.create({
      temperature: 0.5,
      topK: 1.0,
      initialPrompts: [
        {
          role: "system",
          content: initialPrompt,
        },
      ],
      expectedInputs: [
        { type: "image" },
        { type: "text", languages: ["en", userLanguage] },
      ],
      expectedOutputs: [{ type: "text", languages: [userLanguage] }],
    });

    if (!session) {
      const error = new Error("Failed to create language model session");
      error.code = "LANGUAGE_MODEL_CREATION_FAILED";
      throw error;
    }

    return session;
  } catch (error) {
    console.error("Error creating language model:", error);
    console.error("Error name:", error.name, "Error message:", error.message);

    // Tag common error types for better handling
    if (error.name === "NotSupportedError" || error.name === "TypeError") {
      error.code = "LANGUAGE_MODEL_UNAVAILABLE";
    } else if (
      error.name === "QuotaExceededError" ||
      error.message?.toLowerCase().includes("quota")
    ) {
      error.code = "QUOTA_EXCEEDED";
    } else if (
      error.name === "NetworkError" ||
      error.message?.toLowerCase().includes("network")
    ) {
      error.code = "NETWORK_ERROR";
    } else if (!error.code) {
      error.code = "LANGUAGE_MODEL_CREATION_FAILED";
    }

    throw error;
  }
}
