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
 * Every close or remove "×" draws this leaf — a panel/window close, a tab
 * close, a per-row remove (`icon-leaf-census.test.ts` fails a hand copy).
 *
 * Presentational leaf: currentColor, `aria-hidden` (the BUTTON carries the
 * name, via `iconHint`).
 */
export function CloseIcon({ size = 14, className }: { size?: number; className?: string }) {
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
      className={className}
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export default CloseIcon;
