/**
 * Panel Design System — Shared primitives for all sidebar panels.
 *
 * Design language:
 *  - Items are rendered as rounded cards with subtle borders
 *  - Selected cards get a themed tint + border + shadow
 *  - Expandable sub-sections use "sub-pod" containers (rounded-md, muted bg)
 *  - Lists use `space-y-2` gaps between cards (no border-b dividers)
 *  - Headers are compact: title + count + optional action
 *
 * Card model:
 *  Every in-panel card composes the single `Card` shell below. Cross-cutting
 *  concerns (selection, delete affordance + confirm, drag source, drop-target
 *  wiring, text-drag gutter, theme + override styles, `data-prefs` + data-panel-theme
 *  annotations, card-level popout plug point) live on `Card`. Variants
 *  (`EditableCard`, `AiRequestCard`, `TodoCard`, `BibEntryCard`, `CitationCard`,
 *  `RevisionCard`) just fill the header / body / footer slots. See STYLE_GUIDE.md
 *  "Card" section for the full contract.
 *
 *  Usage (raw):
 *    <Card theme={CARD_THEMES.note} selected={sel} header={...} body={...}
 *      dragSource="handle" onDragStart={...} onDelete={...}
 *      deleteAffordance="inline" panelThemeKey="note" />
 *
 *  Usage (via a RichTextField-backed variant):
 *    <EditableCard id={id} selected={sel} theme={theme} badge={...}
 *      headerContent={...} value={content} onChange={...} grabHandle
 *      inlineDelete hideToolbar onDelete={...} onDragStart={...} />
 */

import { type ReactNode, useState, useRef, useEffect, useCallback, createContext, useContext } from "react";
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
  "bg-surface border-edge-hover hover:border-edge-strong hover:bg-surface-muted/50";
const CARD_SELECTED =
  "bg-surface border-amber-300 shadow-sm";

const CARD_SELECTED_FOOTNOTE =
  "bg-surface border-red-300 shadow-sm";

const CARD_SELECTED_NOTE =
  "bg-surface border-emerald-300 shadow-sm";

const CARD_SELECTED_TODO =
  "bg-surface border-stone-400 shadow-sm";

const CARD_SELECTED_CUT =
  "bg-surface border-red-300 shadow-sm";

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

/** AI-request card: sky borders throughout — no separate selection state. */
const AI_REQUEST_CARD_BASE =
  "rounded-lg border border-sky-200 overflow-hidden hover:border-sky-300 transition-colors";
