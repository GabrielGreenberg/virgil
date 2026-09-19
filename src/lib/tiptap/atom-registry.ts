/**
 * ATOM_REGISTRY — single source of truth for Virgil's inline **Atoms**.
 *
 * The inline sibling of `TEXT_OBJECT_REGISTRY` (src/text-objects/
 * text-object-registry.ts). Per the Ontology (docs/architecture/VIRGIL.md
 * §Ontology), an **Atom** is an inline element *within* a TextObject —
 * in-text citations (`\cite{}`), footnote markers (`\footnote{}`), refs
 * (`\ref{}`), and inline math (`$…$`) — whose declared mobility is
 * "text-bound: move with the surrounding characters." This registry is
 * the code home of that primitive: it drives DOM→kind detection for the
 * `InlineAtomGrab` gesture, cardKey/source-capture construction, and the
 * `cursor: grab` affordance.
 *
 * Adding an Atom kind = one row here (+ an `idAttr` if it owns a Card). Its
 * node file then SOURCES `data-type`/`class` from this row in `renderHTML`,
 * `parseHTML`, and its NodeView (footnote / citation / label / math's inline
 * branch) instead of hardcoding the literals, so the live DOM can't drift from
 * this SSOT — pinned per-kind by `atom-selectable-parity.test.ts` (task 232).
 * The grab gesture, the `inTextAtomGrab` drop spec, and the affordance CSS all
 * read off this.
 *
 * The deprecated `aiRequestMarker` is intentionally absent — AI requests
 * live in Cards, not as in-text atoms (uprooted; see git history).
 */

import type { Node as PMNode } from "@tiptap/pm/model";

export type AtomKind = "footnote" | "citation" | "ref" | "inline-math";

export interface AtomMeta {
  /** Registry kind. */
  kind: AtomKind;
  /** ProseMirror schema node name. */
  nodeName: string;
  /** The `data-type` attribute the NodeView DOM carries. */
  domType: string;
  /** The class on the NodeView DOM (used for the cursor affordance). */
  domClass: string;
  /**
   * The node attr carrying the Atom's entity id, or `null` for id-less
   * atoms (ref / inline math own no Card). The in-text grab captures the
   * source by position for ALL kinds, so this is only consulted by the
   * float-header (by-id) drop path for the Card-bearing kinds.
   */
  idAttr: string | null;
  /**
   * The DOM attribute the NodeView writes that id to (`data-footnote-id`),
   * or `null` for the id-less kinds. Declared rather than derived from
   * {@link AtomMeta.idAttr} by a camelCase→kebab transform: the transform is
   * ungreppable and would silently mis-derive a future attr name (`refId2`,
   * `bibTeXKey`), whereas this row entry is one string a `grep` finds.
   *
   * Every DOM read of an atom's id — the ghost's strip list, the hover
   * bridge, the marker-click source lookup — spells THIS, so the DOM
   * attribute and the node attr can't drift apart (task 645).
   */
  domIdAttr: string | null;
  /**
   * The ProseMirror `NodeSpec.selectable` the atom's node MUST declare — the
   * SSOT for a per-kind behavioral facet that otherwise lives only as a
   * hand-set (or unset) flag in each node file, free to drift.
   *
   * `false` for footnote / citation / ref: a `NodeSelection` resting on the
   * leaf triggers a ~100px `scrollIntoView` jump, and the Card (not the atom)
   * is the selection surface. `InlineAtomGrab` intercepts *plain* mousedown so
   * PM never rests a NodeSelection there — but it bails on modifier-clicks and
   * on read-only surfaces, where PM's own mousedown runs; `selectable:false` is
   * what kills the jump on those paths.
   *
   * `true` for inline-math ONLY: its NodeView legitimately needs the
   * `NodeSelection` — `selectNode()`/`deselectNode()` paint the `.selected`
   * chrome and drive the single-node-float selection (math.ts). Do NOT blanket
   * these to `false`: the audit's adversarial pass refuted that (it would
   * silently break inlineMath's chrome).
   *
   * Pinned by `atom-selectable-parity.test.ts`, which asserts the live schema's
   * effective selectability matches this facet for every kind, so it can't drift.
   */
  selectable: boolean;
  // NO `label` FIELD, deliberately (task 647). A `label` ("Footnote",
  // "Citation", "Cross-reference", "Inline math") rode here from the start,
  // read by nothing, its own comment conceding why ("confirm copy / future
  // UI"). The tempting fix was to point the three surfaces that hand-spell
  // those words at this row; the tempting fix was wrong, and the evidence is
  // one row over. Human names for these concepts live in THREE registries
  // that deliberately disagree:
  //
  //   CARD_REGISTRY.label          — the card overline / kind chevron
  //   CARD_ACTION_PRESENTATION     — the grab-bar + lightning menu entries
  //   ActionSpec.label             — a VIRGIL_ACTION_REGISTRY row
  //
  // and `todo` is "Task" in the first while being "Todo" in the other two,
  // `report` is "Report" against "Request report". They coincide on
  // "Footnote"/"Citation" and nowhere else, so an SSOT spanning them would
  // assert an identity their own neighbouring rows falsify — and would couple
  // menu copy to the atom taxonomy, so renaming an atom silently renamed a
  // menu entry. An Atom has no naming surface of its own (nothing in the grab
  // gesture, the ghost or the drop specs shows a kind to the user), so there
  // is no fourth vocabulary for this registry to own. If one ever appears,
  // that surface's registry is where its copy goes.
}

