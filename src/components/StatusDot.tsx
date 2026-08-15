/**
 * StatusDot — THE small colored status dot.
 *
 * The Virgil bar rendered this idiom three different ways before task 315: the
 * AI-requests overlay dot (a nested ternary over `var(--status-*)`), the
 * pdf-stale dot (one `var(--status-warn)`), and the collab pen dot (a
 * module-level map of RAW HEX literals with a raw `?? "#888"` fallback) — plus
 * `ExternalChangeBadge`'s private `PausedDot` helper, a byte-identical twin of
 * the collab markup with a neutral token. Four spellings of one 6-or-8px
 * circle, each free to drift in colour, size and a11y semantics. A fifth lives
 * one surface over and is deliberately NOT converted: `EditorLayout`'s "PDF is
 * out of date" chip paints the SAME signal from a different family
 * (`bg-yellow-500` vs `var(--status-warn)`), and those two have ALREADY drifted
 * — Tailwind v4's yellow-500 is oklch(79.5% 0.184 86.047) ≈ #f0b100, not the
 * v3 #eab308 the token carries. Converting it would repaint it, so which family
 * wins is a colour decision; see the census allowlist.
 *
 * STYLE_GUIDE ("Three layers") already names the fix: *a consumer that reaches
 * around a primitive to set a colour is a bug; the fix is to extend the
 * primitive.* So a caller states a TONE — what the dot MEANS — and this file
 * owns the only mapping from tone to token. There is no `color` prop by design:
 * a caller that could pass a colour is a caller that can pass a hex, which is
 * the whole class this retires (STYLE_GUIDE:44, "never a hex literal in *.tsx").
 *
 * The tone vocabulary is deliberately SEMANTIC, not chromatic — `"warn"`, never
 * `"yellow"`. A colour-named state union just moves the decision one layer up:
 * the producer names the paint and every consumer re-derives the meaning. (The
 * AI-dot producer used to return `"red" | "green" | "yellow"` for exactly this
 * reason; task 315 renamed it to `AiDotTone`, a subset of the union below, so
 * the mapping disappears rather than relocating.)
 *
 * Sizes: the two the app actually paints, named rather than free-form. `sm`
 * (6px) is the chrome default — an overlay badge or an inline marker beside a
 * label; `md` (8px) reads as a first-class state indicator inside a pill. There
 * is no default, because the repo had no rule distinguishing them and a guessed
 * default is a decision nobody made.
 *
 * Accessibility: a dot is decorative unless it is the ONLY carrier of a fact.
 * Passing `label` opts into `aria-label` + the app's `data-hint` tooltip (via
 * `iconHint`, so the two can't drift); omitting it renders `aria-hidden`, which
 * is right whenever an adjacent text label already says the same thing.
 */

import { iconHint } from "@/components/Hint";

/**
 * What a dot MEANS. Every member maps to a token in `TONE_TOKEN` below.
 *
 * Stated exactly, since a guard that overstates its reach is the failure mode
 * this whole fix is about: four hand-rolled status dots survive OUTSIDE this
 * vocabulary, each recorded with a reason in `status-dot-ssot.test.ts`'s
 * `PERMITTED_HAND_ROLLED_STATUS_DOTS` — none of their values matches a token, so
 * each needs a colour decision task 315 had no mandate to make. That list may
 * only shrink; a NEW hand-rolled dot fails CI.
 *
 * The traffic-light four (`danger`/`ok`/`warn`/`info`) are the `--status-*`
 * family. `muted` and `inactive` are the two greys the app already painted, and
 * they are NOT interchangeable: `muted` is ink (a state that is real but
 * unreachable — a stale collaborator), `inactive` is an edge weight (a
 * mechanism that is switched off — disk watching paused), and the two tokens
 * differ. The `collab-*` pair is the pen indicator's own softer palette; see
 * the `--status-collab-*` block in globals.css for why it isn't the alarm ramp.
 */
export type StatusTone =
  | "danger"
  | "ok"
  | "warn"
  | "info"
  | "muted"
  | "inactive"
  | "collab-active"
  | "collab-idle";

/** The ONE tone→token map. Exported so CI can assert every value is a `var()`
 *  read and no call site re-derives a colour. */
export const TONE_TOKEN: Readonly<Record<StatusTone, string>> = {
  danger: "var(--status-danger)",
  ok: "var(--status-ok)",
  warn: "var(--status-warn)",
  info: "var(--status-info)",
  muted: "var(--ink-muted)",
  inactive: "var(--edge-strong)",
  "collab-active": "var(--status-collab-active)",
  "collab-idle": "var(--status-collab-idle)",
};

export type StatusDotSize = "sm" | "md";

/** The two sizes the app paints. Tailwind needs the full class name at build
 *  time, so these are literals rather than an interpolated scale. */
const SIZE_CLASS: Readonly<Record<StatusDotSize, string>> = {
  sm: "w-1.5 h-1.5", // 6px — overlay badge / inline marker beside a label
  md: "w-2 h-2", //    8px — first-class state indicator inside a pill
};

export type StatusDotProps = {
  /** What the dot means. Resolved to a token here, never by the caller. */
  tone: StatusTone;
  /** 6px (`sm`) or 8px (`md`). Required — see the header. */
  size: StatusDotSize;
  /** Positioning / spacing only (`absolute top-0 right-0`, `ml-1`, `shrink-0`).
   *  Never colour: a `bg-*` here would reach around the tone. */
  className?: string;
  /** Present ⇒ the dot carries a fact no adjacent text states, so it announces
   *  itself and gains a hover hint. Absent ⇒ `aria-hidden`. */
  label?: string;
};

export function StatusDot({ tone, size, className, label }: StatusDotProps) {
  const a11y = label ? iconHint({ label }) : { "aria-hidden": true as const };
  return (
    <span
      {...a11y}
      className={`${SIZE_CLASS[size]} rounded-full${className ? ` ${className}` : ""}`}
      style={{ backgroundColor: TONE_TOKEN[tone] }}
    />
  );
}

export default StatusDot;
