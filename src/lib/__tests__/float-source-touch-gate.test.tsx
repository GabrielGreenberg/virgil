// @vitest-environment jsdom
//
// Float source-touch gate — task 140's contract.
//
// THE CLASS BUG: `useMainTransactionSync` subscribed to the MAIN editor's
// transactions and bailed only on (a) its own write-back meta and (b)
// `!docChanged`. A plain main-editor keystroke passes both, so it called
// `onMainDocChanged()` → `readSource(mainDoc)` — and EVERY float body's
// `readSource` walks the whole document (`doc.descendants` / `doc.forEach`).
// Net effect: with any text-object float popped out, each character typed
// anywhere in the main editor cost a full-document scan, once PER OPEN FLOAT.
//
// The AGENTS.md keystroke-sanctity allowlist listed `float-sync.tsx` as
// "docChanged-gated + own-write meta filter — O(1) per tx", which described the
// SUBSCRIBER's gate and not the O(doc) callback behind it; the grep guardrail
// can only see the `editor.on(...)` call form, so CI stayed green while the law
// was violated. This test is the missing half: it counts `readSource` calls on
// the real hook, against a real main editor.
//
// THE FIX: a float reports its source's `range`, and the shared subscriber maps
// that range forward through each transaction's step maps while asking whether
// any step intersected it — one O(steps) pass. Non-touching transactions never
// reach `readSource`. The same live range then rides back in as a position hint
// so the touching read resolves its node in O(depth) too.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
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

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  FLOAT_WRITE_META,
  useFloatMainSync,
  type SourceRange,
} from "@/lib/float-sync";
import {
  findSourceNodeByUuid,
  trackSourceRange,
} from "@/lib/float-source-range";
import { getSectionRangeByUuid } from "@/lib/section-range";

// ── Harness ────────────────────────────────────────────────────────────────

function ctx(surface: "main" | "float"): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    editable: true,
    cardContext: surface === "float",
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const editors: Editor[] = [];

function mount(content: JSONContent, surface: "main" | "float" = "main"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx(surface)),
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

function para(uuid: string, text: string): JSONContent {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: [{ type: "text", text }],
  };
}

/** A main doc of `n` uuid-bearing paragraphs, `p1`…`pn`. */
function mainDoc(n: number): JSONContent {
  return {
    type: "doc",
    content: Array.from({ length: n }, (_, i) => para(`p${i + 1}`, `body ${i + 1}`)),
  };
}

/** Position just inside the paragraph carrying `uuid`. */
function insideBlock(editor: Editor, uuid: string): number {
  const src = findSourceNodeByUuid(editor.state.doc, uuid, [
    "paragraph",
    "heading",
  ]);
  if (!src) throw new Error(`no block ${uuid}`);
  return src.start + 1;
}

/** Type one character at `pos` in main, the way a keystroke would. */
function typeAt(editor: Editor, pos: number, ch = "x") {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(ch, pos));
  });
}

/**
 * Mount the REAL `useFloatMainSync` against a real main editor + a real float
 * editor, wrapping the body's `readSource` in a call counter. Returns the
 * counter plus the hook result, so a test can assert "typing there ran the
 * O(doc) callback zero times".
 */
function mountParagraphFloat(main: Editor, uuid: string) {
  const float = mount(
    { type: "doc", content: [para(uuid, "body")] },
    "float",
  );
  const calls = { n: 0 };
  const readSource = (doc: PMNode, hint: SourceRange | null) => {
    calls.n++;
    const src = findSourceNodeByUuid(doc, uuid, "paragraph", hint);
    if (!src) {
      return {
        doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
        missing: true,
      };
    }
    return {
      doc: {
        type: "doc",
        content: [src.node.toJSON() as JSONContent],
      } as JSONContent,
      missing: false,
      range: { from: src.start, to: src.end },
    };
  };
  const view = renderHook(() =>
    useFloatMainSync({
      mainEditor: main,
      floatEditor: float,
      floatId: `par:${uuid}`,
      readSource,
    }),
  );
  return { float, calls, view };
}

// ── The law ────────────────────────────────────────────────────────────────

