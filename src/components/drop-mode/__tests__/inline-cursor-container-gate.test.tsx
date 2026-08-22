// @vitest-environment jsdom
//
// Task 414 — the drop-mode INLINE-CURSOR family asks the container question, in
// the AFFORDANCE and at every splice.
//
// THE BUG THIS PINS (silent structural corruption of the user's `.tex`, one
// drag, no warning). The markless verbatim blocks (`codeBlock`, `latexComment`)
// declare `content: "text*"` — literal text, no inline nodes. Splicing anything
// else at an offset inside one TRUNCATES the block there and EJECTS its tail
// into a fresh top-level paragraph. Measured against the real
// `buildEditorExtensions("main")` stack, dropping a citation into
// `% todo| fix later`:
//
//     latexComment("% todo") + paragraph[citation, " fix later"]
//     .tex:  % % todo %!v:m1
//            \vcid{x}\cite{a} fix later
//
// i.e. **a line the user had commented OUT becomes live printed prose.** Nothing
// throws, the doc is schema-valid, the save writes it through.
//
// `posHostsInlineAtom` (task 150) has answered this question since before any of
// it; task 396 wired every CREATE door to it and scoped this family out as a
// stated residual. Seven splice sites reached `makeInlineCursorPlacement`
// positions with no schema question asked at all:
//   • CREATE — `insertNewAtom` ("anchor the unanchored": a footnote/citation
//     card dragged out of its panel);
//   • CREATE-BY-COPY — stack-pull's inline-cursor `tr.replace`;
//   • MOVE — `moveInlineAtomWithin` (all four atom kinds, via the in-text grab),
//     the cross-editor atom insert, and `text-range-move`'s two slice splices.
//
// The cross-editor MOVE is the worst of the set, and the reason is worth
// keeping: `insertLanded` (task 332) measures a growth FLOOR, and this
// corruption GROWS the document — the ejected tail inflates it — so the net
// FALSE-PASSES and the unconditional source delete fires, taking a footnote's
// `content` body, which lives nowhere else. **A net whose measure is a growth
// floor cannot see a corruption that grows the document.**
//
// WHAT IS PROVEN, driving the REAL stack (real schema, real specs, real
// hit-test, real serializer; only `@/lib/storage` is stubbed, per the
// extension-barrel gotcha):
//   1. AFFORDANCE — `hitTest` paints NO caret inside `codeBlock` /
//      `latexComment` for an atom payload, and still paints one in prose and in
//      an `inline*` `titleField` (the controls that keep this from being "refuse
//      everything").
//   2. COMMIT, per site — create / move-within / move-across / stack-pull /
//      text-range-move each refuse, leaving the document byte-identical in the
//      SERIALIZED `.tex`, which is the only place the `% todo` → live-line
//      promotion is visible.
//   3. The cross-editor move's SOURCE survives — atom and footnote body — where
//      the growth-floor net alone passes the corrupted insert (asserted
//      directly, so the leg names the reason rather than the symptom).
//   4. The BLOCK reading: an open multi-paragraph slice tears a `codeBlock`
//      exactly as an atom does and is refused, while the same slice still
//      SPLITS ordinary prose — which is what the user asked for, and what a
//      naive "reuse posHostsInlineAtom for everything" gate would have killed.
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

import { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { hitTest } from "../hit-test";
import { registerDropTarget } from "../target-registry";
import { resolveSessionInlinePayload } from "../inline-host";
import { resolveSessionPlacements } from "../placement-policy";
import { inTextAtomGrabSpec } from "../specs/in-text-atom-grab";
import { textRangeMoveDropSpec } from "../specs/text-range-move";
import { stackPullDropSpec } from "../specs/stack-pull";
import { footnoteDropSpec } from "@/panels/Footnotes/drop-spec";
import {
  stashInlineAtomSource,
  clearInlineAtomSource,
} from "../util/inline-atom-source";
import type { DropCtx, DropSpec, Placement } from "../types";
import {
  STACK_PULL_PREFIX,
  STACK_STORAGE_KEY,
  type StackItem,
  type StackPayload,
} from "@/lib/stack/types";

// ---------------------------------------------------------------------------
// The real editor stack
// ---------------------------------------------------------------------------

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
  } as unknown as EditorExtensionsCtx;
}

/**
 * The four containers this class turns on: an `inline*` title and ordinary prose
 * (which must KEEP their caret), and the two MARKLESS `text*` verbatim blocks.
 * The `latexComment` carries a REAL commented line so the promotion the gate
 * prevents shows up in the serialized bytes, not just in the node tree.
 */
