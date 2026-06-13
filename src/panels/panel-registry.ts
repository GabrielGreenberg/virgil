/**
 * Single source of truth for panel↔card taxonomy.
 *
 * Every panel in the app is declared here. The registry maps `PanelKind`
 * to display label, optional card kind + popout-key prefix, omni
 * eligibility, and the per-panel folder path. Other systems
 * (`EditorLayout` chrome, `OmniViewPanel` filter, `popKey()` helper) read
 * from here instead of maintaining their own tables.
 *
 * Popout key prefixes are intentionally the same strings used today by
 * `useViewPrefs.poppedOutCards` (persisted to localStorage). Don't
 * rename them without a migration.
 */

import type { CARD_THEMES } from "@/components/panel-primitives";
import type { PanelKind, CardKind } from "./_shared/types";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { buildFloatKey } from "@/floats/float-key";

type ThemeKey = keyof typeof CARD_THEMES;

export interface CardLink {
  kind: CardKind;
  /** Popout-key prefix. `${prefix}:${id}` is the persisted card key. */
  keyPrefix: string;
  /** `CARD_THEMES` key, or null when the card doesn't render through the
   *  shared `themedCard` machinery. */
  themeKey: ThemeKey | null;
}

export interface PanelRegistryEntry {
  kind: PanelKind;
  label: string;
  /** Per-panel folder path (relative to repo root). Used by Cowork to
   *  navigate directly to a panel's source. */
  folder: string;
  card: CardLink | null;
  /** Whether this panel's items appear in the Omni view. */
  omniEligible: boolean;
  /** Which omni column this panel's items default to. */
  omniSide: "left" | "right" | null;
  /** Default sidebar strip side. Mirrors `useViewPrefs.DEFAULT_PREFS.placements`. */
  defaultStripSide: "left" | "right" | null;
}

