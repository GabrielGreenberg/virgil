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

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getBus } from "@/lib/tiptap/doc-structure";

export interface StructuralRevisions {
  /** Footnote node added / removed / reordered (also covers footnote-body edits). */
  footnotes: number;
  /** Citation node added / removed / reordered / attrs (command·displayText) changed. */
  citations: number;
  /** exampleBlock added / removed / structurally changed. */
  examples: number;
  /** linkedAnchor mark (note·cut·revision·quotation·…) added / removed. */
  anchors: number;
  /** Anchorable block added / removed (drives doc-order-dependent derivations). */
  blocks: number;
  /** Heading added / removed / structural-attr changed. */
  headings: number;
  /** figureBlock added / removed / structural-attr changed. */
  figures: number;
  /** `\label{…}` defined / removed. */
  labels: number;
}

const ZERO: StructuralRevisions = {
  footnotes: 0,
  citations: 0,
  examples: 0,
  anchors: 0,
  blocks: 0,
  headings: 0,
  figures: 0,
  labels: 0,
};

export function useStructuralRevisions(
  editor: Editor | null | undefined,
): StructuralRevisions {
  const [revs, setRevs] = useState<StructuralRevisions>(ZERO);

  useEffect(() => {
    if (!editor) return;
    const bus = getBus(editor);
    if (!bus) return;
    // Counters are monotonic and their absolute value is irrelevant — only
    // *changes* matter, and every consumer keys its memo on `[editor, rev.X]`,
    // so a doc-switch remount already forces recompute via the `editor` dep.
    // No reset needed (and a synchronous setState here would cascade renders).

    const bump = (key: keyof StructuralRevisions) => () =>
      setRevs((p) => ({ ...p, [key]: p[key] + 1 }));

    const unsubs = [
      bus.onFootnotesAdded(bump("footnotes")),
      bus.onFootnotesRemoved(bump("footnotes")),
      bus.onFootnoteOrderChanged(bump("footnotes")),

      bus.onCitationsAdded(bump("citations")),
      bus.onCitationsRemoved(bump("citations")),
      bus.onCitationsChanged(bump("citations")),
      bus.onCitationOrderChanged(bump("citations")),
      // A citation can be born / edited / removed entirely inside a footnote's
      // opaque `attrs.content`, invisible to step inspection. A footnote-body
      // edit surfaces as a footnote-order change — re-derive citations then too.
      bus.onFootnoteOrderChanged(bump("citations")),

      bus.onExamplesAdded(bump("examples")),
      bus.onExamplesRemoved(bump("examples")),
      bus.onExamplesRecomputable(bump("examples")),

      bus.onAnchorsAdded(bump("anchors")),
      bus.onAnchorsRemoved(bump("anchors")),

      bus.onBlocksAdded(bump("blocks")),
      bus.onBlocksRemoved(bump("blocks")),

      bus.onHeadingsAdded(bump("headings")),
      bus.onHeadingsRemoved(bump("headings")),
      bus.onHeadingsChanged(bump("headings")),

      bus.onFiguresAdded(bump("figures")),
      bus.onFiguresRemoved(bump("figures")),
      bus.onFiguresChanged(bump("figures")),

      bus.onLabelsAdded(bump("labels")),
      bus.onLabelsRemoved(bump("labels")),
    ];

    return () => {
      for (const u of unsubs) u();
    };
  }, [editor]);

  return revs;
}
