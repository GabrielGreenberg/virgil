/**
 * Section-path (breadcrumb) derivation — ONE hit-test + binary search over
 * the structure snapshot, replacing the per-RAF full-document walk (perf
 * Wave 2, C2).
 *
 * The legacy shape (three byte-alike copies: EditorLayout main pane, mirror
 * pane, Reader) walked EVERY top-level child per scheduled frame calling
 * `view.coordsAtPos` per heading AND per par-titled block — ProseMirror's
 * most expensive forced-layout call, O(headings + titles) layout reads per
 * scroll/keystroke frame, ×2 with a split, ×3 with the Reader. This inverts
 * the question: instead of asking every heading "is your Y above the
 * reference line?", ask the VIEW "what position sits AT the reference line?"
 * (one `posAtCoords`) and answer everything else from the DocStructureBus
 * snapshot as data — headings are already pos-sorted in the index, and the
 * par-titled vocabulary is the `BlockEntry.parTitled` flag this wave added.
 * Zero per-heading layout reads; the only DOM reads are the scroll box, the
 * content rect, and the single hit-test.
 *
 * Fidelity notes vs the walk (deliberate, all sub-perceptual):
 *  - "crossed" becomes pos-order at the reference line rather than a
 *    per-heading first-line-Y compare. Top-level blocks are in normal flow,
 *    so Y and pos are monotonic and the two agree — except within the
 *    block-gap right above a heading, where the hit-test may credit the
 *    heading half-a-gap earlier than its text top would. A breadcrumb
 *    boundary a few px early is imperceptible and deterministic.
 *  - text / sectionNumber / index are read from the LIVE node at the
 *    snapshot's (materialized-at-read, hence current) position — the index
 *    entry's `text` is deliberately not trusted (heading TEXT edits are
 *    content-only and don't refresh the entry).
 *  - locked-focus out-of-band headings are skipped exactly as before (the
 *    hide is display:none, so the hit-test can't land in them; candidates
 *    are index-filtered on the band).
 */

import type { Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import type { HeadingEntry } from "@/lib/tiptap/doc-structure";
import { getBus } from "@/lib/tiptap/doc-structure";
import { SECTION_ACTIVE_LINE_FRACTION } from "@/components/editor-layout/layout-scroll";
import { posAtViewportY } from "./viewport-probe";

export interface SectionPathResult {
  path: { text: string; index: number; sectionNumber: string | null }[];
  parTitleIndex: number | null;
}

/** Locked-focus band, in top-level block indices (inclusive). */
export interface SectionSkipBand {
  start: number;
  end: number;
}

/**
 * Kill-switch: `localStorage["virgil:geom-breadcrumb"] = "off"` reverts the
 * three breadcrumb sites to the legacy full-walk path (which also remains
 * the automatic fallback whenever this derivation returns null). Read
 * per-call — it's two dictionary hits, and it makes the switch live without
 * a reload.
 */
export function geomBreadcrumbEnabled(): boolean {
  try {
    return (
      typeof localStorage === "undefined" ||
      localStorage.getItem("virgil:geom-breadcrumb") !== "off"
    );
  } catch {
    return true;
  }
}

// Par-titled vocabulary cache — uuids in doc order, rebuilt only when the
// structure VERSION moves (a structural change; a parTitle flip bumps it via
// `blockParTitleChanged`). Positions are deliberately NOT cached: a plain
// keystroke shifts pos without bumping version, so probes read
// `structure.blocks.get(uuid).pos` from the materialized snapshot instead —
// order is version-stable, positions are read-fresh.
interface ParTitleVocab {
  version: number;
  uuids: string[];
}
const vocabCache = new WeakMap<Editor, ParTitleVocab>();

function parTitledVocab(
  editor: Editor,
  structure: NonNullable<ReturnType<typeof getBus>>["structure"],
): string[] {
  const cached = vocabCache.get(editor);
  if (cached && cached.version === structure.version) return cached.uuids;
  const entries: { uuid: string; pos: number }[] = [];
  for (const b of structure.blocks.values()) {
    // `parTitled` is `deriveParTitled(attrs)`, and only the six members of
    // TITLED_NODE_TYPES declare the attr at all (ProseMirror drops an
    // undeclared one), so the flag IS the membership test — there is no
    // second vocabulary here to drift from the set. Task 404 retired the
    // legacy walk's three-name list, which read "tex/expex par-titles are
    // deliberately not breadcrumb entries": a breadcrumb that omits the
    // titled block you are standing in is the invisibility bug by another
    // name, and the four sibling readers were widened in the same pass.
    if (b.parTitled) {
      entries.push({ uuid: b.uuid, pos: b.pos });
    }
  }
  entries.sort((a, b) => a.pos - b.pos);
  const vocab = { version: structure.version, uuids: entries.map((e) => e.uuid) };
  vocabCache.set(editor, vocab);
  return vocab.uuids;
}

/** Last index in `arr` whose resolved pos is <= `p`, or -1. `posOf` must be
 *  monotonic over `arr` (doc order). */
function lastAtOrBefore<T>(
  arr: readonly T[],
  p: number,
  posOf: (t: T) => number | undefined,
): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const pos = posOf(arr[mid]);
    if (pos === undefined) {
      // Entry vanished mid-snapshot (shouldn't happen — version-keyed) —
      // treat as "before" so the search stays sound and the backward walk
      // skips it.
      lo = mid + 1;
      continue;
    }
    if (pos <= p) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Compute the active section path + par-title index for the given pane.
 *
 * Returns null when the derivation can't run (no DocStructureBus on this
 * editor, or the hit-test found nothing) — callers fall back to the legacy
 * walk, so a null is safe, never a blank breadcrumb.
 *
 * `view` is the PANE's view (main or mirror — they share state), `scrollEl`
 * its scroll container. `skipBand` is the locked-focus band or null.
 */
