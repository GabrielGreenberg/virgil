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
 *  import { themedCard, CARD_THEMES, PANEL, Chevron, PanelHeader } from "./panel-primitives";
 *
 *  <div className={PANEL.list}>
 *    <div className={themedCard(CARD_THEMES.note, isSelected)}>
 *      <div className={PANEL.cardInner}>
 *        ...content...
 *        <div className={PANEL.subpod}>...expandable...</div>
 *      </div>
 *    </div>
 *  </div>
 */

import { type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes, forwardRef, useState, useRef, useEffect, useLayoutEffect, useCallback, createContext, useContext } from "react";
import type { JSONContent } from "@tiptap/react";
import type { AiRequest, AiRequestKind } from "@/lib/types";
import { useDragGap } from "@/hooks/useDragGap";
import { autoSizeInput } from "@/lib/autoSizeInput";
import ConfirmDialog from "./ConfirmDialog";
import RichTextField from "./RichTextField";
import { MIME_AI_REQUEST, MIME_TEXT_INSERT } from "@/lib/marginalia";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "./FloatingCards";
import { cardPopKey } from "@/panels/panel-registry";
import { themeFromAccent, DEFAULT_PANEL_COLORS, type CardTheme } from "@/lib/panel-theme";

/* ── Class-string constants ───────────────────────────────────────── */

const CARD_BASE =
  "rounded-lg border transition-colors overflow-hidden";
const CARD_DEFAULT =
  "bg-surface border-edge-hover hover:border-edge-strong hover:bg-surface-muted/50";

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

/** Re-export the canonical CardTheme shape from panel-theme. The interface
 *  lives there because it is fully derived from a single accent hex via
 *  `themeFromAccent`; this file just consumes it. */
export type { CardTheme } from "@/lib/panel-theme";

/** Returns the card wrapper class for a theme + selection state.
 *  Selected cards add `bg-surface`; the border color, ambient shadow,
 *  and selection halo all come from `themedCardStyle()` applied via
 *  inline style at the render site. Unselected cards share the neutral
 *  `CARD_DEFAULT` Tailwind hover behavior. */
export function themedCard(_theme: CardTheme, selected: boolean, extra?: string): string {
  return `${CARD_BASE} ${selected ? "bg-surface" : CARD_DEFAULT}${extra ? ` ${extra}` : ""}`;
}

/** Single source of truth for card-surface inline style: border color,
 *  ambient lift shadow, and selection halo. PanelCard, SearchPanel
 *  result rows, and any other card surface must call this so the
 *  selection visual stays uniform across kinds and contexts.
 *
 *  Selected cards get a 3px themed-color halo + soft glow on top of the
 *  ambient shadow. The halo uses the *original* accent hex (not the
 *  lightened `borderSelected`) so that amber/khaki/stone themes have
 *  enough chroma to read against the cream canvas — `borderSelected`
 *  is sized for contrast against the white card body, where it lives
 *  as the 1px border itself, but it washes out in the surround.
 *
 *  Pop-out cards get borderless treatment because FloatingPanel adds
 *  its own chrome. */
export function themedCardStyle(
  theme: CardTheme,
  selected: boolean,
  options?: { isPoppedOut?: boolean },
): React.CSSProperties {
  if (options?.isPoppedOut) {
    return { borderRadius: 0, borderWidth: 0 };
  }
  return {
    ...(selected ? { borderColor: theme.borderSelected } : {}),
    boxShadow: selected
      ? `var(--card-shadow-ambient), 0 0 0 3px color-mix(in oklab, ${theme.accent} 55%, transparent), 0 0 10px 0 color-mix(in oklab, ${theme.accent} 35%, transparent)`
      : "var(--card-shadow-ambient)",
  };
}

/** Pre-built themes for existing card types. Each theme is fully derived
 *  from one accent hex via `themeFromAccent`. User color overrides simply
 *  replace the accent and re-derive the rest — no more shadow `override`
 *  field. */
