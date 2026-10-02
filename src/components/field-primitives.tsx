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
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
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

// The focus substitute is `:focus-visible`, not `:focus` (task 554). The border
// THICKEN is this family's focus indicator — STYLE_GUIDE "Interaction" → Focus,
// "Inputs use a thicker border instead of a ring" — so it is governed by the
// same law every other indicator in the app is, and every other one in the app
// is keyboard-scoped. Behaviour-identical for a text field, because a browser
// answers `:focus-visible` for a focused text input however focus arrived
// (clicking into a box IS a request to type in it); what it changes is the
// CONSISTENCY, so a future member of this chrome cannot inherit a mouse-focus
// indicator by accident. `outline-none` stays UNSCOPED on purpose: it strips
// the UA ring the border replaces, and a `:focus`-only strip would leave that
// ring painting on a mouse click beside a border that had not thickened.
const FIELD_BASE =
  "border placeholder:text-ink-muted outline-none focus-visible:border-edge-strong disabled:opacity-40 disabled:cursor-not-allowed";

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
    invalid ? "text-error" : FIELD_INK[ink],
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
    /* focus-indicator-posture: BORDER, not ring — `fieldChrome` carries
       `focus-visible:border-edge-strong`, which THICKENS the resting edge, and
       that is this family's indicator (STYLE_GUIDE "Interaction" → Focus:
       "Inputs use a thicker border instead of a ring"). It deliberately does not
       enter the ring door: a ring around a bordered box paints two edges. */
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
      /* focus-indicator-posture: BORDER, not ring — `fieldChrome` carries
         `focus-visible:border-edge-strong`, which THICKENS the resting edge, and
         that is this family's indicator (STYLE_GUIDE "Interaction" → Focus:
         "Inputs use a thicker border instead of a ring"). It deliberately does not
         enter the ring door: a ring around a bordered box paints two edges. */
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
    /* focus-indicator-posture: BORDER, not ring — `fieldChrome` carries
       `focus-visible:border-edge-strong`, which THICKENS the resting edge, and
       that is this family's indicator (STYLE_GUIDE "Interaction" → Focus:
       "Inputs use a thicker border instead of a ring"). It deliberately does not
       enter the ring door: a ring around a bordered box paints two edges. */
    <select
      ref={ref}
      {...rest}
      className={`${fieldChrome({ tone, ink, density, invalid })}${className ? ` ${className}` : ""}`}
    />
  );
});

// ── Field: a label that is ASSOCIATED with its control (task 869) ──────────
//
// Before this, every dialog hand-wrote its field label as a SIBLING `<label>`
// with no `htmlFor` — five sites, four class strings — so clicking "Name"
// focused nothing and a screen reader announced an unlabeled textbox. The
// chrome had a primitive; the label beside it did not, so it drifted the way
// the chrome had before task 190. `Field` owns both halves: the label's
// typography (the REGISTER) and the label→control association (a `useId`),
// handed to the control through a render function so the association cannot
// be forgotten — a call site that ignores the id is visibly ignoring it.
//
//     <Field label="Name">
//       {({ id }) => <Input id={id} value={…} className="w-full px-3 py-1.5 text-sm" />}
//     </Field>
//
// A control that is not a labelable HTML element — a CodeMirror pane, a
// composite stepper, a font picker — takes `control="group"`: the label is
// rendered as plain text with an id, and the call site names its widget with
// `aria-labelledby={labelId}` (on a `role="group"` wrapper, or the widget's own
// content element). A `<label htmlFor>` pointed at a `<div>` labels nothing.

/** The label's typography. `section` is the dialog section-label register
 *  (STYLE_GUIDE "Inputs" → Field labels): small caps-tracked, above the
 *  control. `row` is the quieter sentence-case register for a label sitting
 *  to the LEFT of its control in a dense row. */
export type FieldLabelRegister = "section" | "row";

const FIELD_LABEL_REGISTER: Record<FieldLabelRegister, string> = {
  section: "text-[11px] font-medium text-ink-subtle uppercase tracking-wide",
  row: "text-[11px] text-ink-subtle",
};

/** `stack` puts the label above the control; `inline` beside it. */
export type FieldLayout = "stack" | "inline";

export interface FieldIds {
  /** Put this on the control (`id={…}`) — the label's `htmlFor` names it. */
  id: string;
  /** The label element's own id, for `aria-labelledby` on a widget that is
   *  not a labelable element (`control="group"`). */
  labelId: string;
  /** The description's id when `description` was given — put it on the
   *  control as `aria-describedby`. Undefined otherwise, so spreading it
   *  unconditionally is safe. */
  descriptionId: string | undefined;
}

export interface FieldProps {
  label: ReactNode;
  /** A short gloss under the label (a preference row's "what this moves").
   *  Rendered OUTSIDE the label so it does not lengthen the accessible name;
   *  the control takes it as its accessible DESCRIPTION via `descriptionId`. */
  description?: ReactNode;
  register?: FieldLabelRegister;
  /** Defaults by register: `section` stacks, `row` sits inline. */
  layout?: FieldLayout;
  /** `native` (default) — the control is an input/select/textarea/button and
   *  the label is a real `<label htmlFor>`. `group` — the control is a
   *  composite widget; the label is text the widget names via
   *  `aria-labelledby`. */
  control?: "native" | "group";
  /** Appended to the wrapper (margins, width). */
  className?: string;
  /** Appended to the label (a fixed column width in a row form). Typography
   *  belongs to `register`, not here. */
  labelClassName?: string;
  /** Extra attributes for the label (e.g. a `data-hint`). */
  labelProps?: Omit<HTMLAttributes<HTMLElement>, "id" | "className"> & {
    [dataAttr: `data-${string}`]: string | undefined;
  };
  children: (ids: FieldIds) => ReactNode;
}

/** A labelled form field. The label is always associated with its control. */
export function Field({
  label,
  description,
  register = "section",
  layout = register === "section" ? "stack" : "inline",
  control = "native",
  className,
  labelClassName,
  labelProps,
  children,
}: FieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description != null ? `${id}-desc` : undefined;
  // With a description, the label and its gloss share one column, and the
  // column (not the label) takes the placement + `labelClassName` width.
  const columnClass = [
    layout === "stack" ? "block mb-1.5" : "shrink-0",
    labelClassName,
  ]
    .filter(Boolean)
    .join(" ");
  const labelClass = [
    FIELD_LABEL_REGISTER[register],
    descriptionId ? "block" : columnClass,
  ]
    .filter(Boolean)
    .join(" ");
  const labelEl =
    control === "native" ? (
      <label {...labelProps} id={labelId} htmlFor={id} className={labelClass}>
        {label}
      </label>
    ) : (
      <span {...labelProps} id={labelId} className={labelClass}>
        {label}
      </span>
    );
  const labelBlock = descriptionId ? (
    <div className={columnClass}>
      {labelEl}
      <span id={descriptionId} className="block text-[10px] text-ink-muted leading-tight">
        {description}
      </span>
    </div>
  ) : (
    labelEl
  );
  const wrapperClass = [
    layout === "inline" ? "flex items-center gap-2" : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={wrapperClass || undefined}>
      {labelBlock}
      {children({ id, labelId, descriptionId })}
    </div>
  );
}
