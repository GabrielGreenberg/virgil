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
import { TextSelection } from "@tiptap/pm/state";
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

function findExampleBlock(editor: TiptapEditor, uuid: string = EX_UUID): FoundBlock | null {
  let found: FoundBlock | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.type.name === "exampleBlock" && node.attrs.uuid === uuid) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/** Reach the live embedded TipTap `Editor` a card mounted, so a test can
 *  drive a REAL edit through it (firing the card's own `onUpdate` →
 *  writeBackToMain, exactly as a keystroke would) and read its editability.
 *  `useEditor` keeps the editor in React state, so we climb the fiber tree
 *  from the `.example-card-editor` PM root (PM-created, no fiber of its own)
 *  up through its parent chain and deep-scan each fiber's props/state for an
 *  object that quacks like a TipTap editor. Returns one per card, DOM order. */
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
function embeddedEditors(container: HTMLElement): TiptapEditor[] {
  return Array.from(container.querySelectorAll(".example-card-editor"))
    .map((el) => embeddedEditorFor(el.parentElement ?? el))
    .filter((e): e is TiptapEditor => !!e);
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

  it("an edit in the card writes back via the REAL onUpdate path (uuid preserved)", () => {
    // #39 nit 3: drive the edit THROUGH the embedded card editor's own view
    // so its `onUpdate` → `writeBackToMain` fires, instead of hand-building a
    // replaceWith on the main editor. This exercises the actual write-back
    // contract a keystroke triggers.
    const editor = buildMain();
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCard(editor));
    });
    const [cardEd] = embeddedEditors(container);
    expect(cardEd).toBeTruthy(); // the card editor mounted + is reachable
    expect(cardEd).not.toBe(editor); // it's the EMBEDDED editor, not main
    // Type into the card editor's top body paragraph (its first paragraph
    // opens at pos 1 → text "Top body." starts at 2). Insert at the end of
    // that text (pos 11). Dispatching through the card editor's OWN view
    // fires its `onUpdate` → writeBackToMain — the real wiring, not a
    // hand-built main-editor replaceWith.
    act(() => {
      cardEd.view.dispatch(cardEd.state.tr.insertText(" EDITED", 11, 11));
    });
    const after = findExampleBlock(editor)!;
    expect(after.node.attrs.uuid).toBe(EX_UUID); // uuid intact through write-back
    expect(after.node.textContent).toContain("Top body. EDITED");
    // Nested \label on item 2 survives (whole-block seed + write-back).
    let item2Label: unknown = undefined;
    after.node.descendants((n) => {
      if (n.type.name === "exampleItem" && n.attrs.uuid === "it2") item2Label = n.attrs.label;
    });
    expect(item2Label).toBe("key");
    editor.destroy();
  });

  it("threads a docIdRef into the embedded editor's figure extension (#39 nit 3)", () => {
    // The card editor builds its extensions with `docIdRef` so nested
    // figure/graphics atoms resolve their real image (read-only) instead of a
    // compact pill — parity with the example float. Pin the wiring: the
    // figureBlock extension on the EMBEDDED editor carries a docIdRef option
    // (a ref object, even if its `.current` is null in this bare/no-pipeline
    // mount). Without the threading this option is undefined.
    const editor = buildMain();
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCard(editor));
    });
    const [cardEd] = embeddedEditors(container);
    const figureExt = cardEd.extensionManager.extensions.find(
      (e) => e.name === "figureBlock",
    );
    expect(figureExt).toBeTruthy();
    const docIdRef = (figureExt!.options as { docIdRef?: { current: unknown } }).docIdRef;
    expect(docIdRef).toBeTruthy();
    expect(docIdRef).toHaveProperty("current");
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

// ── #39 nit 1 (content re-seed) + nit 2 (read-only) ─────────────────────────

const EX_A = "exaaaa01";
const EX_B = "exbbbb01";

function twoExampleDoc(): JSONContent {
  // Inner paragraphs carry explicit uuids so the first content edit isn't
  // consumed by a one-time uuid-hydration structural pass.
  const block = (uuid: string, puuid: string, text: string): JSONContent => ({
    type: "exampleBlock",
    attrs: { uuid, number: 1, kind: "single" },
    content: [{ type: "paragraph", attrs: { uuid: puuid }, content: [{ type: "text", text }] }],
  });
  return {
    type: "doc",
    content: [block(EX_A, "pa000001", "Alpha body."), block(EX_B, "pb000001", "Beta body.")],
  };
}

function buildMainWith(content: JSONContent, editable = true): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  }) as unknown as TiptapEditor;
  // Mirror the read-only signal the way the live VirgilEditor does — the main
  // PM view stays editable; `data-editable` is the declarative flag the card's
  // `useMainEditable` reads.
  ed.view.dom.setAttribute("data-editable", String(editable));
  return ed;
}

function infoFor(uuid: string, bodyText: string): ExampleInfo {
  return {
    exampleId: uuid,
    pos: 0,
    number: 1,
    kind: "single",
    tag: "",
    label: "",
    preview: bodyText,
    subLabelRange: "",
    bodyText,
    bodyContent: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
    items: [],
    latex: "",
  };
}

