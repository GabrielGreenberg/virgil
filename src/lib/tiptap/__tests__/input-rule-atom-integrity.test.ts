// @vitest-environment jsdom
//
// Task 578 — a type-time rule may rewrite TEXT it matched; it NEVER deletes a
// non-text node.
//
// Every autocorrect / math / cite / footnote / comment input-rule fixture in the
// repo types into plain prose, where the matcher's STRING and the document's
// POSITIONS agree by construction — so a match window that reaches an inline
// ATOM was unrepresentable in all of them. Measured on the pre-578 tree:
//
//   - TipTap core's `getTextContentFromNodes` rendered a leaf atom as `%leaf%`
//     (6 characters, 1 PM slot), so a rule's `range.from` landed ON the atom and
//     autocorrect re-inserted its `%` lead over it: a footnote (body and all)
//     became a literal `%` in the `.tex`.
//   - the `$…$` handlers' body class spanned the U+FFFC placeholder, so a
//     footnote between two `$` was swallowed into the math `latex` attr.
//   - StarterKit's `*x*` / `` `x` `` mark rules threw `RangeError` out of
//     `handleTextInput`.
//
// Typed one character at a time through the shipped `handleTextInput` prop —
// `insertContent` fires no input rule at all and would pass every leg vacuously.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, getTextContentFromNodes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import type { SpellcheckPortRef } from "@/lib/spell/spell-port";
import { rangeHoldsOnlyText } from "../typed-prose-gate";

// ---------------------------------------------------------------------------
// Harness (the autocorrect-typing shape)
// ---------------------------------------------------------------------------

function portRef(): SpellcheckPortRef {
  return {
    current: {
      enabled: () => false,
      autocorrect: () => true,
      version: () => 0,
      onInvalidate: () => () => {},
      isAccepted: () => false,
      knownSync: () => undefined,
      ensure: async () => {},
      suggest: async () => [],
      acceptInPaper: () => {},
      acceptGlobally: () => {},
    },
  } as SpellcheckPortRef;
}

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
    spellcheckPortRef: portRef(),
  } as unknown as EditorExtensionsCtx;
}

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mount(content: unknown): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content as never,
  });
  live.push(ed);
  return ed;
}

function typeChar(ed: Editor, ch: string) {
  const { from, to } = ed.state.selection;
  const handled = ed.view.someProp("handleTextInput", (f) =>
    f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
  );
  if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
}

function typeText(ed: Editor, text: string) {
  for (const ch of text) typeChar(ed, ch);
}

function caretAt(ed: Editor, pos: number) {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

/** Caret at the end of the FIRST paragraph. */
function caretAtParagraphEnd(ed: Editor) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === "paragraph") pos = p + 1 + n.content.size;
    return pos < 0;
  });
  caretAt(ed, pos);
}

function nodesOf(ed: Editor, typeName: string): JSONContent[] {
  const out: JSONContent[] = [];
  ed.state.doc.descendants((n) => {
    if (n.type.name === typeName) out.push(n.toJSON() as JSONContent);
    return true;
  });
  return out;
}

function paragraphText(ed: Editor): string {
  let out = "";
  ed.state.doc.descendants((n) => {
    if (!out && n.type.name === "paragraph") out = n.textContent;
    return !out;
  });
  return out;
}

function docFromTex(body: string) {
  return parseLatex(
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
  );
}

/** The real node JSON for one atom, taken from a real parse. */
function atomJson(tex: string, typeName: string): JSONContent {
  const ed = mount(docFromTex(tex));
  const [n] = nodesOf(ed, typeName);
  expect(n).toBeTruthy();
  return n;
}

function para(...content: JSONContent[]) {
  return {
    type: "doc",
    content: [{ type: "paragraph", attrs: { uuid: "p1" }, content }],
  };
}
const txt = (text: string): JSONContent => ({ type: "text", text });

// ── the core alignment ──────────────────────────────────────────────────────

describe("the core matcher string speaks PM positions around a leaf atom", () => {
  it("a non-text inline leaf is ONE character in the matcher's text", () => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt("ab"), math, txt("cd")));
    caretAtParagraphEnd(ed);
    const $from = ed.state.selection.$from;
    const s = getTextContentFromNodes($from);
    expect(s).toBe("ab￼cd");
    expect(s.length).toBe($from.parentOffset);
  });
});

// ── the door ────────────────────────────────────────────────────────────────

describe("rangeHoldsOnlyText — the refusal door", () => {
  it("answers true over text and false over any range that reaches an atom", () => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt("ab"), math, txt("cd")));
    // paragraph content starts at 1: a=1 b=2 atom=3 c=4 d=5
    expect(rangeHoldsOnlyText(ed.state.doc, 1, 3)).toBe(true);
    expect(rangeHoldsOnlyText(ed.state.doc, 4, 6)).toBe(true);
    expect(rangeHoldsOnlyText(ed.state.doc, 2, 4)).toBe(false);
    expect(rangeHoldsOnlyText(ed.state.doc, 3, 4)).toBe(false);
    expect(rangeHoldsOnlyText(ed.state.doc, 3, 3)).toBe(true);
  });
});

