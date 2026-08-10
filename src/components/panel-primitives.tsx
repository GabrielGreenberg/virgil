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

import { type ReactNode, type HTMLAttributes, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, forwardRef, useState, useRef, useEffect, useLayoutEffect, useCallback, useId, createContext, useContext, Children, cloneElement, isValidElement, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import { MIN_BAND_PX, type PanelId, type Side } from "@/hooks/useViewPrefs";
import { autoSizeInput } from "@/lib/autoSizeInput";
import ConfirmDialog, { useConfirmDialog } from "./ConfirmDialog";
import { cardHasContent } from "@/cards/has-content";
import { isPoppable, hasCollabClaims, collabClaimScope, isDroppable, isArchivable, isExcerptCardKind, bodySchemaForCardKind } from "@/cards/predicates";
import type { CardBodySchemaScope } from "@/lib/tiptap-extensions";
import { useCardArchiveActions } from "@/panels/_shared/card-archive-actions";
import { useCardRestoreActions } from "@/panels/_shared/card-restore-actions";
import { DropChevrons } from "./icons/DropChevrons";
import { JumpChevron } from "./icons/JumpChevron";
import { beginCardDropGesture } from "./drop-mode/card-drop-gesture";
import { CARD_REGISTRY } from "@/cards/card-registry";
import RichTextField from "./RichTextField";
import { BorrowedMainText } from "./BorrowedMainText";
import { StaticBorrowedText } from "./StaticBorrowedText";
import { useCardTier } from "@/cards/presence";
import { useEditorChrome } from "./editor-layout/chrome-context";
import PanelTextSizeRow from "./PanelTextSizeRow";
import { AnchoredMenu } from "./menu/AnchoredMenu";
import { MenuActionRow } from "./menu/MenuActionRow";
import { useMenuItem } from "./menu/useMenuItem";
import { useEnclosingPanelBodyKey } from "./panel-kind-context";
import { normalizeRichContent, richJsonToPlainText } from "@/lib/footnote-content";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { setCardLiftTarget, setCardLiftHandoff } from "./card-lift";
import { liftSpawnRect } from "@/floats/float-policy";
import { INTERACTIVE_CONTROL_SELECTOR } from "@/lib/drag-blocklist";
import { cardTypeLabel } from "@/panels/panel-registry";
import type { CardKind } from "@/panels/_shared/types";
import { useInOmni } from "./editor-layout/contexts/omni";
import { useCompressedLines } from "./editor-layout/contexts/card-display";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { themeFromAccent, DEFAULT_PANEL_COLORS, type CardTheme, type PanelThemeKey } from "@/lib/panel-theme";
import { useCardClaim, useCollabContext } from "@/hooks/useCollab";
import CollabClaimPill from "./CollabClaimPill";
import CollabPresenceDots from "./CollabPresenceDots";
import { omniPinStore } from "./editor-layout/omni-pin-store";

/**
 * True when a keyboard event originated from an interactive control nested
 * inside a card — a native form field, link, rich-text surface, or explicitly-
 * draggable element (the shared {@link INTERACTIVE_CONTROL_SELECTOR} pass-
 * through set) — rather than from the card shell itself.
 *
 * Card-level `Delete`/`Backspace` handlers must bail on this so a character
 * edit inside a field never triggers card deletion. `EditableCard` already
 * encodes this via its `isFocused` focus-tracking; cards that wire a *bare*
 * card-level delete handler around editable fields (e.g. Todo's plain
 * `<input>` + `<textarea>`, which never inherited that guard) reuse this helper
 * instead of duplicating focus state. It keys off the SAME interactive-controls
 * SSOT as the drag/lift/pin pass-through guards, so "controls a gesture must
 * pass through untouched" has one definition across the app.
 *
 * Returns `false` when the event target IS the card shell (`currentTarget`), so
 * a `Backspace` with the card shell — not a field — focused still deletes.
 */
export function keyEventFromInteractiveControl(e: ReactKeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  if (!target || target === e.currentTarget) return false;
  return !!target.closest(INTERACTIVE_CONTROL_SELECTOR);
}

/**
 * The ONE card-level `Delete`/`Backspace` → "delete the selected card" keydown
 * handler for {@link PanelCard}-based cards that DON'T route through
 * {@link EditableCard} (which owns its own `isFocused`-guarded delete +
 * `cardHasContent` confirm). It bakes in the two guards every such card needs:
 *
 *  1. act only when the card is `selected`; and
 *  2. NEVER when the keydown came from a nested interactive control
 *     ({@link keyEventFromInteractiveControl}) — so a `Backspace` typed inside a
 *     field edits that field's text instead of deleting the whole card.
 *
 * Five cards hand-rolled this handler and passed it to PanelCard via `onKeyDown`
 * (`...rest`): Todo, Highlight, Error, and the Cutter/Revision *suggestion*
 * cards. Some omitted guard #2 — a reachable data-loss bug (a `Backspace` in a
 * selected suggestion card's editable field silently deleted the card with the
 * user's typed content in it; task 110). Routing them all through this one hook
 * makes the field guard hold *by construction*: a card opts into keyboard-delete
 * with a single `onKeyDown={useCardDeleteKey(selected, del)}` and cannot forget
 * it. `del` is invoked only when both guards pass; pass the card's own
 * (possibly confirm-wrapped) delete thunk.
 */
export function useCardDeleteKey(
  selected: boolean,
  onDelete: (() => void) | undefined,
): (e: ReactKeyboardEvent) => void {
  return useCallback(
    (e: ReactKeyboardEvent) => {
      if (!selected || !onDelete) return;
      if (keyEventFromInteractiveControl(e)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDelete();
      }
    },
    [selected, onDelete],
  );
}

/**
 * The ONE content-aware delete flow for cards that render DIRECTLY via
 * {@link PanelCard} (not through {@link EditableCard}) and so bypass
 * EditableCard's built-in `cardHasContent` confirm. Three kinds do this —
 * `citation`, `cutter-suggestion`, `revision-suggestion` — and each was
 * re-inlining (or, for the two suggestions, silently MISSING) the same "gate the
 * trash on `cardHasContent`" block. That bypass IS the bug class (CI-F7-01): a
 * PanelCard-direct card's docked trash / Delete-key hard-deleted a
 * content-bearing card with no confirm, unlike every EditableCard sibling and the
 * same card's own in-text margin marker (`deleteMarginItem`). This hook is that
 * block, once — so citation + both suggestions + any future PanelCard-direct kind
 * share ONE confirm path (the "one SSOT, not N inlined copies" shape).
 *
 * Returns `{ tryDelete, dialog }`. Call `tryDelete()` from the trash button and
 * (via {@link useCardDeleteKey}) the Delete/Backspace key; render `dialog` inside
 * the card. When `cardHasContent(kind, card)` is true it awaits the confirm and
 * bails on cancel; otherwise (a pristine/empty card) it deletes straight through,
 * no nag. `onDelete` may be undefined (e.g. a draft with no delete wired) — then
 * `tryDelete` is a no-op. `opts.message`/`opts.confirmLabel` override the shared
 * default ("This item has text. Delete it?") for kinds with a domain-specific
 * prompt (a citation is "referenced in the document").
 */
export function usePanelCardTryDelete(
  kind: CardKind,
  card: unknown,
  id: string,
  onDelete: ((id: string) => void) | undefined,
  opts?: { message?: string; confirmLabel?: string },
): { tryDelete: () => void; dialog: ReactNode } {
  const { confirm, dialog } = useConfirmDialog();
  const message = opts?.message ?? "This item has text. Delete it?";
  const confirmLabel = opts?.confirmLabel ?? "Delete";
  const tryDelete = useCallback(() => {
    if (!onDelete) return;
    void (async () => {
      if (cardHasContent(kind, card)) {
        const ok = await confirm({ message, confirmLabel, tone: "danger" });
        if (!ok) return;
      }
      onDelete(id);
    })();
  }, [kind, card, id, onDelete, confirm, message, confirmLabel]);
  return { tryDelete, dialog };
}

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
  // `lineHeight` may be a number (plain-summary kinds default to 1.4) or a
  // CSS-var string. Borrowed-body kinds (footnote/archive/example) render
  // their preview <p> at the LIVE `--editor-line-height` prose pref (1.6 by
  // default, but user-tunable), so they pass `'var(--editor-line-height, 1.8)'`
  // — the ceiling must track that same unit-less factor or line 2 gets clipped
  // (#42). A literal value would drift from the pref; the var stays in sync.
  // The var FALLBACK (1.8) must equal the `.tiptap p` line-height fallback
  // (globals.css:657): if the var were ever undefined, a tighter clamp ceiling
  // than the rendered line would re-introduce the #42 clip.
  opts?: { lineHeight?: number | string },
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
    // `${lh} * 1em` works for both a number and a `var(...)` string
    // (a unit-less factor × 1em), valid CSS `calc` either way.
    maxHeight: `calc(${lh} * 1em * ${n})`,
    boxSizing: "content-box",
  };
}

