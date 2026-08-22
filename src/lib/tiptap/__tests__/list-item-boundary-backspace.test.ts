// @vitest-environment jsdom
//
// Task 2026-08-21-418 — the list keymap's boundary predicate.
//
// REPORTED (Gabriel, GGlaptop, v0.1.95, "SEP Contents of Perception"): "if i try
// to delete the line after 'spatial relations to the self' it breaks the list.
// in general there are a lot of issues with deleting empty lines under lists."
//
// The shape on screen is a list item with TWO children — `listItem(paragraph
// ("Spatial relations to the self"), paragraph(""))` — which Virgil's schema
// (`(paragraph | graphicsBlock) block*`) makes first-class and which arrives
// from ordinary `.tex` with no user gesture (task 348's `tailSep`).
//
// MECHANISM (measured here, not assumed). Upstream `ListKeymap`'s two halves
// ask "is the caret at the boundary of the list ITEM?" from two different
// scopes: `Delete` resolves the item and compares against ITS end, while
// `Backspace` compares `$from.parentOffset` — the offset inside the TEXTBLOCK.
// So a caret at the start of the item's SECOND block took the item-start
// branch. Two of the filed diagnosis's predictions are REFUTED by measurement
// and recorded rather than assumed:
//
//   • the reported case takes the **lift** branch, not `joinItemBackward` — the
//     branch selector `hasListItemBefore` probes `$anchor.pos - 2`, the same
//     textblock-scoped mistake one helper over, and from a later paragraph that
//     lands inside the PREVIOUS PARAGRAPH of the same item;
//   • an empty paragraph directly after a list is **already deleted correctly**
//     on this schema. Both after-the-list shapes are pinned below as CONTROLS.
//
// WHY NO EXISTING SUITE COULD SEE IT. `listKeymap`, `joinItemBackward` and
// `liftListItem` appear in no file under `src/`; there is no list Backspace /
// Delete suite anywhere, and every list fixture in the repo has SINGLE-block
// items, where the textblock-scoped and the item-scoped questions coincide by
// construction. Every leg here drives `view.someProp("handleKeyDown", …)` on
// the REAL `buildEditorExtensions("main")` stack — a direct `tr` dispatch
// cannot see this at all, since the defect lives entirely in which command the
// keymap chooses.
import { describe, expect, it, vi } from "vitest";

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
import { codeOnly } from "@/lib/__tests__/_source-scan";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { isAtEndOfNode } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { atListItemStart, findEnclosingListItem, listKeymapOwnsBackspace } from "@/lib/tiptap/list-keymap";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids, serializeBodyOnly } from "@/lib/latex-serializer";

// ── harness ──────────────────────────────────────────────────────────────────

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

/** Caret at the start (or end) of the node carrying `uuid`. */
function caret(ed: Editor, uuid: string, where: "start" | "end") {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && (n.attrs as { uuid?: string })?.uuid === uuid) {
      pos = where === "start" ? p + 1 : p + n.nodeSize - 1;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no node #${uuid}`);
  ed.commands.setTextSelection(pos);
}

/** An indented outline — one line per node, `type#uuid("text")`. */
function outline(ed: Editor): string {
  const lines: string[] = [];
  ed.state.doc.descendants((n, pos) => {
    if (n.isText) return false;
    const d = ed.state.doc.resolve(pos).depth;
    const u = (n.attrs as { uuid?: string | null })?.uuid;
    lines.push(
      `${"  ".repeat(d)}${n.type.name}${u ? `#${u}` : ""}` +
        (n.isTextblock ? `("${n.textContent}")` : ""),
    );
    return true;
  });
  return lines.join("\n");
}

/** Every surviving `listItem` uuid, in document order. */
function itemUuids(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === "listItem") {
      const u = (n.attrs as { uuid?: string | null })?.uuid;
      out.push(u ?? "<none>");
    }
    return true;
  });
  return out;
}

