// @vitest-environment jsdom
/**
 * The TYPE-TIME carrier — bare text is prose BY CONSTRUCTION (task 360).
 *
 * Between tasks 339 and 360, `CHAR_ESCAPE_TABLE` refused to write half its own
 * vocabulary, and the reason was a gap in the DOCUMENT MODEL rather than a loose
 * end in the escape rung: a bare text node holding a `\command` the user had
 * just typed was indistinguishable from a bare text node holding literal
 * characters. `latex-command.ts`'s decoration painted the first one grey without
 * MARKING it, the autosave fired 1500 ms later, and the serializer had to guess.
 * 339 shipped the honest guess (a run with a backslash is ambiguous — leave its
 * ambiguous members alone) and filed the two residuals it could not close.
 *
 * This suite pins the fix. A raw-LaTeX span takes the `latexCommand` mark as
 * soon as an edit WRITES it, so the escape rung's input really is prose and the
 * whole vocabulary emits unconditionally.
 *
 * Every leg drives a REAL editor, because the defect lives in the gap between
 * what a keystroke leaves in the document and what a save then makes of it —
 * a shape no parse→serialize test can reach. The two SURFACES are driven
 * separately for the same reason task 341's parity suite exists: the card body
 * is a second inline parser AND a second editor, and the two forks have drifted
 * before.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

// `borrowed-schema.ts` pulls the card atoms in, and those reach `@/lib/storage`,
// whose backend `require` has no resolvable target under vitest. Nothing here
// calls a storage function — same stub pattern as `borrowed-schema.test.ts`.
/** Counts every entry into the scanner the carrier reads — the cost probe. */
const scanCalls = { n: 0 };
vi.mock("@/lib/latex-lexer", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/latex-lexer")>();
  return {
    ...real,
    scanRawLatexSpans: (text: string) => {
      scanCalls.n += 1;
      return real.scanRawLatexSpans(text);
    },
  };
});

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
import StarterKit from "@tiptap/starter-kit";
import { LatexCommandMark } from "@/lib/tiptap/latex-command";
import { buildBorrowedAtomSchema } from "@/lib/tiptap/borrowed-schema";
import { serializeToLatex } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import type { JSONContent } from "@tiptap/core";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(content: string, extensions?: unknown[]) {
  editor = new Editor({
    extensions: (extensions ?? [StarterKit, LatexCommandMark]) as never,
    content,
  });
  return editor;
}

/** Type `text` one CHARACTER at a time at `pos` — the real gesture. A single
 *  `insertContent` of the whole string is a different transaction shape and
 *  would let a carrier that only ever sees complete spans pass. */
function typeAt(ed: Editor, pos: number, text: string): number {
  let at = pos;
  for (const ch of text) {
    ed.commands.insertContentAt(at, ch);
    at += 1;
  }
  return at;
}

function bodyOf(tex: string): string {
  const m = tex.match(/\\begin\{document\}\n?([\s\S]*?)\n?\\end\{document\}/);
  return (m?.[1] ?? "").trim();
}

/** What the autosave would write for the editor's current document. */
function saved(ed: Editor): string {
  return bodyOf(serializeToLatex(ed.getJSON() as JSONContent));
}

/** The marked runs of the first paragraph, in order. */
function markedRuns(ed: Editor): string[] {
  const json = ed.getJSON() as {
    content?: { content?: { text?: string; marks?: { type: string }[] }[] }[];
  };
  return (json.content?.[0]?.content ?? [])
    .filter((n) => (n.marks ?? []).some((m) => m.type === "latexCommand"))
    .map((n) => n.text ?? "");
}

// ── what the user types survives, and what they mean literally is escaped ────

