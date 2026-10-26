/**
 * DocStructureObserver — the ONE per-node entity extractor (task 922).
 *
 * What a single node CONTRIBUTES to the structure snapshot — its block entry,
 * heading, figure, example, exampleItem label, footnote, citation, label and
 * linkedAnchor span entries — is answered here and nowhere else. Both walks
 * call it:
 *
 *   - `buildInitial` (`structure-index.ts`) — the load-time O(N) `descendants`
 *     walk;
 *   - `inspectNodeAt` (`step-inspector.ts`) — the per-transaction range walk.
 *
 * Each keeps only its TRAVERSAL (which nodes it visits) and the two facts a
 * single node cannot answer about itself, handed in through `ExtractContext`:
 * where the entry is RECORDED (`place` — the step path's coordinate contract)
 * and the citation's enclosing container (`citationContainer` — the load
 * path's example stack, the step path's ancestor resolve). Before 922 the
 * construction was hand-written twice and every divergence bug in this module
 * (213, 651, 652) was one field drifting between the copies.
 *
 * Cost: O(1) per visited node (plus the O(depth) container resolve, which runs
 * only when a citation node is actually collected) — the step path's
 * O(edit-size) budget is unchanged.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { inlineAtoms } from "@/lib/inline-content";
import { mayCarryBlockUuid } from "@/lib/marginalia";
import { figureNodeEmitsCaption } from "@/lib/figures/env-body";
import { type CardAtomKind, cardAtomMetaForNodeName } from "@/lib/tiptap/atom-registry";
import {
  type BlockEntry,
  type CitationContainer,
  type CitationEntry,
  citationEntryAt,
  deriveExampleIdentity,
  deriveParTitled,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  type LabelEntry,
} from "./types";

/** Where the extractor delivers entries. Each walk adapts it onto its own
 *  storage (the load path's ordered arrays, the step path's keyed bundles). */
export interface EntitySink {
  block(e: BlockEntry): void;
  heading(e: HeadingEntry): void;
  figure(e: FigureEntry): void;
  example(e: ExampleEntry): void;
  footnote(e: FootnoteEntry): void;
  citation(e: CitationEntry): void;
  label(e: LabelEntry): void;
  /** One text run's share of a `linkedAnchor` span; the sink merges runs. */
  anchor(id: string, kind: string, from: number, to: number): void;
}

export interface ExtractContext {
  readonly sink: EntitySink;
  /** Cross a walked position into the space the entry is RECORDED in.
   *  Omitted ⇒ identity (the walked document already is that space). */
  readonly place?: (pos: number, assoc: number) => number;
  /** The container a citation collected at `pos` belongs to. Called only
   *  when a citation node is actually collected. */
  readonly citationContainer: (pos: number) => CitationContainer | null;
}

/** A non-empty string attr, else `""` — the ONE reading of "has a label". */
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * The ONE construction of a `FigureEntry` from a live node. Also read by the
 * step path's body-derived-ancestor pass, so the range walk and that pass can
 * never disagree about what a figure's facts are.
 */
export function figureEntryAt(n: PMNode, pos: number, uuid: string): FigureEntry {
  const attrs = (n.attrs ?? {}) as Record<string, unknown>;
  return {
    uuid,
    pos,
    label: str(attrs.label),
    numbered: attrs.numbered !== false,
    number: (attrs.figureNumber as number | null | undefined) ?? null,
    emitsCaption: figureNodeEmitsCaption(n),
  };
}

/**
 * The example identity a node carries, or null if it is not an example
 * container. The ONE reading of "is this an exampleBlock, and what is its
 * `ExampleEntry` identity?" — the extractor's own example branch and the step
 * path's ancestor resolves (`nearestExampleBlockUuid`,
 * `enclosingCitationContainer`) all ask it, so a citation's container id can
 * never drift from the example entry's id it must match.
 */
export function exampleIdentityOf(n: PMNode): ReturnType<typeof deriveExampleIdentity> | null {
  if (n.type.name !== "exampleBlock") return null;
  const attrs = (n.attrs ?? {}) as Record<string, unknown>;
  return deriveExampleIdentity({
    uuid: str(attrs.uuid) || null,
    tag: attrs.tag as string | null | undefined,
    label: attrs.label as string | null | undefined,
    number: attrs.number as string | number | null | undefined,
  });
}

/**
 * A Card-bearing atom's kind and entity id (`""` when unset), or null for any
 * other node. Both halves come from the atom registry (task 1300) — the node
 * name and the id attr are never spelled here.
 */
export function cardAtomIdOf(n: PMNode): { kind: CardAtomKind; id: string } | null {
  const meta = cardAtomMetaForNodeName(n.type.name);
  if (!meta) return null;
  return { kind: meta.kind, id: str((n.attrs as Record<string, unknown>)[meta.idAttr]) };
}

interface CardAtomVisit {
  /** The atom's entity id, `""` when unset. */
  readonly id: string;
  readonly attrs: Record<string, unknown>;
  /** The walked position (what a container resolve is asked at). */
  readonly pos: number;
  /** The RECORDED position (`place`d). */
  readonly at: number;
  readonly ctx: ExtractContext;
}

/** What each Card-bearing atom kind contributes. Exhaustive over
 *  `CardAtomKind`: a registry row without a contribution does not compile. */
