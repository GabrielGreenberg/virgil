"use client";

// The checkbox — glyph AND control — in its OWN leaf module (task 903).
//
// `CheckSquare` lived inside `panel-primitives.tsx`, whose import graph reaches
// the storage backend (the shape task 827 moved `Button` out of). So the two
// dialogs that wanted a checkbox — Fonts…' "Pin to body family" and Print's
// option rows — did not take it: each hand-drew a box filled with `--accent`
// beside its own tick path, with no checkbox semantics on Fonts' (and the
// accent fill breaks the "a toggle's ON state never wears --accent" rule the
// two shipped variants keep). This module imports only React and the
// panel-theme registry, so any layer can take it; `panel-primitives`
// re-exports the glyph for the card stack that already imports it from there.
//
// What it owns:
//  · `CheckSquare` — the glyph, authored ONCE (task 2026-08-02-287).
//  · `checkboxSemantics(checked)` — the checkbox role + `aria-checked`
//    pair, for a toggle that must own its own `<button>` (the Todo
//    done-toggle, the per-card AI-request toggle: stop-propagation, hints).
//  · `Checkbox` — glyph + visible label + semantics as one control, for every
//    plain labelled checkbox. Its accessible name is its visible label.
//
// The census (`checkbox-glyph-ssot.test.tsx`) holds the line: the checkbox ROLE
// is spelled in this file only, and a file that declares checkbox semantics
// must draw `CheckSquare` — so a box re-drawn from a `<span>` cannot claim to
// be a checkbox, and one that claims nothing is caught by the retired-shape
// needles.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { accentInk, getPanelColor } from "@/lib/panel-theme";
import { withFocusIndicator } from "./focus-indicator";

/* ── CheckSquare — THE checkbox glyph (task 2026-08-02-287) ─────────
 *
 * One rounded square + one tick path, authored ONCE. Both of the app's
 * checkboxes — the Todo done-toggle and the per-card AI-request toggle — drew
 * the identical `<rect x=1 y=1 w=14 h=14 rx=3>` in a 16-unit viewBox and the
 * identical `M4.5 8l2.5 2.5 4.5-5` tick, in two files, from five raw hex
 * literals between them (`#b5b0aa` alone was spelled three times — a verbatim
 * re-spelling of `--muted-light`, which STYLE_GUIDE locks to `--scrollbar-hover`
 * and which would therefore have retoned the scrollbar and left both checkbox
 * borders behind).
 *
 * The component takes a VARIANT, never a colour. A `checkColor`-style prop
 * would keep the door open for a call site to pass a sixth literal, which is
 * the thing this exists to close; the table below is the whole palette, and
 * every value in it is a token read (`var(--…)`) or a value derived from the
 * panel-theme registry — never a literal.
 *
 * The two variants differ in FOUR ways, and each difference is stated here
 * rather than hidden in two files: rendered size, tick stroke weight, whether
 * the box fills when checked, and the tick ink. Their two inks come from two
 * different SSOTs, correctly:
 *   · `done` is neutral UI chrome, so it reads globals.css tokens;
 *   · `ai-request` is a KIND IDENTITY, and identity colours live on the
 *     panel-theme registry — whose own header says the `aiRequest` / `error`
 *     system accents were folded into `DEFAULT_PANEL_COLORS` so they derive
 *     from one source "instead of string-literal hexes". `#0369a1` was exactly
 *     such a literal, and `aiRequest` had ZERO readers until this call: the
 *     tick is now `accentInk` of that accent, the same ink every themed badge
 *     and card title takes.
 *
 * Sizes are numbers rather than a `size` prop for the same reason the colours
 * are not props: nothing needs a third size today, and an option nothing reads
 * is the dead-field class. Add one with its first real consumer. */
export type CheckSquareVariant = "done" | "ai-request";

const CHECK_SQUARE: Record<
  CheckSquareVariant,
  {
    /** Rendered px. The viewBox is always 16, so this also sets the scale. */
    size: number;
    /** Tick stroke-width in viewBox units. */
    tickWidth: number;
    /** Box fill once checked. `"none"` keeps the box hollow. */
    checkedFill: string;
    /** Tick ink. */
    tick: string;
  }
> = {
  done: {
    size: 14,
    tickWidth: 2.4,
    checkedFill: "var(--checkbox-fill)",
    tick: "var(--checkbox-mark)",
  },
  "ai-request": {
    size: 12,
    tickWidth: 2.2,
    checkedFill: "none",
    // `aiRequest` is a SYSTEM theme key (`SYSTEM_THEME_KEYS`): the colour picker
    // skips it, `setPanelColor` refuses it, and `readOverridesFromStorage` drops
    // it from a peer's blob — so the accent is a constant and its ink can be
    // derived once at module scope rather than through a subscription per
    // mounted checkbox. If that key ever becomes user-overridable, this must
    // move to `usePanelColor("aiRequest")` inside the component.
    tick: accentInk(getPanelColor("aiRequest")),
  },
};

export function CheckSquare({
  variant,
  checked,
}: {
  variant: CheckSquareVariant;
  checked: boolean;
}) {
  const { size, tickWidth, checkedFill, tick } = CHECK_SQUARE[variant];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="3"
        fill={checked ? checkedFill : "none"}
        stroke="var(--muted-light)"
        strokeWidth="1.5"
      />
      {checked && (
        <path
          d="M4.5 8l2.5 2.5 4.5-5"
          stroke={tick}
          strokeWidth={tickWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      )}
    </svg>
  );
}

/** The ARIA pair every Virgil checkbox carries. A function rather than a
 *  spread constant so the state cannot be forgotten. */
export function checkboxSemantics(checked: boolean): {
  role: "checkbox";
  "aria-checked": boolean;
} {
  return { role: "checkbox", "aria-checked": checked };
}

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "children" | "role"> {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** The visible label — also the accessible name. */
  children: ReactNode;
  variant?: CheckSquareVariant;
}

/** A labelled checkbox: the shared glyph, its label, and checkbox semantics.
 *  Typography and spacing of the row are the caller's (`className`); the
 *  glyph, the role and the state are not. */
export function Checkbox({
  checked,
  onChange,
  children,
  variant = "done",
  className,
  disabled,
  onClick,
  ...rest
}: CheckboxProps) {
  return (
    <button
      type="button"
      {...rest}
      {...checkboxSemantics(checked)}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented && !disabled) onChange(!checked);
      }}
      className={withFocusIndicator(
        `flex items-center gap-2 text-left disabled:opacity-40 disabled:cursor-not-allowed${className ? ` ${className}` : ""}`,
      )}
    >
      <CheckSquare variant={variant} checked={checked} />
      <span>{children}</span>
    </button>
  );
}
