/**
 * borrowed-body-style — the ONE mapping from a panel's resolved body style to
 * the inline properties a borrowed card body carries (task 823).
 *
 * Every borrowed body surface — the live `BorrowedMainText` editor DOM and the
 * static `StaticBorrowedText` / summary tiers — writes the same four
 * properties. `--editor-font-size` is the load-bearing one: the global
 * `.tiptap p` rule resolves its size from that var, which would otherwise
 * mask an inherited inline `font-size` (the body renders at the 1.05rem
 * fallback instead of the declared panel size). It used to be hand-copied in
 * both components; now a surface that drifts has to stop calling this.
 */
import type { CSSProperties } from "react";

/** The CSS properties (kebab/custom-property spelling) a body carries, each
 *  either a value or null (= remove). Always all four keys. */
export type BorrowedBodyStyleProps = Record<
  "font-family" | "font-size" | "--editor-font-size" | "color",
  string | null
>;

export function borrowedBodyStyleProps(
  bodyStyle: CSSProperties | undefined,
): BorrowedBodyStyleProps {
  const fontSize = bodyStyle?.fontSize ? String(bodyStyle.fontSize) : null;
  return {
    "font-family": bodyStyle?.fontFamily ? String(bodyStyle.fontFamily) : null,
    "font-size": fontSize,
    "--editor-font-size": fontSize,
    color: bodyStyle?.color ? String(bodyStyle.color) : null,
  };
}

/** The same properties as a React inline style object (static surfaces). */
export function borrowedBodyInlineStyle(
  bodyStyle: CSSProperties | undefined,
): CSSProperties {
  const props = borrowedBodyStyleProps(bodyStyle);
  const s: CSSProperties & Record<string, string> = {};
  if (props["font-family"]) s.fontFamily = props["font-family"];
  if (props["font-size"]) s.fontSize = props["font-size"];
  if (props["--editor-font-size"]) s["--editor-font-size"] = props["--editor-font-size"];
  if (props.color) s.color = props.color;
  return s;
}

/** Write the same properties onto a live element (the editor DOM), removing
 *  the ones the style no longer sets. */
export function applyBorrowedBodyStyle(
  el: HTMLElement,
  bodyStyle: CSSProperties | undefined,
): void {
  for (const [prop, value] of Object.entries(borrowedBodyStyleProps(bodyStyle))) {
    if (value) el.style.setProperty(prop, value);
    else el.style.removeProperty(prop);
  }
}
