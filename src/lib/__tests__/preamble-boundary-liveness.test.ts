// The preamble/body boundary is a question about LIVE bytes (task 375).
//
// Every reader of that boundary used to locate it with an exact-literal
// `indexOf("\begin{document}")` / `indexOf("\end{document}")` over RAW bytes,
// searched from index 0. Five things followed from that one decision, and all
// five are SILENT, all five are FIXED POINTS (no later save heals them), and all
// five land on OPEN — `readDocBundle` runs the save pipeline and then fires
// `writeReStampedTexOnLoad` unconditionally, before the user has typed anything:
//
//   M1  a preamble that merely MENTIONS `\end{document}` put `endDoc` BEFORE
//       `beginDoc`, which ejected the entire body into the postamble and wrote a
//       `.tex` with two `\begin{document}` and a `\usepackage` after the first.
//   M2  a commented-out `% \end{document}` in the body took the cut INSIDE the
//       comment: the `%` was severed from its token, the `\end{document}` went
//       LIVE, and the rest of the paper stopped printing.
//   M3  a commented-out `% \begin{document}` in the preamble took the
//       requirement injector's splice, which UN-COMMENTED it — so the user's own
//       `\usepackage` lines ended up after a live `\begin{document}`.
//   M4  a verbatim-quoted `\end{document}` (a paper that DOCUMENTS LaTeX) cut the
//       body mid-verbatim and wrote a `%!v:` anchor into what remained, where it
//       prints literally in the PDF.
//   M5  `\begin {document}` — a spelling TeX accepts, since it skips spaces while
//       scanning the argument — read as NO boundary at all, so the whole file
//       went through the body fallback and a style seed was written above the
//       user's own `\documentclass`.
//
// **Why no pre-375 suite could see any of this.** Every `.tex` fixture in the
// repo spells its boundary the one way the code happened to handle, exactly once
// each, live. A boundary that MOVES is unrepresentable in all of them — which is
// how five members shipped with 7 860 tests green. It is also why the two
// preservation gates could not catch it: `splitRegions` used the SAME exact
// literal, so a cut document measures with everything under body on both sides
// and reports a shortfall of 0 in both regions.
//
// Every leg drives the REAL save pipeline (`parseLatex` → `assignUuids` →
// `serializeToLatex` with the REAL extracted delimiters — byte for byte what
// `storage-fsa.writeDocBundle` and the load-writeback do) over TWO cycles: cycle
// 1 is where the damage happens, cycle 2 is what proves nothing accumulates.
// CONTROLS run through the identical harness so no leg can pass by breaking the
// ordinary path.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseLatex, extractPreambleAndPostamble, resolveWriteDelimiters } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  BEGIN_DOCUMENT_TOKEN,
  END_DOCUMENT_TOKEN,
  findDocumentBoundary,
  findLiveDocumentTokens,
  projectDetectableLatex,
  projectStructuralLatex,
} from "@/lib/latex-lexer";
import { strip } from "./_source-scan";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, resolveWriteDelimiters(tex) ?? undefined);
}

function twoCycles(input: string): { c1: string; c2: string } {
  const c1 = save(input);
  return { c1, c2: save(c1) };
}

/** How many LIVE `\begin{document}` the saved file carries. Exactly one is the
 *  invariant every member below broke in a different way. */
function liveBegins(tex: string): number {
  return findLiveDocumentTokens(tex).begins.length;
}

/** Does any `\usepackage` sit AFTER the live `\begin{document}`? That is a hard
 *  LaTeX error, and it is what M1 and M3 each wrote. */
function packageAfterBegin(tex: string): boolean {
  const { bodyStart } = findDocumentBoundary(tex);
  if (bodyStart === -1) return false;
  return /\\usepackage/.test(projectStructuralLatex(tex).slice(bodyStart));
}

