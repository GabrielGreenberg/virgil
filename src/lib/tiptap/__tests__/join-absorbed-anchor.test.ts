// @vitest-environment jsdom
//
// Task 2026-08-31-514 — a JOIN ABSORBS a block; it does not remove it.
//
// REPORTED (measured by the task-499 worker against `main`, then routed):
//   BEFORE   paragraph#P1("A")   paragraph#P2("B")     ← caret at the start of "B"
//   AFTER    paragraph#P1("A")   paragraph#P2("")   paragraph#099b("B")
// The user pressed Backspace to merge two paragraphs and got a blank line
// holding one of their identities, with their own text re-minted beside it.
//
// MECHANISM. `MarginaliaAnchorGuard` resurrects any anchored block the observer
// reports removed. A JOIN removes the absorbed block — its CONTENT survives
// inside the survivor, its NODE does not — so the guard plants an empty
// paragraph carrying its uuid at the deletion site, PM's fitter splits the
// merged textblock around it, and `BlockUuidBackfill` mints a stranger for the
// half that got split back off.
//
// THE FIX is one classification read by both guards (`classifyBlockDepartures`)
// plus Gabriel's ruling that the absorbed card FOLLOWS the survivor: the
// resurrection guard stands down (EXCEPTION 4) and `TextObjectOrphanGuard`
// publishes an ABSORBED verdict carrying the survivor INSTEAD of the
// `virgil-textobject-orphaned` event — one uuid, one verdict, so task 491's
// "retarget before the sweep can strip" ordering is structural here.
//
// WHY NO EXISTING SUITE COULD SEE THIS. `anchored-block-delete-reinsert.test.ts`
// characterises the guard by dispatching `tr.delete` DIRECTLY, where a join is
// unrepresentable; `reparent-identity-conservation.test.ts` PINNED the husk as a
// stated boundary (renegotiated in place there); and every list fixture in the
// repo drives Shift-Tab on ONE item, so the multi-item lift's per-joined-item
// husks were never driven either.
//
// Every leg drives the REAL `buildEditorExtensions("main")` stack through
// `handleKeyDown` or the shipped command chain — a direct `tr` dispatch cannot
// see which command a keymap chooses (task 418's lesson).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids, serializeBodyOnly } from "@/lib/latex-serializer";
import type { BlockAbsorbedEvent } from "@/lib/tiptap/linked-anchor";

const ROOT = join(__dirname, "../../../..");

// ── harness ──────────────────────────────────────────────────────────────────

let anchored: Set<string>;
let absorbedRef: { current: ((e: BlockAbsorbedEvent) => void) | null };
let absorbed: BlockAbsorbedEvent[];
let orphaned: string[];

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    onBlockAbsorbedRef: absorbedRef,
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];
function mount(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(ed);
  return ed;
}

/** The SHIPPED binding, through ProseMirror's own key dispatch. */
function press(ed: Editor, key: string, opts: KeyboardEventInit = {}): boolean {
  return (
    ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key, ...opts })),
    ) ?? false
  );
}

/** Caret at the START of the textblock whose text is exactly `text`. */
function caret(ed: Editor, text: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1;
    return true;
  });
  if (pos < 0) throw new Error(`no textblock "${text}"`);
  ed.commands.setTextSelection(pos);
}

function liveUuids(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    const u = (n.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (typeof u === "string" && u) out.push(u);
    return true;
  });
  return out;
}

/** `type#uuid("text")` per node, indented — the readable failure diagnostic. */
function outline(ed: Editor): string {
  const lines: string[] = [];
  ed.state.doc.descendants((n, pos) => {
    if (n.isText) return false;
    const d = ed.state.doc.resolve(pos).depth;
    const u = (n.attrs as { uuid?: string | null } | undefined)?.uuid;
    lines.push(
      `${"  ".repeat(d)}${n.type.name}${u ? `#${u}` : ""}` +
        (n.isTextblock ? `("${n.textContent}")` : ""),
    );
    return true;
  });
  return lines.join("\n");
}

/** Is `uuid` sitting on an EMPTY paragraph — the husk the resurrection guard
 *  leaves behind? Asked about a SPECIFIC identity, because the shipped stack
 *  keeps a freshly-minted trailing paragraph and that one is not a husk. */
