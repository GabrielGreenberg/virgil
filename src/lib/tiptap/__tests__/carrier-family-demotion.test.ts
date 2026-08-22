// @vitest-environment jsdom
//
// Task 2026-08-21-407 — the carrier FAMILY demotes, not just `latexCommand`.
//
// Task 390 gave `latexCommand` a type-time derivation in BOTH directions and
// wrote the law down: *deleting what made a run LaTeX is a WRITER too.* Its two
// SIBLING carriers were left one-way, and the law applies to them verbatim.
//
//  - **The comment tail was the SILENT leg.** The parser pushes a whole tail
//    INCLUDING its `%` as ONE text node under `latexCommentTail`; ProseMirror
//    rebuilds a backspaced text node as `text.slice(1)` carrying the same marks
//    array, and nothing anywhere removed the mark. The serializer's arm then
//    emits the run's bytes VERBATIM with no `%` re-prefix anywhere — it assumes
//    `raw` already begins with one, which is precisely the assumption a
//    demotion-less carrier breaks. So `x % TODO cite` minus its `%` reached the
//    `.tex` as LIVE BODY TEXT and the user's annotation started typesetting in
//    the PDF, as a FIXED POINT: the next parse reads unmarked prose and the `%`
//    is gone for good.
//  - **The inline `\verb` twin is LOUD.** Delete its lead and `verb|100% sure|`
//    reaches the `.tex` with a live `%` that comments out the rest of that
//    source line; delete a delimiter and the paper stops compiling.
//
// WHY NO EXISTING SUITE COULD SEE EITHER. Grepping `removeMark|Backspace|
// deleteRange` across `comment-carrier-roundtrip`, `latex-comment-derived-
// states`, `latex-verbatim-byte-fidelity` and `carrier-mark-composition`
// returns ZERO: every one of them drives PARSE → SERIALIZE over source the
// parser produced, where a carrier run always spells its own construct and the
// divergence is unrepresentable. The defect lives in the gap between what a
// keystroke leaves in the document and what a save then makes of it, so every
// leg here drives a REAL editor over the REAL `buildEditorExtensions("main")`
// stack and then serializes.
//
// And the FIX is a whitelist, never a blacklist — see `THE TRAP` below the
// refusal-carrier legs.
import { describe, expect, it, afterEach, vi } from "vitest";

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
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildBorrowedAtomSchema } from "@/lib/tiptap/borrowed-schema";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  CARRIER_MARK_NAMES,
  CARRIER_ROWS,
  LATEX_COMMENT_TAIL_MARK,
  LATEX_VERBATIM_MARK,
  carrierRowFor,
  verbatimMark,
} from "@/lib/latex-lexer";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

/** Production source, comments and string literals blanked — the drift lives
 *  in CODE, and every needle below is a symbol. */
function readSource(rel: string): string {
  return codeOnly(readFileSync(resolve(process.cwd(), rel), "utf8"));
}

/** The body of the declaration `header` opens, to its matching brace. Scoped
 *  per DECLARATION rather than per FILE: a hand list two functions away is a
 *  different question, and a file-scoped needle would be answered by the
 *  table's own row definitions. */