describe("a typed \\command takes the carrier", () => {
  const TYPED = [
    "\\emph{hi} there",
    "{\\bf hi} there",
    "\\cmd[opt]{x} tail",
    "\\textcolor{red}{hi}",
    "\\definecolor{c}{rgb}{0,0,1} tail",
  ];

  for (const typed of TYPED) {
    it(`round-trips ${JSON.stringify(typed)} typed into an empty paragraph`, () => {
      const ed = mount("<p></p>");
      typeAt(ed, 1, typed);
      expect(saved(ed)).toBe(typed);
    });
  }

  it("is BYTE-identical to what the same source parses to", () => {
    // The type-time and parse-time answers must agree — that is the whole
    // point of both reading `scanRawLatexSpans` / the lexer's doors. A typed
    // command and a loaded one must reach the same `.tex`.
    for (const typed of TYPED) {
      const ed = mount("<p></p>");
      typeAt(ed, 1, typed);
      const typedTex = saved(ed);
      ed.destroy();
      editor = null;
      const loaded = bodyOf(
        serializeToLatex(
          parseLatex(
            `\\documentclass{article}\n\\begin{document}\n${typedTex}\n\\end{document}\n`,
          ),
        ),
      );
      expect(loaded).toBe(typedTex);
    }
  });

  it("closes 339's second residual: a mixed run keeps its LITERAL braces", () => {
    // `see {this}` is prose the user typed and its braces must PRINT; the
    // command beside it stays live. Before the carrier the whole run was
    // "ambiguous" and both halves were left raw, so the braces vanished from
    // the PDF.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "see {this} and \\emph{that}");
    expect(saved(ed)).toBe("see \\{this\\} and \\emph{that}");
    expect(markedRuns(ed)).toEqual(["\\emph{that}"]);
  });

  it("closes 339's first residual: `\\textbackslash{}` survives a save", () => {
    // A pure source round trip — no editor needed, and that is the point: this
    // one is closed by the escape rung emitting `\` at all, which only became
    // safe once bare text was prose by construction.
    const src = "Use \\textbackslash{}emph here.";
    const rt = bodyOf(
      serializeToLatex(
        parseLatex(
          `\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}\n`,
        ),
      ),
    );
    expect(rt).toBe(src);
  });
});

// ── the boundary rules ───────────────────────────────────────────────────────

describe("mark boundaries", () => {
  it("prose typed AFTER a completed command does NOT inherit the carrier", () => {
    // ProseMirror's default is `inclusive: true`, which is why `serializeMarks`
    // has a smart-quote net for "stray inherited" latexCommand text at all.
    const ed = mount("<p></p>");
    const end = typeAt(ed, 1, "\\emph{hi}");
    typeAt(ed, end, " and prose {here}");
    expect(markedRuns(ed)).toEqual(["\\emph{hi}"]);
    expect(saved(ed)).toBe("\\emph{hi} and prose \\{here\\}");
  });

  it("extends the mark as an in-progress command is completed", () => {
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emp");
    expect(markedRuns(ed)).toEqual(["\\emp"]);
    typeAt(ed, 5, "h{hi}");
    expect(markedRuns(ed)).toEqual(["\\emph{hi}"]);
  });

  it("a mid-typing UNCLOSED argument is not claimed, and heals when it closes", () => {
    // The honest interim state: `\emph` is a command, `{hi` is not yet its
    // argument. Saving there writes escaped braces — literal, recoverable, and
    // valid LaTeX, where the pre-360 answer wrote an unterminated `\emph{`.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emph{hi");
    expect(saved(ed)).toBe("\\emph\\{hi");
    typeAt(ed, 9, "}");
    expect(saved(ed)).toBe("\\emph{hi}");
  });
});

// ── promotion needs a WRITER ─────────────────────────────────────────────────

