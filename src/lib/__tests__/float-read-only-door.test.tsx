// @vitest-environment jsdom
//
// Task 1546 — a float on a READ-ONLY paper neither accepts typing nor claims
// a write landed.
//
// THE BUG: main keeps `view.editable` true (the Reader's grab handle lifts text
// out) and enforces read-only only in `readOnlyEnforcer.filterTransaction`,
// which drops a doc change SILENTLY. Five float bodies mounted
// `editable: true`, and `landFloatWrite` returned `landed` for any dispatch —
// so typing into a popped-out list on a read-only paper vanished with no
// banner, and the next re-read wiped it.
//
// THE FIX, both halves:
//  1. `useFloatEditable` (main's live `data-editable` ∧ the body's static
//     reason) is what every float mounts with, and `useFloatMainSync` keeps the
//     live editor at it across a mid-session flip;
//  2. the write doors MEASURE the dispatch (`dispatchLanded`) — a dropped write
//     is `refused`, which raises `WriteRefusedBanner`.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { useFloatEditable, useFloatMainSync } from "@/lib/float-sync";
import { landFloatWrite, MAIN_REFUSED_WRITE_REASON } from "@/lib/float-write-back";
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { writeSourcePodAttrs } from "@/lib/tiptap/source-pod-write";

const editors: Editor[] = [];

function mount(
  content: JSONContent,
  surface: "main" | "float",
  editableRef: { current: boolean } = { current: true },
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx: EditorExtensionsCtx = {
    surface,
    editableRef: surface === "main" ? editableRef : undefined,
    editable: true,
    cardContext: surface === "float",
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const P = "p-1";
const doc = (t: string): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph", attrs: { uuid: P }, content: [{ type: "text", text: t }] }],
});

/** Main's declarative read-only signal, as `Editor.tsx` publishes it. */
function setMainReadOnly(main: Editor, ref: { current: boolean }, readOnly: boolean) {
  ref.current = !readOnly;
  (main.view.dom as HTMLElement).setAttribute("data-editable", readOnly ? "false" : "true");
}

function writeParagraph(main: Editor, t: string) {
  return landFloatWrite(main as unknown as ReactEditor, `paragraph:${P}`, (ed) => {
    const src = findSourceNodeByUuid(ed.state.doc, P, "paragraph");
    if (!src) return null;
    const node = ed.state.schema.nodeFromJSON(doc(t).content![0]);
    return { from: src.start, to: src.end, content: node };
  });
}

describe("landFloatWrite measures what main admitted (task 1546)", () => {
  it("lands on an editable paper", () => {
    const main = mount(doc("old"), "main");
    expect(writeParagraph(main, "new").status).toBe("landed");
    expect(main.state.doc.textContent).toBe("new");
  });

  it("reports `refused` — not `landed` — when the read-only enforcer drops it", () => {
    const ref = { current: true };
    const main = mount(doc("old"), "main", ref);
    setMainReadOnly(main, ref, true);
    const before = main.state.doc;
    const outcome = writeParagraph(main, "typed on a read-only paper");
    expect(outcome).toEqual({ status: "refused", reason: MAIN_REFUSED_WRITE_REASON });
    expect(main.state.doc).toBe(before);
  });

  it("the source-pod door reports a dropped write the same way", () => {
    const ref = { current: true };
    const main = mount(
      {
        type: "doc",
        content: [{ type: "texBlock", attrs: { uuid: "pod-1", code: "A" } }],
      },
      "main",
      ref,
    );
    const src = findSourceNodeByUuid(main.state.doc, "pod-1", "texBlock");
    expect(src).not.toBeNull();
    const origin = { kind: "float" as const, floatId: "texBlock:pod-1" };
    setMainReadOnly(main, ref, true);
    expect(writeSourcePodAttrs(main.view, src!.start, src!.node, { code: "AB" }, origin)).toBe(
      "refused",
    );
    setMainReadOnly(main, ref, false);
    expect(writeSourcePodAttrs(main.view, src!.start, src!.node, { code: "AB" }, origin)).toBe(
      "landed",
    );
  });
});

describe("a float follows main's editability (task 1546)", () => {
  function mountFloat(main: Editor, staticAllow = true) {
    const float = mount(doc("old"), "float");
    const view = renderHook(() => {
      const editable = useFloatEditable(main as unknown as ReactEditor, staticAllow);
      useFloatMainSync({
        mainEditor: main as unknown as ReactEditor,
        floatEditor: float as unknown as ReactEditor,
        editable,
        floatId: `paragraph:${P}`,
        readSource: (d) => {
          const src = findSourceNodeByUuid(d, P, "paragraph");
          return src
            ? { doc: { type: "doc", content: [src.node.toJSON()] }, missing: false }
            : { doc: doc(""), missing: true };
        },
      });
      return editable;
    });
    return { float, view };
  }

  it("is read-only while main is, and follows a mid-session flip both ways", async () => {
    const ref = { current: true };
    const main = mount(doc("old"), "main", ref);
    setMainReadOnly(main, ref, true);
    const { float, view } = mountFloat(main);
    expect(view.result.current).toBe(false);
    expect(float.isEditable).toBe(false);

    // The pen comes back (a MutationObserver delivery — flush microtasks).
    await act(async () => {
      setMainReadOnly(main, ref, false);
      await Promise.resolve();
    });
    expect(view.result.current).toBe(true);
    expect(float.isEditable).toBe(true);

    await act(async () => {
      setMainReadOnly(main, ref, true);
      await Promise.resolve();
    });
    expect(float.isEditable).toBe(false);
  });

  it("a body's static reason holds it read-only on an editable paper", () => {
    const main = mount(doc("old"), "main");
    (main.view.dom as HTMLElement).setAttribute("data-editable", "true");
    const { float } = mountFloat(main, false);
    expect(float.isEditable).toBe(false);
  });
});
