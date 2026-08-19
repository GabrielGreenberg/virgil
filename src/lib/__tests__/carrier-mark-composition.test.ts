// Task 377 — a mark that WRAPS a run is not a mark that says how the run's own
// bytes are produced, and both inline serializers used to conflate them.
//
// `serializeMarks` had three early `return`s sitting ABOVE its wrapper loop —
// one per CARRIER mark (`latexCommentTail` / `latexVerbatim` / `latexCommand`).
// The parser APPENDS a formatting mark onto whatever its recursion returned, so
// a run wearing a carrier AND a formatting mark is ordinary; when it happened,
// the wrapper was DELETED from the user's only copy. The card/footnote fork
// (`footnote-content.ts`, a second implementation — task 341's twin rule) had
// the identical two returns above the identical loop.
//
// Measured on the pre-fix tree through the REAL pipeline, every one a FIXED
// POINT from cycle 1, all of it landing on OPEN (`readDocBundle` runs this same
// pipeline and then fires `writeReStampedTexOnLoad` unconditionally):
//
//   M1  \textbf{\textsc{Smith}}              -> \textsc{Smith}          (\textbf DELETED)
//       \textcolor[HTML]{FF0000}{\textsc{x}} -> \textsc{x}              (the colour DELETED)
//       \textbf{\verb|a|}                    -> \verb|a|
//       \emph{a \textsc{b} c}                -> \emph{a }\textsc{b}\emph{ c}
//   M2  the same, in the card/footnote fork
//   M3  \emph{\citep{smith}}                 -> \vcid{…}\citep{smith}   (\emph gone)
//       \emph{$x^2$} / \emph{\ref{fig:1}}    -> the atom, bare
//   M4  \texttt{\textbf{x--y}}               -> \texttt{\textbf{x–y}}   (raw U+2013 on disk)
//       \texttt{\textbf{caf\'e}}             -> \texttt{\textbf{café}}  (raw U+00E9 on disk)
//   M5  \texttt{caf\'e}                      -> \texttt{caf}\'\texttt{e}
//
// M5 is the one that changes what a COMMAND TAKES: `\'` now takes `\texttt` as
// its argument. It is why the fix wraps a RUN rather than a node.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every leg drives the REAL save pipeline
// over TWO cycles — cycle 1 is where the loss happens, cycle 2 is what proves
// nothing accumulates — and every leg is driven over BOTH surfaces, because the
// fork is a second implementation and a suite that exercises one of them is
// blind to the other by construction. The CONTROLS (`\textbf{plain bold}`,
// `\textbf{\emph{both}}`, `\texttt{x--y}`) run through the identical harness so
// no leg can pass vacuously: the defect needs a CARRIER (or an atom) as the
// child, and a suite whose fixtures are all plain prose cannot represent it.
//
// NO GATE COULD SEE ANY OF IT. `\textbf` is not a content word; `x--y` and
// `x–y` both tokenize to {x, y} under `WORD_RE = [A-Za-z0-9]+`; the accent case
// is a 1-token shortfall under the 4-word preservation floor.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";
import {
  WRAPPER_MARK_TYPES,
  markWrapSignature,
  wrapperMarksOf,
  applyWrapperMarks,
  composeInlineRun,
} from "@/lib/mark-composition";
import { commentsStripped } from "./_source-scan";
import type { JSONContent } from "@tiptap/react";

// ── harness ──────────────────────────────────────────────────────────────────

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

const doc = (b: string) =>
  `\\documentclass{article}\n\\begin{document}\n${b}\n\\end{document}\n`;

/** The printed BODY, with the freshly-minted `%!v:` anchors blanked — they are
 *  what `assignUuids` is for, so a byte comparison against hand-written input
 *  can only be about the CONTENT. */
function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

/** MAIN surface: two full cycles, asserting the body is a fixed point. */
function mainCycles(input: string): { c1: string; c2: string } {
  const c1 = save(doc(input));
  const c2 = save(c1);
  return { c1: body(c1), c2: body(c2) };
}

/** CARD/FOOTNOTE surface, driven directly through the fork's own two doors. */
function forkCycles(input: string): { c1: string; c2: string } {
  const c1 = richJsonToLatex(richLatexToJson(input));
  const c2 = richJsonToLatex(richLatexToJson(c1));
  return { c1, c2 };
}