function huskFor(ed: Editor, uuid: string): boolean {
  let hit = false;
  ed.state.doc.descendants((n) => {
    const u = (n.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (n.type.name === "paragraph" && n.content.size === 0 && u === uuid) hit = true;
    return true;
  });
  return hit;
}

/** Text of the whole document, blocks joined — what the reader sees. */
function allText(ed: Editor): string {
  return ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n");
}

function drain(): void {
  vi.runAllTimers();
}

const P = (uuid: string | null, text?: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const ITEM = (uuid: string, ...kids: JSONContent[]): JSONContent => ({
  type: "listItem",
  attrs: { uuid },
  content: kids,
});
const LIST = (uuid: string, ...items: JSONContent[]): JSONContent => ({
  type: "bulletList",
  attrs: { uuid },
  content: items,
});

function onOrphan(e: Event) {
  orphaned.push((e as CustomEvent<{ uuid: string }>).detail.uuid);
}

beforeEach(() => {
  anchored = new Set<string>();
  orphaned = [];
  absorbed = [];
  absorbedRef = { current: (e) => absorbed.push(e) };
  window.addEventListener("virgil-textobject-orphaned", onOrphan);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.removeEventListener("virgil-textobject-orphaned", onOrphan);
  for (const ed of editors.splice(0)) ed.destroy();
});

// ── A. the reported gesture ──────────────────────────────────────────────────

describe("514 — Backspace-joining two anchored paragraphs leaves NO husk", () => {
  it("the survivor holds both halves and nothing is re-minted", () => {
    anchored.add("P1");
    anchored.add("P2");
    const ed = mount([P("P1", "A"), P("P2", "B")]);
    caret(ed, "B");
    expect(press(ed, "Backspace")).toBe(true);

    expect(huskFor(ed, "P2"), outline(ed)).toBe(false);
    expect(allText(ed), outline(ed)).toContain("AB");
    // The survivor keeps its own identity, and no stranger was minted for the
    // half a husk would have split off.
    const live = liveUuids(ed);
    expect(live, outline(ed)).toContain("P1");
    expect(live, outline(ed)).not.toContain("P2");
  });

  it("the absorbed uuid is announced as ABSORBED into the survivor, not orphaned", () => {
    anchored.add("P2");
    const ed = mount([P("P1", "A"), P("P2", "B")]);
    caret(ed, "B");
    press(ed, "Backspace");
    drain();

    expect(absorbed.map((e) => [e.absorbed.uuid, e.survivor.uuid])).toEqual([
      ["P2", "P1"],
    ]);
    expect(absorbed[0].survivor.typeName).toBe("paragraph");
    // ONE uuid, ONE verdict — the orphan sweep must not also strip the link.
    expect(orphaned).not.toContain("P2");
  });

  it("undo restores both paragraphs with their own identities", () => {
    anchored.add("P1");
    anchored.add("P2");
    const ed = mount([P("P1", "A"), P("P2", "B")]);
    caret(ed, "B");
    press(ed, "Backspace");
    ed.commands.undo();

    const live = liveUuids(ed);
    expect(live, outline(ed)).toContain("P1");
    expect(live, outline(ed)).toContain("P2");
    expect(new Set(live).size, outline(ed)).toBe(live.length);
    expect(huskFor(ed, "P2"), outline(ed)).toBe(false);
  });
});

// ── B. the same law in the other shapes a join reaches ───────────────────────

describe("514 — every join shape, not one gesture's spelling", () => {
  it("a list-item join absorbs the item rather than husking it", () => {
    anchored.add("i1");
    anchored.add("i2");
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "B");
    press(ed, "Backspace");
    drain();

    expect(huskFor(ed, "i2"), outline(ed)).toBe(false);
    expect(allText(ed), outline(ed)).toContain("AB");
    expect(absorbed.map((e) => [e.absorbed.uuid, e.survivor.uuid])).toEqual([
      ["i2", "i1"],
    ]);
  });

  it("a range DELETE across a block boundary absorbs the tail block", () => {
    anchored.add("P2");
    const ed = mount([P("P1", "Hello"), P("P2", "World")]);
    // "He|llo" … "Wo|rld"
    let from = -1;
    let to = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.isTextblock && n.textContent === "Hello") from = p + 1 + 2;
      if (n.isTextblock && n.textContent === "World") to = p + 1 + 2;
      return true;
    });
    ed.commands.setTextSelection({ from, to });
    press(ed, "Backspace");
    drain();

    expect(huskFor(ed, "P2"), outline(ed)).toBe(false);
    expect(allText(ed), outline(ed)).toContain("Herld");
    expect(absorbed.map((e) => e.absorbed.uuid)).toEqual(["P2"]);
  });

  it("a MULTI-item Shift-Tab lift husks none of the items it joins away (499's residual)", () => {
    // `liftOutOfList` merges the selected items with `tr.delete(pos-1, pos+1)`
    // before lifting — a plain ReplaceStep join, one per joined-away item.
    anchored.add("i1");
    anchored.add("i2");
    anchored.add("i3");
    const ed = mount([
      LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")), ITEM("i3", P(null, "C"))),
    ]);
    let from = -1;
    let to = -1;
    ed.state.doc.descendants((n, p) => {
      if (n.isTextblock && n.textContent === "A") from = p + 1;
      if (n.isTextblock && n.textContent === "C") to = p + 1;
      return true;
    });
    ed.commands.setTextSelection({ from, to });
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);

    expect(huskFor(ed, "i2"), outline(ed)).toBe(false);
    expect(huskFor(ed, "i3"), outline(ed)).toBe(false);
    const live = liveUuids(ed);
    expect(new Set(live).size, outline(ed)).toBe(live.length);
  });
});

