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
import type { JSONContent } from "@tiptap/react";
import type { AiRequest, AiRequestKind } from "@/lib/types";
import { useDragGap } from "@/hooks/useDragGap";
import ConfirmDialog from "./ConfirmDialog";
import RichTextField from "./RichTextField";
import { MIME_AI_REQUEST, MIME_TEXT_INSERT } from "@/lib/marginalia";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";

/* ── Class-string constants ───────────────────────────────────────── */

const CARD_BASE =
  "rounded-lg border transition-colors overflow-hidden";
const CARD_DEFAULT =
  "bg-white border-stone-200 hover:border-stone-300 hover:bg-stone-50/50";
const CARD_SELECTED =
  "bg-white border-amber-300 shadow-sm";

const CARD_SELECTED_FOOTNOTE =
  "bg-white border-red-300 shadow-sm";

const CARD_SELECTED_NOTE =
  "bg-white border-emerald-300 shadow-sm";

const CARD_SELECTED_TODO =
  "bg-white border-stone-400 shadow-sm";

const CARD_SELECTED_CUT =
  "bg-white border-red-300 shadow-sm";

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

/** Note-themed card: emerald selection instead of amber. */
export function noteCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED_NOTE : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/** Todo-themed card: stone/grey selection. */
export function todoCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED_TODO : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/** Cutter-themed card: red selection (matches MARKER_META.cut). */
export function cutCard(selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? CARD_SELECTED_CUT : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/* ── Text-only drag helper ──────────────────────────────────────── */

/** Start a text-only drag (no entity identity). Used by the body text handle. */
export function startTextDrag(e: React.DragEvent, content: unknown, fallbackPlain?: string) {
  const normalized = normalizeRichContent(content);
  const plain = richJsonToPlainText(normalized) || fallbackPlain || "";
  e.dataTransfer.setData("text/plain", plain);
  e.dataTransfer.setData(MIME_TEXT_INSERT, JSON.stringify({ content: normalized }));
  e.dataTransfer.effectAllowed = "copy";
  const ghost = document.createElement("div");
  ghost.textContent = plain.length > 60 ? plain.slice(0, 60) + "\u2026" : plain;
  ghost.style.cssText =
    "position:absolute;top:-9999px;left:-9999px;max-width:220px;padding:4px 8px;background:#fff;border:1px solid #d6d3d1;border-radius:3px;font-size:11px;color:#57534e;font-family:Georgia,serif;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 10, 10);
  requestAnimationFrame(() => document.body.removeChild(ghost));
}

/* ── EditableCard — shared card for RichTextField-bearing panels ──── */

/** Theme configuration for an EditableCard. */
export interface CardTheme {
  cardClass: (selected: boolean, extra?: string) => string;
  separatorSelected: string;
  headerSelected: string;
  /** Badge colors: bg, text/stroke, border — used by badgeLabel & badgeOrphaned. */
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  /** Title input color for CardTitleInput. */
  titleColor: string;
}

/** Pre-built themes for existing card types. */
export const CARD_THEMES = {
  footnote: { cardClass: footnoteCard, separatorSelected: "border-red-200", headerSelected: "bg-red-50/60", badgeBg: "#fef2f2", badgeColor: "#b45757", badgeBorder: "#b45757", titleColor: "#c45a5a" },
  note: { cardClass: noteCard, separatorSelected: "border-emerald-200", headerSelected: "bg-emerald-50/60", badgeBg: "#f0fdf4", badgeColor: "#15803d", badgeBorder: "#34d399", titleColor: "#15803d" },
  archive: { cardClass: panelCard, separatorSelected: "border-amber-200", headerSelected: "bg-amber-50/60", badgeBg: "#f0f5fa", badgeColor: "#7191b0", badgeBorder: "#7191b0", titleColor: "#2c5282" },
  todo: { cardClass: todoCard, separatorSelected: "border-stone-300", headerSelected: "bg-stone-50/60", badgeBg: "#f5f5f4", badgeColor: "#44403c", badgeBorder: "#a8a29e", titleColor: "#44403c" },
  cut: { cardClass: cutCard, separatorSelected: "border-red-200", headerSelected: "bg-red-50/60", badgeBg: "#fef2f2", badgeColor: "#b45757", badgeBorder: "#fca5a5", titleColor: "#b45757" },
} satisfies Record<string, CardTheme>;

/* ── Shared badge classes ────────────────────────────────────────── */

const BADGE_BASE = "inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold shrink-0";

/** Anchored badge with a label (e.g. number or letter). */
export function BadgeLabel({ label, theme }: { label: string | number; theme: CardTheme }) {
  return (
    <span className={BADGE_BASE} style={{ background: theme.badgeBg, color: theme.badgeColor, border: `1.5px solid ${theme.badgeBorder}` }}>
      {label}
    </span>
  );
}

/** Orphaned/unanchored badge — local color square with diagonal cross, faded. */
export function BadgeOrphaned({ theme }: { theme: CardTheme }) {
  return (
    <span
      className={`relative ${BADGE_BASE} opacity-60`}
      style={{ background: theme.badgeBg, border: `1.5px solid ${theme.badgeBorder}` }}
      title="No anchor in document"
    >
      <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 20 20" fill="none" preserveAspectRatio="none">
        <line x1="4" y1="16" x2="16" y2="4" stroke={theme.badgeColor} strokeWidth="2" />
      </svg>
    </span>
  );
}

/* ── Title input (par-title styling) ─────────────────────────────── */

const TITLE_CLASS = "flex-1 min-w-0 bg-transparent outline-none overflow-hidden text-ellipsis placeholder:text-stone-400 placeholder:font-normal";
const TITLE_STYLE: React.CSSProperties = {
  fontSize: "var(--par-title-size, 0.78rem)",
  color: "var(--par-title-color, #c45a5a)",
  fontWeight: 500,
  fontFamily: "var(--font-sans), Inter, sans-serif",
  letterSpacing: "0.02em",
};

/** Standard title input for card headers. */
export function CardTitleInput({
  defaultValue,
  onChange,
  placeholder = "Title",
  style,
  theme,
}: {
  defaultValue?: string;
  onChange?: (title: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  theme?: CardTheme;
}) {
  const merged = theme
    ? { ...TITLE_STYLE, color: theme.titleColor, ...style }
    : style ? { ...TITLE_STYLE, ...style } : TITLE_STYLE;
  return (
    <input
      type="text"
      defaultValue={defaultValue ?? ""}
      onBlur={onChange ? (e) => onChange(e.target.value) : undefined}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      placeholder={placeholder}
      className={TITLE_CLASS}
      style={merged}
    />
  );
}

/* ── Target icon wrapper with selection-aware opacity ────────────── */

/** Wraps a TargetIcon with consistent opacity: full when selected, subdued otherwise.
 *  Pass `disabled` for unanchored items (very faint, non-functional). */
export function CardTargetIcon({
  selected,
  disabled,
  onClick,
  title,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <div
      className={`transition-opacity ${disabled ? "opacity-30" : selected ? "opacity-100" : "opacity-60"}`}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
    >
      <TargetIcon onClick={onClick} title={title ?? (disabled ? "Not anchored in document" : "Jump to in text")} />
    </div>
  );
}

export interface EditableCardProps {
  /** Unique ID (used as RichTextField instanceKey). */
  id: string;
  selected: boolean;
  theme: CardTheme;

  /** Badge element at the left of the header row. */
  badge: ReactNode;
  /** Extra content between badge and toolbar target (e.g. title input). Should be flex-1 to fill space. */
  headerContent?: ReactNode;
  /** Content after toolbar target, before menu (e.g. TargetIcon). */
  headerTrailing?: ReactNode;
  /** Extra content below the RichTextField body (e.g. action buttons). */
  footer?: ReactNode;

  /** Menu items inside ItemMenu. Falls back to MenuDelete when onDelete is provided. */
  menuContent?: ReactNode;
  onDelete?: () => void;

  onClick?: () => void;
  /** When provided, the card is draggable (disabled while RichTextField is focused). */
  onDragStart?: (e: React.DragEvent) => void;
  /** When provided, renders a text-drag handle in the body area.
   *  Drags only the text content for inline insertion (no entity identity). */
  onTextDragStart?: (e: React.DragEvent) => void;

  // ── RichTextField props ──
  value: unknown;
  variant?: "footnote" | "note";
  placeholder?: string;
  muted?: boolean;
  onChange: (json: JSONContent) => void;
  onArchiveConsumed?: (archiveId: string) => void;
  getCitationDisplayText?: (command: string) => string;
  onCitationCreated?: (command: string) => { id: string; displayText: string } | null;

  // ── Wrapper overrides ──
  dataAttr?: { name: string; value: string };
  extraDataAttrs?: Record<string, string>;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;

  // ── Opt-in layout features ──
  /** Render a 6-dot grip handle as the first header element.
   *  Only the grip is draggable; the card wrapper is NOT. */
  grabHandle?: boolean;
  /** Suppress the FormatToolbar in the RichTextField (keyboard shortcuts still work). */
  hideToolbar?: boolean;
  /** Show an [x] delete button in the body area instead of the three-dot menu in the header. */
  inlineDelete?: boolean;
  /** When true, the card gets a dashed border to indicate it is not anchored
   *  in the document. Panels should pass the appropriate badge (BadgeOrphaned)
   *  and a disabled CardTargetIcon separately — this prop only controls the
   *  card wrapper styling. */
  orphaned?: boolean;
  /** Called when the RichTextField gains focus (e.g. for focus-to-select behaviour). */
  onBodyFocus?: () => void;
  /** Called with the Tiptap editor instance when RichTextField gains focus (for main toolbar routing). */
  onEditorFocus?: (editor: any) => void;
  /** Mouse-hover hook. Fires on mouseenter (true) and mouseleave (false). */
  onHoverChange?: (hovering: boolean) => void;
}

/**
 * Canonical card layout for panels with editable rich text content.
 *
 * Structure: header (badge + toolbar + menu) → separator → body (RichTextField) → optional footer.
 * Internalizes focus tracking (disables drag while editing) and toolbar
 * portal target (formats render inline in the header).
 */
export function EditableCard({
  id, selected, theme,
  badge, headerContent, headerTrailing, footer,
  menuContent, onDelete,
  onClick, onDragStart, onTextDragStart,
  value, variant, placeholder, muted,
  onChange, onArchiveConsumed, getCitationDisplayText, onCitationCreated,
  dataAttr, extraDataAttrs, wrapperClassName, wrapperStyle,
  grabHandle, hideToolbar, inlineDelete, orphaned, onBodyFocus, onEditorFocus, onHoverChange,
}: EditableCardProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  /** Check whether the value has any visible text content. */
  const hasContent = useCallback(() => {
    if (!value) return false;
    const walk = (node: any): boolean => {
      if (node.text && node.text.trim()) return true;
      if (node.content) return node.content.some(walk);
      return false;
    };
    return walk(value);
  }, [value]);

  /** Delete with confirmation if there is content. */
  const tryDelete = useCallback(() => {
    if (!onDelete) return;
    if (hasContent()) {
      setConfirmOpen(true);
    } else {
      onDelete();
    }
  }, [onDelete, hasContent]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selected || !onDelete || isFocused) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        tryDelete();
      }
    },
    [selected, onDelete, isFocused, tryDelete],
  );

  const handleFocusChange = useCallback(
    (focused: boolean, editor?: any) => {
      setIsFocused(focused);
      if (focused) {
        onBodyFocus?.();
        if (editor) onEditorFocus?.(editor);
      }
    },
    [onBodyFocus, onEditorFocus],
  );

  // When grabHandle is active, only the grip is draggable — not the whole card.
  const cardDraggable = grabHandle ? false : (onDragStart ? !isFocused : false);
  const cursorClass = isFocused
    ? "cursor-default"
    : (!grabHandle && onDragStart)
      ? "cursor-grab active:cursor-grabbing"
      : "";

  const dataAttrs: Record<string, string> = {
    ...(dataAttr ? { [`data-${dataAttr.name}`]: dataAttr.value } : {}),
    ...(extraDataAttrs || {}),
  };

  // Whether to render the three-dot menu in the header (skip when inlineDelete is on)
  const showHeaderMenu = !inlineDelete;

  return (
    <div
      ref={cardRef}
      {...dataAttrs}
      draggable={cardDraggable}
      onDragStart={!grabHandle ? onDragStart : undefined}
      tabIndex={selected ? 0 : -1}
      onKeyDown={handleKeyDown}
      onFocusCapture={() => { if (!selected && onClick) onClick(); }}
      className={`group ${theme.cardClass(selected, cursorClass)} focus:outline-none${orphaned ? " border-dashed" : ""}${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      {/* Header */}
      <div className={`flex items-center gap-2 px-3 py-1.5${selected ? ` ${theme.headerSelected}` : ""}`}>
        {/* Optional grab handle — sole drag source when present */}
        {grabHandle && onDragStart && (
          <div
            draggable
            onDragStart={(e) => {
              onDragStart!(e);
              // Use the whole card as the drag ghost, positioned below the cursor
              // so it never obscures the drop target
              if (cardRef.current) {
                e.dataTransfer.setDragImage(cardRef.current, 20, -10);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-stone-300 group-hover:text-stone-500 transition-colors shrink-0"
            title="Drag to reorder"
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="3" cy="2" r="1.2" />
              <circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="3" cy="12" r="1.2" />
              <circle cx="7" cy="12" r="1.2" />
            </svg>
          </div>
        )}
        {badge}
        {headerContent}
        {!hideToolbar && (
          <div ref={setToolbarTarget} className="flex items-center" />
        )}
        {!headerContent && !hideToolbar && <div className="flex-1" />}
        {/* Inline [x] delete — to the left of the target icon */}
        {inlineDelete && onDelete && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); tryDelete(); }}
              onMouseDown={(e) => e.stopPropagation()}
              draggable={false}
              onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
              className="opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-stone-400 hover:text-red-500 shrink-0"
              title="Delete"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <ConfirmDialog
              open={confirmOpen}
              message="This item has text. Delete it?"
              confirmLabel="Delete"
              tone="danger"
              anchorRef={cardRef}
              onConfirm={() => { setConfirmOpen(false); onDelete(); }}
              onCancel={() => setConfirmOpen(false)}
            />
          </>
        )}
        {headerTrailing}
        {showHeaderMenu && (
          <div
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            {menuContent ?? (onDelete ? (
              <>
                <ItemMenu><MenuDelete onClick={tryDelete} /></ItemMenu>
                <ConfirmDialog
                  open={confirmOpen}
                  message="This item has text. Delete it?"
                  confirmLabel="Delete"
                  tone="danger"
                  anchorRef={cardRef}
                  onConfirm={() => { setConfirmOpen(false); onDelete(); }}
                  onCancel={() => setConfirmOpen(false)}
                />
              </>
            ) : null)}
          </div>
        )}
      </div>

      {/* Separator */}
      <div className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-stone-200 group-hover:border-stone-300"}`} />

      {/* Body */}
      <div className={`relative px-3 pt-1.5 pb-2${onTextDragStart ? " flex items-start gap-1" : ""}`}>
        {/* Optional text-drag handle — drags only text content for inline insertion */}
        {onTextDragStart && (
          <div
            draggable={!isFocused}
            onDragStart={(e) => { onTextDragStart(e); }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-0.5 pt-1 -ml-1 rounded text-stone-300 group-hover:text-stone-500 transition-colors shrink-0"
            title="Drag text into document"
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="3" cy="2" r="1.2" />
              <circle cx="7" cy="2" r="1.2" />
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="7" cy="7" r="1.2" />
              <circle cx="3" cy="12" r="1.2" />
              <circle cx="7" cy="12" r="1.2" />
            </svg>
          </div>
        )}
        <div className={onTextDragStart ? "flex-1 min-w-0" : undefined}>
          <RichTextField
            instanceKey={id}
            value={value}
            placeholder={placeholder}
            variant={variant}
            selected={selected}
            muted={muted}
            onChange={onChange}
            onArchiveConsumed={onArchiveConsumed}
            getCitationDisplayText={getCitationDisplayText}
            onCitationCreated={onCitationCreated}
            onFocusChange={handleFocusChange}
            toolbarPortalTarget={hideToolbar ? null : toolbarTarget}
            hideToolbar={hideToolbar}
          />
        </div>
      </div>

      {/* Optional footer (e.g. archive action buttons) */}
      {footer}
    </div>
  );
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
          className="w-6 h-6 flex items-center justify-center rounded-md text-stone-400 hover:text-sky-600 hover:bg-sky-50 transition-colors"
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
      e.dataTransfer.setData(MIME_AI_REQUEST, payload);
      const truncated = draft.length > 80 ? draft.slice(0, 80) + "\u2026" : draft;
      e.dataTransfer.setData(
        "text/plain",
        `[AI ${request.kind} request: ${truncated || "(empty)"}]`,
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent = `★ ${truncated || "AI " + request.kind + " request"}`;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:6px 10px;background:#e0f2fe;border:1px solid #7dd3fc;border-radius:4px;font-size:12px;color:#0c4a6e;font-family:var(--font-sans),system-ui,sans-serif;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
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
      className="group rounded-lg border border-sky-200 bg-sky-50/40 px-3 py-2 cursor-grab active:cursor-grabbing hover:border-sky-300 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 shrink-0 mt-0.5 text-sky-500"
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
            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
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
/** Target icon with a file/page shape and an arrow pointing into it. */
export function TargetFileIcon({
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
      <svg width="18" height="18" viewBox="-2 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Page outline (shifted right so arrow stem is visible) */}
        <path d="M16 2H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M16 2v6h6" />
        {/* Arrow from left into center of page */}
        <line x1="-2" y1="15" x2="14" y2="15" />
        <polyline points="11 12 14 15 11 18" />
      </svg>
    </button>
  );
}

/** Target icon with a rounded pod/card shape and an arrow pointing into it. */
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
      <svg width="18" height="18" viewBox="-2 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Rounded pod/card outline (same bounding box as the file icon) */}
        <rect x="6" y="2" width="16" height="20" rx="3" ry="3" />
        {/* Arrow from left into center of pod */}
        <line x1="-2" y1="12" x2="14" y2="12" />
        <polyline points="11 9 14 12 11 15" />
      </svg>
    </button>
  );
}