describe("a span is promoted only where the edit WROTE it", () => {
  /** A document whose bare `\emph` came from a source `\textbackslash{}`. */
  function loadedLiteralBackslash() {
    const doc = parseLatex(
      "\\documentclass{article}\n\\begin{document}\n" +
        "Alpha paragraph.\n\n" +
        "Use \\textbackslash{}emph here.\n" +
        "\\end{document}\n",
    );
    return new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: doc as JSONContent,
    });
  }

  it("leaves an UNTOUCHED literal backslash literal — including on load", () => {
    editor = loadedLiteralBackslash();
    const ed = editor;
    // Typing in a DIFFERENT paragraph must not reach into this one. That is
    // the provenance rule and the keystroke-sanctity rule at once: the scan
    // sees only the blocks the edit touched.
    typeAt(ed, 2, "x");
    expect(saved(ed)).toContain("Use \\textbackslash{}emph here.");
  });

  it("leaves it literal even when the edit is in the SAME block", () => {
    // The gate that matters: the scan window is the block, so a keystroke at
    // the end of this paragraph OFFERS the `\emph` span — and the promotion
    // rule declines it, because no changed range touches it. Without that rule
    // an unrelated keystroke would turn a source `\textbackslash{}emph` into a
    // live `\emph`, which is the pre-360 corruption arriving by a new route.
    editor = loadedLiteralBackslash();
    const ed = editor;
    const end = ed.state.doc.content.size - 1;
    typeAt(ed, end, " tail");
    expect(saved(ed)).toContain("Use \\textbackslash{}emph here. tail");
  });

  it("a document REPLACEMENT promotes nothing", () => {
    // `setContent` is the load and the code-pane bridge's re-parse. Its content
    // already carries whatever marks the parse rung decided; scanning it would
    // promote every literal backslash in the file, on open, with no gesture.
    const ed = mount("<p>seed</p>");
    ed.commands.setContent(
      parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "Use \\textbackslash{}emph here.\n\\end{document}\n",
      ) as JSONContent,
    );
    expect(markedRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("Use \\textbackslash{}emph here.");
  });

  it("but an edit INSIDE that span does promote it — pinned, not hidden", () => {
    // The stated residual. A literal backslash and a typed command are the same
    // document state; writing over one is the only evidence there is, so an
    // edit inside it reads as typing a command. This is the PRE-360 behaviour
    // for that one span, not a new loss.
    editor = loadedLiteralBackslash();
    const ed = editor;
    let pos = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text?.includes("\\emph")) {
        pos = p + node.text.indexOf("\\emph") + "\\emph".length;
      }
      return true;
    });
    expect(pos).toBeGreaterThan(0);
    typeAt(ed, pos, "x");
    // The literal `\` and the letters after it are now a command, and the save
    // says so — the escape rung is no longer asked to guess.
    expect(saved(ed)).toContain("\\emphx here.");
    expect(saved(ed)).not.toContain("\\textbackslash{}");
  });
});

// ── …and it comes OFF what the edit UN-wrote (task 390) ─────────────────────

