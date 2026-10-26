/**
 * useStructuralRevisions — per-category structural change counters
 *
 * The canonical replacement for the old per-keystroke `docVersion` /
 * `editorDocVersion` counters (see `docs/perf/keystroke-sanctity-findings.md`).
 * Those bumped on every `editor.on('update')` — even structurally-null edits
 * (typing inside a paragraph) — forcing every card-source memo to re-derive
 * and every card to re-render/reposition. This hook instead exposes one
 * monotonic counter per structural-entity kind, each bumping ONLY when that
 * kind actually changes (add / remove / reorder / attr change), sourced from
 * the editor's `DocStructureBus`.
 *
 * Use the counters as `useMemo` dependencies for card-source derivations:
 *
 *     const rev = useStructuralRevisions(editor);
 *     const footnoteInfos = useMemo(
 *       () => editor?.getFootnotes() ?? [],
 *       [editor, rev.footnotes],
 *     );
 *
 * A keystroke that changes no structure fires no bus event → no counter bump
 * → stable memo identities → no card re-render. That is the whole point.
 *
 * Positions are deliberately NOT a counter here. They shift on every edit and
 * are read live from `getBus(editor).structure` at measure time by the layout
 * layer (`useInTextPositions`) — gating positions on these counters would make
 * cards drift on the keystroke that wraps a line. Keep content here, positions
 * in the snapshot.
 *
 * INITIAL POPULATION — important: these counters start at 0 and bump only on
 * *changes*. `buildInitial` emits nothing, so none of them fire on doc load. A
 * consumer therefore must ALSO depend on the reactive editor instance
 * (`editor` / `editorInstance` state) — not just `rev.X` — so its memo/effect
 * (re)runs once the editor mounts and hydrates. Never gate a `ref`-based
 * derivation (`editorRef.current?.getX()`) on a counter alone: the ref's
 * identity never changes and the counter is silent on load, so the memo reads
 * the not-yet-ready ref exactly once and never refreshes. Prefer deriving from
 * the reactive `editor` and threading the result down as a prop (see how
 * `footnoteInfos` / `examples` are sourced in `EditorPane`).
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  getBus,
  STRUCTURAL_REVISION_PREDICATES,
  type StructuralRevisionCategory,
} from "@/lib/tiptap/doc-structure";
import { rafCoalesced } from "@/lib/raf-coalesced";

/**
 * One counter per category of `STRUCTURAL_REVISION_PREDICATES`
 * (doc-structure/types.ts) — the keys DERIVE from that table, and each counter
 * bumps exactly when its predicate holds (task 1301):
 *
 *  - footnotes — added / removed / reordered (also covers footnote-body edits).
 *  - citations — added / removed / reordered / attrs changed, or a footnote
 *    body changed (a citation can live inside one).
 *  - examples  — exampleBlock added / removed / structurally changed.
 *  - anchors   — linkedAnchor mark (note·cut·revision·report·…) added / removed.
 *  - blocks    — anchorable block added / removed / reordered.
 *  - headings  — heading added / removed / structural-attr changed.
 *  - figures   — figureBlock added / removed / structural-attr changed.
 *  - labels    — `\label{…}` defined / removed / moved with its owner.
 */
export type StructuralRevisions = Record<StructuralRevisionCategory, number>;

const CATEGORIES = Object.keys(
  STRUCTURAL_REVISION_PREDICATES,
) as StructuralRevisionCategory[];

const ZERO: StructuralRevisions = Object.fromEntries(
  CATEGORIES.map((k) => [k, 0]),
) as StructuralRevisions;

export function useStructuralRevisions(
  editor: Editor | null | undefined,
): StructuralRevisions {
  const [revs, setRevs] = useState<StructuralRevisions>(ZERO);
  // Categories bumped since the last flush — the held-backspace damper
  // (typing-latency fix 2c). A key-repeat delete across N blocks fires a
  // structural emit per block-merge tx (~30/s); flushing per emit meant a
  // panel-rerendering setState per repeat. Accumulate instead and flush ONE
  // merged setRevs on the next frame: counters stay monotonic and
  // per-category, a burst inside one frame costs one render, and the damper
  // engages hardest exactly when frames are long (backpressure). Latency
  // cost ≤ 1 frame — imperceptible for panel counts. The synchronous
  // policy/appendTransaction path doesn't run through this hook at all.
  const pendingRef = useRef<Set<keyof StructuralRevisions>>(new Set());

  useEffect(() => {
    if (!editor) return;
    const bus = getBus(editor);
    if (!bus) return;
    // Counters are monotonic and their absolute value is irrelevant — only
    // *changes* matter, and every consumer keys its memo on `[editor, rev.X]`,
    // so a doc-switch remount already forces recompute via the `editor` dep.
    // No reset needed (and a synchronous setState here would cascade renders).

    const pending = pendingRef.current;
    pending.clear();
    const flush = rafCoalesced(() => {
      if (pending.size === 0) return;
      const keys = [...pending];
      pending.clear();
      setRevs((p) => {
        const next = { ...p };
        for (const k of keys) next[k] = p[k] + 1;
        return next;
      });
    });

    // ONE subscription: every structural emit asks each category's declared
    // predicate (O(categories) boolean checks over the diff — the same work
    // the per-channel emits did). Content-only diffs never reach
    // `onAnyChange`, so typing bumps nothing.
    const unsub = bus.onAnyChange((diff) => {
      let any = false;
      for (const k of CATEGORIES) {
        if (STRUCTURAL_REVISION_PREDICATES[k](diff)) {
          pending.add(k);
          any = true;
        }
      }
      if (any) flush.schedule();
    });

    return () => {
      flush.cancel();
      unsub();
    };
  }, [editor]);

  return revs;
}