export const CARD_THEMES = {
  footnote:  themeFromAccent(DEFAULT_PANEL_COLORS.footnote),
  note:      themeFromAccent(DEFAULT_PANEL_COLORS.note),
  archive:   themeFromAccent(DEFAULT_PANEL_COLORS.archive),
  todo:      themeFromAccent(DEFAULT_PANEL_COLORS.todo),
  bib:       themeFromAccent(DEFAULT_PANEL_COLORS.bib),
  citation:  themeFromAccent(DEFAULT_PANEL_COLORS.citation),
  // Comments are revisions are the same thing — a single accent-purple
  // identity. CARD_THEMES.comment exists for legacy code paths that
  // referenced `comment`; the visual is the revision theme.
  comment:   themeFromAccent(DEFAULT_PANEL_COLORS.revision),
  // System-level kinds (not user-customizable): hardcoded accents so a
  // user-color override on (e.g.) the footnote panel does NOT also re-
  // tint error cards.
  aiRequest: themeFromAccent("#0ea5e9"),  // sky
  error:     themeFromAccent("#b45757"),  // rust (same family as footnote, decoupled)
  cut:       themeFromAccent(DEFAULT_PANEL_COLORS.cut),
  example:   themeFromAccent(DEFAULT_PANEL_COLORS.example),
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

const TITLE_CLASS = "min-w-0 max-w-full bg-transparent outline-none overflow-hidden text-ellipsis placeholder:text-ink-muted placeholder:font-normal";
const TITLE_STYLE: React.CSSProperties = {
  fontSize: "var(--par-title-size, 0.78rem)",
  color: "var(--par-title-color, #c45a5a)",
  fontWeight: 500,
  fontFamily: "var(--font-sans), Inter, sans-serif",
  letterSpacing: "0.02em",
};

/** Standard title input for card headers.
 *  Wraps the auto-sized input in a flex-1 container so trailing header items
 *  stay right-aligned and the empty space inside the wrapper remains
 *  grabbable for window dragging when the card is popped out. */
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
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!inputRef.current) return;
    return autoSizeInput(inputRef.current);
  }, []);
  return (
    <div className="flex-1 min-w-0 flex items-center">
      <input
        ref={inputRef}
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
    </div>
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
  /** Panel kind — drives per-panel body typography overrides. */
  panelKey?: import("@/lib/panel-typography").PanelBodyKey;
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
  /** Called when the RichTextField gains focus (e.g. for focus-to-select behaviour). */
  onBodyFocus?: () => void;
  /** Called with the Tiptap editor instance when RichTextField gains focus (for main toolbar routing). */
  onEditorFocus?: (editor: any) => void;
  /** Mouse-hover hook. Fires on mouseenter (true) and mouseleave (false). */
  onHoverChange?: (hovering: boolean) => void;
  /** When provided, renders a popout chevron at the left edge (after grabHandle). */
  onTogglePopout?: () => void;
  /** Whether this card is currently rendered in a floating window. */
  isPoppedOut?: boolean;
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
  value, variant, placeholder, muted, panelKey,
  onChange, onArchiveConsumed, getCitationDisplayText, onCitationCreated,
  dataAttr, extraDataAttrs, wrapperClassName, wrapperStyle,
  grabHandle, hideToolbar, inlineDelete, onBodyFocus, onEditorFocus, onHoverChange,
  onTogglePopout, isPoppedOut,
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
    <PanelCard
      ref={cardRef}
      {...dataAttrs}
      // Preference-mode annotation: the card's outer surface and border
      // come from the generic --surface / --border tokens, so a ctrl+click
      // on the card background edits every card in every panel. Per-panel
      // header colours are managed by panel-theme.ts / PanelThemePicker —
      // the header <div> below gets its own `data-panel-theme` annotation.
      data-prefs="surfaceColor,borderColor"
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onTogglePopout}
      onTrashClick={inlineDelete && onDelete ? tryDelete : undefined}
      extraCardClass={cursorClass}
      draggable={cardDraggable}
      onDragStart={!grabHandle ? onDragStart : undefined}
      tabIndex={selected ? 0 : -1}
      onKeyDown={handleKeyDown}
      onFocusCapture={() => { if (!selected && onClick) onClick(); }}
      className={`focus:outline-none${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      {/* Header — pr-7 reserves space for the absolute top-right popout overlay */}
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
      >
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
        {badge}
        {headerContent}
        {!hideToolbar && (
          <div ref={setToolbarTarget} className="flex items-center" />
        )}
        {!headerContent && !hideToolbar && <div className="flex-1" />}
        {headerTrailing}
        {showHeaderMenu && (
          <div
            draggable={false}
            onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            {menuContent ?? (onDelete ? (
              <ItemMenu><MenuDelete onClick={tryDelete} /></ItemMenu>
            ) : null)}
          </div>
        )}
      </div>

      {/* Separator */}
      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      {/* Body */}
      <div className={`relative px-3 pt-1.5 pb-2${onTextDragStart ? " flex items-start gap-1" : ""}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
        {/* Optional text-drag handle — drags only text content for inline insertion */}
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
            panelKey={panelKey}
          />
        </div>
      </div>

      {/* Optional footer (e.g. archive action buttons) */}
      {footer}

      {onDelete && (
        <ConfirmDialog
          open={confirmOpen}
          message="This item has text. Delete it?"
          confirmLabel="Delete"
          tone="danger"
          anchorRef={cardRef}
          onConfirm={() => { setConfirmOpen(false); onDelete(); }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </PanelCard>
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

/* ── Button primitive ──────────────────────────────────────────────
   Five variants, three sizes, codified per docs/virgil-design-system/
   07-buttons-and-inputs.md. Don't hand-roll filled buttons; pick a
   variant. There is no "blue button" in Virgil — `warm` replaces the
   bg-blue-100 / bg-emerald-600 patterns that used to scatter across
   modal footers and suggestion flows. */

export type ButtonVariant = "primary" | "secondary" | "warm" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:brightness-95",
  secondary:
    "bg-surface text-ink-body border border-edge-hover hover:bg-surface-muted-strong hover:border-edge-strong",
  warm:
    "bg-accent-light text-accent border border-[color-mix(in_oklab,var(--accent)_40%,transparent)] hover:brightness-95",
  danger:
    "bg-danger-soft text-danger border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] hover:bg-[color-mix(in_oklab,var(--danger)_10%,var(--danger-soft))]",
  ghost:
    "bg-transparent text-ink-subtle hover:bg-surface-muted-strong hover:text-ink-body",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-6 px-2.5 text-xs",
  md: "h-8 px-3 text-[13px]",
  lg: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Canonical Virgil button. Pick a variant. Don't mix Tailwind utilities
 *  to imitate one. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}${className ? ` ${className}` : ""}`}
    />
  );
});

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
  /** Side this panel is docked to (or floats from). Drives chevron direction. */
  side: "left" | "right";
  /** Close this panel: collapses the side, removes a split half, or closes the floater. */
  onClose: () => void;
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

/* ── Centralized popout button ─────────────────────────────────────
 * Single source of truth for the popout-button visual. Used by panel
 * headers, card chrome, and imperative consumers (paragraph node view
 * in the editor). Variants only differ in the popped-out glyph:
 *   - "arrow": rect + down-arrow (PanelPopout)
 *   - "x":     bare X glyph     (CardPopoutButton)
 */

export const POPOUT_BUTTON_CLASS = "iconbtn-sm";

export type PopoutVariant = "arrow" | "x";

function popoutSvgInner(isPoppedOut: boolean, variant: PopoutVariant): string {
  if (isPoppedOut && variant === "x") {
    return (
      '<line x1="6" y1="6" x2="18" y2="18" stroke-width="2.5" />' +
      '<line x1="18" y1="6" x2="6" y2="18" stroke-width="2.5" />'
    );
  }
  if (isPoppedOut) {
    return (
      '<rect x="2" y="2" width="20" height="20" rx="3" />' +
      '<line x1="12" y1="7" x2="12" y2="17" />' +
      '<polyline points="7 12 12 17 17 12" />'
    );
  }
  return (
    '<rect x="2" y="2" width="20" height="20" rx="3" />' +
    '<line x1="12" y1="17" x2="12" y2="7" />' +
    '<polyline points="7 12 12 7 17 12" />'
  );
}

function popoutSvgOuter(innerMarkup: string): string {
  return (
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    `stroke-linejoin="round">${innerMarkup}</svg>`
  );
}

/**
 * React popout button. Prop-driven so it works outside a chrome context.
 * Use `labelNoun` to customize the title/aria ("panel", "card",
 * "paragraph", …).
 */
export function PopoutButton({
  isPoppedOut,
  onClick,
  variant = "arrow",
  labelNoun = "panel",
  className,
}: {
  isPoppedOut: boolean;
  onClick: () => void;
  variant?: PopoutVariant;
  labelNoun?: string;
  className?: string;
}) {
  const title = isPoppedOut ? `Dock ${labelNoun}` : `Pop out ${labelNoun}`;
  // Fire on mousedown (with preventDefault) so the action runs BEFORE the
  // card's focus-driven selection logic — otherwise an unselected card eats
  // the first click as a "select" and the user has to click twice.
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      draggable={false}
      onDragStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      className={className ?? POPOUT_BUTTON_CLASS}
      title={title}
      aria-label={title}
      dangerouslySetInnerHTML={{
        __html: popoutSvgOuter(popoutSvgInner(isPoppedOut, variant)),
      }}
    />
  );
}

/**
 * DOM factory for imperative callers (e.g. ProseMirror node views). Same
 * visual as `PopoutButton` but returns a plain element so it can live
 * inside a non-React DOM tree.
 */
export function createPopoutButtonEl(opts: {
  isPoppedOut: boolean;
  onClick: () => void;
  variant?: PopoutVariant;
  labelNoun?: string;
  extraClass?: string;
}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.draggable = false;
  const variant = opts.variant ?? "arrow";
  const labelNoun = opts.labelNoun ?? "panel";
  const title = opts.isPoppedOut ? `Dock ${labelNoun}` : `Pop out ${labelNoun}`;
  btn.className = opts.extraClass
    ? `${POPOUT_BUTTON_CLASS} ${opts.extraClass}`
    : POPOUT_BUTTON_CLASS;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = popoutSvgOuter(popoutSvgInner(opts.isPoppedOut, variant));
  // Fire on mousedown (with preventDefault) so the action runs BEFORE the
  // host's focus-driven selection logic — otherwise an unselected card eats
  // the first click as a "select" and the user has to click twice.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick();
  });
  btn.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.preventDefault();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return btn;
}

/**
 * Pop-out button bound to the surrounding PanelChromeProvider. Renders a
 * rounded square with an arrow inside: up when docked (pops out) and down
 * when popped (re-docks to its origin). Renders nothing when there is no
 * chrome (e.g. panel not popped-out aware).
 */
export function PanelPopout() {
  const chrome = useContext(PanelChromeContext);
  if (!chrome) return null;
  return (
    <PopoutButton
      isPoppedOut={chrome.isPoppedOut}
      onClick={chrome.onTogglePopout}
      variant="arrow"
      labelNoun="panel"
    />
  );
}

/**
 * Close button bound to the surrounding PanelChromeProvider. Renders an X
 * and always closes the panel — collapses the column in single mode,
 * removes just the half in split mode, or closes the floater in pop-out
 * mode. Always the rightmost element of a panel header.
 */
export function PanelClose() {
  const chrome = useContext(PanelChromeContext);
  if (!chrome) return null;
  return (
    <button
      type="button"
      onClick={chrome.onClose}
      className="iconbtn-sm -mr-1"
      title="Close panel"
      aria-label="Close panel"
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
        <line x1="6" y1="6" x2="18" y2="18" />
        <line x1="18" y1="6" x2="6" y2="18" />
      </svg>
    </button>
  );
}

/**
 * Per-card popout toggle. Always rendered as the last element of the card
 * header (top-right). Styled identically to PanelPopout / PanelClose:
 * docked state shows a pod with an up arrow; popped state shows a bare X
 * glyph that re-docks the card.
 */
export function CardPopoutButton({
  isPoppedOut,
  onClick,
}: {
  isPoppedOut: boolean;
  onClick: () => void;
}) {
  return (
    <PopoutButton
      isPoppedOut={isPoppedOut}
      onClick={onClick}
      variant="x"
      labelNoun="card"
    />
  );
}

/**
 * Universal card-delete affordance. Absolute-positioned at the card's
 * bottom-right corner, hover-revealed, small and red. Requires the outer
 * card wrapper to be `position: relative`. Use from any card chrome that
 * wants the standard trash-icon delete, in tandem with `ConfirmDialog` if
 * the card body may contain content.
 */
export function CardTrashButton({
  onClick,
  title = "Delete",
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className="iconbtn-sm iconbtn-danger absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100 transition-opacity"
      title={title}
      aria-label={title}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  );
}

/**
 * Universal card wrapper. One source of truth for:
 *   - outer card div (`group relative`, themed border + selection state)
 *   - popped-out state (removes rounding/border, fills floating window)
 *   - top-right popout toggle (absolute overlay — reserve `pr-7` on the header)
 *   - bottom-right trash delete (absolute overlay)
 *
 * Every card chrome in the app should wrap its header/separator/body in a
 * `PanelCard`. Card-wide look-and-feel changes should land here, not in
 * individual panels.
 */
interface PanelCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "onClick"> {
  theme: CardTheme;
  selected: boolean;
  isPoppedOut?: boolean;
  onTogglePopout?: () => void;
  /** When provided, renders a bottom-right trash button that calls this. */
  onTrashClick?: () => void;
  /** Extra classes forwarded into `themedCard(theme, selected, extra)` — typically
   *  cursor / opacity modifiers like `"cursor-grab active:cursor-grabbing"` or
   *  `"opacity-60"`. */
  extraCardClass?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export const PanelCard = forwardRef<HTMLDivElement, PanelCardProps>(function PanelCard(
  {
    children,
    theme,
    selected,
    isPoppedOut,
    onTogglePopout,
    onTrashClick,
    extraCardClass,
    className,
    style,
    onClick,
    ...rest
  },
  ref,
) {
  // Measure the header (first child) so the absolute popout overlay centers
  // on whatever the header's actual height turns out to be — header content
  // varies per panel (inputs, avatars, chips, …) so a fixed `top` value
  // misaligns on some cards. The measured height is published as a CSS
  // variable on the card root; the popout uses `calc()` to self-center.
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const header = el.firstElementChild as HTMLElement | null;
    if (!header) return;
    const update = () => {
      el.style.setProperty("--pc-header-h", `${header.getBoundingClientRect().height}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [ref],
  );

  return (
    <div
      ref={setRefs}
      className={`group relative ${themedCard(theme, selected, extraCardClass)}${isPoppedOut ? " h-full flex flex-col" : ""}${className ? ` ${className}` : ""}`}
      style={{
        ...themedCardStyle(theme, selected, { isPoppedOut }),
        ...style,
      }}
      onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
      {...rest}
    >
      {children}
      {onTogglePopout && (
        <div
          className="absolute right-1.5 z-10"
          style={{ top: "calc(var(--pc-header-h, 32px) / 2 - 10px)" }}
        >
          <CardPopoutButton isPoppedOut={!!isPoppedOut} onClick={onTogglePopout} />
        </div>
      )}
      {onTrashClick && <CardTrashButton onClick={onTrashClick} />}
    </div>
  );
});

