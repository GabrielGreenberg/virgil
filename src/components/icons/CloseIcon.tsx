import { ICON_STROKE_SMALL } from "./icon-stroke";

/**
 * The close "×" — ONE glyph for every window/panel close button (task 1304).
 *
 * Before it, the panel header (`PanelClose`), the Preferences window and the
 * Fonts… window each hand-drew their own "×": three viewBoxes (24 / 14 / 12),
 * three stroke weights, round caps on two of them. A close "×" is a bare mark,
 * so it sits on the SMALL-GLYPH stroke rung (`ICON_STROKE_SMALL`, STYLE_GUIDE →
 * "Icons"); the caller picks only the edge size for its button tier.
 *
 * Presentational leaf: currentColor, `aria-hidden` (the BUTTON carries the
 * name, via `iconHint`).
 */
export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE_SMALL}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export default CloseIcon;
