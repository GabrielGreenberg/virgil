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
import type { CardKind, CardMeta } from "./types";
import type { PanelKind } from "@/panels/_shared/types";
import type { PanelThemeKey } from "@/lib/panel-theme";
import type { AiRequestKind, AiRequestLink } from "@/lib/types";
import type { CardBodySchemaScope } from "@/lib/tiptap/borrowed-schema";
import { LEGACY_TOKEN_CROSSWALK } from "./legacy-token-crosswalk";

/** All card kinds, in registry declaration order. */
export const CARD_KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

export const isCardKind = (s: string): s is CardKind => s in CARD_REGISTRY;

/** Replaces `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind`
 *  and the polymorphic-panel anchor branches. */
export const isAnchoredCardKind = (k: CardKind): boolean => CARD_REGISTRY[k].anchored;

export const isSystemCardKind = (k: CardKind): boolean =>
  CARD_REGISTRY[k].origin === "system";

/** Whether a card of this kind can be ARCHIVED — set aside (reversibly) into its
 *  home panel's archive view instead of deleted. DERIVED from provenance (the
 *  complement of `isSystemCardKind`, also excluding the `origin: "derived"`
 *  mirror): a kind is archivable IFF the user authored it (`origin === "user"`),
 *  minus the `highlight` exception below. That set is note/footnote/citation/
 *  archive/todo/report/report-request + the comment/suggestion pairs; `example`
 *  (derived) and `bib`/`ai`/`error` (system) are not.
 *
 *  This is wholly distinct from the text-object Archive PANEL (a separate
 *  subsystem that *moves text objects*). The archive button renders iff
 *  `isArchivable(kind)` AND the card already shows a panel-trash button, so the
 *  affordance lands "wherever the trash button appears."
 *
 *  EXCEPTION — `highlight` is NOT archivable (user decision): a highlight is a
 *  text-range tint with no body, and archiving it would leave an orphaned
 *  persistent tint in the prose (the tint rides the `linkedAnchor` mark, a
 *  separate decoration). Highlights are delete-only.
 *
 *  `footnote` IS archivable (bug sweep #3): archiving splices the `\footnote`
 *  atom out and flags the `footnotes.json` ref `archived` + `unanchored` (mirror
 *  of citations), so the atomless ref survives and the Footnotes panel lists it
 *  under Archives. The flag-ON inline-atom-lifecycle policy's orphan-upsert is
 *  suppressed for the archived id so the same footnote can't be BOTH archived
 *  and orphaned (the one-shot `archivedSuppress` seam in
 *  inline-atom-lifecycle-policy.ts). */
export const isArchivable = (k: CardKind): boolean =>
  CARD_REGISTRY[k].origin === "user" && k !== "highlight";

/** Whether archiving a card of this kind also splices an inline atom out of the
 *  document (footnote/citation). These kinds' cards ARE backed by a
 *  `\footnote{}` / `\cite{}` marker in the `.tex`, so archiving must remove the
 *  atom (behind a confirm) — and, per the unarchive contract, does NOT re-insert
 *  it (the card returns as an unanchored ref the user re-places). Aliases the
 *  established inline-atom predicate so the two can never disagree. */
export const archiveRemovesAtom = (k: CardKind): boolean =>
  isInlineAtomCardKind(k);

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

/** Whether a kind gets the docked drop button — the (re)anchor gesture that
 *  enters drop-mode. Registry-derived SSOT (mirrors `isPoppable`), read by the
 *  button mount on both the docked card header and the FloatChrome. STATIC, not
 *  `dropSpec != null`: the drop machinery (`@/cards/drop-specs`) registers
 *  specs via a boot-time side-effect import on the drop-dispatch path, which
 *  this module can't import without a cycle and which may not have run when a
 *  card header first paints — see `CardMeta.droppable`. Pinned to the real spec
 *  registration by the dev assertion below + `drop-facet-contract.test.ts`. */
export const isDroppable = (k: CardKind): boolean => CARD_REGISTRY[k].droppable;

/** Where a (re)anchor drop for a kind LANDS — `"in-text"` (inline caret / atom
 *  position), `"margin"` (paragraph horizontal band), or `null` (no drop
 *  button). Registry-derived SSOT (mirrors `isAnchoredCardKind`); the drop
 *  button's grab handler + the controller dispatch through this instead of
 *  re-deriving from `dropSpec.allowedPlacements`. `cardDropPlacement(k) !== null`
 *  ⇔ `isDroppable(k)` (pinned by the assertion below). */
export const cardDropPlacement = (k: CardKind): CardMeta["dropPlacement"] =>
  CARD_REGISTRY[k].dropPlacement;

