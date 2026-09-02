"use client";

/**
 * The swatch + hex-text pair — Virgil's ONE editable color field (task 532).
 *
 * Two sites rendered this control and only one of them worked. `ColorPref`
 * (the preference row) had the whole contract: a draft, an auto-`#`, a
 * validate-on-commit with an `invalid` flash, `Enter` → blur, and a reconcile
 * when the value moved underneath. `SmartPreferences`' panel-typography grid
 * hand-rolled a second copy that had NONE of it — `value={typo.color}` with an
 * `onChange` that wrote the store only when the typed string was ALREADY a
 * complete `#rrggbb`, which under React's controlled-input contract means the
 * box could not be typed into or backspaced at all (see `field-draft.ts`).
 *
 * So the control is a primitive and both sites render it. The DRAFT rule lives
 * one layer down in `useFieldDraft`; what this component adds is the part that
 * is genuinely about COLOR: the normalization (`c45a5a` → `#c45a5a`, lowercased
 * — the same spelling `panel-typography.ts` stores), the validation, and the
 * 800 ms `invalid` flash that ends by reverting the box to the stored value.
 *
 * **The commit edge is blur + Enter, not per keystroke.** A color is a
 * preference: committing per character writes the store (and fires a
 * cross-window sync) for every intermediate string on the way to a hex.
 *
 * **The box owns the CONTROL; the row owns its LABEL and its reset.** `ColorPref`
 * still renders `PrefLabel` and the "reset" link around this, and the grid still
 * renders its own reset column — both write the source, which reconciles the box
 * for free. Sizing stays with the call site for the reason `field-primitives.tsx`
 * gives about its own chrome: the preference row and the dense grid cell
 * legitimately differ there and never drifted.
 */

import { useEffect, useRef, useState } from "react";
import { Input } from "./field-primitives";
import { useFieldDraft } from "./field-draft";
import { NEVER_SPELLCHECK_PROPS } from "@/lib/spellcheck-policy";

/** How long a rejected value stays visible before the box reverts to the
 *  stored color. Long enough to read, short enough not to strand the field. */
const INVALID_FLASH_MS = 800;

/** The ONE hex-color grammar in the app's UI layer. A second speller is how the
 *  two copies of this control came to disagree about whether `c45a5a` is a
 *  color. */
const HEX_RE = /^#[0-9a-f]{6}$/;

/** Normalize a typed hex: trim, auto-prefix `#`, lowercase. Exported for the
 *  census and the contract suite, never so a call site can re-implement the
 *  commit. */
export function normalizeHex(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t.startsWith("#") ? t : `#${t}`;
}

export function isHex(value: string): boolean {
  return HEX_RE.test(value);
}

export interface HexColorFieldProps {
  /** The stored color — owned by a preference store, not by this component. */
  value: string;
  /** Commit a valid, normalized `#rrggbb`. */
  onChange: (hex: string) => void;
  /** Wrapper box. */
  className?: string;
  /** The native swatch's box. */
  swatchClassName?: string;
  /** The text field's box (font size, width, padding) — the chrome is the
   *  primitive's. */
  inputClassName?: string;
}

export function HexColorField({
  value,
  onChange,
  className = "flex items-center gap-2",
  swatchClassName = "w-6 h-6 rounded border border-edge-subtle cursor-pointer p-0 bg-transparent",
  inputClassName = "text-[11px] font-mono w-[70px] px-1 py-0.5",
}: HexColorFieldProps) {
  const [text, setText] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draft = useFieldDraft<string>({
    source: value,
    readDraft: () => text,
    writeDraft: setText,
  });

  // A pending flash must not outlive the field: its callback reverts the box,
  // which is a state write on an unmounted component.
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  /** Commit the typed text — the blur/Enter edge. A malformed value is NOT
   *  committed; it flashes and then reverts, so the box can never be left
   *  holding a string the store does not have. */
  const commitText = () => {
    const hex = normalizeHex(text);
    if (!isHex(hex)) {
      setInvalid(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        // `revert` — not `setText(value)` — so the field is marked CLEAN, and a
        // change that landed during the flash reconciles on the next render
        // instead of being held off by a draft nobody is editing.
        draft.revert();
        setInvalid(false);
      }, INVALID_FLASH_MS);
      return;
    }
    setInvalid(false);
    draft.commit(hex, onChange);
  };

  return (
    <div className={className}>
      <input
        type="color"
        value={value}
        onChange={(e) => draft.commit(normalizeHex(e.target.value), onChange)}
        className={swatchClassName}
      />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        {...NEVER_SPELLCHECK_PROPS}
        tone="transparent"
        density="dense"
        ink="subtle"
        invalid={invalid}
        className={inputClassName}
      />
    </div>
  );
}
