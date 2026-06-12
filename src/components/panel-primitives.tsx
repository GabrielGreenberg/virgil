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

import { type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes, forwardRef, useState, useRef, useEffect, useLayoutEffect, useCallback, useId, createContext, useContext, Children, cloneElement, isValidElement, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { AiRequest, AiRequestKind } from "@/lib/types";
import { useDragGap } from "@/hooks/useDragGap";
import { useTabIndent } from "@/hooks/useTabIndent";
import { autoSizeInput } from "@/lib/autoSizeInput";
import ConfirmDialog from "./ConfirmDialog";
import { hasJsonContent } from "@/cards/has-content";
import { isPoppable, hasCollabClaims, collabClaimScope } from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import RichTextField from "./RichTextField";
import { BorrowedMainText } from "./BorrowedMainText";
import { useEditorChrome } from "./editor-layout/chrome-context";
import PanelTextSizeRow from "./PanelTextSizeRow";
import { useEnclosingPanelBodyKey } from "./panel-kind-context";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftTarget, setCardLiftHandoff } from "./card-lift";
import { liftSpawnRect } from "@/floats/float-policy";
import { cardPopKey, cardTypeLabel } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import { useInOmni } from "./editor-layout/contexts/omni";
import { useCompressedLines } from "./editor-layout/contexts/card-display";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { themeFromAccent, DEFAULT_PANEL_COLORS, type CardTheme, type PanelThemeKey } from "@/lib/panel-theme";
import { useCardClaim, useCollabContext } from "@/hooks/useCollab";
import CollabClaimPill from "./CollabClaimPill";
import CollabPresenceDots from "./CollabPresenceDots";
import { omniPinStore } from "./editor-layout/omni-pin-store";

/* ── Per-card claim context ─────────────────────────────────────────
 *  EditableCard publishes its (panelKind, cardId) here so deeply-nested
 *  inputs (e.g. CardTitleInput rendered as `headerContent`) can attach
 *  their own focus/blur to the same claim without prop-drilling.
 */
export interface CardClaimSlot {
  /** Registry-derived collab claim scope (`collabClaimScope(kind)`, R28/D-2). */
  panelKind: PanelThemeKey | undefined;
  cardId: string | undefined;
  /** True when the partner has this card claimed. Title inputs go
   *  read-only / pointer-events:none when set. */
  partnerClaimed: boolean;
}
const CardClaimContext = createContext<CardClaimSlot | null>(null);
function useCardClaimSlot(): CardClaimSlot | null {
  return useContext(CardClaimContext);
}

/**
 * The ONE collab claim-pill / presence-dots trailing (R28/D-2). This
 * pill-or-dots core used to be authored three times — the float chrome
 * trailing, `EditableCard`'s docked trailing, and `CutterCommentCard`'s
 * hand-rolled copy — each with its own scope literal. Now the scope derives
 * from the registry (`collabClaimScope(kind)`), gated on the `collabClaims`
 * facet: a non-claim-bearing kind renders nothing.
 *
 * Morph note (deliberate non-fix): when a card morphs (e.g. report ↔
 * report-request, comment ↔ suggestion), there is NO claim remap. The scope
 * re-derives per render from the *current* kind — claim-bearing morph pairs
 * share a scope (pinned by `collab-claim-scope-contract.test.ts`), and a
 * morph into a non-claim kind simply stops rendering the pill; any stale
 * partner claim ages out via the existing heartbeat sweep.
 */
export function CollabCardTrailing({
  kind,
  cardId,
}: {
  kind: CardKind;
  cardId: string;
}) {
  const scope = hasCollabClaims(kind) ? collabClaimScope(kind) : undefined;
  const { partnerClaim } = useCardClaim(scope, cardId);
  const collabCtx = useCollabContext();
  const partnerSelections = scope
    ? collabCtx.getCardSelections(scope, cardId)
    : [];
  if (!scope) return null;
  return partnerClaim ? (
    <CollabClaimPill holder={partnerClaim.holder} color={partnerClaim.color} />
  ) : (
    <CollabPresenceDots presences={partnerSelections} />
  );
}

/**
 * The card-domain trailing node for a popped-out card's `FloatChrome` slot.
 * Built by the `cardFloatable` shell (`src/cards/floats/index.tsx`) for every
 * claim-bearing kind and handed to `FloatChrome` as `chromeSlots.trailing`;
 * since it's a React element (not a hook call in the factory), React runs its
 * hooks when FloatChrome renders it. Hosts its own `CardClaimContext.Provider`
 * so the collab claim survives the relocated mount (FloatChrome stays
 * domain-neutral and renders it blindly).
 *
 * Kind-driven (R28/D-2): the claim scope derives from the registry via
 * `collabClaimScope(kind)`, gated on `collabClaims` — no per-site literals.
 * Renders the per-card slot first (status dot / checkbox), then the shared
 * `CollabCardTrailing` — mirroring `EditableCard`'s docked trailing.
 */
export function CardChromeTrailing({
  kind,
  cardId,
  headerTrailing,
}: {
  kind: CardKind;
  cardId: string;
  headerTrailing?: ReactNode;
}) {
  const scope = hasCollabClaims(kind) ? collabClaimScope(kind) : undefined;
  const { partnerClaim } = useCardClaim(scope, cardId);
  return (
    <CardClaimContext.Provider
      value={{ panelKind: scope, cardId, partnerClaimed: !!partnerClaim }}
    >
      {headerTrailing}
      <CollabCardTrailing kind={kind} cardId={cardId} />
    </CardClaimContext.Provider>
  );
}

/* ── Compressed-body helpers ──────────────────────────────────────
 *  Cards render the same "header + N-line summary" shape when collapsed
 *  across many panels. These helpers centralise the CSS clamp and the
 *  plain-text summary builder so every site honours `useCompressedLines()`
 *  uniformly. N=1 is the legacy single-line ellipsized behaviour. */

export function compressedBodyStyle(
  lines: number,
  opts?: { lineHeight?: number },
): React.CSSProperties {
  const n = Math.max(1, lines);
  const lh = opts?.lineHeight ?? 1.4;
  return {
    display: "-webkit-box",
    WebkitLineClamp: n,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    overflowWrap: "anywhere",
    lineHeight: lh,
    // Hard ceiling on content height so any ascender bleed from the
    // clamped next line gets clipped, not shown. box-sizing:content-box
    // makes maxHeight apply to the content area only, so the wrapping
    // div's padding lives outside the ceiling and isn't squeezed.
    maxHeight: `calc(${lh}em * ${n})`,
    boxSizing: "content-box",
  };
}

export function makeCompressedSummary(content: JSONContent | unknown, lines: number): string {
  const text = richJsonToPlainText(content).replace(/\s+/g, " ").trim();
  return text.slice(0, 80 * Math.max(1, lines));
}

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