describe("deleting what made a run LaTeX demotes it", () => {
  /** Backspace over one character at `pos` — the gesture in the report. */
  function backspaceAt(ed: Editor, pos: number) {
    ed.commands.deleteRange({ from: pos, to: pos + 1 });
  }

  it("THE DEFECT: deleting the `\\` returns the word to prose", () => {
    // Gabriel's repro. Pre-390 the carrier only ever ADDED, and its block gate
    // skipped any block with no `\` and no `{` left in it — so the very block a
    // deletion had just emptied of both leads was the one block never looked
    // at. The word stayed grey for the rest of the session.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\Overall");
    expect(markedRuns(ed)).toEqual(["\\Overall"]);
    backspaceAt(ed, 1);
    expect(markedRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("Overall");
  });

  it("THE BYTE HAZARD: a stranded `%` emits ESCAPED, not live", () => {
    // The severity, and the reason this is not a styling bug: the carrier's
    // serializer contract is EMIT RAW. A `%` left under a stale mark reaches
    // the `.tex` LIVE, where it comments out the rest of that source line — and
    // post-347 the next parse reads everything after it as a comment tail.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "x \\% y");
    expect(saved(ed)).toBe("x \\% y");
    backspaceAt(ed, 3);
    expect(markedRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("x \\% y");
    // …and it is a FIXED POINT: what the demotion writes parses back to the
    // same document and saves to the same bytes.
    const once = saved(ed);
    const twice = bodyOf(
      serializeToLatex(
        parseLatex(
          `\\documentclass{article}\n\\begin{document}\n${once}\n\\end{document}\n`,
        ),
      ),
    );
    expect(twice).toBe(once);
  });

  it("the GROUP twin: deleting the `{` demotes the orphaned `}` too", () => {
    // The case the new text alone cannot answer. The brace six characters away
    // is not touched by the deletion and nothing in `\bf hi}` associates the
    // two — only the OLD scan does, where both braces carry the group's own
    // extent. See `brokenConstructs`.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "{\\bf hi}");
    expect(markedRuns(ed)).toEqual(["{\\bf", "}"]);
    backspaceAt(ed, 1);
    expect(markedRuns(ed)).toEqual(["\\bf"]);
    expect(saved(ed)).toBe("\\bf hi\\}");
  });

  it("demotes only the PART the scanner no longer claims", () => {
    // `\emph{\bf hi}` minus its lead is `emph` + a group that still holds
    // LaTeX. The braces and the `\bf` keep the carrier; `emph` and the group's
    // prose lose it — which is exactly what parsing `emph{\bf hi}` produces, so
    // the type-time and parse-time answers still agree.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emph{\\bf hi}");
    backspaceAt(ed, 1);
    expect(markedRuns(ed)).toEqual(["{\\bf", "}"]);
    expect(saved(ed)).toBe("emph{\\bf hi}");
  });

  it("a selection that removes the lead AND more demotes the remainder", () => {
    // The surgical answer ("backspace removed a `\`") misses this, forward
    // delete, and cut. The rule is about what the edit left behind — and the
    // group's braces stay, because an INTACT marked pair is a group either way
    // and `a ph{hi} b` is what a re-parse of these bytes produces.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "a \\emph{hi} b");
    ed.commands.deleteRange({ from: 3, to: 6 }); // "\\em"
    expect(markedRuns(ed)).toEqual(["{", "}"]);
    expect(saved(ed)).toBe("a ph{hi} b");
  });

  it("does NOT flicker while a command is still being typed", () => {
    // Every keystroke inside an in-progress command re-derives both directions;
    // the run must stay marked throughout, not blink off and back on.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emh");
    expect(markedRuns(ed)).toEqual(["\\emh"]);
    typeAt(ed, 4, "p");
    expect(markedRuns(ed)).toEqual(["\\emph"]);
    typeAt(ed, 6, "{hi}");
    expect(markedRuns(ed)).toEqual(["\\emph{hi}"]);
  });
});

// ── demotion is scoped by Rule 1 exactly as promotion is ─────────────────────

describe("only the run the edit TOUCHED demotes", () => {
  /** A block holding BOTH a source-minted bare group — whose braces the parse
   *  rung carries (task 349 M6) and this scanner deliberately declines — and an
   *  unmodeled command the parse rung also carries. */
  function loadedMixedBlock() {
    return new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "See {this} and \\foobar{that} ok.\n\\end{document}\n",
      ) as JSONContent,
    });
  }

  it("breaking one run leaves the source group's braces alone", () => {
    // The leg with teeth. A block-wide demotion would strip the braces of
    // `{this}` — a construct the user never touched — and the next save would
    // write `\{this\}`, printing literal braces in the PDF. That is this
    // defect's own INVERSE, arriving as the fix.
    editor = loadedMixedBlock();
    const ed = editor;
    let at = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text?.startsWith("\\foobar")) at = p;
      return true;
    });
    expect(at).toBeGreaterThan(0);
    ed.commands.deleteRange({ from: at, to: at + 1 });
    // `foobar` loses the carrier. BOTH groups keep their braces — the source
    // group because nothing reached it, the command's own because an intact
    // marked pair is never demoted — and the bytes are what a re-parse gives.
    expect(markedRuns(ed)).toEqual(["{", "}", "{", "}"]);
    expect(saved(ed)).toBe("See {this} and foobar{that} ok.");
  });

  it("an unrelated edit in the same block demotes nothing", () => {
    editor = loadedMixedBlock();
    const ed = editor;
    typeAt(ed, ed.state.doc.content.size - 1, "!");
    expect(markedRuns(ed)).toEqual(["{", "}", "\\foobar{that}"]);
    expect(saved(ed)).toBe("See {this} and \\foobar{that} ok.!");
  });

  it("an edit in a DIFFERENT block never even OPENS it", () => {
    // Stated as a cost claim as well as a content one, because the content half
    // alone is vacuous: every marked run in the other block is covered by its
    // own scan or protected as a brace pair, so it would survive a block-wide
    // demotion too. What is falsifiable is that the other block is not read.
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "Alpha {here} too.\n\n\\foobar{that}\n\\end{document}\n",
      ) as JSONContent,
    });
    const ed = editor;
    scanCalls.n = 0;
    typeAt(ed, 2, "x");
    // TWO scans, both of the TOUCHED block: its own text, and its prior text
    // for the recovery, because its source group's braces are permanently
    // stale here (the cost rule above). The block holding `\foobar{that}` is
    // never opened at all — scanning it would make this three.
    expect(scanCalls.n).toBe(2);
    expect(saved(ed)).toContain("\\foobar{that}");
  });
});

