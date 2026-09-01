// @vitest-environment jsdom
//
// Task 519 — AUTOCORRECT, driven through the REAL editor.
//
// WHAT THIS PINS, and why no earlier suite could. A type-time WORD replacement
// has no reverse map: a smart quote written somewhere it should not have been
// round-trips (`typographyToLatex` turns `–` back into `--` on every save), and
// `\label{teh}` rewritten to `\label{the}` is a broken cross-reference, silently
// and forever. So the corrector needs a gate `SmartQuotes` deliberately does not
// take — and MEASURED on the real stack, the shape of that gate is not the one
// the task sketched:
//
//   - a SETTLED unmodelled command is ONE text node wearing `latexCommand`
//     (`["Alpha ", []] ["\\label{teh}", [latexCommand]] [" beta.", []]`), which
//     the mark rung sees;
//   - an IN-FLIGHT one is TWO nodes — `["\\textsc", [latexCommand]] ["{teh", []]`
//     — because `scanRawLatexSpans` fails CLOSED on an unbalanced group and so
//     claims the command NAME only. The mark rung sees nothing there, and one
//     keystroke later (the closing brace) the same bytes become raw LaTeX. A
//     verdict that depends on how far through a construct the user has typed is
//     not a verdict, so the second rung asks the LOOSE scanner the grey
//     `.latex-cmd` decoration already shares, whose own comment says it
//     "include[s] unclosed braces (user still typing)".
//   - `\emph{teh}` is the task's own example and is MODELLED: after a parse it is
//     `teh` wearing the ITALIC mark — ordinary prose — so a settled one is
//     corrected, and correctly. What the example really names is the IN-FLIGHT
//     `\emph{teh `, which rung 2 declines. Both are pinned.
//
// Typed one character at a time through the shipped `handleTextInput` prop: a
// single `insertContent` is a different transaction shape and fires no input
// rule at all, so every leg here would pass vacuously on it.
import { describe, it, expect, afterEach, vi } from "vitest";

// The extension barrel reaches `@/lib/storage`, whose backend `require` has no
// resolvable target under vitest — the standard stub for this stack.
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
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface FakePort extends SpellcheckPort {
  on: boolean;
  accepted: Set<string>;
}

function makePort(): { ref: SpellcheckPortRef; port: FakePort } {
  const port: FakePort = {
    on: true,
    accepted: new Set<string>(),
    enabled: () => false, // the CHECKER is irrelevant here — only the corrector
    autocorrect: () => port.on,
    version: () => 0,
    isAccepted: (w) => port.accepted.has(w.toLowerCase()),
    knownSync: () => undefined,
    ensure: async () => {},
    suggest: async () => [],
    acceptInPaper: () => {},
    acceptGlobally: () => {},
  };
  return { ref: { current: port }, port };
}

function mainCtx(portRef: SpellcheckPortRef | null): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: portRef,
  } as unknown as EditorExtensionsCtx;
}

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mount(content: unknown, portRef: SpellcheckPortRef | null): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(portRef)),
    content: content as never,
  });
  live.push(ed);
  return ed;
}

/** Type one character the way the browser feeds it to ProseMirror — through the
 *  shipped `handleTextInput` prop, falling back to a plain insert when no rule
 *  fires. `insertContentAt` would bypass the input-rule runner entirely. */
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

function caretAtEndOf(ed: Editor, typeName: string) {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && n.type.name === typeName) pos = p + 1 + n.content.size;
    return pos < 0;
  });
  expect(pos).toBeGreaterThan(-1);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

/** Caret just after the LAST character of `needle` in the document's text. */
function caretAfter(ed: Editor, needle: string) {
  const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, "\n");
  const idx = text.indexOf(needle);
  expect(idx).toBeGreaterThan(-1);
  // Paragraph text starts at document position 1 for a single-block fixture.
  const pos = idx + needle.length + 1;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
}

function textOf(ed: Editor, typeName: string): string {
  let out: string | null = null;
  ed.state.doc.descendants((n) => {
    if (out === null && n.type.name === typeName) out = n.textContent;
    return out === null;
  });
  return out ?? "";
}

const emptyPara = () => ({
  type: "doc",
  content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [] }],
});

