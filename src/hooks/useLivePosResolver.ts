"use client";

import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { getBus, type DocStructure } from "@/lib/tiptap/doc-structure";

/** Resolves a caller-chosen id to a LIVE ProseMirror position. */
export type LivePosResolver = (id: string) => number | undefined;

/** The entity kinds the DocStructureObserver indexes positionally that this
 *  resolver walks when it rebuilds the lookup map. These are exactly the
 *  members of `CardKind` the hook keys on, so a `cardPopKey`-style `keyOf`
 *  type-checks directly. The range-anchored consumer (a main-text search
 *  highlight keyed on a block uuid + char offset) is served by the separate
 *  `resolveLiveBlockRange` below, which reads the same live snapshot. */
export type LivePosKind = "footnote" | "citation" | "example";

/** A block-relative match identity: the block's stable uuid + the character
 *  offset of the match WITHIN that block's text + the match length. This is
 *  the keystroke-durable surrogate for a raw `{from,to}` — the block can shift
 *  arbitrarily under earlier edits, but the uuid + intra-block offset stay
 *  valid until the block's own text changes. */
export interface BlockRangeId {
  blockUuid: string;
  /** Character offset of the match start within the block's text content. */
  offset: number;
  /** Length of the matched run, in characters. */
  length: number;
}

/**
 * Resolve a block-relative match identity to a LIVE ProseMirror range from the
 * editor's `DocStructureBus` snapshot. The block's opening-token position
 * (`BlockEntry.pos`) is re-mapped every transaction by the observer, so adding
 * a sentence in an EARLIER paragraph shifts this block's `pos` and the returned
 * range tracks it — fixing the "highlight lands on stale text after an earlier
 * edit" class (SR-F1-01 / SR-A2-01 / SR-F3-04).
 *
 * The block's text content begins at `pos + 1` (just inside the node's opening
 * token), so `from = pos + 1 + offset`. The two failure modes are distinct and
 * the caller must treat them differently:
 *
 * - `null` — the snapshot is PRESENT but no longer carries the block: it was
 *   deleted. The caller must no-op (the baked search-time range now points at
 *   whatever unrelated text shifted into those coordinates).
 * - `undefined` — there is NO snapshot at all (an editor surface without the
 *   DocStructureObserver, or no editor). Only here may the caller fall back to
 *   its baked range. On the main editor `buildInitial` populates the snapshot
 *   at plugin-state init, so this branch never fires there.
 *
 * **Keystroke sanctity:** call this at a discrete user action (a result
 * click), never per keystroke — same call-site discipline as `useLivePosResolver`.
 * It is a single map lookup + two adds; it does NOT rebuild anything.
 */
export function resolveLiveBlockRange(
  editor: Editor | null,
  id: BlockRangeId,
): { from: number; to: number } | null | undefined {
  const s = getBus(editor)?.structure;
  if (!s) return undefined;
  const block = s.blocks.get(id.blockUuid);
  if (!block) return null;
  const from = block.pos + 1 + id.offset;
  return { from, to: from + id.length };
}

/**
 * Maps a caller's id → the entity's LIVE document position, derived from the
 * editor's `DocStructureBus` snapshot (`getBus(editor).structure`) — which the
 * observer re-maps on EVERY transaction (`mapStructurePositions`), so the
 * positions are never stale, even after plain typing that shifts later offsets.
 *
 * The id space is the caller's choice via `keyOf`: the omni surface keys on
 * `cardPopKey(kind, id)` (= `float:card:<kind>:<id>`); a search/range consumer
 * keys on the bare entity id. The hook builds ONE `Map<id, pos>` from the
 * snapshot and returns `map.get(id)`.
 *
 * **Keystroke sanctity (read this before adding a call site):** the lookup map
 * is cached by SNAPSHOT IDENTITY (`cacheRef.current.s !== s`), so it rebuilds
 * exactly once per *new* `DocStructure` object the observer hands out. That
 * identity is NOT keystroke-stable: a plain keystroke inside a uuid-bearing
 * block is a *content-change* diff (the block's uuid lands in
 * `contentChangedUuids`), so the observer's `mapStructurePositions` builds a
 * brand-new `DocStructure` (every position re-mapped) and `_emit` writes it to
 * `getBus(editor).structure` — a NEW snapshot object on that keystroke (the
 * `emitCount` probe stays flat because the emit is content-only, not
 * structural, but the snapshot reference still changes). So calling `resolve()`
 * during plain typing DOES rebuild the map. That rebuild is O(footnotes +
 * citations + examples) — bounded and tiny, never O(doc-size) — but it is not
 * free.
 *
 * Therefore the keystroke-safety of this hook lives at the CALL SITE, not in
 * the cache key: only ever call `resolve()` behind a structural memo, inside a
 * RAF-coalesced layout read, or at a discrete user action (a result click, a
 * marker click) — NEVER from a raw per-keystroke handler (an
 * `editor.on('update')` subscriber, an `onChange`, a render that runs on every
 * transaction). Used that way, the resolver does zero work between user
 * actions and the bounded rebuild only fires when a position is actually
 * needed. Never gate this on a doc-walk; the snapshot object is the cache key,
 * and the call cadence is the consumer's responsibility.
 *
 * Returns `undefined` for an id the snapshot doesn't carry, so callers can
 * fall back to a captured `pos` (the `resolvePos(id) ?? item.pos` pattern).
 *
 * This is the promoted form of the pattern `OmniViewPanel` first proved
 * inline; it is the single answer to "how does a panel surface get a live
 * position." See `useInTextPositions` (resolves it at measure time),
 * `docs/perf/keystroke-sanctity-findings.md`, and the T5 design.
 */