export function makeCompressedSummary(content: JSONContent | unknown, lines: number): string {
  const text = richJsonToPlainText(content).replace(/\s+/g, " ").trim();
  const limit = 80 * Math.max(1, lines);
  // C24 (OMNI-F1-03): the old hard `.slice(0, limit)` cut mid-word with NO
  // ellipsis, so a truncated summary looked like the whole body. Append "…"
  // when (and only when) we actually dropped trailing content, so a body that
  // fits is returned verbatim. The clamp is on the projected plain text; the
  // CSS line-clamp (`compressedBodyStyle`) still caps the rendered height.
  if (text.length <= limit) return text;
  return text.slice(0, limit).trimEnd() + "…";
}

/* ── Class-string constants ───────────────────────────────────────── */

const CARD_BASE =
  "rounded-lg border transition-colors overflow-hidden";
// Resting edge softened onto `border-edge-subtle` (task 026 §3a) so cards
// adopt the panel-subtle look by default — the card's identity comes from its
// shadow + gap (panel look), not a hard edge. Hover keeps the retint/brighten
// (a neutral edge-strengthen + muted bg); the COLORED hover/select outline is
// separate (globals.css, gated behind the `card-outline-chrome` pref).
const CARD_DEFAULT =
  "bg-surface border-edge-subtle hover:border-edge-strong hover:bg-surface-muted/50";

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

/**
 * True when a keyboard event originated inside an editable control — a text
 * `<input>`, `<textarea>`, `<select>`, or a `contentEditable` region. Cardful
 * list panels use this to NOT hijack ArrowUp/Down for card-cycling while the
 * caret sits in a card's own field (the Code box, a +range/postnote input, the
 * "Add from library…" search), so the arrows move the caret instead.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Shared ArrowUp/Down list-navigation keydown handler for cardful list panels
 * (Citations / Footnotes / Examples / Bibliography). ArrowDown → `next`,
 * ArrowUp → `prev`, each followed by `clearStaleHover` on the scroll body.
 *
 * Events originating from an editable target are ignored (see
 * `isEditableEventTarget`) so arrows edit text inside a card's inputs rather
 * than cycling cards out from under the caret. This "don't steal arrows inside
 * inputs" law lived in four near-identical per-panel copies (one of which
 * lacked the guard); lifting it here makes it a single SSOT every list panel
 * inherits. No-op when `count` is 0.
 */
