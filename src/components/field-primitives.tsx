/**
 * Form-field primitives — the ONE spelling of Virgil's text-field chrome.
 *
 * `src/STYLE_GUIDE.md` ("Inputs") has stated the spec since the design system
 * landed — `bg-surface`, `border-edge-subtle`, focus THICKENS the border to
 * `edge-strong`, **no ring**, `text-ink-muted` placeholder — and roughly half
 * of ~50 field sites had drifted off it (task 190): ten spelled a saturated
 * `focus:border-[var(--accent)]`, three added a spec-forbidden `focus:ring-1`,
 * and the 4px `rounded` was near-universal where the scale says 6px. Nothing
 * structural stopped any of it, because the chrome lived in ~50 hand-written
 * class strings instead of a primitive. `Button` (panel-primitives.tsx) is the
 * shape this follows: pick a variant, don't imitate one with utilities.
 *
 * **Why a leaf module rather than a slot in `panel-primitives.tsx`.** Its
 * consumers are dialogs, preference rows and the system-dialog host — layers
 * that must not pull the card stack (RichTextField → TipTap → the extension
 * barrel) in behind a text box. This file imports React and nothing else, so
 * any layer can take it. Same rule `card-registry.tsx` records for itself.
 *
 * **What the primitive owns: the CHROME.** Background, border, radius, focus
 * behavior, placeholder color, disabled affordance. Deliberately NOT the box —
 * padding, width and font-size stay with the call site, because a modal field
 * and a citation-row micro-field legitimately differ there and never drifted;
 * every axis this owns is one the census found drifting. Pass the rest through
 * `className`; it is appended, so additive utilities compose.
 *
 *     <Input value={name} onChange={…} className="w-full px-3 py-1.5 text-sm" />
 *     <Select value={kind} onChange={…} className="text-xs px-2 py-1">…</Select>
 *     <Textarea rows={3} className="w-full px-2 py-1.5 text-xs" />
 *
 * A chromeless field — a bare search box inside a container that already paints
 * the border, an inline `border-b` rename editor, a CSS-class-driven NodeView
 * input — is a DIFFERENT control and stays hand-rolled. The census
 * (`src/lib/__tests__/field-chrome-guardrail.test.ts`) only asks about elements
 * that paint field chrome of their own.
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** Background + resting border. The tone is the primitive's decision, never
 *  the caller's: a `bg-transparent` appended next to a baked `bg-surface` is
 *  two utilities setting the same property, and which one wins is stylesheet
 *  order, not class order. */
export type FieldTone = "surface" | "muted" | "transparent";

/** Text color. Same rule as `tone`, and the same reason it is a PROP rather
 *  than something a call site appends — `text-ink-subtle` next to a baked
 *  `text-ink-body` is a coin flip, not an override. (`text-xs`/`text-[10px]`
 *  are font SIZE and compose fine; the box stays the caller's.) */
export type FieldInk = "body" | "subtle" | "strong";

/**
 * Which rung of the radius scale (`STYLE_GUIDE.md` "Radius scale") this field
 * sits on. Both are sanctioned there, for different contexts, which is why the
 * axis exists rather than one blessed radius:
 *  - `control` (6px, `--radius-md`) — "primary CONTROL radius: Button, inputs".
 *    Dialogs, modals, preference rows, panel search bars.
 *  - `dense` (4px, `--radius-sm`) — "small controls & inner rows: … form inputs
 *    inside a popover". Card micro-fields, popovers, inline card rows.
 */
export type FieldDensity = "control" | "dense";

const FIELD_BASE =
  "border placeholder:text-ink-muted outline-none focus:border-edge-strong disabled:opacity-40 disabled:cursor-not-allowed";

const FIELD_TONE: Record<FieldTone, { bg: string; border: string }> = {
  surface: { bg: "bg-surface", border: "border-edge-subtle" },
  muted: { bg: "bg-surface-muted-strong", border: "border-edge-subtle" },
  transparent: { bg: "bg-transparent", border: "border-edge-subtle" },
};

const FIELD_INK: Record<FieldInk, string> = {
  body: "text-ink-body",
  subtle: "text-ink-subtle",
  strong: "text-ink-strong",
};

const FIELD_DENSITY: Record<FieldDensity, string> = {
  control: "rounded-md",
  dense: "rounded-sm",
};

export interface FieldChromeOptions {
  tone?: FieldTone;
  ink?: FieldInk;
  density?: FieldDensity;
  /** Conflict state — border and text flip to `--danger`, the destructive
   *  token, so no call site hand-spells a red (a `border-red-300` appended
   *  beside the tone's border would be the same coin flip, in the one state
   *  where being wrong is loudest). It REPLACES rather than adds: exactly one
   *  border color and exactly one text color leave this function, always. */
  invalid?: boolean;
}

/**
 * The class string every Virgil form field wears. Exported for the two
 * surfaces that cannot mount a React component — a NodeView building DOM by
 * hand, or a test asserting the spec — never as a way to hand-roll a field
 * that could have used `<Input>`.
 */
export function fieldChrome({
  tone = "surface",
  ink = "body",
  density = "control",
  invalid = false,
}: FieldChromeOptions = {}): string {
  const { bg, border } = FIELD_TONE[tone];
  return [
    FIELD_BASE,
    bg,
    invalid ? "border-danger" : border,
    invalid ? "text-danger" : FIELD_INK[ink],
    FIELD_DENSITY[density],
  ].join(" ");
}

/**
 * The text-ish `type` values this chrome is FOR. A checkbox, radio, color
 * swatch, range slider or file button is a different control that happens to
 * share a tag name — bordered-field chrome is meaningless on it — so the union
 * makes `<Input type="color" />` a compile error rather than a review note.
 */
export type TextInputType =
  | "text"
  | "number"
  | "search"
  | "email"
  | "password"
  | "tel"
  | "url"
  | "date"
  | "time";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type">,
    FieldChromeOptions {
  type?: TextInputType;
}

/** Canonical Virgil text field. Don't mix Tailwind utilities to imitate one. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { tone, ink, density, invalid, type = "text", className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      {...rest}
      className={`${fieldChrome({ tone, ink, density, invalid })}${className ? ` ${className}` : ""}`}
    />
  );
});

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldChromeOptions {}

/** Multi-line twin of `Input` — same chrome, same rules. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ tone, ink, density, invalid, className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        {...rest}
        className={`${fieldChrome({ tone, ink, density, invalid })}${className ? ` ${className}` : ""}`}
      />
    );
  },
);

export interface SelectProps
  extends SelectHTMLAttributes<HTMLSelectElement>,
    FieldChromeOptions {}

/** Native select on the same chrome. The drop arrow stays the platform's. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { tone, ink, density, invalid, className, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      {...rest}
      className={`${fieldChrome({ tone, ink, density, invalid })}${className ? ` ${className}` : ""}`}
    />
  );
});
