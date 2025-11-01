import {
  updateSettings,
  goToNextStep,
  goToPreviousStep,
  applyTheme,
} from "../main.js";

export function render(container, state) {
  container.innerHTML = /* html */ `
    <div class="step-header">
      <h1 class="step-title" data-i18n="stepThemeTitle"></h1>
      <p class="step-description" data-i18n="stepThemeDescription"></p>
    </div>

    <div class="form-group">
      <fieldset class="radio-group color-schemes">
        <div class="color-card">
          <input
            type="radio"
            id="themeLight"
            name="color-scheme"
            value="light"
            class="radio-input"
            ${state.settings.colorScheme === "light" ? "checked" : ""}
          />
          <label for="themeLight" class="color-label">
            <div class="color-preview light-preview">
              <div class="preview-bar"></div>
              <div class="preview-content">
                <div class="preview-box"></div>
                <div class="preview-box"></div>
              </div>
            </div>
            <div class="color-info">
              <span class="color-title" data-i18n="themeLightTitle"></span>
              <span class="color-description" data-i18n="themeLightDesc"></span>
            </div>
          </label>
        </div>

        <div class="color-card">
          <input
            type="radio"
            id="themeDark"
            name="color-scheme"
            value="dark"
            class="radio-input"
            ${state.settings.colorScheme === "dark" ? "checked" : ""}
          />
          <label for="themeDark" class="color-label">
            <div class="color-preview dark-preview">
              <div class="preview-bar"></div>
              <div class="preview-content">
                <div class="preview-box"></div>
                <div class="preview-box"></div>
              </div>
            </div>
            <div class="color-info">
              <span class="color-title" data-i18n="themeDarkTitle"></span>
              <span class="color-description" data-i18n="themeDarkDesc"></span>
            </div>
          </label>
        </div>

        <div class="color-card">
          <input
            type="radio"
            id="themeHighContrast"
            name="color-scheme"
            value="high-contrast"
            class="radio-input"
            ${state.settings.colorScheme === "high-contrast" ? "checked" : ""}
          />
          <label for="themeHighContrast" class="color-label">
            <div class="color-preview high-contrast-preview">
              <div class="preview-bar"></div>
              <div class="preview-content">
                <div class="preview-box"></div>
                <div class="preview-box"></div>
              </div>
            </div>
            <div class="color-info">
              <span class="color-title" data-i18n="themeHighContrastTitle"></span>
              <span class="color-description" data-i18n="themeHighContrastDesc"></span>
            </div>
          </label>
        </div>
      </fieldset>
      
      <div class="theme-divider">
        <span class="theme-divider-text" data-i18n="themeDividerText"></span>
      </div>
      
      <div class="theme-auto-option">
        <input
          type="radio"
          id="themeAuto"
          name="color-scheme"
          value="auto"
          class="radio-input"
          ${state.settings.colorScheme === "auto" ? "checked" : ""}
        />
        <label for="themeAuto" class="theme-auto-label">
          <span class="theme-auto-text ${
            state.settings.colorScheme === "auto" ? "selected" : ""
          }" data-i18n="themeAutoTitle"></span>
        </label>
      </div>
    </div>

    <div class="step-actions">
      <button
        type="button"
        class="btn btn-primary"
        id="stepThemeContinue"
        data-i18n-aria-label="ariaLabelContinueToAccessibility"
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
      <button type="button" class="btn btn-secondary" id="stepAccessibilityBack" data-i18n-aria-label="ariaLabelBackToDetail">
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
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        <span data-i18n="back"></span>
      </button>
    </div>
  `;

  attachThemeEvents(container);
}

function attachThemeEvents(container) {
  container.querySelectorAll('input[name="color-scheme"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const value = e.target.value;
      updateSettings({ colorScheme: value });
      applyTheme(value);

      // Update auto option text and check mark styling
      const autoText = container.querySelector(".theme-auto-text");
      const autoCheck = container.querySelector(".theme-auto-check");
      if (autoText) {
        autoText.classList.toggle("selected", value === "auto");
      }
      if (autoCheck) {
        autoCheck.classList.toggle("selected", value === "auto");
      }

      chrome.storage.sync.set({ colorScheme: value });
    });
  });

  container
    .querySelector("#stepAccessibilityBack")
    ?.addEventListener("click", () => {
      goToPreviousStep();
    });

  container
    .querySelector("#stepThemeContinue")
    ?.addEventListener("click", () => {
      const selectedTheme = container.querySelector(
        'input[name="color-scheme"]:checked',
      );
      if (selectedTheme) {
        updateSettings({ colorScheme: selectedTheme.value });
        goToNextStep();
      }
    });
}