function renderCardsFor(editor: TiptapEditor, infos: ExampleInfo[]) {
  const handle = handleFor(editor);
  return render(
    <EditorRefProvider
      value={{ editorInstance: editor, editorRef: { current: handle }, setOverrideEditor: () => {} }}
    >
      {infos.map((info) => (
        <ExampleCard
          key={info.exampleId}
          example={info}
          isSelected={false}
          onSelect={() => {}}
          onJump={() => {}}
          isPoppedOut
        />
      ))}
    </EditorRefProvider>,
  );
}

describe("ExampleCard content-edit staleness fix (#39 nit 1)", () => {
  it("a MAIN content edit to example A re-seeds card A but NOT card B", () => {
    const editor = buildMainWith(twoExampleDoc());
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCardsFor(editor, [infoFor(EX_A, "Alpha body."), infoFor(EX_B, "Beta body.")]));
    });
    const edsBefore = embeddedEditors(container);
    expect(edsBefore).toHaveLength(2);
    const [cardA, cardB] = edsBefore;
    expect(cardA.getText()).toContain("Alpha body.");
    expect(cardB.getText()).toContain("Beta body.");

    // Warm-up: the observer's one-time first-transaction baseline pass fires a
    // STRUCTURAL emit on the editor's very first edit (the W-A keystroke-
    // sanctity test absorbs the same baseline). Spend it on a throwaway edit
    // in a plain spot so the MEASURED edit below is a clean content-only
    // signal. We append+remove a space at the end of B's paragraph so the
    // baseline is consumed without leaving residue.
    {
      const b = findExampleBlock(editor, EX_B)!;
      act(() => {
        editor.view.dispatch(editor.state.tr.insertText(" ", b.pos + b.node.nodeSize - 2));
      });
      const b2 = findExampleBlock(editor, EX_B)!;
      act(() => {
        editor.view.dispatch(editor.state.tr.delete(b2.pos + b2.node.nodeSize - 3, b2.pos + b2.node.nodeSize - 2));
      });
    }

    // Now the measured edit: a content-only edit to example A in the MAIN
    // editor (no add/remove → `rev.examples` stays flat). Insert at the end
    // of A's paragraph text (before the paragraph + block closing tokens).
    const a = findExampleBlock(editor, EX_A)!;
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(" CHANGED", a.pos + a.node.nodeSize - 2));
    });

    // Card A re-seeded from the live block — its embedded editor now shows
    // the changed text (the staleness the chip targets). Same Editor
    // instance (setContent re-seed, no remount), so re-read it.
    expect(cardA.getText()).toContain("CHANGED");
    // Card B is unchanged — the per-uuid signal fired only for A's uuid.
    expect(cardB.getText()).toContain("Beta body.");
    expect(cardB.getText()).not.toContain("CHANGED");
    editor.destroy();
  });
});

