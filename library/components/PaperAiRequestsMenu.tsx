"use client";

import type { CSSProperties } from "react";
import { FONT_MONO, FONT_SANS } from "@/lib/font-stacks";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuToggleRow } from "@/components/menu/MenuToggleRow";

export interface AiRequestItem<K extends string = string> {
  kind: K;
  label: string;
  /** Whether this request is currently queued (shows the checkmark + active tint). */
  checked: boolean;
  /** Disabled state + reason (e.g. "Index the paper first…"). */
  disabled: boolean;
  title?: string;
}

interface Props<K extends string> {
  items: AiRequestItem<K>[];
  /** Toggle one item. `next` is the desired queued state. */
  onToggle: (kind: K, next: boolean) => void;
  /** Disabled when there's no usable handle/citekey (mirrors the old row). */
  disabled?: boolean;
}

/**
 * "AI requests" header dropdown. Replaces the inline checkbox row: ONE button
 * opens a menu of the five toggleable requests (Index / Deep index / Bib review
 * / Doc review / Import bib). Each item is an independent toggle (multi-select)
 * showing a ✓ when queued and respecting per-item disabled state.
 *
 * Built on the app's ONE menu door (`AnchoredMenu`, task 1011). It used to be a
 * library-local portal hand-roll on the theory that the primitive was editor
 * machinery the silo couldn't import — but the silo already imported its
 * trigger contract, and the hand-roll had drifted: `top`/`left` off the trigger
 * rect with no flip on either axis (it ran off the bottom of a short window),
 * no re-anchor, and a dismissal of its own. The one thing it did that the
 * primitive did not — hand focus back to the trigger on Escape — moved INTO
 * the primitive (`MenuProvider`'s `returnFocusOnCancel`), so every anchored
 * menu has it now. Keyboard: ↑/↓ roves, Enter/Space/click toggles (the menu
 * stays open for multi-select — `keepMenuOpen`), Escape cancels, click-away
 * dismisses.
 *
 * The host (`PaperHeader`) keys this component by citekey, so a paper switch
 * that arrives without a press (keyboard, the `virgil-open-library` event)
 * cannot leave the menu open over the NEW paper's requests.
 */
export default function PaperAiRequestsMenu<K extends string>({
  items,
  onToggle,
  disabled = false,
}: Props<K>) {
  const queuedCount = items.filter((i) => i.checked).length;
  return (
    <AnchoredMenu
      ariaLabel="AI requests"
      trigger={() => (
        <>
          AI requests
          {queuedCount > 0 && (
            <span style={countBadgeStyle}>{queuedCount}</span>
          )}
          <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
        </>
      )}
      triggerDisabled={disabled}
      triggerHint={
        disabled ? "Select a paper to file AI requests" : "AI requests"
      }
      triggerStyle={triggerStyle(disabled, queuedCount > 0)}
      containerStyle={{ minWidth: 180 }}
    >
      {items.map((item) => (
        <MenuToggleRow
          key={item.kind}
          id={item.kind}
          label={item.label}
          checked={item.checked}
          disabled={item.disabled}
          hint={item.title}
          keepMenuOpen
          onToggle={() => onToggle(item.kind, !item.checked)}
        />
      ))}
    </AnchoredMenu>
  );
}

function triggerStyle(disabled: boolean, anyQueued: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 8px",
    fontSize: 12,
    fontFamily: FONT_SANS,
    color: disabled ? "var(--muted)" : "var(--foreground)",
    background: anyQueued ? "var(--accent-light)" : "transparent",
    border: "1px solid var(--border-light)",
    borderRadius: "var(--radius-md)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    whiteSpace: "nowrap",
  };
}

const countBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 16,
  height: 16,
  padding: "0 4px",
  fontSize: 10,
  fontFamily: FONT_MONO,
  lineHeight: 1,
  color: "white",
  background: "var(--accent)",
  borderRadius: "var(--pod-radius)",
};