export function useListNavKeys(
  count: number,
  next: () => void,
  prev: () => void,
): (e: ReactKeyboardEvent) => void {
  return useCallback(
    (e: ReactKeyboardEvent) => {
      if (count === 0) return;
      if (isEditableEventTarget(e.target)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        next();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        prev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [count, next, prev],
  );
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

/** Single source of truth for card-surface inline style: border color
 *  and ambient lift shadow. PanelCard, SearchPanel result rows, and any
 *  other card surface must call this so the selection visual stays
 *  uniform across kinds and contexts.
 *
 *  Selection no longer paints a heavy halo. A selected card's *attention*
 *  ring is the same light 1.5px/50% outline as hover (the `[data-card-key]`
 *  rule in globals.css); its persistent identity — the cue that survives the
 *  pointer leaving — is the quiet `borderSelected` 1px border tint applied
 *  here, plus the header tint PanelCard sets from `headerSelected`. So the
 *  box-shadow is always just the ambient lift, for selected and unselected
 *  alike.
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
    boxShadow: "var(--card-shadow-ambient)",
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
 *    override on (e.g.) the footnote panel can NOT re-tint them.
 *
 *  ⚠️ SHIPPED DEFAULTS ONLY — this table is folded ONCE at module eval, so it
 *  is **override-blind by construction**: no re-render can ever make it pick up
 *  a user color. A rendered component must read `useCardTheme(key)`
 *  (`hooks/usePanelTheme.ts`), which is version-subscribed to the override
 *  store. The ONLY legitimate runtime reads of this table from a component are
 *  the `SYSTEM_THEME_KEYS` accents (`aiRequest`/`error`), which have no
 *  override to miss. CI-enforced: `__tests__/card-theme-override-guardrail.test.ts`
 *  (task 175 — `TodoRow` was the last non-system offender). */
export const CARD_THEMES: Record<PanelThemeKey, CardTheme> = Object.fromEntries(
  (Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]).map((key) => [
    key,
    themeFromAccent(DEFAULT_PANEL_COLORS[key]),
  ]),
) as Record<PanelThemeKey, CardTheme>;

/* ── Shared badge classes ────────────────────────────────────────── */

const BADGE_BASE = "inline-flex items-center justify-center w-[18px] h-[18px] rounded text-[10px] font-semibold shrink-0";

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

/** Orphaned/unanchored badge — a small faded color dot-squircle (~10px).
 *  Matches the "outside focus" ◎ dot; the data-hint/aria-label carry the
 *  "no anchor" meaning (no cross-out glyph). Deliberately NOT BADGE_BASE —
 *  it is smaller than the 18px count badge it sits beside. */
export function BadgeOrphaned({ theme }: { theme: CardTheme }) {
  return (
    <span
      className="inline-flex items-center justify-center shrink-0 opacity-60 w-2.5 h-2.5 rounded-xs"
      style={{ background: theme.badgeBg, border: `1.5px solid ${theme.badgeBorder}` }}
      data-hint="No anchor in document" aria-label="No anchor in document"
    />
  );
}

/** Twin-lockstep SSOT for the "deliberately parked, re-anchorable" rest state
 *  (an unanchored citation or footnote ref whose `\cite`/`\footnote` atom was
 *  spliced out on archive and NOT re-inserted on unarchive — see
 *  `CitationRef.unanchored` / `FootnoteRef.unanchored`). The card sits in the
 *  panel with a NEUTRAL "drag into the editor to anchor it" cue: a dashed border
 *  + reduced opacity. This is deliberately DISTINCT from BOTH the anchored rest
 *  state (solid border, full opacity) AND the `orphaned` ERROR state (which
 *  keeps its faded {@link BadgeOrphaned} "no anchor" dot). Both the Citation and
 *  Footnote unanchored cards consume these so the two twins can't drift apart. */
export const UNANCHORED_CARD_CLASS = "border-dashed opacity-80";

/** Tooltip for an unanchored/parked card — pairs with {@link UNANCHORED_CARD_CLASS}. */
export function unanchoredCardTitle(noun: "citation" | "footnote"): string {
  return `Unanchored ${noun} — drag into the editor to anchor it`;
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

/** In-card META tier label (UI-consistency sweep): 10px / 500 / uppercase /
 *  tracking-wide / the ONE meta gray (`var(--muted)`, matching
 *  `CardTypeLabel`). For the small overlines naming a meta row inside a
 *  card body ("Type", "Code", "Preview", …). Design-system-fixed — the
 *  per-panel body-font picker never applies to meta rows. */
export function CardMetaLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`card-meta-label${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}

/** In-card mono text routes through the override-first mono var stack via the
 *  `.card-mono` class (Tailwind's `font-mono` skips the user's mono override
 *  pref). Used directly as a className — no React wrapper component, since
 *  call sites set their own size and pair it with surrounding classes (the
 *  bare/inherit case a two-size wrapper couldn't express). */

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

/**
 * The card-type morph dropdown ("Change card type"). Folded onto `AnchoredMenu`
 * in task 181, retiring an `absolute top-full … z-50` surface with a bespoke
 * `document.addEventListener("mousedown")` closer, no Escape, no flip/clamp and
 * no keyboard nav.
 *
 * The z-tier was the user-visible half: `z-50` paints BELOW the float layer
 * (1200–1204), so a popped-out card overlapping this one occluded the open menu
 * — and being `absolute` rather than portaled, it was also clipped by the panel
 * list's own scroll container whenever the card sat near the bottom. Both are
 * properties of the surface, so both are answered by moving the surface, not by
 * raising a number.
 */
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
  return (
    <AnchoredMenu
      ariaLabel="Change card type"
      align="start"
      triggerHint="Change card type"
      triggerAriaLabel="Change card type"
      triggerClassName="inline-flex items-center gap-0.5 text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium hover:text-ink-body transition-colors cursor-pointer bg-transparent p-0"
      wrapperClassName="relative inline-flex items-center"
      menuClassName="min-w-[120px]"
      trigger={() => (
        <>
          {labelOverride ?? cardTypeLabel(kind)}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </>
      )}
    >
      {({ close }) =>
        options.map((opt) => (
          <CardKindOption
            key={opt}
            opt={opt}
            current={kind}
            onPick={() => {
              close();
              if (opt !== kind) onChange(opt);
            }}
          />
        ))
      }
    </AnchoredMenu>
  );
}

/** One row of the card-type menu. Registered via `useMenuItem` so arrow nav +
 *  the roving highlight reach it (the hand-rolled version had neither), and
 *  `aria-checked` states which type the card currently IS — a fact the old
 *  bolded-text-only row conveyed to sighted users alone.
 *
 *  `menuitemradio`, not `menuitemcheckbox`: a card has exactly one kind and
 *  picking one un-picks the other, which is the radio semantic. (Its sibling
 *  `MenuToggleRow` is a checkbox correctly — `*` and `Aa` on a citation are
 *  genuinely independent.) */
function CardKindOption({
  opt,
  current,
  onPick,
}: {
  opt: CardKind;
  current: CardKind;
  onPick: () => void;
}) {
  const isCurrent = opt === current;
  const { active, getItemProps } = useMenuItem({
    id: `kind-${opt}`,
    role: "menuitemradio",
    run: onPick,
  });
  return (
    <button
      {...getItemProps()}
      // No per-row click fence: `MenuProvider` stops the click at the menu
      // CONTAINER (task 181), which is what keeps this row from reaching the
      // unified card header — a `role="button"` whose `onClick` runs
      // `headerActivate()`, so an unfenced pick would morph the card AND
      // collapse/select it in one gesture, including on the pick-the-kind-it-
      // already-is no-op path. A fence here would leave the surface's own `py-1`
      // padding band unfenced, which is why it belongs one level up.
      type="button"
      aria-checked={isCurrent}
      className={`w-full text-left text-[11px] uppercase tracking-wider px-3 py-1 transition-colors ${
        isCurrent ? "text-ink-body font-medium" : "text-[var(--muted)]"
      } ${active ? "bg-surface-muted-strong" : "hover:bg-surface-muted-strong"}`}
    >
      {cardTypeLabel(opt)}
    </button>
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
      <JumpChevron />
    </button>
  );
}

/** Double-chevron-down "drop" button — grab it (mousedown-drag) to enter
 *  drop-mode and (re)anchor the card into the prose at a target position.
 *  The rightmost header control on a docked card (left of the X when the
 *  card is popped out). Registry-gated upstream: PanelCard renders it only
 *  when `isDroppable(kind)`.
 *
 *  Press isolation (built on `CardJumpChevron`'s, then DELIBERATELY beyond it):
 *  a real `<button draggable=false>` is already auto-excluded from the header
 *  drag-lift via `INTERACTIVE_CONTROL_SELECTOR` (`button, …`), and we
 *  `stopPropagation()` + swallow `dragstart` exactly as `CardJumpChevron` does
 *  so the press can't co-fire the header lift OR the card root's HTML5
 *  anchor-drag (a multi-gesture race). UNLIKE `CardJumpChevron`, we ALSO
 *  `preventDefault()` on mousedown — this is a press-DRAG, not a click, so we
 *  must suppress native focus + stray text-selection during the drag AND trip
 *  the header wrapper's `if (e.defaultPrevented) return` lift-guard. Do NOT
 *  delete that `preventDefault`: it is load-bearing for the press-drag, which
 *  is why this control goes past the jump chevron. The drop session itself is
 *  started by the shared `beginCardDropGesture` helper, which also arms the
 *  one-shot commit-on-mouseup. */
export function CardDropButton({
  cardKey,
  disabled = false,
  title = "Drop into text",
}: {
  /** Canonical `float:card:<kind>:<id>` key — `beginDropSession` looks the
   *  spec up from this. */
  cardKey: string;
  /** Inline kinds (citation) disable when they can't currently produce an
   *  atom (an empty / keyless draft). Footnotes are always enabled. */
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      // Press must NOT bubble to the header lift or the card-root anchor drag.
      // The button tag already excludes it from the lift; these are defensive.
      onMouseDown={(e) => {
        // Primary button only — a right/middle press must pass through
        // untouched (no phantom drop session), matching the 3 proven
        // producers (inline-atom-grab `if (event.button !== 0) return false`,
        // the header lift's `if (e.button !== 0) return`). This guard runs
        // BEFORE stopPropagation/preventDefault so a non-primary press keeps
        // its native behavior (context menu, etc.).
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        if (disabled) return;
        beginCardDropGesture({
          cardKey,
          origin: { x: e.clientX, y: e.clientY },
        });
      }}
      // A no-op onClick stopPropagation keeps the trailing click off the
      // header toggle/select (mirrors CardJumpChevron's swallow).
      onClick={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      disabled={disabled}
      className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body transition-colors bg-transparent p-0 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-ink-muted cursor-grab"
      data-hint={disabled ? "Add a citation key to anchor" : title}
      aria-label={title}
    >
      <DropChevrons />
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
    ? { ...cardTitleStyle(theme), ...style }
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

/* ── Jump-target wrapper with selection-aware opacity ────────────── */

/** Wraps the canonical `CardJumpChevron` (the single `>` jump-glyph SSOT) in
 *  bib's selection-aware opacity envelope: full when selected, subdued (60%)
 *  otherwise, very faint (30%) when disabled.
 *
 *  Bib is the one card that shows its jump affordance INLINE on cited entries
 *  (with a 60→100 fade on selection), rather than only when popped out via the
 *  `canJump`/`CardJumpChevron` path every other card uses — hence this bespoke
 *  wrapper. It only supplies the opacity envelope; the button shell + `>` glyph
 *  come from the shared `CardJumpChevron`, so bib now renders the same jump
 *  glyph as everywhere else (formerly the pre-SSOT boxed-arrow `TargetIcon`).
 *  Pass `disabled` for unanchored items (very faint). */
export function CardJumpTarget({
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
      <CardJumpChevron onClick={onClick} title={title ?? (disabled ? "Not anchored in document" : "Jump to in text")} />
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
  /** Extra content rendered inside the expanded body, ABOVE the
   *  RichTextField (e.g. the Cutter "Original" cut-excerpt section).
   *  Additive — default `undefined` renders nothing, leaving every other
   *  consumer's layout unchanged. Only shown in the expanded view. */
  aboveBody?: ReactNode;
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
  /** Unconditionally mount the inner RichTextField read-only, independent of
   *  the chrome `editableCardKinds` whitelist. Used by record-only cards that
   *  display borrowed prose the user must not edit (the pending-changes
   *  "Applied" original-record card). ANDs into the chrome-derived editable
   *  flag, so it only ever tightens, never loosens. */
  forceReadOnly?: boolean;
  /** Extra classes for the card root, merged with the internal cursor class and
   *  forwarded into `themedCard(theme, selected, extra)` on `PanelCard` — the
   *  same slot the citation card uses for state styling (e.g. the
   *  {@link UNANCHORED_CARD_CLASS} dashed/opacity parked cue). Additive: default
   *  `undefined` leaves every existing card's chrome unchanged. */
  extraCardClass?: string;
  /** Native `title` (hover tooltip) forwarded to the card root — used for the
   *  unanchored/parked cue's "drag to anchor" hint ({@link unanchoredCardTitle}). */
  title?: string;
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
  footnoteBadge, headerTrailing, bodyTitle, onBodyTitleChange, aboveBody, footer,
  menuContent, onDelete,
  onClick, onDragStart,
  value, variant, placeholder, muted, panelKey, cardKind,
  onChange, onArchiveConsumed, getCitationDisplayText, onCitationCreated,
  dataAttr, extraDataAttrs, wrapperClassName, wrapperStyle,
  hideToolbar, inlineDelete, onBodyFocus, onEditorFocus, onHoverChange,
  onTogglePopout, isPoppedOut, cardKey,
  compressed, compressedSummary, compressedContent, onToggleExpanded, onHeaderActivate,
  kind, kindLabelOverride, kindOptions, onKindChange,
  canJump, onJump, chromeless, forceReadOnly, extraCardClass, title,
}: EditableCardProps) {
  // Chrome-driven read-only mode: when the host has set
  // `editableCardKinds` and this card's kind isn't on the list, the
  // inner RichTextField mounts read-only. Omitted whitelist or
  // omitted `cardKind` falls back to fully editable (existing main-app
  // behavior).
  const chrome = useEditorChrome();
  const cardEditable = !forceReadOnly &&
    (!cardKind ||
    !chrome.editableCardKinds ||
    chrome.editableCardKinds.includes(cardKind));
  const compressedLines = useCompressedLines();
  const compressedBody = usePanelBodyStyle(panelKey);
  // A9 §C3: a "borrowed"-class kind (footnote/archive/example) with a resolved
  // body renders its compressed view via BorrowedMainText (real inline atoms),
  // clipped to compressedLines. Sans-class kinds keep the summary string.
  const useBorrowedCompressed =
    !!cardKind &&
    CARD_REGISTRY[cardKind].bodyClass === "borrowed" &&
    compressedContent != null;
  // Task 308 — the ONE place a card's body vocabulary is resolved. Derived from
  // the registry `bodySchema` facet and handed to BOTH body surfaces below
  // (RichTextField when expanded, BorrowedMainText when compressed), so a kind's
  // two views can never mount different schemas. Falls back to the narrow
  // authored-prose scope when the caller passes no kind — the historical
  // behavior for every non-card consumer of this primitive.
  const schemaScope: CardBodySchemaScope = kind
    ? bodySchemaForCardKind(kind)
    : "card";
  const [isFocused, setIsFocused] = useState(false);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Presence tier for the COLLAPSED borrowed body (perf Wave 3; flag off ⇒ 3
  // ⇒ legacy live branch). Policy "static": collapsed footnote/archive prose
  // is tier-1 static HTML regardless of nearness. Unconditional hook call;
  // consulted only inside the compressed borrowed switch.
  const borrowedTier = useCardTier("static", cardRef);
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

  // Per-card archive affordance — self-wired from the shared actions context (no
  // per-card-component threading). Shows iff the kind is archivable AND a real
  // provider is mounted; `archive` handles the atom splice + confirm for
  // footnote/citation. Distinct from the text-object Archive PANEL.
  const cardArchive = useCardArchiveActions();
  const archivable = isArchivable(kind) && cardArchive.enabled;
  const cardArchived = archivable && cardArchive.isArchived(id);
  const doArchive = archivable ? () => cardArchive.archive(kind, id) : undefined;

  // Restore-to-document — the un-archive verb, self-wired from its own actions
  // context on the SAME terms as the archive affordance above (task 106). Shows
  // iff the kind's body is a document EXCERPT (registry-derived, so a future
  // excerpt kind inherits it) AND a real provider is mounted. Threading this as
  // a prop is precisely what left the feature dead for a year: declared on the
  // panel, drilled through three layers, never destructured.
  const cardRestore = useCardRestoreActions();
  // Not on an already-SET-ASIDE card: a successful restore is what put it in
  // that state, so the control there could only refuse. (The user un-sets-aside
  // first if they want to hand the excerpt back a second time.)
  const restorable = isExcerptCardKind(kind) && cardRestore.enabled && !cardArchived;
  const doRestore = restorable ? () => cardRestore.restore(kind, id) : undefined;

  /** Check whether the card has any visible USER content. Routes through the
   *  kind-aware `cardHasContent` (the SAME predicate `deleteMarginItem` uses),
   *  passing the card's content body + title — so the confirm sees the title a
   *  body-only read missed (REP-F7-01: a titled-but-empty-body report now
   *  confirms). `value` is the rich body (the kind's `content` field) and
   *  `bodyTitle` is the user title; together they cover every kind rendered via
   *  EditableCard with an `onDelete` (note/archive/footnote/report and the
   *  comment kinds — none of which has user content outside body+title). */
  const hasContent = useCallback(
    () => cardHasContent(kind, { content: value, title: bodyTitle }),
    [kind, value, bodyTitle],
  );

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
          {/* No `MenuRestore` twin here, deliberately: the only excerpt kind
              (`archive`) renders with `inlineDelete`, which suppresses this
              menu entirely — a menu item it can never reach would be exactly
              the dead affordance task 106 exists to kill. Add one WITH a
              surface that renders it, if a future excerpt kind needs it. */}
          {menuContent ?? ((onDelete || doArchive) ? (
            <ItemMenu>
              {doArchive && (
                <MenuArchive onClick={doArchive} isArchived={cardArchived} />
              )}
              {onDelete && <MenuDelete onClick={tryDelete} />}
            </ItemMenu>
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
      onArchiveClick={inlineDelete ? doArchive : undefined}
      onRestoreClick={inlineDelete ? doRestore : undefined}
      isArchived={cardArchived}
      extraCardClass={extraCardClass ? `${cursorClass} ${extraCardClass}` : cursorClass}
      title={title}
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
          <div
            style={{
              ...compressedBody,
              // Borrowed-body kinds render their preview <p> at the live
              // `--editor-line-height` prose pref (BorrowedMainText doesn't
              // override it), so the clamp ceiling must track the SAME factor
              // or the 2nd line clips (#42). Plain-summary kinds keep 1.4.
              // The var FALLBACK must equal the `.tiptap p` fallback
              // (globals.css:657) so an undefined var can't clamp tighter than
              // the rendered line.
              ...compressedBodyStyle(
                compressedLines,
                useBorrowedCompressed
                  ? { lineHeight: "var(--editor-line-height, 1.8)" }
                  : undefined,
              ),
            }}
          >
            {useBorrowedCompressed ? (
              // C24 (OMNI-F1-03): the borrowed branch never had the empty guard
              // the summary branch has, so an empty footnote/archive/example body
              // rendered a blank BorrowedMainText line instead of the muted
              // "empty" sentinel. Detect an empty body from its projected plain
              // text (same projection makeCompressedSummary uses) and show the
              // sentinel, matching the summary branch.
              richJsonToPlainText(compressedContent).trim() ? (
                // Presence tiers (perf Wave 3, flag virgil:card-tiers). The
                // collapsed borrowed body's policy is "static": T1 renders the
                // SAME pipeline as static HTML (StaticBorrowedText) instead of
                // mounting a read-only editor per collapsed card; T0 (the
                // doc-open ramp's first commit) shows the plain-text summary.
                // Flag off ⇒ borrowedTier === 3 ⇒ the legacy live branch,
                // byte-identical. Everything OUTSIDE this switch — the clamp
                // div, the C24 empty guard, the title row — is tier-invariant.
                borrowedTier >= 2 ? (
                  <BorrowedMainText
                    value={compressedContent}
                    instanceKey={`compressed:${cardKind}:${id}`}
                    variant="footnote"
                    schemaScope={schemaScope}
                    bodyStyle={compressedBody}
                  />
                ) : borrowedTier === 1 ? (
                  <StaticBorrowedText
                    value={compressedContent}
                    variant="footnote"
                    schemaScope={schemaScope}
                    bodyStyle={compressedBody}
                  />
                ) : (
                  makeCompressedSummary(compressedContent, compressedLines)
                )
              ) : (
                <CardEmptyText />
              )
            ) : (
              // C24 (REP-F1-01 / OMNI-F1-03): `??` only fires on null/undefined,
              // but every caller passes `makeCompressedSummary(...) || ""`, so an
              // empty body arrived as `''` and `??` never substituted the
              // sentinel — the card showed a blank line. `||` falls through on
              // the falsy empty string too, so an empty body now shows "empty".
              compressedSummary || <CardEmptyText />
            )}
          </div>
        </div>
      ) : (
      <div
        className={`relative ${PANEL.cardBody}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : " overflow-y-auto"}`}
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
        {aboveBody}
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
          schemaScope={schemaScope}
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
 * NoteCard, TodoRow, CutterCommentCard, RevisionRequestCard. Update the
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
  /** Scrollable list container wrapping all cards. The leading
   *  `panel-card-list` token is a STABLE hook (not a Tailwind utility) —
   *  Wave-4 Stage A keys `body.perf-contain .panel-card-list` containment
   *  on it, so every consumer of this constant inherits the rule. */
  list: "panel-card-list flex-1 overflow-y-auto px-2 py-2 space-y-2",
  /** Standard card-body padding (UI-consistency sweep, ratified
   *  2026-06-12). One token for EditableCard's expanded body and the
   *  bespoke bodies (citation rows, todo, highlight, AI request).
   *  Exemptions (intentionally keep their own padding): ExampleCard's
   *  sectioned strips (structured expex content); BibEntryCard's expanded
   *  body (the multi-pod publication-details + BibTeX-fields + annotations
   *  layout reads better at the roomier `cardInner` px-4 py-3 — backlog #28). */
  cardBody: "px-3 pt-1.5 pb-2",
  /** Inner padding for card content. Used by BibEntryCard's expanded body
   *  (see the `cardBody` exemption note above). */
  cardInner: "px-4 py-3 relative min-w-0",
  /** Expandable sub-pod with muted background (for fields, notes, etc.). */
  subpod: "rounded-md border border-edge-subtle bg-surface-muted/70 p-3 overflow-hidden",
  /** Sub-pod with white background (for rich-text editors, etc.). */
  subpodWhite: "rounded-md border border-edge-subtle bg-white overflow-hidden",
  /** Standard panel header bar — height set by --header-h so all headers align.
   *  Borderless: shares the body fill (--pod-panel), no divider — header and
   *  body read as one continuous warm sheet. */
  header: "px-4 h-[var(--header-h)] shrink-0 bg-[var(--pod-panel)]",
  /** Empty-state message. */
  empty: "p-6 text-center text-sm text-[var(--muted)]",
} as const;

/* ── Button primitive ──────────────────────────────────────────────
   Five variants, three sizes, codified in src/STYLE_GUIDE.md ("Buttons"),
   which also names the surfaces that stay hand-rolled BY DESIGN (stateful
   toggles). Don't hand-roll filled buttons; pick a
   variant. There is no "blue button" in Virgil — `warm` replaces the
   bg-blue-100 / bg-emerald-600 patterns that used to scatter across
   modal footers and suggestion flows. */

export type ButtonVariant = "primary" | "secondary" | "warm" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center rounded-md font-medium transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-btn-primary text-white hover:brightness-95",
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

/* ── Panel chrome context (close button) ──────────────────────────── */

/**
 * Context that lets `PanelHeader` render its trailing close X without
 * threading a close handler through every panel component. EditorPane
 * wraps each rendered panel with a provider carrying that panel's close
 * handler. `PanelClose` is the sole consumer.
 */
export interface PanelChromeValue {
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
 * Single source of truth for the popout-button visual. Used by card
 * chrome and imperative consumers (`createPopoutButtonEl`, for non-React
 * DOM trees). Variants only differ in the popped-out glyph:
 *   - "arrow": rect + down-arrow (the default)
 *   - "x":     bare X glyph      (CardPopoutButton, FloatChrome)
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
 * header (top-right). Styled identically to PanelClose:
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
 * Universal card-archive affordance — the set-aside sibling of
 * `CardTrashButton`. Absolute-positioned just left of the trash button at the
 * card's bottom-right, hover-revealed. Toggles: when the card is already
 * archived it reads "Unarchive" and shows a restore (box + up-arrow) glyph; a
 * second press un-archives. Distinct from the text-object Archive PANEL — this
 * is the per-card archived state (see `isArchivable`, cards/predicates.ts). The
 * host decides whether a confirm is needed (atom-bearing kinds) before invoking
 * `onClick`. Requires the outer card wrapper to be `position: relative`. */
export function CardArchiveButton({
  onClick,
  isArchived = false,
}: {
  onClick: (e: React.MouseEvent) => void;
  isArchived?: boolean;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className="iconbtn-sm absolute bottom-1.5 right-7 opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100 transition-opacity"
      aria-label={isArchived ? "Unarchive" : "Archive"}
      data-hint={isArchived ? "Unarchive" : "Archive"}
      data-hint-pos="above"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="5" rx="1" />
        {isArchived ? (
          <>
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="m9 14 3-3 3 3" />
          </>
        ) : (
          <>
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
          </>
        )}
      </svg>
    </button>
  );
}

/**
 * Restore-to-document affordance — the un-archive verb, and the third member of
 * the bottom-right overlay cluster (restore · archive · trash, each 22px apart,
 * hover-revealed). Renders only on an EXCERPT-bodied card (`isExcerptCardKind`),
 * whose body holds a verbatim slice of the document rather than authored prose:
 * pressing it hands that slice back to the prose at the caret and retires the
 * card.
 *
 * Deliberately NOT the box-and-arrow glyph `CardArchiveButton` shows in its
 * unarchived state — the two would sit 22px apart meaning different things. A
 * return arrow reads as "put it back where it came from", which is the verb.
 * Neutral tone: nothing is destroyed (the content moves), so this is not a
 * danger action. Requires the outer card wrapper to be `position: relative`. */
export function CardRestoreButton({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
      className="iconbtn-sm absolute bottom-1.5 right-[3.125rem] opacity-0 group-hover:opacity-70 hover:!opacity-100 focus:opacity-100 transition-opacity"
      aria-label="Restore to document"
      data-hint="Restore to document"
      data-hint-pos="above"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 14 4 9 9 4" />
        <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
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
  /** When provided, renders a bottom-right ARCHIVE button just left of the trash
   *  (the set-aside sibling of delete). The host wires whether a confirm runs
   *  first (atom-bearing kinds). Gated identically to `onTrashClick`
   *  (hover-revealed, suppressed while collapsed). */
  onArchiveClick?: () => void;
  /** When provided, renders a bottom-right RESTORE-to-document button left of
   *  the archive button — the un-archive verb for excerpt-bodied cards. Gated
   *  identically to `onTrashClick`. */
  onRestoreClick?: () => void;
  /** Whether this card is currently archived — flips the archive button to its
   *  "Unarchive" affordance. */
  isArchived?: boolean;
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
  /** Disables the (re)anchor drop button — only consulted when the kind is
   *  `isDroppable`. Inline kinds (citation) pass true while the card is an
   *  empty / keyless draft (it can't produce a `\cite{}` atom yet); footnotes
   *  never disable. Ignored for non-droppable kinds (no button renders). */
  dropDisabled?: boolean;
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
    onArchiveClick,
    onRestoreClick,
    isArchived,
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
    dropDisabled,
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
    // Equality-bailed (task 317). The RO fires once per card per frame of a
    // window/pane resize — every card in every open panel — and an
    // unconditional `setProperty` re-dirties layout on each one even when the
    // header height did not move (the editor-observer law's read-before-write
    // rule; the bail is also what terminates the var-write → resize → RO
    // feedback loop).
    let lastH = NaN;
    const update = () => {
      const h = header.getBoundingClientRect().height;
      if (h === lastH) return;
      lastH = h;
      el.style.setProperty("--pc-header-h", `${h}px`);
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
    const blocker = target.closest(INTERACTIVE_CONTROL_SELECTOR);
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
      // Selection marker on the card ROOT (co-located with `data-omni-entry`
      // for omni cards). Lets the omni "dim at rest" CSS exempt the selected
      // card via `[data-omni-entry]:not([data-selected])` without depending on
      // class internals. Present-only when selected (CSS matches on presence).
      data-selected={selected ? "" : undefined}
      className={`group relative ${themedCard(theme, selected, extraCardClass)}${isPoppedOut ? (chromeless ? " flex-1 min-h-0 flex flex-col" : " h-full flex flex-col") : ""}${className ? ` ${className}` : ""}`}
      style={{
        ...themedCardStyle(theme, selected, { isPoppedOut }),
        // Kind color for the card hover/selected outline rules (the
        // `[data-card-key]` color-mix rules in globals.css) — DERIVED from
        // the theme accent (CARD_THEMES / user color overrides), replacing
        // the hand-mirrored `[data-card-key^="float:card:<kind>:"]` CSS
        // prefix block. Every card passes `theme`, so all 16 kinds
        // (including bib / ai / example / error, which the old block
        // omitted) carry the right accent.
        "--link-anchor-color": theme.accent,
        ...style,
      } as React.CSSProperties}
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
            {/* (Re)anchor drop button — registry-gated (`isDroppable`), so it
                renders on every droppable kind across BOTH the docked card and
                the omni (same component). The `cardKey` IS the canonical
                `float:card:<kind>:<id>` the card already stamps as
                `data-card-key` (built via `buildFloatKey` upstream in
                `cardPopKey`), so `beginDropSession` can look the spec up. On a
                docked card it's the RIGHTMOST control; the jump chevron + X
                below render only when popped, landing left of it there — i.e.
                the drop button sits left of the X exactly when the X shows. */}
            {kind != null && cardKey && isDroppable(kind) && (
              <CardDropButton cardKey={cardKey} disabled={dropDisabled} />
            )}
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
      {onRestoreClick && !isCollapsed && (
        <CardRestoreButton onClick={onRestoreClick} />
      )}
      {onArchiveClick && !isCollapsed && (
        <CardArchiveButton onClick={onArchiveClick} isArchived={isArchived} />
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
   *  Each option receives the trigger button's bounding rect. A
   *  `disabled` option renders greyed-out and is inert.
   *  `onAdd` is ignored when `onAddOptions` is set. */
  onAddOptions?: {
    label: string;
    onClick: (anchorRect?: DOMRect) => void;
    disabled?: boolean;
  }[];
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
 *  one card kind.
 *
 *  Folded onto `<AnchoredMenu>` (task 143). What it hand-rolled before: a
 *  `document` mousedown closer, and a flip computed off a HARD-CODED size
 *  estimate (`POPUP_H = 28 · options.length + 8`, `POPUP_W = 160`) that no row
 *  height was ever checked against — with no clamp behind it, so an estimate
 *  that ran short simply pushed rows off the viewport. The shell measures the
 *  rendered menu instead, clamps + scrolls what still doesn't fit, re-anchors
 *  on resize, and adds the Escape the old menu never had. The option contract
 *  (label / disabled / the trigger rect handed to `onClick` so the Bibliography
 *  picker can anchor to "+") is unchanged. */
function HeaderAddDropdown({
  options,
}: {
  options: {
    label: string;
    onClick: (anchorRect?: DOMRect) => void;
    disabled?: boolean;
  }[];
}) {
  return (
    <AnchoredMenu
      ariaLabel="Add"
      align="start"
      triggerHint="Add"
      triggerClassName="iconbtn-sm"
      wrapperClassName="relative inline-flex items-center"
      menuClassName="min-w-[140px]"
      trigger={() => (
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
      )}
    >
      {({ close, anchorRect }) =>
        options.map((o, i) => (
          <MenuActionRow
            key={o.label}
            // The id becomes a real DOM `id` (and, wherever a menu wires
            // `getActiveDescendantHost`, an `aria-activedescendant` reference),
            // and HTML forbids whitespace in one — every add-menu label has a
            // space in it ("Search library…"). Slugged, with the index kept so
            // two labels that slug alike can't collide in the registry.
            id={`${i}-${o.label.replace(/[^a-zA-Z0-9_-]+/g, "-")}`}
            label={o.label}
            disabled={o.disabled}
            onSelect={() => {
              close();
              o.onClick(anchorRect ?? undefined);
            }}
          />
        ))
      }
    </AnchoredMenu>
  );
}

/* ── Band divider (stacked-panel boundary) ────────────────────────── */

/**
 * Draggable boundary between two adjacent docked bands in a column's
 * stack. Rather than converting mouse-Y to a 0..1 ratio of the container,
 * `BandDivider` trades absolute pixel heights between the two bands it
 * sits between: the boundary slides, conserving their sum.
 *
 * At drag start it captures both adjacent band anchors' current rendered
 * heights (via their `data-dock-slot` keys). Live geometry is an imperative
 * flex write on BOTH anchors per frame (RAF-coalesced by the pane-resize
 * engine); `onTradeHeight(aboveId, aboveH, belowId, belowH)` commits ONCE on
 * release, each height clamped ≥ MIN_BAND_PX by the consumer
 * (viewPrefs.tradePanelHeights) — and defensively here too.
 *
 * Reuses the same `.drag-gap.drag-gap-h` visual as the editor split's
 * divider, sitting in the `var(--pod-gap)` gutter the flex column
 * reserves between bands.
 */
export function BandDivider({
  side,
  aboveId,
  belowId,
  onTradeHeight,
  containerRef,
}: {
  side: Side;
  aboveId: PanelId;
  belowId: PanelId;
  onTradeHeight: (aboveId: PanelId, aboveH: number, belowId: PanelId, belowH: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Per-gesture snapshots, taken in getValue() — the engine's single
  // start-edge read point. The inline flex STRINGS are recorded so cancel /
  // zero-move end paths restore the DOM exactly as React rendered it (a
  // content-sized band is `0 1 auto` — no pixel value in state to re-derive).
  const elsRef = useRef<{ above: HTMLElement | null; below: HTMLElement | null }>({
    above: null,
    below: null,
  });
  const startRef = useRef({ above: 0, sum: 0, aboveFlex: "", belowFlex: "" });

  const restoreStartFlex = () => {
    const { above, below } = elsRef.current;
    if (above) above.style.flex = startRef.current.aboveFlex;
    if (below) below.style.flex = startRef.current.belowFlex;
  };

  const handle = usePaneResizeHandle({
    id: `band-divider-${side}-${aboveId}-${belowId}`,
    axis: "y",
    getValue: () => {
      const root = containerRef.current ?? document;
      const above = root.querySelector<HTMLElement>(`[data-dock-slot][data-panel-id="${aboveId}"]`);
      const below = root.querySelector<HTMLElement>(`[data-dock-slot][data-panel-id="${belowId}"]`);
      elsRef.current = { above, below };
      const aboveH = above?.getBoundingClientRect().height ?? MIN_BAND_PX;
      const belowH = below?.getBoundingClientRect().height ?? MIN_BAND_PX;
      startRef.current = {
        above: aboveH,
        sum: aboveH + belowH,
        aboveFlex: above?.style.flex ?? "",
        belowFlex: below?.style.flex ?? "",
      };
      return aboveH;
    },
    // Clamp the boundary so neither band drops below MIN_BAND_PX.
    clamp: (px) =>
      Math.max(MIN_BAND_PX, Math.min(px, startRef.current.sum - MIN_BAND_PX)),
    // The boundary slides by trading the conserved sum between the two
    // anchors — two imperative style writes per frame, zero React state
    // until release (the old path ran onTradeHeight → viewPrefs →
    // localStorage per mousemove).
    apply: (px) => {
      const { above, below } = elsRef.current;
      if (above) above.style.flex = `0 0 ${px}px`;
      if (below) below.style.flex = `0 0 ${startRef.current.sum - px}px`;
    },
    commit: (px) => {
      // Zero-move end (a plain click, or a drag returned to its start):
      // don't pin content-sized bands to pixel heights — restore the
      // rendered flex strings instead of persisting.
      if (px === startRef.current.above) {
        restoreStartFlex();
        return;
      }
      onTradeHeight(aboveId, px, belowId, startRef.current.sum - px);
    },
    restore: restoreStartFlex,
  });

  return (
    <div
      data-band-divider={side}
      className="relative shrink-0 z-10"
      // pointer-events:auto — the stack frame sits inside the column's
      // pointer-events:none pass-through overlay (Layer B); re-enable it
      // here or a real mouse can't grab the divider (only synthetic
      // dispatch, which bypasses hit-testing, could).
      style={{ height: 'var(--pod-gap)', pointerEvents: 'auto' }}
    >
      {/* Drag gap — visible grip slider (band-grip): muted at rest,
          accent on hover/drag. */}
      <div
        className="drag-gap drag-gap-h band-grip band-grip-occlude w-full h-full"
        {...handle}
      >
        {/* Wider invisible hit target — a CHILD of the handle so a grab here
            bubbles to the captured element and the `.dragging` grip chrome
            lands on the visible gap. */}
        <div
          className="absolute inset-x-0 cursor-row-resize"
          style={{ top: -4, bottom: -4, background: "transparent" }}
        />
      </div>
    </div>
  );
}

/* ── Three-dot item menu ─────────────────────────────────────────── */

export function ItemMenu({
  children,
  align = "right",
  hint = "Options",
}: {
  children: ReactNode;
  /** Which edge of the button the dropdown aligns to. Use "left" for
   *  menu buttons near the left edge of a panel (dropdown drops right),
   *  "right" (default) for buttons near the right edge of a card. */
  align?: "left" | "right";
  /** Trigger tooltip. Defaults to the generic "Options"; override when the
   *  menu's contents are narrower than that (Outline's is "View options"). */
  hint?: string;
}) {
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

  // Panel-header menus sit at the far left and use a bare button (no
  // rounded lozenge / hover background) for a lighter-weight look.
  // Card-level menus keep the button-style treatment.
  const isPanelHeader = align === "left";
  return (
    // Folded onto the canonical `<Menu>` primitive in task 180 (retiring a
    // hand-rolled `fixed z-[9999]` portal + bespoke mousedown listener that was
    // trapped below floats in a stacking context and collided with
    // DROP_INDICATOR_Z), and onto `<AnchoredMenu>` in task 143 — which is the
    // same fold one level further out: the open-state / anchor-rect /
    // trackAnchor / excludeRefs / trigger-ARIA plumbing this component used to
    // own is the very plumbing the three remaining hand-rolled dropdowns each
    // re-derived (and each dropped a different guard from). `closeOnInsideClick`
    // preserves this menu's "any click inside dismisses" semantics + the
    // stopPropagation fence against the card header, which its opaque, arbitrary
    // button children can't express themselves. Chrome kept byte-identical
    // apart from the added `maxHeight` clamp.
    <AnchoredMenu
      ariaLabel="Options"
      align={align === "left" ? "start" : "end"}
      gap={4}
      triggerHint={hint}
      triggerClassName={isPanelHeader ? "iconbtn-sm" : "iconbtn-md"}
      wrapperClassName={`relative shrink-0${isPanelHeader ? " -ml-3" : ""}`}
      menuClassName="min-w-[100px]"
      closeOnInsideClick
      // The clamp is ON — the shell's default — as of task 181, and the reason
      // it was ever off is worth keeping: the clamp implies `overflow-y: auto`,
      // a scroll container clips its absolutely-positioned descendants (and
      // `overflow-x` computes to `auto` alongside it, so on both axes), and
      // every panel-header kebab opens with a `<PanelThemePicker>` row whose
      // swatch grid used to be exactly such a popup — an `absolute top-full`
      // surface 168px wide inside a `min-w-[100px]` menu. Clamping then would
      // have cut the picker off. The picker now PORTALS (its own `AnchoredMenu`,
      // a body child at the chrome z-tier), so there is nothing left inside this
      // menu for a scroll container to clip, and the kebab gets what every other
      // menu already had: a long menu near the bottom of the window flips up and
      // scrolls instead of rendering rows nobody can reach. Re-introducing a
      // non-portaled absolute popup as a kebab row would silently re-break this
      // — put it on the primitive instead.
      trigger={() => (
        <svg width={isPanelHeader ? 14 : 16} height={isPanelHeader ? 14 : 16} viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      )}
    >
      {enhancedChildren}
    </AnchoredMenu>
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

/** Three-dot menu item that archives (or unarchives) the card — the set-aside
 *  sibling of `MenuDelete`, used by cards whose delete lives in the header menu
 *  rather than the bottom-right trash overlay. Neutral tone (archive is
 *  reversible, unlike delete). */
export function MenuArchive({
  onClick,
  isArchived = false,
  label,
}: {
  onClick: () => void;
  isArchived?: boolean;
  label?: string;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover:bg-surface-muted-strong transition-colors"
    >
      {label ?? (isArchived ? "Unarchive" : "Archive")}
    </button>
  );
}