export const ATOM_REGISTRY = {
  footnote: {
    kind: "footnote",
    nodeName: "footnote",
    domType: "footnote",
    domClass: "footnote-marker",
    idAttr: "footnoteId",
    domIdAttr: "data-footnote-id",
    selectable: false,
  },
  citation: {
    kind: "citation",
    nodeName: "citation",
    domType: "citation",
    domClass: "citation-node",
    idAttr: "citationId",
    domIdAttr: "data-citation-id",
    selectable: false,
  },
  ref: {
    kind: "ref",
    nodeName: "labelRef",
    domType: "label-ref",
    domClass: "label-ref-node",
    idAttr: null,
    domIdAttr: null,
    selectable: false,
  },
  "inline-math": {
    kind: "inline-math",
    nodeName: "inlineMath",
    domType: "inline-math",
    domClass: "inline-math",
    idAttr: null,
    domIdAttr: null,
    selectable: true,
  },
  // `as const satisfies` rather than a plain `Record<AtomKind, AtomMeta>`
  // annotation: the rows are still type-checked against `AtomMeta` (a typo'd
  // or missing facet is a compile error, exactly as before), but the literal
  // strings SURVIVE — which is what lets `CardAtomKind` below be DERIVED from
  // `idAttr !== null` at the type level instead of re-listing the two kinds.
} as const satisfies Record<AtomKind, AtomMeta>;

const ALL: ReadonlyArray<AtomMeta> = Object.values(ATOM_REGISTRY);

const BY_DOM_TYPE = new Map<string, AtomMeta>(ALL.map((m) => [m.domType, m]));
const BY_NODE_NAME = new Map<string, AtomMeta>(ALL.map((m) => [m.nodeName, m]));

/**
 * A CSS selector matching any Atom's NodeView DOM. The grab plugin does
 * `target.closest(ATOM_DOM_SELECTOR)` to detect a graspable atom in one
 * hop. Built from the registry so a new kind needs no edit here.
 */
export const ATOM_DOM_SELECTOR: string = ALL.map(
  (m) => `[data-type="${m.domType}"]`,
).join(",");

/**
 * A CSS selector matching any **Card-bearing** Atom's NodeView DOM — the atoms
 * that own a Card (`idAttr !== null`: footnote + citation; ref / inline-math own
 * no Card, correctly excluded). The click-away card-selection guard uses this to
 * answer "was this mousedown on a Card-bearing atom?" so the halo isn't cleared
 * out from under a marker click. Derived from the registry so the two kinds stay
 * consistent (no more footnote-by-class / citation-by-data-type split) AND a
 * future Card-bearing atom kind is covered for free (task 256).
 */
export const CARD_ATOM_DOM_SELECTOR: string = ALL.filter(
  (m) => m.idAttr !== null,
)
  .map((m) => `[data-type="${m.domType}"]`)
  .join(",");

// ---------------------------------------------------------------------------
// The CARD-BEARING half (task 645)
//
// Two of the four atoms own a Card, and the fact that makes them Card-bearing
// is ONE predicate: `idAttr !== null`. Before this, that predicate's two
// halves — the schema node name and the attr carrying the id — were
// hand-PAIRED at seven consumer sites in four different shapes (two twin
// `INLINE_ATOM_CARDS` tables, a literal `["citationId","footnoteId"]` array,
// two `dedupInlineId("citation","citationId")` calls, a `data-*` strip list,
// two drop specs). A fifth Card-bearing kind added tomorrow would have reached
// none of them, with no compile error and no failing test — the drift surface
// the registry's own doc-comment already claimed to have closed ("a future
// Card-bearing atom kind is covered for free", task 256, which closed only the
// domType/domClass facets).
//
// So the pair is published here, ONCE, and the consumers read it. The census
// `card-atom-idattr-census.test.ts` pins the complement: no production file
// outside this one hand-pairs an atom node name with its id attr.
// ---------------------------------------------------------------------------

