// @vitest-environment jsdom
//
// Task 2026-08-30-499 — a container-changing gesture CONSERVES block identity.
//
// REPORTED (Gabriel, GGlaptop, v0.1.100, "SEP Contents of Perception"), twice:
//   • "when i'm in a list, and shift-tab to turn the list into regular text, it
//     should put that new text in a paragraph text-object."
//   • "at the end of a list, if you shift-tab an item to become text, that text
//     is not properly placed as a text-object."
//
// MECHANISM. Shift-Tab is upstream TipTap's `liftListItem`, reaching the editor
// unmediated, and it does not CONSERVE identity: the `listItem`'s uuid — the
// text object every card / todo / report / marginalia marker / sidecar entry
// was keyed on — leaves the document, the lifted paragraph gets a brand-new id
// from `BlockUuidBackfill` (which, left alone, can only MINT), the orphan guard
// strips every link, and — for a margin-anchored item — the resurrection guard
// puts an EMPTY paragraph carrying the old uuid above the user's own text.
// Verbatim the report: the text object is the empty line and the user's text is
// a stranger.
//
// THE FIX is two directions of one law, both in `block-uuid-backfill.ts` (see
// its header): a container that DISSOLVED hands its identity to its successor
// (read off a `ReplaceAroundStep`'s gap), and a block that STOPPED BEING A TEXT
// OBJECT hands its identity up to the bare container that took over (read off
// the result). One rule per direction covers every surface, because the net
// sees the TRANSACTION, not the gesture.
//
// WHY NO EXISTING SUITE COULD SEE THIS. `block-uuid-backfill.test.ts` covers
// the lift through a synthetic two-node blockquote schema and asserted a FRESH
// id as the contract (renegotiated in place there); `listItem` appears in it
// once, in a comment. No suite anywhere asserted that a lift or a toggle
// CONSERVES a container's uuid, and none drove a real `Shift-Tab`.
//
// Every leg here drives the REAL `buildEditorExtensions("main")` stack through
// `handleKeyDown` or the shipped command chain — a direct `tr` dispatch cannot
// see which command a keymap chooses (task 418's lesson) — and keys identity by
// STRUCTURAL PATH, so a STEAL reads as two changed paths and a RE-MINT as one.
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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids, serializeBodyOnly } from "@/lib/latex-serializer";

// ── harness ──────────────────────────────────────────────────────────────────

let anchored: Set<string>;

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
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

/** Caret at the start of the textblock whose text is exactly `text`. */
function caret(ed: Editor, text: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.isTextblock && n.textContent === text) pos = p + 1;
    return true;
  });
  if (pos < 0) throw new Error(`no textblock "${text}"`);
  ed.commands.setTextSelection(pos);
}

/**
 * `structural path → uuid` for every uuid-bearing node, path = the child-index
 * chain from the doc root (`"0"`, `"0.1"`, `"0.1.0"`). Task 348's keying: a
 * STEAL shows up as two changed paths and a RE-MINT as one, where a bare list of
 * uuids in document order could not tell them apart.
 */
function idsByPath(ed: Editor): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (node: import("@tiptap/pm/model").Node, prefix: string) => {
    node.content.forEach((child, _off, index) => {
      const path = prefix ? `${prefix}.${index}` : `${index}`;
      const u = (child.attrs as { uuid?: string | null } | undefined)?.uuid;
      if (typeof u === "string" && u) out[path] = u;
      walk(child, path);
    });
  };
  walk(ed.state.doc, "");
  return out;
}

/** Every uuid live in the doc, at any depth. */
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

/**
 * Is `uuid` sitting on an EMPTY paragraph — the husk the resurrection guard
 * leaves behind? Asked about a SPECIFIC identity rather than "any empty
 * paragraph", because the shipped stack keeps a freshly-minted trailing
 * paragraph at the end of every document and that one is not a husk.
 */
function huskFor(ed: Editor, uuid: string): boolean {
  let hit = false;
  ed.state.doc.descendants((n) => {
    const u = (n.attrs as { uuid?: string | null } | undefined)?.uuid;
    if (n.type.name === "paragraph" && n.content.size === 0 && u === uuid) hit = true;
    return true;
  });
  return hit;
}

