// @vitest-environment node
//
// `npx vitest run` drives EVERY stdlib-Python suite in the repo (task 622).
//
// Nothing else in `npm test` runs Python, so a suite with no vitest shell was
// a suite nobody ran — and the shells were hand-written, one per suite, so
// half the Library's suites (10 of 20) never got one. This file replaces that
// habit (and the fifteen single-suite shells it grew) with ONE census over
// `scripts/lib/python-suites.mjs`: the population is DISCOVERED, so a new
// `test_*.py` under `editor/scripts/` or `library/scripts/` is run here the
// day it lands, with nothing to remember.
//
// What the retired shells each said, kept once here:
// - `python3` unavailable FAILS rather than skips — a guard that quietly opts
//   out of the environment it protects is the thing this exists to stop.
// - A PASS needs a readable tally with ≥1 test run and 0 failed, not just
//   exit 0: `test_master_bib_field_preservation.py` (the task-164 master.bib
//   data-loss guard) had no `__main__` and exited 0 having run nothing.
// - Both streams are read: `unittest` writes its tally to STDERR.
// - `--standalone` is passed to suites that accept it, so the tally is the
//   shared runner's own whether or not pytest is installed on the machine
//   (the `f4-write-gate-python.test.ts` hazard: a pytest-only machine failed
//   a guard whose Python passed).
// - Suites whose gutting would still print a clean tally carry a FLOOR
//   (`FLOORS` in the runner — the dream/reflect suites' old shells).
//
// The same runner is the CI python step (`node scripts/lib/python-suites.mjs`
// in deploy.yml + coherence.yml).
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REPO_ROOT,
  FLOORS,
  acceptsStandalone,
  discoverSuites,
  readTally,
  runSuite,
} from "../lib/python-suites.mjs";

const suites = discoverSuites();

describe("python-suite census — discovery", () => {
  it("finds both silos, the tests/ dirs AND library/scripts' top-level suites", () => {
    // A discovery that came back short would report green for the wrong
    // reason, so a few named members from each place pin it.
    for (const member of [
      "editor/scripts/tests/test_pen_atomic.py",
      "library/scripts/tests/test_master_bib_field_preservation.py",
      "library/scripts/tests/test_f4_writer_side.py",
      "library/scripts/test_wiring.py",
      "library/scripts/test_dedup_cli.py",
    ]) {
      expect(suites).toContain(member);
    }
    expect(suites.length).toBeGreaterThanOrEqual(50);
  });

  it("every FLOOR names a suite that exists", () => {
    for (const file of Object.keys(FLOORS)) expect(suites).toContain(file);
  });

  it("no CI workflow runs python suites by any door but the shared runner", () => {
    // The old step looped `editor/scripts/tests/test_*.py` only — the gap this
    // task closed. A hand loop reappearing would reopen it for whichever silo
    // it forgot.
    for (const wf of ["deploy.yml", "coherence.yml"]) {
      const text = readFileSync(
        path.join(REPO_ROOT, ".github/workflows", wf),
        "utf8",
      );
      expect(text, wf).toContain("node scripts/lib/python-suites.mjs");
      expect(text, wf).not.toMatch(/python3\s+"?\$f"?/);
    }
  });
});

describe("python-suite census — the pass rule", () => {
  it("reads every tally shape the repo prints", () => {
    expect(readTally("PASS a\n\n11/11 passed\n")).toEqual({ passed: 11, failed: 0 });
    expect(readTally("RESULT: 60/61 passed")).toEqual({ passed: 60, failed: 1 });
    expect(readTally("===== 48 passed, 0 failed =====")).toEqual({ passed: 48, failed: 0 });
    expect(readTally("PASS: 37   FAIL: 2")).toEqual({ passed: 37, failed: 2 });
    expect(readTally("....\nRan 15 tests in 0.03s\n\nOK (skipped=1)\n")).toEqual({
      passed: 14,
      failed: 0,
    });
    expect(
      readTally("Ran 5 tests in 0.1s\n\nFAILED (failures=1, errors=1)\n"),
    ).toEqual({ passed: 3, failed: 2 });
    // The LAST tally wins — a probe's inner "0/1 passed" is not the verdict.
    expect(readTally("inner 0/1 passed\n...\n9/9 passed")).toEqual({ passed: 9, failed: 0 });
    expect(readTally("ALL TESTS PASSED\n")).toBeNull();
    expect(readTally("")).toBeNull();
  });

  it("knows which suites take --standalone", () => {
    expect(acceptsStandalone("    from _standalone import main\n")).toBe(true);
    expect(acceptsStandalone('if "--standalone" in sys.argv:')).toBe(true);
    expect(acceptsStandalone("unittest.main()")).toBe(false);
  });

  it("FAILS a suite that exits 0 having run nothing, naming it", () => {
    // The teeth: the field-preservation suite's pre-task-622 shape.
    const root = mkdtempSync(path.join(tmpdir(), "py-census-"));
    try {
      mkdirSync(path.join(root, "library/scripts/tests"), { recursive: true });
      const file = "library/scripts/tests/test_silent.py";
      writeFileSync(path.join(root, file), "def test_never_called():\n    assert False\n");
      const res = runSuite(file, root);
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/printed no pass tally/);

      writeFileSync(path.join(root, file), "print('3/3 passed')\nraise SystemExit(1)\n");
      expect(runSuite(file, root).reason).toMatch(/exited 1/);

      writeFileSync(path.join(root, file), "print('===== 0 passed, 0 failed =====')\n");
      expect(runSuite(file, root).reason).toMatch(/below its floor of 1/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("python-suite census — every suite passes", () => {
  it.each(suites)(
    "%s",
    (file) => {
      const res = runSuite(file);
      expect(res.ok, `${file}: ${res.reason}\n${res.output}`).toBe(true);
    },
    300_000,
  );
});
