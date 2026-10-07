/**
 * The "New Virgil window" chord, stated ONCE (task 998). `EditorLayout`'s
 * window `keydown` handler matches it (`matchesPortableChord`) and the tab
 * strip's "+" menu renders it (`<Kbd>`), so the hint and the binding are the
 * same string. ⌘⇧N rather than ⌘N (the browser's own new window) and clear of
 * ⌘P / ⌘⇧P (Print, paragraph nav).
 */
export const NEW_WINDOW_SHORTCUT = "Mod+Shift+N";