function declarationOf(src: string, header: string): string {
  const at = src.indexOf(header);
  if (at < 0) throw new Error(`no declaration ${JSON.stringify(header)}`);
  const open = src.indexOf("{", at);
  if (open < 0) throw new Error(`no body for ${JSON.stringify(header)}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`unbalanced body for ${JSON.stringify(header)}`);
}

// ── harness ──────────────────────────────────────────────────────────────────

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

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

function texOf(body: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

function bodyOf(tex: string): string {
  const m = tex.match(/\\begin\{document\}\n?([\s\S]*?)\n?\\end\{document\}/);
  return (m?.[1] ?? "").trim();
}

/** The REAL main stack over the REAL parse of `body`. */
function mount(body: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions(mainCtx()),
    content: parseLatex(texOf(body)) as never,
  });
  return editor;
}

/** What the autosave would write for the editor's current document. */
function saved(ed: Editor): string {
  return bodyOf(serializeToLatex(ed.getJSON() as JSONContent));
}

/** Save, re-parse, save again — the FIXED-POINT check every red leg owes. A
 *  demotion that is not a fixed point is a byte the next open moves again. */
function reSaved(bytes: string): string {
  return bodyOf(serializeToLatex(parseLatex(texOf(bytes))));
}

interface RunView {
  text: string;
  mark: string;
  form?: string;
}

/** Every run in the document that still carries a FAMILY carrier. */
function carrierRuns(ed: Editor): RunView[] {
  const out: RunView[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "text") {
      for (const m of n.marks ?? []) {
        if (!CARRIER_MARK_NAMES.includes(m.type)) continue;
        out.push({
          text: n.text ?? "",
          mark: m.type,
          ...(m.attrs?.form ? { form: m.attrs.form as string } : {}),
        });
      }
    }
    (n.content ?? []).forEach(walk);
  };
  (ed.getJSON().content ?? []).forEach(walk);
  return out;
}

/** Absolute document position of the `nth` occurrence of `needle`. */
function posOf(ed: Editor, needle: string, nth = 0): number {
  let seen = 0;
  let found = -1;
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0 || !node.isText) return true;
    const text = node.text ?? "";
    let at = text.indexOf(needle);
    while (at !== -1) {
      if (seen === nth) {
        found = pos + at;
        return false;
      }
      seen++;
      at = text.indexOf(needle, at + 1);
    }
    return true;
  });
  if (found < 0) throw new Error(`no occurrence ${nth} of ${JSON.stringify(needle)}`);
  return found;
}

/** Delete `len` characters at `pos` — the Backspace gesture, as a range. */
function delAt(ed: Editor, pos: number, len = 1) {
  ed.commands.deleteRange({ from: pos, to: pos + len });
}

// ── A. the comment tail — the SILENT leg ─────────────────────────────────────

describe("a comment tail whose `%` an edit removed is PROSE", () => {
  it("THE DEFECT: the annotation stops being a comment and is ESCAPED", () => {
    const ed = mount("x % TODO cite");
    expect(carrierRuns(ed)).toEqual([
      { text: "% TODO cite", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    expect(saved(ed)).toBe("x % TODO cite");

    delAt(ed, posOf(ed, "%"));

    // Pre-407 the mark survived and the serializer emitted ` TODO cite` RAW —
    // live body text, typesetting in the PDF, and a fixed point.
    expect(carrierRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("x  TODO cite");
    expect(reSaved(saved(ed))).toBe(saved(ed));
  });

  it("THE BYTE HAZARD: a `%` left INSIDE the demoted run emits ESCAPED", () => {
    // The severity, and why this is not a styling bug. A run that keeps the
    // carrier keeps its EMIT-RAW contract, so an interior `%` reaches the
    // `.tex` LIVE — where it comments out the rest of that source line, and
    // where the next parse reads everything after it as a fresh comment tail.
    const ed = mount("x % 50% off");
    delAt(ed, posOf(ed, "%"));
    expect(carrierRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("x  50\\% off");
    expect(reSaved(saved(ed))).toBe(saved(ed));
  });

  it("holds at the SECOND push site — a `%` line inside an `\\ex` body", () => {
    // `latex-parser.ts`'s example-body branch pushes the same mark for a `%`
    // line an example item's schema cannot hold. Same row, same demotion — and
    // it is asserted rather than assumed, because the two push sites are 3 200
    // lines apart and neither knows about the other.
    const ed = mount("\\ex\n% a note\nThe cat sat.\n\\xe");
    expect(carrierRuns(ed)).toEqual([
      { text: "% a note", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    delAt(ed, posOf(ed, "%"));
    expect(carrierRuns(ed)).toEqual([]);
    expect(saved(ed)).toContain(" a note");
    expect(saved(ed)).not.toContain("% a note");
    expect(reSaved(saved(ed))).toBe(reSaved(reSaved(saved(ed))));
  });

  it("STATED COLLATERAL: a demoted tail that carried LaTeX prints it", () => {
    // `% see \cite{a}` minus its `%` escapes to ` see \textbackslash{}cite\{a\}`
    // — the user's command becomes a printed literal. Law-consistent (the bytes
    // ARE prose now) and a fixed point, but surprising, so it is pinned rather
    // than discovered.
    const ed = mount("x % see \\cite{a}");
    delAt(ed, posOf(ed, "%"));
    expect(saved(ed)).toBe("x  see \\textbackslash{}cite\\{a\\}");
    expect(reSaved(saved(ed))).toBe(saved(ed));
  });
});

describe("an INTACT comment tail never demotes", () => {
  it("survives an edit elsewhere in its own paragraph", () => {
    const ed = mount("hello % note");
    ed.commands.insertContentAt(posOf(ed, "hello"), "Z");
    expect(carrierRuns(ed)).toEqual([
      { text: "% note", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    expect(saved(ed)).toBe("Zhello % note");
  });

  it("survives an edit INSIDE itself", () => {
    const ed = mount("x % note");
    ed.commands.insertContentAt(posOf(ed, "note") + 2, "Z");
    expect(carrierRuns(ed)).toEqual([
      { text: "% noZte", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    expect(saved(ed)).toBe("x % noZte");
  });

  it("survives an INTERIOR NEWLINE, which the serializer re-comments", () => {
    // `closeCommentTail` documents this shape as reachable by EDITING and not
    // by parsing, and re-comments the continuation lines. The claim is
    // therefore newline-TOLERANT by construction — `matchCommentTailAt` stops
    // at the first newline and still answers non-null. A claim written as "the
    // whole run is one comment line" would demote exactly the shape the
    // serializer has an arm for.
    const ed = mount("x % note");
    ed.commands.insertContentAt(posOf(ed, "note"), "\n");
    const runs = carrierRuns(ed);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toContain("\n");
    expect(runs[0].mark).toBe(LATEX_COMMENT_TAIL_MARK);
    expect(saved(ed)).toBe("x % \n%note");
  });

  it("survives an edit that leaves the `%` in place at the very edge", () => {
    // A deletion's changed range is ZERO-WIDTH in the new document, so the run
    // is TOUCHED here — the demotion is declined by the CLAIM, not by the
    // scoping, which is the half that matters.
    const ed = mount("xy % note");
    delAt(ed, posOf(ed, "y"));
    expect(carrierRuns(ed)).toEqual([
      { text: "% note", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    expect(saved(ed)).toBe("x % note");
  });
});

// ── B. the inline `\verb` twin — the LOUD leg ────────────────────────────────

describe("a broken inline `\\verb` run is PROSE", () => {
  const BREAKS: [string, string, string][] = [
    ["its lead `\\`", "\\", "A verb|100\\% sure| B"],
    ["a letter of its NAME", "e", "A \\textbackslash{}vrb|100\\% sure| B"],
    ["its OPENING delimiter", "|", "A \\textbackslash{}verb100\\% sure| B"],
  ];
  for (const [what, ch, expected] of BREAKS) {
    it(`deleting ${what} demotes the run and ESCAPES its bytes`, () => {
      const ed = mount("A \\verb|100% sure| B");
      expect(carrierRuns(ed)).toEqual([
        { text: "\\verb|100% sure|", mark: LATEX_VERBATIM_MARK, form: "inline" },
      ]);
      // Pre-407 the mark survived, so the payload's `%` reached the `.tex`
      // LIVE and commented out the rest of that source line.
      delAt(ed, posOf(ed, ch));
      expect(carrierRuns(ed)).toEqual([]);
      expect(saved(ed)).toBe(expected);
      expect(reSaved(saved(ed))).toBe(saved(ed));
    });
  }

  it("deleting the CLOSING delimiter demotes — no unterminated `\\verb` on disk", () => {
    // The compile-breaking shape: pre-407 the run kept the carrier and an
    // unterminated `\verb` reached the `.tex`, so the paper stopped compiling
    // — and on re-parse `matchInlineVerbAt` returns -1, so the bytes were not
    // verbatim to the parser either.
    const ed = mount("A \\verb|x| B");
    delAt(ed, posOf(ed, "|", 1));
    expect(carrierRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("A \\textbackslash{}verb|x B");
    expect(reSaved(saved(ed))).toBe(saved(ed));
  });
});

describe("an INTACT inline `\\verb` run never demotes", () => {
  it("survives an edit elsewhere in its own paragraph", () => {
    const ed = mount("A \\verb|x| B");
    ed.commands.insertContentAt(posOf(ed, "A"), "Z");
    expect(carrierRuns(ed)).toEqual([
      { text: "\\verb|x|", mark: LATEX_VERBATIM_MARK, form: "inline" },
    ]);
    expect(saved(ed)).toBe("ZA \\verb|x| B");
  });

  it("survives an edit INSIDE its payload, which re-spells a valid run", () => {
    const ed = mount("A \\verb|x| B");
    ed.commands.insertContentAt(posOf(ed, "x") + 1, "y");
    expect(carrierRuns(ed)).toEqual([
      { text: "\\verb|xy|", mark: LATEX_VERBATIM_MARK, form: "inline" },
    ]);
    expect(saved(ed)).toBe("A \\verb|xy| B");
  });

  it("asks the question of the whole RUN, not of each text node", () => {
    // Another mark landing inside a `\verb` run splits it into three text
    // nodes with three different mark ARRAYS — ProseMirror merges adjacent
    // text nodes only on mark-set IDENTITY. Asking each third "do you spell a
    // `\verb` run?" answers no three times and demotes all three, taking the
    // byte-literal contract off the user's source. So runs are merged by ROW,
    // and only the row, before the question is asked.
    const element = document.createElement("div");
    document.body.appendChild(element);
    const inline = verbatimMark("inline");
    editor = new Editor({
      element,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A " },
              { type: "text", text: "\\", marks: [inline] },
              { type: "text", text: "verb", marks: [inline, { type: "bold" }] },
              { type: "text", text: "|xy|", marks: [inline] },
              { type: "text", text: " B" },
            ],
          },
        ],
      } as never,
    });
    expect(carrierRuns(editor)).toHaveLength(3);
    // An edit beside the run must leave every third alone: the merged run
    // still spells `\verb|xy|`.
    editor.commands.insertContentAt(posOf(editor, "A"), "Z");
    expect(carrierRuns(editor)).toHaveLength(3);
    // …and breaking it really does take all three off, so the leg above is not
    // passing because nothing ever demotes here.
    delAt(editor, posOf(editor, "|", 1));
    expect(carrierRuns(editor)).toEqual([]);
  });
});

// ── C. the REFUSAL carriers never demote ─────────────────────────────────────
//
// THE TRAP, stated because a text-shape guard is the obvious wrong fix. At
// demotion time a run's own text CANNOT distinguish a damaged inline `\verb`
// from an arbitrary carrier: a `\begingl…` gloss and an example child's bytes
// both fail every lexer door. Any predicate written over the TEXT is a
// heuristic blacklist that leaks onto all four carrier shapes below — and a
// demoted carrier leaves through the escape rung (`\`→`\textbackslash{}`,
// `{`→`\{`), which destroys a screenful of the user's source on ONE keystroke:
// strictly worse than the stale mark it would be fixing. So the row is read
// from PROVENANCE recorded at the push site, and these legs pin every site that
// records it.

const REFUSAL_SHAPES: [string, string, string][] = [
  [
    "an unmodeled environment carrier",
    "\\begin{lstlisting}\ncode here\n\\end{lstlisting}",
    "\\begin{lstlisting}\ncode here\n\\end{lstlisting}",
  ],
  [
    "a `\\begingl` gloss refused for having NO tier marker",
    "\\begingl\nplain body no tiers\n\\endgl",
    "\\begingl\nplain body no tiers\n\\endgl",
  ],
  [
    "a `\\begingl` gloss refused for INERT bytes among its tiers",
    "\\begingl\n\\gla a b //\n% inert\n\\glb c d //\n\\endgl",
    "\\begingl\n\\gla a b //\n% inert\n\\glb c d //\n\\endgl",
  ],
  [
    "an example child the item's schema cannot hold",
    "\\ex\n\\begin{tabular}{cc}\na & b\\\\\n\\end{tabular}\n\\xe",
    "\\begin{tabular}{cc}\na & b\\\\\n\\end{tabular}",
  ],
  [
    "a `verbatim` env preserved inside an example",
    "\\ex\n\\begin{verbatim}\nx=1\n\\end{verbatim}\n\\xe",
    "\\begin{verbatim}\nx=1\n\\end{verbatim}",
  ],
];

describe("the REFUSAL carrier never demotes, whatever the edit", () => {
  for (const [what, body, carried] of REFUSAL_SHAPES) {
    it(`${what} records \`form: "carrier"\` and keeps it`, () => {
      const ed = mount(body);
      expect(carrierRuns(ed)).toEqual([
        { text: carried, mark: LATEX_VERBATIM_MARK, form: "carrier" },
      ]);
      // An edit INSIDE it — the shape that damages a construct — changes the
      // bytes and nothing else. A blacklist would demote here and the whole
      // carried source would come back escaped.
      delAt(ed, posOf(ed, carried.slice(1, 4)));
      const runs = carrierRuns(ed);
      expect(runs).toHaveLength(1);
      expect(runs[0].mark).toBe(LATEX_VERBATIM_MARK);
      expect(runs[0].form).toBe("carrier");
      // The run lost exactly the byte the edit removed, and NOTHING went
      // through the escape rung — the whole point of the refusal row.
      expect(runs[0].text).toBe(carried.replace(carried.slice(1, 4), carried.slice(2, 4)));
      expect(saved(ed)).toContain(runs[0].text);
      expect(saved(ed)).not.toContain("\\textbackslash{}");
    });
  }
});