// ── the cover protects a span promotion itself DECLINED ─────────────────────

describe("every scanned span protects, including one crossing an atom", () => {
  it("a marked command wrapping an inline atom survives an edit beside it", () => {
    // The rule "protect broadly, demote narrowly" has one disjunct no other leg
    // reaches: a span the PROMOTE arm declines because it crosses an OPAQUE
    // inline atom still belongs in the cover. Mirroring promotion's own OPAQUE
    // guard four lines above looks like a tidy-up and is the defect — measured,
    // that one-line change passes every other leg in this file.
    //
    // The shape is ordinary: type a command with an argument (whole run marked),
    // then swap the argument for a citation chip from the panel.
    const ed = mount("<p></p>", [StarterKit, ...buildBorrowedAtomSchema()]);
    typeAt(ed, 1, "\\foobar{x} tail");
    ed.commands.deleteRange({ from: 9, to: 10 });
    ed.commands.insertContentAt(9, {
      type: "citation",
      attrs: { citationId: "c1", command: "\\citep{x}", keys: ["x"] },
    } as JSONContent);
    expect(markedRuns(ed)).toEqual(["\\foobar{", "}"]);

    // An edit that TOUCHES the command's own run. Without the cover the span is
    // stale, `\foobar` is not a brace so the pair rule cannot save it, and the
    // next save writes `\textbackslash{}foobar` — the command destroyed.
    typeAt(ed, 1, "Z");
    expect(markedRuns(ed)).toEqual(["\\foobar{", "}"]);
  });
});

// ── a BRACE is not a construct on its own ────────────────────────────────────

