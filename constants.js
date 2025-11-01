/**
 * Percepta - Shared Constants
 * Constants used across multiple parts of the extension
 */

// ============================================
// Language Configuration
// ============================================

// Supported languages in the extension
export const SUPPORTED_LANGUAGES = ["en", "es", "ja"];

// Language display names
export const LANGUAGE_MAP = {
  en: "English",
  es: "Español",
  ja: "日本語",
};

/**
 * Detect browser language and return supported language code
 */
export function detectBrowserLanguage() {
  const browserLang = navigator.language || navigator.userLanguage || "en";
  const primaryLang = browserLang.split("-")[0].toLowerCase();

  if (SUPPORTED_LANGUAGES.includes(primaryLang)) {
    return primaryLang;
  }

  // Handle special cases for language variants
  const langMap = {};

  const fullLang = browserLang.toLowerCase();
  if (langMap[fullLang]) {
    return langMap[fullLang];
  }

  return "en";
}

// ============================================
// Accessibility Configuration
// ============================================

// Font size mappings
export const FONT_SIZES = {
  smaller: "12px",
  small: "14px",
  normal: "16px",
  large: "18px",
  larger: "20px",
};

/**
 * Apply font size to document
 */
export function applyFontSize(size) {
  document.documentElement.style.fontSize =
    FONT_SIZES[size] || FONT_SIZES.normal;
}

// ============================================
// Default Settings
// ============================================

/**
 * Detail level to max word count mapping
 * Used for image and screenshot analysis
 */
export const DETAIL_LEVEL_MAP = {
  short: 20,
  medium: 50,
  long: 90,
};

/**
 * Default settings object
 * Used across popup, setup wizard, and sidepanel
 */
export const DEFAULT_SETTINGS = {
  language: "en",
  colorScheme: "auto",
  detailLevel: "medium",
  fontSize: "normal",
};

/**
 * Create a new settings object with defaults
 * Merges provided settings with defaults
 */