function docFromTex(body: string) {
  return parseLatex(
    `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
  );
}

function bodyOf(tex: string): string {
  const m = tex.match(/\\begin\{document\}\n?([\s\S]*?)\n?\\end\{document\}/);
  return (m?.[1] ?? "").trim();
}

// ── 1. it corrects ordinary prose ───────────────────────────────────────────

describe("a curated typo is corrected as the word is finished", () => {
  it("`teh ` becomes `the ` — in the document AND in the .tex", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    expect(textOf(ed, "paragraph")).toBe("the ");
    expect(bodyOf(serializeToLatex(ed.getJSON() as JSONContent))).toContain("the");
  });

  it("mid-sentence, with the surrounding words untouched", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "one of teh cases");
    expect(textOf(ed, "paragraph")).toBe("one of the cases");
  });

  it("fires on a PUNCTUATION boundary, and touches neither case nor the mark", () => {
    // Done-when #4: `teh.` at the start of a sentence corrects the WORD and
    // nothing else — no capital is introduced, the full stop is carried
    // through verbatim.
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh.");
    expect(textOf(ed, "paragraph")).toBe("the.");
  });

  it("preserves a typed capital and declines every other casing", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "Teh a TEH b tEh c");
    expect(textOf(ed, "paragraph")).toBe("The a TEH b tEh c");
  });

  it("only on a WHOLE word — a typo inside a longer word is left alone", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "Tehran and atteh ");
    expect(textOf(ed, "paragraph")).toBe("Tehran and atteh ");
  });
});

// ── 2. the gate — where it must NOT fire ────────────────────────────────────

describe("the gate: a word swap never reaches raw LaTeX", () => {
  it("SETTLED — a `\\label{teh}` key survives an edit inside it", () => {
    // THE DEFECT. Pre-519 (and with the gate neutered) the input rule fires
    // here exactly as `SmartQuotes` does, and the cross-reference silently
    // becomes `\label{the}`.
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha \\label{teh} beta."), ref);
    caretAfter(ed, "teh");
    typeChar(ed, " ");
    expect(textOf(ed, "paragraph")).toBe("Alpha \\label{teh } beta.");
    expect(bodyOf(serializeToLatex(ed.getJSON() as JSONContent))).toContain("\\label{teh }");
  });

  it("SETTLED — an unmodelled `\\textsc{teh}` likewise", () => {
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha \\textsc{teh} beta."), ref);
    caretAfter(ed, "teh");
    typeChar(ed, " ");
    expect(textOf(ed, "paragraph")).toBe("Alpha \\textsc{teh } beta.");
  });

  it("SETTLED — a THREE-argument command, which only the MARK rung can see", () => {
    // The two scanners deliberately differ, and this is where. The LOOSE one
    // (`matchCommandLength`, which the grey decoration paints from) caps a
    // command at TWO braced arguments; the lexer's `scanRawLatexSpans` — which
    // is what the carrier MARK is derived from — consumes the whole argument
    // run, a cap task 349 removed there and not here. MEASURED on
    // `Alpha \addcontentsline{toc}{section}{teh} beta.`: the loose scan claims
    // [6, 36) and stops before `teh` at 37, while the mark covers the run
    // whole. So rung 1 is not redundant with rung 2 — and a carrier run's
    // bytes are raw LaTeX BY DECLARATION: the corrector does not adjudicate
    // which argument of which command happens to read like prose.
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha \\addcontentsline{toc}{section}{teh} beta."), ref);
    caretAfter(ed, "teh");
    typeChar(ed, " ");
    expect(textOf(ed, "paragraph")).toBe(
      "Alpha \\addcontentsline{toc}{section}{teh } beta.",
    );
  });

  it("IN FLIGHT — typing `\\textsc{teh ` declines, although nothing is marked yet", () => {
    // Rung 2. At the trigger the document is `["\\textsc" latexCommand]
    // ["{teh" NO MARKS]`, so rung 1 sees nothing: the loose scanner is the only
    // thing that can answer, and it is the same one the grey span is painted
    // from.
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "\\textsc{teh ");
    expect(textOf(ed, "paragraph")).toBe("\\textsc{teh ");
  });

  it("IN FLIGHT — the task's own `\\emph{teh ` example", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "\\emph{teh ");
    expect(textOf(ed, "paragraph")).toBe("\\emph{teh ");
  });

  it("…and a SETTLED `\\emph{teh}` IS corrected — because it is italic PROSE", () => {
    // Measured, and stated rather than hidden: `\emph` is MODELLED, so a parse
    // turns it into the italic MARK. There is no raw LaTeX left to protect and
    // correcting the word is right. The gate is about BYTES, not about which
    // command they were once written with.
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha \\emph{teh} beta."), ref);
    caretAfter(ed, "teh");
    typeChar(ed, " ");
    expect(textOf(ed, "paragraph")).toBe("Alpha the  beta.");
  });

  it("a `%` comment block declines — the framework's gate, inherited", () => {
    const { ref } = makePort();
    const ed = mount(
      {
        type: "doc",
        content: [
          { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "a" }] },
          { type: "latexComment", attrs: { uuid: "c1" }, content: [{ type: "text", text: "todo " }] },
        ],
      },
      ref,
    );
    caretAtEndOf(ed, "latexComment");
    typeText(ed, "teh ");
    expect(textOf(ed, "latexComment")).toBe("todo teh ");
  });

  it("a code block declines", () => {
    const { ref } = makePort();
    const ed = mount(
      {
        type: "doc",
        content: [{ type: "codeBlock", attrs: { uuid: "k1" }, content: [{ type: "text", text: "x " }] }],
      },
      ref,
    );
    caretAtEndOf(ed, "codeBlock");
    typeText(ed, "teh ");
    expect(textOf(ed, "codeBlock")).toBe("x teh ");
  });

  it("an inline `\\verb` run declines — its carrier is a `code` mark", () => {
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha \\verb|teh| beta."), ref);
    caretAfter(ed, "teh");
    typeChar(ed, " ");
    expect(textOf(ed, "paragraph")).toContain("teh ");
    expect(textOf(ed, "paragraph")).not.toContain("the ");
  });
});

