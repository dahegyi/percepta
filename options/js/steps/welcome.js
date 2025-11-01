import {
  startWizard,
  updateSettings,
  updatePageLanguage,
  getState,
  loadTranslations,
} from "../main.js";
import { reveal } from "../utils/ui.js";
import { LANGUAGE_MAP as languageMap } from "../../../constants.js";

// Helper function to update i18n after HTML changes
async function updateI18n(container) {
  await updatePageLanguage();

  // After translations are applied, restore the dropdown value if language is saved
  const state = getState();
  const savedLanguage = state.settings.language;

  const dropdownValue = container.querySelector("#welcomeLanguageValue");

  if (savedLanguage) {
    dropdownValue.textContent = languageMap[savedLanguage];
  } else {
    // No saved language, show placeholder text from i18n
    const selectLangKey = "selectLanguage";
    const translations = await loadTranslations(
      state.settings.language || "en",
    );
    dropdownValue.textContent =
      translations[selectLangKey]?.message || "Select a language...";
  }
}

let checkInterval = null;

export function render(container, state) {
  container.innerHTML = /* html */ `
    <div class="step-header">
      <div class="welcome-logo">
        <img id="welcomeLogo" data-i18n-alt="welcomeLogoAlt" alt="" />
      </div>
      <h1 class="step-title" data-i18n="welcomeTitle"></h1>
      <p class="step-description" data-i18n="welcomeTagline"></p>
    </div>

    <div class="form-group" id="welcomeLanguageGroup">
      <label class="form-label" data-i18n="welcomeLanguageLabel"></label>
      <div class="custom-select">
        <button
          type="button"
          id="welcomeLanguageTrigger"
          class="select-trigger"
          aria-haspopup="listbox"
          aria-expanded="false"
        >
          <span id="welcomeLanguageValue"></span>
          <span class="select-icon" aria-hidden="true">▼</span>
        </button>
        <ul
          id="welcomeLanguageMenu"
          class="select-menu"
          role="listbox"
        >
          <li role="option" data-value="en" class="select-option" tabindex="-1">English</li>
          <li role="option" data-value="es" class="select-option" tabindex="-1">Español</li>
          <li role="option" data-value="ja" class="select-option" tabindex="-1">日本語</li>
        </ul>
      </div>
    </div>

    <div class="form-group" id="welcomeAIGroup" style="display: none;">
      <div class="ai-status-container">
        <div class="ai-status-icon" id="aiStatusIcon">⏳</div>
        <div class="ai-status-text">
          <h3 class="ai-status-title" id="aiStatusTitle" data-i18n="aiCheckingTitle"></h3>
          <p class="ai-status-desc" id="aiStatusDesc" data-i18n="aiCheckingDesc"></p>
        </div>
      </div>
    </div>

    <div class="step-actions hidden" id="continueSection">
      <button 
        type="button" 
        class="btn btn-primary"
        id="welcomeContinue"
        data-i18n-aria-label="ariaLabelContinueToContent"
      >
        <span data-i18n="continue"></span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      </button>
    </div>
  `;

  updateI18n(container);
  updateLogoForTheme(state);
  attachWelcomeEvents(container, state);
}

// Update logo based on theme
function updateLogoForTheme(state) {
  const logo = document.getElementById("welcomeLogo");
  if (!logo) return;

  const theme = state.settings.colorScheme;

  // High contrast defaults to dark icon
  if (theme === "high-contrast") {
    logo.src = "../assets/icon-dark.svg";
  } else if (theme === "light") {
    logo.src = "../assets/icon-light.svg";
  } else if (theme === "dark") {
    logo.src = "../assets/icon-dark.svg";
  } else if (theme === "auto" || !theme) {
    // Detect system theme
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    const prefersHighContrast = window.matchMedia(
      "(prefers-contrast: more)",
    ).matches;

    // High contrast defaults to dark icon
    if (prefersHighContrast) {
      logo.src = "../assets/icon-dark.svg";
    } else {
      logo.src = prefersDark
        ? "../assets/icon-dark.svg"
        : "../assets/icon-light.svg";
    }
  }
}