// ── D. scoping and the shared exemptions ─────────────────────────────────────

describe("the demotion is TOUCH-scoped and inherits every exemption", () => {
  it("an edit in a DIFFERENT block demotes nothing", () => {
    const ed = mount("first paragraph\n\ntwo % note");
    ed.commands.insertContentAt(posOf(ed, "first"), "Z");
    expect(carrierRuns(ed)).toEqual([
      { text: "% note", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
  });

  it("an ALREADY-BROKEN run in the SAME block survives an unrelated edit", () => {
    // The half no INTACT fixture can reach, and the one the scoping is for. A
    // stale run is reachable in production: a card body persisted BEFORE this
    // fix stores its marks directly, so a `%`-less `latexCommentTail` comes
    // back off disk wearing the carrier. Task 390's rule governs it — a missed
    // demotion is the status quo, a wrong one rewrites bytes the user never
    // touched — so the mark comes off only when the edit REACHES the run.
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "prose here and more prose " },
              { type: "text", text: " stale", marks: [{ type: LATEX_COMMENT_TAIL_MARK }] },
            ],
          },
        ],
      } as never,
    });
    editor.commands.insertContentAt(posOf(editor, "prose"), "Z");
    expect(carrierRuns(editor)).toEqual([
      { text: " stale", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    // …and an edit that DOES reach it takes the mark off, so the leg above is
    // not passing because nothing here can demote at all.
    editor.commands.insertContentAt(posOf(editor, "stale"), "Q");
    expect(carrierRuns(editor)).toEqual([]);
  });

  it("a document REPLACEMENT is not a writer — an already-broken run survives", () => {
    // The load and the code-pane bridge's re-parse both replace 0…docSize, and
    // their content already carries whatever the parse rung decided. Scanning
    // it would demote every stale mark in the file on OPEN, with no gesture.
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: buildEditorExtensions(mainCtx()),
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: " already broken", marks: [{ type: LATEX_COMMENT_TAIL_MARK }] },
            ],
          },
        ],
      } as never,
    });
    expect(carrierRuns(editor)).toHaveLength(1);
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: " still broken", marks: [{ type: LATEX_COMMENT_TAIL_MARK }] },
          ],
        },
      ],
    } as never);
    expect(carrierRuns(editor)).toHaveLength(1);
  });

  it("UNDO restores the mark rather than re-deriving it", () => {
    const ed = mount("x % TODO");
    delAt(ed, posOf(ed, "%"));
    expect(carrierRuns(ed)).toEqual([]);
    ed.commands.undo();
    expect(carrierRuns(ed)).toEqual([
      { text: "% TODO", mark: LATEX_COMMENT_TAIL_MARK },
    ]);
    expect(saved(ed)).toBe("x % TODO");
  });
});

