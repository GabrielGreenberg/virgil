// @vitest-environment jsdom
//
// Task 397 — the lightning grid answers applicability PER ROW, and each row's
// gate is SCHEMA-PRECISE about what its own commit will attempt.
//
// One disease, three members, all measured against the REAL
// `buildEditorExtensions("main")` stack (only `@/lib/storage` is stubbed, per the
// extension-barrel gotcha):
//
//   1. SIX block-atom cells shared ONE probe of the `example` row, so with the
//      caret inside an expex example **Display math** and **Image** greyed out
//      although each row says `ok`, the schema hosts them, and the run works.
//      That widening (`graphicsBlock | displayMath` into both expex unions) was
//      made for exactly this, so the affordance was refusing the feature it was
//      built to serve.
//   2. The wrapper gate read the block TYPE and never the CONTAINER, so
//      Blockquote was lit and inert inside an example, and Bullet/Numbered at a
//      caret inside an example ITEM silently DESTROYED the item — `exampleItem`'s
//      union has no list, so PM lifts the paragraph out: `\vxid{it1}` is gone,
//      fresh uuids mint in its place (every card / marginalia marker / sidecar
//      entry anchored to it orphans), and because expex numbers items by
//      POSITION, `(1a)` now denotes what was the SECOND item — so every `\ref`
//      into that example points at different text.
//   3. The five mark cells were gated on `!canEdit` alone and sat lit and inert
//      in the two markless (`marks: ""`) verbatim blocks.
//
// WHY NO EXISTING FIXTURE COULD SEE ANY OF IT: every block-atom container fixture
// in the repo is `titleField` / `codeBlock` / `latexComment` / prose
// (`block-atom-container-gate.test.ts`), where all six types AGREE — which is
// precisely why the shared probe shipped and survived. The defect needs a
// container whose content model is narrower than `block+` and richer than
// nothing, i.e. an expex example. Every fixture here is one.
//
// Member 2's destruction is legible ONLY in the bytes, so its legs assert the
// serialized `.tex` as well as the node shape.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { render, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
} from "@/lib/actions/action-registry";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { ActionsMenuPanel } from "@/components/ActionsMenuPanel";
import { DragHandleMenuProvider } from "@/components/editor-layout/card-actions/drag-handle-menu-context";

// jsdom has no ResizeObserver; `useFloatingMenuPosition` measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

// ───────────────────────────────────────────────────────────────────────────
// Real editor stack
// ───────────────────────────────────────────────────────────────────────────

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

/** Prose · an expex example with a BODY paragraph and TWO `\a` items · a nested
 *  bullet list inside the example · a blockquote · a top-level bullet list with
 *  a multi-paragraph item · the two markless verbatim blocks. Every container
 *  whose answer differs from another's. */
const FIXTURE = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { uuid: "prose" }, content: [{ type: "text", text: "Ordinary prose here." }] },
    {
      type: "exampleBlock",
      attrs: { uuid: "ex" },
      content: [
        { type: "paragraph", attrs: { uuid: "ex-body" }, content: [{ type: "text", text: "example body text" }] },
        {
          type: "bulletList",
          attrs: { uuid: "ex-ul" },
          content: [
            { type: "listItem", attrs: { uuid: "ex-li" }, content: [{ type: "paragraph", attrs: { uuid: "ex-li-p" }, content: [{ type: "text", text: "list inside example" }] }] },
          ],
        },
        {
          type: "exampleItemList",
          content: [
            { type: "exampleItem", attrs: { uuid: "it1" }, content: [{ type: "paragraph", attrs: { uuid: "it1p" }, content: [{ type: "text", text: "item text" }] }] },
            { type: "exampleItem", attrs: { uuid: "it2" }, content: [{ type: "paragraph", attrs: { uuid: "it2p" }, content: [{ type: "text", text: "second item" }] }] },
          ],
        },
      ],
    },
    { type: "blockquote", attrs: { uuid: "bq" }, content: [{ type: "paragraph", attrs: { uuid: "bq-p" }, content: [{ type: "text", text: "quoted prose" }] }] },
    {
      type: "bulletList",
      attrs: { uuid: "ul" },
      content: [
        { type: "listItem", attrs: { uuid: "li1" }, content: [{ type: "paragraph", attrs: { uuid: "li1p" }, content: [{ type: "text", text: "first item" }] }] },
        {
          type: "listItem",
          attrs: { uuid: "li2" },
          content: [
            { type: "paragraph", attrs: { uuid: "li2p1" }, content: [{ type: "text", text: "second item" }] },
            { type: "paragraph", attrs: { uuid: "li2p2" }, content: [{ type: "text", text: "its second paragraph" }] },
          ],
        },
      ],
    },
    { type: "codeBlock", attrs: { uuid: "code" }, content: [{ type: "text", text: "x = 1" }] },
    { type: "latexComment", attrs: { uuid: "cmt" }, content: [{ type: "text", text: "a comment" }] },
  ],
};

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: FIXTURE as never,
  });
}

