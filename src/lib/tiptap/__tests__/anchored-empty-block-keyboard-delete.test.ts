// @vitest-environment jsdom
//
// Task 2026-08-18-367 — "Backspace does NOTHING" at an invisible block.
//
// REPORTED (Gabriel, Coherence Intro paper, two instances in one paper): caret
// before the "E" of "Essentially the same form of argument…" — Backspace dead.
// Caret in the invisible block above it — dead too. Same again before "The
// connective inventory of English…". Only the grab-handle Delete worked.
//
// MECHANISM (measured here, not assumed — the filed diagnosis blamed PM's
// `findCutBefore` refusing to cross `isolating`, and that is NOT what this is;
// `selectNodeBackward` node-selects an isolating sibling perfectly well, and the
// two-press select-then-delete affordance already works at every isolating edge).
// The real cause is MarginaliaAnchorGuard's NO-OP IDENTITY:
//
//   1. A stray `%!v:XXXX` anchor line in the .tex parses to an EMPTY paragraph
//      carrying that uuid (pinned below against the REAL parser).
//   2. If a card anchors that uuid it sits in `anchoredUuidsRef`.
//   3. Backspace removes the empty paragraph; the guard re-inserts
//      `paragraph({ uuid })` — an empty paragraph with that uuid.
//   4. Re-insert ≡ removal. The document is byte-identical. Forever.
//
// WHY NO EXISTING SUITE COULD SEE IT. `anchored-block-delete-reinsert.test.ts`
// characterizes this guard thoroughly — by dispatching `tr.delete(...)` directly.
// Against a synthetic whole-block delete the guard's remedy is a REAL change
// (content removed, empty husk left), so the defect is unrepresentable there. It
// only appears when a REAL KEYSTROKE removes a block that was ALREADY the husk.
// So every leg here drives `view.someProp("handleKeyDown", …)` on the REAL
// `buildEditorExtensions("main")` stack — the shipped bindings, not a re-model.
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
import { parseLatex } from "@/lib/latex-parser";

// ── harness ──────────────────────────────────────────────────────────────────

/** The live anchored-uuid set the guard reads — the same REF EditorPane owns. */
const ANCHORED = new Set<string>();

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: ANCHORED },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

function mount(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

/** The SHIPPED binding, through ProseMirror's own key dispatch. */
function press(ed: Editor, key: "Backspace" | "Delete"): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key })),
    ) ?? false
  );
}

/** Caret at the start (or end) of the `idx`-th top-level child. */
function caret(ed: Editor, idx: number, where: "start" | "end") {
  let pos = -1;
  let i = 0;
  ed.state.doc.forEach((node, p) => {
    if (i === idx) pos = where === "start" ? p + 1 : p + node.nodeSize - 1;
    i++;
  });
  if (pos < 0) throw new Error(`no top-level child ${idx}`);
  ed.commands.setTextSelection(pos);
}

/** A compact shape of the doc: one token per top-level child. */
function shape(ed: Editor): string {
  return (ed.getJSON().content ?? [])
    .map((n) => `${n.type}${n.content ? "" : ":empty"}`)
    .join(" | ");
}

function uuids(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    const u = (n.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (u) out.push(u);
    return true;
  });
  return out;
}

/** A uuid-bearing empty paragraph — what a lone `%!v:XXXX` anchor line parses to. */
const HUSK = (uuid: string): JSONContent => ({ type: "paragraph", attrs: { uuid } });
const TEXT = (uuid: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});
const EXAMPLE: JSONContent = {
  type: "exampleBlock",
  attrs: { kind: "single" },
  content: [{ type: "paragraph", content: [{ type: "text", text: "Foo bar" }] }],
};

// ── the geography actually comes from the .tex ───────────────────────────────

describe("367 — a lone `%!v:` anchor line is an empty uuid-bearing paragraph", () => {
  it("parses to exactly the node the guard re-inserts (which is why it is a no-op)", () => {
    // Gabriel's instance 2 geography, verbatim.
    const doc = parseLatex("Some prose here.\n\n%!v:c194\n\nThe connective inventory of English.\n");
    const husk = (doc.content ?? [])[1];
    expect(husk?.type).toBe("paragraph");
    expect(husk?.attrs?.uuid).toBe("c194");
    expect(husk?.content).toBeFalsy(); // EMPTY — no content at all
  });
});

// ── the defect ───────────────────────────────────────────────────────────────

