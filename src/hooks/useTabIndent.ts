import { useCallback } from "react";

type AnyKeyTarget = HTMLTextAreaElement | HTMLElement;

export interface TabIndentOptions<T extends AnyKeyTarget> {
  /**
   * The field's CANCEL — how Escape ends an edit on a field that COMMITS ON
   * BLUR. Supply it as `(el) => session.cancel(el, () => draft.revert())`
   * (`useFieldEditSession`), so the blur the cancel performs is seen by the
   * field's `onBlur` commit as an ending and skipped (task 1094).
   *
   * Omit it ONLY on a field whose blur commits nothing — a composer, a field
   * that already committed every keystroke. There the default bare blur is the
   * keyboard user's escape hatch and has nothing to save. On a blur-commit
   * field the default turns Escape into SAVE, which is exactly the "Escape
   * means cancel" violation: the census in `field-edit-session.test.tsx`
   * resolves this hook's call site and fails it.
   */
  cancel?: (el: T) => void;
}

/**
 * Tab inserts a literal '\t' at the cursor; Shift-Tab is a no-op (does not
 * escape focus, does not outdent — symmetric with the TipTap path). Esc ends
 * the field: through the field's own `cancel` when it has one, otherwise a
 * bare blur as the escape hatch for keyboard-only users.
 *
 * Works on <textarea> and on contentEditable hosts.
 *
 *   const onKeyDown = useTabIndent(existingOnKeyDown?, { cancel? });
 *   <textarea onKeyDown={onKeyDown} ... />
 */
export function useTabIndent<T extends AnyKeyTarget>(
  next?: (e: React.KeyboardEvent<T>) => void,
  options?: TabIndentOptions<T>,
) {
  const cancel = options?.cancel;
  return useCallback(
    (e: React.KeyboardEvent<T>) => {
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (!e.shiftKey) {
          const el = e.currentTarget;
          if (el instanceof HTMLTextAreaElement) {
            // Use the prototype value setter + native input event so
            // React's controlled-input tracking picks up the change.
            const start = el.selectionStart ?? 0;
            const end = el.selectionEnd ?? 0;
            const updated = el.value.slice(0, start) + "\t" + el.value.slice(end);
            const proto = Object.getPrototypeOf(el);
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) {
              setter.call(el, updated);
            } else {
              el.value = updated;
            }
            el.selectionStart = el.selectionEnd = start + 1;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } else {
            // contentEditable host
            document.execCommand("insertText", false, "\t");
          }
        }
        return;
      }
      if (e.key === "Escape") {
        const el = e.currentTarget;
        if (cancel) cancel(el);
        else (el as HTMLElement).blur();
        // Fall through so callers that already handle Esc still run.
      }
      next?.(e);
    },
    [next, cancel],
  );
}
