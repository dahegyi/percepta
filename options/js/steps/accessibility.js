import { updateSettings, goToNextStep, goToPreviousStep } from "../main.js";
import { applyFontSize } from "../../../constants.js";

export function render(container, state) {
  const currentFontSize = state.settings.fontSize || "normal";

  // Map font sizes to slider values
  const fontSizeMap = { smaller: 1, small: 2, normal: 3, large: 4, larger: 5 };
  const currentValue = fontSizeMap[currentFontSize] || 3;

  container.innerHTML = /* html */ `
    <div class="step-header">
      <h1 id="stepAccessibilityTitle" class="step-title" data-i18n="stepAccessibilityTitle"></h1>
      <p class="step-description" data-i18n="stepAccessibilityDescription"></p>
    </div>

    <div class="form-group">
      <div class="font-size-preview">
        <span class="preview-text" id="fontSizePreview">Aa</span>
      </div>
      
      <div class="slider-wrapper">
         <div class="slider-labels">
           <span class="slider-label" data-i18n="fontSizeSmallerLabel"></span>
           <span class="slider-label" data-i18n="fontSizeSmallLabel"></span>
           <span class="slider-label" data-i18n="fontSizeNormalLabel"></span>
           <span class="slider-label" data-i18n="fontSizeLargeLabel"></span>
           <span class="slider-label" data-i18n="fontSizeLargerLabel"></span>
         </div>
         
         <div class="slider-container">
           <input
             type="range"
             id="fontSizeSlider"
             name="font-size"
             min="1"
             max="5"
             step="1"
             value="${currentValue}"
             class="font-size-slider"
             data-i18n-aria-label="ariaLabelFontSizeSelection"
           />
           <div class="slider-track">
             <div class="slider-progress"></div>
           </div>
           <div class="slider-thumbs">
             <div class="slider-thumb" data-value="1"></div>
             <div class="slider-thumb" data-value="2"></div>
             <div class="slider-thumb" data-value="3"></div>
             <div class="slider-thumb" data-value="4"></div>
             <div class="slider-thumb" data-value="5"></div>
           </div>
         </div>
      </div>
    </div>

    <div class="step-actions">
      <button
        type="button"
        class="btn btn-primary"
        id="stepAccessibilityContinue"
        data-i18n-aria-label="ariaLabelContinueToShortcuts"
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
      <button type="button" class="btn btn-secondary" id="stepAccessibilityBack" data-i18n-aria-label="ariaLabelBackToTheme">
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

  attachAccessibilityEvents(container);
}

function attachAccessibilityEvents(container) {
  const slider = container.querySelector("#fontSizeSlider");
  const preview = container.querySelector("#fontSizePreview");

  // Map slider values to font sizes
  const valueToSize = {
    1: "smaller",
    2: "small",
    3: "normal",
    4: "large",
    5: "larger",
  };
  const sizeToFontSize = {
    smaller: "20px",
    small: "24px",
    normal: "32px",
    large: "48px",
    larger: "64px",
  };

  function updateSlider(value) {
    const size = valueToSize[value];
    preview.style.fontSize = sizeToFontSize[size];

    updateSliderVisuals(value);
    updateSettings({ fontSize: size });
    applyFontSize(size);

    chrome.storage.sync.set({ fontSize: size });
  }

  function updateSliderVisuals(value) {
    const progress = container.querySelector(".slider-progress");
    const thumbs = container.querySelectorAll(".slider-thumb");

    const percentage = ((value - 1) / 4) * 100;
    progress.style.width = `${percentage}%`;

    thumbs.forEach((thumb, index) => {
      thumb.classList.toggle("active", index + 1 <= value);
    });
  }

  updateSliderVisuals(slider.value);
  preview.style.fontSize = sizeToFontSize[valueToSize[slider.value]];

  slider.addEventListener("input", (e) => {
    updateSlider(parseInt(e.target.value));
  });

  // Click on thumbs to jump to values
  container.querySelectorAll(".slider-thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      const value = parseInt(thumb.dataset.value);
      slider.value = value;
      updateSlider(value);
    });
  });

  container
    .querySelector("#stepAccessibilityBack")
    ?.addEventListener("click", () => {
      goToPreviousStep();
    });

  container
    .querySelector("#stepAccessibilityContinue")
    ?.addEventListener("click", () => {
      goToNextStep();
    });
}
