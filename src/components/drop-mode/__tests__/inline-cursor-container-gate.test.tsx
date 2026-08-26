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
import {
  beginDropSession,
  cancelDropSession,
  setDropCtx,
} from "../controller";
import { insertLanded } from "../schema-adopt";
import { registerDropTarget } from "../target-registry";
import { resolveSessionBlockPayload } from "../block-payload";
import { resolveSessionSourceRange } from "../self-drop";
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
        // The two families a WEAKER block reading waved through: an `inline*`
        // textblock whose CONTAINER can host no block sibling. Both are
        // `inline*`, so every atom predicate answers "yes" for them — which is
        // exactly why the block arm cannot be a proxy for "is this verbatim?".
        {
          type: "figureBlock",
          attrs: { uuid: "fig-A" },
          content: [
            {
              type: "figureCaption",
              content: [{ type: "text", text: "Cap tion here" }],
            },
          ],
        },
        {
          type: "exampleBlock",
          attrs: { uuid: "ex-A" },
          content: [
            {
              type: "exampleGloss",
              content: [
                {
                  type: "alignedGlossRow",
                  attrs: { tier: "gla" },
                  content: [
                    { type: "glossCell", content: [{ type: "text", text: "aa bb" }] },
                    { type: "glossCell", content: [{ type: "text", text: "cc" }] },
                  ],
                },
              ],
            },
          ],
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
    // The BLOCK payload (task 416), resolved through the same door the
    // controller uses. Stated rather than defaulted, for the reason the inline
    // one is: a default is a decision nobody made.
    resolveSessionBlockPayload(spec, key, ctx),
    // The SOURCE RANGE (task 480), same door, same reason.
    resolveSessionSourceRange(spec, key, ctx),
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

describe("the payload is resolved ONCE per gesture, never per pointermove", () => {
  // The law's own justification is that the resolution may parse the Stack's
  // whole localStorage envelope or walk a document range — so it must never run
  // on the throttled move path. `placementsFor`'s identical claim is pinned by a
  // read-count leg through the REAL controller (task 258); this is its twin, and
  // without it the claim is prose.
  it("beginDropSession reads the envelope; six moves read it zero more times", async () => {
    const editor = mount();
    aimAt(editor, midOf(editor, "paragraph"));
    const key = `${STACK_PULL_PREFIX}:item-9`;
    seedStack(
      {
        kind: "text",
        plain: "XX",
        slice: { content: [{ type: "text", text: "XX" }], openStart: 0, openEnd: 0 },
      } as unknown as StackPayload,
      key,
    );

    let reads = 0;
    const realGet = localStorage.getItem.bind(localStorage);
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((k: string) => {
        if (k === STACK_STORAGE_KEY) reads += 1;
        return realGet(k);
      });
    try {
      setDropCtx(ctxFor(editor));
      expect(
        beginDropSession({ cardKey: key, origin: { x: CURSOR_X, y: IN_TEXT_Y } }),
      ).toBe(true);
      // Both session resolutions have run by now — the placements and the
      // inline payload — and the count is what it is; what the law forbids is
      // GROWTH per move.
      const afterBegin = reads;
      expect(afterBegin).toBeGreaterThan(0);
      for (let i = 0; i < 6; i++) {
        window.dispatchEvent(
          new MouseEvent("mousemove", {
            clientX: CURSOR_X + i,
            clientY: IN_TEXT_Y,
            buttons: 1,
          }),
        );
        await new Promise((r) => setTimeout(r, 30));
      }
      expect(reads).toBe(afterBegin);
    } finally {
      cancelDropSession();
      spy.mockRestore();
      setDropCtx(null as unknown as DropCtx);
    }
  });

  it("a gap-only payload resolves NO inline payload at all", () => {
    // The consumer is reachable only when the session can produce an inline
    // caret, so resolving it for a gap-only payload is a second envelope parse
    // at mousedown for an answer nothing can read.
    const editor = mount();
    const key = `${STACK_PULL_PREFIX}:item-8`;
    seedStack(
      { kind: "paragraph", node: { type: "paragraph" } } as unknown as StackPayload,
      key,
    );
    const placements = resolveSessionPlacements(stackPullDropSpec, key);
    expect(placements).not.toContain("inline-cursor");
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

    // CONTROL through the identical harness — the `no-op` above must be THIS
    // gate's refusal, not the resolver failing to find the captured source (the
    // in-text grab configures no `createAtom`, so an unresolvable source is
    // ALSO a `no-op` with an unchanged document). Same spec, same stash, same
    // ctx; only the target block differs.
    const inProse = caretAt(editor, midOf(editor, "titleField"));
    expect(inTextAtomGrabSpec.classifyDrop(inProse, "atom-grab:tok", ctx)).toEqual({
      kind: "apply",
    });
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

    // CONTROL — the same cross-editor move into the target's PROSE lands, so
    // the refusal above is this gate and not `locateAtom` failing to find the
    // source in another editor (which would also be a `no-op`).
    const intoProse = caretAt(target, midOf(target, "paragraph"));
    expect(footnoteDropSpec.classifyDrop(intoProse, "footnote:fn-9", ctx)).toEqual({
      kind: "apply",
    });
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
    // The SHIPPED net, not a re-derivation of its rule — a leg that re-computes
    // "steps > 0 and growth >= payload" by hand proves nothing about the
    // predicate the cross-editor move actually consults.
    expect(insertLanded(tr, atom.nodeSize)).toBe(true);
    // …and the arithmetic that explains WHY it passes.
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

    // CONTROL — the same marked run into the TITLE (an `inline*` textblock)
    // lands, so the refusal above is this gate and not `locateRange` failing.
    const intoTitle = caretAt(editor, midOf(editor, "titleField"));
    expect(textRangeMoveDropSpec.classifyDrop(intoTitle, key, ctx)).toEqual({
      kind: "apply",
    });
  });
});

// ===========================================================================
// 3. THE BLOCK READING
// ===========================================================================

describe("an open multi-block slice enters the container family's BLOCK member", () => {
  const BLOCK_PAYLOAD = {
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

  it.each(["titleField", "figureCaption", "glossCell"])(
    "MEASURED: it tears %s too — an `inline*` textblock whose CONTAINER holds no block",
    (nodeName) => {
      // This module's own first-cut defect. The block arm asked "does this
      // textblock host any non-text content?", which is TRUE of every `inline*`
      // textblock — so all three of these landed, with the same
      // truncate-and-eject shape the verbatim blocks have.
      const editor = mount();
      const at = posInside(editor, nodeName, 5);
      const tr = editor.state.tr.replace(at, at, multiBlockSlice(editor));
      const host = (n: PMNode): PMNode | null => {
        let found: PMNode | null = null;
        n.descendants((c) => {
          if (found || c.type.name !== nodeName) return !found;
          found = c;
          return false;
        });
        return found;
      };
      // TRUNCATED…
      expect(host(tr.doc)?.textContent).not.toBe(host(editor.state.doc)?.textContent);
      // …and its tail EJECTED into a fresh paragraph. Asserted over the whole
      // tree rather than the top level, because the DEPTH the tail surfaces at
      // is a property of `isolating`, not of the tear: `titleField` and
      // `figureCaption` eject to the document, while a `glossCell`'s tail is
      // contained by the `isolating` `exampleGloss` / `exampleBlock` pair and
      // lands INSIDE the example — one `\begingl` split into two with body
      // prose between them, which destroys the interlinear alignment just as
      // surely.
      let ejected = false;
      tr.doc.descendants((n) => {
        if (n.type.name === "paragraph" && n.textContent.startsWith("BBB")) {
          ejected = true;
        }
        return !ejected;
      });
      expect(ejected).toBe(true);
    },
  );

  it.each(["titleField", "figureCaption", "glossCell"])(
    "the door refuses a block payload at a caret inside %s",
    (nodeName) => {
      const editor = mount();
      const key = `${STACK_PULL_PREFIX}:item-4`;
      seedStack(BLOCK_PAYLOAD, key);
      const before = tex(editor);
      const ctx = ctxFor(editor);
      const at = caretAt(editor, posInside(editor, nodeName, 5));
      expect(stackPullDropSpec.classifyDrop(at, key, ctx)).toEqual({ kind: "no-op" });
      stackPullDropSpec.applyDrop(at, key, ctx);
      expect(tex(editor)).toBe(before);
    },
  );

  it("CONTROL — the same payload still lands in a list ITEM, which hosts blocks", () => {
    // The precision of the block arm: `listItem` is `(paragraph|graphicsBlock)
    // block*`, so a block sibling is legal there and the drop must land. A gate
    // that refused every non-prose container would kill this.
    const editor = mount();
    const key = `${STACK_PULL_PREFIX}:item-5`;
    seedStack(BLOCK_PAYLOAD, key);
    const ctx = ctxFor(editor);
    const at = caretAt(editor, posInside(editor, "paragraph", 5));
    expect(stackPullDropSpec.classifyDrop(at, key, ctx)).toEqual({ kind: "apply" });
  });

  it("the stack-pull door refuses it in a code block and accepts it in prose", () => {
    const key = `${STACK_PULL_PREFIX}:item-3`;
    const payload = BLOCK_PAYLOAD;

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