describe("float source-touch gate — a foreign keystroke does no per-float work", () => {
  it("runs readSource ONCE on attach and never again for edits elsewhere", () => {
    const main = mount(mainDoc(6));
    const { calls } = mountParagraphFloat(main, "p3");

    // The attach seed is the one legitimate read.
    expect(calls.n).toBe(1);

    for (const uuid of ["p1", "p2", "p4", "p5", "p6"]) {
      typeAt(main, insideBlock(main, uuid));
    }

    // Five keystrokes in five other paragraphs: zero document walks.
    expect(calls.n).toBe(1);
  });

  it("N open floats cost N×0, not N×O(doc), for one foreign keystroke", () => {
    const main = mount(mainDoc(6));
    const a = mountParagraphFloat(main, "p2");
    const b = mountParagraphFloat(main, "p3");
    const c = mountParagraphFloat(main, "p4");
    const before = a.calls.n + b.calls.n + c.calls.n;

    typeAt(main, insideBlock(main, "p6"));

    expect(a.calls.n + b.calls.n + c.calls.n).toBe(before);
  });

  it("still mirrors an edit made IN the source paragraph", () => {
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "p3"), "Z");

    expect(calls.n).toBe(2);
    expect(float.state.doc.textContent).toBe("Zbody 3");
  });

  it("routes exactly one of N floats — the one whose source was typed in", () => {
    const main = mount(mainDoc(5));
    const a = mountParagraphFloat(main, "p2");
    const b = mountParagraphFloat(main, "p4");
    const [aBefore, bBefore] = [a.calls.n, b.calls.n];

    typeAt(main, insideBlock(main, "p4"));

    expect(a.calls.n).toBe(aBefore);
    expect(b.calls.n).toBe(bBefore + 1);
  });
});

