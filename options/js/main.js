import {
  render as renderWelcome,
  cleanup as cleanupWelcome,
} from "./steps/welcome.js";
import { render as renderDetail } from "./steps/detail.js";
import { render as renderAccessibility } from "./steps/accessibility.js";
import { render as renderTheme } from "./steps/theme.js";
import { render as renderShortcuts } from "./steps/shortcuts.js";
import { render as renderCompletion } from "./steps/completion.js";
import {
  detectBrowserLanguage,
  applyFontSize,
  DEFAULT_SETTINGS,
} from "../../constants.js";

const state = {
  currentStep: "welcome",
  currentStepIndex: -1,
  isAnimating: false,
  isWelcomePhase: true,
  isCompletionPhase: false,
  isInitialLoad: true,
  settings: {
    language: "",
    detailLevel: DEFAULT_SETTINGS.detailLevel,
    colorScheme: DEFAULT_SETTINGS.colorScheme,
    fontSize: DEFAULT_SETTINGS.fontSize,
  },
  stepOrder: ["detail", "theme", "accessibility", "shortcuts"],
};

const steps = {
  welcome: renderWelcome,
  detail: renderDetail,
  accessibility: renderAccessibility,
  theme: renderTheme,
  shortcuts: renderShortcuts,
  completion: renderCompletion,
};

