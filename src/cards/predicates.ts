/**
 * Canonical card-kind predicates — all derived from `CARD_REGISTRY`. These
 * replace the six parallel kind-enums and the polymorphic-panel branches
 * (audit §4.4): every "is this kind X?" / "which kinds belong to panel P?"
 * question reads the registry, never a hand-kept list.
 *
 * Keep these over the STATIC registry only — never filter live records (that
 * would re-introduce a doc walk; keystroke sanctity). They are O(1) map reads.
 *
 * `cardKindFromRecord(record, panel)` — the read-side classifier for the one
 * residue of comment/suggestion (and report/report-request) polymorphism — is
 * built below. It resolves an on-disk record's *data discriminator*
 * (`record.kind`) to its spine `CardKind`, disambiguated by the owning panel
 * (cutter vs revision both carry `kind: "comment" | "suggestion"` on disk).
 */
import { CARD_REGISTRY } from "./card-registry";
import type { CardKind } from "./types";
import type { PanelKind } from "@/panels/_shared/types";

/** All card kinds, in registry declaration order. */
export const CARD_KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

export const isCardKind = (s: string): s is CardKind => s in CARD_REGISTRY;

/** Replaces `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind`
 *  and the polymorphic-panel anchor branches. */
export const isAnchoredCardKind = (k: CardKind): boolean => CARD_REGISTRY[k].anchored;

export const isSystemCardKind = (k: CardKind): boolean =>
  CARD_REGISTRY[k].origin === "system";

/** Replaces `CARD_KEY_PREFIXES` + the `popKey`/`cardPopKey` token lookup. */
export const cardKeyPrefix = (k: CardKind): string => CARD_REGISTRY[k].keyPrefix;

/** Replaces `getPanelByCardKind` + `POLYMORPHIC_CARD_PANEL`. */
export const panelForCardKind = (k: CardKind): PanelKind | null =>
  CARD_REGISTRY[k].panel;

/** Derives polymorphic-panel membership (notes → [note, highlight], etc.).
 *  Replaces `PANEL_REGISTRY.card` + `POLYMORPHIC_CARD_PANEL` entirely, and is
 *  the morph-set accessor A9's chevron consumes. */
export const cardKindsForPanel = (p: PanelKind): CardKind[] =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].panel === p);

/** The set of kinds that can serialize onto the Stack. Replaces the hand-kept
 *  `StackCardKind` union. */
export const stackableCardKinds = (): CardKind[] =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].stackable);

/** Whether a kind can pop out into a `Floatable` window. Registry-derived SSOT
 *  for the docked one-click pop-out control (and `registerCardFloatable`'s
 *  registration guard). Only `error` is false (ratified not-poppable, §3.5). */
export const isPoppable = (k: CardKind): boolean => CARD_REGISTRY[k].poppable;

/** Whether a kind can morph in place into its sibling (the A9 kind-chevron).
 *  The 4 morphing pairs (note↔highlight, revision-/cutter-comment↔suggestion,
 *  report↔report-request) are true; the 8 standalone kinds are false. The
 *  chevron's dropdown options are `cardKindsForPanel(panel)` — `morph.to`
 *  always shares the kind's panel (a dev assertion pins this). */
export const canMorph = (k: CardKind): boolean => CARD_REGISTRY[k].morph !== null;

/** Whether a kind renders as an in-text inline atom (footnote / citation),
 *  whose existence is the editor's job (not a sidecar collection). NOT cleanly
 *  facet-derivable: `markerType === null` is shared with `highlight` (a tint,
 *  not an atom) and `bib`/`ai`/`example`, so this stays an explicit literal —
 *  the single source consumers route through (replacing the local
 *  `isInlineAtomKind` in `useAnchorHighlightReconciler`). A dev assertion
 *  (below) pins the invariant that both have `markerType === null`. */
export const isInlineAtomCardKind = (k: CardKind): boolean =>
  k === "footnote" || k === "citation";

if (process.env.NODE_ENV !== "production") {
  // The two inline-atom kinds carry no gutter marker (their in-text atom IS the
  // surface). If a registry edit ever gives one a `markerType`, the explicit
  // literal above would silently drift from the facet — make it loud.
  for (const k of ["footnote", "citation"] as const) {
    if (CARD_REGISTRY[k].markerType !== null) {
      console.error(
        `[predicates] isInlineAtomCardKind invariant broken: "${k}" must have ` +
          `markerType === null (its inline atom is the surface, no gutter icon), ` +
          `but CARD_REGISTRY marks it "${CARD_REGISTRY[k].markerType}".`,
      );
    }
  }
}

/**
 * Read-side classifier: resolve an on-disk card record's *data discriminator*
 * (`record.kind`) to its spine `CardKind`. `panel` disambiguates the families
 * that share an on-disk discriminator — both Cutter and Revisions records carry
 * `kind: "comment" | "suggestion"`, so the panel decides whether `"suggestion"`
 * means `cutter-suggestion` or `revision-suggestion`.
 *
 * This is the read-side INVERSE of the A9 morph write-side (`applyCardMorph` /
 * `getCardMorphConverter`): morph FLIPS a record's `kind` to its sibling and
 * salvages fields; this READS the current `kind` back to a spine kind. They are
 * deliberately NOT merged — different layer (read-classification vs in-place
 * data transform), different inputs (a panel-tagged record vs a registered
 * converter closure). Keep them apart; the morph layer lives in
 * `card-registry.tsx` + `cards/morphs/`, this is the link/anchor read layer.
 *
 * O(1): a `record.kind` string compare + panel switch. No collection scan, no
 * doc walk (keystroke sanctity). The caller still does the linear
 * `collection.find(e => e.id === id)` to fetch the record — that's the existing
 * `findEntity` contract, unchanged.
 */
export function cardKindFromRecord(
  record: { kind?: string },
  panel: PanelKind,
): CardKind {
  switch (panel) {
    case "cutter":
      return record.kind === "suggestion" ? "cutter-suggestion" : "cutter-comment";
    case "revisions":
      return record.kind === "suggestion" ? "revision-suggestion" : "revision-comment";
    case "reports":
      return record.kind === "report-request" ? "report-request" : "report";
    default: {
      // Monomorphic panels: the panel's single anchored kind. `cardKindsForPanel`
      // returns >1 only for the polymorphic panels handled above (and `notes`,
      // whose note/highlight split rides separate collections, not `record.kind`
      // — callers pass the concrete ref kind there, never route through here).
      const kinds = cardKindsForPanel(panel);
      return kinds[0] ?? "note";
    }
  }
}
