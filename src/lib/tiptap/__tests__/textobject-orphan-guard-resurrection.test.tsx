// @vitest-environment jsdom
//
// Regression guard for the data-loss bug behind the orphan-sweep: when an
// ANCHORED block is incidentally removed, MarginaliaAnchorGuard resurrects it
// (re-inserts a same-uuid placeholder in the same dispatch). TextObjectOrphanGuard
// used to fire `virgil-textobject-orphaned` for that uuid anyway (it read
// `diff.removedBlocks` before the resurrection ran), and the Mode-A sweep
// (useTodos / useArchive) then PERMANENTLY stripped a still-valid link. The fix
// re-checks liveness against the SETTLED doc in the deferred dispatch, so a
// resurrected uuid emits no event; a genuinely-removed uuid still does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

function mainCtx(anchored: Set<string>, docId: string | null = null): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: docId },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

function mountThreeDoc(anchored: Set<string>, docId: string | null = null): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(anchored, docId)),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "The first paragraph." }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: "The second paragraph." }] },
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: "The third paragraph." }] },
      ],
    },
  });
}

function deleteParagraphByUuid(editor: Editor, uuid: string) {
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.uuid === uuid) {
      from = pos;
      to = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  if (from < 0) throw new Error(`uuid ${uuid} not found`);
  editor.view.dispatch(editor.state.tr.delete(from, to));
}

function liveUuids(editor: Editor): Set<string> {
  const s = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.attrs?.uuid) s.add(n.attrs.uuid as string);
    return true;
  });
  return s;
}

const flushMacrotask = () => new Promise((r) => setTimeout(r, 5));

describe("TextObjectOrphanGuard — resurrection awareness", () => {
  let received: string[];
  let handler: (e: Event) => void;
  beforeEach(() => {
    received = [];
    handler = (e: Event) => {
      const uuid = (e as CustomEvent).detail?.uuid;
      if (typeof uuid === "string") received.push(uuid);
    };
    window.addEventListener("virgil-textobject-orphaned", handler);
  });
  afterEach(() => {
    window.removeEventListener("virgil-textobject-orphaned", handler);
  });

  it("does NOT fire the orphan event for an ANCHORED block that MarginaliaAnchorGuard resurrects", async () => {
    const editor = mountThreeDoc(new Set(["P2"])); // P2 is margin-anchored
    deleteParagraphByUuid(editor, "P2");
    // MarginaliaAnchorGuard re-inserts a same-uuid placeholder in the same dispatch.
    expect(liveUuids(editor).has("P2")).toBe(true);
    await flushMacrotask();
    // The deferred orphan dispatch must skip the resurrected uuid → no strip.
    expect(received).not.toContain("P2");
    editor.destroy();
  });

  it("STILL fires the orphan event for a genuinely-removed (non-resurrected) block", async () => {
    const editor = mountThreeDoc(new Set(["P2"])); // P3 is NOT anchored
    deleteParagraphByUuid(editor, "P3");
    expect(liveUuids(editor).has("P3")).toBe(false);
    await flushMacrotask();
    expect(received).toContain("P3");
    editor.destroy();
  });
});

// Task 598: both orphan events carry the docId of the editor whose transaction
// removed the anchor, so only that document's card hooks answer.
describe("orphan guards stamp the ORIGINATING docId", () => {
  it("a removed block's event carries the editor's docId", async () => {
    const got: unknown[] = [];
    const h = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener("virgil-textobject-orphaned", h);
    const editor = mountThreeDoc(new Set(), "doc-origin");
    deleteParagraphByUuid(editor, "P3");
    await flushMacrotask();
    window.removeEventListener("virgil-textobject-orphaned", h);
    expect(got).toContainEqual(
      expect.objectContaining({ docId: "doc-origin", uuid: "P3" }),
    );
    editor.destroy();
  });

  it("a removed linkedAnchor mark's event carries the editor's docId", async () => {
    const got: unknown[] = [];
    const h = (e: Event) => got.push((e as CustomEvent).detail);
    window.addEventListener("virgil-anchor-orphaned", h);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      editable: true,
      extensions: buildEditorExtensions(mainCtx(new Set(), "doc-origin")),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { uuid: "P1" },
            content: [
              { type: "text", text: "lead " },
              {
                type: "text",
                text: "marked",
                marks: [{ type: "linkedAnchor", attrs: { anchorId: "anc-1", kind: "note" } }],
              },
              { type: "text", text: " tail" },
            ],
          },
        ],
      },
    });
    // Delete the whole marked run (positions: 1 + "lead ".length).
    editor.view.dispatch(editor.state.tr.delete(6, 12));
    await flushMacrotask();
    window.removeEventListener("virgil-anchor-orphaned", h);
    expect(got).toContainEqual(
      expect.objectContaining({ docId: "doc-origin", anchorId: "anc-1" }),
    );
    editor.destroy();
  });
});
