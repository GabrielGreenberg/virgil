// Task 378 — the BODY SPLITTERS were comment-blind, so a construct the author
// had deliberately commented OUT was promoted into the printed document.
//
// Every scanner on this surface that asks a question about raw bytes had been
// taught that a line-leading `%` is inert — `scanLive`, `findPreambleTitleFields`
// (356), `scanFigureBody`, `readParagraph`'s block-boundary test. The three body
// splitters never got it, and the rule was forked four ways instead of stated
// once:
//
//   M1  `splitListItems` — `% \item Draft alternative.` became a LIVE, printed
//       bullet, with the orphaned `%` stranded alone on its own line.
//   M2  `splitPexBody` — `% \a Draft alternative.` became a live example part,
//       which additionally RENUMBERS every later part and every `\ref` to them.
//   M3  the gloss `tierPattern` — a bare `/g` regex over the raw body, so
//       `% \glb old //` minted a spurious live tier AND the orphaned `%` became
//       an extra `glossCell` in the row above, silently changing the column
//       alignment the tier notation exists to express.
//   M4  the same builder DELETED everything before its first tier marker:
//       segments are built marker-to-marker, so `[0, markers[0].start)` was read
//       by nothing and the node carried no field for it.
//   M4b …and a body with CONTENT but NO tier marker was destroyed outright —
//       `\begingl\nsome text\n\endgl` round-tripped to `\begingl\n\gla  //\n\endgl`.
//       The `splitListItems` shape task 356 closed for lists, still live here.
//   M5  `splitLinguexBody` was correct only BY ACCIDENT (its `lineStart` flag
//       happens to be cleared by the `%` itself) — and its serializer twin then
//       emitted a BLANK LINE after a carried comment, which in linguex is the
//       example's TERMINATOR: on the next save every part after the comment
//       fell OUT of the example, `\vxid` identity and all.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. No gate could see any of this. M1–M3
// MOVE words rather than losing them, so the write gate's multiset measure
// scores a shortfall of ZERO; M4 costs 4 word tokens in this fixture and fewer
// in the common shorter forms, at or under `PRESERVATION_SLACK_WORDS = 4`. And
// every list / example / gloss fixture in the repo is spelled the one way the
// code happens to handle — with no comment in it — so each of these is
// UNREPRESENTABLE in all of them, which is how they shipped green.
//
// So every leg drives the REAL save pipeline (`parseLatex` → `assignUuids` →
// `serializeToLatex` with the REAL extracted delimiters — what
// `storage-fsa.writeDocBundle` and the load-writeback do) over TWO cycles:
// cycle 1 is where the loss happens, cycle 2 is what proves nothing
// accumulates, since every member was a FIXED POINT. Each fixture's CONTROL is
// the same bytes with the `%` removed, through the identical harness, so no leg
// can pass by making everything inert.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { codeOnlyLines } from "./_source-scan";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function doc(body: string, preambleExtra = ""): string {
  return `\\documentclass{article}\n${preambleExtra}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

/** The printed BODY of a saved document — every assertion below is about what
 *  lands between the delimiters, never about the shimmed preamble. */
function docBody(out: string): string {
  const open = out.indexOf("\\begin{document}");
  return out.slice(open + "\\begin{document}".length, out.indexOf("\\end{document}"));
}

/** Two cycles, plus the fixed-point verdict every member needs. */
function cycles(input: string): { c1: string; c2: string; stable: boolean } {
  const c1 = save(input);
  const c2 = save(c1);
  return { c1: docBody(c1), c2: docBody(c2), stable: docBody(c1) === docBody(c2) };
}

const EXPEX = "\\usepackage{expex}";
const LINGUEX = "\\usepackage{linguex}";

/** A `\item` / `\a` / `\gl…` marker is LIVE iff it survives the projection the
 *  compiler applies — i.e. it does not sit behind a `%` on its own line. This is
 *  the question every leg below is really asking, asked once. */
function liveLines(body: string): string[] {
  return body
    .split("\n")
    .filter((l) => !/^[ \t]*%/.test(l));
}

function liveCount(body: string, needle: string): number {
  return liveLines(body).filter((l) => l.includes(needle)).length;
}

// ───────────────────────────────────────────────────────────────────────────
// M1 · splitListItems
// ───────────────────────────────────────────────────────────────────────────
describe("M1 · a commented-out \\item is not a bullet", () => {
  const COMMENTED = `\\begin{itemize}