const P = (uuid: string, text?: string): JSONContent => ({
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

/** Gabriel's reported geography, verbatim in shape. */
const REPORTED = () =>
  mount([
    LIST(
      "L1",
      ITEM("i1", P("p1", "Representational of self")),
      ITEM("i2", P("p2", "Spatial relations to the self"), P("p3")),
    ),
  ]);

// ── A. the predicate — one rule, both halves ─────────────────────────────────

describe("418 — the item-boundary predicate is ITEM-scoped, on both edges", () => {
  it("atListItemStart is true ONLY at the item's own start", () => {
    const ed = REPORTED();

    caret(ed, "p2", "start"); // the item's FIRST child, offset 0 — the item start
    expect(atListItemStart(ed.state, "listItem")).toBe(true);

    caret(ed, "p3", "start"); // the item's SECOND child, offset 0 — NOT the item start
    expect(atListItemStart(ed.state, "listItem")).toBe(false);

    caret(ed, "p2", "end"); // mid-item
    expect(atListItemStart(ed.state, "listItem")).toBe(false);
    ed.destroy();
  });

  it("the two halves now agree: the START twin mirrors upstream's item-scoped END", () => {
    // The whole defect was that these two answered from different scopes.
    // `isAtEndOfNode(state, "listItem")` has always resolved the ENCLOSING ITEM
    // and compared against ITS end; `atListItemStart` is its mirror. The later
    // block is deliberately NON-EMPTY here: in an EMPTY one the block's start
    // and its end are the SAME position, so the two questions coincide by
    // accident and the leg would prove nothing.
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B"), P("p3", "second para"))),
    ]);

    caret(ed, "p2", "start"); // the item's own start — and not its end
    expect(atListItemStart(ed.state, "listItem")).toBe(true);
    expect(isAtEndOfNode(ed.state, "listItem")).toBe(false);

    caret(ed, "p3", "start"); // a LATER block's start — neither boundary.
    // Pre-418 the START half answered TRUE here. That is the whole defect.
    expect(atListItemStart(ed.state, "listItem")).toBe(false);
    expect(isAtEndOfNode(ed.state, "listItem")).toBe(false);

    caret(ed, "p2", "end"); // an EARLIER block's end — not the item's end
    expect(atListItemStart(ed.state, "listItem")).toBe(false);
    expect(isAtEndOfNode(ed.state, "listItem")).toBe(false);

    caret(ed, "p3", "end"); // the item's LAST block's end — the item's own end
    expect(atListItemStart(ed.state, "listItem")).toBe(false);
    expect(isAtEndOfNode(ed.state, "listItem")).toBe(true);
    ed.destroy();
  });

  it("resolves the INNERMOST item, so a nested item's own boundary is the one asked about", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A"), LIST("L2", ITEM("i1a", P("p1a", "nested"))))),
    ]);
    caret(ed, "p1a", "start");
    expect(findEnclosingListItem(ed.state, "listItem")?.node.attrs.uuid).toBe("i1a");
    expect(atListItemStart(ed.state, "listItem")).toBe(true);
    ed.destroy();
  });

  it("is false for a non-collapsed selection, and outside a list the keymap keeps its branches", () => {
    const ed = REPORTED();
    const { doc } = ed.state;
    let from = -1;
    doc.descendants((n, p) => {
      if (from < 0 && (n.attrs as { uuid?: string })?.uuid === "p2") from = p + 1;
      return true;
    });
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(doc, from, from + 4)),
    );
    expect(atListItemStart(ed.state, "listItem")).toBe(false);
    expect(listKeymapOwnsBackspace(ed.state, "listItem")).toBe(false);
    ed.destroy();
  });
});

// ── B. Backspace — the defect legs ───────────────────────────────────────────

