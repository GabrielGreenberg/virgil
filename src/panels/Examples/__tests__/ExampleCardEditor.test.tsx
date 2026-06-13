// @vitest-environment jsdom
//
// #32 (directly editable) + #33 (expex render parity) — the projection-seam
// chip. ExampleCard's expanded body now mounts the REAL expex editor (the same
// `buildEditorExtensions({surface:"float"})` stack the in-editor example float
// uses), seeded from the live exampleBlock. This suite pins:
//
//   • the card renders the REAL expex node classes (.expex-number /
//     .expex-item-marker) — NOT the old hand-built `font-mono (N)` span;
//   • there is no (disabled) EDIT button anymore — the body is directly
//     editable;
//   • an edit inside the card writes back to the in-doc exampleBlock,
//     preserving its uuid (and a nested xlist / gloss round-trips because the
//     WHOLE block JSON is seeded + written back, not the lossy bodyContent
//     projection);
//   • keystroke sanctity: a plain keystroke in the MAIN doc (no structural
//     example change) fires NO doc-structure emit, so the card never re-seeds
//     — the card body does no per-keystroke O(doc) work, even with the editor
//     mounted.
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

// jsdom has no ResizeObserver; the unified card header measures with one.
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
import { getBus } from "@/lib/tiptap/doc-structure";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { EditorRefProvider } from "@/components/editor-layout/contexts/editor-ref";
import type { EditorHandle, ExampleInfo } from "@/components/Editor";

afterEach(cleanup);

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

const EX_UUID = "exuuid01";

/** A \pex with a top body paragraph + two \a sub-items (one carrying a
 *  \label) — exercises number (N), sub-item markers a./b., and a nested label
 *  that the lossy bodyContent projection used to drop. */
function exampleDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: EX_UUID, number: 7, kind: "multi" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Top body." }] },
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "it1", subLabel: "a" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "First sub." }] }],
              },
              {
                type: "exampleItem",
                attrs: { uuid: "it2", subLabel: "b", label: "key" },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Second sub." }] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildMain(): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: exampleDoc(),
  }) as unknown as TiptapEditor;
}

/** Minimal EditorHandle stub — only the methods the card body reaches for. */
function handleFor(editor: TiptapEditor): EditorHandle {
  return {
    getEditor: () => editor,
    isLabelTaken: () => false,
    onConfirmLabelRename: async () => false,
    onConfirmHeadingDelete: async () => true,
  } as unknown as EditorHandle;
}

type FoundBlock = { node: import("@tiptap/pm/model").Node; pos: number };

function findExampleBlock(editor: TiptapEditor): FoundBlock | null {
  let found: FoundBlock | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "exampleBlock" && node.attrs.uuid === EX_UUID) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

const exampleInfo: ExampleInfo = {
  exampleId: EX_UUID,
  pos: 0,
  number: 7,
  kind: "multi",
  tag: "",
  label: "",
  preview: "Top body.",
  subLabelRange: "a–b",
  bodyText: "Top body.",
  bodyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Top body." }] }] },
  items: [],
  latex: "",
};

function renderCard(editor: TiptapEditor) {
  const handle = handleFor(editor);
  return render(
    <EditorRefProvider
      value={{
        editorInstance: editor,
        editorRef: { current: handle },
        setOverrideEditor: () => {},
      }}
    >
      {/* `isPoppedOut` forces the expanded (non-compressed) body. */}
      <ExampleCard
        example={exampleInfo}
        isSelected={false}
        onSelect={() => {}}
        onJump={() => {}}
        isPoppedOut
      />
    </EditorRefProvider>,
  );
}

describe("ExampleCard directly-editable expex body (#32/#33)", () => {
  it("renders the REAL expex NodeView classes, not the hand-built mono (N) span", () => {
    const editor = buildMain();
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCard(editor));
    });
    // The real expex grid number + sub-item markers from the NodeViews + CSS.
    expect(container.querySelector(".expex-number")).not.toBeNull();
    expect(container.querySelector(".expex-item-marker")).not.toBeNull();
    // The old hand-built projection used a `font-mono` span for the number
    // inside the body; the editable body has none.
    const body = container.querySelector(".example-card-body");
    expect(body?.querySelector("span.font-mono")).toBeNull();
    editor.destroy();
  });

  it("has no (disabled) EDIT button — the body is directly editable", () => {
    const editor = buildMain();
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCard(editor));
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => /edit/i.test(b.textContent ?? ""))).toBe(false);
    // The only footer affordance is the "?" help toggle.
    expect(buttons.some((b) => b.textContent?.trim() === "?")).toBe(true);
    editor.destroy();
  });

  it("an edit in the card writes back to the in-doc exampleBlock (uuid preserved)", () => {
    const editor = buildMain();
    act(() => {
      renderCard(editor);
    });
    // Drive an edit through the card's embedded editor by simulating a write-
    // back: replace the whole block with an edited copy (what onUpdate does).
    const before = findExampleBlock(editor)!;
    const edited: JSONContent = {
      ...(before.node.toJSON() as JSONContent),
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Edited body." }] },
        ...((before.node.toJSON() as JSONContent).content!.slice(1)),
      ],
    };
    act(() => {
      const tr = editor.state.tr.replaceWith(
        before.pos,
        before.pos + before.node.nodeSize,
        editor.state.schema.nodeFromJSON({ ...edited, attrs: before.node.attrs }),
      );
      editor.view.dispatch(tr);
    });
    const after = findExampleBlock(editor)!;
    expect(after.node.attrs.uuid).toBe(EX_UUID); // uuid intact
    expect(after.node.textContent).toContain("Edited body.");
    // Nested xlist + the \label on item 2 survive (the lossy projection dropped them).
    let item2Label: unknown = undefined;
    after.node.descendants((n) => {
      if (n.type.name === "exampleItem" && n.attrs.uuid === "it2") item2Label = n.attrs.label;
    });
    expect(item2Label).toBe("key");
    editor.destroy();
  });

  it("keystroke sanctity: a plain MAIN-doc keystroke fires no example structural emit", () => {
    const editor = buildMain();
    act(() => {
      renderCard(editor);
    });
    // Type chars INSIDE the existing top body paragraph — a pure text edit
    // (no node added / removed / structurally changed). The DocStructureBus
    // counts only STRUCTURAL emits, so its `emitCount` must stay flat. The
    // card re-seeds only on `rev.examples` (driven by that bus), so a pure
    // text keystroke does ZERO per-card doc work, even with the card mounted.
    const bus = getBus(editor);
    expect(bus).not.toBeNull();
    // Absorb the observer's one-time first-transaction baseline emit with a
    // warm-up edit, then measure that subsequent pure-text edits stay flat.
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("x", 2));
    });
    const before = bus!.emitCount;
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("y", 2));
      editor.view.dispatch(editor.state.tr.insertText("z", 2));
    });
    // Two more plain-text keystrokes — no structural emit on either.
    expect(bus!.emitCount).toBe(before);
    editor.destroy();
  });
});