// ── E. the family table is the ONE census ────────────────────────────────────

describe("the family is stated once", () => {
  it("`CARRIER_MARK_NAMES` is DERIVED from the rows, with no duplicates", () => {
    expect([...CARRIER_MARK_NAMES].sort()).toEqual(
      [...new Set(CARRIER_ROWS.map((r) => r.mark))].sort(),
    );
    expect(CARRIER_MARK_NAMES).toContain(LATEX_COMMENT_TAIL_MARK);
    expect(CARRIER_MARK_NAMES).toContain(LATEX_VERBATIM_MARK);
  });

  it("every row's mark is REGISTERED on both surfaces", () => {
    // The premise check (task 148's instrument): the table is a fact about
    // marks the schema has to actually have, on BOTH the main editor and the
    // card bodies — the plugin is registered on `LatexCommandMark`, so a card
    // surface that mounts it inherits the demotion for marks it also mounts.
    const main = mount("hello");
    for (const name of CARRIER_MARK_NAMES) {
      expect(main.schema.marks[name], `main: ${name}`).toBeTruthy();
    }
    const card = new Editor({
      extensions: [StarterKit, ...buildBorrowedAtomSchema()] as never,
      content: "<p></p>",
    });
    try {
      for (const name of CARRIER_MARK_NAMES) {
        expect(card.schema.marks[name], `card: ${name}`).toBeTruthy();
      }
    } finally {
      card.destroy();
    }
  });

  it("`carrierRowFor` fails to the SAFE row on a lost `form`", () => {
    // An older stored card body (an archived excerpt, a footnote sidecar
    // written before the attr existed) carries no attrs at all, and a clipboard
    // round trip through a DOM that never rendered the attribute carries none
    // either. A missed demotion is the status quo; a wrong one escapes the
    // user's source — so every unrecognized answer is the REFUSAL row.
    for (const attrs of [undefined, null, {}, { form: "nonsense" }, { form: 3 }]) {
      const row = carrierRowFor(LATEX_VERBATIM_MARK, attrs);
      expect(row?.form).toBe("carrier");
      expect(row?.claims).toBeNull();
    }
    expect(carrierRowFor(LATEX_VERBATIM_MARK, { form: "inline" })?.claims).toBeTypeOf(
      "function",
    );
    expect(carrierRowFor("bold")).toBeUndefined();
  });

  it("`verbatimMark` REQUIRES a form and always emits the attrs key", () => {
    // ProseMirror's `Mark.toJSON()` emits an `attrs` key as soon as the type
    // declares any attribute, so the two producers — this parser and a live
    // editor — have to agree byte-for-byte: a footnote/card body compares
    // parser JSON against `editor.getJSON()` to decide whether to re-set its
    // content.
    expect(verbatimMark("inline")).toEqual({
      type: LATEX_VERBATIM_MARK,
      attrs: { form: "inline" },
    });
    expect(verbatimMark("carrier")).toEqual({
      type: LATEX_VERBATIM_MARK,
      attrs: { form: "carrier" },
    });
    expect(verbatimMark.length).toBe(1);
  });

  it("the form survives a DOM round trip, and a carrier renders no attribute", () => {
    // A copy/paste inside the app goes through the DOM, so the distinction has
    // to render — otherwise every pasted inline `\verb` becomes a refusal
    // carrier that can never demote. Only `"inline"` is written, so a carrier's
    // markup is byte-identical to what it was before the attr existed.
    const ed = mount("A \\verb|x| B\n\n\\begin{lstlisting}\nz\n\\end{lstlisting}");
    const html = ed.getHTML();
    expect(html).toContain('data-verbatim-form="inline"');
    expect(html).not.toContain('data-verbatim-form="carrier"');
    expect([...html.matchAll(/data-verbatim-form/g)]).toHaveLength(1);

    // The FORM is what must survive; the newlines are HTML's own whitespace
    // collapse and are not this attr's business.
    ed.commands.setContent(html);
    expect(carrierRuns(ed).map((r) => [r.mark, r.form])).toEqual([
      [LATEX_VERBATIM_MARK, "inline"],
      [LATEX_VERBATIM_MARK, "carrier"],
    ]);
    expect(carrierRuns(ed)[0].text).toBe("\\verb|x|");
  });

  it("the OPAQUE predicate reads the derived set, not a hand list", () => {
    // The census with teeth. `isOpaqueRun` is what keeps a `latexCommand` scan
    // out of a sibling's bytes, and it named the two marks by hand — so a
    // fourth carrier would have been invisible to it while being perfectly
    // visible to the table. Membership is DISCOVERED from the source, so this
    // cannot pass by someone remembering to update a list in the guard.
    const src = readSource("src/lib/tiptap/latex-command.ts");
    const decl = declarationOf(src, "function isOpaqueRun");
    expect(decl).toContain("SIBLING_CARRIER_MARKS");
    expect(decl).not.toContain(LATEX_VERBATIM_MARK);
    expect(decl).not.toContain(LATEX_COMMENT_TAIL_MARK);
    expect(decl).not.toContain("LATEX_VERBATIM_MARK");
    expect(decl).not.toContain("LATEX_COMMENT_TAIL_MARK");
    // …and the set it reads is the table's own census.
    const setDecl = declarationOf(src, "const SIBLING_CARRIER_MARKS");
    expect(setDecl).toContain("CARRIER_MARK_NAMES");
  });

  it("every push site names its form — no `verbatimMark()` survives", () => {
    // The door was never the part that could misbehave; a push site that omits
    // the form is, and TypeScript's error there names the CALL rather than the
    // decision. Membership is DISCOVERED from both silos.
    for (const file of [
      "src/lib/latex-parser.ts",
      "src/lib/footnote-content.ts",
      "src/lib/latex-lexer.ts",
    ]) {
      const src = readSource(file);
      const bare = [...src.matchAll(/verbatimMark\(\s*\)/g)];
      expect(bare, `${file} spells a form-less verbatimMark()`).toEqual([]);
    }
  });
});