describe("418 — Backspace inside a list item's LATER block stays inside the item", () => {
  it("M1 (reported): the empty second paragraph merges away; the item and the list survive", () => {
    const ed = REPORTED();
    caret(ed, "p3", "start");

    expect(press(ed, "Backspace")).toBe(true);

    // Pre-fix: the whole `i2` item was LIFTED OUT of the list — its uuid gone,
    // its two paragraphs sitting at top level beside the one-item list.
    expect(outline(ed)).toContain('listItem#i2');
    expect(itemUuids(ed)).toEqual(["i1", "i2"]);
    const item = ed.state.doc.child(0).child(1);
    expect(item.childCount).toBe(1);
    expect(item.textContent).toBe("Spatial relations to the self");
    expect(ed.state.doc.child(0).type.name).toBe("bulletList");
    ed.destroy();
  });

  it("M2: same with NO previous sibling item — the item is not lifted out either", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "First"), P("p2")))]);
    caret(ed, "p2", "start");

    expect(press(ed, "Backspace")).toBe(true);

    // Pre-fix: the whole list disappeared, its content lifted to top level.
    expect(ed.state.doc.child(0).type.name).toBe("bulletList");
    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).child(0).childCount).toBe(1);
    expect(ed.state.doc.child(0).textContent).toBe("First");
    ed.destroy();
  });

  it("M3: a NON-empty later paragraph joins the paragraph ABOVE IT, inside the item", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B"), P("p3", "second para"))),
    ]);
    caret(ed, "p3", "start");

    expect(press(ed, "Backspace")).toBe(true);

    // Pre-fix: the item was lifted out and the user's prose left the list.
    expect(itemUuids(ed)).toEqual(["i1", "i2"]);
    const item = ed.state.doc.child(0).child(1);
    expect(item.childCount).toBe(1);
    expect(item.textContent).toBe("Bsecond para");
    ed.destroy();
  });

  it("NESTED: a later block of a NESTED item is the nested item's business", () => {
    const ed = mount([
      LIST(
        "L1",
        ITEM(
          "i1",
          P("p1", "A"),
          LIST("L2", ITEM("i1a", P("p1a", "nested")), ITEM("i1b", P("p1b", "n2"), P("p1c"))),
        ),
      ),
    ]);
    caret(ed, "p1c", "start");

    expect(press(ed, "Backspace")).toBe(true);

    // Pre-fix: `i1b` was lifted one level and became a sibling of `i1`.
    expect(itemUuids(ed)).toEqual(["i1", "i1a", "i1b"]);
    const inner = ed.state.doc.child(0).child(0).child(1);
    expect(inner.type.name).toBe("bulletList");
    expect(inner.childCount).toBe(2);
    expect(inner.child(1).childCount).toBe(1);
    expect(inner.child(1).textContent).toBe("n2");
    ed.destroy();
  });

  it("generalizes past paragraphs: a later BLOCKQUOTE child does not cost the item either", () => {
    const ed = mount([
      LIST(
        "L1",
        ITEM("i1", P("p1", "A")),
        ITEM("i2", P("p2", "B"), {
          type: "blockquote",
          attrs: { uuid: "bq" },
          content: [P("bqp", "quoted")],
        }),
      ),
    ]);
    caret(ed, "bqp", "start");

    expect(press(ed, "Backspace")).toBe(true);

    // The quote is lifted INTO the item (plain ProseMirror) — the item lives.
    expect(itemUuids(ed)).toEqual(["i1", "i2"]);
    expect(ed.state.doc.child(0).child(1).textContent).toBe("Bquoted");
    ed.destroy();
  });
});

// ── B'. Backspace — the controls, byte-for-byte as before ────────────────────

