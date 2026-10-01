/**
 * The error-TEXT role — the ONE spelling of "this string reports a failure"
 * (task 867).
 *
 * `src/STYLE_GUIDE.md` ("the destructive / alarm family") rules that error
 * text takes `--danger-strong`, never `--danger`: `#ef4444` measures 3.76:1 on
 * white and 3.25:1 on `--code-bg`, under AA for body text, where
 * `--danger-strong` measures 6.31:1 and 5.45:1. That rule lived as prose only,
 * so every author reached for `text-danger` — the name that SOUNDS right — and
 * a dozen error strings painted under AA. The rule now has a name to reach for:
 *
 *  - `text-error` — the Tailwind utility (`--color-error` in globals.css);
 *  - `ERROR_INK` (src/lib/error-ink.ts) — the same role for an inline
 *    `style={{ color }}` site
 *    (library chrome, severity tables, KaTeX's inline `errorColor`);
 *  - `<InlineError>` — the element: `role="alert"` + the ink, and with
 *    `boxed` the wash-and-edge box both dialogs and the example card drew by
 *    hand.
 *
 * `--danger` stays right for an ICON, a border, a destructive BUTTON or a menu
 * row — none carries the text-contrast obligation. The census in
 * `src/__tests__/destructive-red-tokens.test.ts` ("error text reads the error
 * role") pins the remaining `--danger` text spellings so the set only shrinks.
 *
 * A leaf module (React only), like `field-primitives.tsx`, so dialogs and
 * library chrome can take it without the card stack behind it.
 */

import type { HTMLAttributes, ReactNode } from "react";

/** The boxed reading: the destructive wash with a 30% edge, error ink on top. */
const BOXED =
  "rounded-md border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-danger-soft px-2.5 py-1.5";

type InlineErrorProps = Omit<HTMLAttributes<HTMLDivElement>, "role"> & {
  children: ReactNode;
  /** Paint the wash-and-edge box (dialog / card banners). Default: bare text. */
  boxed?: boolean;
};

/**
 * An error message: `role="alert"`, `text-error`, `text-xs` by default.
 * `className` is appended, so margins / padding / size compose.
 */
export function InlineError({ children, boxed = false, className, ...rest }: InlineErrorProps) {
  const cls = ["text-xs text-error", boxed ? BOXED : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div role="alert" className={cls} {...rest}>
      {children}
    </div>
  );
}