describe("marked braces demote in PAIRS, or not at all", () => {
  /** Every `{`/`}` outside an escape is matched. The demotion may not leave a
   *  `.tex` this refuses — a surviving `{` whose partner went through the
   *  escape rung has no partner at all, and the paper stops compiling. */
  function balanced(tex: string): boolean {
    let depth = 0;
    for (let i = 0; i < tex.length; i++) {
      if (tex[i] === "\\") { i++; continue; }
      if (tex[i] === "{") depth++;
      else if (tex[i] === "}" && --depth < 0) return false;
    }
    return depth === 0;
  }

  /** A SOURCE bare group — braces the parse rung carries (349 M6) and this
   *  scanner deliberately declines, so both are permanently "stale". The
   *  `\'e` inside is what makes it an everyday shape rather than a contrivance. */
  function loadedSourceGroup() {
    return new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "Fr{\\'e}chet was first.\n\\end{document}\n",
      ) as JSONContent,
    });
  }

  function braceAt(ed: Editor, ch: "{" | "}"): number {
    let at = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text === ch) at = p;
      return true;
    });
    return at;
  }

  // Each of these reaches exactly ONE brace of the pair under the adjacency
  // rule the two halves share. Pre-390b each demoted that one and left its
  // partner marked, so the save wrote `Fr{\'{e}\}Xchet` — unbalanced, silent,
  // and invisible to the 357 write gate (`\}` against `}` is zero word tokens).
  const EDGES: [string, (ed: Editor) => number][] = [
    ["immediately AFTER the closing brace", (ed) => braceAt(ed, "}") + 1],
    ["immediately BEFORE the closing brace", (ed) => braceAt(ed, "}")],
    ["immediately BEFORE the opening brace", (ed) => braceAt(ed, "{")],
  ];

  for (const [where, posOf] of EDGES) {
    it(`typing ${where} leaves the group untouched`, () => {
      editor = loadedSourceGroup();
      const ed = editor;
      typeAt(ed, posOf(ed), "X");
      const out = saved(ed);
      expect(balanced(out)).toBe(true);
      // NEITHER brace went through the escape rung — the source group is still
      // a group. (Asserting a literal substring would fail for the inside-the-
      // group edge, where the typed character lands between them.)
      expect(out).not.toMatch(/\\[{}]/);
      expect(markedRuns(ed)).toEqual(["{", "}"]);
    });
  }

  it("holds for NESTED source groups", () => {
    // An offset is either a `{` or a `}`, so it belongs to at most one balanced
    // pair and one reconciliation pass is provably enough — pinned here so a
    // future nesting change has to face the question rather than inherit it.
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "A {b {c} d} e.\n\\end{document}\n",
      ) as JSONContent,
    });
    const ed = editor;
    typeAt(ed, ed.state.doc.content.size - 1, "X");
    const out = saved(ed);
    expect(balanced(out)).toBe(true);
    expect(out).toBe("A {b {c} d} e.X");
  });

  it("survives an edit that reaches BOTH braces (`caf{\\'e}s`)", () => {
    // The case that discriminates this rule from both-or-neither, and the
    // commonest carrier of the shape: the parse folds `\'e` to a glyph, so the
    // group holds no LaTeX and both braces are permanently stale here. Deleting
    // the accented letter to retype it reaches BOTH, so both-or-neither would
    // have escaped the pair — balanced, valid, and silently printing braces the
    // user never wrote.
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "caf{\\'e}s and more\n\\end{document}\n",
      ) as JSONContent,
    });
    const ed = editor;
    let at = -1;
    ed.state.doc.descendants((node, p) => {
      if (node.isText && node.text === "\u00e9") at = p;
      return true;
    });
    expect(at).toBeGreaterThan(0);
    ed.commands.deleteRange({ from: at, to: at + 1 });
    expect(saved(ed)).toBe("caf{}s and more");
    ed.commands.insertContentAt(at, "e");
    expect(saved(ed)).toBe("caf{e}s and more");
    expect(markedRuns(ed)).toEqual(["{", "}"]);
  });

  it("does NOT block a genuinely orphaned brace", () => {
    // The group twin from above: the `{` is GONE, so the surviving `}` has no
    // marked partner and the pairing rule has nothing to say. Refusing here
    // would reinstate the defect under the fix's own name.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "{\\bf hi}");
    ed.commands.deleteRange({ from: 1, to: 2 });
    expect(markedRuns(ed)).toEqual(["\\bf"]);
    expect(saved(ed)).toBe("\\bf hi\\}");
  });

  it("keeps an INTACT pair even where the edit reached both sides", () => {
    // Deleting the lead of `\emph{hi}` strands `emph` and the group's braces
    // together. `emph` demotes; the braces do not, and the output is what a
    // re-parse of `emph{hi}` produces — the type-time and parse-time answers
    // agreeing, which escaping the pair would have broken.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emph{hi}");
    ed.commands.deleteRange({ from: 1, to: 2 });
    expect(markedRuns(ed)).toEqual(["{", "}"]);
    expect(saved(ed)).toBe("emph{hi}");
  });
});

// ── the card-body surface inherits the demotion too ──────────────────────────