/** uuids the orphan guard announced as dead (its sweep is a `setTimeout(0)`). */
let orphaned: string[];
function drainOrphans(): string[] {
  vi.runAllTimers();
  return orphaned;
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
const QUOTE = (uuid: string, ...kids: JSONContent[]): JSONContent => ({
  type: "blockquote",
  attrs: { uuid },
  content: kids,
});

// An item's own body paragraph carries NO uuid — it defers to the item, and
// `assignUuids` strips it at serialization. Building the fixtures any other way
// makes the whole defect unrepresentable, because the lifted paragraph would
// then arrive with an identity of its own.
function onOrphan(e: Event) {
  orphaned.push((e as CustomEvent<{ uuid: string }>).detail.uuid);
}

beforeEach(() => {
  anchored = new Set<string>();
  orphaned = [];
  window.addEventListener("virgil-textobject-orphaned", onOrphan);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.removeEventListener("virgil-textobject-orphaned", onOrphan);
  for (const ed of editors.splice(0)) ed.destroy();
});

// ── A. the reported gesture: Shift-Tab out of a list ─────────────────────────

describe("499 — Shift-Tab conserves the ITEM's identity, at every position", () => {
  const CASES = [
    { name: "only item", items: ["A"], target: "A", item: "i1" },
    { name: "first of three", items: ["A", "B", "C"], target: "A", item: "i1" },
    { name: "middle of three", items: ["A", "B", "C"], target: "B", item: "i2" },
    { name: "last of three", items: ["A", "B", "C"], target: "C", item: "i3" },
  ] as const;

  for (const c of CASES) {
    it(`${c.name}: the lifted paragraph IS the item (no stranger, no husk, no orphan)`, () => {
      anchored.add(c.item); // margin-anchored — the husk branch's own premise
      const ed = mount([
        LIST("L1", ...c.items.map((txt, i) => ITEM(`i${i + 1}`, P(null, txt)))),
        P("tail", "tail"),
      ]);
      caret(ed, c.target);
      expect(press(ed, "Tab", { shiftKey: true })).toBe(true);

      // the reported symptom, both halves
      const lifted = idsByPath(ed);
      const liftedPath = Object.keys(lifted).find(
        (p) => !p.includes(".") && nodeTextAtPath(ed, p) === c.target,
      );
      expect(liftedPath, `no top-level block holds "${c.target}"\n${outline(ed)}`).toBeDefined();
      expect(lifted[liftedPath!], outline(ed)).toBe(c.item);
      expect(huskFor(ed, c.item), outline(ed)).toBe(false);
      expect(drainOrphans()).not.toContain(c.item);

      // and the invariant the whole net exists for
      expect(new Set(liveUuids(ed)).size).toBe(liveUuids(ed).length);
    });
  }

  it("a multi-BLOCK item lifts its whole body and the FIRST block keeps the id", () => {
    anchored.add("i2");
    const ed = mount([
      LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B"), P(null, "B2"))),
    ]);
    caret(ed, "B");
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    const ids = idsByPath(ed);
    expect(ids["1"], outline(ed)).toBe("i2"); // the item's own first block
    expect(ids["2"]).toMatch(/^[0-9a-f]{4}$/); // the tail block is a new object
    expect(huskFor(ed, "i2"), outline(ed)).toBe(false);
    expect(drainOrphans()).not.toContain("i2");
  });

  it("the conserved id survives the whole `.tex` round trip", () => {
    // The end-to-end proof, and the one a card actually depends on: a paragraph
    // uuid only reaches a card's next session through the `.tex`. Driven from
    // REAL source through the REAL parser, the REAL keymap and the REAL
    // serializer, so nothing about the fixture presupposes the answer.
    const parsed = parseLatex(
      "Intro paragraph. %!v:1111\n\n\\begin{itemize}\n" +
        "\\item Alpha. %!v:2222\n\\item Beta. %!v:3333\n" +
        "\\end{itemize} %!v:4444\n",
    );
    assignUuids(parsed);
    const ed = mount((parsed.content ?? []) as JSONContent[]);
    caret(ed, "Beta.");
    expect(press(ed, "Tab", { shiftKey: true })).toBe(true);
    expect(idsByPath(ed)["2"], outline(ed)).toBe("3333");
    // …and the anchor is written back on the lifted line, not on a husk and not
    // on the list it left.
    const tex = serializeBodyOnly(ed.getJSON() as never);
    expect(tex).toContain("Beta. %!v:3333");
    expect(tex).toContain("\\item Alpha. %!v:2222");
    expect(tex).toContain("\\end{itemize} %!v:4444");
  });

  it("RESIDUAL, pinned: a MULTI-item lift conserves the FIRST item only", () => {
    // `liftOutOfList` merges the selected items into one before lifting, so by
    // the time the lift runs only the first item's identity is still available.
    // The honest composition of a join and a split — stated in the module
    // header, and pinned here so it is a decision rather than a surprise.
    const ed = mount([
      LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")), ITEM("i3", P(null, "C"))),
    ]);
    ed.commands.setTextSelection({ from: 8, to: 13 }); // spans "B" and "C"
    press(ed, "Tab", { shiftKey: true });
    const ids = idsByPath(ed);
    expect(ids["1"], outline(ed)).toBe("i2");
    expect(ids["2"]).toMatch(/^[0-9a-f]{4}$/);
    expect(ids["2"]).not.toBe("i3");
  });
});

function nodeTextAtPath(ed: Editor, path: string): string {
  let node: import("@tiptap/pm/model").Node = ed.state.doc;
  for (const seg of path.split(".")) node = node.child(Number(seg));
  return node.textContent;
}

// ── B. the same conservation, every OTHER surface ────────────────────────────

describe("499 — every container-changing surface conserves, not just Shift-Tab", () => {
  it("M2 Backspace at a list item's own start (the lift branch)", () => {
    anchored.add("i1");
    const ed = mount([
      P("before", "before"),
      LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B"))),
    ]);
    caret(ed, "A");
    expect(press(ed, "Backspace")).toBe(true);
    expect(idsByPath(ed)["1"], outline(ed)).toBe("i1");
    expect(idsByPath(ed)["2"]).toBe("L1"); // the list itself is untouched
    expect(huskFor(ed, "i1"), outline(ed)).toBe(false);
    expect(drainOrphans()).not.toContain("i1");
  });

  it("M3 toggle-list-OFF (the lightning grid / slash / Mod-Shift-8 command)", () => {
    anchored.add("i2");
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "B");
    ed.chain().toggleBulletList().run();
    expect(idsByPath(ed)["1"], outline(ed)).toBe("i2");
    expect(idsByPath(ed)["0"]).toBe("L1");
    expect(huskFor(ed, "i2"), outline(ed)).toBe(false);
  });

  it("M3b the Mod-Shift-8 CHORD, through the real keymap", () => {
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "B");
    // jsdom is not a mac, so `Mod` resolves to Ctrl (the rule
    // `wrapper-surfaces-guard`'s own chord helper records).
    const ev = new KeyboardEvent("keydown", {
      key: "8", code: "Digit8", keyCode: 56, ctrlKey: true, shiftKey: true,
    });
    expect(ed.view.someProp("handleKeyDown", (f) => f(ed.view, ev))).toBe(true);
    expect(idsByPath(ed)["1"], outline(ed)).toBe("i2");
  });

  it("M4 toggle-list-ON: the new ITEM takes the paragraph's identity", () => {
    // The inverse loss. `stampTextObjectAttrs` removes the deferred paragraph's
    // `data-uuid` and `assignUuids` strips it on the next save, so leaving P1
    // there loses it silently on reload while the item wears a stranger's id.
    const ed = mount([P("P1", "Hello"), P("P2", "World")]);
    caret(ed, "Hello");
    ed.chain().toggleBulletList().run();
    const ids = idsByPath(ed);
    expect(ids["0.0"], outline(ed)).toBe("P1"); // the listItem
    expect(ids["0.0.0"]).toBeUndefined(); // the deferred paragraph is cleared
    expect(ids["0"]).toMatch(/^[0-9a-f]{4}$/); // the list is genuinely new
    expect(new Set(liveUuids(ed)).size).toBe(liveUuids(ed).length);
  });

  it("M4b blockquote-ON: the blockquote takes the paragraph's identity", () => {
    const ed = mount([P("P1", "Hello"), P("P2", "World")]);
    caret(ed, "Hello");
    ed.chain().toggleBlockquote().run();
    const ids = idsByPath(ed);
    expect(ids["0"], outline(ed)).toBe("P1");
    expect(ids["0.0"]).toBeUndefined();
  });

  it("M4c a MULTI-paragraph wrap conserves EVERY paragraph, split items included", () => {
    // The reason direction 2 is result-shaped and not step-shaped: only the
    // first item comes from `wrapInList`'s ReplaceAroundStep — the rest are
    // minted by its plain `tr.split`, which carries no gap to read.
    const ed = mount([P("P1", "one"), P("P2", "two")]);
    ed.commands.setTextSelection({ from: 2, to: 9 });
    ed.chain().toggleBulletList().run();
    const ids = idsByPath(ed);
    expect(ids["0.0"], outline(ed)).toBe("P1");
    expect(ids["0.1"], outline(ed)).toBe("P2");
    expect(ids["0.0.0"]).toBeUndefined();
    expect(ids["0.1.0"]).toBeUndefined();
  });

  it("M5 blockquote-OFF: the lifted paragraph takes the blockquote's identity", () => {
    anchored.add("Q1");
    const ed = mount([QUOTE("Q1", P(null, "inner")), P("P2", "after")]);
    caret(ed, "inner");
    ed.chain().toggleBlockquote().run();
    expect(idsByPath(ed)["0"], outline(ed)).toBe("Q1");
    expect(huskFor(ed, "Q1"), outline(ed)).toBe(false);
    expect(drainOrphans()).not.toContain("Q1");
  });

  it("M7 bullet ⇄ numbered: the SAME list, so the SAME identity", () => {
    // Not in the reported cluster and found by the same rule: `toggleList`
    // re-types the container in place, and pre-499 the new `orderedList` got a
    // stranger's id while every card anchored to the list orphaned.
    anchored.add("L1");
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "A");
    ed.chain().toggleOrderedList().run();
    const ids = idsByPath(ed);
    expect(ed.state.doc.child(0).type.name).toBe("orderedList");
    expect(ids["0"], outline(ed)).toBe("L1");
    expect(ids["0.0"]).toBe("i1");
    expect(ids["0.1"]).toBe("i2");
    expect(huskFor(ed, "L1"), outline(ed)).toBe(false);
  });
});