export function attachWelcomeEvents(container, state) {
  const trigger = container.querySelector("#welcomeLanguageTrigger");
  const menu = container.querySelector("#welcomeLanguageMenu");
  const options = menu.querySelectorAll(".select-option");
  const wizardContainer = container.closest(".wizard-container");

  const openMenu = () => {
    trigger.setAttribute("aria-expanded", "true");

    // Check if there's enough space below
    const triggerRect = trigger.getBoundingClientRect();
    const menuHeight = 250; // Approximate max height of menu
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;

    // If not enough space below but enough space above, open upward
    if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
      menu.classList.add("open-upward");
    } else {
      menu.classList.remove("open-upward");
    }

    menu.classList.add("open");
    if (wizardContainer) {
      wizardContainer.classList.add("select-open");
    }

    const selected = menu.querySelector('[aria-selected="true"]');
    const targetOption = selected || options[0];
    targetOption?.focus();
  };

  const closeMenu = () => {
    trigger.setAttribute("aria-expanded", "false");
    menu.classList.remove("open");
    if (wizardContainer) {
      wizardContainer.classList.remove("select-open");
    }
  };

  // Pre-fill if language already selected
  const savedLanguage = state.settings.language;
  if (savedLanguage) {
    // Mark the option as selected
    const selectedOption = menu.querySelector(
      `[data-value="${savedLanguage}"]`,
    );
    if (selectedOption) {
      selectedOption.setAttribute("aria-selected", "true");
    }

    // Show continue button immediately if language already selected
    showContinueButton(container);
  }

  const toggleMenu = () => {
    const isExpanded = trigger.getAttribute("aria-expanded") === "true";
    if (isExpanded) closeMenu();
    else openMenu();
  };

  trigger.addEventListener("click", toggleMenu);

  trigger.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" ||
      e.key === " " ||
      e.key === "ArrowDown" ||
      e.key === "ArrowUp"
    ) {
      e.preventDefault();
      toggleMenu();
    }
  });

  options.forEach((option) => {
    option.addEventListener("click", async () => {
      const value = option.getAttribute("data-value");

      options.forEach((opt) => opt.setAttribute("aria-selected", "false"));
      option.setAttribute("aria-selected", "true");

      closeMenu();

      // Update page language
      await updatePageLanguage(value);

      // Check if language has changed, don't animate if it hasn't
      const savedLanguage = state.settings.language;

      if (
        (savedLanguage === "" && value !== "en") ||
        (savedLanguage !== "" && value !== savedLanguage)
      ) {
        // Add transitioning class to fade out
        document.body.classList.add("language-transitioning");

        // Wait for fade out animation
        await new Promise((resolve) => setTimeout(resolve, 200));

        document.body.classList.remove("language-transitioning");
      }

      chrome.storage.sync.set({ language: value });
      updateSettings({ language: value });

      // Update the selected language display after translation
      container.querySelector("#welcomeLanguageValue").textContent =
        languageMap[value];

      // Show continue button after language selection
      showContinueButton(container);
    });

    option.addEventListener("keydown", (e) => {
      const currentIndex = Array.from(options).indexOf(option);

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        option.click();
      } else if (e.key === "Escape") {
        closeMenu();
        trigger.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const nextIndex = (currentIndex + 1) % options.length;
        options[nextIndex].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prevIndex = (currentIndex - 1 + options.length) % options.length;
        options[prevIndex].focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        options[0].focus();
      } else if (e.key === "End") {
        e.preventDefault();
        options[options.length - 1].focus();
      }
    });
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!trigger.contains(e.target) && !menu.contains(e.target)) {
      closeMenu();
    }
  });

  // Setup continue button
  const continueBtn = container.querySelector("#welcomeContinue");
  continueBtn?.addEventListener("click", () => {
    // Check if we're in language selection phase or AI phase
    const aiGroup = container.querySelector("#welcomeAIGroup");
    const isAIGroupVisible = aiGroup.style.display !== "none";

    if (isAIGroupVisible) {
      // AI section is visible, start the wizard
      startWizard();
    } else {
      // Language selection phase, hide language section and show AI section
      hideLanguageSectionAndContinue(container);
      showAISection(container);
    }
  });
}

function showContinueButton(container) {
  const continueSection = container.querySelector("#continueSection");
  reveal(continueSection);
}

