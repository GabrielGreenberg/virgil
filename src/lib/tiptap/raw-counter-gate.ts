import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { LABEL_DECLARING_NODE_TYPES } from "@/lib/node-attr-sets";
import {
  RAW_SOURCE_INERT_NODE_TYPES,
  mayDeclareRawCounters,
  rawCounterSignature,
  scanDisplayMathCounters,
  scanRawTextCounters,
} from "@/lib/latex-counters";
import { pmTextblockText } from "@/lib/ref-display";
import { resolveTouchedBlock, type StructureDiff } from "./doc-structure";

/**
 * Did this transaction change what RAW SOURCE declares or numbers (task 742)?
 *
 * The numberer (`editor-extensions.ts` `sectionNumbers`) re-derives every
 * `\ref` only on a STRUCTURAL change. Headings, figures, examples and their
 * attr labels reach it through the observer diff; raw source — an equation's
 * `\label`, an `align` row gaining a `\\`, a `table`'s `\caption` — lives in
 * text and `displayMath.latex`, which the observer reports only as "this
 * block's content changed". So the question is asked per TOUCHED block:
 * its counter signature before vs after. Equal signatures (every plain
 * keystroke, even one inside an equation) → no renumber.
 *
 * Cost: O(touched blocks × block size) — the old and new node of each uuid
 * the diff names, located through `resolveTouchedBlock` (no snapshot
 * materialization), with a substring pre-check before any scan.
 */
export function rawCountersTouched(
  diff: StructureDiff,
  oldState: EditorState,
  newState: EditorState,
): boolean {
  const uuids = new Set<string>(diff.contentChangedUuids);
  for (const b of diff.addedBlocks) uuids.add(b.uuid);
  for (const b of diff.removedBlocks) uuids.add(b.uuid);
  for (const b of diff.changedBlocks) uuids.add(b.uuid);
  for (const uuid of uuids) {
    if (signatureAt(oldState, uuid) !== signatureAt(newState, uuid)) return true;
  }
  return false;
}

function signatureAt(state: EditorState, uuid: string): string {
  const entry = resolveTouchedBlock(state, uuid);
  if (!entry) return "";
  const node = state.doc.nodeAt(entry.pos);
  return node ? blockRawCounterSignature(node) : "";
}

/** The counter signature of one block — the SAME scans, over the SAME text,
 *  that `buildRefTargetIndex` reads. Kinds whose declarations are attrs
 *  (headings, figures, examples) and source that declares nothing (verbatim,
 *  comments) contribute nothing here. */
export function blockRawCounterSignature(node: PMNode): string {
  const own = ownSignature(node);
  if (own !== null) return own;
  const parts: string[] = [];
  node.descendants((child) => {
    const sig = ownSignature(child);
    if (sig === null) return true;
    if (sig) parts.push(sig);
    return false;
  });
  return parts.join("/");
}

/** A node's own signature, or null when it is a container to descend into. */
function ownSignature(node: PMNode): string | null {
  const name = node.type.name;
  if (LABEL_DECLARING_NODE_TYPES.has(name) || RAW_SOURCE_INERT_NODE_TYPES.has(name)) return "";
  if (name === "displayMath") {
    return rawCounterSignature(scanDisplayMathCounters((node.attrs.latex as string) ?? ""));
  }
  if (!node.isTextblock) return node.isLeaf ? "" : null;
  const text = pmTextblockText(node);
  return mayDeclareRawCounters(text) ? rawCounterSignature(scanRawTextCounters(text)) : "";
}
