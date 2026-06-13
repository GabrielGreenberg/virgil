// @vitest-environment jsdom
//
// Backlog #40 PART 1 — the example-ITEM float read-only gate. Mirrors the
// example-block-body read-only test in ExampleCardEditor.test.tsx (#39 nit 2),
// one wrap level deeper. The item float (`ExampleItemBody`) embeds the same
// `buildEditorExtensions({surface:"float"})` editor as the block float; on a
// read-only / partner-claimed doc it must mount that embedded editor
// NON-editable, so a user can't type phantom text whose write-back the main
// readOnlyEnforcer would silently reject at dispatch. The fix reads
// `useMainEditable(mainEditor)` and gates `editable` + the `setEditable`
// reconciliation effect on it, exactly as example-block-body.tsx does.
//
// The extension barrel transitively imports `@/lib/storage` (the known barrel/
// storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = {};
  for (const name of STORAGE_FNS) mod[name] = name === "isDevStorage" ? false : vi.fn();
  return mod;
});

// jsdom has no ResizeObserver; some chrome paths measure with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { ExampleItemBody } from "@/text-objects/floats/example-item-body";
import type { EditorHandle } from "@/components/Editor";

afterEach(cleanup);

const ITEM_UUID = "ititem01";

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

/** A single multi-kind example block holding the target item. */
function itemDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "exblk001", number: 3, kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: ITEM_UUID, subLabel: "a" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Item body." }] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Build a main editor mirroring the read-only signal the live VirgilEditor
 *  uses: the PM view stays editable, `data-editable` is the declarative flag
 *  the float's `useMainEditable` reads. */
function buildMainWith(editable: boolean): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: itemDoc(),
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", String(editable));
  return ed;
}

/** Minimal EditorHandle stub — only the methods the float body reaches for. */
function handleFor(editor: TiptapEditor): EditorHandle {
  return {
    getEditor: () => editor,
    isLabelTaken: () => false,
    onConfirmLabelRename: async () => false,
    onConfirmHeadingDelete: async () => true,
  } as unknown as EditorHandle;
}

// ── Fiber harness (same shape as ExampleCardEditor.test.tsx) ────────────────
// Reach the live embedded TipTap Editor the float body mounted via `useEditor`
// (kept in React state, so climb the fiber tree from the PM root and deep-scan
// for an object that quacks like a TipTap editor).
function looksLikeEditor(v: unknown): v is TiptapEditor {
  return (
    !!v &&
    typeof (v as TiptapEditor).getJSON === "function" &&
    typeof (v as TiptapEditor).setEditable === "function" &&
    !!(v as TiptapEditor).view
  );
}
function deepScan(obj: unknown, seen: Set<unknown>, depth: number): TiptapEditor | null {
  if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 4) return null;
  seen.add(obj);
  if (looksLikeEditor(obj)) return obj;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = deepScan(v, seen, depth + 1);
    if (r) return r;
  }
  return null;
}
function embeddedEditorFor(rootEl: Element): TiptapEditor | null {
  let cur: Element | null = rootEl;
  while (cur) {
    const key = Object.keys(cur).find((k) => k.startsWith("__reactFiber$"));
    if (key) {
      let f = (cur as unknown as Record<string, { memoizedProps?: unknown; memoizedState?: unknown; return?: unknown }>)[key];
      let depth = 0;
      while (f && depth < 40) {
        const hit =
          deepScan(f.memoizedProps, new Set(), 0) ??
          deepScan(f.memoizedState, new Set(), 0);
        if (hit) return hit;
        f = f.return as typeof f;
        depth++;
      }
    }
    cur = cur.parentElement;
  }
  return null;
}
function floatEditor(container: HTMLElement): TiptapEditor | null {
  const pm = container.querySelector(".par-float-body .ProseMirror");
  if (!pm) return null;
  return embeddedEditorFor(pm.parentElement ?? pm);
}

function renderItemFloat(editor: TiptapEditor) {
  const handle = handleFor(editor);
  return render(
    <ExampleItemBody
      cardKey={`textobject:exampleItem:${ITEM_UUID}`}
      id={ITEM_UUID}
      editorRef={{ current: handle }}
      cardContext
      setHeaderLabel={() => {}}
    />,
  );
}

describe("ExampleItemBody read-only typeability (#40 PART 1)", () => {
  it("a read-only doc renders the example-item float editor NON-editable", () => {
    const editor = buildMainWith(/* editable */ false);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderItemFloat(editor));
    });
    const floatEd = floatEditor(container);
    expect(floatEd).toBeTruthy();
    // The embedded editor is mounted read-only: TipTap `isEditable` is false
    // and the contenteditable root reflects it — so a user can't type phantom
    // text whose write-back the main readOnlyEnforcer would silently reject.
    expect(floatEd!.isEditable).toBe(false);
    expect((floatEd!.view.dom as HTMLElement).getAttribute("contenteditable")).toBe("false");
    editor.destroy();
  });

  it("an editable doc renders the example-item float editor editable (control)", () => {
    const editor = buildMainWith(/* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderItemFloat(editor));
    });
    const floatEd = floatEditor(container);
    expect(floatEd).toBeTruthy();
    expect(floatEd!.isEditable).toBe(true);
    editor.destroy();
  });
});