describe("ExampleCard read-only typeability (#39 nit 2)", () => {
  it("a read-only doc renders the example card editor NON-editable", () => {
    const editor = buildMainWith(twoExampleDoc(), /* editable */ false);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCardsFor(editor, [infoFor(EX_A, "Alpha body.")]));
    });
    const [cardEd] = embeddedEditors(container);
    expect(cardEd).toBeTruthy();
    // The embedded editor is mounted read-only: TipTap `isEditable` is false
    // and the contenteditable root reflects it — so a user can't type phantom
    // text whose write-back the main readOnlyEnforcer would silently reject.
    expect(cardEd.isEditable).toBe(false);
    expect((cardEd.view.dom as HTMLElement).getAttribute("contenteditable")).toBe("false");
    editor.destroy();
  });

  it("an editable doc renders the example card editor editable (control)", () => {
    const editor = buildMainWith(twoExampleDoc(), /* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCardsFor(editor, [infoFor(EX_A, "Alpha body.")]));
    });
    const [cardEd] = embeddedEditors(container);
    expect(cardEd.isEditable).toBe(true);
    editor.destroy();
  });
});

// ── #40 PART 2 — echo-guard / re-seed cursor survival ───────────────────────
//
// Post-#39 the example card has a re-seed effect (gated on `rev.examples` +
// `contentRev`) that pushes the live main block into the embedded editor via
// `setContent`. Two distinct caret hazards live on that path, both now
// load-bearing and previously UNPINNED (the existing tests only check WHICH
// card re-seeds + read-only, never the caret):
//
//   1. Echo guard — when the re-derived `nextJson` already EQUALS the card's
//      own content (the card just wrote it back, or a foreign re-derivation
//      produced no change), the effect MUST short-circuit BEFORE `setContent`
//      (`lastSyncedRef === nextJson` / `editor.getJSON() === nextJson`). A
//      spurious `setContent` mid-typing would rebuild the doc and disturb the
//      caret. We type THROUGH the card editor and assert the live doc node +
//      caret survive the self-write-back round-trip untouched.
//
//   2. Caret restore — when the re-seed genuinely DOES fire (a real foreign
//      main edit to THIS example), the effect saves `{from,to}` and restores
//      it after `setContent`, so the user's caret stays where it was rather
//      than collapsing to the rebuilt doc's start. We park the card caret
//      mid-text, drive a foreign main interior edit, and assert the caret is
//      preserved at its original offset across the re-seed.
describe("ExampleCard re-seed cursor survival (#40 PART 2)", () => {
  /** Resolve the end-of-text position inside the card editor's sole paragraph
   *  (robust to nesting depth). */
  function endOfParagraph(cardEd: TiptapEditor): number {
    let end = cardEd.state.doc.content.size;
    cardEd.state.doc.descendants((n, pos) => {
      if (n.type.name === "paragraph") end = pos + 1 + n.content.size;
    });
    return end;
  }

  /** Spend the observer's one-time first-transaction baseline emit on a
   *  throwaway no-op edit in MAIN (append+remove a space in B), so a measured
   *  edit afterward is a clean content-only signal — same warm-up the #39
   *  nit 1 test uses. */
  function absorbBaseline(editor: TiptapEditor) {
    const b = findExampleBlock(editor, EX_B)!;
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(" ", b.pos + b.node.nodeSize - 2));
    });
    const b2 = findExampleBlock(editor, EX_B)!;
    act(() => {
      editor.view.dispatch(editor.state.tr.delete(b2.pos + b2.node.nodeSize - 3, b2.pos + b2.node.nodeSize - 2));
    });
  }

  it("typing in the card does NOT reset the caret on its own write-back round-trip", () => {
    const editor = buildMainWith(twoExampleDoc(), /* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCardsFor(editor, [infoFor(EX_A, "Alpha body.")]));
    });
    const [cardEd] = embeddedEditors(container);
    expect(cardEd).toBeTruthy();
    expect(cardEd).not.toBe(editor); // the embedded card editor, not main
    absorbBaseline(editor);

    // Type a char THROUGH the card editor's own view at the end of its body
    // text, so its onUpdate → writeBackToMain fires (the real keystroke
    // wiring). The caret lands right after the inserted "Z".
    const endOfText = endOfParagraph(cardEd);
    const expectedCaret = endOfText + 1;
    act(() => {
      const tr = cardEd.state.tr.insertText("Z", endOfText, endOfText);
      tr.setSelection(TextSelection.create(tr.doc, expectedCaret));
      cardEd.view.dispatch(tr);
    });

    // The write-back reached main (sanity: the example now carries the char).
    const a = findExampleBlock(editor, EX_A)!;
    expect(a.node.textContent).toContain("Alpha body.Z");

    // THE INVARIANT: the card's own write-back did NOT trigger a spurious
    // echo re-seed `setContent` — the caret survives exactly where typing left
    // it (right after the "Z", a non-zero end-of-text position), the card still
    // shows the typed text, and the embedded editor is the same instance (no
    // remount). A regressed echo guard re-seeds mid-typing and yanks the caret.
    expect(cardEd.state.selection.from).toBe(expectedCaret);
    expect(cardEd.state.selection.from).toBeGreaterThan(1);
    expect(cardEd.getText()).toContain("Alpha body.Z");
    expect(embeddedEditors(container)[0]).toBe(cardEd);
    editor.destroy();
  });

  it("a foreign main edit re-seeds the card but PRESERVES the caret offset", () => {
    const editor = buildMainWith(twoExampleDoc(), /* editable */ true);
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCardsFor(editor, [infoFor(EX_A, "Alpha body.")]));
    });
    const [cardEd] = embeddedEditors(container);
    expect(cardEd).toBeTruthy();
    absorbBaseline(editor);

    // Park the card caret in the MIDDLE of "Alpha body." (after "Alp").
    const midCaret = 4;
    act(() => {
      cardEd.view.dispatch(
        cardEd.state.tr.setSelection(TextSelection.create(cardEd.state.doc, midCaret)),
      );
    });
    expect(cardEd.state.selection.from).toBe(midCaret);
    const docBefore = cardEd.state.doc;

    // A FOREIGN main edit to example A's interior — bumps `contentRev` for A,
    // so the re-seed effect genuinely fires (`getJSON() !== nextJson`) and
    // pushes the updated block into the card via `setContent`.
    const a = findExampleBlock(editor, EX_A)!;
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText("Q", a.pos + a.node.nodeSize - 2));
    });

    // The card re-seeded (its doc was rebuilt + now shows the foreign edit) …
    expect(cardEd.state.doc).not.toBe(docBefore); // a real re-seed fired
    expect(cardEd.getText()).toContain("Alpha body.Q");
    // … but the caret was RESTORED to its original mid-text offset rather than
    // collapsing to the rebuilt doc's start. This pins the `setTextSelection`
    // restore around the re-seed `setContent`.
    expect(cardEd.state.selection.from).toBe(midCaret);
    editor.destroy();
  });
});