describe("float source-touch gate — the tracked range stays honest", () => {
  it("maps the range through a skipped structural edit UPSTREAM", () => {
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");

    // Insert a whole paragraph at the very top. It doesn't touch p3, so the
    // gate skips it — but the tracked range MUST shift, or the next real edit
    // would be measured against a stale region.
    act(() => {
      main.view.dispatch(
        main.state.tr.insert(
          0,
          main.state.schema.nodeFromJSON(para("p0", "inserted")),
        ),
      );
    });
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "p3"), "Q");
    expect(calls.n).toBe(2);
    expect(float.state.doc.textContent).toBe("Qbody 3");
  });

  it("maps the range through a skipped DELETE upstream", () => {
    const main = mount(mainDoc(5));
    const { calls, float } = mountParagraphFloat(main, "p4");

    const p1 = findSourceNodeByUuid(main.state.doc, "p1", "paragraph")!;
    act(() => {
      main.view.dispatch(main.state.tr.delete(p1.start, p1.end));
    });
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "p4"), "Q");
    expect(calls.n).toBe(2);
    expect(float.state.doc.textContent).toBe("Qbody 4");
  });

  it("reports the source missing when it is deleted, then RECONNECTS on undo", () => {
    const main = mount(mainDoc(4));
    const { calls, view } = mountParagraphFloat(main, "p3");

    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;
    act(() => {
      main.view.dispatch(main.state.tr.delete(p3.start, p3.end));
    });
    expect(view.result.current.sourceMissing).toBe(true);
    const afterDelete = calls.n;

    // A missing source parks the range at null, which REOPENS the gate — the
    // float has no region to test against, so it must keep looking. This is
    // what lets an undo elsewhere in the doc bring it back.
    act(() => {
      main.commands.undo();
    });
    expect(calls.n).toBeGreaterThan(afterDelete);
    expect(view.result.current.sourceMissing).toBe(false);
  });

  it("skips its OWN write-back but still tracks the range through it", () => {
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");
    const seeded = calls.n;

    // Simulate the float→main write: a whole-node replace tagged with the
    // float's own meta. The gate must skip the echo…
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;
    act(() => {
      const tr = main.state.tr.replaceWith(
        p3.start,
        p3.end,
        main.state.schema.nodeFromJSON(para("p3", "rewritten from the float")),
      );
      tr.setMeta(FLOAT_WRITE_META, "par:p3");
      main.view.dispatch(tr);
    });
    expect(calls.n).toBe(seeded);

    // …and still have followed the source, which just changed size. A later
    // edit inside it resolves correctly.
    typeAt(main, insideBlock(main, "p3"), "Q");
    expect(calls.n).toBe(seeded + 1);
    expect(float.state.doc.textContent).toBe("Qrewritten from the float");
  });

  it("maps the range through an APPENDED transaction's steps", () => {
    // TipTap emits one `transaction` event per dispatch, carrying the root
    // transaction plus `appendedTransactions`. The latexComment normalizer is a
    // real appendTransaction plugin that REPLACES a "% …" paragraph with a
    // latexComment node — a size change that exists only in the appended tx. A
    // tracker that read the root transaction alone would leave every range
    // below it off by that delta, and the next edit in the source would be
    // measured against the wrong region and skipped.
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");

    typeAt(main, insideBlock(main, "p1"), "% ");
    // The normalizer must actually have fired, or this test proves nothing.
    expect(main.state.doc.firstChild?.type.name).toBe("latexComment");
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "p3"), "Q");
    expect(calls.n).toBe(2);
    expect(float.state.doc.textContent).toBe("Qbody 3");
  });

  // A step map describes how positions MOVE, so a step that moves nothing
  // (AddMark / RemoveMark / node-mark / Attr / DocAttr) contributes
  // StepMap.empty while its transaction is still docChanged. A gate reading
  // only the maps sees "nothing happened" — the float keeps showing unbolded
  // text, and its next keystroke writes that stale copy back over the source,
  // DELETING the mark from the document. These are the cases that class costs.

  it("fires for a MARK applied inside the source (empty step map)", () => {
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    act(() => {
      main.view.dispatch(
        main.state.tr.addMark(
          p3.start + 1,
          p3.end - 1,
          main.state.schema.marks.bold.create(),
        ),
      );
    });

    expect(calls.n).toBe(2);
    let bolded = false;
    float.state.doc.descendants((n) => {
      if (n.marks.some((m) => m.type.name === "bold")) bolded = true;
      return true;
    });
    expect(bolded).toBe(true);
  });

  it("does NOT fire for a mark applied to a different paragraph", () => {
    const main = mount(mainDoc(4));
    const { calls } = mountParagraphFloat(main, "p3");
    const p1 = findSourceNodeByUuid(main.state.doc, "p1", "paragraph")!;

    act(() => {
      main.view.dispatch(
        main.state.tr.addMark(
          p1.start + 1,
          p1.end - 1,
          main.state.schema.marks.bold.create(),
        ),
      );
    });

    expect(calls.n).toBe(1);
  });

  it("fires for an AttrStep on the source node (empty step map)", () => {
    const main = mount(mainDoc(4));
    const { calls } = mountParagraphFloat(main, "p3");
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    act(() => {
      main.view.dispatch(
        main.state.tr.setNodeAttribute(p3.start, "parTitle", "A title"),
      );
    });

    expect(calls.n).toBe(2);
  });

  it("re-reads when a PLUGIN reshaped our own write on top of it", () => {
    // The echo to ignore is the float's own write — not what the document's
    // plugins then did to it. Here the write-back turns the source into a
    // "% …" paragraph, and main's latexComment normalizer appends a
    // transaction replacing it with a latexComment node. Skipping on the
    // own-write meta alone would leave the float showing a paragraph that no
    // longer exists, with a range describing a node of the wrong size.
    const main = mount(mainDoc(4));
    const { calls, float } = mountParagraphFloat(main, "p3");
    const seeded = calls.n;

    act(() => {
      const tr = main.state.tr.insertText("% ", insideBlock(main, "p3"));
      tr.setMeta(FLOAT_WRITE_META, "par:p3");
      main.view.dispatch(tr);
    });

    expect(main.state.doc.child(2).type.name).toBe("latexComment");
    expect(calls.n).toBe(seeded + 1);
    // The source paragraph is gone, so the float reports it missing — which
    // parks the range at null and reopens the gate, instead of leaving a
    // phantom region behind for the next write-back to target.
    expect(float).toBeTruthy();
  });

  it("does no work for a selection-only transaction", () => {
    const main = mount(mainDoc(4));
    const { calls } = mountParagraphFloat(main, "p3");
    const seeded = calls.n;

    act(() => {
      main.commands.setTextSelection(insideBlock(main, "p1"));
    });

    expect(calls.n).toBe(seeded);
  });
});

// ── The primitive's boundary conventions ───────────────────────────────────

