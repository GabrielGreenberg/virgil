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
 * Adding an Atom kind = one row here (+ an `idAttr` if it owns a Card,
 * + the `data-type`/class on its NodeView DOM). The grab gesture, the
 * `inTextAtomGrab` drop spec, and the affordance CSS all read off this.
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
    label: "Footnote",
  },
  citation: {
    kind: "citation",
    nodeName: "citation",
    domType: "citation",
    domClass: "citation-node",
    idAttr: "citationId",
    label: "Citation",
  },
  ref: {
    kind: "ref",
    nodeName: "labelRef",
    domType: "label-ref",
    domClass: "label-ref-node",
    idAttr: null,
    label: "Cross-reference",
  },
  "inline-math": {
    kind: "inline-math",
    nodeName: "inlineMath",
    domType: "inline-math",
    domClass: "inline-math",
    idAttr: null,
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