// ── B2. undo/redo — a transfer must survive being taken back ────────────────

describe("499 — undo restores the exact pre-gesture identity, redo the conserved one", () => {
  it("Shift-Tab → undo → redo leaves no duplicate at any point", () => {
    // The backfill's own writes are `addToHistory: false`, so undo restores the
    // STRUCTURE without taking the transfer back: the inverted step re-wraps a
    // paragraph that by then carries the item's id inside a restored item that
    // carries it too. The deferred paragraph is invisible to the duplicate rule
    // (it is never a candidate), so the container-owns-it clear is what keeps
    // the invariant. Found by driving undo, not by inspection.
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "B");
    press(ed, "Tab", { shiftKey: true });
    expect(idsByPath(ed)["1"], outline(ed)).toBe("i2");
    expect(new Set(liveUuids(ed)).size).toBe(liveUuids(ed).length);

    ed.commands.undo();
    // Back exactly where we started — the item holds i2 and its body paragraph
    // holds nothing.
    expect(idsByPath(ed)["0.1"], outline(ed)).toBe("i2");
    expect(idsByPath(ed)["0.1.0"], outline(ed)).toBeUndefined();
    expect(new Set(liveUuids(ed)).size, outline(ed)).toBe(liveUuids(ed).length);

    ed.commands.redo();
    expect(idsByPath(ed)["1"], outline(ed)).toBe("i2");
    expect(new Set(liveUuids(ed)).size).toBe(liveUuids(ed).length);
  });

  it("toggle-list-ON → undo restores the paragraph's own identity", () => {
    const ed = mount([P("P1", "Hello")]);
    caret(ed, "Hello");
    ed.chain().toggleBulletList().run();
    expect(idsByPath(ed)["0.0"], outline(ed)).toBe("P1");
    ed.commands.undo();
    expect(idsByPath(ed)["0"], outline(ed)).toBe("P1");
    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
  });
});