\\item First.
% \\item Draft alternative.
\\item Second.
\\end{itemize}`;
  const CONTROL = COMMENTED.replace("% \\item Draft", "\\item Draft");

  it("stays commented: two live bullets, and the third is still behind its %", () => {
    const { c1, c2, stable } = cycles(doc(COMMENTED));
    // The pre-378 output was three live `\item`s plus a `%` stranded alone on
    // its own line — the author's deliberately-drafted alternative PRINTED.
    expect(liveCount(c1, "\\item"), c1).toBe(2);
    expect(c1, "the commented bullet's bytes must survive verbatim").toContain(
      "% \\item Draft alternative.",
    );
    expect(c1, "the % must not be stranded alone").not.toMatch(/^[ \t]*%[ \t]*$/m);
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });

  it("CONTROL · the same list with the % removed still has three bullets", () => {
    const { c1, stable } = cycles(doc(CONTROL));
    expect(liveCount(c1, "\\item"), c1).toBe(3);
    expect(stable).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M2 · splitPexBody
// ───────────────────────────────────────────────────────────────────────────
describe("M2 · a commented-out \\a is not an example part", () => {
  const COMMENTED = `\\pex
\\a First.
% \\a Draft alternative.
\\a Second.
\\xe`;
  const CONTROL = COMMENTED.replace("% \\a Draft", "\\a Draft");

  it("stays commented — so the later parts keep their numbers", () => {
    const { c1, c2, stable } = cycles(doc(COMMENTED, EXPEX));
    // Promotion here is worse than a stray bullet: expex computes each part's
    // printed label from POSITION, so a phantom part renumbers every part after
    // it and every `\ref` that names one.
    expect(liveCount(c1, "\\a "), c1).toBe(2);
    expect(c1).toContain("% \\a Draft alternative.");
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });

  it("CONTROL · with the % removed there are three parts", () => {
    const { c1, stable } = cycles(doc(CONTROL, EXPEX));
    expect(liveCount(c1, "\\a "), c1).toBe(3);
    expect(stable).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M3 · the gloss tier scan
// ───────────────────────────────────────────────────────────────────────────
describe("M3 · a commented-out tier mints neither a row nor a cell", () => {
  const COMMENTED = `\\ex
