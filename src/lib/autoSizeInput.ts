/**
 * Auto-sizes an <input> to its content by measuring text in a hidden <span>.
 * Returns a cleanup function that removes the sizer and listener.
 */
export function autoSizeInput(input: HTMLInputElement, minCh = 2): () => void {
  const sizer = document.createElement("span");
  sizer.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;pointer-events:none;";
  document.body.appendChild(sizer);

  function sync() {
    const cs = getComputedStyle(input);
    sizer.style.font = cs.font;
    sizer.style.letterSpacing = cs.letterSpacing;
    sizer.textContent = input.value || input.placeholder || "";
    input.style.width = Math.max(sizer.offsetWidth + 2, minCh * 8) + "px";
  }

  input.addEventListener("input", sync);
  requestAnimationFrame(sync);

  return () => {
    input.removeEventListener("input", sync);
    if (document.body.contains(sizer)) sizer.remove();
  };
}