/** Pre-built themes for existing card types — one per `PanelThemeKey`, each
 *  fully derived from its `DEFAULT_PANEL_COLORS` accent hex via
 *  `themeFromAccent`. The two keyspaces are IDENTICAL post-A10/B (the legacy
 *  `comment` alias for the revision identity is gone), so the whole table is
 *  a mechanical fold over the color registry. User color overrides simply
 *  replace the accent and re-derive the rest — no more shadow `override`
 *  field.
 *
 *  Shared identities worth knowing (one theme, several card kinds):
 *  - `revision` colors both revision kinds (comments ≡ revisions, one
 *    accent-purple identity);
 *  - `cut` colors both Cutter kinds; `report` colors report +
 *    report-request — each polymorphic panel reads as a single themed
 *    surface;
 *  - `highlight` is distinct from `note` so highlights read as their own
 *    amber identity inside the Notes panel;
 *  - `aiRequest` (sky) / `error` (rust) are system accents:
 *    `SYSTEM_THEME_KEYS` marks them non-overridable, so a user-color
 *    override on (e.g.) the footnote panel can NOT re-tint them. */
export const CARD_THEMES: Record<PanelThemeKey, CardTheme> = Object.fromEntries(
  (Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]).map((key) => [
    key,
    themeFromAccent(DEFAULT_PANEL_COLORS[key]),
  ]),
) as Record<PanelThemeKey, CardTheme>;

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

/** Tiny header label for an anchored card: "selection · 14 words" or
 *  "paragraph · 47 words". Returns null when the summary is null so callers
 *  can drop it inline without conditionals. */
export function AnchorBadge({
  summary,
}: {
  summary:
    | { kind: "selection"; words: number }
    | { kind: "paragraph"; words: number }
    | null;
}) {
  if (!summary) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted)] tabular-nums shrink-0">
      <span>{summary.kind}</span>
      <span aria-hidden="true">·</span>
      <span>
        {summary.words} {summary.words === 1 ? "word" : "words"}
      </span>
    </span>
  );
}

/** Orphaned/unanchored badge — local color square with diagonal cross, faded. */
export function BadgeOrphaned({ theme }: { theme: CardTheme }) {
  return (
    <span
      className={`relative ${BADGE_BASE} opacity-60`}
      style={{ background: theme.badgeBg, border: `1.5px solid ${theme.badgeBorder}` }}
      data-hint="No anchor in document" aria-label="No anchor in document"
    >
      <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 20 20" fill="none" preserveAspectRatio="none">
        <line x1="4" y1="16" x2="16" y2="4" stroke={theme.badgeColor} strokeWidth="2" />
      </svg>
    </span>
  );
}

/** Small uppercase overline naming the card type ("Citation", "Footnote", …).
 *  Used by `CardKindHeader` (unified card chrome) as the single-kind case.
 *  Matches the style first introduced on Comment cards. */
export function CardTypeLabel({
  kind,
  labelOverride,
  className,
}: {
  kind: CardKind;
  labelOverride?: string;
  className?: string;
}) {
  return (
    <span
      className={`text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium${className ? ` ${className}` : ""}`}
    >
      {labelOverride ?? cardTypeLabel(kind)}
    </span>
  );
}

/** A9 §C3: the single empty-body placeholder for a compressed / empty card.
 *  Replaces the ~5 hand-rolled `<span className="text-ink-faint italic">empty
 *  …</span>` literals scattered across the cards (which had drifted between
 *  `text-ink-faint` and `text-ink-muted`). One style, optional label. */
export function CardEmptyText({ label = "empty" }: { label?: string }) {
  return <span className="text-ink-faint italic">{label}</span>;
}

/* ── Unified card-chrome header components ────────────────────────── */

/** Kind label / kind dropdown for the unified card header.
 *  When `options` has more than one entry and `onChange` is given,
 *  renders a clickable dropdown with a chevron-down; otherwise renders
 *  the bare label. Single source of truth for the card-kind affordance
 *  in card headers (cutter/revision panels override with `options`). */
export function CardKindHeader({
  kind,
  labelOverride,
  options,
  onChange,
}: {
  kind: CardKind;
  labelOverride?: string;
  options?: CardKind[];
  onChange?: (k: CardKind) => void;
}) {
  if (!options || options.length <= 1 || !onChange) {
    return <CardTypeLabel kind={kind} labelOverride={labelOverride} />;
  }
  return (
    <CardKindDropdown
      kind={kind}
      labelOverride={labelOverride}
      options={options}
      onChange={onChange}
    />
  );
}

