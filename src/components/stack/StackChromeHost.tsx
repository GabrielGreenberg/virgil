"use client";

/**
 * StackChromeHost — the ONE mount of the Stack's chrome (task 589).
 *
 * The Stack is app-global: one localStorage envelope, one cached icon rect, one
 * illuminated-ring signal. Its icon and strip used to be rendered by every
 * `EditorPane` and portaled to `document.body`, so multi-doc keep-alive painted
 * N identical buttons over each other and an evicted pane's cleanup nulled the
 * one global rect — see `@/lib/stack/stack-terminal` for the full account.
 *
 * So this host is mounted ONCE, above the keep-alive slots (EditorLayout), and
 * the per-doc facts its chrome needs are read from the pane that owns them
 * through the terminal registry's ladder. Consequences worth naming:
 *
 *   - exactly one `[data-stack-icon-hit]` and at most one `[data-stack-strip]`
 *     exist in the DOM, however many panes are warm;
 *   - `setStackIconRect` has exactly one owner, so its null-on-unmount is
 *     correct rather than a global erase;
 *   - the icon toggles the strip the user is looking at, because the strip's
 *     open state is global too (`useStackStripOpen`);
 *   - `useStack()` runs once instead of once per warm pane — one storage
 *     subscription, one envelope parse.
 *
 * The click-away listener lives here for the same reason: one listener, armed
 * only while the strip is open, instead of one per mounted pane.
 */

import { useEffect, useSyncExternalStore } from "react";
import { StackIcon } from "./StackIcon";
import { StackStrip } from "./StackStrip";
import { useStack } from "@/hooks/useStack";
import {
  setStackStripOpen,
  someTerminalWantsChrome,
  subscribeStackTerminals,
  toggleStackStrip,
  useStackStripOpen,
} from "@/lib/stack/stack-terminal";

export function StackChromeHost() {
  const stack = useStack();
  const open = useStackStripOpen();
  // Membership/gate snapshot. Emits only when a pane mounts, unmounts, or
  // flips its zen gate — never per keystroke, never per frame.
  const wantsChrome = useSyncExternalStore(
    subscribeStackTerminals,
    someTerminalWantsChrome,
    () => false,
  );

  // Click-away: close the strip when the user mousedowns outside both the icon
  // and the strip. Skipped while closed so there's no persistent listener.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest('[data-stack-icon-hit="true"]') ||
        target.closest('[data-stack-strip="true"]')
      ) {
        return;
      }
      setStackStripOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  if (!wantsChrome) return null;

  return (
    <>
      <StackIcon open={open} onToggle={toggleStackStrip} />
      <StackStrip open={open} items={stack.items} onRemove={stack.remove} />
    </>
  );
}
