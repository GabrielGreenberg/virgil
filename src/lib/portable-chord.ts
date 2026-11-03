import { isDeliberateKeyPress, isImeComposing } from "@/lib/key-intent";

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

/**
 * The field-commit chord — ⌘/Ctrl+Enter commits a multi-line field whose plain
 * Enter is a newline (the AI window's composer, the figure-environment popover,
 * the bibliography's entry-request field). One constant so each field's `<Kbd>`
 * / `iconHint` and its `onKeyDown` read the same string (task 1376). Bind it
 * through `chordPress`, which keeps the IME's candidate-commit Enter out and
 * answers a held ⌘Enter once (task 1450).
 */
export const FIELD_COMMIT_SHORTCUT = "Mod+Enter";

/**
 * How a keydown relates to an advertised WINDOW-LEVEL chord (task 1376):
 *
 *   - `null`    — not this chord (or an IME owns the key): pass it through.
 *   - `"press"` — a fresh, deliberate press: ACT.
 *   - `"held"`  — the auto-repeat tail of a held chord: the caller swallows it
 *                 (`preventDefault`) and changes nothing, so a held ⌘/ cannot
 *                 flicker a toggle and a held ⌘S cannot fire a save per repeat
 *                 (the `useCloseFloatChord` shape, task 1095).
 *
 * The match is `matchesPortableChord` — the same string the hint renders — and
 * the deliberateness is `key-intent`'s, so neither is re-spelled per binding.
 *
 * **Every binding of a chord goes through here** (task 1450) — a window /
 * document `keydown` AND a field's own `onKeyDown` (it takes a React event: the
 * IME probe reads `nativeEvent`). The bare matcher above answers only "which
 * keys", so a binding built on it fired once per auto-repeat (a held ⌘⇧N opened
 * a window per repeat) and inside an IME composition. Pinned by
 * `portable-chord-census.test.ts`: `matchesPortableChord(` is called only here.
 */
export function chordPress(
  e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "keyCode"> & {
    isComposing?: boolean;
    nativeEvent?: { isComposing?: boolean };
  },
  keys: string,
): "press" | "held" | null {
  if (!matchesPortableChord(e, keys) || isImeComposing(e)) return null;
  return isDeliberateKeyPress(e) ? "press" : "held";
}
