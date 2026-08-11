/**
 * Node identity for content that is RELOCATED rather than created.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LAW
 *
 *   **A move conserves identity; a split mints it.**
 *
 * After any gesture that deletes content here and inserts it there, exactly one
 * live presence may answer to a given `uuid` (block identity) or inline-atom id
 * (`footnoteId` / `citationId` + the unified `linkId` mirror). A block the cut
 * consumed ENTIRELY hands its identity to the moved copy — the text moved, so
 * every card/sidecar anchored to it should follow. A block the cut only
 * PARTIALLY consumed keeps its identity at the source, and the moved fragment is
 * a NEW presence that must be minted fresh.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY A COLLISION RULE, NOT A POSITIONAL ONE
 *
 * The two cases above differ only in whether the source presence SURVIVES the
 * cut, which is exactly what "is this id still live after the delete?" answers —
 * so a mover doesn't reason about open depths, join semantics or which end of
 * the range was partial. It builds the deletion, reads what identity remains,
 * and re-mints only what would collide. A full move collides with nothing and
 * keeps every id; a partial move collides on precisely the surviving block.
 *
 * This is the DUAL of `stack-pull.ts`'s unconditional `withFreshUuid` /
 * `withFreshAtomIds`: a pull is paste-as-new (the source presence always
 * survives, so EVERY id is fresh), a move is relocation (the source presence
 * usually doesn't, so ids travel). Same axis — block uuid + inline-atom id — read
 * two ways, which is why the collectors below are shared by both.
 *
 * RELATIONSHIP TO `BlockUuidBackfill`
 *
 * The backfill (`block-uuid-backfill.ts`) is the transaction-time NET: it
 * guarantees uniqueness for every insertion whatever produced it. It is not a
 * substitute for this, because a net can only tell that two blocks collide, not
 * which one the user meant to keep — left to it, the empty residue of a cut wins
 * the identity and the moved text is re-minted, silently detaching every anchor
 * from its own words. So the MECHANISM states identity (here) and the NET
 * catches what no mechanism declared.
 *
 * COST: O(destination doc) per gesture, on a human-paced drop — never on a
 * keystroke.
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";
import { remintNestedAtomIds } from "@/lib/inline-content";
import { generateShortId } from "@/lib/uuid";

/** Every non-null block `uuid` live in `doc` (any depth — nested list items,
 *  example items and container bodies all carry one). */
export function collectBlockUuids(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const u = node.attrs?.uuid;
    if (typeof u === "string" && u) ids.add(u);
    return true;
  });
  return ids;
}

/**
 * Every Card-bearing inline-atom id live in `doc` — the `footnoteId` /
 * `citationId` (via the ATOM_REGISTRY `idAttr`) plus its unified `linkId`
 * mirror. Atom kinds that own no cloneable Card identity (inlineMath /
 * labelRef → `idAttr: null`) are skipped, exactly as the remint skips them.
 */
export function collectAtomIds(doc: PMNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => {
    const meta = atomMetaForNodeName(node.type.name);
    if (meta?.idAttr) {
      const own = node.attrs[meta.idAttr];
      if (typeof own === "string" && own) ids.add(own);
      const linkId = node.attrs.linkId;
      if (typeof linkId === "string" && linkId) ids.add(linkId);
    }
    return true;
  });
  return ids;
}

/**
 * Hand a freed `uuid` to the moved run: stamp it on the first node of `nodes`
 * that carries a `uuid` attribute currently set to null, outermost first.
 *
 * The other half of "a move conserves identity". `rangeSliceToBlocks` handles a
 * range confined to ONE textblock by building a BRAND-NEW paragraph around the
 * bare inline content (`paragraph.create(null, …)`) — the source block's uuid is
 * not on the payload at all. That was harmless only while the emptied source
 * block survived to hold it; the moment the residue is shed, the identity is
 * carried by nothing and DISAPPEARS from the document, orphaning every card
 * anchored to it. Which is the exact anchor-detachment this task exists to
 * prevent, arriving from the other direction (review-caught).
 *
 * So the identity the shell removal frees is transferred here, and only then —
 * a shell that survives keeps its own id and there is nothing to transfer.
 * Outermost-first because the fit may have WRAPPED the payload (a `listItem` /
 * `exampleItem` around the paragraph), and the wrapper is then the anchorable
 * text object at the destination. A payload whose first block already carries an
 * id (any multi-block range) is left alone: it has its identity already.
 */
export function inheritBlockUuid(
  nodes: readonly PMNode[],
  uuid: string,
  schema: Schema,
): PMNode[] {
  if (nodes.length === 0) return nodes as PMNode[];
  const stamp = (json: JSONContent): JSONContent | null => {
    const attrs = json.attrs as Record<string, unknown> | undefined;
    if (attrs && "uuid" in attrs && !attrs.uuid) {
      return { ...json, attrs: { ...attrs, uuid } };
    }
    if (Array.isArray(json.content) && json.content.length > 0) {
      const first = stamp(json.content[0]);
      if (first) return { ...json, content: [first, ...json.content.slice(1)] };
    }
    return null;
  };
  const stamped = stamp(nodes[0].toJSON() as JSONContent);
  if (!stamped) return nodes as PMNode[];
  try {
    const rebuilt = schema.nodeFromJSON(
      stamped as Parameters<typeof schema.nodeFromJSON>[0],
    );
    return [rebuilt, ...nodes.slice(1)];
  } catch (err) {
    // Better to leave the payload un-identified (the backfill mints a fresh id)
    // than to drop the user's content.
    console.error("[node-identity] uuid inheritance re-hydrate failed:", err);
    return nodes as PMNode[];
  }
}

