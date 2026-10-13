import { useEffect, useRef } from "react";

/** Cmd-W, bare: no Ctrl / Alt / Shift. */
export function isCloseFloatChord(e: KeyboardEvent): boolean {
  return e.key === "w" && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

/**
 * Cmd-W closes the frontmost in-app floating window — ONE window per PRESS.
 *
 * - A held chord's auto-repeat keydowns (`e.repeat`) close nothing. Without
 *   this, holding Cmd-W a beat too long emptied the whole float stack, one
 *   window per repeat (task 1095).
 * - A repeat of a press that DID close a float is still swallowed
 *   (`preventDefault`), so once the stack runs empty mid-hold the host (PWA
 *   window / browser tab) does not receive the tail of the same press and
 *   close the window too. A press that closed nothing is left to the host,
 *   repeats included.
 * - A keydown some earlier handler already claimed (`defaultPrevented` — a
 *   modal that owns the chord) is not ours.
 *
 * `frontmost` is the target (the top of the MRU stack), or undefined when no
 * float is open; `close` closes it.
 */
export function useCloseFloatChord<T>(
  frontmost: T | undefined,
  close: (target: T) => void,
): void {
  const pressClosedRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCloseFloatChord(e)) return;
      if (e.repeat) {
        if (pressClosedRef.current) e.preventDefault();
        return;
      }
      pressClosedRef.current = false;
      if (e.defaultPrevented || frontmost === undefined) return;
      e.preventDefault();
      pressClosedRef.current = true;
      close(frontmost);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [frontmost, close]);
}