/** CARD/FOOTNOTE surface, reached the way production reaches it — a
 *  `\footnote{}` body inside a real document, through the real pipeline. */
function footnoteBodyCycles(inner: string): { c1: string; c2: string } {
  const strip = (tex: string) => {
    const m = body(tex).match(/\\footnote\{([\s\S]*)\}\.$/);
    return m ? m[1] : body(tex);
  };
  const t1 = save(doc(`Text\\footnote{${inner}}.`));
  const t2 = save(t1);
  return { c1: strip(t1), c2: strip(t2) };
}

/** Every leg asserts the same three things: byte identity with the source, a
 *  fixed point, and (for the atom legs, which cannot be byte-identical because
 *  a `\vcid` marker is minted) at least the survival of the wrapper. */
function expectStable(got: { c1: string; c2: string }, expected: string) {
  expect(got.c1).toBe(expected);
  expect(got.c2).toBe(expected);
}

const firstParagraph = (tex: string): JSONContent | undefined =>
  (parseLatex(tex).content ?? []).find((n) => n.type === "paragraph");

// ── M1 · a wrapper around a CARRIER, main surface ────────────────────────────

describe("M1 — a formatting mark wrapped around a carrier survives (main)", () => {
  // `\textsc` is unmodeled — it is the standard small-caps / gloss-abbreviation
  // command, so this is ordinary linguistics and philosophy prose.
  it("\\textbf around an unmodeled command", () => {
    expectStable(mainCycles("\\textbf{\\textsc{Smith}}"), "\\textbf{\\textsc{Smith}}");
  });

  it("\\textcolor around an unmodeled command", () => {
    expectStable(
      mainCycles("\\textcolor[HTML]{FF0000}{\\textsc{x}}"),
      "\\textcolor[HTML]{FF0000}{\\textsc{x}}",
    );
  });

  it("\\textbf around an inline \\verb (the stricter carrier)", () => {
    expectStable(mainCycles("\\textbf{\\verb|a|}"), "\\textbf{\\verb|a|}");
  });

  // The RUN case: pre-377 the carrier in the middle split one `\emph{…}` into
  // two and dropped the wrapper from the middle piece.
  it("a carrier INSIDE a wrapped run does not split the wrapper", () => {
    expectStable(mainCycles("\\emph{a \\textsc{b} c}"), "\\emph{a \\textsc{b} c}");
  });

  it("CONTROL — plain bold round-trips (it always did)", () => {
    expectStable(mainCycles("\\textbf{plain bold}"), "\\textbf{plain bold}");
  });

  it("CONTROL — two formatting marks round-trip (it always did)", () => {
    expectStable(mainCycles("\\textbf{\\emph{both}}"), "\\textbf{\\emph{both}}");
  });
});

// ── M2 · the same, in the card/footnote fork ─────────────────────────────────

describe("M2 — the fork composes the same way", () => {
  it("\\textbf around an unmodeled command, through the fork's own doors", () => {
    expectStable(forkCycles("\\textbf{\\textsc{x}}"), "\\textbf{\\textsc{x}}");
  });

  it("\\textbf around an inline \\verb, through the fork's own doors", () => {
    expectStable(forkCycles("\\textbf{\\verb|a|}"), "\\textbf{\\verb|a|}");
  });

  it("a carrier inside a wrapped run, through the fork's own doors", () => {
    expectStable(forkCycles("\\emph{a \\textsc{b} c}"), "\\emph{a \\textsc{b} c}");
  });

  it("a real \\footnote{} body in a real document", () => {
    expectStable(footnoteBodyCycles("\\textbf{\\textsc{x}}"), "\\textbf{\\textsc{x}}");
  });

  it("CONTROL — plain bold in the fork (it always did)", () => {
    expectStable(forkCycles("\\textbf{plain}"), "\\textbf{plain}");
  });
});

// ── M3 · a mark wrapped around an inline ATOM ────────────────────────────────

