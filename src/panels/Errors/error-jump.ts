import type { LatexError } from "@/lib/latex-errors";

/**
 * How a mount reaches an error's location — task 125.
 *
 * The Errors card is mounted on three surfaces whose jump semantics are NOT
 * the same, so "is this error jumpable?" is a property of the MOUNT, not of
 * the card:
 *
 * - `"anchor"` — the visual mounts (the docked `ErrorsHost` and the omni
 *   mirror) route to `useDiagnostics.jumpToErrorVisual`, which scrolls the
 *   PARAGRAPH the error's source line resolved to and early-returns when
 *   there is none. Jumpable iff the error resolved to a paragraph anchor.
 * - `"line"` — the code-view sidebar routes to `EditorLayout`'s `codeJump`,
 *   which scrolls CodeMirror to `err.line` directly (no paragraph needed) —
 *   so a preamble / `\usepackage` error IS reachable there. Jumpable iff the
 *   error carries a real line.
 */
export type ErrorJumpMode = "anchor" | "line";

/**
 * A mount's jump capability: the semantics it implements AND the handler that
 * implements them, declared **together**.
 *
 * Bound at the HANDLER's definition site (`useDiagnostics` for the visual
 * jump, `EditorLayout` for the code jump) rather than at each mount, so a
 * mount forwards one value and has no mode to state — and therefore none to
 * state wrongly. The pre-125 shape passed the handler and let the card infer
 * a predicate (`hasAnchor || err.line > 0`), which is the union of the two
 * mounts' rules and correct for neither: it admits a line-only error in the
 * anchor mounts (a jump that early-returns) and a line-less error in the code
 * mount (`scrollToLine(0)` clamps to line 1 — it scrolls the code pane to the
 * top, moves the caret there, and steals focus).
 */
export interface ErrorJump {
  mode: ErrorJumpMode;
  jump: (err: LatexError) => void;
}

/**
 * The ONE jumpability formula. Gates every path that can issue a jump — the
 * card's body click, its jump affordance, and the panel's keyboard nav — so
 * the affordance and the action can never disagree.
 *
 * Refusing a jump never refuses SELECTION: an unjumpable error still selects,
 * and selection alone already paints the editor's error highlight (the
 * `selectedErrorId` effect in `useDiagnostics` recomputes the range), so
 * nothing observable is lost by declining to call a handler that could only
 * no-op or misfire.
 */
export function canJumpToError(
  err: LatexError,
  mode: ErrorJumpMode,
  hasAnchor: boolean,
): boolean {
  switch (mode) {
    case "anchor":
      return hasAnchor;
    case "line":
      return err.line > 0;
    default: {
      // Exhaustiveness: a third mode is a compile error until its rule is
      // stated here, rather than silently inheriting one of these two.
      const never: never = mode;
      void never;
      return false;
    }
  }
}