/**
 * The Atom kinds that own a Card — **derived**, not re-listed: a row whose
 * `idAttr` is non-null is Card-bearing, which is the same predicate
 * {@link CARD_ATOM_DOM_SELECTOR} filters on, lifted to the type level. Add a
 * fifth row with an `idAttr` and it joins this union (and every derivation
 * below) with no edit here; drop a row's `idAttr` and it leaves.
 */
export type CardAtomKind = {
  [K in AtomKind]: (typeof ATOM_REGISTRY)[K]["idAttr"] extends null ? never : K;
}[AtomKind];

/** An {@link AtomMeta} row narrowed to the Card-bearing case: both id facets
 *  are present, so a consumer needs no non-null assertion to use them. */
export type CardAtomMeta = Omit<AtomMeta, "kind" | "idAttr" | "domIdAttr"> & {
  kind: CardAtomKind;
  idAttr: string;
  domIdAttr: string;
};

/** The node attr carrying a Card-bearing atom's id (`"footnoteId" | "citationId"`). */
export type CardAtomIdAttr = (typeof ATOM_REGISTRY)[CardAtomKind]["idAttr"];

const isCardAtomMeta = (m: AtomMeta): m is CardAtomMeta =>
  m.idAttr !== null && m.domIdAttr !== null;

/** Every Card-bearing Atom's row, in registry order. The list form — iterate it
 *  where a consumer must do the same work per kind (the serializer's id dedup,
 *  the delete/duplicate card lookup). */
export const CARD_ATOMS: ReadonlyArray<CardAtomMeta> = ALL.filter(isCardAtomMeta);

/** The Card-bearing rows keyed by kind. The lookup form — index it where a
 *  consumer names ONE kind (a drop spec, a marker-click bridge). */
export const CARD_ATOM_REGISTRY = Object.fromEntries(
  CARD_ATOMS.map((m) => [m.kind, m]),
) as Record<CardAtomKind, CardAtomMeta>;

/** The node attrs that carry a Card-bearing atom's entity id. */
export const CARD_ATOM_ID_ATTRS: ReadonlyArray<CardAtomIdAttr> = CARD_ATOMS.map(
  (m) => m.idAttr as CardAtomIdAttr,
);

/** The DOM attrs those ids are written to (`data-footnote-id`, …). */
export const CARD_ATOM_DOM_ID_ATTRS: ReadonlyArray<string> = CARD_ATOMS.map(
  (m) => m.domIdAttr,
);

// NO joined id-attr SELECTOR (task 647). Task 645 published a
// `CARD_ATOM_DOM_ID_SELECTOR` — `CARD_ATOM_DOM_ID_ATTRS` joined into
// `[data-footnote-id],[data-citation-id]` — justified by the two surfaces that
// read an atom's id off the DOM. Neither could ever have used it, and that is
// the interesting part: the ghost (`inline-atom-ghost.ts`) REMOVES each attr,
// so it needs the list, not a selector; and the hover bridge
// (`useTextHoverBridge.ts`) climbs the ancestor chain asking each row in turn
// because it must answer WHICH KIND matched, which a joined selector erases by
// construction. So it shipped with zero callers — not even a test — alongside a
// comment naming consumers that structurally cannot be its consumers. Add the
// selector back the day a surface asks "is this element any Card-bearing atom?"
// and does not care which; until then the two derivations above are the whole
// need.

/** Resolve a **Card-bearing** Atom meta from a PM schema node name, or null for
 *  an id-less atom / a non-atom. The narrowing twin of
 *  {@link atomMetaForNodeName}: a caller that needs the `{nodeName, idAttr}`
 *  pair asks this and gets both, non-null, or nothing. */
export function cardAtomMetaForNodeName(nodeName: string): CardAtomMeta | null {
  const m = BY_NODE_NAME.get(nodeName);
  return m && isCardAtomMeta(m) ? m : null;
}

/** Resolve an Atom meta from a DOM `data-type` value (or null). */
export function atomMetaForDomType(domType: string | null | undefined): AtomMeta | null {
  return domType ? (BY_DOM_TYPE.get(domType) ?? null) : null;
}

/** Resolve an Atom meta from a PM schema node name (or null). */
export function atomMetaForNodeName(nodeName: string): AtomMeta | null {
  return BY_NODE_NAME.get(nodeName) ?? null;
}

/** True iff the node is one of the registered inline Atoms. */
export function isAtomNode(node: PMNode): boolean {
  return BY_NODE_NAME.has(node.type.name);
}
