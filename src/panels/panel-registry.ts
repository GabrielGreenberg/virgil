/**
 * Single source of truth for panel↔card taxonomy.
 *
 * Every panel in the app is declared here. The registry maps `PanelKind`
 * to display label, optional card kind + popout-key prefix, and omni
 * eligibility. Other systems (`EditorLayout` chrome, `OmniViewPanel` filter,
 * `popKey()` helper) read from here instead of maintaining their own tables.
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
  card: CardLink | null;
  /** Whether this panel's items appear in the Omni view. */
  omniEligible: boolean;
  /** Default sidebar strip side. Mirrors `useViewPrefs.DEFAULT_PREFS.placements`.
   *
   *  THE panel's side default — the last rung of the `@/lib/panel-side` ladder,
   *  which every surface reads: the strip icon, the card's margin marker and
   *  rail, and (since task 381) the omni COLUMN its cards render in. A separate
   *  `omniSide` column used to answer the last of those and was retired with it
   *  — one panel, one side. */
  defaultStripSide: "left" | "right" | null;
}

export const PANEL_REGISTRY: Record<PanelKind, PanelRegistryEntry> = {
  notes: {
    kind: "notes",
    label: "Notes",
    // Polymorphic — hosts both `note` and `highlight` card kinds. Membership
    // is registry-derived (`cardKindsForPanel("notes")` in cards/predicates.ts,
    // each kind declares its panel in CARD_REGISTRY); `card` stays null.
    card: null,
    omniEligible: true,
    defaultStripSide: "right",
  },
  footnotes: {
    kind: "footnotes",
    label: "Footnotes",
    card: { kind: "footnote", keyPrefix: "footnote", themeKey: "footnote" },
    omniEligible: true,
    defaultStripSide: "left",
  },
  citations: {
    kind: "citations",
    label: "Citations",
    card: { kind: "citation", keyPrefix: "citation", themeKey: "citation" },
    omniEligible: true,
    defaultStripSide: "left",
  },
  bibliography: {
    kind: "bibliography",
    label: "Bibliography",
    card: { kind: "bib", keyPrefix: "bib", themeKey: "bib" },
    omniEligible: false,
    defaultStripSide: "left",
  },
  reports: {
    kind: "reports",
    label: "Reports",
    // Polymorphic — hosts both `report` and `report-request` card kinds.
    // Membership is registry-derived (`cardKindsForPanel("reports")` in
    // cards/predicates.ts); `card` stays null.
    card: null,
    omniEligible: true,
    // RIGHT since task 381 (Gabriel's call). The shipped
    // `useViewPrefs.defaults.json` placement flips in lockstep — the task-223
    // release-snapshot contract pins the two — and stored prefs are carried
    // over by the one-shot `PANEL_SIDE_MIGRATIONS` entry, without which the
    // loader's merge-only-missing-ids rule would leave every existing user on
    // left forever (and the promote-defaults cron would fold left back into
    // the JSON).
    defaultStripSide: "right",
  },
  examples: {
    kind: "examples",
    label: "Examples",
    card: { kind: "example", keyPrefix: "example", themeKey: "example" },
    omniEligible: true,
    defaultStripSide: "left",
  },
  todo: {
    kind: "todo",
    label: "Todo List",
    card: { kind: "todo", keyPrefix: "todo", themeKey: "todo" },
    omniEligible: true,
    defaultStripSide: "right",
  },
  archive: {
    kind: "archive",
    label: "Archived Text",
    card: { kind: "archive", keyPrefix: "archive", themeKey: "archive" },
    omniEligible: true,
    defaultStripSide: "right",
  },
  revisions: {
    kind: "revisions",
    label: "Revisions",
    card: { kind: "revision-comment", keyPrefix: "revision", themeKey: "revision" },
    omniEligible: true,
    defaultStripSide: "right",
  },
  cutter: {
    kind: "cutter",
    label: "Cutter",
    // Polymorphic — hosts both `cutter-comment` and `cutter-suggestion`
    // card kinds. The shared marker/theme/typography for the panel still
    // live under the legacy "cut" keys (see CARD_KEY_PREFIXES below,
    // MARKER_META["cut"], CARD_THEMES.cut, panel-typography "cut").
    card: null,
    omniEligible: true,
    defaultStripSide: "right",
  },
  outline: {
    kind: "outline",
    label: "Outline",
    card: null,
    omniEligible: false,
    defaultStripSide: "left",
  },
  search: {
    kind: "search",
    label: "Search",
    card: null,
    omniEligible: false,
    defaultStripSide: "left",
  },
  wordcount: {
    kind: "wordcount",
    label: "Word Count",
    card: null,
    omniEligible: false,
    defaultStripSide: "right",
  },
  errors: {
    kind: "errors",
    label: "Errors",
    card: { kind: "error", keyPrefix: "error", themeKey: "error" },
    omniEligible: true,
    defaultStripSide: "right",
  },
  omni: {
    kind: "omni",
    label: "Omni-view",
    card: null,
    omniEligible: false,
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
 *  NOTE (BUG #31 / T6-C12): creation sites no longer PERSIST this — a fresh card
 *  is created blank + `titleAuto: true` (recorded provenance, FORK-1). The
 *  generated string is no longer the oracle for "was this machine-generated?";
 *  the recorded `titleAuto` bit is (see `resolveLoadedTitle`). Kept for tests /
 *  any future ephemeral use (e.g. a faded placeholder for an auto title). */
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
 *  DEMOTED (T6/C12): this shape heuristic is **provably ambiguous** — a
 *  generated "Report 8" and a user-typed "Report 8" are byte-identical, so it
 *  silently strips a real title (REP-A2-02 [HIGH] + the ~5-site false-positive
 *  class). It is now reachable ONLY as the one-time legacy fallback inside
 *  `resolveLoadedTitle`, for pre-T6 records that carry no `titleAuto` bit. After
 *  the migration write-back stamps the bit, the heuristic is never consulted
 *  again for that record. Kept exported for the auto-title test + that fallback;
 *  do NOT add new direct callers — read recorded provenance via
 *  `resolveLoadedTitle` instead. */
export function isAutoTitle(kind: CardKind, title: unknown): boolean {
  if (typeof title !== "string") return false;
  const label = CARD_TITLE_LABELS[kind];
  if (!label) return false;
  return new RegExp(`^${escapeRegExp(label)} \\d+$`).test(title);
}

/** Decide a card's effective title (or todo body) on load from RECORDED
 *  provenance (T6/C12), with a one-time legacy fallback to the shape heuristic
 *  for pre-migration records that have no `titleAuto` bit yet. This replaces the
 *  `isAutoTitle(kind, title) ? "" : title` strip at the five sidecar load sites
 *  (reports / archive / notes / todos / examples) — the title's *shape* is no
 *  longer the oracle for "was this machine-generated?"; recorded provenance is.
 *
 *  Truth table:
 *   - `title` not a string             → "" (never strands a non-string)
 *   - `titleAuto === false`            → keep `title` ALWAYS (user-owned)
 *   - `titleAuto === true`             → "" (recorded generated, drop)
 *   - `titleAuto === undefined`        → legacy record: fall back to the shape
 *     heuristic ONCE. The caller pairs this with `resolveTitleAuto` to stamp the
 *     resolved bit back, so the guess happens at most once per record, ever.
 *
 *  Strictly no-worse-than-today: the legacy branch is identical to the current
 *  (BUG #31) behavior, so no existing paper regresses; it self-heals on the
 *  migration write-back. */
export function resolveLoadedTitle(
  kind: CardKind,
  title: unknown,
  titleAuto: boolean | undefined,
): string {
  if (typeof title !== "string") return "";
  if (titleAuto === false) return title; // user-owned → keep, always
  if (titleAuto === true) return ""; // recorded generated → drop
  // Legacy record (no recorded bit): the ONLY surviving isAutoTitle caller.
  return isAutoTitle(kind, title) ? "" : title;
}

/** Resolve the `titleAuto` provenance bit a migrator should STAMP onto a record
 *  on load, given the stored title and stored bit (T6/C12). Self-stamping +
 *  forward-only: an explicit bit is preserved verbatim; a legacy record
 *  (`undefined`) derives the bit ONCE from the shape heuristic so the record is
 *  permanently classified and `resolveLoadedTitle` never guesses again. Pair
 *  with `resolveLoadedTitle` at every load/migrate site so the stored title and
 *  the stamped bit stay consistent. */
export function resolveTitleAuto(
  kind: CardKind,
  title: unknown,
  titleAuto: boolean | undefined,
): boolean {
  if (titleAuto === true || titleAuto === false) return titleAuto;
  return isAutoTitle(kind, title);
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