describe("the card/footnote surface demotes as well", () => {
  it("a stranded `%` in a card body emits escaped", () => {
    // The plugin is registered on the MARK, so the fork inherits the fix — but
    // the fork has its own escape rung and the two have drifted before (task
    // 341), so it is pinned rather than assumed.
    const ed = mount("<p></p>", [StarterKit, ...buildBorrowedAtomSchema()]);
    typeAt(ed, 1, "x \\% y");
    expect(richJsonToLatex(ed.getJSON() as JSONContent)).toBe("x \\% y");
    ed.commands.deleteRange({ from: 3, to: 4 });
    expect(markedRuns(ed)).toEqual([]);
    expect(richJsonToLatex(ed.getJSON() as JSONContent)).toBe("x \\% y");
  });
});

// ── the decoration and the mark are the same state, not two ──────────────────

describe("the grey is painted once", () => {
  it("a typed command renders exactly ONE .latex-cmd span", () => {
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\emph{hi} there");
    const spans = [...ed.view.dom.querySelectorAll(".latex-cmd")];
    expect(spans.map((s) => s.textContent)).toEqual(["\\emph{hi}"]);
  });
});

// ── the card-body surface ────────────────────────────────────────────────────

describe("the card/footnote surface takes the same carrier", () => {
  // The mark is in `buildBorrowedAtomSchema`, so every card body that mounts a
  // real editor gets the plugin with it — which is what keeps the fork's own
  // escape rung (`footnote-content.ts`, the same `escapeLatexChars`) honest.
  it("marks a typed command in a card body, and saves it raw", () => {
    const ed = mount("<p></p>", [StarterKit, ...buildBorrowedAtomSchema()]);
    typeAt(ed, 1, "see {this} and \\emph{that}");
    expect(richJsonToLatex(ed.getJSON() as JSONContent)).toBe(
      "see \\{this\\} and \\emph{that}",
    );
  });
});

// ── the vocabulary is TOTAL at a backslash ───────────────────────────────────

describe("control symbols ride the carrier on both surfaces", () => {
  // `\;` (16), `\ ` (14) and `\,` (9) all occur in this repo's own corpora —
  // `U.S.\ Route` is the standard abbreviation idiom. They used to survive by
  // ACCIDENT: the escape rung refused to touch a backslash in a run that held
  // one. With `\` escaped unconditionally they need a carrier, or the first
  // save prints a backslash.
  const SOURCES = [
    "U.S.\\ Route 1 runs north.",
    "See ch.\\,12 and p.\\;14.",
    "A thin\\!space and a dis\\-cretionary break.",
  ];

  for (const src of SOURCES) {
    it(`main body preserves ${JSON.stringify(src)}`, () => {
      const wrapped = `\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}\n`;
      expect(bodyOf(serializeToLatex(parseLatex(wrapped)))).toBe(src);
    });
    it(`card body preserves ${JSON.stringify(src)}`, () => {
      expect(richJsonToLatex(richLatexToJson(src))).toBe(src);
    });
    it(`survives being TYPED: ${JSON.stringify(src)}`, () => {
      const ed = mount("<p></p>");
      typeAt(ed, 1, src);
      expect(saved(ed)).toBe(src);
    });
  }

  it("a TRAILING backslash is literal, and now compiles", () => {
    // Nothing follows it, so it is not a construct. Pre-360 it reached the
    // `.tex` as a dangling `\`, which pdflatex refuses.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "ends with a backslash \\");
    expect(saved(ed)).toBe("ends with a backslash \\textbackslash{}");
  });
});

// ── cost: one edit costs one BLOCK, never a document walk ────────────────────

