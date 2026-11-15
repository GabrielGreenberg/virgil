/**
 * The ONE translation from a ProseMirror/TipTap keybinding to the portable
 * chord `<Kbd>` paints (task 985) — a pure leaf, so a lib module that NAMES a
 * shortcut (the empty-state creation sentence, task 2026-11-15-1632) reads the
 * same string the ⚡ hint does without importing a React component module.
 */

/** A ProseMirror/TipTap keybinding (`"Mod-Shift-s"`, the form the registry's
 *  `keybinding` and every `addKeyboardShortcuts()` use) in the portable `+`
 *  form `<Kbd>` / `data-hint-keys` take (`"Mod+Shift+s"`). The one translation
 *  between the two spellings, so a surface advertising a chord reads the SAME
 *  string the keymap binds (task 985). A trailing `-` names the minus key. */
export function keysFromKeybinding(binding: string): string {
  const parts = binding.split("-");
  if (binding.endsWith("-")) {
    parts.splice(parts.length - 2, 2, "-");
  }
  return parts.join("+");
}
