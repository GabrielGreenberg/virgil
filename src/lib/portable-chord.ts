/**
 * Does a keyboard event press a PORTABLE chord — the `+` spelling `<Kbd>` and
 * `data-hint-keys` render (`"Mod+Shift+N"`)?
 *
 * The other half of task 985's rule ("a hint reads the binding"), for a chord
 * bound by a window-level `keydown` rather than a ProseMirror keymap: the
 * handler MATCHES the same string the hint RENDERS, so the two cannot drift
 * (task 998 — "New Virgil window" advertised a hand-spelled `Mod+Shift+N`
 * beside a hand-written `metaKey && shiftKey && key === "n"` test).
 *
 * `Mod` is ⌘ or Ctrl (either, as the hand-written handlers accepted). Shift and
 * Alt must match EXACTLY — present iff named — so `Mod+N` does not also fire on
 * ⌘⇧N. The key compares case-insensitively (Shift upper-cases `e.key`).
 */
export function matchesPortableChord(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">,
  keys: string,
): boolean {
  const tokens = keys.split("+");
  const key = tokens.pop() ?? "";
  const mods = new Set(tokens.map((t) => t.toLowerCase()));
  const wantMod = mods.has("mod");
  if (wantMod && !(e.metaKey || e.ctrlKey)) return false;
  if (!wantMod && (mods.has("meta") !== e.metaKey || mods.has("ctrl") !== e.ctrlKey)) {
    return false;
  }
  if (mods.has("shift") !== e.shiftKey) return false;
  if (mods.has("alt") !== e.altKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}