describe("keystroke sanctity", () => {
  it("scans only the TOUCHED block, whatever the document's size", () => {
    // 60 paragraphs, each holding a bare `\emph` — the shape a doc full of
    // literal backslashes has. A keystroke in the first one must not reach the
    // other 59, for the cost reason AND for the provenance reason: promoting a
    // span nobody wrote is exactly the corruption this carrier closes.
    const paras = Array.from(
      { length: 60 },
      (_, i) => `<p>para ${i} says \\emph here</p>`,
    ).join("");
    const ed = mount(paras);
    scanCalls.n = 0;
    typeAt(ed, 1, "x");
    expect(scanCalls.n).toBe(1);
    expect(markedRuns(ed)).toEqual([]);
  });

  it("costs NOTHING for a keystroke in a block with no `\\` and no `{`", () => {
    const ed = mount("<p>ordinary prose here</p>");
    scanCalls.n = 0;
    typeAt(ed, 1, "abc");
    expect(scanCalls.n).toBe(0);
  });

  it("a demotion with no lead left costs NO scan at all", () => {
    // The gate's third disjunct (`the block still CARRIES the mark`) opens the
    // block, and the scan is then skipped because it is PROVABLY empty with no
    // `\\` and no `{` to find. Demotion is free in the commonest case there is.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\Overall");
    scanCalls.n = 0;
    ed.commands.deleteRange({ from: 1, to: 2 });
    expect(scanCalls.n).toBe(0);
    expect(markedRuns(ed)).toEqual([]);
  });

  it("a block holding a PERMANENTLY declined marked run pays the recovery every keystroke", () => {
    // The honest cost of the recovery, pinned rather than described. A source
    // bare group's braces are carried by the parse rung and declined by this
    // scanner forever, so they are "stale" on every pass and never reached by
    // an edit elsewhere in the block — which is exactly the condition the
    // recovery fires on. Two scans per keystroke in that paragraph, for as long
    // as the group is there. Block-bounded (the law holds), and NOT nothing:
    // the first draft of this fix's own docstring claimed nothing.
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "See {this} and more.\n\\end{document}\n",
      ) as JSONContent,
    });
    const ed = editor;
    scanCalls.n = 0;
    typeAt(ed, ed.state.doc.content.size - 1, "x");
    expect(scanCalls.n).toBe(2);
    // …and it demotes nothing, which is the point of paying it.
    expect(markedRuns(ed)).toEqual(["{", "}"]);
  });

  it("recovering a BROKEN construct costs one extra scan, and only then", () => {
    // The orphaned `}` is the one shape that needs the prior text, so it is the
    // one shape that pays for it: one scan of the new block, one of the old.
    const group = mount("<p></p>");
    typeAt(group, 1, "{\\bf hi}");
    scanCalls.n = 0;
    group.commands.deleteRange({ from: 1, to: 2 });
    expect(scanCalls.n).toBe(2);
    group.destroy();

    // A keystroke beside a settled command has no stale run, so it never asks.
    const settled = mount("<p></p>");
    typeAt(settled, 1, "\\emph{hi} tail");
    scanCalls.n = 0;
    typeAt(settled, 15, "x");
    expect(scanCalls.n).toBe(1);
  });
});

// ── undo / redo restore marks; they do not re-derive them ────────────────────

describe("history is not a writer", () => {
  it("undoing a `\\`-deletion restores the MARK, it does not re-derive it", () => {
    // The demotion rides in the same history event as the deletion that caused
    // it, so one undo puts both back. Nothing here may re-scan restored
    // content — `isHistoryTransaction` is the gate, and it covers both
    // directions now.
    const ed = mount("<p></p>");
    typeAt(ed, 1, "\\Overall");
    ed.commands.deleteRange({ from: 1, to: 2 });
    expect(markedRuns(ed)).toEqual([]);
    ed.commands.undo();
    expect(markedRuns(ed)).toEqual(["\\Overall"]);
    expect(saved(ed)).toBe("\\Overall");
  });

  it("undoing a deletion does not promote what it restores", () => {
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: parseLatex(
        "\\documentclass{article}\n\\begin{document}\n" +
          "Use \\textbackslash{}emph here.\n\\end{document}\n",
      ) as JSONContent,
    });
    const ed = editor;
    const size = ed.state.doc.content.size;
    ed.commands.deleteRange({ from: 1, to: size - 1 });
    ed.commands.undo();
    expect(markedRuns(ed)).toEqual([]);
    expect(saved(ed)).toBe("Use \\textbackslash{}emph here.");
  });
});