/** Whether a kind participates in collab focus-claims (R28/D-2). Gates the
 *  claim-on-focus / release-on-blur wiring and the claim-pill/presence-dots
 *  trailing on both the docked card and its float. Exactly 7 kinds are true
 *  (pinned by `collab-claim-scope-contract.test.ts`). */
export const hasCollabClaims = (k: CardKind): boolean =>
  CARD_REGISTRY[k].collabClaims;

/** The collab claim/presence WIRE SCOPE for a kind (R28/D-2): one source for
 *  docked + float, derived from the registry — `collabClaimScope(kind) ≡
 *  CARD_REGISTRY[kind].themeKey` (crosswalk-free post-A10/B; the keyspaces are
 *  unified). Emits the exact legacy wire tokens the collab sidecar has always
 *  carried (note / footnote / archive / cut / report / revision), so existing
 *  on-disk claims keep matching — pinned byte-for-byte by
 *  `collab-claim-scope-contract.test.ts`. Defined for every kind (it's just
 *  the theme key); only `hasCollabClaims` kinds ever write claims with it. */
export const collabClaimScope = (k: CardKind): PanelThemeKey =>
  CARD_REGISTRY[k].themeKey;

/** RichTextField visual variant for a kind's body — DERIVED from the
 *  registry `bodyClass` (the typography SSOT), never hand-picked per card:
 *  `"borrowed"` kinds read in the serif `footnote` dialect, `"sans"` kinds
 *  in the sans `note` dialect. (The per-panel `usePanelBodyStyle` inline
 *  override sits on top; this fixes the declared fallback class.) */
export const bodyVariantForCardKind = (k: CardKind): "footnote" | "note" =>
  CARD_REGISTRY[k].bodyClass === "borrowed" ? "footnote" : "note";

/** Which SCHEMA a kind's body mounts — DERIVED from the registry `bodySchema`
 *  facet (task 308), never hand-picked per surface. `"excerpt"` kinds hold a
 *  verbatim slice of the main document and get the full document vocabulary;
 *  everyone else gets the narrow authored-prose surface. Read ONCE in
 *  `EditableCard`, which threads the result to both body surfaces, so a kind's
 *  expanded and compressed views can never disagree about what they can hold. */
export const bodySchemaForCardKind = (k: CardKind): CardBodySchemaScope =>
  CARD_REGISTRY[k].bodySchema;

/** Whether a kind's body holds a document EXCERPT (a verbatim slice of the main
 *  document) rather than authored card prose. One declaration, two duties —
 *  they are the two directions of the same fact:
 *
 *    • CAPTURE — a destructive action that moves document content into such a
 *      body must gate its delete on `canMountInCardBody` (task 308).
 *    • RESTORE — such a body is the only copy of prose that left the document,
 *      so the card carries the un-archive affordance that hands it back
 *      (task 106). Deriving the affordance from the same facet is what makes a
 *      future excerpt kind inherit it instead of re-deciding.
 *
 *  Today `archive` is the sole member. */
export const isExcerptCardKind = (k: CardKind): boolean =>
  CARD_REGISTRY[k].bodySchema === "excerpt";

/** The kinds whose bodies hold document excerpts. Every DESTRUCTIVE capture
 *  action must target one of these AND gate its delete on `canMountInCardBody`
 *  — that pair is the never-delete-what-you-cannot-restore invariant. */
