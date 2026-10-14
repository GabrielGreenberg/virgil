// @vitest-environment jsdom
//
// Task 1107 — the wrapper gate's IDENTITY half is DERIVED from the commands,
// not a hand list of node names. The old `LISTABLE_BLOCK_TYPES =
// {paragraph, listItem}` was wrong in two directions:
//
//   1. it greyed "make this image a list item" although task 563 lets a
//      `listItem` open with a `graphicsBlock` and `wrapInList` places it
//      losslessly;
//   2. it applied the LIST coercion rule (TipTap's `toggleList` → `clearNodes()`)
//      to the QUOTE, whose `wrapIn` never coerces — greying `\begin{quote}`
//      around display math, code, a comment, an image, a heading.
//
// WHAT IS PROVEN
//   • list toggles on a graphicsBlock are enabled and yield
//     `bulletList > listItem > graphicsBlock` with the image's attrs intact;
//   • a quote toggle around every block kind the quote's content model admits
//     is enabled, AND the result survives serialize → parse with the child's
//     own bytes inside `\begin{quote}` (the round trip the gate now relies on);
//   • list toggles on a heading / title / expex item are STILL refused (the
//     clearNodes / lift-out paths) — and the doc is untouched when forced;
//   • a mixed paragraph + display-math selection lists losslessly.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { wrapperSafeInState } from "@/lib/tiptap/wrapper-gate";
import { PREAMBLE_RESIDENT_NODE_TYPES } from "@/lib/node-attr-sets";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const wrapTex = (body: string) =>
  `\\documentclass{article}\\begin{document}\n${body}\n\\end{document}`;

/** Structural shape (types only) — what a lossy round trip would change. */
function shape(n: JSONContent): string {
  if (n.type === "text") return "";
  const kids = (n.content ?? []).map(shape).filter(Boolean);
  return kids.length ? `${n.type}(${kids.join(",")})` : `${n.type}`;
}

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

/** Mount the REAL main stack over parsed LaTeX; put the selection on the
 *  top-level block at `index` (NodeSelection for an atom, caret otherwise). */
function mountAt(body: string, index: number): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(wrapTex(body)),
  });
  editors.push(editor);
  let target = -1;
  let i = 0;
  editor.state.doc.forEach((_n, off) => {
    if (i++ === index) target = off;
  });
  const node = editor.state.doc.nodeAt(target)!;
  const sel = node.isAtom
    ? NodeSelection.create(editor.state.doc, target)
    : TextSelection.near(editor.state.doc.resolve(target + 1));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
  return editor;
}

const topTypes = (e: Editor) => {
  const out: string[] = [];
  e.state.doc.forEach((n) => out.push(n.type.name));
  return out;
};

describe("task 1107 — list toggles on an image block", () => {
  it("enables bullet + numbered on a top-level graphicsBlock and wraps it losslessly", () => {
    const editor = mountAt("Intro.\n\n\\includegraphics[width=2in]{foo.png}\n\nOutro.", 1);
    expect(topTypes(editor)[1]).toBe("graphicsBlock");
    const before = editor.state.doc.child(1).attrs;
    expect(wrapperSafeInState(editor.state, "bulletList")).toBe(true);
    expect(wrapperSafeInState(editor.state, "orderedList")).toBe(true);

    expect(editor.commands.toggleBulletList()).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.type.name).toBe("bulletList");
    const item = list.child(0);
    expect(item.type.name).toBe("listItem");
    expect(item.child(0).type.name).toBe("graphicsBlock");
    expect(item.child(0).attrs.command).toBe(before.command);
    expect(serializeBodyOnly(editor.getJSON())).toContain("\\includegraphics[width=2in]{foo.png}");
  });
});

describe("task 1107 — quote toggles around every block the quote admits round-trip", () => {
  const CASES: Array<[string, string, string]> = [
    ["displayMath", "\\[ x = y \\]", "x = y"],
    ["codeBlock", "\\begin{verbatim}\ncode here\n\\end{verbatim}", "code here"],
    ["graphicsBlock", "\\includegraphics{foo.png}", "\\includegraphics{foo.png}"],
    ["heading", "\\section{Head}", "\\section{Head}"],
    ["latexComment", "% a comment", "% a comment"],
  ];
  for (const [kind, src, bytes] of CASES) {
    it(`${kind}: quote ENABLED, wraps, and survives serialize → parse`, () => {
      const editor = mountAt(`Intro.\n\n${src}\n\nOutro.`, 1);
      expect(topTypes(editor)[1]).toBe(kind);
      expect(wrapperSafeInState(editor.state, "blockquote")).toBe(true);
      expect(editor.commands.toggleBlockquote()).toBe(true);
      const after = editor.getJSON();
      expect(shape(after)).toContain(`blockquote(${kind}`);
      const tex = serializeBodyOnly(after);
      const quoteBody = tex.slice(tex.indexOf("\\begin{quote}"), tex.indexOf("\\end{quote}"));
      expect(quoteBody).toContain(bytes);
      expect(shape(parseLatex(wrapTex(tex)))).toBe(shape(after));
    });
  }
});

