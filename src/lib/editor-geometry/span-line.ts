/**
 * "Which line of its block do a span's words start on?" — ONE owner per
 * editor (task 1420).
 *
 * A span-anchored card and its margin marker sit beside their words, not at
 * their paragraph's top (task 1334). The marker's row is that LINE: the
 * line-box distance from the block's first line to the span's live `from`, in
 * units of the block's measured line pitch — two `coordsAtPos` reads.
 *
 * Before this service the read rode the marker memo's clock, which is the
 * wrong one twice over:
 *   - TOO OFTEN: the memo re-runs whenever the `markers` array is rebuilt, and
 *     a keystroke in a note/comment BODY rebuilds it — so every card-body
 *     keystroke paid two forced-layout reads per visible span marker;
 *   - NOT ENOUGH: doc typing that rewraps a span's words onto another line
 *     WITHOUT changing the block's height fires no RO, no IO and no structural
 *     event, so nothing re-read the line and the icon stayed behind.
 *
 * So the line is keyed on exactly what it depends on — the span's live `from`,
 * the block's position and measured metrics, and the text column's width —
 * and served from cache while those hold (a card-body rebuild costs zero
 * layout reads). The one input no key can see — the block's TEXT reflowing in
 * place — is watched through the bus's keyed, uncounted
 * `onBlockContentChanged(blockUuid)` for exactly the blocks that hold a span
 * read here: a fire marks that block's entries dirty and schedules ONE
 * animation-frame re-read (parked during a layout gesture), and only a line
 * that actually MOVED notifies subscribers. Plain typing in a paragraph with
 * no span costs nothing; typing in one costs O(spans in that block) per frame,
 * never O(doc). `emitCount` stays flat (keyed channel).
 *
 * Subscribers: the margin marker memo (`Marginalia`) and the in-text card deck
 * (`useInTextPositions`) — so the icon and its card settle on the SAME clock
 * (`card-anchor-rows.ts`: "the card and its icon cannot sit on different
 * lines").
 */

import type { Editor } from "@tiptap/core";
import { getBus } from "@/lib/tiptap/doc-structure";
import { getOrCreateGeometry } from "./registry";
import { parkDuringLayoutGesture } from "@/lib/pane-resize";
import { LAYOUT_SITE_SPAN_LINE } from "@/lib/layout-gesture-probe";
import { isPaneElementVisible } from "@/lib/keep-alive/pane-visibility";
import type { AnchorNodeMetrics } from "@/lib/marginalia";

interface Entry {
  blockUuid: string;
  /** Key — a hit requires every field equal. */
  from: number;
  blockPos: number;
  top: number;
  height: number;
  lineHeight: number;
  width: number;
  line: number | null;
  /** The block's text changed since `line` was read. A dirty entry is a miss. */
  dirty: boolean;
}

export interface SpanLineService {
  /** The span's line (`null` ⇒ row 0), from cache when its inputs hold. */
  lineOf(anchorId: string, blockUuid: string, node: AnchorNodeMetrics): number | null;
  /** Drop every entry whose anchor is not in `keep` (the memo's live set). */
  sweep(keep: ReadonlySet<string>): void;
  /** Fires when a re-read found a span's words on a different line. */
  subscribe(cb: () => void): () => void;
  /** Bumps on every notify — a `useSyncExternalStore` snapshot. */
  version(): number;
  /** Probe: `coordsAtPos`-backed reads taken (tests). */
  readonly reads: number;
}

const services = new WeakMap<Editor, SpanLineService>();

export function getSpanLines(editor: Editor): SpanLineService {
  let s = services.get(editor);
  if (!s) {
    s = createSpanLineService(editor);
    services.set(editor, s);
  }
  return s;
}

