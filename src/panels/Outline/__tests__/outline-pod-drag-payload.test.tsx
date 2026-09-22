// @vitest-environment jsdom
//
// Task 708 — an Outline pod drag must not carry a payload any text surface
// can insert.
//
// The Edit-mode pod drag used to write the pod id (a block uuid, or
// `heading-N`) to `text/plain`. The Outline never read it — its own drop reads
// `draggingId` from React state — but released over the manuscript, the
// editor's `handleDrop` fell through to ProseMirror's default drop, which typed
// the id into the user's paragraph. Two halves, pinned here:
//
//   1. PRODUCER — the pod drag writes the private `MIME_OUTLINE_POD` and NO
//      `text/plain` (so no text-accepting surface — the editor, a card body, a
//      native textarea — has anything to insert);
//   2. CONSUMER — the editor refuses the type BY NAME: it is in
//      `EDITOR_REFUSED_DRAG_TYPES`, disjoint from the inline-insert set, and
//      `Editor.tsx`'s `dragover` + `handleDrop` both lead with the refusal
//      (handleDrop ahead of every other branch, so no later `return false` can
//      hand it to ProseMirror). A real drag over the editor is owed a preview
//      eyeball — jsdom cannot run ProseMirror's hit-tested drop.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import OutlinePanel from "../OutlinePanel";
import {
  EDITOR_INSERT_DRAG_TYPES,
  EDITOR_REFUSED_DRAG_TYPES,
  MIME_OUTLINE_POD,
  isEditorInsertDrag,
  isEditorRefusedDrag,
} from "@/lib/marginalia";
import { codeOnly } from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "aaaa" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "bbbb" }, content: [{ type: "text", text: "Body." }] },
    { type: "heading", attrs: { level: 2, uuid: "cccc" }, content: [{ type: "text", text: "Two" }] },
  ],
};

/** A recording DataTransfer — `types` mirrors what was actually set. */
function recordingDataTransfer() {
  const store: Record<string, string> = {};
  return {
    store,
    dt: {
      effectAllowed: "all",
      dropEffect: "none",
      get types() { return Object.keys(store); },
      setData(type: string, value: string) { store[type] = value; },
      getData(type: string) { return store[type] ?? ""; },
      setDragImage() {},
    },
  };
}

describe("Outline pod drag payload (task 708)", () => {
  it("writes the private outline MIME and no text/plain", () => {
    const { container } = render(
      <OutlinePanel
        content={CONTENT}
        onScrollTo={() => {}}
        onReorderBlocks={() => {}}
        onRenameHeading={() => {}}
        onRenameParTitle={() => {}}
      />,
    );
    const editToggle = container.querySelector('[data-hint="Edit mode"]') as HTMLElement;
    expect(editToggle).toBeTruthy();
    fireEvent.click(editToggle);

    const pods = container.querySelectorAll<HTMLElement>('[draggable="true"]');
    // Non-empty, or Edit mode never mounted and the assertions below are vacuous.
    expect(pods.length).toBeGreaterThan(0);

    const { store, dt } = recordingDataTransfer();
    fireEvent.dragStart(pods[0], { dataTransfer: dt });

    expect(Object.keys(store)).toContain(MIME_OUTLINE_POD);
    expect(store[MIME_OUTLINE_POD]).toBe("aaaa");
    expect(Object.keys(store)).not.toContain("text/plain");
    expect(Object.keys(store)).not.toContain("text/html");
    // …and the editor recognizes exactly this drag as one it refuses.
    expect(isEditorRefusedDrag(dt as unknown as DataTransfer)).toBe(true);
    expect(isEditorInsertDrag(dt as unknown as DataTransfer)).toBe(false);
  });
});

describe("EDITOR_REFUSED_DRAG_TYPES (the editor's refusal set)", () => {
  it("holds the outline pod type and is disjoint from the insert set", () => {
    expect(EDITOR_REFUSED_DRAG_TYPES).toContain(MIME_OUTLINE_POD);
    for (const t of EDITOR_REFUSED_DRAG_TYPES) {
      expect(EDITOR_INSERT_DRAG_TYPES).not.toContain(t);
    }
  });

  it("recognizer ignores unrelated drags and null", () => {
    const dtWith = (...types: string[]) => ({ types }) as unknown as DataTransfer;
    expect(isEditorRefusedDrag(dtWith("text/plain"))).toBe(false);
    expect(isEditorRefusedDrag(null)).toBe(false);
  });

  it("Editor.tsx leads both dragover and handleDrop with the refusal", () => {
    const src = codeOnly(
      readFileSync(path.join(process.cwd(), "src/components/Editor.tsx"), "utf8"),
    );
    const firstStatementAfter = (marker: string) => {
      const at = src.indexOf(marker);
      expect(at, `${marker} not found`).toBeGreaterThan(-1);
      const body = src.slice(src.indexOf("{", at) + 1).trimStart();
      return body.slice(0, 80);
    };
    expect(firstStatementAfter("dragover(_view, event)")).toMatch(
      /^if \(isEditorRefusedDrag\(event\.dataTransfer\)\)/,
    );
    expect(firstStatementAfter("handleDrop(view, event)")).toMatch(
      /^if \(isEditorRefusedDrag\(event\.dataTransfer\)\)/,
    );
    // The handleDrop refusal CONSUMES (true), never falls through (false).
    const hd = src.slice(src.indexOf("handleDrop(view, event)"));
    const guard = hd.slice(hd.indexOf("isEditorRefusedDrag"), hd.indexOf("}", hd.indexOf("isEditorRefusedDrag")));
    expect(guard).toMatch(/return true;/);
    expect(guard).not.toMatch(/return false;/);
  });
});