describe("task 1107 — refusals the derivation must keep", () => {
  it("a heading still refuses bullet + numbered (no clearNodes coercion)", () => {
    const editor = mountAt("Intro.\n\n\\section{Head}\n\nOutro.", 1);
    expect(wrapperSafeInState(editor.state, "bulletList")).toBe(false);
    expect(wrapperSafeInState(editor.state, "orderedList")).toBe(false);
  });

  it("a titleField refuses all three wrappers", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: buildEditorExtensions(mainCtx()),
      content: parseLatex(
        "\\documentclass{article}\\title{A Title}\\begin{document}\n\\maketitle\n\nBody.\n\\end{document}",
      ),
    });
    editors.push(editor);
    let titlePos = -1;
    editor.state.doc.descendants((n, pos) => {
      if (titlePos < 0 && n.type.name === "titleField") titlePos = pos;
      return titlePos < 0;
    });
    expect(titlePos).toBeGreaterThanOrEqual(0);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(titlePos + 1))),
    );
    for (const w of ["bulletList", "orderedList", "blockquote"] as const) {
      expect(wrapperSafeInState(editor.state, w)).toBe(false);
    }
  });

  it("a caret in an expex item still refuses all three wrappers (task 397)", () => {
    const editor = mountAt("Intro.\n\n\\pex\n\\a foo bar\n\\a baz\n\\xe\n\nOutro.", 1);
    let inner = -1;
    editor.state.doc.descendants((n, pos) => {
      if (inner < 0 && n.type.name === "paragraph" && n.textContent.includes("foo")) inner = pos;
      return inner < 0;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, inner + 2)),
    );
    expect(editor.state.selection.$from.node(-1).type.name).toBe("exampleItem");
    for (const w of ["bulletList", "orderedList", "blockquote"] as const) {
      expect(wrapperSafeInState(editor.state, w)).toBe(false);
    }
  });

  it("a mixed paragraph + display-math selection lists losslessly", () => {
    const editor = mountAt("Lead para.\n\n\\[ x = y \\]\n\nOutro.", 0);
    // From inside the lead paragraph to inside "Outro." — the block range is
    // [paragraph, displayMath, paragraph].
    const end = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, end + 2)),
    );
    expect(wrapperSafeInState(editor.state, "bulletList")).toBe(true);
    expect(editor.commands.toggleBulletList()).toBe(true);
    // The equation rides inside the item it follows (canSplit refuses an item
    // that would open with display math) — nothing is lifted out or coerced.
    expect(shape(editor.getJSON())).toMatch(
      /^doc\(bulletList\(listItem\(paragraph,displayMath\),listItem\(paragraph\)\)/,
    );
    const tex = serializeBodyOnly(editor.getJSON());
    expect(tex).toContain("x = y");
    expect(tex).toContain("Outro.");
  });
});

describe("task 1107 — PREAMBLE_RESIDENT_NODE_TYPES premise", () => {
  function titleDoc(): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: buildEditorExtensions(mainCtx()),
      content: parseLatex(
        "\\documentclass{article}\\title{A Title}\\begin{document}\n\\maketitle\n\nBody.\n\\end{document}",
      ),
    });
    editors.push(editor);
    return editor;
  }

  it("every member serializes EMPTY in body position — so a wrapper around it would save empty", () => {
    const editor = titleDoc();
    const seen = new Set<string>();
    editor.state.doc.forEach((n) => {
      if (!PREAMBLE_RESIDENT_NODE_TYPES.has(n.type.name)) return;
      seen.add(n.type.name);
      const quoted = { type: "doc", content: [{ type: "blockquote", content: [n.toJSON()] }] };
      const tex = serializeBodyOnly(quoted);
      const body = tex.slice(tex.indexOf("\\begin{quote}") + "\\begin{quote}".length, tex.indexOf("\\end{quote}"));
      expect(body.trim()).toBe("");
    });
    expect([...seen].sort()).toEqual([...PREAMBLE_RESIDENT_NODE_TYPES].sort());
  });

  it("a mixed title + paragraph selection refuses every wrapper", () => {
    const editor = titleDoc();
    const size = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, size - 1)));
    for (const w of ["bulletList", "orderedList", "blockquote"] as const) {
      expect(wrapperSafeInState(editor.state, w)).toBe(false);
    }
  });
});
