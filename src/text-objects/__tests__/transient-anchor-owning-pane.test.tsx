// @vitest-environment jsdom
/**
 * TASK 1000 — closing a selection-grab popout strips its transient anchor in
 * the doc that OWNS it, whichever pane is in front.
 *
 * `poppedOutCards` is window-global; the anchor lives in exactly one doc. The
 * cleanup used to be mounted ONCE by `EditorLayout` with the ACTIVE editor:
 * grab in doc A, switch to doc B (A stays warm under keep-alive), close the
 * popout → `removeTransientAnchor(editorB, id)` (a no-op), the id forgotten,
 * and A's mark serialized as `\vlid…\vlidend` into A's .tex. Now every
 * `EditorPane` watches with ITS editor. These legs drive two REAL editors with
 * the REAL strip, one hook per pane, and pin the mount site structurally.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { buildEditorExtensions } from "@/lib/editor-extensions";
import { resolveTextRangeByAnchorId } from "@/links/links";
import { useTransientAnchorCleanup } from "../useTransientAnchorCleanup";
import { textObjectPopoutKey } from "../text-object-registry";

const editors: Editor[] = [];
afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

function mountDoc(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: { current: true },
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set() },
      host: null,
    }),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text }] },
      ],
    },
  });
  editors.push(ed);
  return ed;
}

/** Stamp the plain selection grab's handle: `kind:"transient"`, no card. */
function stampTransient(ed: Editor, anchorId: string) {
  const mark = ed.state.schema.marks.linkedAnchor.create({ anchorId, kind: "transient" });
  ed.view.dispatch(ed.state.tr.addMark(1, 6, mark));
}

/** One hook per pane, each bound to its own editor, sharing the global list. */
function mountPanes(panes: Editor[], initial: readonly string[]) {
  return panes.map((ed) =>
    renderHook(
      ({ keys }: { keys: readonly string[] }) =>
        useTransientAnchorCleanup(ed as unknown as ReactEditor, keys),
      { initialProps: { keys: initial } },
    ),
  );
}

describe("transient anchor stripped by its owning pane (task 1000)", () => {
  it("closing while ANOTHER pane is active strips the owning doc's mark", () => {
    const docA = mountDoc("alpha beta");
    const docB = mountDoc("gamma delta");
    stampTransient(docA, "r1");
    const key = textObjectPopoutKey({ kind: "linkedRange", id: "r1" });
    // B is mounted (and would be the active one); A is warm keep-alive.
    const hooks = mountPanes([docB, docA], [key]);
    expect(resolveTextRangeByAnchorId(docA, "r1")).not.toBeNull();

    for (const h of hooks) h.rerender({ keys: [] });

    expect(resolveTextRangeByAnchorId(docA, "r1")).toBeNull();
    expect(docB.getText()).toBe("gamma delta");
  });

  it("a pane whose doc lacks the id is left untouched", () => {
    const docA = mountDoc("alpha beta");
    const docB = mountDoc("gamma delta");
    stampTransient(docA, "r1");
    stampTransient(docB, "r2");
    const k1 = textObjectPopoutKey({ kind: "linkedRange", id: "r1" });
    const k2 = textObjectPopoutKey({ kind: "linkedRange", id: "r2" });
    const hooks = mountPanes([docA, docB], [k1, k2]);

    for (const h of hooks) h.rerender({ keys: [k2] });

    expect(resolveTextRangeByAnchorId(docA, "r1")).toBeNull();
    expect(resolveTextRangeByAnchorId(docB, "r2")).not.toBeNull();
  });
});

describe("mount site (task 1000)", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("each EditorPane mounts the cleanup with its OWN editor", () => {
    expect(src("src/components/EditorPane.tsx")).toMatch(
      /useTransientAnchorCleanup\(\s*editor,/,
    );
  });

  it("the layout no longer mounts it against the active editor", () => {
    expect(src("src/components/EditorLayout.tsx")).not.toMatch(
      /useTransientAnchorCleanup/,
    );
  });
});
