// The preservation measure, across the TYPESCRIPT/PYTHON seam (task 357).
//
// The `/editor/*` skills are the third writer of a paper's `.tex`, and
// `apply_response.py`'s `region-replace` rewrites the whole preamble from model
// output. Gating it means the rule has to exist in Python — and a rule
// reimplemented in a second language DRIFTS. Nothing can share code across that
// seam: `_common.py` cannot import `tex-preservation.ts` and never will.
//
// So what holds the two halves together is a shared FIXTURE CORPUS that both
// implementations must answer identically, byte for byte and number for number:
// `fixtures/preservation-corpus.json`. This file is the TS reader — it asserts
// the shipped TS implementation still produces the recorded numbers, which makes
// the corpus a GOLDEN file rather than merely a shared input. That matters: a
// shared input alone would be satisfied by both languages drifting the same way,
// which is exactly what a "port the rule" commit is most likely to do.
//
// The Python reader is `editor/scripts/tests/test_preservation_measure.py`,
// driven in CI by `preservation-measure-python.test.ts`. If you change the rule,
// change it in both languages, regenerate the `expected` blocks, and say in the
// commit why the numbers moved.
//
// The corpus cases are chosen to pin the DECISIONS rather than to cover inputs:
// the marker projection, the region split, the fail-safe treatment of a source
// with no `\begin{document}`, comments as content, the punctuation
// normalizations that must stay free, the four-word floor's measured limit, and
// the two masking shapes (a growing preamble against a shrinking body; growth
// inside ONE region against loss in the same region — the case a net count
// scores at zero and the shortfall does not).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkTexPreservation,
  measureContentWords,
  missingWords,
  measureContentBag,
} from "@/lib/tex-preservation";
import {
  VERBATIM_ENVS_FULL,
  findDocumentBoundary,
  findLiveDocumentTokens,
  projectStructuralLatex,
} from "@/lib/latex-lexer";
import { VIRGIL_MARKER_COMMANDS } from "@/lib/latex-markers";

interface BoundaryCase {
  name: string;
  why: string;
  tex: string;
  expected: {
    beginDoc: number;
    bodyStart: number;
    endDoc: number;
    liveBegins: number;
    liveEnds: number;
  };
}

interface Case {
  name: string;
  why: string;
  before: string;
  after: string;
  expected: ReturnType<typeof checkTexPreservation>;
}

const CORPUS: { cases: Case[]; boundaryCases: BoundaryCase[] } = JSON.parse(
  readFileSync(join(__dirname, "fixtures/preservation-corpus.json"), "utf8"),
);

describe("the shared corpus is the rule, written down", () => {
  it("covers the decisions it claims to", () => {
    // A corpus that quietly shrank would make the parity suite vacuous in both
    // languages at once.
    expect(CORPUS.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of CORPUS.cases) {
      expect(c.why.length, `${c.name} states no reason for existing`).toBeGreaterThan(20);
    }
    // Both verdicts must be represented, or the corpus only pins one direction.
    const verdicts = new Set(CORPUS.cases.map((c) => c.expected.ok));
    expect(verdicts).toEqual(new Set([true, false]));
  });

  it.each(CORPUS.cases.map((c) => [c.name, c] as const))(
    "TS answers %s exactly as recorded",
    (_name, c) => {
      expect(checkTexPreservation(c.before, c.after)).toEqual(c.expected);
    },
  );
});