// ── 3. the two authorities it asks ──────────────────────────────────────────

describe("it asks the document's own answers about words", () => {
  it("a word the user ACCEPTED is not a typo", () => {
    const { ref, port } = makePort();
    port.accepted.add("teh");
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    expect(textOf(ed, "paragraph")).toBe("teh ");
  });

  it("the preference turns it off entirely", () => {
    const { ref, port } = makePort();
    port.on = false;
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    expect(textOf(ed, "paragraph")).toBe("teh ");
  });

  it("a surface that declared NO port never corrects", () => {
    const ed = mount(emptyPara(), null);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    expect(textOf(ed, "paragraph")).toBe("teh ");
  });
});

// ── 4. it is an ordinary edit ───────────────────────────────────────────────

describe("the correction is an ordinary, reversible edit", () => {
  it("Backspace immediately after restores the TYPED bytes exactly", () => {
    // TipTap's core keymap runs `undoInputRule` first on Backspace, which
    // reverts the rule's transform and puts back what the user actually typed
    // — the escape hatch for a correction they did not want.
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    expect(textOf(ed, "paragraph")).toBe("the ");
    const undone = ed.view.someProp("handleKeyDown", (f) =>
      f(ed.view, new KeyboardEvent("keydown", { key: "Backspace" })),
    );
    expect(undone).toBe(true);
    expect(textOf(ed, "paragraph")).toBe("teh ");
  });

  it("undo reaches it — it is in the history, never `addToHistory: false`", () => {
    const { ref } = makePort();
    const ed = mount(emptyPara(), ref);
    caretAtEndOf(ed, "paragraph");
    typeText(ed, "teh ");
    ed.commands.undo();
    expect(textOf(ed, "paragraph")).not.toBe("the ");
  });

  it("corrected prose round-trips byte-clean over two cycles", () => {
    const { ref } = makePort();
    const ed = mount(docFromTex("Alpha beta."), ref);
    caretAfter(ed, "Alpha");
    typeText(ed, " teh gamma");
    const first = ed.getJSON() as JSONContent;
    assignUuids(first);
    const one = serializeToLatex(first);
    expect(bodyOf(one)).toContain("Alpha the gamma beta.");
    const reparsed = parseLatex(one);
    assignUuids(reparsed);
    const two = serializeToLatex(reparsed);
    expect(two).toBe(one);
  });
});