export function aiRequestCard(_selected: boolean, extra?: string): string {
  return `${AI_REQUEST_CARD_BASE}${extra ? ` ${extra}` : ""}`;
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

/* ── Card theme ──────────────────────────────────────────────────── */

/** Theme configuration for a Card. */
export interface CardTheme {
  cardClass: (selected: boolean, extra?: string) => string;
  /** Always-on header tint (shown even when unselected). */
  headerDefault: string;
  /** Intensified header tint on selection. */
  headerSelected: string;
  separatorSelected: string;
  /** Badge colors: bg, text/stroke, border — used by badgeLabel & badgeOrphaned. */
  badgeBg: string;
  badgeColor: string;
  badgeBorder: string;
  /** Title input color for CardTitleInput. */
  titleColor: string;
  /** Inline-style overrides used when the user picks a custom panel color.
   *  When set, they override the Tailwind classnames above via inline `style`. */
  override?: {
    headerBg: string;
    headerBgSelected: string;
    separatorColor: string;
    selectedBorder: string;
  };
}

/** Apply inline-style overrides atop the card wrapper. Returns an empty object
 *  when the theme has no override, so default Tailwind classes win. */
export function cardOverrideStyle(
  theme: CardTheme,
  selected: boolean,
): React.CSSProperties {
  if (!theme.override) return {};
  return selected ? { borderColor: theme.override.selectedBorder } : {};
}

/** Inline-style overrides for the header background. */
export function headerOverrideStyle(
  theme: CardTheme,
  selected: boolean,
): React.CSSProperties {
  if (!theme.override) return {};
  return { backgroundColor: selected ? theme.override.headerBgSelected : theme.override.headerBg };
}

/** Inline-style overrides for the card separator. */
export function separatorOverrideStyle(
  theme: CardTheme,
  selected: boolean,
): React.CSSProperties {
  if (!theme.override || !selected) return {};
  return { borderTopColor: theme.override.separatorColor };
}

/** Pre-built themes for existing card types. */
export const CARD_THEMES = {
  footnote:  { cardClass: footnoteCard, headerDefault: "bg-red-100/60",    headerSelected: "bg-red-100",       separatorSelected: "border-red-200",     badgeBg: "#fef2f2", badgeColor: "#b45757", badgeBorder: "#b45757", titleColor: "#c45a5a" },
  note:      { cardClass: noteCard,     headerDefault: "bg-emerald-100/50", headerSelected: "bg-emerald-100",  separatorSelected: "border-emerald-200", badgeBg: "#f0fdf4", badgeColor: "#15803d", badgeBorder: "#34d399", titleColor: "#15803d" },
  archive:   { cardClass: panelCard,    headerDefault: "bg-amber-100/50",  headerSelected: "bg-amber-100",     separatorSelected: "border-amber-200",   badgeBg: "#f0f5fa", badgeColor: "#7191b0", badgeBorder: "#7191b0", titleColor: "#2c5282" },
  todo:      { cardClass: todoCard,     headerDefault: "bg-stone-100/70",  headerSelected: "bg-stone-200/80",  separatorSelected: "border-edge-hover",   badgeBg: "#f5f5f4", badgeColor: "#44403c", badgeBorder: "#a8a29e", titleColor: "#44403c" },
  bib:       { cardClass: panelCard,    headerDefault: "bg-[#fdf8e1]/80",  headerSelected: "bg-[#fdf8e1]",     separatorSelected: "border-[#e0d5a8]",   badgeBg: "#fdf8e1", badgeColor: "#6b6245", badgeBorder: "#e0d5a8", titleColor: "#6b6245" },
  citation:  { cardClass: panelCard,    headerDefault: "bg-[#fef3c3]/40",  headerSelected: "bg-[#fef3c3]",     separatorSelected: "border-[#d4a843]",   badgeBg: "#fef3c3", badgeColor: "#4a3f20", badgeBorder: "#d4a843", titleColor: "#4a3f20" },
  quote:     { cardClass: panelCard,    headerDefault: "bg-amber-50/30",   headerSelected: "bg-amber-50/60",   separatorSelected: "border-amber-200",   badgeBg: "#fef3c3", badgeColor: "#92700a", badgeBorder: "#d4a843", titleColor: "#92700a" },
  comment:   { cardClass: panelCard,    headerDefault: "bg-stone-100/60",  headerSelected: "bg-stone-200/70",  separatorSelected: "border-edge-hover",   badgeBg: "#f5f5f4", badgeColor: "#44403c", badgeBorder: "#a8a29e", titleColor: "#44403c" },
  aiRequest: { cardClass: aiRequestCard, headerDefault: "bg-sky-100/50",   headerSelected: "bg-sky-100",       separatorSelected: "border-sky-200",     badgeBg: "#e0f2fe", badgeColor: "#0c4a6e", badgeBorder: "#7dd3fc", titleColor: "#0c4a6e" },
  cut:       { cardClass: cutCard,      headerDefault: "bg-red-100/60",    headerSelected: "bg-red-100",       separatorSelected: "border-red-200",     badgeBg: "#fef2f2", badgeColor: "#b45757", badgeBorder: "#fca5a5", titleColor: "#b45757" },
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

const TITLE_CLASS = "flex-1 min-w-0 bg-transparent outline-none overflow-hidden text-ellipsis placeholder:text-ink-muted placeholder:font-normal";
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

/* ── Card — unified shell for every panel card ───────────────────── */

/**
 * Universal card shell. Owns every cross-cutting concern: rounded border,
 * theme colors, selection state (click + keyboard), delete affordance
 * (inline [x] or three-dot menu, with optional content-aware confirm),
 * drag source (whole-card or 6-dot grab handle), drop-target wiring,
 * body-gutter text-drag handle, hover, preference-mode annotations,
 * and a plug point for future card-level popout.
 *
 * Variants (EditableCard, BibEntryCard, CitationCard, TodoCard,
 * AiRequestCard, RevisionCard, …) compose this shell by filling the
 * `header`, `body`, and optional `footer` slots; specialization is just
 * "what goes in the slots + which feature flags to set".
 *
 * Header layout (left→right, shell-injected items in brackets):
 *   [grab?] {header} [inlineDelete?] {headerTrailing?} [menu?] [popout?]
 *
 * Features intentionally NOT owned by Card (per-variant concerns):
 *  - The in-editor toolbar portal target (lives in EditableCard).
 *  - Body-editor focus state (body emits it via `isFocused`; Card consumes).
 */
export interface CardProps {
  /** Stable identifier — useful as a React key in ancestor lists. Not itself
   *  rendered by Card; variants may pass their entity id for convenience. */
  id: string;
  theme: CardTheme;
  selected: boolean;

  /** Free-form header content. Shell injects grab/inlineDelete/menu/popout
   *  around it in the documented order; the variant controls everything
   *  that sits between the grab handle and the shell-owned trailing chrome.
   *  Passing `null`/`undefined` omits the header row AND its separator —
   *  intended for full-card-takeover modes (e.g. citation-edit builder). */
  header?: ReactNode;
  /** Free-form body content. When `onTextDragStart` is set, Card wraps this
   *  in a flex row and injects a gutter drag handle to the left. */
  body: ReactNode;
  /** Optional footer rendered below the body, outside the body padding. */
  footer?: ReactNode;
  /** Optional trailing header slot, placed after the shell-injected
   *  inline-delete [x] and before the menu/popout. Used by variants whose
   *  target icon must appear right-of-[x]. */
  headerTrailing?: ReactNode;

  // ── Selection ──
  /** Click and focus-capture both route through this. */
  onSelect?: () => void;
  /** Defaults to `!!onSelect`. Controls tabIndex + onFocusCapture wiring. */
  selectable?: boolean;

  // ── Delete ──
  onDelete?: () => void;
  /** Default: `"menu"` when `onDelete` is set, `"none"` otherwise. */
  deleteAffordance?: "inline" | "menu" | "none";
  /** Predicate checked when the user triggers delete. If it returns true, a
   *  `ConfirmDialog` appears instead of deleting immediately. */
  deleteConfirmWhen?: () => boolean;
  /** Message shown in the confirm dialog; falls back to a generic message. */
  deleteConfirmMessage?: ReactNode;
  deleteConfirmLabel?: string;
  /** Extra items rendered in the three-dot menu above MenuDelete. */
  menuExtras?: ReactNode;
  /** Default: on when selectable + onDelete set. Del / Backspace → tryDelete. */
  enableKeyboardDelete?: boolean;

  // ── Drag (source) ──
  /** Default `"none"`. `"handle"` renders a 6-dot grip as the first header
   *  item and makes only the grip draggable. `"whole-card"` makes the
   *  outer div itself draggable (disabled automatically when `isFocused`). */
  dragSource?: "whole-card" | "handle" | "none";
  /** Explicit opt-out for whole-card drag (e.g. CitationCard while editing). */
  dragDisabled?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  /** When provided, renders a 6-dot text-drag handle in the body gutter.
   *  Intended for dragging *text content only* (no entity identity) into
   *  the editor for inline insertion. */
  onTextDragStart?: (e: React.DragEvent) => void;

  // ── Drag (drop target) ──
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;

  // ── Focus tracking (body-driven) ──
  /** True when the body (e.g. RichTextField, contentEditable) has focus.
   *  Card uses it to disable drag and switch the cursor to default. */
  isFocused?: boolean;

  // ── Card-level popout (plug point) ──
  /** When provided, renders a popout toggle in the header trailing chrome. */
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;

  // ── Hover ──
  onHoverChange?: (hovering: boolean) => void;

  // ── Wrapper ──
  /** Callback that receives the card's root element. Useful when the
   *  parent needs to scroll a specific card into view. */
  rootRef?: (el: HTMLDivElement | null) => void;
  /** Native `title` tooltip on the card root. */
  title?: string;
  dataAttr?: { name: string; value: string };
  extraDataAttrs?: Record<string, string>;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  /** Replace the default body padding (`relative px-3 pt-1.5 pb-2`). Use when
   *  the variant needs different spacing (e.g. `PANEL.cardInner`) or no
   *  padding at all. The text-drag gutter, when present, is added to
   *  whatever class is used. */
  bodyClassName?: string;
  /** Preference-mode annotation for the header row — makes it editable via
   *  `PanelThemePicker`. Pass the matching `PanelThemeKey`. */
  panelThemeKey?: string;
}

export function Card({
  theme,
  selected,
  header,
  body,
  footer,
  headerTrailing,
  onSelect,
  selectable,
  onDelete,
  deleteAffordance,
  deleteConfirmWhen,
  deleteConfirmMessage = "This item has text. Delete it?",
  deleteConfirmLabel = "Delete",
  menuExtras,
  enableKeyboardDelete,
  dragSource = "none",
  dragDisabled,
  onDragStart,
  onTextDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  isFocused,
  onTogglePopout,
  isPoppedOut,
  onHoverChange,
  rootRef,
  title,
  dataAttr,
  extraDataAttrs,
  wrapperClassName,
  wrapperStyle,
  bodyClassName,
  panelThemeKey,
}: CardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      cardRef.current = el;
      rootRef?.(el);
    },
    [rootRef],
  );

  const isSelectable = selectable ?? !!onSelect;
  const resolvedDeleteAffordance =
    deleteAffordance ?? (onDelete ? "menu" : "none");
  const showInlineDelete =
    resolvedDeleteAffordance === "inline" && !!onDelete;
  const showMenu =
    resolvedDeleteAffordance === "menu" && (!!onDelete || !!menuExtras);
  const kbDelete =
    enableKeyboardDelete ?? (isSelectable && !!onDelete);

  const tryDelete = useCallback(() => {
    if (!onDelete) return;
    if (deleteConfirmWhen && deleteConfirmWhen()) {
      setConfirmOpen(true);
    } else {
      onDelete();
    }
  }, [onDelete, deleteConfirmWhen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!kbDelete || !selected || isFocused) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        tryDelete();
      }
    },
    [kbDelete, selected, isFocused, tryDelete],
  );

  const wholeCardDraggable =
    dragSource === "whole-card" && !dragDisabled && !isFocused && !!onDragStart;
  const showHandle = dragSource === "handle" && !!onDragStart;
  const cursorClass = isFocused
    ? "cursor-default"
    : wholeCardDraggable
      ? "cursor-grab active:cursor-grabbing"
      : "";

  const dataAttrs: Record<string, string> = {
    ...(dataAttr ? { [`data-${dataAttr.name}`]: dataAttr.value } : {}),
    ...(extraDataAttrs || {}),
  };

  return (
    <div
      ref={setRefs}
      {...dataAttrs}
      // Preference-mode annotation: the outer surface and border come from
      // generic --surface / --edge tokens, so ctrl+click edits every card
      // in every panel. Per-panel header colours are annotated separately
      // via `data-panel-theme` on the header row below.
      data-prefs="surfaceColor,borderColor"
      title={title}
      draggable={wholeCardDraggable}
      onDragStart={wholeCardDraggable ? onDragStart : undefined}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      tabIndex={isSelectable ? (selected ? 0 : -1) : undefined}
      onKeyDown={kbDelete ? handleKeyDown : undefined}
      onFocusCapture={
        isSelectable && onSelect
          ? () => { if (!selected) onSelect(); }
          : undefined
      }
      className={`group ${theme.cardClass(selected, cursorClass)} focus:outline-none${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={{ ...cardOverrideStyle(theme, selected), ...wrapperStyle }}
      onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(); } : undefined}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      {/* Header */}
      {header != null && (
      <div
        className={`flex items-center gap-2 px-3 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}
        style={headerOverrideStyle(theme, selected)}
        data-panel-theme={panelThemeKey}
      >
        {/* Grab handle — sole drag source when dragSource === "handle" */}
        {showHandle && (
          <div
            draggable
            onDragStart={(e) => {
              onDragStart!(e);
              if (cardRef.current) {
                e.dataTransfer.setDragImage(cardRef.current, 20, -10);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint group-hover:text-ink-subtle transition-colors shrink-0"
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

        {header}

        {/* Inline [x] delete — sits between header content and trailing chrome. */}
        {showInlineDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); tryDelete(); }}
            onMouseDown={(e) => e.stopPropagation()}
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
            className="opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity p-0.5 rounded text-ink-muted hover:text-danger shrink-0"
            title="Delete"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}

        {headerTrailing}

        {showMenu && (
          <div
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            <ItemMenu>
              {menuExtras}
              {onDelete && <MenuDelete onClick={tryDelete} />}
            </ItemMenu>
          </div>
        )}

        {onTogglePopout && (
          <CardPopoutButton
            isPoppedOut={!!isPoppedOut}
            onClick={onTogglePopout}
          />
        )}
      </div>
      )}

      {/* Separator — omitted with the header */}
      {header != null && (
        <div
          className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`}
          style={separatorOverrideStyle(theme, selected)}
        />
      )}

      {/* Body */}
      <div className={`${bodyClassName ?? "relative px-3 pt-1.5 pb-2"}${onTextDragStart ? " flex items-start gap-1" : ""}`}>
        {onTextDragStart && (
          <div
            draggable={!isFocused}
            onDragStart={(e) => { onTextDragStart(e); }}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing p-0.5 pt-1 -ml-1 rounded text-ink-faint group-hover:text-ink-subtle transition-colors shrink-0"
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
          {body}
        </div>
      </div>

      {footer}

      {onDelete && (
        <ConfirmDialog
          open={confirmOpen}
          message={deleteConfirmMessage}
          confirmLabel={deleteConfirmLabel}
          tone="danger"
          anchorRef={cardRef}
          onConfirm={() => { setConfirmOpen(false); onDelete(); }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

/* ── Card-level popout button ─────────────────────────────────────── */

/** Small popout toggle rendered at the trailing edge of the Card header.
 *  Mirrors the panel-level PopoutButton but sized for card chrome. */
function CardPopoutButton({
  isPoppedOut,
  onClick,
}: {
  isPoppedOut: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className="w-[14px] h-[14px] flex items-center justify-center rounded-full bg-[#d4d0c7] hover:bg-[#bfbab0] border border-[#b8b2ab] transition-colors shrink-0"
      title={isPoppedOut ? "Close floating card" : "Pop out card"}
      aria-label={isPoppedOut ? "Close floating card" : "Pop out card"}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#57534e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-150 ${isPoppedOut ? "rotate-180" : ""}`}
      >
        <polyline points="6 15 12 9 18 15" />
      </svg>
    </button>
  );
}

