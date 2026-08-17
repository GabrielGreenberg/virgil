// Task 344 — "which bib family does this document use?" is ONE question with
// ONE door, and detection is a SEED that never overwrites a stored choice.
//
// Two defects on one axis, each making the other worse:
//
//  1. The detector was fed the WHOLE RAW `.tex` — preamble, body, comments,
//     verbatim blocks — although `detectPreambleBibFamily`'s own docstring
//     required the inert-stripped preamble. So a commented-out
//     `% \usepackage{biblatex}` (the single most ordinary thing in an academic
//     preamble) and a verbatim-quoted package name in a methods paragraph each
//     outranked a live `\usepackage{natbib}`. The requirements side has
//     projected inert bytes away since P4; the bib side never got the memo.
//
//  2. The answer was written into `citations.json`, overwriting the user's own
//     Package setting on every doc open — and since `usePersistentState.update`
//     persists the whole state object, the next unrelated citations write made
//     the mis-detection durable, whereupon the SAVE path hands it to
//     `ensurePreambleRequirements` as the authoritative `declaredBibFamily` and
//     injects the wrong `\usepackage` into the user's `.tex`.
//
// This file pins the DETECTION half plus the census; the AUTHORITY half is
// driven through the real hook in
// src/hooks/__tests__/citations-bib-family-seed.test.tsx.
//
// The leg with teeth is the CENSUS. `detectBibFamily` was never the part that
// could misbehave — a second call site feeding raw bytes to the primitives is,
// and that is exactly the shape that shipped: `storage-fsa.detectBibPackage`
// called `detectPreambleBibFamily(tex)` directly, spelling no needle any
// behavioural test of the door could see.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "./_source-scan";
import {
  detectBibFamily,
  DEFAULT_BIB_FAMILY,
  type BibFamily,
} from "@/lib/bib-family";

// ---------------------------------------------------------------------------
// Detection: only LIVE bytes count, and `\usepackage` is asked of the PREAMBLE
// ---------------------------------------------------------------------------

/** Fixture A from the finding: the user tried biblatex, commented it out, and
 *  is on natbib. Pre-fix: "biblatex". */
const COMMENTED_OUT = `\\documentclass{article}
% \\usepackage{biblatex}   % tried this, didn't work
\\usepackage{natbib}
\\begin{document}
Prose \\citep{smith2020}.
\\end{document}
`;

/** Fixture B: a methods paragraph QUOTES a package line inside verbatim.
 *  Pre-fix: "biblatex". */
const VERBATIM_QUOTED = `\\documentclass{article}
\\usepackage{natbib}
\\begin{document}
We first tried:
\\begin{verbatim}
\\usepackage{biblatex}
\\end{verbatim}
and settled on natbib.
\\end{document}
`;

/** Fixture C: the passing CONTROL. Without it the two legs above could pass
 *  vacuously (a detector that answered "natbib" unconditionally). */
const PLAIN_NATBIB = `\\documentclass{article}
\\usepackage{natbib}
\\begin{document}
Prose.
\\end{document}
`;

/** The control's mirror image — a genuinely live biblatex load must still be
 *  detected, so "strip more" can never be mistaken for "detect less". */
const PLAIN_BIBLATEX = `\\documentclass{article}
\\usepackage{biblatex}
\\begin{document}
Prose \\autocite{smith2020}.
\\end{document}
`;

describe("detectBibFamily — inert bytes never pin a family", () => {
  it("a commented-out \\usepackage{biblatex} loses to the live natbib load", () => {
    expect(detectBibFamily(COMMENTED_OUT)).toBe<BibFamily>("natbib");
  });

  it("a verbatim-quoted package line in the BODY does not pin the family", () => {
    expect(detectBibFamily(VERBATIM_QUOTED)).toBe<BibFamily>("natbib");
  });

  it("(control) a plain live natbib load is unchanged", () => {
    expect(detectBibFamily(PLAIN_NATBIB)).toBe<BibFamily>("natbib");
  });

  it("(control) a plain live biblatex load is still detected", () => {
    expect(detectBibFamily(PLAIN_BIBLATEX)).toBe<BibFamily>("biblatex");
  });

  it("a commented-out \\RequirePackage is inert too (the wrapper vocabulary rides the same projection)", () => {
    const tex = `\\documentclass{article}
% \\RequirePackage[authordate]{biblatex-chicago}
\\begin{document}
Prose \\citep{a}.
\\end{document}
`;
    expect(detectBibFamily(tex)).toBe<BibFamily>("natbib");
  });
});

