/**
 * Unified, cached UUID↔LaTeX-source position map for the CodeMirror pane.
 *
 * The single source of truth for "which paragraph UUID lives at which
 * line / char offset in the `.tex` source", consumed by:
 *   - the code-pane bridge (`code-pane-bridge.ts`) for bidirectional
 *     cursor/selection sync,
 *   - the cursor band / focus-view scroll,
 *   - scroll-to-paragraph (`CodeEditor.tsx` handle).
 *
 * Design — WeakMap keyed by the CodeMirror `Text` doc object:
 *   CodeMirror docs are immutable; every edit produces a *new* `Text`
 *   instance. Keying the cache by `view.state.doc` therefore
 *   auto-invalidates on every change (the new doc misses the cache and
 *   re-parses once) while being shared across all callers that pass the
 *   same `view` for an unchanged doc — zero per-instance cache threading.
 *   A WeakMap lets stale docs be garbage-collected once CM drops them.
 *
 * This module wraps `findParagraphUuids` / `paragraphForLine` from
 * `latex-paragraph-map.ts`; it does NOT reimplement their logic. Those
 * are re-exported here so callers have a single import surface.
 */
import type { EditorView } from "@codemirror/view";
import type { Text } from "@codemirror/state";
import {
  findParagraphUuids,
  paragraphForLine,
  type ParagraphUuidRange,
} from "@/lib/latex-paragraph-map";

export { findParagraphUuids, paragraphForLine };
export type { ParagraphUuidRange };

/**
 * doc → parsed ranges. Keyed by the immutable `Text` instance so it
 * auto-invalidates on edit and is shared by all callers on the same doc.
 */
const cache = new WeakMap<Text, ParagraphUuidRange[]>();

/**
 * Cached `findParagraphUuids` for the view's current doc. On a cache
 * miss the doc is parsed once, stored, and returned; subsequent calls on
 * the same (unchanged) doc reuse the same array reference.
 */
export function getRanges(view: EditorView): ParagraphUuidRange[] {
  const doc = view.state.doc;
  const hit = cache.get(doc);
  if (hit) return hit;
  const ranges = findParagraphUuids(doc.toString());
  cache.set(doc, ranges);
  return ranges;
}

/** The `{ uuid, startLine, endLine }` range for a UUID, or null. */
export function getLineRangeForUuid(
  view: EditorView,
  uuid: string,
): ParagraphUuidRange | null {
  return getRanges(view).find((r) => r.uuid === uuid) ?? null;
}

/** The UUID whose line range covers the given 1-based line, or null. */
export function getUuidForLine(view: EditorView, line: number): string | null {
  return paragraphForLine(getRanges(view), line);
}

/**
 * The `{ from, to }` character range (CodeMirror positions) spanning a
 * UUID's block, or null if the UUID isn't found. Line numbers are
 * clamped to the doc's valid `[1, lines]` range. Defensive: returns null
 * on any throw.
 */
export function getCharRangeForUuid(
  view: EditorView,
  uuid: string,
): { from: number; to: number } | null {
  try {
    const range = getLineRangeForUuid(view, uuid);
    if (!range) return null;
    const doc = view.state.doc;
    const clamp = (n: number) => Math.min(Math.max(1, n), doc.lines);
    const from = doc.line(clamp(range.startLine)).from;
    const to = doc.line(clamp(range.endLine)).to;
    return { from, to };
  } catch {
    return null;
  }
}

/**
 * The paragraph UUID for the current cursor position. If the cursor's
 * line falls inside a UUID block, that block's UUID is returned;
 * otherwise the closest block by mid-line distance is chosen. Returns
 * null when there are no UUID blocks or on any throw.
 */
export function getActiveParagraphUuid(view: EditorView): string | null {
  try {
    const ranges = getRanges(view);
    if (ranges.length === 0) return null;
    const cursorLine = view.state.doc.lineAt(
      view.state.selection.main.head,
    ).number;
    const direct = ranges.find(
      (r) => cursorLine >= r.startLine && cursorLine <= r.endLine,
    );
    if (direct) return direct.uuid;
    // Cursor lies between paragraphs — pick the closest by mid-line.
    let best = ranges[0];
    let bestDist = Infinity;
    for (const r of ranges) {
      const mid = (r.startLine + r.endLine) / 2;
      const d = Math.abs(mid - cursorLine);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best.uuid;
  } catch {
    return null;
  }
}