// ── C. the controls — what must NOT be conserved ─────────────────────────────

describe("499 — the controls: a SPLIT still mints, and a re-parent that keeps its object takes nothing", () => {
  it("Tab / sinkListItem: the sunk item keeps its id, only the new list mints", () => {
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]);
    caret(ed, "B");
    expect(press(ed, "Tab")).toBe(true);
    const ids = idsByPath(ed);
    expect(ids["0"]).toBe("L1");
    expect(ids["0.0"]).toBe("i1");
    expect(ids["0.0.1"], outline(ed)).toMatch(/^[0-9a-f]{4}$/); // the new inner list
    expect(ids["0.0.1.0"]).toBe("i2"); // the item itself is unchanged
  });

  it("a nested item lifted to the OUTER list keeps its own id (the inner list is gone)", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P(null, "A"), LIST("L2", ITEM("i2", P(null, "B"))))),
    ]);
    caret(ed, "B");
    press(ed, "Tab", { shiftKey: true });
    const ids = idsByPath(ed);
    expect(ids["0"]).toBe("L1");
    expect(ids["0.0"]).toBe("i1");
    expect(ids["0.1"], outline(ed)).toBe("i2");
    expect(liveUuids(ed)).not.toContain("L2"); // it ceased to exist
  });

  it("a MID-container split-lift leaves the head half holding the id", () => {
    const ed = mount([QUOTE("Q1", P(null, "one"), P(null, "two"), P(null, "three"))]);
    caret(ed, "two");
    ed.chain().toggleBlockquote().run();
    const ids = idsByPath(ed);
    expect(ids["0"], outline(ed)).toBe("Q1"); // the surviving head
    expect(ids["1"]).toMatch(/^[0-9a-f]{4}$/); // the lifted paragraph is new
    expect(ids["1"]).not.toBe("Q1");
    expect(ids["2"]).not.toBe("Q1"); // and so is the tail half
  });

  it("a blockquote around a HEADING takes nothing — the heading is still a text object", () => {
    const ed = mount([
      { type: "heading", attrs: { level: 1, uuid: "H1" }, content: [{ type: "text", text: "Head" }] },
      P("P2", "x"),
    ]);
    caret(ed, "Head");
    ed.chain().toggleBlockquote().run();
    const ids = idsByPath(ed);
    expect(ids["0.0"], outline(ed)).toBe("H1");
    expect(ids["0"]).toMatch(/^[0-9a-f]{4}$/);
    expect(ids["0"]).not.toBe("H1");
  });

  it("an Enter SPLIT still mints for the tail (a split is not a move)", () => {
    const ed = mount([P("P1", "onetwo")]);
    ed.commands.setTextSelection(4);
    press(ed, "Enter");
    const ids = idsByPath(ed);
    expect(ids["0"]).toBe("P1");
    expect(ids["1"]).toMatch(/^[0-9a-f]{4}$/);
    expect(ids["1"]).not.toBe("P1");
  });

  it("plain typing moves no identity, with a list in the document", () => {
    // The behavioural half. The COST half is not observable from here —
    // TipTap's `transaction` event fires once per DISPATCH, not once per
    // APPENDED transaction, so counting it cannot tell a keystroke that
    // triggered a backfill from one that did not (measured: a leg that counted
    // it passed with a forced backfill on every keystroke). The appended-
    // transaction count is measured where `state.applyTransaction` returns it —
    // `block-uuid-backfill.test.ts`'s "does NO work on a structurally-null
    // keystroke" — and the pass's PLACEMENT behind the fast path is pinned by
    // the census below.
    const ed = mount([LIST("L1", ITEM("i1", P(null, "A"))), P("P2", "Hello")]);
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
    const before = idsByPath(ed);
    for (const ch of " world") {
      const { from, to } = ed.state.selection;
      const handled = ed.view.someProp("handleTextInput", (f) =>
        (f as (...a: unknown[]) => boolean)(ed.view, from, to, ch),
      );
      if (!handled) ed.commands.insertContent(ch);
    }
    expect(idsByPath(ed)).toEqual(before);
    expect(ed.state.doc.textContent).toContain("Hello world");
  });
});