describe("detectBibFamily — the \\usepackage question is asked of the PREAMBLE", () => {
  it("a live \\usepackage{biblatex} sitting in the BODY does not pin the family", () => {
    // Illegal LaTeX, but it is what a pasted snippet looks like mid-draft, and
    // the pre-fix detector scanned the whole file.
    const tex = `\\documentclass{article}
\\usepackage{natbib}
\\begin{document}
Paste from a colleague: \\usepackage{biblatex}
\\end{document}
`;
    expect(detectBibFamily(tex)).toBe<BibFamily>("natbib");
  });

  it("a COMMENTED \\begin{document} cannot move the preamble boundary", () => {
    // The split is taken on the PROJECTED text, so the commented marker is not
    // there to be found; the real one is.
    const tex = `\\documentclass{article}
% \\begin{document}
\\usepackage{biblatex}
\\begin{document}
Prose.
\\end{document}
`;
    expect(detectBibFamily(tex)).toBe<BibFamily>("biblatex");
  });

  it("a fragment with no \\begin{document} fails OPEN (the whole projection is preamble)", () => {
    expect(detectBibFamily("\\usepackage{biblatex}\n")).toBe<BibFamily>(
      "biblatex",
    );
  });
});

describe("detectBibFamily — the command-usage fallback", () => {
  it("stays whole-source: preamble usage still counts", () => {
    const tex = `\\documentclass{article}
\\newcommand{\\mycite}[1]{\\autocite{#1}}
\\begin{document}
Prose.
\\end{document}
`;
    expect(detectBibFamily(tex)).toBe<BibFamily>("biblatex");
  });

  it("but gains inertness: a \\citep inside a verbatim listing no longer pins natbib", () => {
    const tex = `\\documentclass{article}
\\begin{document}
The natbib form is:
\\begin{verbatim}
\\citep{smith2020}
\\end{verbatim}
We use \\autocite{smith2020}.
\\end{document}
`;
    expect(detectBibFamily(tex)).toBe<BibFamily>("biblatex");
  });

  it("nothing pinning a family answers DEFAULT_BIB_FAMILY — which is why it is a SEED, not an answer", () => {
    expect(detectBibFamily("\\documentclass{article}\n")).toBe(
      DEFAULT_BIB_FAMILY,
    );
    // A caller cannot tell this apart from a detected natbib. That is the
    // whole reason detection may not overwrite a stored choice.
    expect(detectBibFamily(PLAIN_NATBIB)).toBe(DEFAULT_BIB_FAMILY);
  });
});

// ---------------------------------------------------------------------------
// Census — the leg with teeth
// ---------------------------------------------------------------------------

const ROOT = join(__dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const PRODUCTION_FILES = [join(ROOT, "src"), join(ROOT, "library")].flatMap(
  (d) => walk(d),
);

describe("census — nobody re-derives the family question", () => {
  it("only bib-family.ts calls the raw-byte primitives", () => {
    // `detectPreambleBibFamily` / `detectCommandBibFamily` take bytes that have
    // ALREADY been projected; `detectBibFamily` (and `reconcileBibFamily`) are
    // the doors that project. A call from anywhere else is a second detector
    // with its own idea of what counts as live — which is exactly what
    // storage-fsa was, for a year, with every suite green.
    const offenders = PRODUCTION_FILES.filter((f) => {
      if (f.endsWith(join("src", "lib", "bib-family.ts"))) return false;
      const code = codeOnly(readFileSync(f, "utf8"));
      return /\bdetect(?:Preamble|Command)BibFamily\s*\(/.test(code);
    }).map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the projection door is named, not re-spelled per caller", () => {
    // `projectLiveLatex(src, { envs: VERBATIM_ENVS_NARROW })` is the detector
    // projection; spelled inline it drifts (the requirements side and the bib
    // side would each own a copy of the F1 family decision). Everything that
    // wants it spells `projectDetectableLatex`.
    const offenders = PRODUCTION_FILES.filter((f) => {
      if (f.endsWith(join("src", "lib", "latex-lexer.ts"))) return false;
      const code = codeOnly(readFileSync(f, "utf8"));
      return /VERBATIM_ENVS_NARROW/.test(code);
    }).map((f) => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("the baseline family is spelled ONCE", () => {
    // Pre-344 there were three hand-written copies that disagreed:
    // `detectBibPackage` fell back to "natbib" while `useCitations`' EMPTY
    // state and CITATIONS_INERT both said "biblatex". The disagreement is what
    // made an ordinary doc OPEN look like a package switch to every
    // CitationCard. `useCitations` must read the constant, never a literal.
    const hook = codeOnly(
      readFileSync(join(ROOT, "src", "hooks", "useCitations.ts"), "utf8"),
    );
    expect(hook).toContain("DEFAULT_BIB_FAMILY");
    expect(hook).not.toMatch(/bibPackage:\s*"(?:natbib|biblatex)"/);
  });

  it("the census can see (canary)", () => {
    // A canary standing on the drained defect proves nothing, so this one is
    // synthetic: the needles must match a fabricated offender.
    const fixture = codeOnly(
      `const f = detectPreambleBibFamily(tex);\n` +
        `projectLiveLatex(x, { envs: VERBATIM_ENVS_NARROW });\n`,
    );
    expect(/\bdetect(?:Preamble|Command)BibFamily\s*\(/.test(fixture)).toBe(
      true,
    );
    expect(/VERBATIM_ENVS_NARROW/.test(fixture)).toBe(true);
    expect(PRODUCTION_FILES.length).toBeGreaterThan(300);
  });
});