/* ── Panel header ─────────────────────────────────────────────────── */

export function PanelHeader({
  title,
  count,
  onAdd,
  onAiRequest,
  leading,
  titleAfter,
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
  /** Content rendered at the far left of the header, before the title.
   *  Typical use: the panel's three-dots options menu. */
  leading?: ReactNode;
  /** Content rendered immediately after the title (before add/AI buttons).
   *  Use for inline mode toggles that cluster with the title — e.g.
   *  Outline's Edit/Focus/Lock buttons. */
  titleAfter?: ReactNode;
  children?: ReactNode;
}) {
  const chrome = useContext(PanelChromeContext);
  return (
    <div className={`${PANEL.header} flex items-center gap-1.5`}>
      {leading}
      <h3 className={`panel-header-title text-sm font-semibold text-ink-body${leading ? " -ml-1" : ""}`}>
        {title}
        {count != null && count > 0 && (
          <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
            ({count})
          </span>
        )}
      </h3>
      {titleAfter}
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
          className={`w-6 h-6 flex items-center justify-center rounded-md text-ink-muted hover:text-sky-600 hover:bg-sky-50 transition-colors${onAdd ? " -ml-1" : ""}`}
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
      {chrome && <PanelPopout />}
      <PanelClose />
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
  onTogglePopout,
  isPoppedOut,
}: {
  request: AiRequest;
  onChangeText: (text: string) => void;
  onDelete: () => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}) {
  const [draft, setDraft] = useState(request.text);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const popped = usePoppedCards();
  const popKey = cardPopKey("ai", request.id);

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
  const theme = CARD_THEMES.aiRequest;

  const onToggleFromCtx = onTogglePopout ?? (popped ? () => popped.toggle(popKey) : undefined);

  const card = (
    <PanelCard
      data-ai-request-id={request.id}
      theme={theme}
      selected={false}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      extraCardClass="cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={handleDragStart}
    >
      {/* Header — pr-7 reserves space for the absolute top-right popout overlay */}
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: theme.headerDefault }}
      >
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
          className="text-ink-muted hover:text-ink-body shrink-0 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
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

      {/* Separator */}
      <div className="border-t border-sky-200/70" />

      {/* Body: auto-grow textarea */}
      <div className={`bg-sky-50/20 px-3 py-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
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
      </div>
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={popKey}>{card}</FloatCard>;
  return card;
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
  align = "right",
}: {
  children: ReactNode;
  /** Which edge of the button the dropdown aligns to. Use "left" for
   *  menu buttons near the left edge of a panel (dropdown drops right),
   *  "right" (default) for buttons near the right edge of a card. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });

  useEffect(() => {
    if (!open) return;
    // Position the fixed dropdown relative to the button
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos(
        align === "left"
          ? { top: r.bottom + 4, left: r.left }
          : { top: r.bottom + 4, right: window.innerWidth - r.right },
      );
    }
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, align]);

  // Panel-header menus sit at the far left and use a bare button (no
  // rounded lozenge / hover background) for a lighter-weight look.
  // Card-level menus keep the button-style treatment.
  const isPanelHeader = align === "left";
  return (
    <div className={`relative shrink-0${isPanelHeader ? " -ml-3" : ""}`}>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={
          isPanelHeader
            ? "p-0.5 text-ink-muted hover:text-ink-body transition-colors"
            : "iconbtn-md"
        }
        title="Options"
      >
        <svg width={isPanelHeader ? 14 : 16} height={isPanelHeader ? 14 : 16} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[9999] min-w-[100px]"
          style={{ top: pos.top, left: pos.left, right: pos.right }}
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
      className={`iconbtn-md iconbtn-on-dark ${className ?? ""}`}
      title={title}
    >
      <svg width="16" height="16" viewBox="-2 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      className={`iconbtn-md iconbtn-on-dark ${className ?? ""}`}
      title={title}
    >
      <svg width="16" height="16" viewBox="-2 0 26 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* Rounded pod/card outline (same bounding box as the file icon) */}
        <rect x="6" y="2" width="16" height="20" rx="3" ry="3" />
        {/* Arrow from left into center of pod */}
        <line x1="-2" y1="12" x2="14" y2="12" />
        <polyline points="11 9 14 12 11 15" />
      </svg>
    </button>
  );
}
