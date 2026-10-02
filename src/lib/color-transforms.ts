/**
 * Color transformation utilities for the global preferences sliders.
 * Handles hex <-> HSL conversion and saturation-aware transforms.
 */

// The math lives in an import-free leaf so the plain-node promoter can bake a
// user's transforms into the shipped palette with this exact function (task 902).
import {
  hexToHsl as hexToHslImpl,
  hslToHex as hslToHexImpl,
  applyTransforms as applyTransformsImpl,
  isIdentityTransforms as isIdentityTransformsImpl,
} from "./color-transform-math.mjs";

export interface GlobalTransforms {
  contrast: number;   // -100 to 100, default 0
  hue: number;        // -180 to 180, default 0
  brightness: number; // -50 to 50, default 0
}

export const DEFAULT_TRANSFORMS: GlobalTransforms = {
  contrast: 0,
  hue: 0,
  brightness: 0,
};

/** Convert hex (#rrggbb) to HSL [h: 0-360, s: 0-100, l: 0-100] */
export const hexToHsl: (hex: string) => [number, number, number] = hexToHslImpl;

/** Convert HSL [h: 0-360, s: 0-100, l: 0-100] to hex (#rrggbb) */
export const hslToHex: (h: number, s: number, l: number) => string = hslToHexImpl;

/** True when the transforms leave every colour unchanged. */
const isIdentityTransforms: (t: GlobalTransforms) => boolean = isIdentityTransformsImpl;

/**
 * Apply global transforms to a hex color with saturation-aware dampening.
 * Saturated category colors (reds, greens, etc.) are affected less than neutrals.
 * dampFactor = 1 - (saturation * 0.7): 0% sat -> 100% effect, 100% sat -> 30% effect
 */
export const applyTransforms: (hex: string, transforms: GlobalTransforms) => string =
  applyTransformsImpl;

/**
 * Apply transforms to an rgba string like "rgba(147, 197, 253, 0.25)".
 * Transforms the RGB component, preserves alpha.
 */
export function applyTransformsRgba(rgba: string, transforms: GlobalTransforms): string {
  if (isIdentityTransforms(transforms)) return rgba;

  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
  if (!match) return rgba;

  const r = parseInt(match[1]);
  const g = parseInt(match[2]);
  const b = parseInt(match[3]);
  const a = match[4] ?? "1";

  const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  const transformed = applyTransforms(hex, transforms);

  const nr = parseInt(transformed.slice(1, 3), 16);
  const ng = parseInt(transformed.slice(3, 5), 16);
  const nb = parseInt(transformed.slice(5, 7), 16);

  return `rgba(${nr}, ${ng}, ${nb}, ${a})`;
}

/** Read a CSS variable from the computed document root style */
export function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