function mountFixture(): Editor {
  const element = document.createElement("div");
  element.classList.add("ProseMirror");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "titleField",
          attrs: { field: "title", uuid: "title-A" },
          content: [{ type: "text", text: "My Paper Title" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
        {
          type: "codeBlock",
          attrs: { uuid: "code-A" },
          content: [{ type: "text", text: "hello world" }],
        },
        {
          type: "latexComment",
          attrs: { uuid: "cmt-A" },
          content: [{ type: "text", text: "% todo fix later" }],
        },
      ],
    },
  });
}

/** A position `offset` characters into the first block named `nodeName`. */
function posInside(editor: Editor, nodeName: string, offset: number): number {
  let pos = -1;
  editor.state.doc.descendants((node: PMNode, at: number) => {
    if (pos >= 0 || node.type.name !== nodeName) return pos < 0;
    pos = at + 1 + Math.min(offset, node.content.size);
    return false;
  });
  if (pos < 0) throw new Error(`no ${nodeName} mounted`);
  return pos;
}

/** A MID-content position inside the first block named `nodeName`. */
function midOf(editor: Editor, nodeName: string): number {
  let pos = -1;
  editor.state.doc.descendants((node: PMNode, at: number) => {
    if (pos >= 0 || node.type.name !== nodeName) return pos < 0;
    pos = at + 1 + Math.floor(node.content.size / 2);
    return false;
  });
  if (pos < 0) throw new Error(`no ${nodeName} mounted`);
  return pos;
}

/** The document as the save path would write it — the only surface on which the
 *  `% todo` → live-line promotion is visible. */
const tex = (editor: Editor): string =>
  serializeBodyOnly(editor.state.doc.toJSON() as never);

// ---------------------------------------------------------------------------
// Hit-test geometry: stub the three view reads jsdom cannot answer, so the REAL
// hit-test pipeline runs against the REAL document.
// ---------------------------------------------------------------------------

const BLOCK_TOP = 100;
const BLOCK_BOTTOM = 120;
const IN_TEXT_Y = 110;
const CURSOR_X = 150;

function domRect(): DOMRect {
  const box = {
    top: BLOCK_TOP, bottom: BLOCK_BOTTOM, left: 64, right: 364,
    width: 300, height: BLOCK_BOTTOM - BLOCK_TOP, x: 64, y: BLOCK_TOP,
  };
  return { ...box, toJSON: () => box } as DOMRect;
}

let unregister: Array<() => void> = [];

/** Point the editor's geometry at `pos` and register it as a drop target. */
function aimAt(editor: Editor, pos: number): void {
  const blockEl = document.createElement("p");
  blockEl.getBoundingClientRect = domRect;
  editor.view.dom.appendChild(blockEl);
  const view = editor.view as unknown as Record<string, unknown>;
  view.posAtCoords = () => ({ pos, inside: 0 });
  view.coordsAtPos = () => ({
    left: 120, right: 121, top: BLOCK_TOP, bottom: BLOCK_BOTTOM,
  });
  view.nodeDOM = () => blockEl;
  document.elementsFromPoint = () => [editor.view.dom];
  unregister.push(registerDropTarget(editor));
}

function ctxFor(editor: Editor): DropCtx {
  return {
    mainEditor: editor,
    closePopout: () => {},
    confirm: async () => true,
    atomCards: {
      footnote: {
        atomAttrsFor: (id: string) => ({
          footnoteId: id,
          content: { type: "doc", content: [] },
        }),
        onAnchored: () => {},
      },
    },
  } as unknown as DropCtx;
}

/** Drive the REAL hit-test exactly as the controller does: both session-scoped
 *  resolutions taken once, then the per-move test. */
function hit(editor: Editor, spec: DropSpec, key: string): Placement | null {
  const ctx = ctxFor(editor);
  return hitTest(
    CURSOR_X,
    IN_TEXT_Y,
    spec,
    resolveSessionPlacements(spec, key),
    key,
    editor,
    resolveSessionInlinePayload(spec, key, ctx),
  );
}

/** An inline-cursor placement built by hand, so the COMMIT doors can be driven
 *  at a position the affordance would refuse to offer. */
const caretAt = (editor: Editor, pos: number): Placement => ({
  kind: "inline-cursor",
  editor,
  pos,
  rect: { x: 0, y: 0, width: 2, height: 20 },
});

let editors: Editor[] = [];
function mount(): Editor {
  const e = mountFixture();
  editors.push(e);
  return e;
}