export const PANEL_REGISTRY: Record<PanelKind, PanelRegistryEntry> = {
  notes: {
    kind: "notes",
    label: "Notes",
    folder: "src/panels/Notes",
    // Polymorphic — hosts both `note` and `highlight` card kinds. See
    // POLYMORPHIC_CARD_PANEL below.
    card: null,
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  footnotes: {
    kind: "footnotes",
    label: "Footnotes",
    folder: "src/panels/Footnotes",
    card: { kind: "footnote", keyPrefix: "footnote", themeKey: "footnote" },
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  citations: {
    kind: "citations",
    label: "Citations",
    folder: "src/panels/Citations",
    card: { kind: "citation", keyPrefix: "citation", themeKey: "citation" },
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  bibliography: {
    kind: "bibliography",
    label: "Bibliography",
    folder: "src/panels/Bibliography",
    card: { kind: "bib", keyPrefix: "bib", themeKey: "bib" },
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  reports: {
    kind: "reports",
    label: "Reports",
    folder: "src/panels/Reports",
    // Polymorphic — hosts both `report` and `report-request` card kinds.
    // See POLYMORPHIC_CARD_PANEL below.
    card: null,
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  examples: {
    kind: "examples",
    label: "Examples",
    folder: "src/panels/Examples",
    card: { kind: "example", keyPrefix: "example", themeKey: "example" },
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  todo: {
    kind: "todo",
    label: "Todo List",
    folder: "src/panels/Todo",
    card: { kind: "todo", keyPrefix: "todo", themeKey: "todo" },
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  archive: {
    kind: "archive",
    label: "Archived Text",
    folder: "src/panels/Archive",
    card: { kind: "archive", keyPrefix: "archive", themeKey: "archive" },
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  revisions: {
    kind: "revisions",
    label: "Revisions",
    folder: "src/panels/Revisions",
    card: { kind: "revision-comment", keyPrefix: "revision", themeKey: "revision" },
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  cutter: {
    kind: "cutter",
    label: "Cutter",
    folder: "src/panels/Cutter",
    // Polymorphic — hosts both `cutter-comment` and `cutter-suggestion`
    // card kinds. The shared marker/theme/typography for the panel still
    // live under the legacy "cut" keys (see CARD_KEY_PREFIXES below,
    // MARKER_META["cut"], CARD_THEMES.cut, panel-typography "cut").
    card: null,
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  outline: {
    kind: "outline",
    label: "Outline",
    folder: "src/panels/Outline",
    card: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  search: {
    kind: "search",
    label: "Search",
    folder: "src/panels/Search",
    card: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  wordcount: {
    kind: "wordcount",
    label: "Word Count",
    folder: "src/panels/WordCount",
    card: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "right",
  },
  errors: {
    kind: "errors",
    label: "Errors",
    folder: "src/panels/Errors",
    card: { kind: "error", keyPrefix: "error", themeKey: "error" },
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  omni: {
    kind: "omni",
    label: "Omni-view",
    folder: "src/panels/Omni",
    card: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: null,
  },
};

/** Canonical key-prefix per card kind. **DERIVED from `CARD_REGISTRY`**
 *  (`src/cards/card-registry`) — the single source of truth for popout keys
 *  and OmniView prefix taxonomy. Don't hand-edit; add a registry entry. */
export const CARD_KEY_PREFIXES: Record<CardKind, string> = Object.fromEntries(
  (Object.keys(CARD_REGISTRY) as CardKind[]).map((k) => [k, CARD_REGISTRY[k].keyPrefix]),
) as Record<CardKind, string>;

/** Display label for a card type, shown as a small uppercase overline
 *  in OmniView (and always shown for Comment / Suggestion families). The
 *  pattern was first introduced on Comment cards in Revisions/Cutter; this
 *  registry extends it to every card kind so multi-panel mixes in OmniView
 *  are visually disambiguated.
 *
 *  Distinct from `CARD_TITLE_LABELS` (auto-titling prefix) — that map has
 *  nulls for kinds that don't auto-title. Type labels are required for
 *  every kind since they're rendered as a static overline. */
export const CARD_TYPE_LABELS: Record<CardKind, string> = Object.fromEntries(
  (Object.keys(CARD_REGISTRY) as CardKind[]).map((k) => [k, CARD_REGISTRY[k].label]),
) as Record<CardKind, string>;

export function cardTypeLabel(kind: CardKind): string {
  return CARD_TYPE_LABELS[kind];
}

/** Singular display name for a card type, used as the auto-title prefix
 *  when a new card is created (e.g. "Note 3", "Footnote 1"). null = the
 *  kind opts out of auto-titling because it has no user-editable title
 *  field (citations are LaTeX-keyed, comments are threaded, suggestions /
 *  ai-requests / bib entries / errors are externally generated). */
export const CARD_TITLE_LABELS: Record<CardKind, string | null> = Object.fromEntries(
  (Object.keys(CARD_REGISTRY) as CardKind[]).map((k) => [k, CARD_REGISTRY[k].titleLabel]),
) as Record<CardKind, string | null>;

/** Default title for a freshly created card: `${label} ${currentCount + 1}`.
 *  Returns "" for kinds that opt out (label is null).
 *
 *  NOTE (BUG #31): creation sites no longer PERSIST this. The generated title
 *  is dead as stored data — it lives only as the historical shape that
 *  `isAutoTitle` strips on load. Kept for tests / any future ephemeral use. */
export function nextCardTitle(kind: CardKind, currentCount: number): string {
  const label = CARD_TITLE_LABELS[kind];
  if (!label) return "";
  return `${label} ${currentCount + 1}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when `title` is EXACTLY a legacy auto-generated title for `kind` — the
 *  `^<Label> <digits>$` shape `nextCardTitle` used to persist (BUG #31). The
 *  label is the kind's own `CARD_TITLE_LABELS` prefix (regex-escaped, so the
 *  two-word "Archive Text" matches literally), so this is per-kind precise:
 *  "Archive Text 1" is auto for archive, but "Footnote on Frege" or
 *  "Chapter 2" survive (no leading kind label, or extra words after it).
 *  Returns false for kinds that never auto-titled (label null) and for any
 *  non-string / empty input, so a real title is never nulled by accident.
 *
 *  Used by the per-kind sidecar migrators to drop a stale generated title on
 *  load (so collapsed/expanded rows fall back to the placeholder / +T). */
export function isAutoTitle(kind: CardKind, title: unknown): boolean {
  if (typeof title !== "string") return false;
  const label = CARD_TITLE_LABELS[kind];
  if (!label) return false;
  return new RegExp(`^${escapeRegExp(label)} \\d+$`).test(title);
}

/** `float:card:<kind>:<id>` — the unified popout key for this panel's primary
 *  card kind (AF grammar). Throws if the panel has no card kind. Delegates to
 *  `cardPopKey` via the panel's declared `card.kind` (so the revisions panel
 *  yields `revision-comment`; the suggestion card builds its own key directly). */
export function popKey(panelKind: PanelKind, id: string): string {
  const entry = PANEL_REGISTRY[panelKind];
  if (!entry.card) {
    throw new Error(`Panel "${panelKind}" has no card kind`);
  }
  return cardPopKey(entry.card.kind, id);
}

/** `float:card:<kind>:<id>` — the unified popout key by card kind (AF grammar,
 *  via `buildFloatKey`). The single chokepoint that flips the card side from the
 *  legacy `<prefix>:<id>` shape to `float:card:<kind>:<id>`. */
export function cardPopKey(cardKind: CardKind, id: string): string {
  return buildFloatKey({ domain: "card", kind: cardKind, id });
}

/** `[data-card-key="float:card:<kind>:<id>"]` — the DOM selector that matches the
 *  `data-card-key` a panel card stamps. The ONE helper every consumer that hunts
 *  a card in the DOM by (kind,id) must use; hand-building `[data-card-key="…"]`
 *  re-introduces the legacy-grammar drift the AF flip exposed (the card stamps
 *  `cardPopKey`, not `<prefix>:<id>`). Keep the grammar in `cardPopKey` only. */
export function cardDomSelector(cardKind: CardKind, id: string): string {
  return `[data-card-key="${cardPopKey(cardKind, id)}"]`;
}

export function getPanelByCardKind(cardKind: CardKind): PanelRegistryEntry | null {
  // Inverted polymorphic model: each kind declares its owning panel in
  // CARD_REGISTRY (`src/cards/card-registry`); membership derives. Replaces the
  // old PANEL_REGISTRY.card scan + the hand-kept POLYMORPHIC_CARD_PANEL map.
  const panel = CARD_REGISTRY[cardKind].panel;
  return panel ? PANEL_REGISTRY[panel] : null;
}

/** All panels that contribute items to the Omni view, in registry order. */
export const OMNI_PANELS: PanelRegistryEntry[] = Object.values(PANEL_REGISTRY).filter(
  (e) => e.omniEligible,
);