export function createSettings(overrides = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

// ============================================
// AI Prompts
// ============================================

// OG prompt
// Provide a functional, objective description of the provided image in no more than around 20 words so that someone who could not see it would be able to imagine it.
// If possible, follow an "object-action-context" framework.
// The object is the main focus.
// The action describes what's happening, usually what the object is doing.
// The context describes the surrounding environment.
// If there is text found in the image, do your best to transcribe the important bits, even if it extends the word count beyond 20 words.
// It should not contain quotation marks, as those tend to cause issues when rendered on the web.
// If there is no text found in the image, then there is no need to mention it.
// You should not begin the description with any variation of "The image".

const removeWhitespace = (text) => {
  return text.replace(/\s+/g, " ").trim();
};

export const LANGUAGE_PROMPT = (language) => {
  let upperCaseLanguage = "";

  switch (language) {
    case "es":
      upperCaseLanguage = "SPANISH";
      break;
    case "ja":
      upperCaseLanguage = "JAPANESE";
      break;
    default:
      upperCaseLanguage = "ENGLISH";
  }

  return `
    ALWAYS respond in ${upperCaseLanguage}, regardless of the context.
  `;
};

const COMMON_PROMPT_PREFIX = `
  You are Percepta, a helpful assistant that can help with a variety of tasks.
  You are currently in the context of a page or image.
`;

const COMMON_PROMPT = `
  When mentioning named entities, such as people, places, organizations, or known concepts,
  ALWAYS wrap them in WIKI markers, this is IMPORTANT!
  Example 1: "[[WIKI:Albert Einstein]] standing in front of a chalkboard, teaching students at [[WIKI:Princeton University]].  
  The classroom appears filled with equations related to [[WIKI:relativity]], and Einstein is mid-gesture, explaining a complex concept."
  Example 2: "The principles of [[WIKI:Quantum computing]] are fundamentally different from those of [[WIKI:Classical computing]].  
  Companies like [[WIKI:IBM]] and [[WIKI:Google]] are investing heavily in [[WIKI:Quantum supremacy]] research,  
  aiming to solve problems once thought impossible for traditional computers."
  Example 3: "In the aftermath of [[WIKI:World War II]], leaders such as [[WIKI:Winston Churchill]], [[WIKI:Franklin D. Roosevelt]], and [[WIKI:Joseph Stalin]] played crucial roles in shaping the postwar order.  
  Later in the century, figures like [[WIKI:Margaret Thatcher]], [[WIKI:Ronald Reagan]], and [[WIKI:Mikhail Gorbachev]] influenced global politics through economic reform and the easing of Cold War tensions."
  Otherwise, you can output your response in Markdown format, but you must wrap the named entities in the WIKI markers.
  Use **bold**, *italic*, [links](...), lists, and line breaks where appropriate.
  The current date and time is ${new Date().toLocaleString()}.
`;

export const ACTION_BUTTON_PROMPT = (language = "en") => {
  return `
    Based on the previous analysis, create up to 3 possible questions that would be helpful for the user.
    Respond with only the questions in this exact format:
    perceptaActions: ["Question 1", "Question 2", "Question 3"]
    Each question should be concise (up to 45 characters) and actionable.
    When a user responds with one of these questions, you need to answer it in the context of the previous analysis.
    Do not respond with the question itself.
    ${LANGUAGE_PROMPT(language)}
  `;
};

export const TITLE_GENERATION_PROMPT = (language = "en") => {
  return `
    Based on the previous analysis, create a short, maximum 50 characters long, descriptive title.
    The title should capture the main subject or topic of the analysis.
    Respond with only the title in this exact format:
    perceptaTitle: "Your Title Here"
    Do not use quotes within the title itself.
    Keep it concise and informative.
    ${LANGUAGE_PROMPT(language)}
  `;
};

export const PROMPT_SCREENSHOT = (min, max, language = "en") => {
  const prompt = `
    ${COMMON_PROMPT_PREFIX}
    You are helping a user who cannot see the screen.
    You will be given a screenshot of a document and context information that the user is currently on.
    Their screen reader already reads all written text, links, and structure aloud.
    Your task is to interpret the visual meaning of the page — what is being emphasized, implied, or visually communicated beyond the text itself.
    Focus on what a sighted reader would understand from the visuals at a glance.
    Focus on meaning and context, not layout or design.
    Identify which story, topic, or message appears most prominent.
    If the image includes a chart, graph, infographic, or map, explain what the data means and what key trends or comparisons it reveals.
    If the image includes photographs or illustrations, describe what they represent and how they shape the story's message or perception.
    If the image is a map, explain what place it shows, what areas stand out, and what the markers or highlights mean.
    Always use context from the page to interpret significance and connect visuals to headlines, topics, or surrounding elements.
    Avoid describing layout, colors, or decorative design unless they directly influence meaning.
    Write naturally and clearly, keep the description concise but insightful, roughly ${min} to ${max} words long.
    Do not use academic or evaluative phrases like "the overall [...] is ...".
    If any follow-up questions are asked, provide a response that is relevant to the question and the context of the page.
    You can tell the user where to find the information they are looking for if they ask a question about the page.
    The context information includes the actual source URL of the page being analyzed.
    Always trust the URL provided in the context as the true source of the content.
    Do not mention screenshot or image in your response in any way.
    ${COMMON_PROMPT}
    ${LANGUAGE_PROMPT(language)}
  `;

  return removeWhitespace(prompt);
};

export const PROMPT_IMAGE = (min, max, language = "en") => {
  const prompt = `
    ${COMMON_PROMPT_PREFIX}
    Provide a detailed description of the provided image in no more than around ${max} words so that someone who could not see it would be able to imagine it.
    Follow an "object-action-context" framework if possible.
    The object is the main focus.
    The action describes what's happening, usually what the object is doing.
    The context describes the surrounding environment.
    If there is text found in the image, do your best to transcribe the important bits, even if it extends the word count beyond ${max} words.
    If there is no text found in the image, then there is no need to mention it.
    If there are people found in the image, mention them by name.
    If there are multiple people found in the image, then describe them all.
    if there are no people found in the image, then there is no need to mention it.
    Do not use quotation marks or phrasing such as "The image shows".
    Try to use the context to help you describe the image.
    If the provided context includes specific details (names, products, locations, events, dates, or other entities), align your description with them when relevant.
    Use the image URL as context only if it clearly reveals the subject (e.g., file name like "mars-rover.jpg") or if the image is a logo.
    ${COMMON_PROMPT}
    ${LANGUAGE_PROMPT(language)}
    Context starts below.
  `;

  return removeWhitespace(prompt);
};