describe("367 — an anchored empty block is deletable by keyboard", () => {
  beforeEach(() => ANCHORED.clear());

  it("Backspace at the start of the paragraph AFTER the husk removes it (instance 1: after an example)", () => {
    ANCHORED.add("3be5");
    const ed = mount([EXAMPLE, HUSK("3be5"), TEXT("aaaa", "Essentially the same form of argument.")]);
    caret(ed, 2, "start");

    expect(press(ed, "Backspace")).toBe(true);

    // Pre-fix: `exampleBlock | paragraph:empty | paragraph` — byte-identical,
    // for this press and every press after it.
    expect(shape(ed)).toBe("exampleBlock | paragraph");
    expect(uuids(ed)).not.toContain("3be5");
    ed.destroy();
  });

  it("Backspace INSIDE the husk removes it (instance 1, the second half of the report)", () => {
    ANCHORED.add("3be5");
    const ed = mount([EXAMPLE, HUSK("3be5"), TEXT("aaaa", "Essentially the same form of argument.")]);
    caret(ed, 1, "start");

    expect(press(ed, "Backspace")).toBe(true);
    expect(uuids(ed)).not.toContain("3be5");
    ed.destroy();
  });

  it("Backspace before the paragraph after the husk removes it (instance 2: no example anywhere)", () => {
    // The kind set was never "isolating siblings" — this instance has none.
    ANCHORED.add("c194");
    const ed = mount([TEXT("zzzz", "Some prose here."), HUSK("c194"), TEXT("aaaa", "The connective inventory of English.")]);
    caret(ed, 2, "start");

    expect(press(ed, "Backspace")).toBe(true);
    expect(uuids(ed)).not.toContain("c194");
    ed.destroy();
  });

  it("forward Delete at the end of the paragraph BEFORE the husk removes it", () => {
    ANCHORED.add("c194");
    const ed = mount([TEXT("zzzz", "Some prose here."), HUSK("c194"), TEXT("aaaa", "Tail.")]);
    caret(ed, 0, "end");

    expect(press(ed, "Delete")).toBe(true);
    expect(uuids(ed)).not.toContain("c194");
    ed.destroy();
  });

  it("the husk's card is told: the orphan sweep fires for the uuid the guard let go", async () => {
    ANCHORED.add("c194");
    const seen: string[] = [];
    const onOrphan = (e: Event) => seen.push((e as CustomEvent).detail.uuid);
    window.addEventListener("virgil-textobject-orphaned", onOrphan);

    const ed = mount([TEXT("zzzz", "Prose."), HUSK("c194"), TEXT("aaaa", "Tail.")]);
    caret(ed, 2, "start");
    press(ed, "Backspace");
    await new Promise((r) => setTimeout(r, 0));

    window.removeEventListener("virgil-textobject-orphaned", onOrphan);
    // Not silent data loss: the Mode-A hooks drop the stale link and the card
    // lands in the orphan strip, re-pinnable — the grab-handle Delete outcome.
    expect(seen).toContain("c194");
    ed.destroy();
  });
});

// ── the guard's legitimate job, unchanged ────────────────────────────────────

describe("367 — the guard still preserves everything it was preserving", () => {
  beforeEach(() => ANCHORED.clear());

  it("an anchored NON-empty block removed incidentally still resurrects", () => {
    ANCHORED.add("keep");
    const ed = mount([TEXT("zzzz", "Prose."), TEXT("keep", "Anchored text.")]);
    // Select the whole anchored paragraph's text and delete it, then remove the
    // block: the FIRST delete leaves a non-empty→empty block, so this drives the
    // incidental removal directly instead.
    const { doc } = ed.state;
    let from = -1;
    let to = -1;
    doc.forEach((node, pos) => {
      if ((node.attrs as { uuid?: string }).uuid === "keep") {
        from = pos;
        to = pos + node.nodeSize;
      }
    });
    ed.view.dispatch(ed.state.tr.delete(from, to));

    // Resurrected as an empty husk carrying the uuid — the guard's legitimate job.
    expect(uuids(ed)).toContain("keep");
    ed.destroy();
  });

  it("an anchored EMPTY block carrying a parTitle still resurrects (not a no-op: the title is visible)", () => {
    ANCHORED.add("titled");
    const titled: JSONContent = { type: "paragraph", attrs: { uuid: "titled", parTitle: "Working note" } };
    const ed = mount([TEXT("zzzz", "Prose."), titled, TEXT("aaaa", "Tail.")]);
    caret(ed, 2, "start");

    press(ed, "Backspace");
    // The remedy would DROP the title, so the gesture has a visible effect and
    // the guard keeps its uuid alive. The fail-safe direction, stated.
    expect(uuids(ed)).toContain("titled");
    ed.destroy();
  });

  it("LIFECYCLE_DELETE_META still bypasses the guard wholesale (non-regression)", () => {
    ANCHORED.add("keep");
    const ed = mount([TEXT("zzzz", "Prose."), TEXT("keep", "Anchored text.")]);
    let from = -1;
    let to = -1;
    ed.state.doc.forEach((node, pos) => {
      if ((node.attrs as { uuid?: string }).uuid === "keep") {
        from = pos;
        to = pos + node.nodeSize;
      }
    });
    ed.view.dispatch(ed.state.tr.delete(from, to).setMeta(LIFECYCLE_DELETE_META, true));

    expect(uuids(ed)).not.toContain("keep");
    ed.destroy();
  });

  it("an UNANCHORED husk was never affected either way (control)", () => {
    const ed = mount([TEXT("zzzz", "Prose."), HUSK("free"), TEXT("aaaa", "Tail.")]);
    caret(ed, 2, "start");

    expect(press(ed, "Backspace")).toBe(true);
    expect(uuids(ed)).not.toContain("free");
    ed.destroy();
  });
});

// ── the falsified half, pinned so it cannot be "fixed" again by mistake ──────

describe("367 — the isolating edge is NOT dead: select-then-delete already works", () => {
  beforeEach(() => ANCHORED.clear());

  it.each([
    ["exampleBlock", EXAMPLE],
    ["latexComment", { type: "latexComment", content: [{ type: "text", text: "note" }] } as JSONContent],
  ])("Backspace at the start of the paragraph after an %s node-selects it, then deletes", (_name, isolatingNode) => {
    const ed = mount([isolatingNode, TEXT("aaaa", "Essentially.")]);
    caret(ed, 1, "start");

    // Press 1 — PM's `selectNodeBackward` DOES fire across an isolating edge.
    expect(press(ed, "Backspace")).toBe(true);
    expect(ed.state.selection.constructor.name).toBe("NodeSelection");
    // Press 2 — deletes the selected block.
    expect(press(ed, "Backspace")).toBe(true);
    expect(shape(ed)).toBe("paragraph");
    ed.destroy();
  });
});
