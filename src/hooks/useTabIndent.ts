import { useCallback } from "react";

type AnyKeyTarget = HTMLTextAreaElement | HTMLElement;

/**
 * Tab inserts a literal '\t' at the cursor; Shift-Tab is a no-op (does not
 * escape focus, does not outdent — symmetric with the TipTap path). Esc
 * blurs the field as the documented escape hatch for keyboard-only users.
 *
 * Works on <textarea> and on contentEditable hosts.
 *
 *   const onKeyDown = useTabIndent(existingOnKeyDown?);
 *   <textarea onKeyDown={onKeyDown} ... />
 */
export function useTabIndent<T extends AnyKeyTarget>(
  next?: (e: React.KeyboardEvent<T>) => void,
) {
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
        (e.currentTarget as HTMLElement).blur();
        // Fall through so callers that already handle Esc still run.
      }
      next?.(e);
    },
    [next],
  );
}
