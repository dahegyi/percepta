/**
 * UI utility functions for the setup wizard
 */

/**
 * Reveals an element with a fade-in animation
 * @param {HTMLElement} el - The element to reveal
 */
export function reveal(el) {
  if (!el) return;

  // Remove hidden class to make it visible
  el.classList.remove("hidden");

  // Force reflow to ensure transition works
  void el.offsetHeight;

  // Add active class for fade-in animation
  requestAnimationFrame(() => {
    el.classList.add("active");
  });
}

/**
 * Enable arrow key navigation for radio button groups
 * @param {HTMLElement} container - Container element with radio buttons
 * @param {string} name - Name attribute of the radio group
 */
export function enableRadioArrows(container, name) {
  const handleKeydown = (e) => {
    if (e.target.type !== "radio") return;
    if (e.target.name !== name) return;

    const radioInput = e.target;

    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowLeft"
    ) {
      const radios = Array.from(
        container.querySelectorAll(`input[name="${name}"]`),
      );
      const currentIndex = radios.indexOf(radioInput);

      if (currentIndex === -1) return;

      e.preventDefault();

      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        const nextIndex = (currentIndex + 1) % radios.length;
        radios[nextIndex].focus();
        radios[nextIndex].checked = true;
        radios[nextIndex].dataset.keyboardNavigation = "true";
        radios[nextIndex].dispatchEvent(new Event("change"));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        const prevIndex = (currentIndex - 1 + radios.length) % radios.length;
        radios[prevIndex].focus();
        radios[prevIndex].checked = true;
        radios[prevIndex].dataset.keyboardNavigation = "true";
        radios[prevIndex].dispatchEvent(new Event("change"));
      }
    }
  };

  container.addEventListener("keydown", handleKeydown);

  // Return cleanup function
  return () => {
    container.removeEventListener("keydown", handleKeydown);
  };
}
