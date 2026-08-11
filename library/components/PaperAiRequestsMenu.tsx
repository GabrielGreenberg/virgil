"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { FONT_MONO, FONT_SANS } from "@/lib/font-stacks";

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
 * Built on the library-local portal pattern (mirrors RowActionMenu) rather than
 * the main app's `<MenuProvider>` primitive: that primitive is anchor-rect /
 * floating-positioner / editor-caret-preservation machinery for in-editor
 * chrome, and `@/components/menu` is not among `library/`'s sanctioned cross-silo
 * imports — RowActionMenu is the established Library dropdown idiom. Keyboard:
 * Enter/Space/click toggles (menu stays open for multi-select), ↑/↓ roves,
 * Escape/click-away closes.
 */
export default function PaperAiRequestsMenu<K extends string>({
  items,
  onToggle,
  disabled = false,
}: Props<K>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const queuedCount = items.filter((i) => i.checked).length;

  const openMenu = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
    // Focus the first enabled item.
    const firstEnabled = items.findIndex((i) => !i.disabled);
    setActiveIdx(firstEnabled >= 0 ? firstEnabled : 0);
    setOpen(true);
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    openMenu();
  };

  // Dismissal: click-away + Escape (deferred attach so the opening click
  // doesn't immediately close it). Mirrors RowActionMenu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  // Keep DOM focus on the active item so native focus + our roving index agree
  // (and Escape/arrows land on the menu, not the page).
  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIdx]?.focus();
  }, [open, activeIdx]);

  const stepActive = (dir: 1 | -1) => {
    if (items.length === 0) return;
    let i = activeIdx;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (!items[i].disabled) {
        setActiveIdx(i);
        return;
      }
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      stepActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      stepActive(-1);
      return;
    }
  };

  const runToggle = (e: React.MouseEvent | React.KeyboardEvent, item: AiRequestItem<K>) => {
    e.stopPropagation();
    if (item.disabled) return;
    // Multi-select: toggle and keep the menu open.
    onToggle(item.kind, !item.checked);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={disabled ? "Select a paper to file AI requests" : "AI requests"}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        style={triggerStyle(disabled, queuedCount > 0)}
      >
        AI requests
        {queuedCount > 0 && (
          <span style={countBadgeStyle}>{queuedCount}</span>
        )}
        <span aria-hidden style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="AI requests"
            onKeyDown={onMenuKey}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: 180,
              background: "var(--surface)",
              border: "1px solid var(--border-light)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--pod-shadow)",
              padding: "4px 0",
              zIndex: 100,
            }}
          >
            {items.map((item, i) => (
              <button
                key={item.kind}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={item.checked}
                aria-disabled={item.disabled || undefined}
                title={item.title}
                tabIndex={i === activeIdx ? 0 : -1}
                onClick={(e) => runToggle(e, item)}
                onMouseEnter={() => {
                  if (!item.disabled) setActiveIdx(i);
                }}
                style={itemStyle(item.disabled, i === activeIdx)}
              >
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    flexShrink: 0,
                    color: "var(--accent)",
                    fontSize: 12,
                  }}
                >
                  {item.checked ? "✓" : ""}
                </span>
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
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

function itemStyle(disabled: boolean, active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    background: active && !disabled ? "var(--accent-light)" : "transparent",
    border: "none",
    padding: "6px 12px",
    fontSize: 13,
    color: disabled ? "var(--muted)" : "var(--foreground)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    opacity: disabled ? 0.55 : 1,
  };
}
