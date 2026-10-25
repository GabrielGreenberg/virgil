"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * THE single-choice group (task 1216) — the WAI-ARIA radio-group contract,
 * stated once for every in-dialog pick-one row of buttons.
 *
 * Task 869 hand-rolled it in `NewDocumentModal`'s doc-type picker; the
 * collaborator colour swatches (task 1216) were the second pick-one row and
 * had none of it — selection shown only by a border, nothing announced, the
 * arrow keys dead. Both now spread this hook's props, so the next pick-one
 * row gets the whole contract by construction:
 *
 * - the wrapper is `role="radiogroup"`; each option `role="radio"` with
 *   `aria-checked`;
 * - ONE tab stop for the group (roving tabindex): the checked option, or the
 *   first option when nothing is checked (a value outside the option list —
 *   e.g. a stored colour the palette no longer carries — must not leave the
 *   group unreachable by Tab);
 * - the arrow keys move the choice AND the focus together, wrapping at the
 *   ends, as native radios do.
 *
 * The hook owns the SEMANTICS; the VISUAL half of the contract is the
 * `RadioMark` leaf (`src/components/icons/RadioMark.tsx`, task 1279), which
 * every consumer renders inside each option so the chosen one reads by shape,
 * never by colour or a border alone. `radio-mark-census.test.ts` pins it.
 *
 * (Menus model pick-one with `MenuRadioGroup`, which rides the menu's own
 * list navigation; this is the non-menu counterpart.)
 */
export function useRadioGroup<V>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly V[];
  value: V;
  onChange: (next: V) => void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLElement | null)[]>([]);
  const checkedIndex = options.indexOf(value);
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0;
    if (step === 0 || disabled || options.length === 0) return;
    e.preventDefault();
    const current = checkedIndex >= 0 ? checkedIndex : step > 0 ? -1 : 0;
    const next = (current + step + options.length) % options.length;
    onChange(options[next]);
    refs.current[next]?.focus();
  };

  return {
    groupProps: { role: "radiogroup" as const, onKeyDown },
    radioProps: (index: number) => ({
      ref: (el: HTMLElement | null) => {
        refs.current[index] = el;
      },
      role: "radio" as const,
      "aria-checked": index === checkedIndex,
      tabIndex: index === tabStop ? 0 : -1,
      onClick: () => onChange(options[index]),
    }),
  };
}