describe("trackSourceRange — node-range boundary conventions", () => {
  /** Build a real transaction against `main` and track `range` through it. */
  function track(
    main: Editor,
    range: SourceRange,
    build: (tr: import("@tiptap/pm/state").Transaction) => void,
  ) {
    const tr = main.state.tr;
    build(tr);
    return trackSourceRange(tr, range);
  }

  it("shifts the range when a sibling is inserted at `from`, without claiming it", () => {
    const main = mount(mainDoc(3));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;
    const inserted = main.state.schema.nodeFromJSON(para("pNew", "new"));

    const { mapped } = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.insert(p2.start, inserted),
    );

    // The mirrored node moved down by the whole inserted block and kept its
    // own extent — the new sibling is NOT part of the source.
    expect(mapped.from).toBe(p2.start + inserted.nodeSize);
    expect(mapped.to - mapped.from).toBe(p2.end - p2.start);
  });

  it("leaves `to` put when a sibling is inserted at the range's end", () => {
    const main = mount(mainDoc(3));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;
    const inserted = main.state.schema.nodeFromJSON(para("pNew", "new"));

    const { mapped } = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.insert(p2.end, inserted),
    );

    expect(mapped).toEqual({ from: p2.start, to: p2.end });
  });

  it("grows `to` for an insertion INSIDE the range", () => {
    const main = mount(mainDoc(3));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;

    const { touched, mapped } = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.insertText("abc", p2.start + 1),
    );

    expect(touched).toBe(true);
    expect(mapped).toEqual({ from: p2.start, to: p2.end + 3 });
  });

  it("does not flag a step that ends before the range starts", () => {
    const main = mount(mainDoc(3));
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    const { touched } = track(main, { from: p3.start, to: p3.end }, (tr) =>
      tr.insertText("abc", insideBlock(main, "p1")),
    );

    expect(touched).toBe(false);
  });

  it("flags a step whose StepMap is EMPTY but whose own range overlaps", () => {
    const main = mount(mainDoc(3));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;
    const p1 = findSourceNodeByUuid(main.state.doc, "p1", "paragraph")!;

    // AddMarkStep moves nothing, so its map contributes no ranges at all —
    // the map-only test that shipped first reported `touched: false` here.
    const inside = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.addMark(p2.start + 1, p2.end - 1, main.state.schema.marks.bold.create()),
    );
    expect(inside.touched).toBe(true);
    expect(inside.mapped).toEqual({ from: p2.start, to: p2.end });

    const elsewhere = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.addMark(p1.start + 1, p1.end - 1, main.state.schema.marks.bold.create()),
    );
    expect(elsewhere.touched).toBe(false);
  });

  it("flags an AttrStep on the range's own node and not on a distant one", () => {
    const main = mount(mainDoc(4));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;
    const p4 = findSourceNodeByUuid(main.state.doc, "p4", "paragraph")!;

    expect(
      track(main, { from: p2.start, to: p2.end }, (tr) =>
        tr.setNodeAttribute(p2.start, "parTitle", "x"),
      ).touched,
    ).toBe(true);

    // p4 is not adjacent. (p3 WOULD flag: its start IS p2's end, and boundary
    // touches count — same inclusive convention as the range test, so the cost
    // of an ambiguous edge is a wasted read, never a missed one.)
    expect(
      track(main, { from: p2.start, to: p2.end }, (tr) =>
        tr.setNodeAttribute(p4.start, "parTitle", "x"),
      ).touched,
    ).toBe(false);
  });

  it("keeps the range well-formed when a delete swallows it whole", () => {
    const main = mount(mainDoc(3));
    const p2 = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;

    const { touched, mapped } = track(main, { from: p2.start, to: p2.end }, (tr) =>
      tr.delete(0, main.state.doc.content.size),
    );

    expect(touched).toBe(true);
    expect(mapped.to).toBeGreaterThanOrEqual(mapped.from);
  });

  it("re-maps between steps of a MULTI-step transaction", () => {
    const main = mount(mainDoc(4));
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;
    const p1 = findSourceNodeByUuid(main.state.doc, "p1", "paragraph")!;

    // Step 1 deletes p1 (upstream, no touch); step 2 types into p3 at its
    // POST-STEP-1 position. A tracker that tested every step against the
    // original coordinates would miss the second one.
    const { touched, mapped } = track(main, { from: p3.start, to: p3.end }, (tr) => {
      tr.delete(p1.start, p1.end);
      tr.insertText("Q", p3.start + 1 - (p1.end - p1.start));
    });

    expect(touched).toBe(true);
    expect(mapped.from).toBe(p3.start - (p1.end - p1.start));
  });
});

// ── The hint fast-path ─────────────────────────────────────────────────────