// ── F. the card/footnote surface ─────────────────────────────────────────────

describe("the card/footnote surface demotes as well", () => {
  it("a broken `\\verb` in a card body emits ESCAPED", () => {
    // The plugin is registered on the MARK, so the fork inherits the fix — but
    // the fork has its OWN inline parser and its OWN escape rung and the two
    // have drifted before (task 341), so it is pinned rather than assumed.
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, ...buildBorrowedAtomSchema()] as never,
      content: richLatexToJson("a \\verb|9% x| b") as never,
    });
    expect(carrierRuns(editor)).toEqual([
      { text: "\\verb|9% x|", mark: LATEX_VERBATIM_MARK, form: "inline" },
    ]);
    expect(richJsonToLatex(editor.getJSON() as JSONContent)).toBe("a \\verb|9% x| b");

    delAt(editor, posOf(editor, "\\"));
    expect(carrierRuns(editor)).toEqual([]);
    expect(richJsonToLatex(editor.getJSON() as JSONContent)).toBe("a verb|9\\% x| b");
  });

  it("a card body's REFUSAL carrier is untouched by an edit inside it", () => {
    // An archived excerpt captures a document slice, so a refusal carrier is
    // reachable in a stored card body — and there the mark is the only thing
    // standing between the user's carried source and the escape rung.
    const element = document.createElement("div");
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [StarterKit, ...buildBorrowedAtomSchema()] as never,
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "\\begin{lstlisting}\nz\n\\end{lstlisting}",
                marks: [verbatimMark("carrier")],
              },
            ],
          },
        ],
      } as never,
    });
    delAt(editor, posOf(editor, "b"));
    const runs = carrierRuns(editor);
    expect(runs).toHaveLength(1);
    expect(runs[0].form).toBe("carrier");
    expect(richJsonToLatex(editor.getJSON() as JSONContent)).not.toContain(
      "\\textbackslash{}",
    );
  });
});
