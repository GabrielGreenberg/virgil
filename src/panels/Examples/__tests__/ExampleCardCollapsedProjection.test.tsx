// @vitest-environment jsdom
//
// Chip A fold (#43), renegotiated for Wave-3 presence tiers — the COLLAPSED
// example card's renderer is now TIER-CONDITIONAL:
//
//   • NEAR the viewport (tier ≥ 2) — and always with the tier flag OFF — it
//     renders through the SAME expex editor as expanded, forced read-only +
//     height-clamped (the #43 parity contract, unchanged): black native (N)
//     via .expex-number, expex serif/grid, non-typeable + clipped.
//   • FAR from the viewport (tier 1, flag on) — a static serif line
//     (`data-example-tier="static"`): the number + first line, NO editor
//     mounted at all. This is the perf win the tier system exists for.
//
// The tier hook is mocked with a controllable answer (the near-zone store is
// IO-driven and jsdom has no layout); tier 3 = flag off (the default path
// every pre-Wave-3 assertion ran under), tier 2 = near, tier 1 = far.
//
// Teeth: the live-projection its assert `.example-card-editor` present +
// NO `span.font-mono` (the BARE-mount fallback's signature — that branch,
// keyed on a missing editor context, is untouched by tiers). The FAR its
// assert the static line by its `data-example-tier` marker, `(7)` text, no
// `.example-card-editor` anywhere, and — the honest tooth that the perf win
// is real — the fiber scan finds NO embedded TipTap editor.
//
// The extension barrel transitively imports `@/lib/storage` (the known barrel/
// storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi, afterEach } from "vitest";

// Controllable tier answer (3 = flag off / legacy, 2 = near, 1 = far).
const h = vi.hoisted(() => ({ tier: 3 }));
vi.mock("@/cards/presence", () => ({
  useCardTier: () => h.tier,
}));

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
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { EditorRefProvider } from "@/components/editor-layout/contexts/editor-ref";
import type { EditorHandle, ExampleInfo } from "@/components/Editor";

afterEach(cleanup);

const EX_UUID = "exuuid01";

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

function exampleDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: EX_UUID, number: 7, kind: "single" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Top body." }] },
        ],
      },
    ],
  };
}

/** Build a main editor that mirrors the live VirgilEditor's editability signal:
 *  the PM view stays editable; `data-editable` is the declarative flag the
 *  card's `useMainEditable` reads. We build it EDITABLE so assertion (2) proves
 *  the collapsed read-only is forced ON TOP of an editable doc. */
function buildMain(editable = true): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content: exampleDoc(),
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", String(editable));
  return ed;
}

function handleFor(editor: TiptapEditor): EditorHandle {
  return {
    getEditor: () => editor,
    onConfirmLabelRename: async () => false,
    onConfirmHeadingDelete: async () => true,
  } as unknown as EditorHandle;
}

// ── Fiber harness (same shape as ExampleCard.test.tsx) — reach the live
// embedded TipTap Editor the collapsed card mounted, to read its editability.
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

const exampleInfo: ExampleInfo = {
  exampleId: EX_UUID,
  pos: 0,
  number: 7,
  kind: "single",
  tag: "",
  label: "",
  preview: "Top body.",
  subLabelRange: "",
  bodyText: "Top body.",
  bodyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Top body." }] }] },
  items: [],
  latex: "",
};

/** Render the card WITHOUT `isPoppedOut` → `compressed` is true (a fresh card
 *  is not in the expanded set). WITH the EditorRefProvider → `canEdit` true. */
function renderCollapsed(editor: TiptapEditor) {
  const handle = handleFor(editor);
  return render(
    <EditorRefProvider
      value={{
        editorInstance: editor,
        editorRef: { current: handle },
        setOverrideEditor: () => {},
      }}
    >
      <ExampleCard
        example={exampleInfo}
        isSelected={false}
        onSelect={() => {}}
        onJump={() => {}}
      />
    </EditorRefProvider>,
  );
}

