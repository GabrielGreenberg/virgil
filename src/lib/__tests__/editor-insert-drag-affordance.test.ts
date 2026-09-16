import { describe, it, expect } from "vitest";
import {
  EDITOR_INSERT_DRAG_TYPES,
  isEditorInsertDrag,
  MIME_CITATION,
  MIME_FOOTNOTE,
  MIME_MARGINALIA_MOVE,
} from "@/lib/marginalia";

/**
 * Contract for the bib/citation drag drop-affordance fix (task 2026-07-03-004).
 *
 * The bug: dragging a bib card over the editor showed the browser's native
 * green-plus `copy` cursor because `Editor.tsx` had no `dragover` handler
 * setting `dropEffect`. The fix routes the editor's inline-insert drags through
 * a single canonical set (`EDITOR_INSERT_DRAG_TYPES`) that the `dragover`
 * handler uses to give them a clean `"move"` affordance.
 *
 * Membership shrank in task 590: `MIME_TEXT_INSERT` was deleted outright (no
 * `setData` for it survived `ec382103`), leaving the citation drag and the
 * deliberately-armed footnote-move drop. Which MIMEs still have a producer is
 * now stated as data in `DRAG_MIME_PRODUCTION` and checked by
 * [drag-mime-production.test.ts](drag-mime-production.test.ts).
 *
 * These tests lock the SSOT membership + the recognizer. The affordance itself
 * (`dropEffect = "move"`) is applied in `Editor.tsx`'s `handleDOMEvents.dragover`
 * and is owed a real-FSA/preview eyeball — a `dropEffect` write can't be
 * exercised without a live drag in a browser.
 */

/** Minimal DataTransfer stub — only `types` is read by `isEditorInsertDrag`. */
function dtWith(...types: string[]): DataTransfer {
  return { types } as unknown as DataTransfer;
}

describe("EDITOR_INSERT_DRAG_TYPES (editor inline-insert drag SSOT)", () => {
  it("contains exactly the MIMEs the editor's handleDrop accepts", () => {
    expect([...EDITOR_INSERT_DRAG_TYPES].sort()).toEqual(
      [MIME_CITATION, MIME_FOOTNOTE].sort(),
    );
  });

  it("does NOT include the paragraph-level anchor-move MIME", () => {
    // Anchor moves flow through the drop-mode controller, not handleDrop; they
    // must not get the inline-insert affordance.
    expect(EDITOR_INSERT_DRAG_TYPES).not.toContain(MIME_MARGINALIA_MOVE);
  });
});

describe("isEditorInsertDrag", () => {
  it("recognizes a bib/citation drag (the reported case)", () => {
    expect(isEditorInsertDrag(dtWith(MIME_CITATION))).toBe(true);
    // real citation drags also carry text/plain fallback
    expect(isEditorInsertDrag(dtWith("text/plain", MIME_CITATION))).toBe(true);
  });

  it("recognizes the footnote-move drag", () => {
    expect(isEditorInsertDrag(dtWith(MIME_FOOTNOTE))).toBe(true);
  });

  it("does not recognize the deleted text-insert MIME (task 590)", () => {
    // `MIME_TEXT_INSERT` had no producer from `ec382103` onward; its two
    // readers and the constant itself are gone. A resurrected string must not
    // quietly regain the inline-insert affordance without a registry row.
    expect(isEditorInsertDrag(dtWith("application/x-virgil-text-insert")))
      .toBe(false);
  });

  it("ignores unrelated drags (plain text, anchor move, null)", () => {
    expect(isEditorInsertDrag(dtWith("text/plain"))).toBe(false);
    expect(isEditorInsertDrag(dtWith(MIME_MARGINALIA_MOVE))).toBe(false);
    expect(isEditorInsertDrag(null)).toBe(false);
  });
});