describe("M3 — a mark around an inline atom survives", () => {
  // A citation mints a `\vcid{…}` id marker, so the bytes cannot be identical.
  // What must hold is that the wrapper is there, that it is a fixed point, and
  // that the round trip still reads back AS a citation wearing the mark.
  it("\\emph around a citation", () => {
    const got = mainCycles("\\emph{\\citep{smith}}");
    expect(got.c1).toMatch(/^\\emph\{\\vcid\{[0-9a-f]{4}\}\\citep\{smith\}\}$/);
    expect(got.c2).toBe(got.c1);
    const para = firstParagraph(doc(got.c1));
    const cite = (para?.content ?? []).find((n) => n.type === "citation");
    expect(cite).toBeDefined();
    expect(cite?.marks?.map((m) => m.type)).toContain("italic");
  });

  it("\\emph around inline math", () => {
    expectStable(mainCycles("\\emph{$x^2$}"), "\\emph{$x^2$}");
  });

  it("\\emph around a \\ref", () => {
    expectStable(mainCycles("\\emph{\\ref{fig:1}}"), "\\emph{\\ref{fig:1}}");
  });

  it("an atom INSIDE a wrapped run keeps the run whole", () => {
    const got = mainCycles("\\textbf{a \\footnote{note} b}");
    expect(got.c1).toMatch(/^\\textbf\{a \\vfid\{[0-9a-f]{4}\}\\footnote\{note\} b\}$/);
    expect(got.c2).toBe(got.c1);
  });

  it("a mark around a citation survives in the fork too", () => {
    const got = forkCycles("\\emph{\\citep{smith}}");
    expect(got.c1).toMatch(/^\\emph\{\\vcid\{[0-9a-f]{4}\}\\citep\{smith\}\}$/);
    expect(got.c2).toBe(got.c1);
  });

  it("CONTROL — an UNWRAPPED atom stays unwrapped", () => {
    const got = mainCycles("\\citep{smith}");
    expect(got.c1).toMatch(/^\\vcid\{[0-9a-f]{4}\}\\citep\{smith\}$/);
    expect(got.c2).toBe(got.c1);
  });
});

// ── M4 · `inCode` reaches every depth ────────────────────────────────────────

describe("M4 — inCode is inherited by every mark recursion", () => {
  // Inside `\texttt` the source `--` must print two hyphens. Pre-377 only the
  // `\texttt` branch passed the flag, so a command nested INSIDE the code span
  // had its body typographied and a raw U+2013 was written to the `.tex`.
  it("a dash pair inside a nested command stays two hyphens (main)", () => {
    const got = mainCycles("\\texttt{\\textbf{x--y}}");
    expectStable(got, "\\texttt{\\textbf{x--y}}");
    expect(got.c1).not.toContain("\u2013");
  });

  it("an accent inside a nested command stays a command (main)", () => {
    const got = mainCycles("\\texttt{\\textbf{caf\\'e}}");
    expectStable(got, "\\texttt{\\textbf{caf\\'e}}");
    expect(got.c1).not.toContain("\u00e9");
  });

  it("a dash pair inside a nested command stays two hyphens (fork)", () => {
    const got = forkCycles("\\texttt{\\textbf{x--y}}");
    expectStable(got, "\\texttt{\\textbf{x--y}}");
    expect(got.c1).not.toContain("\u2013");
  });

  it("CONTROL — one level of \\texttt was always correct", () => {
    expectStable(mainCycles("\\texttt{x--y}"), "\\texttt{x--y}");
    expectStable(forkCycles("\\texttt{x--y}"), "\\texttt{x--y}");
  });

  // The control has to be read off the MODEL, not the bytes: the `.tex` keeps
  // `--` either way (`typographyToLatex` is the reverse map), and what the flag
  // decides is whether the DOCUMENT holds a glyph. Asserting on the bytes would
  // be a control that cannot distinguish the two states at all.
  it("CONTROL — a dash pair OUTSIDE any code span still becomes a glyph", () => {
    const plain = firstParagraph(doc("plain x--y"));
    expect((plain?.content ?? [])[0]?.text).toContain("\u2013");
    const coded = firstParagraph(doc("\\texttt{x--y}"));
    expect((coded?.content ?? [])[0]?.text).toBe("x--y");
    const nested = firstParagraph(doc("\\texttt{\\textbf{x--y}}"));
    expect((nested?.content ?? [])[0]?.text).toBe("x--y");
  });
});

