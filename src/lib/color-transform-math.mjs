// The global colour-transform math (hue / brightness / contrast sliders) — an
// IMPORT-FREE LEAF so the plain-node promoter can bake a user's transforms into
// the shipped palette with the SAME function the app paints with (task 902).
// `color-transforms.ts` re-exports these with their types; the app imports
// from there.

/** Convert hex (#rrggbb) to HSL [h: 0-360, s: 0-100, l: 0-100]
 *  @param {string} hex @returns {[number, number, number]} */
export function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l * 100];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s * 100, l * 100];
}

/** Convert HSL [h: 0-360, s: 0-100, l: 0-100] to hex (#rrggbb)
 *  @param {number} h @param {number} s @param {number} l @returns {string} */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  /** @param {number} v */
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** True when the transforms leave every colour unchanged.
 *  @param {{ contrast: number, hue: number, brightness: number }} t */
export function isIdentityTransforms(t) {
  return t.contrast === 0 && t.hue === 0 && t.brightness === 0;
}

/**
 * Apply global transforms to a hex color with saturation-aware dampening.
 * Saturated category colors (reds, greens, etc.) are affected less than neutrals.
 * dampFactor = 1 - (saturation * 0.7): 0% sat -> 100% effect, 100% sat -> 30% effect
 *
 * @param {string} hex
 * @param {{ contrast: number, hue: number, brightness: number }} transforms
 * @returns {string}
 */
export function applyTransforms(hex, transforms) {
  if (isIdentityTransforms(transforms)) return hex;

  const [h, s, l] = hexToHsl(hex);
  const dampFactor = 1 - (s / 100) * 0.7;

  // Hue rotation (dampened for saturated colors)
  const newH = h + transforms.hue * dampFactor;

  // Brightness shift (dampened)
  const newL = l + transforms.brightness * dampFactor;

  // Contrast: expand/compress lightness around midpoint (dampened)
  const contrastFactor = 1 + (transforms.contrast / 100) * dampFactor;
  const finalL = 50 + (newL - 50) * contrastFactor;

  return hslToHex(newH, s, Math.max(0, Math.min(100, finalL)));
}