// ── C2. the property sweep — uniqueness holds over the whole gesture family ──

describe("499 — every gesture in the family leaves a UNIQUE identity set", () => {
  // The one invariant this plugin has always owed, swept over the family rather
  // than pinned per case: no shape may end with two live nodes answering to one
  // uuid. A transfer that fired where it should not shows up here even when no
  // named leg happens to look at that node.
  const SHAPES: Array<{ name: string; build: () => Editor; at: string }> = [
    { name: "flat list", at: "B", build: () => mount([LIST("L1", ITEM("i1", P(null, "A")), ITEM("i2", P(null, "B")))]) },
    { name: "single-item list", at: "A", build: () => mount([LIST("L1", ITEM("i1", P(null, "A"))), P("z", "z")]) },
    { name: "nested list", at: "B", build: () => mount([LIST("L1", ITEM("i1", P(null, "A"), LIST("L2", ITEM("i2", P(null, "B")))))]) },
    { name: "multi-block item", at: "B2", build: () => mount([LIST("L1", ITEM("i1", P(null, "B"), P(null, "B2")))]) },
    { name: "blockquote", at: "one", build: () => mount([QUOTE("Q1", P(null, "one"), P(null, "two"))]) },
    { name: "quote in a list item", at: "q", build: () => mount([LIST("L1", ITEM("i1", P(null, "A"), QUOTE("Q1", P(null, "q"))))]) },
    { name: "plain prose", at: "A", build: () => mount([P("P1", "A"), P("P2", "B")]) },
  ];
  const GESTURES: Array<{ name: string; run: (ed: Editor) => void }> = [
    { name: "Shift-Tab", run: (ed) => void press(ed, "Tab", { shiftKey: true }) },
    { name: "Tab", run: (ed) => void press(ed, "Tab") },
    { name: "Backspace", run: (ed) => void press(ed, "Backspace") },
    { name: "bullet toggle", run: (ed) => void ed.chain().toggleBulletList().run() },
    { name: "numbered toggle", run: (ed) => void ed.chain().toggleOrderedList().run() },
    { name: "blockquote toggle", run: (ed) => void ed.chain().toggleBlockquote().run() },
  ];

  for (const shape of SHAPES) {
    for (const g of GESTURES) {
      it(`${g.name} on the ${shape.name}: ids stay unique, and undo/redo keep them so`, () => {
        const ed = shape.build();
        caret(ed, shape.at);
        const unique = (when: string) => {
          const all = liveUuids(ed);
          expect(new Set(all).size, `${when}\n${outline(ed)}`).toBe(all.length);
        };
        unique("before");
        g.run(ed);
        unique("after the gesture");
        ed.commands.undo();
        unique("after undo");
        ed.commands.redo();
        unique("after redo");
      });
    }
  }
});

