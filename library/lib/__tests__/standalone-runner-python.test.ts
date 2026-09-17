// @vitest-environment node
//
// The SHARED standalone runner's own behaviour
// (task 510) — `library/scripts/tests/_standalone.py`.
//
// Nothing in CI runs Python: `npm test` is vitest-only, so a Python suite with
// no vitest shell is a suite nobody runs. `test_f4_writer_side.py` had none.
// It covers the F#4 writer half (a reference-only entry mints no catalog row
// but DOES get its `% bib.state` comment; the postflight shrinkage guard; the
// needs-reauth round trip; the prune script's back-fill-before-delete
// ordering) and it reported 18/19 locally for months, because its hand-written
// `__main__` injected `tmp_path` POSITIONALLY and one leg also takes `capsys`
// — a TypeError that reads like an ordinary failure. Both halves are one
// finding: *a leg that cannot run is a habit, not a guard*, and a SUITE that
// cannot run is the same thing one size up.
//
// RUNNING THE ADOPTERS moved to the repo's ONE python-suite census (task
// 622, `scripts/__tests__/python-suites.test.ts`), which discovers every
// `test_*.py` in both silos, not only this runner's adopters, and passes
// `--standalone` so the tally is this runner's own on any machine. What stays
// here is the runner's own behaviour: the named refusal and the capsys shim.
//
// If `python3` is genuinely unavailable the test FAILS rather than skips — a
// guard that quietly opts out of the environment it is meant to protect is the
// thing this file exists to stop.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TESTS_DIR = path.join(REPO_ROOT, "library/scripts/tests");

const runPython = (args: string[]): string =>
  execFileSync("python3", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("Python suites on the shared standalone runner", () => {
  it("fails LOUDLY, naming a fixture the runner cannot supply", () => {
    // The runner's headline behaviour, and the reason it replaced a
    // positional one: an unsupported fixture must be a NAMED refusal, not a
    // TypeError indistinguishable from the test itself failing.
    const probe = [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(TESTS_DIR)})`,
      "from _standalone import run_standalone",
      "def test_needs_something(tmp_path, monkeypatch): pass",
      "sys.exit(run_standalone(dict(globals())))",
    ].join("\n");
    let out = "";
    try {
      out = runPython(["-c", probe]);
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(out).toContain("FAIL test_needs_something");
    expect(out).toContain("monkeypatch");
    expect(out).toContain("0/1 passed");
    // And it must not be a bare TypeError — the shape being retired.
    expect(out).not.toMatch(/TypeError.*positional argument/);
  });

  it("captures stdout for a `capsys` leg without swallowing its own tally", () => {
    // The shim redirects stdout for the duration of the test. The runner's
    // PASS/FAIL lines and its tally are printed OUTSIDE that window, or a
    // green suite would look silent to every shell above.
    const probe = [
      "import sys",
      `sys.path.insert(0, ${JSON.stringify(TESTS_DIR)})`,
      "from _standalone import run_standalone",
      "def test_reads_its_own_output(capsys):",
      "    print('SWALLOWED')",
      "    assert capsys.readouterr().out == 'SWALLOWED\\n'",
      "    assert capsys.readouterr().out == ''",  // drains, as pytest does
      "sys.exit(run_standalone(dict(globals())))",
    ].join("\n");
    const out = runPython(["-c", probe]);
    expect(out).toContain("PASS test_reads_its_own_output");
    expect(out).toContain("1/1 passed");
    expect(out).not.toContain("SWALLOWED");
  });
});