function expectAllPresent(out: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !out.includes(n));
  expect(
    missing,
    `content destroyed by the save pipeline: ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

/** The invariants every well-formed save must hold, whatever the input spelled. */
function expectWellFormed(out: string, label: string): void {
  expect(liveBegins(out), `${label}: live \\begin{document} count`).toBe(1);
  expect(packageAfterBegin(out), `${label}: a \\usepackage after the body starts`).toBe(false);
}

/**
 * The needles are inside the BODY — between the live `\begin{document}` and the
 * live `\end{document}`.
 *
 * Presence in the FILE is not the contract and asserting it is how a leg passes
 * vacuously: a boundary that moved does not delete the user's prose, it EJECTS
 * it into the postamble, where it is still in the bytes, still greppable, and
 * never printed or shown in the editor again. That is the shape of every member
 * here.
 */
function expectInBody(out: string, needles: readonly string[], label: string): void {
  const { bodyStart, endDoc } = findDocumentBoundary(out);
  expect(bodyStart, `${label}: no live boundary in the output`).toBeGreaterThan(-1);
  const body = out.slice(bodyStart, endDoc === -1 ? out.length : endDoc);
  const missing = needles.filter((n) => !body.includes(n));
  expect(
    missing,
    `${label}: outside the printed body — ejected, not merely moved: ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

// ───────────────────────────────────────────────────────────────────────────
// M1 · `endDoc` searched from 0
// ───────────────────────────────────────────────────────────────────────────
describe("M1 · a preamble that MENTIONS \\end{document}", () => {
  const SRC = [
    "\\documentclass{article}",
    "% put \\end{document} at the very end",
    "\\usepackage{amsmath}",
    "\\begin{document}",
    "Real body.",
    "\\end{document}",
    "",
  ].join("\n");

  it("keeps the body, and writes exactly one \\begin{document}", () => {
    const { c1, c2 } = twoCycles(SRC);
    expectInBody(c1, ["Real body."], "cycle 1");
    expect(c1).toContain("\\usepackage{amsmath}");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body."], "cycle 2");
    expectWellFormed(c2, "cycle 2");
  });

  it("leaves the comment intact rather than promoting its text to the body", () => {
    const { c1 } = twoCycles(SRC);
    expect(c1).toContain("% put \\end{document} at the very end");
  });

  it("the boundary itself: endDoc never precedes bodyStart", () => {
    const b = findDocumentBoundary(SRC);
    expect(b.beginDoc).toBeGreaterThan(-1);
    expect(b.endDoc).toBeGreaterThanOrEqual(b.bodyStart);
  });

  it("a \\newcommand naming the token reaches the same place", () => {
    // The member's other reachable shape, and the one that is LIVE LaTeX rather
    // than a comment: `\newcommand{\stopnow}{\end{document}}` is a real
    // `\end{document}` above the begin, and the from-bodyStart rule is what
    // handles it — the projection cannot, because those bytes ARE live.
    const src = [
      "\\documentclass{article}",
      "\\newcommand{\\stopnow}{\\end{document}}",
      "\\begin{document}",
      "Real body.",
      "\\end{document}",
      "",
    ].join("\n");
    const { c1, c2 } = twoCycles(src);
    expectInBody(c1, ["Real body."], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body."], "cycle 2");
    expectWellFormed(c2, "cycle 2");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M2 · a commented-out `\end{document}` in the body
// ───────────────────────────────────────────────────────────────────────────
describe("M2 · commenting out an early \\end{document} to truncate a compile", () => {
  const SRC = [
    "\\documentclass{article}",
    "\\begin{document}",
    "Real body.",
    "% \\end{document}",
    "More real body.",
    "\\end{document}",
    "",
  ].join("\n");

  it("keeps the whole paper, with the comment still commented", () => {
    const { c1, c2 } = twoCycles(SRC);
    expectInBody(c1, ["Real body.", "More real body.", "% \\end{document}"], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body.", "More real body.", "% \\end{document}"], "cycle 2");
  });

  it("nothing real sits after the live \\end{document}", () => {
    // The user-visible half of the defect: the rest of the paper used to be
    // pushed past a token that had just gone live, so it stopped printing.
    const { c1 } = twoCycles(SRC);
    const { endDoc } = findDocumentBoundary(c1);
    expect(endDoc).toBeGreaterThan(-1);
    expect(c1.slice(endDoc + END_DOCUMENT_TOKEN.length).trim()).toBe("");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M3 · a commented-out `\begin{document}` in the preamble
// ───────────────────────────────────────────────────────────────────────────
describe("M3 · the injector's splice lands at a LIVE offset", () => {
  const SRC = [
    "\\documentclass{article}",
    "% \\begin{document} is below",
    "\\usepackage{natbib}",
    "\\begin{document}",
    "Real body.",
    "\\end{document}",
    "",
  ].join("\n");

  it("does not un-comment the token, and keeps the packages in the preamble", () => {
    const { c1, c2 } = twoCycles(SRC);
    expect(c1).toContain("% \\begin{document} is below");
    expect(c1.slice(0, findDocumentBoundary(c1).beginDoc)).toContain("\\usepackage{natbib}");
    expectInBody(c1, ["Real body."], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body."], "cycle 2");
    expectWellFormed(c2, "cycle 2");
  });

  it("the injected requirement block lands before the LIVE begin", () => {
    const { c1 } = twoCycles(SRC);
    const { beginDoc } = findDocumentBoundary(c1);
    expect(c1.slice(0, beginDoc)).toContain("\\providecommand{\\vfid}");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M4 · a verbatim-quoted `\end{document}`
// ───────────────────────────────────────────────────────────────────────────
describe("M4 · a paper that DOCUMENTS LaTeX", () => {
  const SRC = [
    "\\documentclass{article}",
    "\\begin{document}",
    "Intro.",
    "\\begin{verbatim}",
    "\\end{document}",
    "\\end{verbatim}",
    "Outro.",
    "\\end{document}",
    "",
  ].join("\n");

  it("keeps everything after the verbatim block in the body", () => {
    const { c1, c2 } = twoCycles(SRC);
    expectInBody(c1, ["Intro.", "Outro.", "\\begin{verbatim}", "\\end{verbatim}"], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Intro.", "Outro."], "cycle 2");
  });

  it("writes no Virgil anchor INSIDE the verbatim block", () => {
    // The half that prints literally in the PDF: the cut used to land inside the
    // block, and the anchor for what remained was written on a verbatim line.
    const { c1 } = twoCycles(SRC);
    const open = c1.indexOf("\\begin{verbatim}");
    const close = c1.indexOf("\\end{verbatim}");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    // The body of the block — everything strictly between the two tokens.
    const body = c1.slice(open + "\\begin{verbatim}".length, close);
    expect(body).not.toMatch(/%!v:/);
  });

  it("the FULL verbatim family counts, not just plain verbatim", () => {
    const src = [
      "\\documentclass{article}",
      "\\begin{lstlisting}",
      "\\begin{document}",
      "\\end{lstlisting}",
      "\\begin{document}",
      "Body.",
      "\\end{document}",
      "",
    ].join("\n");
    expect(findDocumentBoundary(src).beginDoc).toBe(
      src.lastIndexOf(BEGIN_DOCUMENT_TOKEN),
    );
  });

  it("an inline \\verb-quoted token is not a boundary either", () => {
    const src = "\\documentclass{article}\nSee \\verb|\\begin{document}| here.\n\\begin{document}\nBody.\n\\end{document}\n";
    expect(findDocumentBoundary(src).beginDoc).toBe(
      src.lastIndexOf(BEGIN_DOCUMENT_TOKEN),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M5 · `\begin {document}` — and the seed the null used to authorize
// ───────────────────────────────────────────────────────────────────────────
describe("M5 · a spelling TeX accepts", () => {
  const SRC = [
    "\\documentclass[11pt]{amsart}",
    "\\usepackage{natbib}",
    "\\begin {document}",
    "Real body.",
    "\\end{document}",
    "",
  ].join("\n");

  it("locates the boundary rather than reading the file as a fragment", () => {
    const d = extractPreambleAndPostamble(SRC);
    expect(d).not.toBeNull();
    expect(d!.preamble).toContain("\\documentclass[11pt]{amsart}");
  });

  it("keeps the user's own \\documentclass and does not seed a second one", () => {
    const { c1, c2 } = twoCycles(SRC);
    expect(c1).toContain("\\documentclass[11pt]{amsart}");
    expect(c1).not.toContain("\\documentclass{article}");
    expect(c1.slice(0, findDocumentBoundary(c1).beginDoc)).toContain("\\documentclass[11pt]{amsart}");
    expectInBody(c1, ["Real body."], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body."], "cycle 2");
    expectWellFormed(c2, "cycle 2");
  });

  it("carries the user's own spelling of the token rather than rewriting it", () => {
    // Re-canonicalizing would be a silent rewrite of a line nobody asked us to
    // touch; the ordinary spelling is byte-identical either way, which is what
    // makes carrying it free.
    const c1 = twoCycles(SRC).c1;
    const { beginDoc, bodyStart } = findDocumentBoundary(c1);
    // The BOUNDARY carries it, not merely the file — under an exact-literal
    // matcher the whole source falls through to the body as a raw carrier, so a
    // whole-file `toContain` passes for the wrong reason.
    expect(c1.slice(beginDoc, bodyStart)).toBe("\\begin {document}");
  });
});

describe("M5 · the seed is for an EMPTY file, never for an unlocatable boundary", () => {
  it("a file with bytes but no boundary keeps its own text and gets no preamble", () => {
    // A fragment (a chapter some master file `\input`s), a preamble-only file, a
    // mid-edit `.tex`. Before task 375 the null was read as "brand-new", so a
    // style seed was written above content the user already had.
    const fragment = "A chapter fragment with prose and a \\section{Heading}.\n";
    const d = resolveWriteDelimiters(fragment);
    expect(d).toEqual({ preamble: "", postamble: "" });
    const out = save(fragment);
    expect(out).not.toContain("\\documentclass");
    expect(out).not.toContain(BEGIN_DOCUMENT_TOKEN);
    expectAllPresent(out, ["A chapter fragment with prose", "\\section{Heading}"]);
  });

  it("a genuinely EMPTY file still seeds — that is what the seed is for", () => {
    expect(resolveWriteDelimiters("")).toBeNull();
    expect(resolveWriteDelimiters("   \n\n ")).toBeNull();
    expect(resolveWriteDelimiters(null)).toBeNull();
    // `undefined` preamble (a caller that stated nothing) still falls back to
    // the classic default — every pre-375 caller's behaviour, unchanged.
    expect(save("")).toContain(BEGIN_DOCUMENT_TOKEN);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CONTROLS — the ordinary paths, through the identical harness
// ───────────────────────────────────────────────────────────────────────────
describe("controls", () => {
  it("an ordinary paper round-trips unchanged from cycle 1", () => {
    const src = [
      "\\documentclass{article}",
      "\\usepackage{amsmath}",
      "\\begin{document}",
      "",
      "Real body.",
      "",
      "\\end{document}",
      "",
    ].join("\n");
    const { c1, c2 } = twoCycles(src);
    expectInBody(c1, ["Real body."], "cycle 1");
    expect(c1).toContain("\\usepackage{amsmath}");
    expect(c1).toContain("\\documentclass{article}");
    expectWellFormed(c1, "cycle 1");
    expect(c2).toBe(c1);
  });

  it("a source with no \\end{document} still runs to EOF", () => {
    const src = "\\documentclass{article}\n\\begin{document}\nBody with no close.\n";
    expect(findDocumentBoundary(src).endDoc).toBe(-1);
    const { c1 } = twoCycles(src);
    expectInBody(c1, ["Body with no close."], "no-close");
    expectWellFormed(c1, "no-close");
  });

  it("an escaped \\% does not start a comment, so the token after it stays live", () => {
    const src = "\\documentclass{article}\n100\\% \\begin{document}\nBody.\n\\end{document}\n";
    expect(findDocumentBoundary(src).beginDoc).toBe(src.indexOf(BEGIN_DOCUMENT_TOKEN));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Unterminated ⇒ TRANSPARENT
//
// The half the adversarial pass on this fix found. The projection's default is
// to swallow an unclosed verbatim open to the end of the source, matching how
// TeX lexes it — right for a DETECTOR, which should fail toward not-detecting,
// and wrong here: a half-typed `\begin{comment}` in a preamble is an ordinary
// mid-edit state in the code pane, and swallowing to EOF erases the
// `\begin{document}` under it. The boundary then vanishes and the save writes
// the whole file back as body — which is the M5 seed defect arriving from the
// other side, on a document that had a perfectly good boundary a keystroke ago.
// ───────────────────────────────────────────────────────────────────────────
describe("an unterminated verbatim open does not erase the boundary", () => {
  const SRC = [
    "\\documentclass{article}",
    "\\begin{comment}",
    "\\usepackage{amsmath}",
    "\\begin{document}",
    "Real body.",
    "\\end{document}",
    "",
  ].join("\n");

  it("keeps the preamble a preamble and the body a body", () => {
    expect(findDocumentBoundary(SRC).beginDoc).toBe(SRC.indexOf(BEGIN_DOCUMENT_TOKEN));
    const { c1, c2 } = twoCycles(SRC);
    expect(c1.slice(0, findDocumentBoundary(c1).beginDoc)).toContain("\\usepackage{amsmath}");
    expectInBody(c1, ["Real body."], "cycle 1");
    expectWellFormed(c1, "cycle 1");
    expectInBody(c2, ["Real body."], "cycle 2");
  });

  it("no Virgil anchor is written into the preamble", () => {
    // The visible cost of losing the boundary: the whole file becomes body, so
    // every preamble line gets a `%!v:` anchor it keeps for good.
    const c1 = twoCycles(SRC).c1;
    expect(c1.slice(0, findDocumentBoundary(c1).beginDoc)).not.toMatch(/%!v:/);
  });

  it("a CLOSED verbatim open still hides what it contains", () => {
    // The control the rule must not break: terminated is still opaque, which is
    // M4. A rule that made every open transparent would reopen it.
    const src = "\\documentclass{article}\n\\begin{comment}\n\\begin{document}\n\\end{comment}\n\\begin{document}\nBody.\n\\end{document}\n";
    expect(findDocumentBoundary(src).beginDoc).toBe(src.lastIndexOf(BEGIN_DOCUMENT_TOKEN));
  });

  it("the DEFAULT projection still swallows — no detector's answer moved", () => {
    // `unterminatedIsLive` is opt-in precisely so the detectors keep the
    // TeX-faithful reading they were tuned against (tasks 344/345).
    const src = "\\begin{verbatim}\n\\usepackage{biblatex}\n";
    expect(projectDetectableLatex(src)).not.toContain("biblatex");
    expect(projectStructuralLatex(src)).toContain("biblatex");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The primitive · offset preservation
// ───────────────────────────────────────────────────────────────────────────
describe("the structural projection preserves offsets — the whole design rests on it", () => {
  // Task 375's own design note assumed `projectDetectableLatex` already blanked
  // bytes. It does NOT: it DELETES them, so an index into it is not an index
  // into the source, and every injector that spliced at one would have spliced
  // at the wrong place. `preserveOffsets` is what makes the offsets usable.
  const SAMPLES = [
    "\\documentclass{article}\n% a comment \\begin{document}\n\\begin{document}\nBody.\n\\end{document}\n",
    "\\begin{verbatim}\nanything at all % here\n\\end{verbatim}\ntail\n",
    "See \\verb|\\begin{document}| and \\verb*+more+ here.\n",
    "no inert bytes at all\n",
    "% only a comment\n",
    "\\begin{minted}\nunterminated to EOF\n",
  ];

  it("is the same LENGTH as its input, sample for sample", () => {
    for (const s of SAMPLES) {
      expect(projectStructuralLatex(s).length, JSON.stringify(s)).toBe(s.length);
    }
  });

  it("blanks only ever REMOVE a match — every surviving byte is where it was", () => {
    for (const s of SAMPLES) {
      const p = projectStructuralLatex(s);
      for (let i = 0; i < s.length; i++) {
        // A byte is either unchanged or blanked to a space; a newline is never
        // blanked, so line geometry survives too.
        expect(p[i] === s[i] || p[i] === " ", `${JSON.stringify(s)} @${i}`).toBe(true);
        if (s[i] === "\n") expect(p[i]).toBe("\n");
      }
    }
  });

  it("the DROPPING form is unchanged — the two modes share which bytes are inert", () => {
    // `preserveOffsets` must be a change to what an inert span BECOMES, never to
    // which spans are inert: every detector in the app reads the dropping form.
    for (const s of SAMPLES) {
      const blanked = projectStructuralLatex(s);
      // Squeezing the blanks out of the preserved form recovers the live bytes
      // the dropping form keeps, modulo the spaces the source itself had.
      expect(blanked.replace(/ +/g, " ").length).toBeLessThanOrEqual(s.length);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CENSUS — the leg with teeth
//
// The door was never the part that could misbehave. A call site that never asks
// it is, and it type-checks perfectly: `tex.indexOf("\\begin{document}")` is a
// valid expression that answers the wrong question, and every behavioural leg
// above stays green while it does.
// ───────────────────────────────────────────────────────────────────────────
const REPO = path.resolve(__dirname, "../../..");
const SILOS = ["src", "library"];

/** The boundary token as it is SPELLED IN SOURCE — `"\\begin{document}"`, or a
 *  regex's `/\\begin\{document\}/`, or the spaced/braced variants. */
const TOKEN_IN_SOURCE = /\\\\(?:begin|end)\\?\{\\?\s*document\\?\}/;

/** A search-shaped operation. If one of these shares a line with the token, the
 *  file is asking WHERE the boundary is — which is the door's question. */
const SEARCH_VERB =
  /\.(?:indexOf|lastIndexOf|includes|search|split|match|matchAll|test|exec|count)\s*\(/;

/** A regex LITERAL over the token — the private-copy shape `StyleEditorModal`
 *  carried, and the one a bare-name grep for `indexOf` cannot see. */
const REGEX_OVER_TOKEN = /\/[^\n/]*\\\\(?:begin|end)\\?\{[^\n/]*document[^\n/]*\//;

/**
 * Files that legitimately SPELL a boundary token without SCANNING for one.
 * Each writes it into a `.tex` (or into a message the user reads); none asks
 * where a boundary is. This list may only shrink.
 */
const PERMITTED_TOKEN_EMITTERS: Record<string, string> = {
  "src/lib/latex-lexer.ts": "the door itself — BEGIN_/END_DOCUMENT_TOKEN and the grammar",
  "src/components/StyleEditorModal.tsx":
    "user-facing validation MESSAGES naming the token as prose; the validation itself asks findLiveDocumentTokens",
  "src/lib/storage-fsa.ts": "the verbatim starter-.tex template blob for a brand-new document",
  "src/lib/storage-dev.ts": "the dev backend's twin of the same starter blob",
  "src/lib/style-library.ts":
    "frozen legacy seed preambles; the v2 migration gate is EXACT BYTE EQUALITY, so deriving them would seal existing libraries out of the upgrade",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function censusFiles(): string[] {
  const files: string[] = [];
  for (const silo of SILOS) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return files.map((f) => path.relative(REPO, f)).sort();
}

/** Code only (comments blanked) but string literals KEPT — the drift lives in
 *  literals and in regexes, which is exactly what a strings-stripped scan would
 *  erase. Line-aligned so a failure names a line. */
function codeLines(rel: string): string[] {
  return strip(fs.readFileSync(path.join(REPO, rel), "utf8"), true, true).split("\n");
}

describe("boundary census — nothing outside the door SCANS for the token", () => {
  const scanners: string[] = [];
  const emitters: string[] = [];
  for (const rel of censusFiles()) {
    let scans = false;
    let mentions = false;
    for (const line of codeLines(rel)) {
      if (!TOKEN_IN_SOURCE.test(line)) continue;
      mentions = true;
      if (REGEX_OVER_TOKEN.test(line) || SEARCH_VERB.test(line)) scans = true;
    }
    if (scans) scanners.push(rel);
    else if (mentions) emitters.push(rel);
  }

  it("no production file searches the raw bytes for a boundary token", () => {
    // No allowlist, and there will not be one: a hit is MIGRATE-it. The question
    // "where is `\begin{document}`?" has exactly one honest answer in this repo,
    // and it is `findDocumentBoundary` / `findLiveDocumentTokens`.
    expect(scanners.filter((f) => f !== "src/lib/latex-lexer.ts")).toEqual([]);
  });

  it("every file that merely SPELLS a token is a declared emitter", () => {
    // The coverage half. A new file spelling the token is not necessarily wrong
    // — but somebody has to say whether it WRITES one or LOOKS for one.
    expect(emitters.filter((f) => !(f in PERMITTED_TOKEN_EMITTERS))).toEqual([]);
  });

  it("the emitter allowlist can only shrink — every entry is still a real hit", () => {
    for (const listed of Object.keys(PERMITTED_TOKEN_EMITTERS)) {
      expect(
        [...emitters, "src/lib/latex-lexer.ts"],
        `${listed} no longer spells a token — drop its entry`,
      ).toContain(listed);
    }
  });

  it("the needles are live — a canary of each shape is caught", () => {
    // A census that matches nothing passes for the wrong reason. The canary is
    // SYNTHETIC rather than one of the lines the allowlist drains: a canary
    // standing on the defect evaporates the moment the defect is fixed.
    const canaries = [
      'const i = tex.indexOf("\\\\begin{document}");',
      "const BEGIN_DOC_RE = /\\\\begin\\{document\\}/g;",
      'if (text.includes("\\\\end{document}")) return;',
    ];
    for (const c of canaries) {
      expect(TOKEN_IN_SOURCE.test(c), c).toBe(true);
      expect(REGEX_OVER_TOKEN.test(c) || SEARCH_VERB.test(c), c).toBe(true);
    }
    // …and the census really examined the tree it claims to.
    expect(censusFiles().length).toBeGreaterThan(300);
    expect(emitters.length).toBeGreaterThan(0);
  });
});

describe("the Python twin scans the same way", () => {
  // `editor/scripts/_common.py` carries the port, and `apply_response.py`'s
  // `region-replace` splices at its offset — replacing everything BEFORE it, so
  // a raw `find` landing inside a `% \begin{document}` comment would take the
  // user's real preamble with it. The numeric parity is pinned by the shared
  // corpus (`preservation-measure-parity.test.ts`); this is the call-site half.
  const PY = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

  it("apply_response.py asks the live door, never a raw find/count", () => {
    const src = PY("editor/scripts/apply_response.py");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    // The `region-replace` branch — the one that splices at a boundary offset.
    // Scoped to that branch rather than to the file, because the OTHER
    // `text.find(marker)` calls here look for a `%!v:` ANCHOR, which is a
    // different question with a different (and correct) raw answer.
    const branch = code.slice(
      code.indexOf('if mode == "region-replace":'),
      code.indexOf('if mode == "replace-span":'),
    );
    expect(branch.length, "the region-replace branch has moved").toBeGreaterThan(100);
    expect(branch).toContain("first_live_index_of(text, marker)");
    expect(branch).not.toMatch(/text\.find\(marker\)/);
    expect(code).toContain("count_live_document_begins(after)");
    expect(code).not.toMatch(/after\.count\(DOCUMENT_MARKER\)/);
  });

  it("_common.py's split_regions asks the live door", () => {
    const src = PY("editor/scripts/_common.py");
    expect(src).toContain("i, _, _ = find_document_boundary(tex)");
    expect(src).not.toMatch(/i = tex\.find\(DOCUMENT_MARKER\)/);
  });
});