beforeEach(() => {
  editors = [];
  unregister = [];
  localStorage.clear();
  clearInlineAtomSource();
  document.body.innerHTML = "";
});

afterEach(() => {
  for (const off of unregister) off();
  unregister = [];
  for (const e of editors) e.destroy();
  editors = [];
});

// ===========================================================================
// 1. THE AFFORDANCE
// ===========================================================================

describe("the hover offers no caret a verbatim block cannot hold", () => {
  const FOOTNOTE_KEY = "footnote:fn-1";

  it.each(["codeBlock", "latexComment"])(
    "a footnote drag over %s paints nothing",
    (nodeName) => {
      const editor = mount();
      aimAt(editor, midOf(editor, nodeName));
      expect(hit(editor, footnoteDropSpec, FOOTNOTE_KEY)).toBeNull();
    },
  );

  it.each(["paragraph", "titleField"])(
    "CONTROL — the same drag over %s still paints an inline caret",
    (nodeName) => {
      const editor = mount();
      aimAt(editor, midOf(editor, nodeName));
      const placement = hit(editor, footnoteDropSpec, FOOTNOTE_KEY);
      expect(placement?.kind).toBe("inline-cursor");
    },
  );

  it("the payload is resolved from the SPEC, not guessed — an unknown key offers text-only", () => {
    // A spec's `inlinePayloadFor` is what makes the question answerable at all;
    // a session that resolves nothing refuses nothing (the drop is already a
    // no-op), which is the fail-OPEN direction stated in `inline-host.ts`.
    const editor = mount();
    const ctx = ctxFor(editor);
    expect(
      resolveSessionInlinePayload(footnoteDropSpec, FOOTNOTE_KEY, ctx),
    ).toEqual(["footnote"]);
    expect(
      resolveSessionInlinePayload(inTextAtomGrabSpec, "atom-grab:nope", ctx),
    ).toEqual([]);
  });
});

// ===========================================================================
// 2. THE COMMIT — one leg per splice site
// ===========================================================================