describe("418 — the genuine item-start branches are preserved exactly", () => {
  it("CONTROL true item start, previous sibling without a sublist → joins into it", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B")))]);
    caret(ed, "p2", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).child(0).textContent).toBe("AB");
    ed.destroy();
  });

  it("CONTROL true item start, no previous sibling → lifts out of the list", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "A")))]);
    caret(ed, "p1", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual([]);
    expect(ed.state.doc.child(0).type.name).toBe("paragraph");
    expect(ed.state.doc.child(0).textContent).toBe("A");
    ed.destroy();
  });

  it("CONTROL true item start, previous item HAS a sublist → lifts (never joins)", () => {
    const ed = mount([
      LIST(
        "L1",
        ITEM("i1", P("p1", "A"), LIST("L2", ITEM("i1a", P("p1a", "nested")))),
        ITEM("i2", P("p2", "B")),
      ),
    ]);
    caret(ed, "p2", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1", "i1a"]);
    expect(ed.state.doc.child(1).type.name).toBe("paragraph");
    expect(ed.state.doc.child(1).textContent).toBe("B");
    ed.destroy();
  });

  it("CONTROL an EMPTY bullet (the item's only child) still deletes the bullet", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2")))]);
    caret(ed, "p2", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).textContent).toBe("A");
    ed.destroy();
  });

  it("CONTROL an EMPTY paragraph after the list is deleted, list untouched", () => {
    // The filed member 4 ("it is cut into the last item instead") is REFUTED on
    // this schema — measured pre-fix and pinned here so the gate cannot change it.
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "A"))), P("gap"), P("tail", "tail prose")]);
    caret(ed, "gap", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.doc.child(0).textContent).toBe("A");
    expect(ed.state.doc.child(1).textContent).toBe("tail prose");
    ed.destroy();
  });

  it("CONTROL a NON-empty paragraph after the list still merges into the last item", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A"))),
      P("gap", "merge me"),
      P("tail", "tail prose"),
    ]);
    caret(ed, "gap", "start");

    expect(press(ed, "Backspace")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).child(0).textContent).toBe("Amerge me");
    expect(ed.state.doc.child(1).textContent).toBe("tail prose");
    ed.destroy();
  });

  it("CONTROL mid-paragraph Backspace is nobody's business (plain character delete)", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B"), P("p3", "xy"))),
    ]);
    caret(ed, "p3", "end");
    const before = outline(ed);

    expect(press(ed, "Backspace")).toBe(false);

    expect(outline(ed)).toBe(before);
    ed.destroy();
  });
});

// ── C. Delete — the half that already asked the right question ───────────────

describe("418 — forward Delete is unchanged at every one of the four positions", () => {
  it("at the end of an EARLIER block it deletes the empty later block, item intact", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B"), P("p3"))),
    ]);
    caret(ed, "p2", "end");

    expect(press(ed, "Delete")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1", "i2"]);
    expect(ed.state.doc.child(0).child(1).childCount).toBe(1);
    ed.destroy();
  });

  it("at the item's true END it joins the next item forward", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "A")), ITEM("i2", P("p2", "B")))]);
    caret(ed, "p1", "end");

    expect(press(ed, "Delete")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).child(0).textContent).toBe("AB");
    ed.destroy();
  });

  it("at the end of a later block that IS the item's end it joins forward too", () => {
    const ed = mount([
      LIST("L1", ITEM("i1", P("p1", "A"), P("p2", "second")), ITEM("i2", P("p3", "B"))),
    ]);
    caret(ed, "p2", "end");

    expect(press(ed, "Delete")).toBe(true);

    expect(itemUuids(ed)).toEqual(["i1"]);
    expect(ed.state.doc.child(0).child(0).textContent).toBe("AsecondB");
    ed.destroy();
  });

  it("mid-paragraph Delete is nobody's business", () => {
    const ed = mount([LIST("L1", ITEM("i1", P("p1", "AB")))]);
    caret(ed, "p1", "start");

    expect(press(ed, "Delete")).toBe(false);
    ed.destroy();
  });
});

// ── D. the `.tex` round trip the shape comes from ────────────────────────────

