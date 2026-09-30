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
 * The strip's dismissal lives here for the same reason — one door, armed only
 * while the strip is open, instead of one per mounted pane. It is the SHARED
 * door (`useMenuDismiss`, task 862), not a hand-rolled document `mousedown`:
 * the outside press is read on `pointerdown` (pen/touch, and presses whose
 * target preventDefaults it — task 746), and Escape closes the strip (it
 * stages nothing, so cancel = dismiss) — EXCEPT while a drop session is live:
 * a stack pull starts INSIDE the strip, so the strip is still open during the
 * drag, and that Escape belongs to the drag alone (one press ends ONE thing —
 * `claimGestureKey`'s doctrine). Both are window-capture listeners, so the
 * drag's claim cannot stop this one; it yields by asking `getDropSession()` at
 * press time (O(1); no per-frame subscription).
 */

import { useCallback, useRef, useSyncExternalStore } from "react";
import { StackIcon } from "./StackIcon";
import { StackStrip } from "./StackStrip";
import { useStack } from "@/hooks/useStack";
import { useMenuDismiss } from "@/components/menu/useMenuDismiss";
import { getDropSession } from "@/components/drop-mode/controller";
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

  const stripRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<HTMLButtonElement | null>(null);
  const getExcludes = useCallback(() => [iconRef.current], []);
  const close = useCallback(() => setStackStripOpen(false), []);
  // Consume (without closing) while a drag owns the key — see the header.
  const yieldToDrag = useCallback(() => getDropSession() !== null, []);
  useMenuDismiss({
    open,
    containerRef: stripRef,
    getExcludes,
    onClose: close,
    escape: { onEscape: yieldToDrag },
  });

  if (!wantsChrome) return null;

  return (
    <>
      <StackIcon open={open} onToggle={toggleStackStrip} hitRef={iconRef} />
      <StackStrip
        open={open}
        items={stack.items}
        onRemove={stack.remove}
        containerRef={stripRef}
      />
    </>
  );
}
