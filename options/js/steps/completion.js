import {
  announceToScreenReader,
  updatePageLanguage,
  loadTranslations,
  getState,
  loadStep,
} from "../main.js";

export function render(container, state) {
  container.innerHTML = /* html */ `
    <div class="completion-screen">
      <div class="completion-celebration">
        <div class="celebration-icon">🎉</div>
        <h1 class="completion-title" data-i18n="completionTitle"></h1>
        <p class="completion-message" data-i18n="completionMessage"></p>
      </div>

      <div class="completion-actions">
        <button
          type="button"
          class="btn btn-primary btn-large"
          id="launchPercepta"
        >
          <span data-i18n="launchPercepta"></span>
        </button>
        <button
          type="button"
          class="btn btn-link"
          id="startSetupAgain"
        >
          <span data-i18n="startSetupAgain"></span>
        </button>
      </div>
    </div>
  `;

  attachCompletionEvents(container);
  updatePageLanguage();
  announceCompletion();
}

async function announceCompletion() {
  const state = getState();
  const translations = await loadTranslations(state.settings.language || "en");
  const message =
    translations["setupCompleteAnnouncement"]?.message ||
    "Setup complete! Percepta is ready to use. All your preferences have been saved.";
  announceToScreenReader(message);
}

function attachCompletionEvents(container) {
  container.querySelector("#launchPercepta")?.addEventListener("click", () => {
    window.close();
    chrome.action.openPopup();
  });

  container
    .querySelector("#startSetupAgain")
    ?.addEventListener("click", async () => {
      try {
        await chrome.storage.sync.set({ isSetupCompleted: false });
      } catch (e) {
        // no-op
      }
      await loadStep("welcome");
    });
}
