// Marker conservation across a suggestion splice, across the TS/PYTHON seam
// (task 1426).
//
// Three doors land a suggestion's replacement in the paper: the browser
// applicator (`applyPendingChange`), and `apply_response.py`'s propose guard and
// accept splice. Until 1426 they answered "may the replacement hold identity
// markers?" three different ways. Now each asks ONE predicate —
// `markerConservationViolation` here, `marker_conservation_violation` in
// `editor/scripts/_common.py` — and both answer this shared GOLDEN corpus:
// `fixtures/marker-conservation-corpus.json`. The Python reader is
// `editor/scripts/tests/test_marker_conservation.py` (run by the python-suites
// census). Change the rule in both languages and regenerate `expected`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VIRGIL_MARKER_COMMANDS } from "@/lib/latex-markers";
import {
  ATOM_ID_MARKERS,
  CUT_MAY_DROP_MARKERS,
  describeMarkerViolation,
  markerConservationViolation,
  type MarkerConservationViolation,
} from "@/lib/marker-conservation";

interface Case {
  name: string;
  why: string;
  matched: string;
  replacement: string;
  wholeCut: boolean;
  humanAuthored?: boolean;
  expected: MarkerConservationViolation | null;
}

const CORPUS: { cases: Case[] } = JSON.parse(
  readFileSync(join(__dirname, "fixtures/marker-conservation-corpus.json"), "utf8"),
);

const PY_COMMON = readFileSync(
  join(__dirname, "../../../editor/scripts/_common.py"),
  "utf8",
);

describe("marker conservation — the shared corpus", () => {
  it("covers every rule and both verdicts", () => {
    const rules = new Set(CORPUS.cases.map((c) => c.expected?.rule ?? "ok"));
    for (const r of ["ok", "introduced", "dropped", "atom-detached", "unpaired", "atom-left"])
      expect(rules, r).toContain(r);
    for (const c of CORPUS.cases)
      expect(c.why.length, `${c.name} states no reason`).toBeGreaterThan(20);
  });

  for (const c of CORPUS.cases) {
    it(c.name, () => {
      expect(
        markerConservationViolation(c.matched, c.replacement, {
          wholeCut: c.wholeCut,
          humanAuthored: c.humanAuthored,
        }),
      ).toEqual(
        c.expected,
      );
    });
  }

  it("every refusal names the marker call", () => {
    for (const c of CORPUS.cases) {
      if (!c.expected) continue;
      expect(describeMarkerViolation(c.expected)).toContain(
        `\\${c.expected.command}{${c.expected.id}}`,
      );
    }
  });
});

describe("marker conservation — the Python twin's tables", () => {
  it("CUT_MAY_DROP_MARKERS is mirrored verbatim", () => {
    const m = PY_COMMON.match(/^CUT_MAY_DROP_MARKERS = \(([^)]*)\)/m);
    expect(m, "CUT_MAY_DROP_MARKERS not found in _common.py").not.toBeNull();
    const py = [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    expect(py).toEqual([...CUT_MAY_DROP_MARKERS]);
  });

  it("ATOM_ID_MARKERS is mirrored verbatim (task 1484)", () => {
    // The TS list is derived (inline .tex markers delimiting no range); the
    // Python copy is hand-held, so pin it — and pin the derivation's answer.
    expect([...ATOM_ID_MARKERS]).toEqual(["vfid", "vcid"]);
    const m = PY_COMMON.match(/^ATOM_ID_MARKERS = \(([^)]*)\)/m);
    expect(m, "ATOM_ID_MARKERS not found in _common.py").not.toBeNull();
    const py = [...m![1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    expect(py).toEqual([...ATOM_ID_MARKERS]);
  });

  it("the twin scans the full marker vocabulary", () => {
    // `_MARKER_CALL_RE` is built from VIRGIL_MARKER_COMMANDS, which
    // preservation-measure-parity pins to the TS SSOT.
    expect(PY_COMMON).toContain(
      "_MARKER_CALL_RE = re.compile(\n    r\"\\\\(\" + \"|\".join(sorted(VIRGIL_MARKER_COMMANDS, key=len, reverse=True))",
    );
    expect(VIRGIL_MARKER_COMMANDS.length).toBe(7);
  });
});