export function computeSectionPathAt(
  editor: Editor,
  view: EditorView,
  scrollEl: Element,
  skipBand: SectionSkipBand | null,
): SectionPathResult | null {
  const bus = getBus(editor);
  if (!bus) return null;
  const structure = bus.structure;
  const doc = view.state.doc;

  // The shared reference line (top 25% of the pane; bottom-clamped when
  // parked at the end of a scrollable doc) — byte-identical math to the
  // legacy walk.
  const scrollRect = scrollEl.getBoundingClientRect();
  const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
  const atBottom = maxScroll > 4 && maxScroll - scrollEl.scrollTop <= 2;
  const referenceY = atBottom
    ? scrollRect.bottom
    : scrollRect.top + scrollRect.height * SECTION_ACTIVE_LINE_FRACTION;

  // ONE hit-test: what document position sits at the reference line? The X
  // probe is the content column's center, and Y is clamped into the content
  // box so a short / unscrolled doc still resolves (to its first block —
  // which yields the same empty path the walk produced).
  const domRect = view.dom.getBoundingClientRect();
  if (domRect.height <= 0) return null;
  const p = posAtViewportY(view, referenceY, domRect);
  if (p === null) return null;
  // When the content box starts BELOW the reference line entirely (doc at
  // top, line above the first block), nothing is crossed.
  if (referenceY < domRect.top) {
    return { path: [], parTitleIndex: null };
  }

  const topLevelIndexAt = (pos: number): number => {
    try {
      return doc.resolve(Math.min(pos, doc.content.size)).index(0);
    } catch {
      return -1;
    }
  };
  const inBand = (pos: number): boolean => {
    if (!skipBand) return true;
    const idx = topLevelIndexAt(pos);
    return idx >= skipBand.start && idx <= skipBand.end;
  };

  // ── Heading chain: binary search for the last heading at/before the line,
  //    then collect the enclosing chain backward (previous-smaller-level —
  //    exactly the forward walk's pop/push semantics). ──
  const headings = structure.headings;
  let hIdx = lastAtOrBefore(headings, p, (h: HeadingEntry) => h.pos);
  // Skip out-of-band headings off the tail (locked focus hides them).
  while (hIdx >= 0 && !inBand(headings[hIdx].pos)) hIdx--;

  const chain: HeadingEntry[] = [];
  let nextLevel = Infinity;
  for (let i = hIdx; i >= 0 && nextLevel > 1; i--) {
    const h = headings[i];
    if (h.level >= nextLevel) continue;
    if (!inBand(h.pos)) continue;
    chain.push(h);
    nextLevel = h.level;
  }
  chain.reverse();

  const path = chain.map((h) => {
    // Live node read at the snapshot's current pos: text + sectionNumber are
    // presentation attrs the index doesn't (and shouldn't) track freshly.
    const node = doc.nodeAt(h.pos);
    const isHeading = node?.type.name === "heading";
    return {
      text: (isHeading ? node!.textContent : "") || "Untitled",
      index: topLevelIndexAt(h.pos),
      sectionNumber: isHeading
        ? ((node!.attrs?.sectionNumber as string | null) ?? null)
        : null,
    };
  });

  // ── Par-title: the last titled block at/before the line AFTER the last
  //    crossed heading (crossing a heading resets it — the walk's
  //    `activeParTitleIdx = null` on push). ──
  const lastHeadingPos = hIdx >= 0 ? headings[hIdx].pos : -1;
  const vocab = parTitledVocab(editor, structure);
  const posOfUuid = (uuid: string) => structure.blocks.get(uuid)?.pos;
  let tIdx = lastAtOrBefore(vocab, p, posOfUuid);
  while (tIdx >= 0) {
    const pos = posOfUuid(vocab[tIdx]);
    if (pos === undefined || !inBand(pos)) {
      tIdx--;
      continue;
    }
    break;
  }
  let parTitleIndex: number | null = null;
  if (tIdx >= 0) {
    const pos = posOfUuid(vocab[tIdx]);
    if (pos !== undefined && pos > lastHeadingPos) {
      const idx = topLevelIndexAt(pos);
      if (idx >= 0) parTitleIndex = idx;
    }
  }

  return { path, parTitleIndex };
}
