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
import type { AiRequest, AiRequestKind } from "@/lib/types";
import { useDragGap } from "@/hooks/useDragGap";
import ConfirmDialog from "./ConfirmDialog";

/* ── Class-string constants ───────────────────────────────────────── */

const CARD_BASE =
  "rounded-lg border transition-colors overflow-hidden";
const CARD_DEFAULT =
  "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50";
const CARD_SELECTED =
  "bg-amber-50/60 border-amber-300 shadow-sm";

const CARD_SELECTED_FOOTNOTE =
  "bg-red-50/60 border-red-300 shadow-sm";

/** Returns the full card className given selection state. */
export function panelCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/**
 * Call from arrow-key handlers to clear the stale CSS :hover on the
 * card the mouse is still resting on. Briefly sets pointer-events:none
 * on the container so the browser drops :hover, then restores on the
 * next pointer movement.
 */
export function clearStaleHover(container: HTMLElement | null) {
  if (!container) return;
  container.style.pointerEvents = "none";
  const restore = () => {
    container.style.pointerEvents = "";
    document.removeEventListener("pointermove", restore);
  };
  document.addEventListener("pointermove", restore);
}

/** Footnote-themed card: reddish selection instead of amber. */
export function footnoteCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED_FOOTNOTE : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
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
  header: "px-4 border-b border-[var(--border-light)] h-[var(--header-h)] shrink-0 bg-[var(--header-bg)]",
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
  onAiRequest,
  children,
}: {
  title: string;
  count?: number;
  onAdd?: () => void;
  /**
   * When provided, renders a small star button next to the "+" button
   * that creates a new AI request (or opens a request form, depending
   * on the panel). Uses the same sun-star icon as the editor toolbar.
   */
  onAiRequest?: () => void;
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
          className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
          title="Add"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      {onAiRequest && (
        <button
          onClick={onAiRequest}
          className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
          title="New AI request"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <g transform="rotate(15 12 12)">
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </g>
          </svg>
        </button>
      )}
      <div className="flex-1" />
      {children}
    </div>
  );
}

/* ── AI request card ───────────────────────────────────────────────── */

const AI_REQUEST_KIND_LABEL: Record<AiRequestKind, string> = {
  footnote: "footnote",
  note: "note",
  quotation: "quotation",
  citation: "citation",
  todo: "todo",
};

/**
 * Draft card holding a free-text AI request the user can later have
 * fulfilled. The card is draggable into the editor — drop produces an
 * `aiRequestMarker` placeholder node.
 *
 * Local behavior: the textarea is uncontrolled and only fires
 * `onChangeText` on blur to keep typing snappy without re-rendering the
 * whole panel on every keystroke.
 */
export function AiRequestCard({
  request,
  onChangeText,
  onDelete,
}: {
  request: AiRequest;
  onChangeText: (text: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(request.text);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Sync external updates (e.g. AI fulfillment) into the local draft.
  useEffect(() => {
    setDraft(request.text);
  }, [request.text, request.id]);

  // Auto-grow textarea
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const handleBlur = useCallback(() => {
    if (draft !== request.text) onChangeText(draft);
  }, [draft, request.text, onChangeText]);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const payload = JSON.stringify({
        requestId: request.id,
        kind: request.kind,
        text: draft,
      });
      e.dataTransfer.setData("application/x-virgil-ai-request", payload);
      const truncated = draft.length > 80 ? draft.slice(0, 80) + "\u2026" : draft;
      e.dataTransfer.setData(
        "text/plain",
        `[AI ${request.kind} request: ${truncated || "(empty)"}]`,
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent = `★ ${truncated || "AI " + request.kind + " request"}`;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;font-size:12px;color:#92400e;font-family:var(--font-sans),system-ui,sans-serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [request.id, request.kind, draft],
  );

  const kindLabel = AI_REQUEST_KIND_LABEL[request.kind] ?? request.kind;

  return (
    <div
      data-ai-request-id={request.id}
      draggable
      onDragStart={handleDragStart}
      className="group rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 cursor-grab active:cursor-grabbing hover:border-amber-300 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 shrink-0 mt-0.5 text-amber-600"
          title={`AI ${kindLabel} request`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <g transform="rotate(15 12 12)">
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </g>
          </svg>
        </span>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
          draggable={false}
          placeholder={`Describe what you want the AI to ${
            request.kind === "todo" ? "do" : "find or write"
          }\u2026`}
          className="flex-1 min-w-0 resize-none bg-transparent text-xs text-stone-700 placeholder:text-stone-400 focus:outline-none leading-snug font-serif"
          style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
          rows={1}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (draft.trim()) {
              setConfirmOpen(true);
            } else {
              onDelete();
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="text-stone-400 hover:text-stone-600 shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Delete request"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <ConfirmDialog
          open={confirmOpen}
          message="This request has text. Discard it?"
          confirmLabel="Discard"
          tone="danger"
          onConfirm={() => { setConfirmOpen(false); onDelete(); }}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
      <div className="text-[10px] text-stone-400 mt-1 flex items-center gap-1.5 pl-7">
        <span>{kindLabel}</span>
        {request.status === "submitted" && (
          <span className="inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Pending
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Header label for the "Pending AI requests" section that panels render
 * above their AiRequestCard list. Mirrors the bibliography precedent.
 */
export function AiRequestsSectionHeader({ count }: { count: number }) {
  return (
    <div className="text-[10px] font-medium text-stone-500 uppercase tracking-wide px-2 mb-1.5 mt-2 pt-2 border-t border-stone-200">
      Pending AI requests ({count})
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
  const onMove = useCallback(
    (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const r = (ev.clientY - rect.top) / rect.height;
      onRatioChange(Math.max(minRatio, Math.min(maxRatio, r)));
    },
    [containerRef, onRatioChange, minRatio, maxRatio],
  );

  const { gapRef, onMouseDown } = useDragGap({ cursor: "row-resize", onMove });

  return (
    <div className="relative shrink-0 z-10" style={{ height: 'var(--pod-gap)' }}>
      {/* Wider invisible hit target */}
      <div
        className="absolute inset-x-0 cursor-row-resize"
        style={{ top: -4, bottom: -4, background: "transparent" }}
        onMouseDown={onMouseDown}
      />
      {/* Drag gap — background-colored negative space with blue hover highlight */}
      <div
        ref={gapRef}
        className="drag-gap drag-gap-h w-full h-full"
        onMouseDown={onMouseDown}
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
  label = "items",
}: {
  current: number | null;
  total: number;
  label?: string;
}) {
  const suffix = label ? ` ${label}` : "";
  const counterText =
    total === 0
      ? `0${suffix}`
      : current == null
        ? `${total}${suffix}`
        : `${current + 1} of ${total}`;

  return (
    <span className="text-xs text-[var(--muted)] tabular-nums">
      {counterText}
    </span>
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
        <circle cx="12" cy="12" r="10.5" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    </button>
  );
}