describe("ExampleCard collapsed read-only projection (#43)", () => {
  afterEach(() => {
    h.tier = 3; // default back to flag-off/legacy for the sibling its
  });

  it("the collapsed body mounts the read-only expex projection, not the static fallback", () => {
    const editor = buildMain(/* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCollapsed(editor));
    });
    const body = container.querySelector(".example-card-body");
    expect(body).not.toBeNull();
    // (1) The read-only projection mounted: the collapsed editor root carries
    // BOTH the shared `.example-card-editor` class and the collapsed marker.
    const collapsedRoot = body!.querySelector(
      ".example-card-editor.example-card-editor-collapsed",
    );
    expect(collapsedRoot).not.toBeNull();
    // Teeth: the STATIC fallback (no-editor path) renders a `span.font-mono`
    // (N) and NO `.example-card-editor`. Its absence proves the projection
    // mounted — this assertion fails if the branch regresses to the string.
    expect(body!.querySelector("span.font-mono")).toBeNull();
    editor.destroy();
  });

  it("the embedded collapsed editor is NON-editable even though the main doc is editable", () => {
    const editor = buildMain(/* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCollapsed(editor));
    });
    // Sanity: the MAIN doc is editable …
    expect((editor.view.dom as HTMLElement).getAttribute("data-editable")).toBe("true");
    const pm = container.querySelector(".example-card-editor");
    expect(pm).not.toBeNull();
    const collapsedEd = embeddedEditorFor(pm!.parentElement ?? pm!);
    expect(collapsedEd).toBeTruthy();
    expect(collapsedEd).not.toBe(editor); // the EMBEDDED editor, not main
    // (2) … yet the collapsed preview forces the embedded editor read-only.
    expect(collapsedEd!.isEditable).toBe(false);
    expect((collapsedEd!.view.dom as HTMLElement).getAttribute("contenteditable")).toBe("false");
    editor.destroy();
  });

  it("renders the native expex (N) glyph (.expex-number), not a teal mono (N)", () => {
    const editor = buildMain(/* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCollapsed(editor));
    });
    const body = container.querySelector(".example-card-body");
    expect(body).not.toBeNull();
    // (3) The number is the native expex glyph from the real NodeView + CSS …
    const num = body!.querySelector(".expex-number");
    expect(num).not.toBeNull();
    expect(num!.textContent).toContain("(7)");
    // … NOT the old hand-built mono (N) span (which carried theme.titleColor /
    // teal). No `font-mono` number lives in the collapsed body.
    expect(body!.querySelector("span.font-mono")).toBeNull();
    editor.destroy();
  });

  it("NEAR tier (2): identical live projection — the parity contract survives the tier fork", () => {
    h.tier = 2;
    const editor = buildMain(true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCollapsed(editor));
    });
    const body = container.querySelector(".example-card-body");
    expect(
      body!.querySelector(".example-card-editor.example-card-editor-collapsed"),
    ).not.toBeNull();
    expect(body!.querySelector("span.font-mono")).toBeNull();
    editor.destroy();
  });
});

describe("ExampleCard collapsed FAR tier (Wave 3) — static line, zero editors", () => {
  afterEach(() => {
    h.tier = 3;
  });

  it("tier 1 renders the static serif line: number present, no editor root, no live TipTap instance", () => {
    h.tier = 1;
    const editor = buildMain(true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCollapsed(editor));
    });
    const body = container.querySelector(".example-card-body");
    expect(body).not.toBeNull();
    // The static far line, by its own signature …
    const staticLine = body!.querySelector('[data-example-tier="static"]');
    expect(staticLine).not.toBeNull();
    expect(staticLine!.textContent).toContain("(7)");
    expect(staticLine!.textContent).toContain("Top body.");
    // … in the expex look, NOT the bare-mount fallback's mono signature …
    expect(body!.querySelector("span.font-mono")).toBeNull();
    // … with NO editor mounted anywhere in the collapsed body:
    expect(body!.querySelector(".example-card-editor")).toBeNull();
    expect(body!.querySelector(".ProseMirror")).toBeNull();
    // The honest tooth: the fiber scan that FINDS the live embedded editor in
    // the near/legacy its finds no NEW instance here — the only editor
    // reachable from the card subtree is the MAIN doc's (the provider value
    // an ancestor fiber carries); zero embedded TipTap instances mounted.
    const found = embeddedEditorFor(body!);
    expect(found === null || found === editor).toBe(true);
    editor.destroy();
  });

  it("a tier flip far→near swaps the static line for the live projection", () => {
    h.tier = 1;
    const editor = buildMain(true);
    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;
    act(() => {
      const r = renderCollapsed(editor);
      container = r.container;
      rerender = r.rerender;
    });
    expect(container.querySelector('[data-example-tier="static"]')).not.toBeNull();
    // Promote: the near-zone store reported the card near → tier 2.
    h.tier = 2;
    act(() => {
      rerender(
        <EditorRefProvider
          value={{
            editorInstance: editor,
            editorRef: { current: handleFor(editor) },
            setOverrideEditor: () => {},
          }}
        >
          <ExampleCard
            example={exampleInfo}
            isSelected={false}
            onSelect={() => {}}
            onJump={() => {}}
          />
        </EditorRefProvider>,
      );
    });
    expect(container.querySelector('[data-example-tier="static"]')).toBeNull();
    expect(
      container.querySelector(".example-card-editor.example-card-editor-collapsed"),
    ).not.toBeNull();
    editor.destroy();
  });
});