// ── the reported members ────────────────────────────────────────────────────

describe("an input rule never deletes an inline atom in its match window", () => {
  it("autocorrect right after a footnote marker keeps the footnote AND its body", () => {
    const ed = mount(docFromTex("Claim.\\footnote{Important body.}"));
    caretAtParagraphEnd(ed);
    typeText(ed, "teh ");
    expect(nodesOf(ed, "footnote")).toHaveLength(1);
    expect(paragraphText(ed)).toBe("Claim.the ");
    const tex = serializeToLatex(ed.getJSON() as JSONContent);
    expect(tex).toContain("Important body.");
    expect(tex).not.toContain("\\%");
  });

  it("autocorrect right after inline math keeps the math", () => {
    const ed = mount(docFromTex("Value $x$teh"));
    caretAtParagraphEnd(ed);
    typeText(ed, " ");
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
    expect(paragraphText(ed)).toBe("Value the ");
  });

  it("autocorrect right after a hard break keeps the break node", () => {
    const ed = mount(para(txt("Line one"), { type: "hardBreak" }));
    caretAtParagraphEnd(ed);
    typeText(ed, "teh ");
    expect(nodesOf(ed, "hardBreak")).toHaveLength(1);
    expect(paragraphText(ed)).toBe("Line onethe ");
  });

  it("the `$…$` rule does not swallow a footnote between its dollars", () => {
    const fn = atomJson("a\\footnote{BODY} b", "footnote");
    const ed = mount(para(txt("a $b "), fn, txt(" c")));
    caretAtParagraphEnd(ed);
    typeText(ed, "$");
    expect(nodesOf(ed, "footnote")).toHaveLength(1);
    expect(nodesOf(ed, "inlineMath")).toHaveLength(0);
    expect(paragraphText(ed)).toBe("a $b  c$");
  });

  it("the `$$…$$` rule does not swallow an atom between its dollars", () => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt("$$a "), math, txt(" b$")));
    caretAtParagraphEnd(ed);
    typeText(ed, "$");
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
    expect(nodesOf(ed, "displayMath")).toHaveLength(0);
  });

  it("typed `\\footnote{…}` spanning an atom leaves the atom in place", () => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt("see\\footnote{a "), math, txt(" b")));
    caretAtParagraphEnd(ed);
    typeText(ed, "}");
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
    expect(nodesOf(ed, "footnote")).toHaveLength(0);
  });

  it("typed `\\cite{…}` spanning an atom leaves the atom in place", () => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt("see \\cite{a"), math, txt("b")));
    caretAtParagraphEnd(ed);
    typeText(ed, "}");
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
    expect(nodesOf(ed, "citation")).toHaveLength(0);
  });

  it("typed `%` at the start of a paragraph holding an atom keeps the atom", () => {
    const fn = atomJson("a\\footnote{BODY} b", "footnote");
    const ed = mount(para(fn, txt(" rest")));
    caretAt(ed, 1);
    typeText(ed, "%");
    expect(nodesOf(ed, "footnote")).toHaveLength(1);
    expect(nodesOf(ed, "latexComment")).toHaveLength(0);
  });

  it.each(["*", "`"])("StarterKit's `%s` mark rule over an atom neither throws nor deletes it", (d) => {
    const math = atomJson("x $y$ z", "inlineMath");
    const ed = mount(para(txt(`a ${d}b `), math, txt(" c")));
    caretAtParagraphEnd(ed);
    expect(() => typeText(ed, d)).not.toThrow();
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
  });
});

// ── controls: the rules still do their jobs ────────────────────────────────

describe("controls — every rule still fires over plain text", () => {
  it("`go $x$ teh ` still corrects the word after an atom", () => {
    const ed = mount(docFromTex("go $x$"));
    caretAtParagraphEnd(ed);
    typeText(ed, " teh ");
    expect(nodesOf(ed, "inlineMath")).toHaveLength(1);
    expect(paragraphText(ed)).toBe("go  the ");
  });

  it("`teh ` at block start corrects", () => {
    const ed = mount(para());
    caretAt(ed, 1);
    typeText(ed, "teh ");
    expect(paragraphText(ed)).toBe("the ");
  });

  it("`$a+b$` still becomes inline math", () => {
    const ed = mount(para());
    caretAt(ed, 1);
    typeText(ed, "$a+b$");
    expect(nodesOf(ed, "inlineMath").map((n) => n.attrs?.latex)).toEqual(["a+b"]);
  });

  it("`*x*` still italicizes", () => {
    const ed = mount(para(txt("a ")));
    caretAtParagraphEnd(ed);
    typeText(ed, "*x*");
    const json = JSON.stringify(ed.getJSON());
    expect(json).toContain('"italic"');
    expect(paragraphText(ed)).toBe("a x");
  });

  it("typed `\\cite{k}` still becomes a citation", () => {
    const ed = mount(para(txt("see ")));
    caretAtParagraphEnd(ed);
    typeText(ed, "\\cite{k}");
    expect(nodesOf(ed, "citation")).toHaveLength(1);
  });
});