const CARD_ATOM_CONTRIBUTIONS: Record<CardAtomKind, (v: CardAtomVisit) => void> = {
  footnote: ({ id, attrs, at, ctx: { sink } }) => {
    if (id) {
      sink.footnote({
        id,
        pos: at,
        thanks: !!attrs.thanks,
        number: (attrs.number as number | undefined) ?? 0,
        title: str(attrs.title),
      });
    }
    // The footnote's BODY citations (task 1128). A footnote is an atom whose
    // body is a JSONContent literal in `attrs.content`, so no walk can enter
    // it — but the cites inside are entities this node CONTRIBUTES, exactly
    // like its own entry. Answering them here (not in a load-only descent)
    // is what makes the step path agree with a rebuild: delete the footnote
    // and its cites leave with it, paste it and they arrive, rewrite its body
    // (`setNodeMarkup` on the atom — both sides re-extracted) and the
    // difference is the cites that changed. O(body) per footnote the range
    // touches; a keystroke touches none.
    //
    // A nested cite has no PM node of its own: its address is the HOST's
    // `pos`, its container the host's RAW `footnoteId` — the id
    // `FootnoteEntry.id` carries and the footnote omni item is keyed by. Do
    // NOT prefer `linkId`: a `linkId`-derived host would never match the
    // footnote item's key, and `nest-footnote-children.ts` would degrade the
    // cite to a flat card.
    const body = attrs.content as JSONContent | null | undefined;
    if (body && typeof body === "object") {
      for (const hit of inlineAtoms(body)) {
        if (hit.kind !== "citation" || !hit.id) continue;
        sink.citation(
          citationEntryAt({
            id: hit.id,
            pos: at,
            command: hit.command,
            displayText: hit.displayText,
            container: { kind: "footnote", id },
          }),
        );
      }
    }
  },
  citation: ({ id, attrs, pos, at, ctx }) => {
    if (!id) return;
    ctx.sink.citation(
      citationEntryAt({
        id,
        pos: at,
        command: attrs.command as string | undefined,
        displayText: attrs.displayText as string | undefined,
        container: ctx.citationContainer(pos),
      }),
    );
  },
};

/**
 * Extract every structural entity ONE node contributes. Does not recurse —
 * the caller's traversal decides which nodes are visited.
 *
 * `parent` is `n`'s immediate parent: the block-identity predicate reads it
 * (a deferred inner paragraph carries no live block identity, task 878).
 */
export function extractEntitiesAt(
  n: PMNode,
  pos: number,
  parent: PMNode | null,
  ctx: ExtractContext,
): void {
  const { sink, place } = ctx;
  const typeName = n.type.name;
  const attrs = (n.attrs ?? {}) as Record<string, unknown>;
  const uuid = str(attrs.uuid) || null;
  const at = place ? place(pos, 1) : pos;

  if (uuid && mayCarryBlockUuid(n, parent)) {
    sink.block({ uuid, pos: at, typeName, parTitled: deriveParTitled(attrs) });
  }

  if (typeName === "heading" && uuid) {
    const label = str(attrs.label);
    sink.heading({
      uuid,
      pos: at,
      level: (attrs.level as number | undefined) ?? 1,
      text: n.textContent,
      label: (attrs.label as string | null | undefined) ?? null,
      numbered: attrs.numbered !== false,
    });
    if (label) sink.label({ id: label, owner: "heading", ownerUuid: uuid, pos: at });
  }

  if (typeName === "figureBlock" && uuid) {
    const fig = figureEntryAt(n, at, uuid);
    sink.figure(fig);
    if (fig.label) sink.label({ id: fig.label, owner: "figure", ownerUuid: uuid, pos: at });
  }

  const example = exampleIdentityOf(n);
  if (example?.id) {
    const { id, uuid: exUuid, tag, label, number } = example;
    sink.example({ id, uuid: exUuid, pos: at, tag, label, number });
    if (label) sink.label({ id: label, owner: "example", ownerUuid: exUuid, pos: at });
  }

  if (typeName === "exampleItem") {
    const label = str(attrs.label);
    if (label) sink.label({ id: label, owner: "exampleItem", ownerUuid: null, pos: at });
  }

  // Card-bearing atoms (task 1300): WHICH node names are card atoms, and which
  // attr carries each one's entity id, is the atom registry's fact — read
  // here, never re-spelled. What each kind contributes is the exhaustive
  // table below, so a new `CARD_ATOM_REGISTRY` row is a compile error here
  // until its contribution is stated, not a silent gap in the snapshot.
  const cardAtom = cardAtomIdOf(n);
  if (cardAtom) {
    CARD_ATOM_CONTRIBUTIONS[cardAtom.kind]({ id: cardAtom.id, attrs, pos, at, ctx });
  }

  // Linked-anchor marks ride on text nodes.
  if (n.isText && n.marks.length > 0) {
    for (const mark of n.marks) {
      if (mark.type.name !== "linkedAnchor") continue;
      const mAttrs = mark.attrs as { anchorId?: string; kind?: string };
      const id = mAttrs.anchorId ?? "";
      if (!id) continue;
      const end = pos + n.nodeSize;
      sink.anchor(
        id,
        mAttrs.kind ?? "note",
        place ? place(pos, -1) : pos,
        place ? place(end, 1) : end,
      );
    }
  }
}