function CardKindDropdown({
  kind,
  labelOverride,
  options,
  onChange,
}: {
  kind: CardKind;
  labelOverride?: string;
  options: CardKind[];
  onChange: (k: CardKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (
        menuRef.current?.contains(e.target as Node) ||
        buttonRef.current?.contains(e.target as Node)
      ) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);
  return (
    <span className="relative inline-flex items-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        className="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium hover:text-ink-body transition-colors cursor-pointer bg-transparent p-0"
        data-hint="Change card type" aria-label="Change card type"
      >
        {labelOverride ?? cardTypeLabel(kind)}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute top-full left-0 mt-1 z-50 bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 min-w-[120px]"
        >
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                if (opt !== kind) onChange(opt);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={`w-full text-left text-[11px] uppercase tracking-wider px-3 py-1 hover:bg-surface-muted-strong transition-colors ${opt === kind ? "text-ink-body font-medium" : "text-[var(--muted)]"}`}
            >
              {cardTypeLabel(opt)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/** Rightward chevron jump-to-source button. Renders in the card header
 *  only when the card is popped out (matches the popped-text UX in
 *  every TextObject float body — paragraph, heading, list, etc.). */
export function CardJumpChevron({
  onClick,
  title = "Jump to source",
}: {
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body transition-colors bg-transparent p-0 shrink-0"
      data-hint={title}
      aria-label={title}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </button>
  );
}

/** In-body title field, modeled after the paragraph +T affordance.
 *  When no title is set, shows a hover-revealed "+T" button.
 *  When a title is set (or being edited), renders an inline editable
 *  input. CSS mirrors the .par-title-* conventions so card titles read
 *  identically to paragraph titles. */
export function CardBodyTitle({
  value,
  onChange,
  placeholder = "Title",
  theme,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  theme?: CardTheme;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasTitle = !!value?.trim();

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const style: React.CSSProperties | undefined = theme
    ? { color: theme.titleColor, borderBottomColor: theme.titleColor }
    : undefined;

  if (hasTitle || editing) {
    return (
      <div className="card-title-wrapper">
        <input
          ref={inputRef}
          type="text"
          defaultValue={value ?? ""}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = e.target.value;
            if (v !== (value ?? "")) onChange(v);
            if (!v.trim()) setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              e.preventDefault();
              (e.target as HTMLInputElement).value = value ?? "";
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          draggable={false}
          onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
          className="card-title-input"
          style={style}
        />
      </div>
    );
  }
  return (
    <div className="card-title-wrapper card-title-add-only">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        className="card-title-add"
        style={theme ? { color: theme.titleColor } : undefined}
        data-hint="Add title"
        data-hint-pos="above"
      >
        +T
      </button>
    </div>
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

/** Canonical card-title inline style — the TITLE dialect (the `.par-title-*`
 *  tokens, themed via `theme.titleColor`). Design-system-fixed: the per-panel
 *  font picker (`usePanelBodyStyle`) styles BODY CONTENT ONLY and must never
 *  be spread over a title/header line (ratified 2026-06-12). Consumed by
 *  `CardTitleInput` and the bespoke title/header lines (citation collapsed
 *  header, bib header). */
export function cardTitleStyle(theme?: CardTheme): React.CSSProperties {
  return theme ? { ...TITLE_STYLE, color: theme.titleColor } : { ...TITLE_STYLE };
}

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
  // If rendered inside an EditableCard, hook into that card's claim slot
  // so title edits also assert ownership and the input goes read-only
  // when the partner has the card claimed.
  const slot = useCardClaimSlot();
  const { claim, release } = useCardClaim(slot?.panelKind, slot?.cardId);
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
        onFocus={() => claim()}
        onBlur={(e) => {
          release();
          if (onChange) onChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        draggable={false}
        readOnly={!!slot?.partnerClaimed}
        onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        placeholder={placeholder}
        className={TITLE_CLASS}
        style={
          slot?.partnerClaimed
            ? { ...merged, opacity: 0.55, pointerEvents: "none" }
            : merged
        }
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

  /** Footnote-only: small letter/number badge at the left of the header.
   *  All other cards pass `undefined` — badges were unified out in the
   *  card-chrome redesign. */
  footnoteBadge?: ReactNode;
  /** Narrow slot between kind label and jump/X chrome (status dot, AI
   *  checkbox, partner-claim pill). Avoid free-form layouts here. */
  headerTrailing?: ReactNode;
  /** Optional in-body title shown above the rich-text editor. When set,
   *  renders a +T affordance via `CardBodyTitle`. */
  bodyTitle?: string | undefined;
  onBodyTitleChange?: (v: string) => void;
  /** Extra content below the RichTextField body (e.g. action buttons). */
  footer?: ReactNode;

  /** Menu items inside ItemMenu. Falls back to MenuDelete when onDelete is provided. */
  menuContent?: ReactNode;
  onDelete?: () => void;

  onClick?: (e?: React.MouseEvent) => void;
  /** When provided, the card is draggable (disabled while RichTextField is focused). */
  onDragStart?: (e: React.DragEvent) => void;

  // ── RichTextField props ──
  value: unknown;
  variant?: "footnote" | "note";
  /** Panel kind — drives per-panel body typography overrides ONLY. The
   *  collab claim scope is registry-derived from `kind` (R28/D-2), so this
   *  carries no collab duty. */
  panelKey?: import("@/lib/panel-typography").PanelBodyKey;
  /** Card kind for chrome-driven read-only mode. When set and the
   *  current chrome's `editableCardKinds` whitelist excludes this kind,
   *  the inner RichTextField mounts read-only. Reader's
   *  `editableCardKinds: ["note"]` means everything except note cards
   *  is read-only. Omit to keep the previous always-editable behavior. */
  cardKind?: CardKind;
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
  /** When provided, renders a popout chevron at the left edge (after the grip). */
  onTogglePopout?: (anchor: DOMRect) => void;
  /** Whether this card is currently rendered in a floating window. */
  isPoppedOut?: boolean;
  /** Card identity for the lift-off drag gesture (header-drag → popout).
   *  Forwarded to `PanelCard`. Same `${kind}:${id}` shape used by
   *  `usePoppedCards.toggleAtAnchor`. */
  cardKey?: string;

  /** When true, replace the rich-text body with the `compressedSummary`
   *  one-liner. Driven by `!expanded && !isPoppedOut` at the consumer (N1:
   *  expansion is its own axis — `useAnchoredCard().expanded` — independent of
   *  selection). The header expand chevron toggles it; a body click composes
   *  select+expand via `onActivate`. */
  compressed?: boolean;
  /** One-line summary rendered in place of the rich body when compressed.
   *  Required if compressed is ever true (sans-class fallback / when no
   *  `compressedContent` is given). */
  compressedSummary?: ReactNode;
  /** A9 §C3: the card's resolved JSONContent body. For a `"borrowed"`-class
   *  kind (footnote/archive/example — they quote document prose) the compressed
   *  view renders this via `BorrowedMainText` clipped to `compressedLines`, so
   *  collapsed cards show real inline atoms (citation / \ref / inline math)
   *  instead of a flattened summary string. Ignored for `"sans"`-class kinds
   *  (they keep `compressedSummary`). */
  compressedContent?: unknown;
  /** Axis-pure expand toggle, forwarded straight to `PanelCard.onToggleExpanded`
   *  (the toggle-only fallback for the header click). Pass
   *  `useAnchoredCard().onToggleExpanded`. */
  onToggleExpanded?: () => void;
  /** Header-click composition (select + toggle expansion, no jump), forwarded
   *  straight to `PanelCard.onHeaderActivate`. Pass
   *  `useAnchoredCard().onHeaderActivate` (or a host-local equivalent). */
  onHeaderActivate?: () => void;
  /** Card kind for the unified header kind-label. Required for the new
   *  card chrome — every card declares its kind so the header renders a
   *  consistent label. Cards with multi-kind panels can also pass
   *  `kindOptions` + `onKindChange` for a dropdown. */
  kind: CardKind;
  /** Override for the kind label text (e.g. "Acknowledgement" for
   *  `\thanks` footnotes). */
  kindLabelOverride?: string;
  kindOptions?: CardKind[];
  onKindChange?: (k: CardKind) => void;
  /** When the card is popped out, show a chevron-right jump-to-source
   *  button immediately left of the close X. Docked cards never show
   *  the jump button (matches the popped-text UX). */
  canJump?: boolean;
  onJump?: (e: React.MouseEvent) => void;
  /** Forwarded to PanelCard: when popped, suppress the in-card header so the
   *  AF `FloatChrome` window header owns it. Only set true together with
   *  `isPoppedOut`. */
  chromeless?: boolean;
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
  footnoteBadge, headerTrailing, bodyTitle, onBodyTitleChange, footer,
  menuContent, onDelete,
  onClick, onDragStart,
  value, variant, placeholder, muted, panelKey, cardKind,
  onChange, onArchiveConsumed, getCitationDisplayText, onCitationCreated,
  dataAttr, extraDataAttrs, wrapperClassName, wrapperStyle,
  hideToolbar, inlineDelete, onBodyFocus, onEditorFocus, onHoverChange,
  onTogglePopout, isPoppedOut, cardKey,
  compressed, compressedSummary, compressedContent, onToggleExpanded, onHeaderActivate,
  kind, kindLabelOverride, kindOptions, onKindChange,
  canJump, onJump, chromeless,
}: EditableCardProps) {
  // Chrome-driven read-only mode: when the host has set
  // `editableCardKinds` and this card's kind isn't on the list, the
  // inner RichTextField mounts read-only. Omitted whitelist or
  // omitted `cardKind` falls back to fully editable (existing main-app
  // behavior).
  const chrome = useEditorChrome();
  const cardEditable = !cardKind ||
    !chrome.editableCardKinds ||
    chrome.editableCardKinds.includes(cardKind);
  const compressedLines = useCompressedLines();
  const compressedBody = usePanelBodyStyle(panelKey);
  // A9 §C3: a "borrowed"-class kind (footnote/archive/example) with a resolved
  // body renders its compressed view via BorrowedMainText (real inline atoms),
  // clipped to compressedLines. Sans-class kinds keep the summary string.
  const useBorrowedCompressed =
    !!cardKind &&
    CARD_REGISTRY[cardKind].bodyClass === "borrowed" &&
    compressedContent != null;
  const [isFocused, setIsFocused] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Set during a mouse press on the card so onFocusCapture can tell
  // pointer-driven focus (which the upcoming click will toggle) from
  // keyboard / programmatic focus (which should auto-select). Without
  // this, mousedown focuses the card → onFocusCapture toggles selection
  // on, then click toggles it back off — flickering the card on header
  // clicks where the DOM doesn't re-target between mousedown and click.
  const isPointerInteractingRef = useRef(false);

  // Collab focus claim: when the partner has this card focused, dim it
  // and surface a "Sam · 12s" pill in the header. When we focus, write
  // our own claim; on blur, release. The claim scope is REGISTRY-DERIVED
  // from the required `kind` prop (R28/D-2) and gated on the `collabClaims`
  // facet — `panelKey` is typography-only and carries no collab duty.
  const collabScope = hasCollabClaims(kind) ? collabClaimScope(kind) : undefined;
  const { partnerClaim, claim: claimCard, release: releaseClaim } = useCardClaim(collabScope, id);

  /** Check whether the value has any visible text content. Delegates to
   *  the shared `hasJsonContent` helper so the same predicate drives both
   *  this trash-button flow and `deleteMarginItem`'s confirm decision. */
  const hasContent = useCallback(() => hasJsonContent(value), [value]);

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
        claimCard();
        onBodyFocus?.();
        if (editor) onEditorFocus?.(editor);
      } else {
        releaseClaim();
      }
    },
    [onBodyFocus, onEditorFocus, claimCard, releaseClaim],
  );

  // The card root is HTML5-draggable for cross-editor anchor drags
  // (Citation, Bib, AiRequest etc. set `onDragStart` for that purpose).
  // The grip + header lift-to-popout gesture is pointer-driven and lives
  // on PanelCard's onWrapperMouseDown — the two coexist via the lift's
  // `dragstart` suppression for the duration of a press.
  const cardDraggable = onDragStart ? !isFocused : false;
  const cursorClass = isFocused
    ? "cursor-default"
    : (onDragStart ? "cursor-grab active:cursor-grabbing" : "");

  const dataAttrs: Record<string, string> = {
    ...(dataAttr ? { [`data-${dataAttr.name}`]: dataAttr.value } : {}),
    ...(extraDataAttrs || {}),
  };

  // Whether to render the three-dot menu in the header (skip when inlineDelete is on)
  const showHeaderMenu = !inlineDelete;

  /** Trailing chrome assembled from the per-card slot + collab indicators
   *  + optional three-dot menu. PanelCard renders this into the unified
   *  header between the kind label and the jump/X chrome. */
  const trailing = (
    <>
      {headerTrailing}
      <CollabCardTrailing kind={kind} cardId={id} />
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
    </>
  );

  return (
    <CardClaimContext.Provider
      value={{ panelKind: collabScope, cardId: id, partnerClaimed: !!partnerClaim }}
    >
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
      cardKey={cardKey}
      isCollapsed={!!compressed}
      onToggleExpanded={onToggleExpanded}
      onHeaderActivate={onHeaderActivate}
      onTrashClick={inlineDelete && onDelete ? tryDelete : undefined}
      extraCardClass={cursorClass}
      draggable={cardDraggable}
      onDragStart={onDragStart}
      tabIndex={selected ? 0 : -1}
      onKeyDown={handleKeyDown}
      kind={kind}
      kindLabelOverride={kindLabelOverride}
      kindOptions={kindOptions}
      onKindChange={onKindChange}
      footnoteBadge={footnoteBadge}
      headerTrailing={trailing}
      canJump={canJump}
      onJump={onJump}
      chromeless={chromeless}
      onMouseDown={() => {
        isPointerInteractingRef.current = true;
        requestAnimationFrame(() => {
          isPointerInteractingRef.current = false;
        });
      }}
      onFocusCapture={(e) => {
        if (isPointerInteractingRef.current) return;
        // The unified header is its own keyboard target (click/Enter/Space =
        // toggle+select, never jump) — Tab landing on it must not auto-fire
        // the body composition (which jumps the editor to the anchor).
        if ((e.target as HTMLElement).closest?.("[data-card-header]")) return;
        if (!selected && onClick) onClick();
      }}
      className={`focus:outline-none${wrapperClassName ? ` ${wrapperClassName}` : ""}`}
      style={wrapperStyle}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      {/* Body. When the partner has claimed this card, dim it and gate
          pointer events so the user can't accidentally focus into it.
          When compressed, render a one-line summary in place of the
          rich-text editor; clicking the card expands it via onClick. */}
      {compressed ? (
        <div
          className="px-3 pt-1.5 pb-1.5 text-ink-subtle cursor-pointer"
          style={
            partnerClaim
              ? { opacity: 0.55, pointerEvents: "none", filter: "saturate(0.7)" }
              : undefined
          }
        >
          {/* Backlog #15: a collapsed card keeps its title visible. Static
              (read-only) title row in the card-title dialect — OUTSIDE the
              clamped summary div so the panel-body style spread and the
              line-clamp can't clobber it. Titleless collapsed cards render
              no title row at all (and no +T — that's expanded-only). */}
          {bodyTitle?.trim() ? (
            <div
              className="card-title-collapsed"
              style={theme ? { color: theme.titleColor } : undefined}
            >
              {bodyTitle}
            </div>
          ) : null}
          <div style={{ ...compressedBody, ...compressedBodyStyle(compressedLines) }}>
            {useBorrowedCompressed ? (
              <BorrowedMainText
                value={compressedContent}
                instanceKey={`compressed:${cardKind}:${id}`}
                variant="footnote"
                bodyStyle={compressedBody}
              />
            ) : (
              compressedSummary ?? <CardEmptyText />
            )}
          </div>
        </div>
      ) : (
      <div
        className={`relative px-3 pt-1.5 pb-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : " overflow-y-auto"}`}
        style={{
          ...(isPoppedOut
            ? null
            : { maxHeight: "max(0px, calc(var(--dock-slot-frame-h, 80vh) - 160px))" }),
          ...(partnerClaim
            ? { opacity: 0.55, pointerEvents: "none", filter: "saturate(0.7)" }
            : null),
        }}
        data-hint={partnerClaim ? `${partnerClaim.holder} is editing this card` : undefined} aria-label={partnerClaim ? `${partnerClaim.holder} is editing this card` : undefined}
      >
        {onBodyTitleChange && (
          <CardBodyTitle
            value={bodyTitle}
            onChange={onBodyTitleChange}
            theme={theme}
          />
        )}
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
          hideToolbar={hideToolbar || !cardEditable}
          panelKey={panelKey}
          editable={cardEditable}
        />
      </div>
      )}

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
    </CardClaimContext.Provider>
  );
}

/* ── AiRequestCheckbox — centralized "AI request" checkbox ──────────
 * Single source of truth for the per-card "AI request" toggle. Used by
 * NoteCard, TodoRow, CutterCommentCard, RevisionCommentCard. Update the
 * markup or styling here to change every consumer at once. */
export function AiRequestCheckbox({
  checked,
  onToggle,
  className,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  /** Optional extra classes (e.g. spacing) for consumer-specific layout. */
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(!checked);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={`flex items-center gap-1.5 text-[11px] text-ink-subtle cursor-pointer select-none bg-transparent p-0${className ? ` ${className}` : ""}`}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" fill="none" />
        {checked && (
          <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#0369a1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        )}
      </svg>
      AI request
    </button>
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
  /** True when this panel is rendered as a floating window. In the
   *  always-float model this is always true for non-omni panels. */
  isPoppedOut: boolean;
  /** Side this panel is docked to (or floats from). Drives chevron direction. */
  side: "left" | "right";
  /** Close this panel: removes it from the floating panel list. */
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
 * Walk up from a click target to find the docked panel/card container so
 * the popout's spawn position can be biased relative to the docked element
 * (rather than the small button itself). Falls back to the button's own
 * bounding rect when no container ancestor is found.
 */
function popoutAnchorRect(target: HTMLElement): DOMRect {
  const container = target.closest<HTMLElement>(
    "[data-card-key], [data-panel-id]",
  );
  return (container ?? target).getBoundingClientRect();
}

/**
 * React popout button. Prop-driven so it works outside a chrome context.
 * Use `labelNoun` to customize the title/aria ("panel", "card",
 * "paragraph", …).
 *
 * `onClick` receives the docked container's bounding rect (or, as fallback,
 * the button's own rect) so callers can spawn the floating popup near the
 * docked element it came from.
 */
export function PopoutButton({
  isPoppedOut,
  onClick,
  variant = "arrow",
  labelNoun = "panel",
  className,
}: {
  isPoppedOut: boolean;
  onClick: (anchor: DOMRect) => void;
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
        onClick(popoutAnchorRect(e.currentTarget));
      }}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      draggable={false}
      onDragStart={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      className={className ?? POPOUT_BUTTON_CLASS}
      aria-label={title}
      data-hint={isPoppedOut ? "Dock" : "Pop out"}
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
  onClick: (anchor: DOMRect) => void;
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
  btn.setAttribute("data-helper", opts.isPoppedOut ? "Dock" : "Pop out");
  btn.innerHTML = popoutSvgOuter(popoutSvgInner(opts.isPoppedOut, variant));
  // Fire on mousedown (with preventDefault) so the action runs BEFORE the
  // host's focus-driven selection logic — otherwise an unselected card eats
  // the first click as a "select" and the user has to click twice.
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onClick(popoutAnchorRect(btn));
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
 * Pop-out button bound to the panel chrome — retained as a no-op so
 * existing render trees continue to compile. In the always-float model
 * panels are always floating, so the button has nothing to do; leaving
 * it as `null` keeps the header layout stable.
 */
export function PanelPopout() {
  return null;
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
      aria-label="Close panel"
      data-hint="Close panel"
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
 * Universal card grip — leftmost element of every card header.
 *
 * Pure visual: not draggable, no event handlers. The lift-to-popout
 * gesture lives on the wrapping header (see `PanelCard.onWrapperMouseDown`),
 * which adds `.is-pressed` to this element on mousedown so the grip
 * "squeezes" regardless of where in the header the press lands.
 */
export function CardDragHandle() {
  return (
    <div
      className="card-drag-handle cursor-grab active:cursor-grabbing p-0.5 -ml-1 rounded text-ink-faint group-hover:text-ink-subtle transition-colors shrink-0"
      data-hint="Drag to pop out"
      data-hint-pos="above"
      aria-hidden="true"
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
  onClick: (anchor: DOMRect) => void;
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
      aria-label={title}
      data-hint="Delete"
      data-hint-pos="above"
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
  onTogglePopout?: (anchor: DOMRect) => void;
  /** When provided, renders a bottom-right trash button that calls this. */
  onTrashClick?: () => void;
  /** Extra classes forwarded into `themedCard(theme, selected, extra)` — typically
   *  cursor / opacity modifiers like `"cursor-grab active:cursor-grabbing"` or
   *  `"opacity-60"`. */
  extraCardClass?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** Card identity for the lift-off drag handoff. When set together
   *  with `onTogglePopout`, mousedown on the card's header element
   *  becomes a drag-to-popout gesture. */
  cardKey?: string;
  /** When true, the card is in its collapsed/minimized (compressed) form. Docked,
   *  this equals `!expanded`. It no longer gates the lift-off drag — lift works
   *  in both states now (`onWrapperMouseDown`) — it only suppresses the
   *  bottom-right trash button and drives the docked expand chevron's rotation. */
  isCollapsed?: boolean;
  /** Axis-pure expand toggle (from `useAnchoredCard.onToggleExpanded`). When
   *  provided AND docked, a click on the unified header toggles the body
   *  without touching selection (used as the fallback when no
   *  `onHeaderActivate` is threaded). PanelCard stays store-agnostic: it
   *  never reads the card store, only invokes this. */
  onToggleExpanded?: () => void;
  /** The ratified header-click composition (from
   *  `useAnchoredCard.onHeaderActivate`, or a host-local equivalent like the
   *  Errors panel's): SELECT the card + TOGGLE its expansion — never jump.
   *  When provided (or `onToggleExpanded` as toggle-only fallback) AND
   *  docked, the unified header becomes a keyboard-reachable disclosure
   *  trigger: click / Enter / Space fire this. Clicks consumed by
   *  interactive header children (kind dropdown, title input, ItemMenu,
   *  trailing controls) never reach it — they stopPropagation. */
  onHeaderActivate?: () => void;
  /** Default true. Pass false when the threaded `onHeaderActivate` is NOT a
   *  disclosure toggle (e.g. a draft citation's select-only header, whose
   *  body is pinned open): the header keeps role=button + keyboard
   *  activation but drops `aria-expanded`/`aria-controls` and is labeled
   *  "Select card" — assistive tech must not be promised a collapse that
   *  never happens. */
  headerDisclosure?: boolean;

  /* ── Unified header chrome ───────────────────────────────────────
   * When `kind` is provided, PanelCard renders its own unified header
   * (drag handle + optional badge + kind label/dropdown + spacer +
   * trailing slot + jump chevron when popped + popout/X). Cards that
   * pass `kind` MUST NOT include their own `<header>` div as the first
   * child — `children` becomes pure body content + separator handling.
   *
   * When `kind` is omitted, PanelCard falls back to the legacy
   * children-render-all layout (first child = header, etc.). All cards
   * should migrate to the unified header.
   */
  kind?: CardKind;
  /** Override for the kind label text (e.g. "Acknowledgement" for `\thanks` footnotes). */
  kindLabelOverride?: string;
  /** When set with `onKindChange`, the kind label becomes a chevron-down
   *  dropdown for switching card kinds in-place. Used by panels that host
   *  multiple kinds (Cutter, Revisions). */
  kindOptions?: CardKind[];
  onKindChange?: (k: CardKind) => void;
  /** Footnote-only: small letter/number badge at the left of the header.
   *  Other cards should pass `undefined` — badges are unified out per the
   *  card-chrome design. */
  footnoteBadge?: ReactNode;
  /** Narrow slot between the kind label and the jump/X chrome. Use for
   *  status dots, partner-claim pills, AiRequestCheckbox, etc. Avoid
   *  free-form layouts here. */
  headerTrailing?: ReactNode;
  /** When true and `isPoppedOut`, renders a `CardJumpChevron` immediately
   *  left of the close X. Docked cards never show the jump-to button. */
  canJump?: boolean;
  onJump?: (e: React.MouseEvent) => void;
  /** Optional placement of the separator line between header and body.
   *  Defaults to true so the existing visual is preserved; set false to
   *  suppress (e.g. a card that paints its own divider). */
  showSeparator?: boolean;
  /** When true, PanelCard renders NO header (and no popout-X) — the body only.
   *  Set by a popped card so the unified header moves up into `FloatChrome`
   *  (the AF window chrome). Only ever true together with `isPoppedOut`; the
   *  DOCKED path never sets it, so the docked header is untouched. */
  chromeless?: boolean;
}

/** Cursor distance (px) the user must drag from a card's header before
 *  the lift-off triggers. Small enough that a deliberate drag fires
 *  immediately, large enough that text selection / single clicks within
 *  the header still work. */
const CARD_LIFT_THRESHOLD = 5;

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
    cardKey,
    isCollapsed,
    onToggleExpanded,
    onHeaderActivate,
    headerDisclosure = true,
    onMouseDown: callerMouseDown,
    kind,
    kindLabelOverride,
    kindOptions,
    onKindChange,
    footnoteBadge,
    headerTrailing,
    canJump,
    onJump,
    showSeparator = true,
    chromeless,
    ...rest
  },
  ref,
) {
  /** Unified header rendering: when `kind` is provided, PanelCard owns the
   *  header. Single source of truth for header layout, height, slots, and
   *  popped-out chrome. Cards pass kind + slots and supply only the body
   *  via `children`. When `chromeless` (a popped card whose header has moved
   *  into `FloatChrome`), PanelCard renders no header at all. */
  const renderUnifiedHeader = kind != null && !chromeless;
  // Stable id for the collapsible body region, referenced by the expand
  // chevron's `aria-controls` (the WAI-ARIA disclosure pattern).
  const bodyId = useId();
  // Measure the header (first child) so the absolute popout overlay centers
  // on whatever the header's actual height turns out to be — header content
  // varies per panel (inputs, avatars, chips, …) so a fixed `top` value
  // misaligns on some cards. The measured height is published as a CSS
  // variable on the card root; the popout uses `calc()` to self-center.
  const innerRef = useRef<HTMLDivElement>(null);
  // Set when the lift gesture crosses its threshold so the browser's trailing
  // click (mousedown→drag→mouseup still synthesizes one) is swallowed instead
  // of firing the header toggle or the root onClick. Reset on the next
  // mousedown — mirrors StripButton's `handledByPointer` pattern
  // (src/components/editor-layout/drag-drop.tsx).
  const suppressClickRef = useRef(false);
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

  // Lift-off drag gesture. Wired via the wrapper's onMouseDown so we can
  // both measure the source card rect and scope the gesture to the card's
  // header subtree (skipping the body and any interactive children).
  // Note: works off the popped-cards context (popOutAtRect) rather than
  // the onTogglePopout callback, so cards that handle their own X
  // rendering (e.g. BibEntryCard) still get the lift gesture even when
  // they don't pass onTogglePopout up to PanelCard.
  const popped = usePoppedCards();
  const onWrapperMouseDown = (e: React.MouseEvent) => {
    // Lift-to-popout is allowed in both expanded and collapsed states —
    // the drag handle is the only popout affordance now. Only a popped
    // card disables the gesture (the X in its header docks it back).
    if (!cardKey || isPoppedOut) return;
    // The docked residue of an ALREADY-POPPED card must not re-lift:
    // popOutAtRect would no-op (key already popped), leaving a dead drag
    // and a stale lift handoff that a later programmatic mount of the same
    // key would consume as a phantom beginDragAt. The residue header
    // degrades to plain click (select/toggle still work).
    if (popped?.isPopped(cardKey)) return;
    // `isPoppable` is the SINGLE registry SSOT for poppability — it gates this
    // drag-lift (the only pop-out path now that the docked button is retired).
    // Without this, a non-poppable kind (`error`, whose toFloatable resolves
    // to null) would lift into a blank ghost float (FloatHost renders nothing).
    if (kind && !isPoppable(kind)) return;
    if (!popped?.popOutAtRect && !onTogglePopout) return;
    if (e.button !== 0) return;
    const cardEl = innerRef.current;
    if (!cardEl) return;
    const headerEl = cardEl.firstElementChild as HTMLElement | null;
    if (!headerEl) return;
    const target = e.target as HTMLElement;
    if (!headerEl.contains(target)) return;
    // Don't steal mousedown from interactive controls inside the header
    // (input fields, buttons, the trash button overlay, drag handles for
    // reordering, etc.). The generic chrome elements that DO want the
    // gesture (titles, label text, decorative wrappers) bubble through.
    //
    // Scoping by `headerEl.contains(blocker)` is critical: the card root
    // itself is often `draggable="true"` (for cross-editor anchor drags),
    // and an unscoped `closest('[draggable="true"]')` walks past the
    // header and matches that root — which would block every lift.
    const blocker = target.closest(
      "button, input, textarea, select, a, [contenteditable='true'], [draggable='true'], [data-no-window-drag]",
    );
    if (blocker && headerEl.contains(blocker)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let triggered = false;
    // Visual squeeze: toggle `.is-pressed` on both the leftmost grip AND
    // the header bar so the whole header reads as "grabbed" — the grip
    // squeezes (translateY + bg + color), the header gets a subtle darken
    // overlay. Mirrors the paragraph/heading drag-handle pattern; CSS in
    // globals.css. The same class name is used on both because the grip
    // is nested inside the header — the CSS uses `[data-card] > .is-pressed`
    // to target only the header at the card-root level.
    const gripEl = headerEl.querySelector(".card-drag-handle") as HTMLElement | null;
    gripEl?.classList.add("is-pressed");
    headerEl.classList.add("is-pressed");
    // Suppress the card root's HTML5 dragstart (used for cross-editor
    // anchor drags) for the duration of this gesture so it can't preempt
    // the pointer-driven lift. Cleared in `cleanup()`.
    const suppressDragStart = (ev: DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    cardEl.addEventListener("dragstart", suppressDragStart);
    const onMove = (ev: MouseEvent) => {
      if (triggered) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dx * dx + dy * dy < CARD_LIFT_THRESHOLD * CARD_LIFT_THRESHOLD) return;
      triggered = true;
      // The lift consumed this press — swallow the trailing click so it
      // can't toggle/select/jump the card that's about to pop out.
      suppressClickRef.current = true;
      // Snapshot the source card's rect before any DOM churn (the card
      // may unmount on the next render once it flips to popped).
      const r = cardEl.getBoundingClientRect();
      setCardLiftTarget({
        cardKey,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
      // Pop-out continuity (#20): spawn the float at the docked card's
      // own rect, chrome-compensated by the ONE float-policy formula so
      // the card body does not visually move. The user's grab offset
      // rides naturally into the drag handoff (beginDragAt anchors to
      // the spawn position). A collapsed card spawns header-only and
      // asks the float path for its one-shot expand-to-content grow.
      const spawn = liftSpawnRect(r);
      // Set the handoff BEFORE flipping to popped so the FloatWindow's
      // mount-time `consumeCardLiftHandoff` sees it and picks up the
      // in-flight drag without a frame gap.
      setCardLiftHandoff({
        cardKey,
        clientX: ev.clientX,
        clientY: ev.clientY,
        expandToContent: !!isCollapsed,
      });
      if (popped?.popOutAtRect) {
        popped.popOutAtRect(cardKey, spawn);
      } else if (onTogglePopout) {
        // Fallback: synthesize a DOMRect anchor at the cursor position.
        // The legacy `toggleAtAnchor` will run computeSpawnPosition over
        // it, which won't be cursor-perfect but is at least close.
        onTogglePopout(new DOMRect(spawn.x, spawn.y, spawn.width, spawn.height));
      }
      // Clear any Omni pin held on this card — the wrapper's mousedown-
      // capture handler may have pinned it at the gesture's start, and
      // the lift unmounts the wrapper from the cascade. Leaving the pin
      // would be a dead reference (resolveCascade skips it harmlessly,
      // but no reason to dangle stale state).
      const sideEl = cardEl.closest(
        "[data-panel-column-side]",
      ) as HTMLElement | null;
      const side = sideEl?.dataset.panelColumnSide;
      if (side === "left" || side === "right") {
        omniPinStore.clearPin(side, cardKey);
      }
      // Schedule the highlight's fade-out — a brief pulse on lift-off.
      window.setTimeout(() => setCardLiftTarget(null), 150);
      cleanup();
    };
    const onUp = () => {
      if (!triggered) {
        // Pure click — never showed the highlight, nothing to fade.
        setCardLiftTarget(null);
      }
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      cardEl.removeEventListener("dragstart", suppressDragStart);
      gripEl?.classList.remove("is-pressed");
      headerEl.classList.remove("is-pressed");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Ratified header-click contract (2026-06-11): a click anywhere on the
  // docked unified header TOGGLES expansion + SELECTS the card — never jumps.
  // Falls back to toggle-only when the host threads no select composition.
  // Popped cards have no expansion axis, so the header click is inert there.
  const headerActivate = !isPoppedOut
    ? (onHeaderActivate ?? onToggleExpanded)
    : undefined;

  return (
    <div
      ref={setRefs}
      data-card="1"
      data-card-key={cardKey}
      className={`group relative ${themedCard(theme, selected, extraCardClass)}${isPoppedOut ? (chromeless ? " flex-1 min-h-0 flex flex-col" : " h-full flex flex-col") : ""}${className ? ` ${className}` : ""}`}
      style={{
        ...themedCardStyle(theme, selected, { isPoppedOut }),
        ...style,
      }}
      onClick={onClick ? (e) => {
        e.stopPropagation();
        if (suppressClickRef.current) return;
        onClick(e);
      } : undefined}
      onMouseDown={(e) => {
        // A fresh press re-arms the click path (the suppress flag only ever
        // swallows the single trailing click of a completed lift gesture).
        suppressClickRef.current = false;
        callerMouseDown?.(e);
        if (e.defaultPrevented) return;
        onWrapperMouseDown(e);
      }}
      {...rest}
    >
      {renderUnifiedHeader ? (
        <>
          {/* Unified card header — single source of truth for header layout.
              Height matches popped-out text headers (h-6 = 24px). Drag
              handle (10×14 SVG) fits with room to spare.

              The whole docked header is the disclosure trigger (the per-card
              expand chevron was retired with the ratified click=toggle+select
              contract): click / Enter / Space fire `headerActivate`. Clicks
              consumed by interactive children (kind dropdown, title input,
              ItemMenu, trailing controls) stopPropagation and never reach it.
              stopPropagation here keeps the header click from bubbling to the
              card root's onClick (the body's select+expand+jump contract). */}
          {/* Cursor contract (#19): default cursor across the header (it's a
              click-to-toggle surface, not a text/grab surface) — the grab
              affordance is the dots glyph, which keeps its own cursor-grab
              as the visual drag hint. Overrides any cursor-pointer/grab the
              card root sets via extraCardClass. */}
          <div
            className="flex items-center gap-1 px-2 h-6 shrink-0 cursor-default"
            style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
            // Lets EditableCard's focus-capture auto-activation skip header
            // focus: the header has its own explicit activation (click /
            // Enter / Space, never jump), so Tab landing here must not fire
            // the body composition's jump.
            data-card-header="1"
            {...(headerActivate
              ? {
                  role: "button" as const,
                  tabIndex: 0,
                  // Non-disclosure headers (select-only activation, e.g. a
                  // draft citation's pinned-open body) drop the expanded/
                  // controls semantics — never advertise a collapse that
                  // won't happen.
                  ...(headerDisclosure
                    ? {
                        "aria-expanded": !isCollapsed,
                        "aria-controls": bodyId,
                        "aria-label": isCollapsed ? "Expand card" : "Collapse card",
                      }
                    : { "aria-label": "Select card" }),
                  onClick: (e: React.MouseEvent) => {
                    e.stopPropagation();
                    // Swallow the trailing click of a completed lift gesture.
                    if (suppressClickRef.current) return;
                    headerActivate();
                  },
                  onKeyDown: (e: React.KeyboardEvent) => {
                    // Only when the header itself is focused — never steal
                    // Enter/Space from inputs nested in the trailing slot.
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      headerActivate();
                    }
                  },
                }
              : {})}
          >
            <CardDragHandle />
            {footnoteBadge}
            <CardKindHeader
              kind={kind!}
              labelOverride={kindLabelOverride}
              options={kindOptions}
              onChange={onKindChange}
            />
            <div className="flex-1" />
            {headerTrailing}
            {isPoppedOut && canJump && onJump && (
              <CardJumpChevron onClick={onJump} />
            )}
            {/* Popped: the X that docks the card back. Docked cards show NO
                pop-out button (ratified 2026-06-11) — the header drag-lift is
                the only pop-out path. */}
            {onTogglePopout && isPoppedOut && (
              <CardPopoutButton isPoppedOut onClick={onTogglePopout} />
            )}
          </div>
          {showSeparator && (
            <div
              className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
              style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
            />
          )}
          {/* `display:contents` keeps the body id resolvable for the chevron's
              `aria-controls` without inserting a layout box. */}
          <div id={bodyId} style={{ display: "contents" }}>{children}</div>
        </>
      ) : (
        <>
          {children}
          {/* `chromeless` popped cards delegate the X to FloatChrome. */}
          {onTogglePopout && isPoppedOut && !chromeless && (
            <div
              className="absolute right-1.5 z-10"
              style={{ top: "calc(var(--pc-header-h, 32px) / 2 - 10px)" }}
            >
              <CardPopoutButton isPoppedOut onClick={onTogglePopout} />
            </div>
          )}
        </>
      )}
      {onTrashClick && !isCollapsed && <CardTrashButton onClick={onTrashClick} />}
    </div>
  );
});

/* ── Panel header ─────────────────────────────────────────────────── */

export function PanelHeader({
  title,
  count,
  onAdd,
  onAddOptions,
  leading,
  titleAfter,
  children,
}: {
  title: string;
  count?: number;
  /** Receives the trigger button's bounding rect so the host can pop the
   *  new card as a float anchored to the "+" button. */
  onAdd?: (anchorRect?: DOMRect) => void;
  /** When provided, the "+" button opens a small dropdown menu of
   *  choices instead of firing `onAdd` directly. Use when a panel
   *  hosts more than one card kind (e.g. Cutter: Comment vs Suggestion).
   *  Each option receives the trigger button's bounding rect.
   *  `onAdd` is ignored when `onAddOptions` is set. */
  onAddOptions?: { label: string; onClick: (anchorRect?: DOMRect) => void }[];
  /** Content rendered at the far left of the header, before the title.
   *  Typical use: the panel's three-dots options menu. */
  leading?: ReactNode;
  /** Content rendered immediately after the count (before add buttons).
   *  Use for inline mode toggles that cluster with the title — e.g.
   *  Outline's Edit/Focus/Lock buttons. */
  titleAfter?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`${PANEL.header} flex items-center gap-1.5`}>
      {leading}
      <h3 className={`panel-header-title text-[11px] font-semibold uppercase tracking-wider leading-none${leading ? " -ml-1" : ""}`}>
        {title}
      </h3>
      {count != null && count > 0 && (
        <span className="panel-header-count text-[11px] font-semibold uppercase tracking-wider leading-none ml-1">
          {count}
        </span>
      )}
      {titleAfter}
      {onAddOptions ? (
        <HeaderAddDropdown options={onAddOptions} />
      ) : onAdd && (
        <button
          onClick={(e) => onAdd(e.currentTarget.getBoundingClientRect())}
          className="iconbtn-sm"
          data-hint="Add"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
      <div className="flex-1" />
      {children}
      <PanelClose />
    </div>
  );
}

/** "+" button that, when clicked, drops a small dropdown menu of choices
 *  (instead of firing a single onAdd). Used by panels that host more than
 *  one card kind. Mirrors the flip-on-overflow / click-outside-to-close
 *  pattern from `DocStyleDropdown`. */
function HeaderAddDropdown({
  options,
}: {
  options: { label: string; onClick: (anchorRect?: DOMRect) => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const triggerRectRef = useRef<DOMRect | null>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }>({});

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      triggerRectRef.current = r;
      const POPUP_H = 28 * options.length + 8;
      const POPUP_W = 160;
      const GAP = 4;
      const flipUp =
        r.bottom + GAP + POPUP_H > window.innerHeight && r.top > POPUP_H + GAP;
      const flipLeft =
        r.left + POPUP_W > window.innerWidth - 4 &&
        window.innerWidth - r.right > POPUP_W;
      const vertical = flipUp
        ? { bottom: window.innerHeight - r.top + GAP }
        : { top: r.bottom + GAP };
      const horizontal = flipLeft
        ? { right: window.innerWidth - r.right }
        : { left: r.left };
      setPos({ ...vertical, ...horizontal });
    }
    setOpen(!open);
  };

  const pick = (onClick: (anchorRect?: DOMRect) => void) => {
    const rect = triggerRectRef.current ?? undefined;
    setOpen(false);
    onClick(rect ?? undefined);
  };

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="iconbtn-sm"
        data-hint="Add"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="fixed bg-surface border border-[var(--border)] rounded-md shadow-lg py-1 z-[60] min-w-[140px]"
          style={{
            top: pos.top,
            bottom: pos.bottom,
            left: pos.left,
            right: pos.right,
          }}
        >
          {options.map((o) => (
            <button
              key={o.label}
              role="menuitem"
              onClick={() => pick(o.onClick)}
              className="w-full text-left px-3 py-1 text-sm text-[var(--foreground)] hover-on-light"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── AI request card ───────────────────────────────────────────────── */

const AI_REQUEST_KIND_LABEL: Record<AiRequestKind, string> = {
  footnote: "footnote",
  note: "note",
  highlight: "highlight",
  citation: "citation",
  todo: "todo",
  suggestion: "suggestion",
  report: "report",
  // style-merge requests are filed by the Style dropdown and never
  // surface as panel cards; this entry exists only to keep the Record
  // type exhaustive.
  "style-merge": "style merge",
};

/**
 * Draft card holding a free-text AI request the user can later have
 * fulfilled. It pops out as a float (header lift), but is not dragged
 * into the editor — AI requests live in cards, not as in-text markers.
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
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
}) {
  const [draft, setDraft] = useState(request.text);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
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

  const kindLabel = AI_REQUEST_KIND_LABEL[request.kind] ?? request.kind;
  const theme = CARD_THEMES.aiRequest;

  const onToggleFromCtx = onTogglePopout
    ?? (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(popKey, anchor) : undefined);

  const card = (
    <PanelCard
      data-ai-request-id={request.id}
      data-card-key={popKey}
      theme={theme}
      selected={false}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
    >
      {/* Header — pr-7 reserves space for the absolute top-right popout overlay */}
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: theme.headerDefault }}
      >
        <CardDragHandle />
        <span
          className="inline-flex items-center justify-center w-5 h-5 shrink-0"
          style={{ color: theme.accent }}
          data-hint={`AI ${kindLabel} request`} aria-label={`AI ${kindLabel} request`}
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
        <span className="text-xs font-medium truncate" style={{ color: theme.titleColor }}>AI {kindLabel} request</span>
        {request.status === "submitted" && (
          <span
            className="inline-flex items-center gap-1 text-[10px] shrink-0"
            style={{ color: theme.titleColor }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: theme.accent }}
            />
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
          data-hint="Delete request"
          data-hint-pos="above"
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
      <div className="border-t" style={{ borderColor: theme.separatorSelected }} />

      {/* Body: auto-grow textarea. (The former near-invisible `bg-sky-50/20`
          wash was dropped in A10 Commit H rather than minting a one-consumer
          `bodyTint` palette token — it composited to ≈white anyway.) */}
      <div className={`px-3 py-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onDragStart={(e) => e.stopPropagation()}
          onKeyDown={onTextareaKeyDown}
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
  // Popped: AF's FloatHost wraps this in a (bare) FloatWindow — the AiRequest
  // body keeps its bespoke header until Stage 6. Docked: render inline.
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
  // Auto-injected text-size widget for any panel-header menu inside a Panel.
  // Card-level menus (align="right") are skipped. The widget is appended
  // INTO the first child of the menu (the standard color-swatch + view-toggle
  // row) so it renders on the same line. If the first child isn't a row, the
  // widget falls back to its own row at the top.
  const bodyKey = useEnclosingPanelBodyKey();
  const injectTextSize = align === "left" && bodyKey != null;
  const enhancedChildren = useMemo<ReactNode>(() => {
    if (!injectTextSize || !bodyKey) return children;
    const arr = Children.toArray(children);
    const first = arr[0];
    if (isValidElement(first)) {
      const firstProps = first.props as { children?: ReactNode };
      arr[0] = cloneElement(
        first as React.ReactElement<{ children?: ReactNode }>,
        {},
        ...Children.toArray(firstProps.children),
        <PanelTextSizeRow key="__text-size__" panelKey={bodyKey} />,
      );
      return arr;
    }
    // Fallback: render text-size as its own row before the children
    return (
      <>
        <div className="px-3 py-1.5 flex items-center justify-end">
          <PanelTextSizeRow panelKey={bodyKey} />
        </div>
        {children}
      </>
    );
  }, [children, injectTextSize, bodyKey]);

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
        className={isPanelHeader ? "iconbtn-sm" : "iconbtn-md"}
        data-hint="Options"
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
          // stopPropagation fences ALL menu items (incl. future menuContent)
          // from the card header's toggle+select and the root's body contract
          // — the dropdown is DOM-nested inside the header div.
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
        >
          {enhancedChildren}
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
      data-hint="Jump to text"
      data-hint-pos="above"
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
      data-hint="Jump to text"
      data-hint-pos="above"
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