describe("every inline splice refuses rather than tear the block", () => {
  it("CREATE ('anchor the unanchored') — the doc is byte-identical", () => {
    const editor = mount();
    const before = tex(editor);
    const placement = caretAt(editor, midOf(editor, "latexComment"));
    const ctx = ctxFor(editor);

    expect(footnoteDropSpec.classifyDrop(placement, "footnote:fn-1", ctx)).toEqual({
      kind: "no-op",
    });
    footnoteDropSpec.applyDrop(placement, "footnote:fn-1", ctx);
    expect(tex(editor)).toBe(before);
    // The promotion this prevents, named in the bytes it would have produced.
    expect(tex(editor)).toContain("% % todo fix later");
  });

  it("CONTROL — the same CREATE in prose lands", () => {
    const editor = mount();
    const placement = caretAt(editor, midOf(editor, "paragraph"));
    const ctx = ctxFor(editor);
    expect(footnoteDropSpec.classifyDrop(placement, "footnote:fn-1", ctx)).toEqual({
      kind: "apply",
    });
    footnoteDropSpec.applyDrop(placement, "footnote:fn-1", ctx);
    expect(tex(editor)).toContain("\\footnote{");
  });

  it("MOVE-WITHIN (the in-text atom grab) — the atom stays where it was", () => {
    const editor = mount();
    // Put a real citation atom into the prose paragraph first.
    const atom = editor.schema.nodes.citation.create({
      citationId: "c-1",
      command: "\\cite{smith}",
    });
    const at = midOf(editor, "paragraph");
    editor.view.dispatch(editor.state.tr.insert(at, atom));
    const before = tex(editor);

    stashInlineAtomSource({
      token: "tok",
      kind: "citation",
      nodeName: "citation",
      editor,
      pos: at,
    });
    const placement = caretAt(editor, midOf(editor, "codeBlock"));
    const ctx = ctxFor(editor);
    expect(inTextAtomGrabSpec.classifyDrop(placement, "atom-grab:tok", ctx)).toEqual({
      kind: "no-op",
    });
    inTextAtomGrabSpec.applyDrop(placement, "atom-grab:tok", ctx);
    expect(tex(editor)).toBe(before);
  });

  it("MOVE-ACROSS — the SOURCE atom and its footnote BODY survive the refusal", () => {
    // The load-bearing leg. Pre-414 the corrupted insert PASSED `insertLanded`
    // (its growth floor is 1 and the ejected tail made the growth 3), so the
    // unconditional source delete fired and the footnote's `content` attr — its
    // body, which lives nowhere else — went with it.
    const source = mount();
    const target = mount();
    const body = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "the note body" }] }],
    };
    const fn = source.schema.nodes.footnote.create({ footnoteId: "fn-9", content: body });
    source.view.dispatch(source.state.tr.insert(midOf(source, "paragraph"), fn));
    const sourceBefore = tex(source);
    const targetBefore = tex(target);

    const placement = caretAt(target, midOf(target, "latexComment"));
    const ctx = { ...ctxFor(source), mainEditor: source } as DropCtx;
    expect(footnoteDropSpec.classifyDrop(placement, "footnote:fn-9", ctx)).toEqual({
      kind: "no-op",
    });
    footnoteDropSpec.applyDrop(placement, "footnote:fn-9", ctx);

    expect(tex(source)).toBe(sourceBefore);
    expect(tex(source)).toContain("the note body");
    expect(tex(target)).toBe(targetBefore);
  });

  it("the growth FLOOR alone would have passed it — which is why the gate is the answer", () => {
    // Asserted directly rather than left as prose: `insertLanded`'s measure
    // cannot see a corruption that GROWS the document.
    const editor = mount();
    const atom = editor.schema.nodes.citation.create({
      citationId: "c-2",
      command: "\\cite{a}",
    });
    const at = posInside(editor, "latexComment", "% todo".length);
    const tr = editor.state.tr.insert(at, atom);
    expect(tr.steps.length).toBe(1);
    expect(tr.doc.content.size - editor.state.doc.content.size).toBeGreaterThan(
      atom.nodeSize,
    );
    // …and the corruption it hides, in the bytes.
    const bytes = serializeBodyOnly(tr.doc.toJSON() as never);
    expect(bytes).toContain("\\cite{a} fix later");
    expect(bytes).not.toContain("% % todo fix later");
  });

  it("STACK-PULL of a slice carrying an atom — refused, doc byte-identical", () => {
    const editor = mount();
    aimAt(editor, midOf(editor, "latexComment"));
    const before = tex(editor);
    const key = `${STACK_PULL_PREFIX}:item-1`;
    seedStack(
      {
      kind: "text",
      plain: "cited",
      slice: {
        content: [
          { type: "text", text: "cited " },
          { type: "citation", attrs: { citationId: "c-3", command: "\\cite{b}" } },
        ],
        openStart: 0,
        openEnd: 0,
      },
      } as unknown as StackPayload,
      key,
    );

    // The affordance refuses first…
    expect(hit(editor, stackPullDropSpec, key)).toBeNull();
    // …and so does the commit, driven at a placement the hover never offered.
    const placement = caretAt(editor, midOf(editor, "latexComment"));
    const ctx = ctxFor(editor);
    expect(stackPullDropSpec.classifyDrop(placement, key, ctx)).toEqual({ kind: "no-op" });
    stackPullDropSpec.applyDrop(placement, key, ctx);
    expect(tex(editor)).toBe(before);
  });

  it("CONTROL — a PLAIN-TEXT stack slice still pulls into a code block", () => {
    // The precision of the gate: `text*` hosts text, so refusing here would be a
    // false refusal — the failure mode task 396's own first cut had.
    const editor = mount();
    aimAt(editor, midOf(editor, "codeBlock"));
    const key = `${STACK_PULL_PREFIX}:item-2`;
    seedStack(
      {
        kind: "text",
        plain: "XX",
        slice: { content: [{ type: "text", text: "XX" }], openStart: 0, openEnd: 0 },
      } as unknown as StackPayload,
      key,
    );
    expect(hit(editor, stackPullDropSpec, key)?.kind).toBe("inline-cursor");
    const placement = caretAt(editor, midOf(editor, "codeBlock"));
    const ctx = ctxFor(editor);
    expect(stackPullDropSpec.classifyDrop(placement, key, ctx)).toEqual({ kind: "apply" });
    stackPullDropSpec.applyDrop(placement, key, ctx);
    expect(tex(editor)).toContain("XX");
  });

  it("TEXT-RANGE MOVE — a marked run CARRYING AN ATOM leaves both ends alone", () => {
    const editor = mount();
    const anchorId = "range-1";
    // The run has to carry something a `text*` block cannot hold, or the gate is
    // right to allow it: plain text IS hostable in a code block, and refusing
    // there would be the false refusal this gate is scoped to avoid.
    const cite = editor.schema.nodes.citation.create({
      citationId: "c-4",
      command: "\\cite{c}",
    });
    const from = posInside(editor, "paragraph", 5);
    editor.view.dispatch(editor.state.tr.insert(from, cite));
    const mark = editor.schema.marks.linkedAnchor;
    expect(mark, "linkedAnchor mark not registered").toBeTruthy();
    editor.view.dispatch(
      editor.state.tr.addMark(
        from - 2,
        from + cite.nodeSize + 2,
        mark.create({ anchorId, kind: "linkedRange" }),
      ),
    );
    const before = tex(editor);
    const key = `textobject:linkedRange:${anchorId}`;
    const placement = caretAt(editor, midOf(editor, "codeBlock"));
    const ctx = ctxFor(editor);
    expect(textRangeMoveDropSpec.classifyDrop(placement, key, ctx)).toEqual({
      kind: "no-op",
    });
    textRangeMoveDropSpec.applyDrop(placement, key, ctx);
    expect(tex(editor)).toBe(before);
  });
});