describe("418 — the multi-block item's `.tex` is a fixed point and keeps its identities", () => {
  it("parse → serialize → parse → serialize is byte-identical from cycle 1", () => {
    const src =
      "\\begin{itemize}\n  \\item A %!v:aaaa\n  \\item B\n\n %!v:bbbb %!v:cccc\n\\end{itemize} %!v:dddd\n";
    const d1 = parseLatex(src);
    assignUuids(d1);
    const t1 = serializeBodyOnly(d1);
    const d2 = parseLatex(t1);
    assignUuids(d2);
    const t2 = serializeBodyOnly(d2);

    expect(t2).toBe(t1);
    // The two ITEM uuids and the LIST uuid are the anchor identities the
    // keymap was destroying; they survive the round trip unchanged.
    expect(t1).toContain("%!v:aaaa");
    expect(t1).toContain("%!v:cccc");
    expect(t1).toContain("%!v:dddd");
    // `bbbb` deliberately does NOT survive, and that is not a loss: `listItem`
    // is a DEFERRING_PARENT, so an inner paragraph yields identity to the item
    // (`assignUuids`), and an empty deferred paragraph serializes to the
    // `%!v:blank` sentinel. Pinned so the normalization is a decision, not a
    // surprise.
    expect(t1).toContain("%!v:blank");
    expect(t1).not.toContain("%!v:bbbb");
  });

  it("the parsed shape IS the two-child item the keymap mis-handled", () => {
    const src =
      "\\begin{itemize}\n  \\item A %!v:aaaa\n  \\item B\n\n %!v:bbbb %!v:cccc\n\\end{itemize} %!v:dddd\n";
    const doc = parseLatex(src);
    const list = (doc.content ?? [])[0];
    const second = (list?.content ?? [])[1];
    expect(second?.type).toBe("listItem");
    expect(second?.attrs?.uuid).toBe("cccc");
    expect((second?.content ?? []).length).toBe(2);
    expect((second?.content ?? [])[1]?.content).toBeFalsy(); // the empty line
  });
});

// ── E. the census — the gate was never the part that could misbehave ─────────

describe("418 — census: nothing may restore the textblock-scoped keymap", () => {
  const ROOT = join(__dirname, "..", "..", "..", "..");
  const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("the one StarterKit configure site turns `listKeymap` OFF and registers the replacement", () => {
    // Dropping either half silently restores the destruction: upstream's
    // `ListKeymap` would own Backspace again, with every behavioural leg above
    // failing only because it is driven through the real stack.
    const src = read("src/lib/editor-extensions.ts");
    expect(src).toContain("listKeymap: false");
    expect(src).toContain("VirgilListKeymap");
  });

  it("no production file registers upstream's ListKeymap or re-derives the boundary question", () => {
    // Read CODE, not prose: this module and its header discuss `ListKeymap` and
    // `isAtStartOfNode` by name, which is the point — the needle must see the
    // registration, not the explanation. (`codeOnly` blanks comments AND string
    // literals; neither needle lives in a literal here.)
    const files = [
      "src/lib/editor-extensions.ts",
      "src/lib/tiptap/list-keymap.ts",
      "src/lib/tiptap/index.ts",
    ];
    let examined = 0;
    for (const f of files) {
      const src = codeOnly(read(f));
      examined++;
      // `ListKeymap` as a registered extension — the shadowing hazard. `\b`
      // does not match inside `VirgilListKeymap`, which is the replacement.
      expect(src, f).not.toMatch(/\bListKeymap\b/);
      // `isAtStartOfNode` is the textblock-scoped predicate this task retires;
      // nothing here may ask it about a list item.
      expect(src, f).not.toContain("isAtStartOfNode");
    }
    expect(examined).toBe(3);
    // The stripper must not have swallowed the file — a needle that matches
    // nothing because the source vanished is a vacuous guard.
    expect(codeOnly(read("src/lib/tiptap/list-keymap.ts"))).toContain(
      "VirgilListKeymap",
    );
  });

  it("only the gate module reaches upstream's list helpers", () => {
    // A second caller of `handleBackspace` would be a second, ungated door.
    const gate = codeOnly(read("src/lib/tiptap/list-keymap.ts"));
    expect(gate).toContain("listHelpers.handleBackspace");
    expect(gate).toContain("listKeymapOwnsBackspace");
    for (const f of ["src/lib/editor-extensions.ts", "src/lib/tiptap/index.ts"]) {
      expect(codeOnly(read(f)), f).not.toContain("listHelpers");
    }
  });
});
