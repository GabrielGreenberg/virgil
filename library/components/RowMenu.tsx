"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * RowMenu — the single portaled three-dot (⋮) menu primitive for the
 * Library's row affordances. F#5/F#7 build the Libraries-pod and
 * My-Papers-pod row menus on it; `RowActionMenu` (the catalog paper rows)
 * is refactored onto it too, so "a row's overflow menu" is ONE component
 * with one trigger/positioning/escape/outside-click behaviour everywhere.
 *
 * Declarative: callers pass an `items` array; the primitive owns the
 * trigger button, the portaled popup, viewport-aware up/down placement,
 * outside-click + Escape close, and click-through suppression (so opening
 * or selecting never fires the underlying row's onClick).
 *
 * Lives in `library/components/` and is import-safe from
 * `src/components/library/` too (MyPapersPod), matching the existing
 * `@library/components/*` bridge that `LibraryTabView` already uses.
 */

export interface RowMenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

export interface RowMenuDivider {
  key: string;
  divider: true;
}

export type RowMenuEntry = RowMenuAction | RowMenuDivider;

function isDivider(e: RowMenuEntry): e is RowMenuDivider {
  return (e as RowMenuDivider).divider === true;
}

interface RowMenuProps {
  items: RowMenuEntry[];
  /** Disabled trigger (e.g. an un-triaged catalog row with no citekey). */
  disabled?: boolean;
  /** Tooltip for the trigger. */
  title?: string;
  /** Accessible label for the trigger. */
  ariaLabel?: string;
  /** Trigger glyph — defaults to the three-dot ⋮. F#5's "My libraries"
   *  header reuses this with a "+". */
  glyph?: ReactNode;
  /** Popup min width. */
  minWidth?: number;
  /** Override the trigger button style (size/colour). */
  triggerStyle?: CSSProperties;
}

const MENU_MARGIN = 6;
const ITEM_HEIGHT = 30; // rough per-item height for the flip heuristic

export default function RowMenu({
  items,
  disabled = false,
  title,
  ariaLabel = "Row actions",
  glyph = "⋮",
  minWidth = 168,
  triggerStyle,
}: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<
    { right: number; top: number } | { right: number; bottom: number } | null
  >(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const right = window.innerWidth - rect.right;
      // Estimate the popup height and flip above the trigger when there
      // isn't room below (left-rail pods sit near the viewport bottom).
      const estHeight =
        items.length * ITEM_HEIGHT + MENU_MARGIN * 2;
      const spaceBelow = window.innerHeight - rect.bottom;
      if (spaceBelow < estHeight && rect.top > spaceBelow) {
        setPos({ right, bottom: window.innerHeight - rect.top + 2 });
      } else {
        setPos({ right, top: rect.bottom + 2 });
      }
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Defer attaching so the click that opened the menu doesn't close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const runAction = (e: React.MouseEvent, item: RowMenuAction) => {
    e.stopPropagation();
    if (item.disabled) return;
    setOpen(false);
    item.onSelect();
  };

  // Resolve the trigger style once so hover can revert to its real base
  // background (transparent for both the ⋮ and the header "+").
  const resolvedTriggerStyle = triggerStyle ?? defaultTriggerStyle(disabled);
  const baseBg = (resolvedTriggerStyle.background as string | undefined) ?? "transparent";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onKeyDown={(e) => e.stopPropagation()}
        title={title ?? (disabled ? "Unavailable" : ariaLabel)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onMouseEnter={(e) => {
          if (disabled) return;
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(0, 0, 0, 0.06)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = baseBg;
        }}
        style={resolvedTriggerStyle}
      >
        {glyph}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              right: pos.right,
              ...("top" in pos ? { top: pos.top } : { bottom: pos.bottom }),
              minWidth,
              background: "var(--surface)",
              border: "1px solid var(--border-light)",
              borderRadius: 6,
              boxShadow: "var(--pod-shadow)",
              padding: "4px 0",
              zIndex: 200,
            }}
          >
            {items.map((item) =>
              isDivider(item) ? (
                <MenuDivider key={item.key} />
              ) : (
                <MenuItem
                  key={item.key}
                  onClick={(e) => runAction(e, item)}
                  destructive={item.destructive}
                  disabled={item.disabled}
                >
                  {item.label}
                </MenuItem>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function defaultTriggerStyle(disabled: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    padding: 0,
    border: "none",
    background: "transparent",
    color: disabled ? "var(--muted-light)" : "var(--muted)",
    cursor: disabled ? "default" : "pointer",
    fontSize: 16,
    lineHeight: 1,
    fontFamily: "inherit",
    borderRadius: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
}

function MenuItem({
  children,
  onClick,
  destructive = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "6px 12px",
        fontSize: 13,
        color: disabled
          ? "var(--muted-light)"
          : destructive
            ? "var(--danger, #b3261e)"
            : "var(--foreground)",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--accent-light)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function MenuDivider() {
  return (
    <div style={{ height: 1, background: "var(--border)", margin: "4px 0" }} />
  );
}