/** True iff any node in `nodes` (at any depth) carries an id already in the
 *  live sets — the O(payload) pre-check that keeps a clean move allocation-free
 *  and, more importantly, byte-identical to what the caller built. */
function collides(
  nodes: readonly PMNode[],
  liveUuids: ReadonlySet<string>,
  liveAtomIds: ReadonlySet<string>,
): boolean {
  const seenUuids = new Set<string>();
  const seenAtomIds = new Set<string>();
  let hit = false;
  const visit = (node: PMNode): void => {
    const u = node.attrs?.uuid;
    if (typeof u === "string" && u) {
      if (liveUuids.has(u) || seenUuids.has(u)) hit = true;
      seenUuids.add(u);
    }
    const meta = atomMetaForNodeName(node.type.name);
    if (meta?.idAttr) {
      for (const key of [meta.idAttr, "linkId"]) {
        const v = node.attrs[key];
        if (typeof v === "string" && v) {
          if (liveAtomIds.has(v) || seenAtomIds.has(v)) hit = true;
          seenAtomIds.add(v);
        }
      }
    }
    node.content.forEach(visit);
  };
  for (const n of nodes) visit(n);
  return hit;
}

/** Re-mint every `uuid` in a JSON blob that would collide, recursively. Ids that
 *  don't collide are KEPT and registered, so a payload's own internal structure
 *  (a moved list and its items) travels intact. */
function remintCollidingUuids(json: JSONContent, live: Set<string>): JSONContent {
  const walk = (node: JSONContent): JSONContent => {
    let out = node;
    const attrs = node.attrs as Record<string, unknown> | undefined;
    const u = attrs?.uuid;
    if (typeof u === "string" && u) {
      if (live.has(u)) {
        const fresh = generateShortId(live);
        live.add(fresh);
        out = { ...out, attrs: { ...attrs, uuid: fresh } };
      } else {
        live.add(u);
      }
    }
    if (Array.isArray(out.content)) {
      const kids = out.content.map(walk);
      if (kids.some((k, i) => k !== (out.content as JSONContent[])[i])) {
        out = { ...out, content: kids };
      }
    }
    return out;
  };
  return walk(json);
}

/**
 * Give a relocated payload an identity that can coexist with what the
 * destination already holds: keep every id that is free, re-mint only the ones
 * still live there. `liveUuids` / `liveAtomIds` are MUTATED as ids are claimed,
 * so successive calls (and two payload blocks that shared an id) can't collide
 * with each other either.
 *
 * Read the live sets from the doc the payload is about to enter, AFTER the
 * source deletion is staged (`collectBlockUuids(tr.doc)`) — that is what makes
 * "did the source survive?" the question being asked. Reading them from the
 * pre-delete doc would re-mint every id on every move.
 *
 * Returns the SAME array when nothing collides (the overwhelmingly common
 * whole-move case), so a clean move stays byte-identical.
 */
export function remintCollidingIdentity(
  nodes: readonly PMNode[],
  schema: Schema,
  liveUuids: Set<string>,
  liveAtomIds: Set<string>,
): PMNode[] {
  if (!collides(nodes, liveUuids, liveAtomIds)) return nodes as PMNode[];
  const out: PMNode[] = [];
  for (const node of nodes) {
    // Atom ids first (`remintNestedAtomIds` reaches a `\cite` nested inside a
    // footnote body's `attrs.content` blob — the live editor's own reading),
    // then block uuids over the result.
    const withAtoms = remintNestedAtomIds(node.toJSON() as JSONContent, (typeName, oldId) => {
      const meta = atomMetaForNodeName(typeName);
      if (!meta?.idAttr) return null; // ref / inline-math own no Card identity
      if (!liveAtomIds.has(oldId)) {
        liveAtomIds.add(oldId);
        return null; // free — the atom travels with its text
      }
      const fresh = generateShortId(liveAtomIds);
      liveAtomIds.add(fresh);
      return fresh;
    }).content;
    const json = remintCollidingUuids(withAtoms, liveUuids);
    try {
      out.push(schema.nodeFromJSON(json as Parameters<typeof schema.nodeFromJSON>[0]));
    } catch (err) {
      // A payload we can't re-hydrate is a payload we can't safely re-identify.
      // Keep the original rather than dropping the user's content — the
      // BlockUuidBackfill net still guarantees uniqueness at dispatch.
      console.error("[node-identity] re-hydrate after remint failed:", err);
      out.push(node);
    }
  }
  return out;
}
