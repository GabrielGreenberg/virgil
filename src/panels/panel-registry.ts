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

type ThemeKey = keyof typeof CARD_THEMES;

export interface CardLink {
  kind: CardKind;
  /** Popout-key prefix. `${prefix}:${id}` is the persisted card key. */
  keyPrefix: string;
  /** `CARD_THEMES` key, or null when the card has no themed variant
   *  (e.g. quotation cards use the default `panelCard` styling). */
  themeKey: ThemeKey | null;
}

export interface PanelRegistryEntry {
  kind: PanelKind;
  label: string;
  /** Per-panel folder path (relative to repo root). Used by Cowork to
   *  navigate directly to a panel's source. */
  folder: string;
  card: CardLink | null;
  /** Default view-mode for panels that support a list/in-text toggle.
   *  null means the panel has no view-mode toggle. */
  defaultViewMode: "list" | "in-text" | null;
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
    card: { kind: "note", keyPrefix: "note", themeKey: "note" },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  footnotes: {
    kind: "footnotes",
    label: "Footnotes",
    folder: "src/panels/Footnotes",
    card: { kind: "footnote", keyPrefix: "footnote", themeKey: "footnote" },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  citations: {
    kind: "citations",
    label: "Citations",
    folder: "src/panels/Citations",
    card: { kind: "citation", keyPrefix: "citation", themeKey: "citation" },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  bibliography: {
    kind: "bibliography",
    label: "Bibliography",
    folder: "src/panels/Bibliography",
    card: { kind: "bib", keyPrefix: "bib", themeKey: "bib" },
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  quotations: {
    kind: "quotations",
    label: "Quotations",
    folder: "src/panels/Quotations",
    card: { kind: "quotation", keyPrefix: "quotation", themeKey: null },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "left",
    defaultStripSide: "left",
  },
  todo: {
    kind: "todo",
    label: "Todo List",
    folder: "src/panels/Todo",
    card: { kind: "todo", keyPrefix: "todo", themeKey: "todo" },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  archive: {
    kind: "archive",
    label: "Archived Text",
    folder: "src/panels/Archive",
    card: { kind: "archive", keyPrefix: "archive", themeKey: "archive" },
    defaultViewMode: "list",
    omniEligible: true,
    omniSide: "right",
    defaultStripSide: "right",
  },
  revisions: {
    kind: "revisions",
    label: "Revisions",
    folder: "src/panels/Revisions",
    card: { kind: "comment", keyPrefix: "revision", themeKey: "comment" },
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "right",
  },
  cutter: {
    kind: "cutter",
    label: "Cutter",
    folder: "src/panels/Cutter",
    card: { kind: "cut", keyPrefix: "cut", themeKey: "cut" },
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "right",
  },
  outline: {
    kind: "outline",
    label: "Outline",
    folder: "src/panels/Outline",
    card: null,
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  search: {
    kind: "search",
    label: "Search",
    folder: "src/panels/Search",
    card: null,
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "left",
  },
  wordcount: {
    kind: "wordcount",
    label: "Word Count",
    folder: "src/panels/WordCount",
    card: null,
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "right",
  },
  errors: {
    kind: "errors",
    label: "Errors",
    folder: "src/panels/Errors",
    card: { kind: "error", keyPrefix: "error", themeKey: "error" },
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: "right",
  },
  suggestions: {
    kind: "suggestions",
    label: "Suggestions",
    folder: "src/panels/Suggestions",
    card: null,
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: null,
  },
  omni: {
    kind: "omni",
    label: "Omni-view",
    folder: "src/panels/Omni",
    card: null,
    defaultViewMode: null,
    omniEligible: false,
    omniSide: null,
    defaultStripSide: null,
  },
};

/** Canonical key-prefix per card kind. Source of truth for popout keys
 *  and OmniView prefix taxonomy. AI requests appear in multiple panels
 *  so they don't have a parent panel — listed here directly. */
export const CARD_KEY_PREFIXES: Record<CardKind, string> = {
  note: "note",
  footnote: "footnote",
  archive: "archive",
  todo: "todo",
  bib: "bib",
  citation: "citation",
  comment: "revision",
  cut: "cut",
  quotation: "quotation",
  ai: "ai",
  error: "error",
};

/** `${keyPrefix}:${id}` — canonical popout key for this card. Throws if
 *  the panel has no card kind. */
export function popKey(panelKind: PanelKind, id: string): string {
  const entry = PANEL_REGISTRY[panelKind];
  if (!entry.card) {
    throw new Error(`Panel "${panelKind}" has no card kind`);
  }
  return `${entry.card.keyPrefix}:${id}`;
}

/** `${keyPrefix}:${id}` — canonical popout key by card kind. Use for
 *  cross-cutting card kinds (e.g. AI requests) that aren't owned by a
 *  single panel. */
export function cardPopKey(cardKind: CardKind, id: string): string {
  return `${CARD_KEY_PREFIXES[cardKind]}:${id}`;
}

export function getPanelByCardKind(cardKind: CardKind): PanelRegistryEntry | null {
  for (const entry of Object.values(PANEL_REGISTRY)) {
    if (entry.card?.kind === cardKind) return entry;
  }
  return null;
}

/** All panels that contribute items to the Omni view, in registry order. */
export const OMNI_PANELS: PanelRegistryEntry[] = Object.values(PANEL_REGISTRY).filter(
  (e) => e.omniEligible,
);