async function animateProgressBar(fromIndex, toIndex) {
  const isForward = toIndex > fromIndex;

  if (isForward) {
    for (let i = fromIndex; i < toIndex; i++) {
      const currentStepIndicator = document.querySelector(
        `.progress-step[data-step="${i + 1}"]`,
      );
      if (currentStepIndicator) {
        currentStepIndicator.classList.add("completed");
        currentStepIndicator.classList.remove("active");
      }

      const progressLine = currentStepIndicator?.nextElementSibling;
      if (progressLine && progressLine.classList.contains("progress-line")) {
        progressLine.classList.add("completed");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (i + 1 === toIndex) {
        const nextStepIndicator = document.querySelector(
          `.progress-step[data-step="${i + 2}"]`,
        );
        if (nextStepIndicator) {
          nextStepIndicator.classList.add("active");
          nextStepIndicator.classList.remove("completed");
        }
      }
    }
  } else {
    for (let i = fromIndex; i > toIndex; i--) {
      const stepIndicator = document.querySelector(
        `.progress-step[data-step="${i + 1}"]`,
      );
      if (stepIndicator && i > toIndex) {
        stepIndicator.classList.remove("completed", "active");
      } else if (i === toIndex) {
        stepIndicator.classList.add("active");
        stepIndicator.classList.remove("completed");
      }

      const prevStepIndicator = document.querySelector(
        `.progress-step[data-step="${i}"]`,
      );
      const progressLine = prevStepIndicator?.nextElementSibling;

      if (progressLine && progressLine.classList.contains("progress-line")) {
        progressLine.classList.remove("completed");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}

function updateProgressBar() {
  const progressBar = document.querySelector(".progress-container");

  // Hide progress bar during welcome and completion phases
  if (state.isWelcomePhase || state.isCompletionPhase) {
    progressBar.classList.remove("visible");
    return;
  } else {
    // Add visible class with animation
    progressBar.classList.add("visible");
  }

  progressBar.setAttribute("aria-valuenow", state.currentStepIndex + 1);

  for (let i = 0; i < state.stepOrder.length; i++) {
    const stepIndicator = document.querySelector(
      `.progress-step[data-step="${i + 1}"]`,
    );
    if (!stepIndicator) continue;

    if (i === state.currentStepIndex) {
      stepIndicator.classList.add("active");
      stepIndicator.classList.remove("completed");
    } else if (i < state.currentStepIndex) {
      stepIndicator.classList.add("completed");
      stepIndicator.classList.remove("active");
    } else {
      stepIndicator.classList.remove("active", "completed");
    }
  }
}

function removeStepContainer(container) {
  // Hide progress bar
  updateProgressBar();

  // Render welcome screen
  container.classList.remove(
    "active",
    "exiting",
    "exiting-forward",
    "exiting-backward",
    "entering-forward",
    "entering-backward",
  );

  container.innerHTML = "";
}

// Show welcome phase (Step 0 - before main wizard)
async function showWelcomePhase() {
  state.isWelcomePhase = true;
  state.currentStep = "welcome";
  state.currentStepIndex = -1;

  // Remove wizard-active and add welcome-active class
  document.body.classList.remove("wizard-active");
  document.body.classList.add("welcome-active");

  const container = document.getElementById("stepContainer");

  removeStepContainer(container);

  renderWelcome(container, state);

  // Show container (no animation delay for initial load)
  if (state.isInitialLoad) {
    container.classList.add("active");
    state.isInitialLoad = false;
  } else {
    setTimeout(() => {
      container.classList.add("active");
    }, 50);
  }
}

// Start wizard (after welcome phase completes)
export function startWizard() {
  cleanupWelcome();

  state.isWelcomePhase = false;

  // Remove welcome-active and add wizard-active class
  document.body.classList.remove("welcome-active");
  document.body.classList.add("wizard-active");

  loadStep("detail"); // Start with first step in stepOrder
}

// Show completion phase (after all steps)
async function showCompletionPhase() {
  state.isCompletionPhase = true;
  state.currentStep = "completion";

  // Remove wizard-active and add completion-active class
  document.body.classList.remove("wizard-active");
  document.body.classList.add("completion-active");

  await chrome.storage.sync.set({ isSetupCompleted: true });

  const container = document.getElementById("stepContainer");

  // Add exiting animation
  container.classList.add("exiting-forward");
  await new Promise((resolve) => setTimeout(resolve, 200));

  removeStepContainer(container);

  renderCompletion(container, state);

  // Show with animation
  setTimeout(() => {
    container.classList.add("active");
  }, 50);
}

export async function loadStep(stepName) {
  if (state.isAnimating) return;
  if (!steps[stepName]) return;

  // Handle special screens
  if (stepName === "welcome") {
    await showWelcomePhase();
    return;
  }
  if (stepName === "completion") {
    await showCompletionPhase();
    return;
  }

  const stepIndex = state.stepOrder.indexOf(stepName);
  if (stepIndex === -1) return;

  state.isAnimating = true;
  state.isWelcomePhase = false;
  state.isCompletionPhase = false;

  // Remove welcome/completion classes and add wizard-active for regular steps
  document.body.classList.remove("welcome-active", "completion-active");
  document.body.classList.add("wizard-active");

  const container = document.getElementById("stepContainer");
  const oldIndex = state.currentStepIndex;

  // Determine animation direction
  const isForward = stepIndex > oldIndex;
  const isBackward = stepIndex < oldIndex;

  // Add exiting animation with direction
  if (isForward) {
    container.classList.add("exiting-forward");
  } else if (isBackward) {
    container.classList.add("exiting-backward");
  } else {
    container.classList.add("exiting");
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  // Render new step
  container.classList.remove(
    "exiting",
    "exiting-forward",
    "exiting-backward",
    "active",
  );
  steps[stepName](container, state);

  // Apply translations immediately after rendering
  await updatePageLanguage();

  // Add entering animation with direction (skip delay for initial load)
  if (state.isInitialLoad) {
    container.classList.add("active");
    state.isInitialLoad = false;
  } else {
    // Add entering animation class
    if (isForward) {
      container.classList.add("entering-forward");
    } else if (isBackward) {
      container.classList.add("entering-backward");
    }

    // Force a reflow to ensure the entering animation starts
    container.offsetHeight;

    // After a brief delay, transition to active state
    await new Promise((resolve) => setTimeout(resolve, 20));
    container.classList.add("active");

    // Clean up entering classes after animation completes
    await new Promise((resolve) => setTimeout(resolve, 200));
    container.classList.remove("entering-forward", "entering-backward");
  }

  // Update state
  state.currentStep = stepName;
  state.currentStepIndex = stepIndex;

  // Animate progress bar
  await animateProgressBar(oldIndex, state.currentStepIndex);
  updateProgressBar();

  // Announce to screen readers
  announceStep(stepName);

  state.isAnimating = false;
}

// Navigate to next step
export function goToNextStep() {
  const currentIndex = state.stepOrder.indexOf(state.currentStep);
  if (currentIndex < state.stepOrder.length - 1) {
    const nextStep = state.stepOrder[currentIndex + 1];
    loadStep(nextStep);
  } else if (currentIndex === state.stepOrder.length - 1) {
    // Last step completed, save settings and show completion
    saveSettings().then(() => {
      showCompletionPhase();
    });
  }
}

// Navigate to previous step
export function goToPreviousStep() {
  const currentIndex = state.stepOrder.indexOf(state.currentStep);
  if (currentIndex > 0) {
    const prevStep = state.stepOrder[currentIndex - 1];
    loadStep(prevStep);
  }
}

export function getState() {
  return state;
}

export function updateSettings(updates) {
  Object.assign(state.settings, updates);
}

export async function saveSettings() {
  const settingsData = {
    language: state.settings.language,
    detailLevel: state.settings.detailLevel,
    colorScheme: state.settings.colorScheme,
    fontSize: state.settings.fontSize,
  };

  await chrome.storage.sync.set(settingsData);
}

async function loadExistingSettings() {
  try {
    const [syncResult, localResult] = await Promise.all([
      chrome.storage.sync.get([
        "language",
        "detailLevel",
        "colorScheme",
        "fontSize",
      ]),
      chrome.storage.sync.get(["language"]),
    ]);

    // Use language from local storage if available, otherwise use language from sync
    // If no language is saved, detect browser language
    if (localResult.language) {
      state.settings.language = localResult.language;
    } else if (syncResult.language) {
      state.settings.language = syncResult.language;
    } else {
      // No saved language, detect from browser
      state.settings.language = detectBrowserLanguage();
    }

    if (syncResult.detailLevel)
      state.settings.detailLevel = syncResult.detailLevel;
    else state.settings.detailLevel = DEFAULT_SETTINGS.detailLevel;
    if (syncResult.colorScheme)
      state.settings.colorScheme = syncResult.colorScheme;
    else state.settings.colorScheme = DEFAULT_SETTINGS.colorScheme;
    if (syncResult.fontSize) state.settings.fontSize = syncResult.fontSize;
    else state.settings.fontSize = DEFAULT_SETTINGS.fontSize;

    // Apply language (saved or detected)
    if (state.settings.language) {
      await updatePageLanguage(state.settings.language);
    }

    // Apply theme
    if (state.settings.colorScheme && state.settings.colorScheme !== "auto") {
      applyTheme(state.settings.colorScheme);
    }

    // Apply font size
    if (state.settings.fontSize) {
      applyFontSize(state.settings.fontSize);
    }
  } catch (error) {
    console.error("Error loading settings:", error);
  }
}

// Load translations for a specific language
export async function loadTranslations(langCode) {
  try {
    const response = await fetch(`/_locales/${langCode}/setup.json`);
    if (!response.ok) {
      throw new Error(`Failed to load ${langCode} translations`);
    }
    return await response.json();
  } catch (error) {
    console.warn(
      `Could not load ${langCode} translations, falling back to English`,
    );
    const response = await fetch(`/_locales/en/setup.json`);
    return await response.json();
  }
}

export async function updatePageLanguage(
  langCode = state.settings.language || "en",
) {
  const translations = await loadTranslations(langCode);

  // Update all elements with data-i18n attributes
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    const translationObj = translations[key];
    if (translationObj && translationObj.message) {
      const message = translationObj.message;
      element.innerHTML = message;
    }
  });

  // Update all elements with data-i18n-aria-label attributes
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    const key = element.getAttribute("data-i18n-aria-label");
    const translationObj = translations[key];
    if (translationObj && translationObj.message) {
      element.setAttribute("aria-label", translationObj.message);
    }
  });
}

export function applyTheme(theme) {
  if (theme === "auto") {
    detectSystemTheme();
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

// Detect system theme preference
function detectSystemTheme() {
  if (state.settings.colorScheme === "auto" || !state.settings.colorScheme) {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const themeToApply = prefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", themeToApply);
  } else if (state.settings.colorScheme !== "auto") {
    applyTheme(state.settings.colorScheme);
  }

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", (e) => {
      if (state.settings.colorScheme === "auto") {
        const themeToApply = e.matches ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", themeToApply);
      }
    });
}

// Announce step change to screen readers
async function announceStep(stepName) {
  const translations = await loadTranslations(state.settings.language || "en");

  const stepTitleKeys = {
    detail: "stepTitleDetail",
    theme: "stepTitleTheme",
    accessibility: "stepTitleAccessibility",
    shortcuts: "stepTitleShortcuts",
  };

  const titleKey = stepTitleKeys[stepName];
  const title = (titleKey && translations[titleKey]?.message) || "";
  announceToScreenReader(title);
}

// Announce message to screen readers
export function announceToScreenReader(message) {
  const announcement = document.createElement("div");
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.className = "sr-only";
  announcement.textContent = message;

  document.body.appendChild(announcement);

  setTimeout(() => {
    announcement.remove();
  }, 1000);
}

// Show loading overlay
export function showLoading() {
  const loading = document.getElementById("loading");
  loading.hidden = false;
  loading.setAttribute("aria-busy", "true");
}

// Hide loading overlay
export function hideLoading() {
  const loading = document.getElementById("loading");
  loading.hidden = true;
  loading.setAttribute("aria-busy", "false");
}

// Setup progress step navigation
function setupProgressNavigation() {
  document.querySelectorAll(".progress-step").forEach((step) => {
    step.addEventListener("click", () => {
      const stepNum = parseInt(step.getAttribute("data-step"));
      if (
        !step.classList.contains("active") &&
        stepNum <= state.stepOrder.length
      ) {
        const stepName = state.stepOrder[stepNum - 1];
        loadStep(stepName);
      }
    });
  });
}

// Initialize on page load
document.addEventListener("DOMContentLoaded", async () => {
  hideLoading();

  await loadExistingSettings();
  detectSystemTheme();
  await updatePageLanguage();

  setupProgressNavigation();

  try {
    const { isSetupCompleted } = await chrome.storage.sync.get([
      "isSetupCompleted",
    ]);
    if (isSetupCompleted) {
      await loadStep("completion");
      return;
    }
  } catch (e) {
    // fall through to welcome
  }

  await showWelcomePhase();
});
