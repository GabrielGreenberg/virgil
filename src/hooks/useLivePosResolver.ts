"use client";

import { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { getBus, type DocStructure } from "@/lib/tiptap/doc-structure";

/** Resolves a caller-chosen id to a LIVE ProseMirror position. */
export type LivePosResolver = (id: string) => number | undefined;

/** The entity kinds the DocStructureObserver indexes positionally that this
 *  resolver walks when it rebuilds the lookup map. These are exactly the
 *  members of `CardKind` the hook keys on, so a `cardPopKey`-style `keyOf`
 *  type-checks directly. (Range-anchored consumers — e.g. a search highlight
 *  keyed on an `anchorId`/from — would extend this; that's a separate T5
 *  pillar and not introduced here.) */
export type LivePosKind = "footnote" | "citation" | "example";

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
 * **Keystroke sanctity (non-negotiable):** the lookup map is cached by
 * SNAPSHOT IDENTITY (`livePosCacheRef.current.s !== s`), so it rebuilds only
 * when the observer publishes a NEW snapshot — i.e. once per *structural*
 * transaction. A plain in-paragraph keystroke produces the SAME snapshot
 * identity (the observer re-maps positions in place onto a new object only on
 * a `docChanged` tx, and a structurally-null edit leaves the bus snapshot
 * reference unchanged), so this resolver does ZERO work and rebuilds nothing
 * on plain typing. Never gate this on a doc-walk or an `editor.on('update')`
 * subscriber; the cache key is the observer's own snapshot object.
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
): LivePosResolver {
  const cacheRef = useRef<{ s: DocStructure | null; map: Map<string, number> }>({
    s: null,
    map: new Map(),
  });

  return useCallback(
    (id: string): number | undefined => {
      const s = getBus(editor)?.structure ?? null;
      if (!s) return undefined;
      if (cacheRef.current.s !== s) {
        const map = new Map<string, number>();
        for (const f of s.footnotes) map.set(keyOf("footnote", f.id), f.pos);
        for (const c of s.citations) map.set(keyOf("citation", c.id), c.pos);
        for (const e of s.examples) {
          map.set(keyOf("example", e.id), e.pos);
          if (e.uuid) map.set(keyOf("example", e.uuid), e.pos);
        }
        cacheRef.current = { s, map };
      }
      return cacheRef.current.map.get(id);
    },
    // `keyOf` is expected to be a stable reference (module-level helper like
    // `cardPopKey`); listing it keeps the lint exhaustiveness rule satisfied
    // without churning the cache (the snapshot-identity guard does the gating).
    [editor, keyOf],
  );
}
