/**
 * The paragraph READING LINE — "where, on screen, is the paragraph the user is
 * AT?" (task 857). One answer, read by both halves of paragraph Back/Forward:
 *
 *   - the RECORDER (`computeActiveBlockId` / `legacyActiveBlockWalk`, polled by
 *     EditorLayout's and the Reader's history hooks) asks which block's top is
 *     the first one at or below the line;
 *   - the LANDING (`scrollBlockToReadingLine`, behind the Editor handle's
 *     `scrollToParagraphId`) puts the target block's top ON the line.
 *
 * Because they stand on the same number, a Back/Forward landing is a FIXED
 * POINT of the recorder by construction: the next poll reads back the block it
 * just landed on, so it never pushes a neighbour and truncates Forward.
 *
 * The bug this retires: the recorder read the RAW scroll-container top (under
 * ~78px of sticky chrome — in-card header + reading mask) while the landing
 * used a hand `- 100`. A heading or short paragraph above the target sat
 * between the two lines, the recorder read IT, and Forward history died ~3s
 * after every Back. The raw-top probe also landed on the sticky expand-all
 * hover band (outside `view.dom`), knocking every top-edge `posAtCoords` off
 * the browser's fast hit-test path; the line sits below the chrome, so it
 * probes prose.
 *
 * The inset is `chromeTopInset` — the SAME expression ProseMirror's
 * intentional-scroll margin reads (`chrome-scroll-margin.ts`), read live.
 *
 * Residual (stated, not claimed away): a target near either END of the
 * document cannot be scrolled to the line (the landing clamps at 0 / max
 * scroll), so there the fixed point is not reachable.
 */

import type { EditorView } from "@tiptap/pm/view";
import { chromeTopInset } from "@/lib/tiptap/chrome-scroll-margin";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";

/** Tolerance ABOVE the line that still counts as "on it": a landing's
 *  `scrollTop` write rounds to device pixels, so a block landed exactly on the
 *  line can read back a fraction of a pixel above it. Small enough that no
 *  real block (a heading, a one-line paragraph + its gap) fits inside it. */
export const READING_LINE_SLACK_PX = 4;

/** Client-Y of the reading line for the scroll viewport whose top edge is at
 *  client-Y `scrollTopY`. `editorDom` supplies the cascaded chrome vars. */
export function readingLineY(
  editorDom: Element | null | undefined,
  scrollTopY: number,
): number {
  return scrollTopY + chromeTopInset(editorDom);
}

/** The recorder's threshold: a block whose top is at or below this client-Y
 *  is "on or below the reading line". */
export function readingThresholdY(
  editorDom: Element | null | undefined,
  scrollTopY: number,
): number {
  return readingLineY(editorDom, scrollTopY) - READING_LINE_SLACK_PX;
}

/**
 * Scroll the editor's scroll container so a block whose top is currently at
 * client-Y `blockTopY` lands ON the reading line. Returns false when there is
 * no scroll container to move.
 */
export function scrollBlockToReadingLine(
  view: EditorView,
  blockTopY: number,
): boolean {
  const scrollEl = findEditorScrollFor(view.dom) as HTMLElement | null;
  if (!scrollEl) return false;
  const scrollRect = scrollEl.getBoundingClientRect();
  const lineY = readingLineY(view.dom, scrollRect.top);
  scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + (blockTopY - lineY));
  return true;
}