/* ── EditableCard — RichTextField-bearing variant of Card ──────────── */

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

  onDelete?: () => void;
  /** Extra items rendered in the three-dot menu above MenuDelete. */
  menuExtras?: ReactNode;

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
  panelThemeKey?: string;

  // ── Opt-in layout features ──
  /** Render a 6-dot grip handle as the first header element.
   *  Only the grip is draggable; the card wrapper is NOT. */
  grabHandle?: boolean;
  /** Suppress the FormatToolbar in the RichTextField (keyboard shortcuts still work). */
  hideToolbar?: boolean;
  /** Show an [x] delete button in the header instead of the three-dot menu. */
  inlineDelete?: boolean;
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
 * Thin wrapper over {@link Card}: builds the header (badge + content +
 * toolbar portal slot) and the body (RichTextField), forwards focus state
 * to disable drag while editing, and delegates every other concern
 * (selection, delete, drag, theme, wrapper chrome) to the shell.
 */
export function EditableCard({
  id, selected, theme,
  badge, headerContent, headerTrailing, footer,
  onDelete, menuExtras,
  onClick, onDragStart, onTextDragStart,
  value, variant, placeholder, muted,
  onChange, onArchiveConsumed, getCitationDisplayText, onCitationCreated,
  dataAttr, extraDataAttrs, wrapperClassName, wrapperStyle, panelThemeKey,
  grabHandle, hideToolbar, inlineDelete, onBodyFocus, onEditorFocus, onHoverChange,
}: EditableCardProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);

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

  const hasContent = useCallback(() => {
    if (!value) return false;
    const walk = (node: any): boolean => {
      if (node.text && node.text.trim()) return true;
      if (node.content) return node.content.some(walk);
      return false;
    };
    return walk(value);
  }, [value]);

  const cardHeader = (
    <>
      {badge}
      {headerContent}
      {!hideToolbar && (
        <div ref={setToolbarTarget} className="flex items-center" />
      )}
      {!headerContent && !hideToolbar && <div className="flex-1" />}
    </>
  );

  const cardBody = (
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
  );

  return (
    <Card
      id={id}
      theme={theme}
      selected={selected}
      header={cardHeader}
      body={cardBody}
      footer={footer}
      headerTrailing={headerTrailing}
      onSelect={onClick}
      onDelete={onDelete}
      deleteAffordance={inlineDelete ? "inline" : "menu"}
      deleteConfirmWhen={hasContent}
      menuExtras={menuExtras}
      dragSource={onDragStart ? (grabHandle ? "handle" : "whole-card") : "none"}
      onDragStart={onDragStart}
      onTextDragStart={onTextDragStart}
      isFocused={isFocused}
      onHoverChange={onHoverChange}
      dataAttr={dataAttr}
      extraDataAttrs={extraDataAttrs}
      wrapperClassName={wrapperClassName}
      wrapperStyle={wrapperStyle}
      panelThemeKey={panelThemeKey}
    />
  );
}

