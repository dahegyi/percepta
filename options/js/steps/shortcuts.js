import { goToNextStep, goToPreviousStep } from "../main.js";

export function render(container, state) {
  // Detect platform for shortcut display
  const isMac =
    /Mac/.test(navigator.userAgent) ||
    (navigator.userAgentData && navigator.userAgentData.platform === "macOS");

  const shortcutKey = isMac ? "Command+Shift+P" : "Ctrl+Shift+P";

  container.innerHTML = /* html */ `
    <div class="step-header">
      <h1 class="step-title" data-i18n="stepShortcutsTitle"></h1>
      <p class="step-description" data-i18n="stepShortcutsDescription"></p>
    </div>

    <div class="shortcuts-content">
      <div class="shortcut-display">
        <span class="shortcut-key">${shortcutKey}</span>
      </div>

      <div class="shortcut-change-info">
        <p data-i18n="shortcutChangeInfo"></p>
        <a href="chrome://extensions/shortcuts" target="_blank" class="shortcut-link">
          chrome://extensions/shortcuts
        </a>
      </div>
    </div>

    <div class="step-actions">
      <button
        type="button"
        class="btn btn-primary"
        id="finishSetup"
        data-i18n-aria-label="ariaLabelFinishSetup"
      >
        <span data-i18n="finish"></span>
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
      <button type="button" class="btn btn-secondary" id="stepAccessibilityBack" data-i18n-aria-label="ariaLabelBackToAccessibility">
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

  attachShortcutEvents(container);
}

function attachShortcutEvents(container) {
  container
    .querySelector("#stepAccessibilityBack")
    ?.addEventListener("click", () => {
      goToPreviousStep();
    });

  container.querySelector("#finishSetup")?.addEventListener("click", () => {
    goToNextStep();
  });
}