function hideLanguageSectionAndContinue(container) {
  const stepHeader = container.querySelector(".step-header");
  const languageGroup = container.querySelector("#welcomeLanguageGroup");

  // Add hiding class to trigger CSS transitions
  stepHeader.classList.add("hiding");
  languageGroup.classList.add("hiding");

  // After transition completes (300ms), hide both the header and language group
  setTimeout(() => {
    stepHeader.style.display = "none";
    languageGroup.style.display = "none";
  }, 300);
}

async function showAISection(container) {
  const aiGroup = container.querySelector("#welcomeAIGroup");
  const continueSection = container.querySelector("#continueSection");

  // Hide continue button initially - it will be shown only if AI is available
  continueSection.classList.add("hidden");
  continueSection.classList.remove("active");

  // Wait for the hide animation to complete before showing AI section
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Show AI group with display: block
  aiGroup.style.display = "block";

  // Force reflow to ensure transition works
  void aiGroup.offsetHeight;

  // Add active class for fade-in animation
  requestAnimationFrame(() => {
    aiGroup.classList.add("active");
  });

  // Check AI availability continuously every 1s until available
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  const initialStatus = await checkAIAvailability(container);
  if (initialStatus !== "available") {
    checkInterval = setInterval(async () => {
      const status = await checkAIAvailability(container);
      if (status === "available") {
        clearInterval(checkInterval);
        checkInterval = null;
      }
    }, 1000);
  }
}

async function checkAIAvailability(container) {
  const statusIcon = container.querySelector("#aiStatusIcon");
  const statusTitle = container.querySelector("#aiStatusTitle");
  const statusDesc = container.querySelector("#aiStatusDesc");

  try {
    // Check if LanguageModel API exists
    if (typeof LanguageModel === "undefined") {
      showAIStatus(statusIcon, statusTitle, statusDesc, "unavailable");
      await chrome.storage.sync.set({
        hasNano: false,
        nanoAvailability: "unavailable",
      });
      return "unavailable";
    }

    // Check availability
    const availability = await LanguageModel.availability();

    // Store availability status
    await chrome.storage.sync.set({
      hasNano: availability === "available",
      nanoAvailability: availability,
    });

    switch (availability) {
      case "available":
        showAIStatus(statusIcon, statusTitle, statusDesc, "available");
        break;

      case "downloadable":
      case "downloading":
        showAIStatus(statusIcon, statusTitle, statusDesc, "downloading");
        break;

      case "unavailable":
      default:
        showAIStatus(statusIcon, statusTitle, statusDesc, "unavailable");
    }
    return availability;
  } catch (error) {
    console.error("Error checking AI availability:", error);
    showAIStatus(statusIcon, statusTitle, statusDesc, "unavailable");
    return "unavailable";
  }
}

function showAIStatus(icon, title, desc, status) {
  const statuses = {
    available: {
      icon: "✅",
      titleKey: "aiAvailableTitle",
      descKey: "aiAvailableDesc",
    },
    downloading: {
      titleKey: "aiDownloadingTitle",
      descKey: "aiDownloadingDesc",
    },
    unavailable: {
      icon: "😔",
      titleKey: "aiUnavailableTitle",
      descKey: "aiUnavailableDesc",
    },
  };

  const statusInfo = statuses[status] || statuses.unavailable;

  // Clear any existing spinner
  icon.innerHTML = "";

  if (status === "downloading") {
    // Create spinner element for downloading state
    const spinner = document.createElement("div");
    spinner.className = "ai-spinner";
    icon.appendChild(spinner);
  } else {
    // Use text content for other states
    icon.textContent = statusInfo.icon;
  }

  title.setAttribute("data-i18n", statusInfo.titleKey);
  desc.setAttribute("data-i18n", statusInfo.descKey);

  // Apply translations after setting data-i18n attributes
  updatePageLanguage();

  // Show continue button only if AI is available
  if (status === "available") {
    const continueSection = document.querySelector("#continueSection");
    if (continueSection) {
      setTimeout(() => {
        continueSection.classList.remove("hidden");
        continueSection.classList.add("active");
      }, 200);
    }
  }
}

// Cleanup on module unload
export function cleanup() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
