"use client";

// The canonical Virgil action button — its OWN leaf module (task 827).
//
// It lived inside `panel-primitives.tsx`, whose import graph reaches the
// storage backend: so a component that only wanted a button (the Library's
// folder gates, the collab pen action, the bib picker's raw-commit) dragged
// `@/lib/storage` into every test that rendered it, and each such test had to
// mock storage for a BUTTON. This module imports nothing but React and the
// focus-indicator door. `panel-primitives` re-exports it, so existing callers
// are unchanged; a new caller imports from here.

import { type ButtonHTMLAttributes, forwardRef } from "react";
import { withFocusIndicator } from "./focus-indicator";

/* ── Button primitive ──────────────────────────────────────────────
   Five variants, three sizes, codified in src/STYLE_GUIDE.md ("Buttons"),
   which also names the surfaces that stay hand-rolled BY DESIGN (stateful
   toggles). Don't hand-roll filled buttons; pick a
   variant. There is no "blue button" in Virgil — `warm` replaces the
   bg-blue-100 / bg-emerald-600 patterns that used to scatter across
   modal footers and suggestion flows. */

export type ButtonVariant = "primary" | "secondary" | "warm" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

// The focus indicator is `.focus-ring`, appended in the render below — NOT a
// `focus-visible:ring-*` utility. `globals.css` is UNLAYERED and Tailwind's
// `ring-*` is implemented as `box-shadow`, so `.focus-ring:focus-visible` wins
// that property whatever the class order: the three utilities this used to end
// with (`focus-visible:outline-none focus-visible:ring-2
// focus-visible:ring-edge-strong`) painted NOTHING. They were harmless only
// because the two spellings happened to agree — which is exactly why nobody
// noticed, and exactly why the next hand-rolled button copied the dead one off
// the exemplar. Law + census: STYLE_GUIDE "Interaction" → Focus (task 503).
//
// A DISABLED Button keeps its pointer events (task 827). It used to spell
// `disabled:pointer-events-none`, which also killed the cursor and the
// `title` / `data-hint` that says WHY it is disabled — the one moment a hint
// is most needed ("Coming soon", "a built-in preset name"). The press nudge
// and every variant's hover are gated on `enabled:` instead, so a disabled
// Button paints no hover and does not move; a native disabled `<button>`
// dispatches no click, so nothing else changes.
const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed enabled:active:translate-y-[0.5px]";

// hover-on-light-exempt: BUTTON_BASE above owns `transition-all duration-150`,
// which is BROADER than `.hover-on-light`'s property list (it also carries the
// `active:translate-y` nudge and `hover:brightness-95`). Because that utility
// is UNLAYERED it would REPLACE `transition-all`, so `secondary` and `ghost`
// keep a hand-rolled `hover:bg-*` — already on the SSOT's own token
// (`--surface-muted-strong`), differing only in taking the component's 150ms
// rather than the utility's 120ms. This is the one shape the census allows
// (task 502); see the law in globals.css → "Hover utilities".
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-btn-primary text-white enabled:hover:brightness-95",
  secondary:
    "bg-surface text-ink-body border border-edge-hover enabled:hover:bg-surface-muted-strong enabled:hover:border-edge-strong",
  warm:
    "bg-accent-light text-accent border border-[color-mix(in_oklab,var(--accent)_40%,transparent)] enabled:hover:brightness-95",
  danger:
    "bg-danger-soft text-danger border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] enabled:hover:bg-[color-mix(in_oklab,var(--danger)_10%,var(--danger-soft))]",
  ghost:
    "bg-transparent text-ink-subtle enabled:hover:bg-surface-muted-strong enabled:hover:text-ink-body",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-6 px-2.5 text-xs",
  md: "h-8 px-3 text-[13px]",
  lg: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Canonical Virgil button. Pick a variant. Don't mix Tailwind utilities
 *  to imitate one. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      className={withFocusIndicator(
        `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}${className ? ` ${className}` : ""}`,
      )}
    />
  );
});