\\begingl
\\gla wo kan shu //
% \\glb old tier //
\\glft \`I read books' //
\\endgl
\\xe`;
  const CONTROL = COMMENTED.replace("% \\glb", "\\glb");

  it("no live \\glb, no orphaned % swallowed into the row above", () => {
    const { c1, c2, stable } = cycles(doc(COMMENTED, EXPEX));
    expect(liveCount(c1, "\\glb"), c1).toBe(0);
    // The pre-378 output was `\gla wo kan shu // \% \glb old tier //` — the
    // orphan tokenized into CELLS, so the row silently gained columns and the
    // `%` was escaped into a printed percent.
    expect(c1, "the % must never be escaped into a printed \\%").not.toContain("\\%");
    expect(c1).toContain("% \\glb old tier //");
    expect(c1, "the live tiers' bytes survive").toContain("\\gla wo kan shu //");
    expect(c1).toContain("\\glft `I read books' //");
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });

  it("a refused gloss acquires no \\par — it is carried BYTE-LITERALLY", () => {
    // `\endgl` is a block boundary, so a prose fall-through would end the
    // paragraph before it and rejoin the two with a BLANK LINE — a `\par`
    // inside a construct we have just declined to model.
    const { c1 } = cycles(doc(COMMENTED, EXPEX));
    const gl = c1.slice(c1.indexOf("\\begingl"), c1.indexOf("\\endgl"));
    expect(gl, `blank line inside the carried gloss:\n${gl}`).not.toMatch(/\n[ \t]*\n/);
  });

  it("CONTROL · with the % removed there are three live tiers", () => {
    const { c1, stable } = cycles(doc(CONTROL, EXPEX));
    expect(liveCount(c1, "\\gla"), c1).toBe(1);
    expect(liveCount(c1, "\\glb"), c1).toBe(1);
    expect(liveCount(c1, "\\glft"), c1).toBe(1);
    expect(stable).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M4 · the gloss's pre-first-marker bytes
// ───────────────────────────────────────────────────────────────────────────
describe("M4 · what sits between \\begingl and the first tier survives", () => {
  // The asymmetry that makes this unarguable: the SAME comment survives one
  // line ABOVE the gloss (`parseExampleBodyAsBlocks` carries a comment child,
  // pinned in example-body-carries-what-it-cannot-model) and was deleted one
  // line INSIDE it.
  const NOTE = "% Mandarin, adapted from Li (2005)";
  const GLOSS = `\\ex
\\begingl
${NOTE}
\\gla wo kan shu //
\\glft \`I read books' //
\\endgl
\\xe`;

  it("a comment above the first tier is carried, and the gloss stays MODELED", () => {
    const { c1, c2, stable } = cycles(doc(GLOSS, EXPEX));
    // BYTES, not a word count — a word-count assertion is exactly what the
    // write gate already fails to catch here (4 tokens, at the slack floor).
    expect(c1, `the note was deleted:\n${c1}`).toContain(NOTE);
    // Still a real gloss: the tiers are emitted by the gloss serializer, not
    // carried raw, so the editor still renders an interlinear block.
    expect(liveCount(c1, "\\gla"), c1).toBe(1);
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });

  it("…and so is a non-comment unmodeled prefix, and a gloss with [opts]", () => {
    const tuning = cycles(
      doc(`\\ex\n\\begingl\n\\setlength{\\glspace}{2pt}\n\\gla a b //\n\\endgl\n\\xe`, EXPEX),
    );
    expect(tuning.c1).toContain("\\setlength{\\glspace}{2pt}");
    expect(tuning.stable).toBe(true);

    const withOpts = cycles(
      doc(`\\ex\n\\begingl[glstyle=x]\n% note\n\\gla a b //\n\\endgl\n\\xe`, EXPEX),
    );
    expect(withOpts.c1).toContain("\\begingl[glstyle=x]");
    expect(withOpts.c1).toContain("% note");
    expect(withOpts.stable).toBe(true);
  });

  it("M4b · a gloss body with content but NO tier marker is carried whole", () => {
    const { c1, c2, stable } = cycles(
      doc(`\\begingl\nsome unmodelled text here\n\\endgl`, EXPEX),
    );
    // Pre-378: `\begingl\n\gla  //\n\endgl` — every byte destroyed, on
    // WELL-FORMED input, so no fail-closed arm could have caught it.
    expect(c1, `body destroyed:\n${c1}`).toContain("some unmodelled text here");
    expect(c1, "no phantom tier may be substituted").not.toContain("\\gla");
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M5 · splitLinguexBody + its serializer twin
// ───────────────────────────────────────────────────────────────────────────
describe("M5 · linguex — the accidental correctness, made real", () => {
  const COMMENTED = `\\ex.
\\a. First.
% \\b. Draft.
\\b. Second.
`;
  const CONTROL = COMMENTED.replace("% \\b. Draft", "\\b. Draft");

  it("the commented part stays commented AND the example does not break apart", () => {
    const { c1, c2, stable } = cycles(doc(COMMENTED, LINGUEX));
    expect(c1).toContain("% \\b. Draft.");
    // The defect the accident could not prevent: the comment carrier appends
    // its own newline, the assembly joined pieces with another, and a BLANK
    // LINE in linguex is the example's TERMINATOR — so on cycle 2 `\b. Second.`
    // fell OUT of the example, losing its `\vxid` identity with it.
    const ex = c1.slice(c1.indexOf("\\ex."));
    const upToBlank = ex.slice(0, ex.search(/\n[ \t]*\n/) === -1 ? ex.length : ex.search(/\n[ \t]*\n/));
    expect(upToBlank, `the second part fell out of the example:\n${c1}`).toContain(
      "\\b. Second.",
    );
    expect(c2, "the part must keep its \\vxid identity").toContain("\\vxid");
    expect(stable, `not a fixed point:\n${c1}\n---\n${c2}`).toBe(true);
  });

  it("CONTROL · with the % removed both parts are live and stable", () => {
    const { c1, stable } = cycles(doc(CONTROL, LINGUEX));
    // linguex derives each part's letter from its POSITION, so promoting the
    // draft gives THREE parts — `\a.` / `\b.` / `\c.` — which is exactly the
    // renumbering the commented fixture above must not suffer.
    expect(liveCount(c1, "\\a."), c1).toBe(1);
    expect(liveCount(c1, "\\b."), c1).toBe(1);
    expect(liveCount(c1, "\\c."), c1).toBe(1);
    expect(stable).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The mid-line `%` residual — pinned so a later widening is a DECISION
// ───────────────────────────────────────────────────────────────────────────
describe("the narrow rule is deliberate", () => {
  it("a MID-LINE % is not a line comment to a splitter (task 347's residual)", () => {
    // Widening to TeX's own any-unescaped-`%` rule here is what task 338 found
    // catastrophic for a terminator scan (a LIVE `\end{env}` read as inert, and
    // the rest of the document swallowed). The mid-line case stays as recorded.
    const { c1, stable } = cycles(doc(`\\begin{itemize}\n\\item First. % note\n\\item Second.\n\\end{itemize}`));
    expect(liveCount(c1, "\\item"), c1).toBe(2);
    expect(c1).toContain("% note");
    expect(stable).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CENSUS — the leg with teeth
// ───────────────────────────────────────────────────────────────────────────
//
// The shared reader was never the part that can misbehave: a splitter that
// never ASKS it is, and that splitter type-checks perfectly. Membership is
// DISCOVERED rather than listed — the population is every byte-walking scan
// that steps over an opaque construct, because a scan that has to know a
// `\verb` run is not its business has to know a comment is not either. A new
// splitter joins this census by being written, not by someone remembering it.
const WALKER_FILES = ["src/lib/latex-lexer.ts", "src/lib/latex-parser.ts"];

function repoFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

/** The top-level `function <name>(` declaration regions of a file, as
 *  `{ name, body }`, read from COMMENT-STRIPPED source so a needle quoted in
 *  prose (and every fix here explains itself by quoting the pre-fix line) can
 *  never satisfy or trip a leg. */
function declarations(src: string): Array<{ name: string; body: string }> {
  const code = codeOnlyLines(src);
  const lines = code.split("\n");
  const heads: Array<{ name: string; at: number }> = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(?:export )?(?:async )?function (\w+)/);
    if (m) heads.push({ name: m[1], at: i });
  });
  return heads.map((h, i) => ({
    name: h.name,
    body: lines.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : lines.length).join("\n"),
  }));
}

describe("census · every opaque-skipping walk reads the ONE comment rule", () => {
  it("finds no comment-blind body walk in either file", () => {
    const blind: string[] = [];
    let population = 0;
    for (const rel of WALKER_FILES) {
      for (const d of declarations(repoFile(rel))) {
        if (!d.body.includes("skipOpaqueConstructAt(")) continue;
        // The primitive itself RECURSES, so it names itself — a self-reference,
        // not a caller, and it has no body of its own to walk.
        if (d.name === "skipOpaqueConstructAt") continue;
        population++;
        if (!d.body.includes("skipLineCommentAt(")) blind.push(`${rel}: ${d.name}`);
      }
    }
    // The population is the point — a census that discovers nothing passes for
    // the wrong reason. Measured on the fixed tree: `scanLive`, `splitListItems`,
    // `splitPexBody`, `splitLinguexBody`.
    expect(population, "the census found no walkers at all").toBe(4);
    expect(
      blind,
      "a byte walk that steps over opaque constructs but not over comments — " +
        "read `skipLineCommentAt`, do not write a fifth private copy of the rule",
    ).toEqual([]);
  });

  it("the gloss scan reads a PROJECTION, and slices the RAW body", () => {
    // The gloss is a REGEX scan, so it cannot use the byte-walk primitive; its
    // instrument is the projection, with the segments still sliced out of the
    // raw body (task 345's asymmetry, spelled at the site).
    const gloss = declarations(repoFile("src/lib/latex-parser.ts")).find(
      (d) => d.name === "buildGlossFromBody",
    );
    expect(gloss, "buildGlossFromBody vanished — retarget this leg").toBeTruthy();
    expect(gloss!.body).toContain("projectStructuralLatex(body)");
    expect(
      gloss!.body,
      "the tier scan must run over the projection, never the raw body",
    ).not.toContain("tierPattern.exec(body)");
  });

  it("the census reads CODE, not prose (canary + swallow self-check)", () => {
    // Synthetic, deliberately: a canary standing on the lines the census drains
    // evaporates the moment they are fixed.
    const fake = [
      "function splitSomething(body: string) {",
      "  while (pos < body.length) {",
      "    const skip = skipOpaqueConstructAt(body, pos);",
      "  }",
      "}",
      "function alreadyGood(body: string) {",
      "  const skip = skipOpaqueConstructAt(body, pos);",
      "  const c = skipLineCommentAt(body, pos);",
      "}",
    ].join("\n");
    const decls = declarations(fake);
    expect(decls.map((d) => d.name)).toEqual(["splitSomething", "alreadyGood"]);
    expect(decls[0].body.includes("skipLineCommentAt(")).toBe(false);
    expect(decls[1].body.includes("skipLineCommentAt(")).toBe(true);
    // A mention inside a COMMENT is prose and must not count as a reader.
    const prose = declarations(
      "function f(body: string) {\n  // skipLineCommentAt(body, pos)\n  const s = skipOpaqueConstructAt(body, pos);\n}",
    );
    expect(prose[0].body.includes("skipLineCommentAt(")).toBe(false);
    // …and the stripper did not eat either file.
    for (const rel of WALKER_FILES) {
      const raw = repoFile(rel);
      expect(codeOnlyLines(raw).split("\n").length).toBe(raw.split("\n").length);
      expect(declarations(raw).length).toBeGreaterThan(20);
    }
  });
});
