/**
 * Panel Design System — Shared primitives for all sidebar panels.
 *
 * Design language:
 *  - Items are rendered as rounded cards with subtle borders
 *  - Selected cards get an amber tint + border + shadow
 *  - Expandable sub-sections use "sub-pod" containers (rounded-md, muted bg)
 *  - Lists use `space-y-2` gaps between cards (no border-b dividers)
 *  - Headers are compact: title + count + optional action
 *
 * Usage:
 *  import { panelCard, PANEL, Chevron, PanelHeader } from "./panel-primitives";
 *
 *  <div className={PANEL.list}>
 *    <div className={panelCard(isSelected)}>
 *      <div className={PANEL.cardInner}>
 *        ...content...
 *        <div className={PANEL.subpod}>...expandable...</div>
 *      </div>
 *    </div>
 *  </div>
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from "react";

/* ── Class-string constants ───────────────────────────────────────── */

const CARD_BASE =
  "rounded-lg border transition-colors overflow-hidden";
const CARD_DEFAULT =
  "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50";
const CARD_SELECTED =
  "bg-amber-50/60 border-amber-300 shadow-sm";

/** Returns the full card className given selection state. */
export function panelCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/** Reusable class-string tokens. */
export const PANEL = {
  /** Scrollable list container wrapping all cards. */
  list: "flex-1 overflow-y-auto px-2 py-2 space-y-2",
  /** Inner padding for card content. */
  cardInner: "px-4 py-3 relative min-w-0",
  /** Expandable sub-pod with muted background (for fields, notes, etc.). */
  subpod: "rounded-md border border-stone-200 bg-stone-50/70 p-3 overflow-hidden",
  /** Sub-pod with white background (for rich-text editors, etc.). */
  subpodWhite: "rounded-md border border-stone-200 bg-white overflow-hidden",
  /** Standard panel header bar — height set by --header-h so all headers align. */
  header: "px-4 border-b border-[var(--border)] h-[var(--header-h)] shrink-0 bg-[var(--header-bg)]",
  /** Empty-state message. */
  empty: "p-6 text-center text-sm text-[var(--muted)]",
} as const;

/* ── Chevron icon ─────────────────────────────────────────────────── */

export function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-150 flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/* ── Panel header ─────────────────────────────────────────────────── */

