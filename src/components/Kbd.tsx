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

export function Kbd({
  keys,
  className,
}: {
  keys: string;
  className?: string;
}) {
  const mac = useIsMac();
  return (
    <kbd className={className ? `kbd ${className}` : "kbd"}>
      {formatShortcut(keys, mac)}
    </kbd>
  );
}