export const excerptCardKinds = (): CardKind[] =>
  CARD_KINDS.filter(isExcerptCardKind);

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
  // The two inline-atom kinds carry no margin marker (their in-text atom IS the
  // surface). If a registry edit ever gives one a `markerType`, the explicit
  // literal above would silently drift from the facet — make it loud.
  for (const k of ["footnote", "citation"] as const) {
    if (CARD_REGISTRY[k].markerType !== null) {
      console.error(
        `[predicates] isInlineAtomCardKind invariant broken: "${k}" must have ` +
          `markerType === null (its inline atom is the surface, no margin icon), ` +
          `but CARD_REGISTRY marks it "${CARD_REGISTRY[k].markerType}".`,
      );
    }
  }

  // Static drop-facet internal consistency: `droppable` ⇔ `dropPlacement !== null`.
  // This is the SPEC-FREE half of the drop-facet invariant — safe to check at
  // predicates.ts load time (the spec-keyed half lives in `assertDropFacetCoverage`,
  // card-registry.tsx, called from the drop-specs boot module once specs are
  // folded on; at THIS point `dropSpec` is still null by cycle-avoidance design).
  for (const k of CARD_KINDS) {
    const { droppable, dropPlacement } = CARD_REGISTRY[k];
    if (droppable !== (dropPlacement !== null)) {
      console.error(
        `[predicates] drop-facet invariant broken: "${k}" has droppable=${droppable} ` +
          `but dropPlacement=${JSON.stringify(dropPlacement)} — droppable must equal ` +
          `(dropPlacement !== null) so the button gate and the placement agree.`,
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
/**
 * In-text anchor accent map — the SSOT-derived replacement for the two
 * hand-mirrored hex tables that used to live in `globals.css`:
 *
 *   1. `.linked-anchor[data-link-card^="<token>:"]` — Mode B span color, keyed
 *      off the `legacyDataKind` token `createLinkedAnchor` stamps.
 *   2. `[data-paragraph-kind="<token>"]` — Mode A paragraph accent rail, keyed
 *      off the `cssToken` the anchor-highlight reconciler stamps.
 *
 * Both selectors now read a `--link-anchor-accent-<token>` CSS variable that
 * `EditorLayout` writes onto `:root` from the LIVE theme accent (default or the
 * user's panel-color override), exactly as `PanelCard` stamps
 * `--link-anchor-color: theme.accent` on the card side (chip E). This is the
 * second surface of that same kind-color derivation: a card-outline color and
 * its in-text anchor color now share ONE accent source, so a panel-color
 * override can never desync them.
 *
 * Each row is `{ token, themeKey }`: the CSS token (the string the selector
 * matches) and the `PanelThemeKey` whose accent paints it. Deduped by token —
 * `report` and `report-request` both project to the `report` theme, and a
 * Mode-A `cssToken` and a Mode-B `legacyDataKind` that share a string (e.g.
 * `note`) collapse to one row. Derived from `CARD_REGISTRY` (kind → themeKey)
 * + `LEGACY_TOKEN_CROSSWALK` (kind → CSS tokens); add a card kind and its
 * in-text anchor color follows automatically. The CSS var name is built once
 * here so the writer (EditorLayout) and any test read the same grammar.
 */
export function inTextAnchorAccentVar(token: string): string {
  return `--link-anchor-accent-${token}`;
}

export interface InTextAnchorAccentRow {
  /** CSS selector token (`data-link-card` prefix / `data-paragraph-kind` value). */
  token: string;
  /** The `:root` custom property the globals.css selectors read. */
  cssVar: string;
  /** The theme whose live accent (default or user override) paints this token. */
  themeKey: PanelThemeKey;
}

export const IN_TEXT_ANCHOR_ACCENTS: InTextAnchorAccentRow[] = (() => {
  const byToken = new Map<string, PanelThemeKey>();
  for (const k of CARD_KINDS) {
    const { themeKey } = CARD_REGISTRY[k];
    const { cssToken, legacyDataKind } = LEGACY_TOKEN_CROSSWALK[k];
    for (const token of [cssToken, legacyDataKind]) {
      if (token && !byToken.has(token)) byToken.set(token, themeKey);
    }
  }
  return [...byToken].map(([token, themeKey]) => ({
    token,
    cssVar: inTextAnchorAccentVar(token),
    themeKey,
  }));
})();

/**
 * Resolve a bridged AI-request's `(kind, linkPanel)` PAIR back to the owning
 * spine `CardKind` — the read-side inverse of the forward routing each
 * flag-bearing kind declares (`CARD_REGISTRY[kind].aiRequest = { kind,
 * linkPanel }`, pinned by `ai-request-routing-contract.test.ts`). Derived once
 * from the registry so it can never drift from the bridge's forward token.
 *
 * The PAIR is the bijection, not `linkPanel` alone: note/highlight both declare
 * `linkPanel: "notes"` (disambiguated by request kind `note` vs `highlight`),
 * and cutter-/revision-comment both declare request `kind: "suggestion"`
 * (disambiguated by panel `cutter` vs `revisions`). Inverting either coordinate
 * on its own would collapse two spine kinds onto one. Returns `null` for a pair
 * no flag-bearing kind declares (a corrupt or foreign link).
 *
 * O(1): a single Map read over the static registry — no collection scan, no
 * doc walk (keystroke sanctity).
 */
export function linkedCardKindFrom(
  reqKind: AiRequestKind,
  panel: AiRequestLink["panel"],
): CardKind | null {
  return LINKED_CARD_KIND_BY_PAIR.get(`${reqKind} ${panel}`) ?? null;
}

const LINKED_CARD_KIND_BY_PAIR: Map<string, CardKind> = (() => {
  const m = new Map<string, CardKind>();
  for (const k of CARD_KINDS) {
    const routing = CARD_REGISTRY[k].aiRequest;
    if (routing) m.set(`${routing.kind} ${routing.linkPanel}`, k);
  }
  return m;
})();

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