export function PanelHeader({
  title,
  count,
  onAdd,
  children,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={`${PANEL.header} flex items-center gap-1.5`}>
      <h3 className="text-sm font-semibold text-stone-700">
        {title}
        {count != null && count > 0 && (
          <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
            ({count})
          </span>
        )}
      </h3>
      {onAdd && (
        <button
          onClick={onAdd}
          className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
          title="Add"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

/* ── Horizontal split divider ─────────────────────────────────────── */

/**
 * Horizontal draggable divider for splitting a column into top + bottom
 * halves. Mirrors the visual language of the vertical edge handle in
 * `ResizablePanel` (1px hairline + centered oval grip).
 *
 * The drag handler converts mouse Y to a 0..1 ratio against the parent
 * container's bounding rect, clamped to `[minRatio, maxRatio]`.
 */
export function HSplit({
  ratio,
  onRatioChange,
  containerRef,
  minRatio = 0.15,
  maxRatio = 0.85,
}: {
  ratio: number;
  onRatioChange: (ratio: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  minRatio?: number;
  maxRatio?: number;
}) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.height <= 0) return;
        const r = (ev.clientY - rect.top) / rect.height;
        onRatioChange(Math.max(minRatio, Math.min(maxRatio, r)));
      };
      const onUp = () => {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [containerRef, onRatioChange, minRatio, maxRatio],
  );

  return (
    <div className="relative shrink-0 z-10" style={{ height: 6 }}>
      {/* Wider invisible hit target */}
      <div
        className="absolute inset-x-0 cursor-row-resize"
        style={{ top: -4, height: 14, background: "transparent" }}
        onMouseDown={onMouseDown}
      />
      {/* Visible bar — darker outline, white interior matching editor bg */}
      <div
        className="absolute inset-x-0 cursor-row-resize bg-white hover:bg-stone-50 border-y border-stone-300 transition-colors"
        style={{ top: 0, height: 6 }}
        onMouseDown={onMouseDown}
      />
      {/* Centered grip */}
      <div
        className="absolute left-1/2 cursor-row-resize bg-white border border-stone-300 hover:border-stone-400 transition-colors pointer-events-none z-20"
        style={{
          top: -3,
          marginLeft: -16,
          width: 33,
          height: 10,
          borderRadius: 2,
        }}
      />
    </div>
  );
}

/* ── Three-dot item menu ─────────────────────────────────────────── */

export function ItemMenu({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    if (!open) return;
    // Position the fixed dropdown relative to the button
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
        title="Options"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed bg-white border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[100px]"
          style={{ top: pos.top, right: pos.right }}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ── Prev/Next counter widget ─────────────────────────────────────── */

/**
 * Reusable counter + ↑/↓ navigation arrows for panel headers that step
 * through a list of items. Generalized from SearchPanel's header.
 *
 *  - When `current` is null and `total > 0`: shows "N items".
 *  - When `current` is non-null: shows "i+1 of N".
 *  - When `total === 0`: shows "0 ${label}" with disabled buttons.
 */
export function PrevNextCounter({
  current,
  total,
  onPrev,
  onNext,
  label = "items",
}: {
  current: number | null;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  label?: string;
}) {
  const counterText =
    total === 0
      ? `0 ${label}`
      : current == null
        ? `${total} ${label}`
        : `${current + 1} of ${total}`;

  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-[var(--muted)] tabular-nums mr-1">
        {counterText}
      </span>
      <button
        onClick={onPrev}
        disabled={total === 0}
        className="p-0.5 rounded text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30"
        title="Previous"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
      <button
        onClick={onNext}
        disabled={total === 0}
        className="p-0.5 rounded text-[var(--muted)] hover:text-stone-600 hover:bg-stone-100 transition-colors disabled:opacity-30"
        title="Next"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Tracks a current index over an array and exposes prev/next callbacks
 * that cycle through the items, calling `onActivate` with each chosen
 * item. Handles list shrinking by clamping the exposed index on read.
 */
export function useCycle<T>(
  items: T[],
  onActivate: (item: T, index: number) => void,
) {
  const [rawIdx, setIdx] = useState<number | null>(null);

  // Clamp on read so the exposed value is always valid even if items shrank
  const idx = rawIdx != null && rawIdx < items.length ? rawIdx : null;

  const next = useCallback(() => {
    if (items.length === 0) return;
    const n = idx == null ? 0 : (idx + 1) % items.length;
    setIdx(n);
    onActivate(items[n], n);
  }, [items, idx, onActivate]);

  const prev = useCallback(() => {
    if (items.length === 0) return;
    const p = idx == null ? items.length - 1 : (idx - 1 + items.length) % items.length;
    setIdx(p);
    onActivate(items[p], p);
  }, [items, idx, onActivate]);

  return { idx, setIdx, next, prev };
}

/** Standard menu item for delete actions inside ItemMenu. */
export function MenuDelete({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 transition-colors"
    >
      {label ?? "Delete"}
    </button>
  );
}

/* ── Target icon ──────────────────────────────────────────────────── */

/**
 * Small target/bullseye button shown in the top-right of a *selected*
 * panel card. Clicking it jumps the editor to the element's anchor in
 * the document. Clicking the surrounding card only selects; jump is
 * always done through this button.
 *
 * The button stops propagation so parent card click handlers don't also
 * fire their own select behavior.
 */
export function TargetIcon({
  onClick,
  title = "Jump to in text",
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className={`p-1 rounded text-stone-500 hover:text-stone-800 hover:bg-white/60 transition-colors ${className ?? ""}`}
      title={title}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </svg>
    </button>
  );
}
