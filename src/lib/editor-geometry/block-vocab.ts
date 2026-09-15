/**
 * Doc-ordered block-uuid vocabularies over the DocStructure snapshot — the
 * ONE place the "cache the ORDER, read positions fresh" rule is stated, for
 * the geometry readers that binary-search blocks by position (the breadcrumb's
 * par-titled vocabulary, the active-block probe's anchorable vocabulary).
 *
 * The cache is keyed on `structure.structuralVersion`, NOT `structure.version`
 * (task 585). `version` bumps on EVERY non-empty diff, including the
 * content-only diff a plain keystroke inside a uuid'd block produces — so a
 * `version`-keyed vocabulary was rebuilt (O(blocks) + a sort) on every
 * RAF-coalesced breadcrumb frame while typing, against the claim that frame
 * is "ONE posAtCoords + a binary search". `structuralVersion` moves only when
 * a structural diff is folded (block add/remove/reorder, a `parTitle` flip —
 * `blockParTitleChanged` is structural) or the index is built fresh, which is
 * exactly the set of changes that can alter membership or ORDER.
 *
 * Positions are deliberately NOT cached: a plain keystroke SHIFTS positions
 * without changing order, so probes read `structure.blocks.get(uuid).pos` from
 * the materialized snapshot. Order is structural-version-stable; positions are
 * read fresh.
 */

import type { Editor } from "@tiptap/react";
import type { BlockEntry, DocStructure } from "@/lib/tiptap/doc-structure";

interface Vocab {
  structuralVersion: number;
  uuids: string[];
}

let buildCount = 0;

/** Test probe: cumulative vocabulary builds across every cache. */
export function __blockVocabBuildCount(): number {
  return buildCount;
}

/**
 * A per-editor cache of the uuids of the blocks `include` admits, in document
 * order. One instance per vocabulary (each keeps its own WeakMap).
 */
export function createBlockVocabCache(
  include: (block: BlockEntry) => boolean,
): (editor: Editor, structure: DocStructure) => string[] {
  const cache = new WeakMap<Editor, Vocab>();
  return (editor, structure) => {
    const cached = cache.get(editor);
    if (cached && cached.structuralVersion === structure.structuralVersion) {
      return cached.uuids;
    }
    buildCount++;
    const entries: { uuid: string; pos: number }[] = [];
    for (const b of structure.blocks.values()) {
      if (include(b)) entries.push({ uuid: b.uuid, pos: b.pos });
    }
    entries.sort((a, b) => a.pos - b.pos);
    const vocab: Vocab = {
      structuralVersion: structure.structuralVersion,
      uuids: entries.map((e) => e.uuid),
    };
    cache.set(editor, vocab);
    return vocab.uuids;
  };
}
