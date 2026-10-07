// @vitest-environment node
//
// The python-suite CENSUS legs — discovery, the pass rule, hermeticity — split
// from `python-suites.test.ts` (which RUNS every suite, ~70 s) so the census
// rides `npm run test:guards` on every task without the suites (task 988).
// The doctrine for both lives in that file's header.
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  REPO_ROOT,
  FLOORS,
  acceptsStandalone,
  discoverSuites,
  readTally,
  runSuite,
  suiteEnv,
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

describe("python-suite census — hermetic about the user's library", () => {
  it("runs every suite with an empty HOME and no VIRGIL_LIBRARY_ROOT", () => {
    // Task 913: the library door falls through to VIRGIL_LIBRARY_ROOT,
    // ~/.config/virgil/library-path.json and ~/Virgil-Library, so a suite run
    // with the developer's own HOME reached their REAL library — green on the
    // Mac, red on CI. The sandbox makes a dev box see what CI sees.
    const env = suiteEnv();
    expect(env.VIRGIL_LIBRARY_ROOT).toBeUndefined();
    expect(env.HOME).not.toBe(process.env.HOME);
    expect(readdirSync(env.HOME)).toEqual([]);
  });
});