/** A mid-content caret inside the block carrying `uuid`, placed as the LIVE
 *  selection — the wrapper gate reads `view.state.selection`, which is what the
 *  panel's own ctx describes, so a synthetic ref alone would not exercise it. */
function caretIn(editor: Editor, uuid: string): number {
  let pos = -1;
  editor.state.doc.descendants((node: PMNode, at: number) => {
    if (pos >= 0) return false;
    if (node.attrs?.uuid === uuid) {
      pos = at + 1 + Math.floor(Math.max(1, node.content.size) / 2);
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no block with uuid ${uuid}`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  return pos;
}

/** The verdict the GRID renders for `id` at the current caret. */
function verdict(editor: Editor, id: ActionId): "ok" | "disabled" | "absent" {
  const { from, to } = editor.state.selection;
  return VIRGIL_ACTION_REGISTRY[id]!.applies({
    editor,
    view: editor.view,
    ref: { kind: "selection", from, to, paragraphId: "" },
    surface: "lightning",
    canEdit: true,
  } as unknown as ActionContext);
}

function invoke(editor: Editor, id: ActionId): void {
  const { from, to } = editor.state.selection;
  VIRGIL_ACTION_REGISTRY[id]!.run({
    editor,
    view: editor.view,
    ref: { kind: "selection", from, to, paragraphId: "" },
    surface: "lightning",
    canEdit: true,
  } as unknown as ActionContext);
}

function uuidsIn(editor: Editor): Set<string> {
  const out = new Set<string>();
  editor.state.doc.descendants((n) => {
    if (n.attrs?.uuid) out.add(String(n.attrs.uuid));
    return true;
  });
  return out;
}

const BLOCK_ATOMS: ActionId[] = ["example", "display-math", "tex", "figure", "graphics", "forest"];
const WRAPPERS: ActionId[] = ["bullet-list", "ordered-list", "blockquote"];
const MARKS: ActionId[] = ["bold", "italic", "strike", "code", "text-color"];

let rafStub: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(() => {
  // jsdom has no layout; the figure/graphics runs reach `chain().focus()`
  // (→ `coordsAtPos` → `getClientRects`) before their container guard bails.
  const RECT = { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 };
  Object.defineProperty(Element.prototype, "getClientRects", { value: () => [RECT], configurable: true });
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [RECT], configurable: true });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { value: () => RECT, configurable: true });
  // `graphicsRun` defers its insert-popover to a rAF that reads `view.nodeDOM`.
  // These legs assert the DOCUMENT, and the editor is destroyed before the frame
  // would land — so run the callback SYNCHRONOUSLY (the `block-atom-container-gate`
  // idiom) rather than leaving a frame queued past `destroy()`.
  rafStub = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  rafStub?.mockRestore();
  document.body.innerHTML = "";
});

// ───────────────────────────────────────────────────────────────────────────
// Member 1 — six block-atom cells, six answers
// ───────────────────────────────────────────────────────────────────────────

describe("member 1 — a block-atom cell answers for its OWN node type", () => {
  it("prose is the control: all six ENABLED", () => {
    const editor = mount();
    caretIn(editor, "prose");
    for (const id of BLOCK_ATOMS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  // The defect leg. The shared probe rendered the `example` row's "disabled" on
  // all six; the schema does not agree with itself here, which is the point.
  for (const [where, uuid] of [["an example BODY paragraph", "ex-body"], ["an example ITEM", "it1p"]] as const) {
    it(`inside ${where}: Display math + Image are ENABLED, the other four greyed`, () => {
      const editor = mount();
      caretIn(editor, uuid);
      expect(verdict(editor, "display-math")).toBe("ok");
      expect(verdict(editor, "graphics")).toBe("ok");
      for (const id of ["example", "tex", "figure", "forest"] as ActionId[]) {
        expect(verdict(editor, id), id).toBe("disabled");
      }
      editor.destroy();
    });

    it(`inside ${where}: the two ENABLED cells actually insert (the affordance is honest)`, () => {
      for (const id of ["display-math", "graphics"] as ActionId[]) {
        const editor = mount();
        caretIn(editor, uuid);
        const before = JSON.stringify(editor.state.doc.toJSON());
        invoke(editor, id);
        expect(JSON.stringify(editor.state.doc.toJSON()), `${id} in ${where}`).not.toBe(before);
        editor.destroy();
      }
    });
  }

  it("the markless verbatim blocks still grey ALL SIX (task 147 non-regression)", () => {
    for (const uuid of ["code", "cmt"]) {
      const editor = mount();
      caretIn(editor, uuid);
      for (const id of BLOCK_ATOMS) expect(verdict(editor, id), `${id} in ${uuid}`).toBe("disabled");
      editor.destroy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Member 2 — the wrapper gate is a CONTAINER question
// ───────────────────────────────────────────────────────────────────────────

describe("member 2 — a wrapper cell asks whether the container can host it", () => {
  it("prose is the control: all three ENABLED", () => {
    const editor = mount();
    caretIn(editor, "prose");
    for (const id of WRAPPERS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  it("an example BODY paragraph: lists ENABLED (the union admits them), Blockquote GREYED", () => {
    const editor = mount();
    caretIn(editor, "ex-body");
    expect(verdict(editor, "bullet-list")).toBe("ok");
    expect(verdict(editor, "ordered-list")).toBe("ok");
    expect(verdict(editor, "blockquote")).toBe("disabled");
    editor.destroy();
  });

  it("an example ITEM: all three GREYED — the item's union has no list and no quote", () => {
    const editor = mount();
    caretIn(editor, "it1p");
    for (const id of WRAPPERS) expect(verdict(editor, id), id).toBe("disabled");
    editor.destroy();
  });

  // THE data-loss leg. Only the bytes show it: the pre-397 gate let this run.
  for (const id of ["bullet-list", "ordered-list"] as ActionId[]) {
    it(`${id} at a caret in an example ITEM leaves the item's \\vxid identity and numbering INTACT`, () => {
      const editor = mount();
      caretIn(editor, "it1p");
      const beforeUuids = uuidsIn(editor);
      const beforeTex = serializeBodyOnly(editor.state.doc.toJSON() as never);
      invoke(editor, id);
      const afterTex = serializeBodyOnly(editor.state.doc.toJSON() as never);
      // 1. nothing moved at all (the run's defense-in-depth guard bailed)
      expect(afterTex).toBe(beforeTex);
      // 2. and the two facts the destruction consumed, asserted directly, so a
      //    future change that moves OTHER bytes still has to keep these:
      expect([...uuidsIn(editor)].sort()).toEqual([...beforeUuids].sort());
      expect(afterTex).toContain("\\vxid{it1}\\a item text");
      expect(afterTex).toContain("\\vxid{it2}\\a second item");
      // 3. …and the example did not sprout an `itemize` in place of its item.
      expect(afterTex).not.toContain("\\begin{itemize}\n  \\item item text");
      editor.destroy();
    });
  }

  it("a list toggle inside a LIST is SUBTRACTIVE and stays enabled (lift + convert)", () => {
    // The half a naive `findWrapping`-only gate would break: at index 0 of a
    // `listItem` no wrapper can be placed, yet bullet→off and bullet→numbered
    // are the two most ordinary list gestures there are.
    for (const uuid of ["li1p", "ex-li-p"]) {
      const editor = mount();
      caretIn(editor, uuid);
      expect(verdict(editor, "bullet-list"), `bullet-list in ${uuid}`).toBe("ok");
      expect(verdict(editor, "ordered-list"), `ordered-list in ${uuid}`).toBe("ok");
      // …and Blockquote there is inert (listItem pins a leading paragraph), so
      // it greys — which is the same tightening, in the other direction.
      expect(verdict(editor, "blockquote"), `blockquote in ${uuid}`).toBe("disabled");
      editor.destroy();
    }
  });

  it("…and the subtractive toggles still WORK when invoked (no over-gating)", () => {
    for (const id of ["bullet-list", "ordered-list"] as ActionId[]) {
      const editor = mount();
      caretIn(editor, "li1p");
      const before = JSON.stringify(editor.state.doc.toJSON());
      invoke(editor, id);
      expect(JSON.stringify(editor.state.doc.toJSON()), id).not.toBe(before);
      editor.destroy();
    }
  });

  it("a SECOND paragraph of a list item takes all three (block* admits them there)", () => {
    const editor = mount();
    caretIn(editor, "li2p2");
    for (const id of WRAPPERS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  it("a paragraph in a blockquote keeps all three (toggle-off + wrap)", () => {
    const editor = mount();
    caretIn(editor, "bq-p");
    for (const id of WRAPPERS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  it("the markless verbatim blocks still grey all three (Bug #1 non-regression)", () => {
    for (const uuid of ["code", "cmt"]) {
      const editor = mount();
      caretIn(editor, uuid);
      for (const id of WRAPPERS) expect(verdict(editor, id), `${id} in ${uuid}`).toBe("disabled");
      editor.destroy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Member 3 — a mark cell asks whether the schema admits its mark
// ───────────────────────────────────────────────────────────────────────────

describe("member 3 — a mark cell answers for its OWN mark", () => {
  it("prose is the control: all five ENABLED", () => {
    const editor = mount();
    caretIn(editor, "prose");
    for (const id of MARKS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  it("the two markless blocks grey all five — the toggle is inert there", () => {
    for (const uuid of ["code", "cmt"]) {
      const editor = mount();
      expect(editor.state.schema.nodes[uuid === "code" ? "codeBlock" : "latexComment"]!.spec.marks).toBe("");
      caretIn(editor, uuid);
      for (const id of MARKS) expect(verdict(editor, id), `${id} in ${uuid}`).toBe("disabled");
      editor.destroy();
    }
  });

  it("a selection running from prose INTO a markless block stays ENABLED", () => {
    // The cell greys only when the toggle is inert EVERYWHERE it could act. A
    // mixed range still bolds its prose half, so greying it would take away a
    // working gesture — "does any touched block accept this mark", not "do all".
    const editor = mount();
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((n: PMNode, at: number) => {
      if (n.attrs?.uuid === "prose") from = at + 1;
      if (n.attrs?.uuid === "code") to = at + 1 + n.content.size;
      return true;
    });
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    for (const id of MARKS) expect(verdict(editor, id), id).toBe("ok");
    editor.destroy();
  });

  it("inside an example (body and item) all five stay ENABLED — a paragraph takes marks", () => {
    for (const uuid of ["ex-body", "it1p"]) {
      const editor = mount();
      caretIn(editor, uuid);
      for (const id of MARKS) expect(verdict(editor, id), `${id} in ${uuid}`).toBe("ok");
      editor.destroy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The slash twins ride the same guard
// ───────────────────────────────────────────────────────────────────────────

describe("the wrapper run() is the guard the SLASH twins inherit", () => {
  // `\list` / `\enumerate` / `\quote` route through the bridge into the SAME
  // registry `run()`, and the slash popup asks no container question of its own
  // — so the defense-in-depth guard is the only thing standing between a typed
  // `\list` inside an expex item and the destruction above.
  it("every wrapper row's run() bails where its applies() greys", () => {
    for (const id of WRAPPERS) {
      const editor = mount();
      caretIn(editor, "it1p");
      expect(verdict(editor, id), id).toBe("disabled");
      const before = JSON.stringify(editor.state.doc.toJSON());
      invoke(editor, id);
      expect(JSON.stringify(editor.state.doc.toJSON()), `${id} mutated a greyed target`).toBe(before);
      editor.destroy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The PANEL itself — the leg the registry legs above structurally cannot reach
// ───────────────────────────────────────────────────────────────────────────

describe("the rendered grid asks the row (the panel, not just the registry)", () => {
  // Every leg above drives `VIRGIL_ACTION_REGISTRY[id].applies(...)` — and each
  // row answered CORRECTLY the whole time. What misbehaved is the CONSUMER, so
  // a leg that never renders the panel cannot see the defect at all. This one
  // mounts the REAL `ActionsMenuPanel` over the REAL editor and reads each
  // cell's native `disabled` out of the DOM.
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  function renderGrid(editor: Editor, uuid: string) {
    caretIn(editor, uuid);
    const { from, to } = editor.state.selection;
    const api = { open: () => {}, dispatch: () => {} } as unknown as Parameters<
      typeof DragHandleMenuProvider
    >[0]["value"];
    render(
      <DragHandleMenuProvider value={api}>
        <ActionsMenuPanel
          editor={editor as unknown as Parameters<typeof ActionsMenuPanel>[0]["editor"]}
          paragraphUuid={uuid}
          nodeKind="paragraph"
          range={{ from, to }}
          mode="cursor"
          triggerRect={{ left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 } as DOMRect}
          onClose={() => {}}
        />
      </DragHandleMenuProvider>,
    );
  }

  /** The cell's rendered `disabled`, read by the stable menu DOM id. */
  function cellDisabled(id: ActionId): boolean {
    const el = document.querySelector(`[id$="-item-${id}"]`) as HTMLButtonElement | null;
    if (!el) throw new Error(`no rendered grid cell for ${id}`);
    return el.disabled === true;
  }

  it("inside an expex example the SIX block-atom cells render SIX answers", () => {
    const editor = mount();
    renderGrid(editor, "ex-body");
    // Feature A2 is reachable from the grid again…
    expect(cellDisabled("display-math"), "display-math").toBe(false);
    expect(cellDisabled("graphics"), "graphics").toBe(false);
    // …and the four the schema genuinely refuses stay greyed.
    for (const id of ["example", "tex", "figure", "forest"] as ActionId[]) {
      expect(cellDisabled(id), id).toBe(true);
    }
    editor.destroy();
  });

  it("inside an example ITEM the two list cells are GREYED (the destructive pair)", () => {
    const editor = mount();
    renderGrid(editor, "it1p");
    for (const id of WRAPPERS) expect(cellDisabled(id), id).toBe(true);
    editor.destroy();
  });

  it("inside an example BODY the list cells stay lit and Blockquote greys", () => {
    const editor = mount();
    renderGrid(editor, "ex-body");
    expect(cellDisabled("bullet-list")).toBe(false);
    expect(cellDisabled("ordered-list")).toBe(false);
    expect(cellDisabled("blockquote")).toBe(true);
    editor.destroy();
  });

  it("inside a markless verbatim block the five MARK cells are GREYED", () => {
    const editor = mount();
    renderGrid(editor, "code");
    for (const id of MARKS) expect(cellDisabled(id), id).toBe(true);
    editor.destroy();
  });

  it("prose is the control: every grid cell renders ENABLED", () => {
    const editor = mount();
    renderGrid(editor, "prose");
    for (const id of [...BLOCK_ATOMS, ...WRAPPERS, ...MARKS] as ActionId[]) {
      expect(cellDisabled(id), id).toBe(false);
    }
    editor.destroy();
  });
});
