import { describe, it, expect } from "vitest";
import {
  EDITOR_INSERT_DRAG_TYPES,
  isEditorInsertDrag,
  MIME_CITATION,
  MIME_TEXT_INSERT,
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
      [MIME_CITATION, MIME_TEXT_INSERT, MIME_FOOTNOTE].sort(),
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

  it("recognizes panel text-insert and footnote-move drags", () => {
    expect(isEditorInsertDrag(dtWith(MIME_TEXT_INSERT))).toBe(true);
    expect(isEditorInsertDrag(dtWith(MIME_FOOTNOTE))).toBe(true);
  });

  it("ignores unrelated drags (plain text, anchor move, null)", () => {
    expect(isEditorInsertDrag(dtWith("text/plain"))).toBe(false);
    expect(isEditorInsertDrag(dtWith(MIME_MARGINALIA_MOVE))).toBe(false);
    expect(isEditorInsertDrag(null)).toBe(false);
  });
});