function createSpanLineService(editor: Editor): SpanLineService {
  const entries = new Map<string, Entry>();
  /** blockUuid → { anchors in it, its keyed content subscription }. */
  const watched = new Map<string, { anchors: Set<string>; off: () => void }>();
  const subscribers = new Set<() => void>();
  let ver = 0;
  let reads = 0;
  let rafId = 0;
  let park: ReturnType<typeof parkDuringLayoutGesture> | null = null;

  const live = () => !!editor && !editor.isDestroyed;

  /** The two reads. `from` / `blockPos` come off the live snapshot. */
  const readLine = (from: number, blockPos: number, lineHeight: number): number | null => {
    const geo = getOrCreateGeometry(editor);
    reads += 2;
    const first = geo.coordsAtPosCached(blockPos + 1);
    const at = geo.coordsAtPosCached(from);
    if (!first || !at || !(lineHeight > 0)) return null;
    return Math.round((at.top - first.top) / lineHeight);
  };

  const textWidth = (): number => {
    const f = getOrCreateGeometry(editor).getViewportFrame();
    return f.editorRight - f.contentLeft;
  };

  const unwatchAnchor = (anchorId: string, blockUuid: string) => {
    const w = watched.get(blockUuid);
    if (!w) return;
    w.anchors.delete(anchorId);
    if (w.anchors.size === 0) {
      w.off();
      watched.delete(blockUuid);
    }
  };

  const drop = (anchorId: string) => {
    const e = entries.get(anchorId);
    if (!e) return;
    entries.delete(anchorId);
    unwatchAnchor(anchorId, e.blockUuid);
  };

  /** The deferred re-read of every dirty entry. Notifies only on a MOVE. */
  const reread = () => {
    rafId = 0;
    if (!live()) return;
    const dom = editor.view?.dom as HTMLElement | undefined;
    // A hidden pane measures zeros; leave entries dirty — the next memo run
    // (on re-show) treats them as misses and reads fresh.
    if (!dom || !isPaneElementVisible(dom)) return;
    const s = getBus(editor)?.structure;
    let moved = false;
    for (const [anchorId, e] of entries) {
      if (!e.dirty) continue;
      const a = s?.anchors.get(anchorId);
      const b = s?.blocks.get(e.blockUuid);
      if (!a || !b || a.from <= b.pos) {
        // The span left its block (or died): the marker memo re-runs on the
        // structural / rebuild path for that; just stop watching here.
        drop(anchorId);
        moved = true;
        continue;
      }
      const line = readLine(a.from, b.pos, e.lineHeight);
      e.from = a.from;
      e.blockPos = b.pos;
      e.dirty = false;
      if (line !== e.line) {
        e.line = line;
        moved = true;
      }
    }
    if (moved) {
      ver++;
      for (const cb of [...subscribers]) cb();
    }
  };

  const schedule = () => {
    if (rafId || !live()) return;
    rafId = requestAnimationFrame(reread);
  };

  const ensurePark = () => {
    if (!park) park = parkDuringLayoutGesture(schedule, LAYOUT_SITE_SPAN_LINE);
    return park;
  };

  const watch = (anchorId: string, blockUuid: string) => {
    let w = watched.get(blockUuid);
    if (!w) {
      const bus = getBus(editor);
      const off = bus
        ? bus.onBlockContentChanged(blockUuid, () => {
            // O(spans in this block) flag flips + one coalesced frame.
            const ww = watched.get(blockUuid);
            if (!ww) return;
            for (const id of ww.anchors) {
              const e = entries.get(id);
              if (e) e.dirty = true;
            }
            ensurePark().fire();
          })
        : () => {};
      w = { anchors: new Set(), off };
      watched.set(blockUuid, w);
    }
    w.anchors.add(anchorId);
  };

  return {
    lineOf(anchorId, blockUuid, node) {
      if (!live()) return null;
      const s = getBus(editor)?.structure;
      const a = s?.anchors.get(anchorId);
      const b = s?.blocks.get(blockUuid);
      if (!a || !b || a.from <= b.pos) return null;
      const width = textWidth();
      const e = entries.get(anchorId);
      if (
        e &&
        !e.dirty &&
        e.blockUuid === blockUuid &&
        e.from === a.from &&
        e.blockPos === b.pos &&
        e.top === node.top &&
        e.height === node.height &&
        e.lineHeight === node.lineHeight &&
        e.width === width
      ) {
        return e.line;
      }
      const line = readLine(a.from, b.pos, node.lineHeight);
      if (e && e.blockUuid !== blockUuid) unwatchAnchor(anchorId, e.blockUuid);
      entries.set(anchorId, {
        blockUuid,
        from: a.from,
        blockPos: b.pos,
        top: node.top,
        height: node.height,
        lineHeight: node.lineHeight,
        width,
        line,
        dirty: false,
      });
      watch(anchorId, blockUuid);
      return line;
    },
    sweep(keep) {
      for (const id of [...entries.keys()]) if (!keep.has(id)) drop(id);
    },
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
        if (subscribers.size > 0) return;
        // Last reader gone: release every keyed subscription and the frame.
        for (const id of [...entries.keys()]) drop(id);
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        park?.dispose();
        park = null;
      };
    },
    version: () => ver,
    get reads() {
      return reads;
    },
  };
}
