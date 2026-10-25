import { ICON_STROKE, ICON_STROKE_SMALL } from "./icon-stroke";

/**
 * The ONE visual cue for "this is the chosen option" in a `useRadioGroup`
 * pick-one row (task 2026-10-25-1279). STYLE_GUIDE → Inputs: "Selection must
 * never be signalled by colour (or a border) alone." The hook gives assistive
 * tech `aria-checked`; this leaf gives a SIGHTED reader the same fact by
 * SHAPE, so the choice survives grayscale, colour-blindness and a washed-out
 * display. Before it the doc-type cards differed only by border + a faint
 * accent tint.
 *
 * Two forms, one contract:
 *  - `ring` (default) — a radio ring on the `ICON_STROKE` rung, empty when
 *    unchecked and holding a filled dot when checked. For option CARDS, where
 *    every option shows the ring so the chosen one reads by contrast.
 *  - `check` — a check glyph laid over a colour swatch, drawn ONLY when
 *    checked (an empty ring over each colour would compete with the fill that
 *    IS the control). Two strokes — a `--foreground` halo under a
 *    `--background` mark — so it reads on any swatch hue in either theme.
 *
 * `data-radio-mark` names the state for tests (jsdom resolves no colours, so
 * the pin is structural): `radio-mark-census.test.ts` fails a `useRadioGroup`
 * consumer that does not render this leaf.
 */
export function RadioMark({
  checked,
  variant = "ring",
  size = 14,
  className,
}: {
  checked: boolean;
  variant?: "ring" | "check";
  size?: number;
  className?: string;
}) {
  if (variant === "check") {
    if (!checked) return null;
    return (
      <svg
        data-radio-mark="checked"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        <polyline
          points="5 12.5 10 17.5 19 7"
          stroke="var(--foreground)"
          strokeOpacity={0.55}
          strokeWidth={ICON_STROKE_SMALL * 2}
        />
        <polyline
          points="5 12.5 10 17.5 19 7"
          stroke="var(--background)"
          strokeWidth={ICON_STROKE_SMALL}
        />
      </svg>
    );
  }
  return (
    <svg
      data-radio-mark={checked ? "checked" : "unchecked"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="9" />
      {checked && <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />}
    </svg>
  );
}