describe("findSourceNodeByUuid — the hint is a shortcut, never an authority", () => {
  it("resolves from a correct hint", () => {
    const main = mount(mainDoc(4));
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    const hinted = findSourceNodeByUuid(main.state.doc, "p3", "paragraph", {
      from: p3.start,
      to: p3.end,
    });

    expect(hinted?.start).toBe(p3.start);
    expect(hinted?.node.attrs.uuid).toBe("p3");
  });

  it("falls back to the walk when the hint points at the WRONG node", () => {
    const main = mount(mainDoc(4));
    const p1 = findSourceNodeByUuid(main.state.doc, "p1", "paragraph")!;
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    const hinted = findSourceNodeByUuid(main.state.doc, "p3", "paragraph", {
      from: p1.start,
      to: p1.end,
    });

    expect(hinted?.start).toBe(p3.start);
  });

  it("falls back when the hint's extent no longer matches the node", () => {
    const main = mount(mainDoc(4));
    const p3 = findSourceNodeByUuid(main.state.doc, "p3", "paragraph")!;

    const hinted = findSourceNodeByUuid(main.state.doc, "p3", "paragraph", {
      from: p3.start,
      to: p3.end + 7,
    });

    expect(hinted?.start).toBe(p3.start);
    expect(hinted?.end).toBe(p3.end);
  });

  it("survives an out-of-document hint", () => {
    const main = mount(mainDoc(2));
    const huge = { from: 9999, to: 10_005 };

    expect(() =>
      findSourceNodeByUuid(main.state.doc, "p2", "paragraph", huge),
    ).not.toThrow();
    expect(
      findSourceNodeByUuid(main.state.doc, "p2", "paragraph", huge)?.node.attrs
        .uuid,
    ).toBe("p2");
  });

  it("reports the parent + index a nested body needs (listItem numbering)", () => {
    const main = mount({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: { uuid: "L1", start: 3 },
          content: [
            { type: "listItem", attrs: { uuid: "i1" }, content: [para("q1", "one")] },
            { type: "listItem", attrs: { uuid: "i2" }, content: [para("q2", "two")] },
          ],
        },
      ],
    });

    const walked = findSourceNodeByUuid(main.state.doc, "i2", "listItem")!;
    expect(walked.parent?.type.name).toBe("orderedList");
    expect(walked.index).toBe(1);

    const hinted = findSourceNodeByUuid(main.state.doc, "i2", "listItem", {
      from: walked.start,
      to: walked.end,
    })!;
    expect(hinted.parent?.type.name).toBe(walked.parent?.type.name);
    expect(hinted.index).toBe(walked.index);
  });
});

// ── The nested-item case: the source region is the CONTAINER ────────────────
//
// A listItem float renders its ordinal from the enclosing list's `start` plus
// its own index, so the item's own range is NOT the region that determines what
// the float shows. Gating on the item alone would look right and silently stop
// renumbering the float when a sibling was inserted above it — the same shape
// of near-miss the original bug was.

describe("float source-touch gate — a nested item watches its container", () => {
  function listDoc(): JSONContent {
    return {
      type: "doc",
      content: [
        para("pTop", "unrelated"),
        {
          type: "orderedList",
          attrs: { uuid: "L1", start: 1 },
          content: [
            { type: "listItem", attrs: { uuid: "i1" }, content: [para("q1", "one")] },
            { type: "listItem", attrs: { uuid: "i2" }, content: [para("q2", "two")] },
          ],
        },
        para("pEnd", "after"),
      ],
    };
  }

  function mountListItemFloat(main: Editor, uuid: string) {
    const float = mount({ type: "doc", content: [para("x", "seed")] }, "float");
    const calls = { n: 0 };
    const ordinals: number[] = [];
    const readSource = (doc: PMNode, hint: SourceRange | null) => {
      calls.n++;
      const src = findSourceNodeByUuid(doc, uuid, "listItem", hint);
      if (!src) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      const parent = src.parent;
      const start = (parent?.attrs?.start ?? 1) as number;
      ordinals.push(start + src.index);
      return {
        doc: {
          type: "doc",
          content: [src.node.toJSON() as JSONContent],
        } as JSONContent,
        missing: false,
        range: src.parentRange ?? { from: src.start, to: src.end },
      };
    };
    const view = renderHook(() =>
      useFloatMainSync({
        mainEditor: main,
        floatEditor: float,
        floatId: `listItem:${uuid}`,
        readSource,
      }),
    );
    return { float, calls, ordinals, view };
  }

  it("re-reads when a SIBLING is inserted above it (its ordinal changed)", () => {
    const main = mount(listDoc());
    const { calls, ordinals } = mountListItemFloat(main, "i2");
    expect(ordinals.at(-1)).toBe(2);
    const seeded = calls.n;

    const i1 = findSourceNodeByUuid(main.state.doc, "i1", "listItem")!;
    act(() => {
      main.view.dispatch(
        main.state.tr.insert(
          i1.start,
          main.state.schema.nodeFromJSON({
            type: "listItem",
            attrs: { uuid: "i0" },
            content: [para("q0", "zero")],
          }),
        ),
      );
    });

    expect(calls.n).toBe(seeded + 1);
    expect(ordinals.at(-1)).toBe(3);
  });

  it("re-reads when the enclosing list's own `start` attr changes", () => {
    const main = mount(listDoc());
    const { calls, ordinals } = mountListItemFloat(main, "i2");
    const seeded = calls.n;

    const list = findSourceNodeByUuid(main.state.doc, "L1", "orderedList")!;
    act(() => {
      main.view.dispatch(
        main.state.tr.setNodeMarkup(list.start, undefined, {
          ...list.node.attrs,
          start: 10,
        }),
      );
    });

    expect(calls.n).toBe(seeded + 1);
    expect(ordinals.at(-1)).toBe(11);
  });

  it("still does nothing for an edit outside the list", () => {
    const main = mount(listDoc());
    const { calls } = mountListItemFloat(main, "i2");
    const seeded = calls.n;

    typeAt(main, insideBlock(main, "pTop"));
    typeAt(main, insideBlock(main, "pEnd"));

    expect(calls.n).toBe(seeded);
  });
});