// ── M5 · the wrapper is not split across a control symbol's argument ─────────

describe("M5 — a run is wrapped once, so `\\'` keeps its argument", () => {
  it("\\texttt{caf\\'e} stays one \\texttt (main)", () => {
    expectStable(mainCycles("\\texttt{caf\\'e}"), "\\texttt{caf\\'e}");
  });

  it("\\texttt{caf\\'e} stays one \\texttt (fork)", () => {
    expectStable(forkCycles("\\texttt{caf\\'e}"), "\\texttt{caf\\'e}");
  });

  it("a control symbol inside an \\emph keeps the run whole", () => {
    expectStable(mainCycles("\\emph{U.S.\\ Route}"), "\\emph{U.S.\\ Route}");
  });
});

// ── Non-regression: what the run composition must NOT change ─────────────────

describe("non-regression — the composition leaves the other laws alone", () => {
  // Task 347: a `%` comment tail owns the rest of its LINE, so it can never be
  // merged into a wrapped run — a closing brace emitted after it inside
  // `\textbf{…}` would itself be commented out.
  it("a comment tail is never merged into a wrapped run", () => {
    const got = mainCycles("Some prose. % a marginal note");
    expectStable(got, "Some prose. % a marginal note");
  });

  // Task 120 / the linked-anchor emit: `\vlid` / `\vlidend` sit OUTSIDE the
  // wrapper, and a transition still breaks the run.
  it("linked-anchor markers stay outside the wrapper", () => {
    expectStable(
      mainCycles("a \\vlid{ab12}\\textbf{bold range}\\vlidend{ab12} b"),
      "a \\vlid{ab12}\\textbf{bold range}\\vlidend{ab12} b",
    );
  });

  // DECLARED normalization: two adjacent nodes the model happens to keep apart
  // with identical wrapper marks merge. One-time, idempotent, typesets the same.
  it("adjacent identical wrappers merge — once, and idempotently", () => {
    expectStable(mainCycles("\\textbf{a}\\textbf{b}"), "\\textbf{ab}");
  });

  it("two DIFFERENT colours are two different wrappers", () => {
    expectStable(
      mainCycles("\\textcolor[HTML]{FF0000}{a}\\textcolor[HTML]{00FF00}{b}"),
      "\\textcolor[HTML]{FF0000}{a}\\textcolor[HTML]{00FF00}{b}",
    );
  });
});

// ── the composition primitive's own contract ─────────────────────────────────

describe("mark-composition — the shared rule", () => {
  it("a carrier mark is not part of the wrapper signature", () => {
    expect(markWrapSignature([{ type: "latexCommand" }, { type: "bold" }])).toBe(
      markWrapSignature([{ type: "bold" }]),
    );
  });

  it("textColor's attrs are part of the signature", () => {
    const a = [{ type: "textColor", attrs: { color: "#FF0000" } }];
    const b = [{ type: "textColor", attrs: { color: "#00FF00" } }];
    expect(markWrapSignature(a)).not.toBe(markWrapSignature(b));
  });

  it("wrapper ORDER is the nesting order, innermost first", () => {
    expect(applyWrapperMarks("x", [{ type: "italic" }, { type: "bold" }])).toBe(
      "\\textbf{\\emph{x}}",
    );
    expect(applyWrapperMarks("x", [{ type: "bold" }, { type: "italic" }])).toBe(
      "\\emph{\\textbf{x}}",
    );
  });

  it("an outerPrefix breaks the run, so it can never land inside the braces", () => {
    const out = composeInlineRun<{ marks?: { type: string }[]; t: string }>(
      [
        { t: "a", marks: [{ type: "bold" }] },
        { t: "b", marks: [{ type: "bold" }] },
      ],
      {
        inner: (n) => n.t,
        outerPrefix: (n) => (n.t === "b" ? "|" : ""),
      },
    );
    expect(out).toBe("\\textbf{a}|\\textbf{b}");
  });

  it("a standalone node is emitted whole and flushes the run", () => {
    const out = composeInlineRun<{ marks?: { type: string }[]; t: string }>(
      [
        { t: "a", marks: [{ type: "bold" }] },
        { t: "%c", marks: [{ type: "bold" }] },
        { t: "b", marks: [{ type: "bold" }] },
      ],
      {
        inner: (n) => n.t,
        standalone: (n) => (n.t.startsWith("%") ? n.t : null),
      },
    );
    expect(out).toBe("\\textbf{a}%c\\textbf{b}");
  });
});

