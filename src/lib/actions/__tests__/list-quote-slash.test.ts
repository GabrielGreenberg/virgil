// @vitest-environment jsdom
//
// Bug sweep #6 — the list/quote slash commands (\list \itemize \enumerate
// \quote \quotation) end-to-end.
//
// These 5 structural WRAPPER toggles route through the editor-actions BRIDGE
// (not the view-only path) because they run `editor.chain().toggleBulletList()`
// / `toggleOrderedList()` / `toggleBlockquote()`, which the synthesized view-only
// stub lacks. This drives the REAL `commands.ts` actions + a REAL published
// bridge handle (mirroring EditorPane) against the REAL schema, so the join is
// exercised end-to-end.
//
// WHAT IS PROVEN
//   1. each command wraps a paragraph into the right structural node;
//   2. the uniform collab read-only gate (`view.editable === false`) no-ops;
//   3. on a non-listable block (a heading) the wrapper no-ops — NO data loss.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — same
// gotcha as the sibling action tests.)
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import { setEditorActionsHandle } from "@/lib/actions/editor-actions-bridge";
import { paragraphUuidAt } from "@/links/links";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** Mount a real main editor with one paragraph (uuid "para-A") holding `text`. */
function mountEditor(text: string, editable = true): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: text ? [{ type: "text", text }] : [],
        },
      ],
    },
  });
  return editor;
}

function hasNode(editor: Editor, name: string): boolean {
  let found = false;
  editor.state.doc.descendants((n) => {
    if (n.type.name === name) found = true;
    return true;
  });
  return found;
}

/** Publish a bridge handle EXACTLY like EditorPane: build the ActionContext from
 *  the LIVE editor (which has `.chain()`), thread `canEdit`, invoke spec.run. */
function publishHandle(editor: Editor): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return;
      if (!editor.isEditable) return; // mirrors the bridge's collab gate
      const pos = editor.state.selection.head;
      const ref: CursorRef = {
        kind: "cursor",
        pos,
        paragraphId: paragraphUuidAt(editor.state.doc, pos) ?? "",
      };
      const ctx: ActionContext = {
        editor,
        view: editor.view,
        ref,
        surface: seed.surface,
        canEdit: editor.isEditable,
        payload: seed.payload,
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Publish a PURE-SPY bridge handle: `runAction` records the (id, seed) it was
 *  called with and does nothing else. Lets a test assert whether a slash command
 *  DISPATCHES to the bridge at all — the commands.ts-level early collab gate —
 *  independent of what the registry `run()` would do (task 297). Returns the spy. */
function publishSpyHandle(): ReturnType<typeof vi.fn> {
  const runAction = vi.fn();
  setEditorActionsHandle({ runAction } as unknown as EditorActionsHandle);
  return runAction;
}

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("list/quote slash commands (via the bridge)", () => {
  const CASES: Array<{ cmd: string; node: string }> = [
    { cmd: "list", node: "bulletList" },
    { cmd: "itemize", node: "bulletList" },
    { cmd: "enumerate", node: "orderedList" },
    { cmd: "quote", node: "blockquote" },
    { cmd: "quotation", node: "blockquote" },
  ];

  for (const { cmd, node } of CASES) {
    it(`\\${cmd} wraps the paragraph into a ${node}`, () => {
      const editor = mountEditor("hello");
      publishHandle(editor);
      expect(hasNode(editor, node)).toBe(false);

      COMMAND_MAP.get(cmd)!.action(editor.view, `\\${cmd}`);

      expect(hasNode(editor, node)).toBe(true);
      // the prose survives the wrap
      expect(editor.state.doc.textContent).toContain("hello");
    });
  }

  it("all 5 commands are registered in COMMAND_MAP", () => {
    for (const { cmd } of CASES) {
      expect(COMMAND_MAP.has(cmd)).toBe(true);
    }
  });

  it("no-ops when the editor is collab read-only (view.editable === false)", () => {
    const editor = mountEditor("hello", /* editable */ false);
    publishHandle(editor);
    COMMAND_MAP.get("enumerate")!.action(editor.view, "\\enumerate");
    expect(hasNode(editor, "orderedList")).toBe(false);
  });

  it("no-ops on a non-listable block (heading) — no data loss", () => {
    const editor = mountEditor("a heading");
    publishHandle(editor);
    // Convert the paragraph to a heading via the real \section command, then try
    // to enumerate it: the wrapper's selectionIsListable guard must refuse.
    COMMAND_MAP.get("section")!.action(editor.view, "\\section");
    expect(hasNode(editor, "heading")).toBe(true);

    COMMAND_MAP.get("enumerate")!.action(editor.view, "\\enumerate");
    expect(hasNode(editor, "orderedList")).toBe(false);
    expect(hasNode(editor, "heading")).toBe(true); // heading identity intact
    expect(editor.state.doc.textContent).toContain("a heading");
  });
});

// Task 297 — `\ref` and `\ex` were the only two side-effecting slash commands
// missing the explicit CHIP 7b collab read-only gate; they now route through
// `runBridgeAction` (the sibling of `runViewOnlyAction`), which refuses on a
// non-editable view BEFORE dispatching to the bridge. These pin the now-uniform
// bridge-path refusal so the gate can't silently re-drop. We assert the stronger
// property — that `runAction` itself never fires on a read-only view — via a
// pure-spy handle (chip8's ref read-only test only proves refRun's own downstream
// gate, not the early commands.ts refusal this task added). Each refusal is paired
// with a POSITIVE control so it isn't vacuous.
describe("\\ref / \\ex uniform collab read-only gate (task 297)", () => {
  it("editable view: \\ref DOES reach the bridge (positive control)", () => {
    const editor = mountEditor("hello");
    const runAction = publishSpyHandle();
    COMMAND_MAP.get("ref")!.action(editor.view, "\\ref");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith("ref", { surface: "slash" });
  });

  it("editable view: \\ex DOES reach the bridge (positive control)", () => {
    const editor = mountEditor("hello");
    const runAction = publishSpyHandle();
    COMMAND_MAP.get("ex")!.action(editor.view, "\\ex");
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(runAction).toHaveBeenCalledWith("example", { surface: "slash" });
  });

  it("read-only view: \\ref does NOT reach the bridge (no runAction, no doc mutation)", () => {
    const editor = mountEditor("hello", /* editable */ false);
    const runAction = publishSpyHandle();
    const before = editor.state.doc.toJSON();
    COMMAND_MAP.get("ref")!.action(editor.view, "\\ref");
    expect(runAction).not.toHaveBeenCalled();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it("read-only view: \\ex does NOT reach the bridge (no runAction, no doc mutation)", () => {
    const editor = mountEditor("hello", /* editable */ false);
    const runAction = publishSpyHandle();
    const before = editor.state.doc.toJSON();
    COMMAND_MAP.get("ex")!.action(editor.view, "\\ex");
    expect(runAction).not.toHaveBeenCalled();
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});
