"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** Disabled when the entry has no citekey (e.g. an unsorted triage row).
   *  All actions key off citekey so they can't run on triage rows. */
  disabled?: boolean;
  /** Label for the destructive item — "Delete…" or "Remove from library". */
  deleteLabel: string;
  onDelete: () => void;
  onBibReview: () => void;
  onTextReview: () => void;
  onImportBib: () => void;
}

export default function RowActionMenu({
  disabled = false,
  deleteLabel,
  onDelete,
  onBibReview,
  onTextReview,
  onImportBib,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
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
      setPos({
        top: rect.bottom + 2,
        right: window.innerWidth - rect.right,
      });
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
    // Defer attaching so the click that opened the menu doesn't immediately
    // close it.
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const runAction = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onKeyDown={(e) => e.stopPropagation()}
        title={disabled ? "Triage this entry first" : "Actions"}
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        style={btnStyle(disabled)}
      >
        ⋮
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              right: pos.right,
              minWidth: 160,
              background: "var(--surface)",
              border: "1px solid var(--border-light)",
              borderRadius: 6,
              boxShadow: "var(--pod-shadow)",
              padding: "4px 0",
              zIndex: 100,
            }}
          >
            <MenuItem onClick={(e) => runAction(e, onBibReview)}>
              AI bib review
            </MenuItem>
            <MenuItem onClick={(e) => runAction(e, onTextReview)}>
              AI text review
            </MenuItem>
            <MenuItem onClick={(e) => runAction(e, onImportBib)}>
              Import bibliography
            </MenuItem>
            <MenuDivider />
            <MenuItem
              onClick={(e) => runAction(e, onDelete)}
              destructive
            >
              {deleteLabel}
            </MenuItem>
          </div>,
          document.body,
        )}
    </>
  );
}

function btnStyle(disabled: boolean): CSSProperties {
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
  };
}

function MenuItem({
  children,
  onClick,
  destructive = false,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "6px 12px",
        fontSize: 13,
        color: destructive ? "var(--danger, #b3261e)" : "var(--foreground)",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
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
    <div
      style={{
        height: 1,
        background: "var(--border)",
        margin: "4px 0",
      }}
    />
  );
}