/** Reusable class-string tokens. */
export const PANEL = {
  /** Scrollable list container wrapping all cards. */
  list: "flex-1 overflow-y-auto px-2 py-2 space-y-2",
  /** Inner padding for card content. */
  cardInner: "px-4 py-3 relative min-w-0",
  /** Expandable sub-pod with muted background (for fields, notes, etc.). */
  subpod: "rounded-md border border-edge-subtle bg-surface-muted/70 p-3 overflow-hidden",
  /** Sub-pod with white background (for rich-text editors, etc.). */
  subpodWhite: "rounded-md border border-edge-subtle bg-white overflow-hidden",
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

/* ── Panel chrome context (popout button) ─────────────────────────── */

/**
 * Context that lets PanelHeader render a pop-out / un-pop button without
 * threading props through every panel component. The EditorLayout wraps
 * each rendered panel with a provider that supplies the current popped-out
 * state for that panel's id.
 */
export interface PanelChromeValue {
  isPoppedOut: boolean;
  onTogglePopout: () => void;
}

const PanelChromeContext = createContext<PanelChromeValue | null>(null);

export function PanelChromeProvider({
  value,
  children,
}: {
  value: PanelChromeValue;
  children: ReactNode;
}) {
  return (
    <PanelChromeContext.Provider value={value}>
      {children}
    </PanelChromeContext.Provider>
  );
}

/**
 * Pop-out button bound to the surrounding PanelChromeProvider.
 * Renders nothing when there is no chrome (e.g. panel not popped-out aware).
 * Use this in custom panel headers that don't go through PanelHeader.
 */
export function PanelPopout() {
  const chrome = useContext(PanelChromeContext);
  if (!chrome) return null;
  return <PopoutButton isPoppedOut={chrome.isPoppedOut} onClick={chrome.onTogglePopout} />;
}

function PopoutButton({ isPoppedOut, onClick }: { isPoppedOut: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-[14px] h-[14px] -ml-2 mr-1.5 flex items-center justify-center rounded-full bg-[#d4d0c7] hover:bg-[#bfbab0] border border-[#b8b2ab] transition-colors shrink-0"
      title={isPoppedOut ? "Close floating panel" : "Pop out panel"}
      aria-label={isPoppedOut ? "Close floating panel" : "Pop out panel"}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#57534e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-150 ${isPoppedOut ? "rotate-180" : ""}`}
      >
        <polyline points="6 15 12 9 18 15" />
      </svg>
    </button>
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
  const chrome = useContext(PanelChromeContext);
  return (
    <div className={`${PANEL.header} flex items-center gap-1.5`}>
      {chrome && (
        <PopoutButton isPoppedOut={chrome.isPoppedOut} onClick={chrome.onTogglePopout} />
      )}
      <h3 className="text-sm font-semibold text-ink-body">
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
          className="w-6 h-6 flex items-center justify-center rounded-md text-ink-muted hover:text-blue-500 hover:bg-blue-50 transition-colors"
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
          className="w-6 h-6 flex items-center justify-center rounded-md text-ink-muted hover:text-sky-600 hover:bg-sky-50 transition-colors"
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

  const header = (
    <>
      <span
        className="inline-flex items-center justify-center w-5 h-5 shrink-0 text-sky-500"
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
      <span className="text-xs font-medium text-sky-800 truncate">AI {kindLabel} request</span>
      {request.status === "submitted" && (
        <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          Pending
        </span>
      )}
      <div className="flex-1" />
    </>
  );

  const body = (
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
      className="w-full resize-none bg-transparent text-xs text-ink-body placeholder:text-ink-muted focus:outline-none leading-snug font-serif"
      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
      rows={1}
    />
  );

  return (
    <Card
      id={request.id}
      theme={CARD_THEMES.aiRequest}
      selected={false}
      header={header}
      body={body}
      dragSource="whole-card"
      onDragStart={handleDragStart}
      onDelete={onDelete}
      deleteAffordance="inline"
      deleteConfirmWhen={() => draft.trim().length > 0}
      deleteConfirmMessage="This request has text. Discard it?"
      deleteConfirmLabel="Discard"
      extraDataAttrs={{ "data-ai-request-id": request.id }}
      bodyClassName="bg-sky-50/20 px-3 py-2"
    />
  );
}

/**
 * Header label for the "Pending AI requests" section that panels render
 * above their AiRequestCard list. Mirrors the bibliography precedent.
 */
export function AiRequestsSectionHeader({ count }: { count: number }) {
  return (
    <div className="text-[10px] font-medium text-ink-subtle uppercase tracking-wide px-2 mb-1.5 mt-2 pt-2 border-t border-edge-subtle">
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
        className="p-1 rounded text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong transition-colors"
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
          className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[100px]"
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
      className="w-full text-left px-3 py-1.5 text-xs text-danger hover:bg-danger-soft transition-colors"
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
      className={`p-1 rounded text-ink-subtle hover:text-ink-strong hover:bg-surface/60 transition-colors ${className ?? ""}`}
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
      className={`p-1 rounded text-ink-subtle hover:text-ink-strong hover:bg-surface/60 transition-colors ${className ?? ""}`}
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