describe("the shortfall is a strict strengthening of the net count", () => {
  it("is never smaller than the net difference, over the whole corpus", () => {
    // The property that makes this a safe change to a shipped gate: nothing the
    // pre-357 rule refused can now be allowed.
    for (const c of CORPUS.cases) {
      for (const region of ["body", "preamble"] as const) {
        const v = c.expected[region];
        expect(v.lost, `${c.name}/${region}`).toBeGreaterThanOrEqual(
          Math.max(0, v.before - v.after),
        );
      }
    }
  });

  it("sees a loss the net count scores at zero", () => {
    // The corpus case, restated as the property it exists for.
    const before = "alpha beta gamma delta";
    const after = "alpha beta one two three";
    expect(measureContentWords(after)).toBeGreaterThan(measureContentWords(before));
    expect(
      missingWords(measureContentBag(before), measureContentBag(after)),
    ).toBe(2);
  });

  it("is blind to ORDER, which a contiguous-run check would not be", () => {
    // Why this is a multiset rather than the run check it was first sketched
    // as: the serializer legitimately MOVES word runs (task 356 hoists a
    // `\title{…}` past the package block), and a run check refuses every one.
    const a = "\\title{On Annotation} \\usepackage{expex} \\usepackage{graphicx}";
    const b = "\\usepackage{expex} \\usepackage{graphicx} \\title{On Annotation}";
    expect(missingWords(measureContentBag(a), measureContentBag(b))).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The BOUNDARY, across the same seam (task 375)
//
// The gate has to split the document the way the parser splits it, or it is
// structurally blind to the defect it exists to catch: a boundary that MOVED
// measures with everything under body on both sides and reports a shortfall of
// 0 while the paper has been cut in half. So the rule is ported to
// `_common.py` too, and held here by a second GOLDEN corpus section rather than
// by two hand-typed tables.
// ───────────────────────────────────────────────────────────────────────────
describe("the preamble/body boundary is the same rule in both languages", () => {
  it("covers the members it claims to", () => {
    const names = CORPUS.boundaryCases.map((c) => c.name);
    for (const m of ["M1", "M2", "M3", "M4", "M5", "ordinary"]) {
      expect(
        names.some((n) => n.startsWith(m)),
        `the boundary corpus lost its ${m} case`,
      ).toBe(true);
    }
    for (const c of CORPUS.boundaryCases) {
      expect(c.why.length, `${c.name} states no reason for existing`).toBeGreaterThan(20);
    }
  });

  it("the shipped TS implementation still produces the recorded offsets", () => {
    for (const c of CORPUS.boundaryCases) {
      const b = findDocumentBoundary(c.tex);
      const t = findLiveDocumentTokens(c.tex);
      expect(
        {
          beginDoc: b.beginDoc,
          bodyStart: b.bodyStart,
          endDoc: b.endDoc,
          liveBegins: t.begins.length,
          liveEnds: t.ends.length,
        },
        `${c.name}: ${c.why}`,
      ).toEqual(c.expected);
    }
  });

  it("the end is searched FROM the begin, so it can never precede it (M1)", () => {
    // The property behind the corpus numbers. A comment, a `\newcommand`, a
    // `\verb` — any of them can put the literal `\end{document}` above the
    // begin, and before task 375 that emptied the whole body into the
    // postamble and wrote a `.tex` with two `\begin{document}`.
    for (const c of CORPUS.boundaryCases) {
      if (c.expected.endDoc === -1 || c.expected.beginDoc === -1) continue;
      expect(c.expected.endDoc, c.name).toBeGreaterThanOrEqual(
        c.expected.bodyStart,
      );
    }
  });

  it("the projection PRESERVES OFFSETS — the whole design rests on it", () => {
    // Task 375's own design note assumed `projectDetectableLatex` already
    // blanked bytes. It does not: it DELETES them, so an index into it is not
    // an index into the source, and every injector that spliced at one would
    // have spliced at the wrong place. `preserveOffsets` is what makes the
    // boundary offsets usable, and this is its pin.
    for (const c of CORPUS.boundaryCases) {
      const projected = projectStructuralLatex(c.tex);
      expect(projected.length, `${c.name} changed length`).toBe(c.tex.length);
      // Blanking can only ever REMOVE a match, never create one — so every live
      // byte is still where it was.
      if (c.expected.beginDoc !== -1) {
        expect(
          projected.slice(c.expected.beginDoc, c.expected.bodyStart),
          c.name,
        ).toBe(c.tex.slice(c.expected.beginDoc, c.expected.bodyStart));
      }
    }
  });
});

describe("the Python port's verbatim vocabulary is pinned to the SSOT", () => {
  it("`_common.py` names exactly the family `latex-lexer.ts` declares", () => {
    // Same instrument as the marker tuple below, and the same failure it
    // guards: a family member added on the TS side and left stale here would
    // make the Python gate split at a boundary the parser does not recognize.
    const py = readFileSync(
      join(__dirname, "../../../editor/scripts/_common.py"),
      "utf8",
    );
    const block = py.match(/VERBATIM_ENVS_FULL = \(([\s\S]*?)\n\)/);
    expect(block, "the Python family tuple has moved or been renamed").not.toBeNull();
    const names = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...VERBATIM_ENVS_FULL]);
  });
});

describe("the Python port's marker vocabulary is pinned to the SSOT", () => {

  it("`_common.py` names exactly the commands `latex-markers.ts` declares", () => {
    // Python cannot import the SSOT, so membership is the instrument — the same
    // one the marker census uses for the skill markdown it likewise cannot
    // reach. A marker renamed on the TS side and left stale here would make the
    // Python measure count Virgil's own markers as the user's words, and every
    // first save would look like a GAIN — which is what could mask a real loss.
    const py = readFileSync(
      join(__dirname, "../../../editor/scripts/_common.py"),
      "utf8",
    );
    const block = py.match(/VIRGIL_MARKER_COMMANDS = \(([\s\S]*?)\)/);
    expect(block, "the Python vocabulary tuple has moved or been renamed").not.toBeNull();
    const names = [...block![1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([...VIRGIL_MARKER_COMMANDS]);
  });
});
