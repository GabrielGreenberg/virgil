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
  /** Human label (confirm copy / future UI). */
  label: string;
}

export const ATOM_REGISTRY: Record<AtomKind, AtomMeta> = {
  footnote: {
    kind: "footnote",
    nodeName: "footnote",
    domType: "footnote",
    domClass: "footnote-marker",
    idAttr: "footnoteId",
    selectable: false,
    label: "Footnote",
  },
  citation: {
    kind: "citation",
    nodeName: "citation",
    domType: "citation",
    domClass: "citation-node",
    idAttr: "citationId",
    selectable: false,
    label: "Citation",
  },
  ref: {
    kind: "ref",
    nodeName: "labelRef",
    domType: "label-ref",
    domClass: "label-ref-node",
    idAttr: null,
    selectable: false,
    label: "Cross-reference",
  },
  "inline-math": {
    kind: "inline-math",
    nodeName: "inlineMath",
    domType: "inline-math",
    domClass: "inline-math",
    idAttr: null,
    selectable: true,
    label: "Inline math",
  },
};

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
