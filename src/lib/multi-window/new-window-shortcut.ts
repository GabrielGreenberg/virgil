import { chordPress } from "@/lib/portable-chord";

/**
 * The "New Virgil window" chord, stated ONCE (task 998). `EditorLayout`'s
 * window `keydown` handler (`newWindowChordHandler`) matches it and the tab
 * strip's "+" menu renders it (`<Kbd>`), so the hint and the binding are the
 * same string. ⌘⇧N rather than ⌘N (the browser's own new window) and clear of
 * ⌘P / ⌘⇧P (Print, paragraph nav).
 */
export const NEW_WINDOW_SHORTCUT = "Mod+Shift+N";

/**
 * The window `keydown` binding for `NEW_WINDOW_SHORTCUT` — through `chordPress`,
 * the one door for a window-level chord (task 1450). A held ⌘⇧N opens ONE
 * window: its auto-repeat keydowns are swallowed (so the browser does not take
 * the tail either) and open nothing; an IME composition's keydown is not ours.
 * Before 1450 this matched through the bare `matchesPortableChord`, so holding
 * the chord a beat too long called `window.open` once per repeat.
 */
export function newWindowChordHandler(open: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    const press = chordPress(e, NEW_WINDOW_SHORTCUT);
    if (!press) return;
    e.preventDefault();
    if (press === "held") return; // a held ⌘⇧N is one window, not one per repeat
    open();
  };
}