// ── CENSUS · the leg with teeth ──────────────────────────────────────────────
//
// The composition was never the part that could misbehave — a call site that
// wraps per node, or a THIRD copy of the switch, is. Both of the pre-377
// defects were exactly that shape: two files spelling the same five commands
// with the same three early returns above them, and no test of either could see
// the other.

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const PRODUCTION_TS = (() => {
  const { execSync } = require("node:child_process") as typeof import("node:child_process");
  return execSync(
    `find src library -name '*.ts' -o -name '*.tsx' | grep -v __tests__ | grep -v '/test'`,
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\n")
    .filter(Boolean);
})();

/** The EMIT spelling of each wrapper command — a JS string literal writing the
 *  command, which the parser's own `/^\\textbf\{/` (whose brace is escaped) and
 *  `"\\textbf".length` cannot match. Derived from the vocabulary, so a sixth
 *  wrapper mark joins the census by declaring itself. */
const EMIT_NEEDLES: Record<string, string> = {
  bold: "\\\\textbf{",
  italic: "\\\\emph{",
  underline: "\\\\underline{",
  code: "\\\\texttt{",
  textColor: "\\\\textcolor[HTML]{",
};

describe("census — the wrapper vocabulary has ONE speller", () => {
  it("every declared wrapper mark has an emit needle", () => {
    expect(Object.keys(EMIT_NEEDLES).sort()).toEqual([...WRAPPER_MARK_TYPES].sort());
  });

  it("every declared wrapper mark has a case in the applier", () => {
    const src = read("src/lib/mark-composition.ts");
    for (const t of WRAPPER_MARK_TYPES) {
      expect(src).toContain(`case "${t}":`);
    }
  });

  it("no production file outside mark-composition.ts emits a wrapper command", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_TS) {
      if (file.endsWith("src/lib/mark-composition.ts")) continue;
      const code = commentsStripped(read(file));
      for (const needle of Object.values(EMIT_NEEDLES)) {
        if (code.includes(needle)) offenders.push(`${file} :: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("CANARY — the census can see an emit spelling", () => {
    // A synthetic offender, not one of the drained production lines: a canary
    // standing on the defect evaporates the moment the defect is fixed.
    const synthetic = commentsStripped(
      'const x = `\\\\textbf{${inner}}`; // not a real site\n',
    );
    expect(synthetic).toContain(EMIT_NEEDLES.bold);
  });

  it("CANARY — the stripper does not swallow the file", () => {
    const code = commentsStripped(read("src/lib/mark-composition.ts"));
    expect(code).toContain("export function applyWrapperMarks");
    expect(code).toContain("export function composeInlineRun");
  });

  it("both inline serializers compose over a RUN", () => {
    for (const file of ["src/lib/latex-serializer.ts", "src/lib/footnote-content.ts"]) {
      const code = commentsStripped(read(file));
      expect(code, file).toContain("composeInlineRun");
    }
  });

  it("neither inline serializer wraps per node inside its sequence walker", () => {
    // `applyWrapperMarks` is the run composer's business. The main serializer
    // keeps exactly ONE direct call — `serializeMarks`, for the malformed-model
    // arm where a text node genuinely stands alone; the fork keeps none.
    const main = commentsStripped(read("src/lib/latex-serializer.ts"));
    expect(main.split("applyWrapperMarks(").length - 1).toBe(1);
    const fork = commentsStripped(read("src/lib/footnote-content.ts"));
    expect(fork).not.toContain("applyWrapperMarks(");
  });

  it("wrapperMarksOf keeps the carriers out", () => {
    expect(
      wrapperMarksOf([
        { type: "latexCommand" },
        { type: "latexVerbatim" },
        { type: "latexCommentTail" },
        { type: "linkedAnchor" },
        { type: "bold" },
      ]).map((m) => m.type),
    ).toEqual(["bold"]);
  });
});