// ===========================================================================
// 3. THE BLOCK READING
// ===========================================================================

describe("an open multi-block slice is refused by a text-only block and splits prose", () => {
  function multiBlockSlice(editor: Editor): Slice {
    const p = editor.schema.nodes.paragraph;
    return new Slice(
      Fragment.from([
        p.create(null, editor.schema.text("AAA")),
        p.create(null, editor.schema.text("BBB")),
      ]),
      1,
      1,
    );
  }

  it("MEASURED: it tears a codeBlock exactly as an atom does", () => {
    const editor = mount();
    const at = midOf(editor, "codeBlock");
    const tr = editor.state.tr.replace(at, at, multiBlockSlice(editor));
    const code = tr.doc.content.content.find((n) => n.type.name === "codeBlock");
    // TRUNCATED at the offset…
    expect(code?.textContent).not.toBe("hello world");
    // …with its tail EJECTED into a paragraph beside it.
    expect(
      tr.doc.content.content.some(
        (n) => n.type.name === "paragraph" && n.textContent.includes("world"),
      ),
    ).toBe(true);
  });

  it("CONTROL: the same slice legitimately SPLITS a paragraph", () => {
    // Which is why the block reading may not be `posHostsInlineAtom` — that
    // would refuse this working drop.
    const editor = mount();
    const at = midOf(editor, "paragraph");
    const tr = editor.state.tr.replace(at, at, multiBlockSlice(editor));
    expect(tr.doc.textContent).toContain("AAA");
    expect(tr.doc.textContent).toContain("BBB");
  });

  it("the stack-pull door refuses it in a code block and accepts it in prose", () => {
    const key = `${STACK_PULL_PREFIX}:item-3`;
    const payload = {
      kind: "text",
      plain: "AAA BBB",
      slice: {
        content: [
          { type: "paragraph", content: [{ type: "text", text: "AAA" }] },
          { type: "paragraph", content: [{ type: "text", text: "BBB" }] },
        ],
        openStart: 1,
        openEnd: 1,
      },
    } as unknown as StackPayload;

    const refused = mount();
    seedStack(payload, key);
    const beforeRefused = tex(refused);
    const ctxA = ctxFor(refused);
    const inCode = caretAt(refused, midOf(refused, "codeBlock"));
    expect(stackPullDropSpec.classifyDrop(inCode, key, ctxA)).toEqual({ kind: "no-op" });
    stackPullDropSpec.applyDrop(inCode, key, ctxA);
    expect(tex(refused)).toBe(beforeRefused);

    const accepted = mount();
    const ctxB = ctxFor(accepted);
    const inProse = caretAt(accepted, midOf(accepted, "paragraph"));
    expect(stackPullDropSpec.classifyDrop(inProse, key, ctxB)).toEqual({ kind: "apply" });
    stackPullDropSpec.applyDrop(inProse, key, ctxB);
    expect(tex(accepted)).toContain("AAA");
  });
});

// ---------------------------------------------------------------------------

function seedStack(payload: StackPayload, key = `${STACK_PULL_PREFIX}:item-1`) {
  const id = key.slice(key.indexOf(":") + 1);
  const item: StackItem = {
    id,
    capturedAt: "2026-08-22T00:00:00.000Z",
    source: { docId: null },
    payload,
  };
  const raw = localStorage.getItem(STACK_STORAGE_KEY);
  const prev = raw ? (JSON.parse(raw) as { items: StackItem[] }).items : [];
  localStorage.setItem(
    STACK_STORAGE_KEY,
    JSON.stringify({ version: 1, items: [...prev.filter((i) => i.id !== id), item] }),
  );
}