// ── The section case (the "hard" body the audit flagged) ────────────────────

describe("float source-touch gate — a heading float tracks its whole section", () => {
  function sectionDoc(): JSONContent {
    return {
      type: "doc",
      content: [
        para("pIntro", "before"),
        { type: "heading", attrs: { uuid: "hA", level: 1 }, content: [{ type: "text", text: "A" }] },
        para("pA1", "inside A one"),
        para("pA2", "inside A two"),
        { type: "heading", attrs: { uuid: "hB", level: 1 }, content: [{ type: "text", text: "B" }] },
        para("pB1", "inside B"),
      ],
    };
  }

  function mountHeadingFloat(main: Editor, uuid: string) {
    const float = mount({ type: "doc", content: [para("x", "seed")] }, "float");
    const calls = { n: 0 };
    const readSource = (doc: PMNode, hint: SourceRange | null) => {
      calls.n++;
      const range = getSectionRangeByUuid(doc, uuid, hint);
      if (!range) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: {
          type: "doc",
          content: range.nodes.map((n) => n.toJSON() as JSONContent),
        } as JSONContent,
        missing: false,
        range: { from: range.start, to: range.end },
      };
    };
    const view = renderHook(() =>
      useFloatMainSync({
        mainEditor: main,
        floatEditor: float,
        floatId: `heading:${uuid}`,
        readSource,
      }),
    );
    return { float, calls, view };
  }

  it("fires for a block INSIDE the section and not for one outside", () => {
    const main = mount(sectionDoc());
    const { calls } = mountHeadingFloat(main, "hA");
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "pIntro"));
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "pB1"));
    expect(calls.n).toBe(1);

    typeAt(main, insideBlock(main, "pA2"));
    expect(calls.n).toBe(2);

    typeAt(main, insideBlock(main, "hA"));
    expect(calls.n).toBe(3);
  });

  it("re-reads when a heading is inserted at the section's end boundary", () => {
    const main = mount(sectionDoc());
    const { calls, float } = mountHeadingFloat(main, "hA");
    const seeded = calls.n;

    // A new h1 pushed in right before the OLD next heading lands exactly on the
    // section's end boundary and re-scopes it. An exclusive intersection test
    // would miss this entirely.
    const hB = findSourceNodeByUuid(main.state.doc, "hB", "heading")!;
    act(() => {
      main.view.dispatch(
        main.state.tr.insert(
          hB.start,
          main.state.schema.nodeFromJSON({
            type: "heading",
            attrs: { uuid: "hMid", level: 1 },
            content: [{ type: "text", text: "Mid" }],
          }),
        ),
      );
    });

    expect(calls.n).toBe(seeded + 1);
    expect(float.state.doc.textContent).toContain("inside A two");
    expect(float.state.doc.textContent).not.toContain("Mid");
  });
});