export function useLivePosResolver(
  editor: Editor | null,
  keyOf: (kind: LivePosKind, id: string) => string,
  /**
   * Optional `omniItemId → paragraph UUID` map for PARAGRAPH-anchored cards
   * (note / todo / cutter / revision / report / archive). Unlike footnotes /
   * citations / examples — which are entity-anchored and key on
   * `keyOf(kind, entityId)` — these cards anchor to a paragraph whose UUID the
   * builder knows but the snapshot can't infer from the card id. Pass the map
   * (built from the omni items, which now carry `anchorUuid`) and this resolver
   * also indexes `structure.blocks.get(uuid).pos` for each, so the card tracks
   * its paragraph live during typing instead of riding the stale baked `pos`.
   * The map identity changes only when the items (structurally) rebuild, so it
   * participates in the cache key alongside the snapshot identity.
   */
  paragraphAnchors?: ReadonlyMap<string, string>,
): LivePosResolver {
  const cacheRef = useRef<{
    s: DocStructure | null;
    anchors: ReadonlyMap<string, string> | undefined;
    map: Map<string, number>;
  }>({ s: null, anchors: undefined, map: new Map() });

  return useCallback(
    (id: string): number | undefined => {
      const s = getBus(editor)?.structure ?? null;
      if (!s) return undefined;
      // Rebuild when EITHER the snapshot (positions re-mapped every tx) OR the
      // paragraph-anchor map (structural rebuild of the items) changes identity.
      if (cacheRef.current.s !== s || cacheRef.current.anchors !== paragraphAnchors) {
        const map = new Map<string, number>();
        for (const f of s.footnotes) map.set(keyOf("footnote", f.id), f.pos);
        for (const c of s.citations) map.set(keyOf("citation", c.id), c.pos);
        for (const e of s.examples) {
          map.set(keyOf("example", e.id), e.pos);
          if (e.uuid) map.set(keyOf("example", e.uuid), e.pos);
        }
        // Paragraph-anchored cards: resolve each omni id to its anchor block's
        // LIVE position from the snapshot. Bounded by the number of anchored
        // cards (a `blocks.get` per entry), never the doc size. A card whose
        // anchor paragraph is no longer in the snapshot (deleted) is simply not
        // added → the resolver returns `undefined` for it and the caller falls
        // back to the baked pos / orphan binning.
        if (paragraphAnchors) {
          for (const [omniId, uuid] of paragraphAnchors) {
            const b = s.blocks.get(uuid);
            if (b) map.set(omniId, b.pos);
          }
        }
        cacheRef.current = { s, anchors: paragraphAnchors, map };
      }
      return cacheRef.current.map.get(id);
    },
    // `keyOf` is expected to be a stable reference (module-level helper like
    // `cardPopKey`); listing it keeps the lint exhaustiveness rule satisfied
    // without churning the cache (the snapshot/anchors-identity guard gates).
    [editor, keyOf, paragraphAnchors],
  );
}

/**
 * Build the `omniItemId → paragraph UUID` map `useLivePosResolver` consumes,
 * from a list of omni items. Only paragraph-anchored items (those carrying an
 * `anchorUuid`) are included. Memoize on the items array so the map identity is
 * stable until the items (structurally) rebuild — that stability is what keeps
 * the resolver's snapshot cache from churning on plain typing.
 */
export function buildParagraphAnchorMap(
  items: ReadonlyArray<{ id: string; anchorUuid?: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const it of items) {
    if (it.anchorUuid) m.set(it.id, it.anchorUuid);
  }
  return m;
}