// ── C. the controls — what must STILL resurrect ──────────────────────────────

describe("514 — the controls: a genuine REMOVAL still resurrects", () => {
  it("deleting a whole anchored block still leaves the guard's placeholder", () => {
    anchored.add("P2");
    const ed = mount([P("P1", "A"), P("P2", "B"), P("P3", "C")]);
    // Select the WHOLE of P2 including its own boundaries — a removal, not a join.
    let before = -1;
    ed.state.doc.descendants((n, p) => {
      const u = (n.attrs as { uuid?: string } | undefined)?.uuid;
      if (u === "P2") before = p;
      return true;
    });
    ed.view.dispatch(ed.state.tr.delete(before, before + ed.state.doc.nodeAt(before)!.nodeSize));

    expect(huskFor(ed, "P2"), outline(ed)).toBe(true);
    expect(liveUuids(ed), outline(ed)).toContain("P2");
  });

  it("joining two paragraphs INSIDE one list item absorbs nothing (one identity)", () => {
    anchored.add("i1");
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A"), P(null, "B")))]);
    caret(ed, "B");
    press(ed, "Backspace");
    drain();

    // Both textblocks defer to the SAME item, so nothing departed.
    expect(absorbed, outline(ed)).toEqual([]);
    expect(liveUuids(ed), outline(ed)).toContain("i1");
  });

  it("an intra-block delete announces nothing", () => {
    anchored.add("P1");
    const ed = mount([P("P1", "Hello")]);
    caret(ed, "Hello");
    ed.commands.setTextSelection({ from: 2, to: 4 });
    press(ed, "Backspace");
    drain();
    expect(absorbed).toEqual([]);
    expect(orphaned).toEqual([]);
  });
});

// ── D. the .tex round trip — a join leaves no stray anchor line ──────────────

describe("514 — the joined document round-trips with no residue", () => {
  it("two cycles produce a byte fixed point and no orphan anchor line", () => {
    anchored.add("P1");
    anchored.add("P2");
    const ed = mount([P("aaaa", "Alpha"), P("bbbb", "Beta")]);
    anchored.add("aaaa");
    anchored.add("bbbb");
    caret(ed, "Beta");
    press(ed, "Backspace");

    const doc1 = ed.getJSON();
    assignUuids(doc1);
    const first = serializeBodyOnly(doc1);
    const doc2 = parseLatex(first);
    assignUuids(doc2);
    const second = serializeBodyOnly(doc2);
    expect(second).toBe(first);
    // The absorbed identity does not survive as a stranded anchor line.
    expect(first).not.toMatch(/^\s*%!v:bbbb\s*$/m);
    expect(first).toContain("AlphaBeta");
  });
});

// ── E. the census — the door was never the part that could misbehave ─────────

describe("514 — the departure classification has ONE door", () => {
  const SRC = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("both guards read `classifyBlockDepartures`; neither re-derives a join", () => {
    const code = codeOnly(SRC("src/lib/tiptap/linked-anchor.ts"));
    // MarginaliaAnchorGuard and TextObjectOrphanGuard each ask the shared door.
    expect(
      (code.match(/classifyBlockDepartures\(/g) ?? []).length,
      "both guards must read the ONE classification",
    ).toBeGreaterThanOrEqual(2);
    // …and neither hand-reads a step to answer the same question.
    expect(code).not.toMatch(/instanceof ReplaceStep/);
    expect(code).not.toMatch(/\bdissolvedByReparent\b/);
  });

  it("nothing outside the SSOT re-derives the absorbed reading", () => {
    const offenders: string[] = [];
    for (const rel of [
      "src/lib/tiptap/linked-anchor.ts",
      "src/components/EditorPane.tsx",
      "src/cards/retarget-anchors.ts",
    ]) {
      const code = codeOnly(SRC(rel));
      if (/\breadJoin\b|\buuidBearingAncestor\b|\bresolveAbsorptionChains\b/.test(code)) {
        offenders.push(`${rel} (re-derives the join reading)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("EditorPane wires the handler and routes it through the 491 door", () => {
    const code = codeOnly(SRC("src/components/EditorPane.tsx"));
    expect(code, "the ref must reach the editor").toMatch(
      /onBlockAbsorbedRef=\{onBlockAbsorbedRef\}/,
    );
    expect(code, "the re-home must go through the shared door").toMatch(
      /rehomeAbsorbedAnchor\(/,
    );
    // A second, private retarget for this event would fork task 491's rule.
    expect(
      (code.match(/anchorRetarget\.retarget\(/g) ?? []).length,
      "EditorPane must not call the retarget door itself",
    ).toBe(0);
  });
});
