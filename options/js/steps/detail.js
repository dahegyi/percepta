import { updateSettings, goToNextStep, goToPreviousStep } from "../main.js";

export function render(container, state) {
  const currentDetail = state.settings.detailLevel || "medium";

  container.innerHTML = /* html */ `
    <div class="step-header">
      <h1 id="stepDetailTitle" class="step-title" data-i18n="stepDetailTitle"></h1>
      <p class="step-description" data-i18n="stepDetailDescription"></p>
    </div>

    <div class="form-group">
      <fieldset class="radio-group detail-setup">
        <legend class="sr-only" data-i18n="stepDetailDescription"></legend>
        
        <div class="detail-card">
          <input
            type="radio"
            id="detailShort"
            name="detail-level"
            value="short"
            class="radio-input"
            ${currentDetail === "short" ? "checked" : ""}
            aria-describedby="detailShortDesc"
          />
          <label for="detailShort" class="detail-label">
            <div class="detail-preview short-preview">
              <div class="preview-lines">
                <div class="preview-line short"></div>
              </div>
            </div>
            <div class="detail-info">
              <span class="detail-title" data-i18n="detailShortTitle"></span>
              <span id="detailShortDesc" class="detail-description" data-i18n="detailShortDesc"></span>
            </div>
          </label>
        </div>

        <div class="detail-card">
          <input
            type="radio"
            id="detailMedium"
            name="detail-level"
            value="medium"
            class="radio-input"
            ${currentDetail === "medium" ? "checked" : ""}
            aria-describedby="detailMediumDesc"
            required
          />
          <label for="detailMedium" class="detail-label">
            <div class="detail-preview medium-preview">
              <div class="preview-lines">
                <div class="preview-line medium"></div>
                <div class="preview-line medium"></div>
              </div>
            </div>
            <div class="detail-info">
              <span class="detail-title" data-i18n="detailMediumTitle"></span>
              <span id="detailMediumDesc" class="detail-description" data-i18n="detailMediumDesc"></span>
            </div>
          </label>
        </div>

        <div class="detail-card">
          <input
            type="radio"
            id="detailLong"
            name="detail-level"
            value="long"
            class="radio-input"
            ${currentDetail === "long" ? "checked" : ""}
            aria-describedby="detailLongDesc"
          />
          <label for="detailLong" class="detail-label">
            <div class="detail-preview long-preview">
              <div class="preview-lines">
                <div class="preview-line long"></div>
                <div class="preview-line long"></div>
                <div class="preview-line long"></div>
              </div>
            </div>
            <div class="detail-info">
              <span class="detail-title" data-i18n="detailLongTitle"></span>
              <span id="detailLongDesc" class="detail-description" data-i18n="detailLongDesc"></span>
            </div>
          </label>
        </div>
      </fieldset>
    </div>

    <div class="step-actions">
      <button
        type="button"
        class="btn btn-primary"
        id="stepDetailContinue"
        data-i18n-aria-label="ariaLabelContinueToTheme"
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

  attachDetailEvents(container);
}

function attachDetailEvents(container) {
  container.querySelectorAll('input[name="detail-level"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      const value = e.target.value;
      updateSettings({ detailLevel: value });
      chrome.storage.sync.set({ detailLevel: value });
    });
  });

  // No back button on the first step

  container
    .querySelector("#stepDetailContinue")
    ?.addEventListener("click", () => {
      const selectedDetail = container.querySelector(
        'input[name="detail-level"]:checked',
      );
      if (selectedDetail) {
        updateSettings({ detailLevel: selectedDetail.value });
        goToNextStep();
      }
    });
}
