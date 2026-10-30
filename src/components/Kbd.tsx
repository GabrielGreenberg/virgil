"use client";

/**
 * `<Kbd>` — the single, platform-aware way to render a keyboard shortcut as
 * a styled keycap chip. Replaces the scattered hardcoded `⌘…` strings and
 * the ad-hoc `.math-popover-hint kbd` markup.
 *
 * Pass a portable shortcut string with `+`-separated tokens, e.g.
 * `"Mod+/"`, `"Mod+Shift+N"`, `"Enter"`, `"Esc"`. `Mod` renders as ⌘ on
 * Mac and `Ctrl` elsewhere; the other modifiers/keys map to their platform
 * glyphs. Rendered as one compact chip (Mac: `⌘/`, other: `Ctrl+/`), which
 * matches both the macOS convention and the look in the hint bubble.
 */

import { useSyncExternalStore } from "react";
import { isMac } from "@/lib/platform";

/** Mac probe that's SSR- and hydration-safe: the server render and the first
 *  client paint both read Mac (so they match), then it settles to the real
 *  platform. Modeled as an external-store read (no setState-in-effect); the
 *  value never changes after settle, so `subscribe` is a no-op. */
const subscribeNoop = () => () => {};
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNoop, isMac, () => true);
}

const MAC_TOKENS: Record<string, string> = {
  mod: "⌘",
  cmd: "⌘",
  command: "⌘",
  meta: "⌘",
  "⌘": "⌘",
  ctrl: "⌃",
  control: "⌃",
  "⌃": "⌃",
  alt: "⌥",
  option: "⌥",
  opt: "⌥",
  "⌥": "⌥",
  shift: "⇧",
  "⇧": "⇧",
  enter: "⏎",
  return: "⏎",
  "⏎": "⏎",
  esc: "Esc",
  escape: "Esc",
  tab: "⇥",
  space: "Space",
  backspace: "⌫",
  delete: "⌦",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

const OTHER_TOKENS: Record<string, string> = {
  mod: "Ctrl",
  cmd: "Ctrl",
  command: "Ctrl",
  meta: "Ctrl",
  "⌘": "Ctrl",
  ctrl: "Ctrl",
  control: "Ctrl",
  "⌃": "Ctrl",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  "⌥": "Alt",
  shift: "Shift",
  "⇧": "Shift",
  enter: "Enter",
  return: "Enter",
  "⏎": "Enter",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  backspace: "Backspace",
  delete: "Delete",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
};

function formatToken(raw: string, mac: boolean): string {
  const key = raw.trim().toLowerCase();
  const table = mac ? MAC_TOKENS : OTHER_TOKENS;
  if (key in table) return table[key];
  // Single letters/digits → uppercase; everything else verbatim (e.g. "/").
  return raw.length === 1 ? raw.toUpperCase() : raw;
}

/** Format a portable shortcut string for the given platform. Exported for
 *  non-visual consumers (e.g. building an aria-label). */
export function formatShortcut(keys: string, mac: boolean): string {
  const tokens = keys
    .split("+")
    .map((t) => formatToken(t, mac))
    .filter(Boolean);
  // Mac stacks modifier glyphs with no separator (⌘⇧N); elsewhere use "+".
  return tokens.join(mac ? "" : "+");
}

const ARIA_TOKENS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "Meta", other: "Control" },
  cmd: { mac: "Meta", other: "Control" },
  command: { mac: "Meta", other: "Control" },
  meta: { mac: "Meta", other: "Control" },
  "⌘": { mac: "Meta", other: "Control" },
  ctrl: { mac: "Control", other: "Control" },
  control: { mac: "Control", other: "Control" },
  "⌃": { mac: "Control", other: "Control" },
  alt: { mac: "Alt", other: "Alt" },
  option: { mac: "Alt", other: "Alt" },
  opt: { mac: "Alt", other: "Alt" },
  "⌥": { mac: "Alt", other: "Alt" },
  shift: { mac: "Shift", other: "Shift" },
  "⇧": { mac: "Shift", other: "Shift" },
  enter: { mac: "Enter", other: "Enter" },
  return: { mac: "Enter", other: "Enter" },
  "⏎": { mac: "Enter", other: "Enter" },
  esc: { mac: "Escape", other: "Escape" },
  escape: { mac: "Escape", other: "Escape" },
  tab: { mac: "Tab", other: "Tab" },
  space: { mac: "Space", other: "Space" },
  backspace: { mac: "Backspace", other: "Backspace" },
  delete: { mac: "Delete", other: "Delete" },
  up: { mac: "ArrowUp", other: "ArrowUp" },
  down: { mac: "ArrowDown", other: "ArrowDown" },
  left: { mac: "ArrowLeft", other: "ArrowLeft" },
  right: { mac: "ArrowRight", other: "ArrowRight" },
};

/** The SAME portable chord `<Kbd>` paints, in the `aria-keyshortcuts` grammar
 *  (task 1362): `"Mod+Shift+n"` → `"Meta+Shift+N"` on Mac, `"Control+Shift+N"`
 *  elsewhere. The announced chord and the painted chip read one string, so
 *  they cannot drift; the chip itself is then `aria-hidden` wherever the
 *  announcement rides the row. */
export function ariaKeyShortcut(keys: string, mac: boolean): string {
  return keys
    .split("+")
    .map((raw) => {
      const hit = ARIA_TOKENS[raw.trim().toLowerCase()];
      if (hit) return mac ? hit.mac : hit.other;
      return raw.length === 1 ? raw.toUpperCase() : raw;
    })
    .filter(Boolean)
    .join("+");
}

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

export function Kbd({
  keys,
  className,
  decorative = false,
}: {
  keys: string;
  className?: string;
  /** The chip only REPEATS a chord its host already announces (a menu row's
   *  `aria-keyshortcuts`, task 1362) — hide it from AT so the glyphs do not
   *  join the host's accessible name ("New paper ⌘⇧N"). */
  decorative?: boolean;
}) {
  const mac = useIsMac();
  return (
    <kbd
      className={className ? `kbd ${className}` : "kbd"}
      aria-hidden={decorative ? true : undefined}
    >
      {formatShortcut(keys, mac)}
    </kbd>
  );
}