// ── D. the census: the population is DISCOVERED, and every member is swept ───
//
// The rule was never the part that could misbehave — a re-parenting surface
// nobody exercised is. The net sees the transaction rather than the gesture, so
// a NEW surface is covered the moment it ships; what a census can still catch
// is the reverse — a command family member that this suite never drives, so
// nobody ever checked that the net really answers for its step shape. The
// population is discovered from production source; the allowlist is EMPTY.

const ROOT = join(__dirname, "..", "..", "..", "..");
function productionFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue; // a file that vanished mid-scan (a stale __pycache__ entry)
      }
      if (st.isDirectory()) {
        if (name === "__tests__" || name === "node_modules" || name === "__pycache__") continue;
        walk(full);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * The whole vocabulary that can change which container owns a block — the
 * Virgil-level spellings AND the upstream ones they route through, so a future
 * direct call to a raw ProseMirror/TipTap command is DISCOVERED rather than
 * silently outside the population.
 */
const REPARENT_COMMANDS = [
  "liftListItem",
  "sinkListItem",
  "toggleList",
  "toggleBulletList",
  "toggleOrderedList",
  "toggleBlockquote",
  "wrapInList",
  "wrapIn",
  "lift",
] as const;

/**
 * The members this suite drives, and how. An EXACT SET against what production
 * actually spells (both directions, below): a member production reaches and no
 * leg drives is a step shape nobody checked the net against, and a member no
 * production file spells any more is a claim to sweep something that is gone —
 * which would make the first leg pass for the wrong reason.
 *
 * `toggleList` / `wrapInList` / `wrapIn` / `lift` are the upstream mechanisms
 * the Virgil-level rows route through and are spelled in no Virgil file, so
 * they are in the vocabulary and not in this map. They ARE exercised — every
 * `toggle*` leg runs through them — which is exactly why a direct call to one
 * would still need its own leg: it would reach a step shape the rows never
 * produce.
 */
const SWEPT_COMMANDS: Partial<
  Record<(typeof REPARENT_COMMANDS)[number], string>
> = {
  liftListItem: "Shift-Tab (A), Backspace-at-item-start (M2), toggle-off (M3)",
  sinkListItem: "Tab (controls)",
  toggleBulletList: "M3, M3b, M4, M4c",
  toggleOrderedList: "M7",
  toggleBlockquote: "M4b, M5, and the split-lift + heading controls",
};

describe("499 CENSUS: every re-parenting command family is swept", () => {
  const SILOS = ["src", "library"].map((d) => join(ROOT, d));
  const FILES = SILOS.flatMap(productionFiles);

  it("every re-parenting command a production file can reach is named in SWEPT_COMMANDS", () => {
    const seen = new Set<string>();
    for (const file of FILES) {
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const cmd of REPARENT_COMMANDS) {
        if (new RegExp(`\\b${cmd}\\s*\\(`).test(code)) seen.add(cmd);
      }
    }
    expect(seen.size).toBeGreaterThan(0); // the scan can see the tree at all
    const unswept = [...seen].filter((c) => !(c in SWEPT_COMMANDS));
    expect(unswept, "a re-parenting command no leg drives — add a leg").toEqual([]);
  });

  it("SWEPT_COMMANDS names no command the tree has retired", () => {
    // A stale entry is a claim to sweep something that no longer exists, which
    // makes the leg above pass for the wrong reason.
    const called = new Set<string>();
    for (const file of FILES) {
      const code = codeOnly(readFileSync(file, "utf8"));
      for (const cmd of REPARENT_COMMANDS) {
        if (new RegExp(`\\b${cmd}\\s*\\(`).test(code)) called.add(cmd);
      }
    }
    for (const cmd of Object.keys(SWEPT_COMMANDS)) {
      expect(called.has(cmd), `${cmd} is swept but no production file calls it`).toBe(true);
    }
  });

  it("the direction-1 pass sits BEHIND the keystroke fast path", () => {
    // Keystroke sanctity, pinned structurally because it is not observable from
    // a mounted editor (see the typing leg above). `forEachReparentPlan` walks
    // every step of every transaction, which is O(1) per keystroke but not
    // ZERO; the early return is what makes a structurally-null edit cost
    // nothing at all, and it has to come first.
    const src = readFileSync(
      join(ROOT, "src/lib/tiptap/block-uuid-backfill.ts"),
      "utf8",
    );
    const fastPath = src.indexOf("if (candidates.length === 0) return [];");
    // The CALL inside `planBackfill`, not `reparentedUuids`'s own (which is
    // defined above it and takes the same door).
    const pass = src.indexOf("forEachReparentPlan(transactions, (plan, trk, k, si)");
    expect(fastPath, "the keystroke fast path is gone").toBeGreaterThan(-1);
    expect(pass, "the direction-1 pass is gone").toBeGreaterThan(-1);
    expect(pass, "the transfer pass runs BEFORE the fast path").toBeGreaterThan(fastPath);
  });

  it("the transfer rule has ONE implementation and ONE bypass key", () => {
    // The only way to reach the document past this net is a transaction wearing
    // the backfill's own meta, and the only way to answer the parentage
    // question twice is a second reader of a ReplaceAroundStep's gap.
    const offenders: string[] = [];
    for (const file of FILES) {
      const rel = file.slice(ROOT.length + 1);
      const code = codeOnly(readFileSync(file, "utf8"));
      if (rel === "src/lib/tiptap/block-uuid-backfill.ts") continue;
      if (/"blockUuidBackfill"/.test(code)) offenders.push(`${rel} (spells the bypass meta)`);
      if (/\bplanReparentTransfer\b/.test(code)) offenders.push(`${rel} (re-derives the rule)`);
      if (/\.gapFrom\b/.test(code)) offenders.push(`${rel} (reads a step gap itself)`);
    }
    expect(offenders).toEqual([]);
  });
});
