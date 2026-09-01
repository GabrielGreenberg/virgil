// @vitest-environment node
//
// CI teeth for every Python suite that runs on the SHARED standalone runner
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
// THE POPULATION IS DISCOVERED, which is why this is one file and not three.
// Its members are the suites that ADOPT the shared runner — grepped out of
// `library/scripts/tests/` — so a fourth adopter is driven by CI the moment it
// adopts, with nothing to remember. Three hand-written shells would have left
// exactly the gap this file exists to close for two of the three files the
// same change touched.
//
// Each suite is run with `--standalone`, so what it prints is the runner's own
// `<n>/<n> passed` tally rather than pytest's — deterministic on any machine,
// installed pytest or not. `_standalone.main()` states that reason at the
// source; two sibling suites already spelled their own copy of it.
//
// If `python3` is genuinely unavailable the test FAILS rather than skips — a
// guard that quietly opts out of the environment it is meant to protect is the
// thing this file exists to stop.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TESTS_DIR = path.join(REPO_ROOT, "library/scripts/tests");

/** Every suite whose `__main__` runs on the shared runner. */
function adopters(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((n) => n.startsWith("test_") && n.endsWith(".py"))
    .filter((n) =>
      /from\s+_standalone\s+import/.test(
        readFileSync(path.join(TESTS_DIR, n), "utf8"),
      ),
    )
    .sort();
}

const runPython = (args: string[]): string =>
  execFileSync("python3", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

describe("Python suites on the shared standalone runner", () => {
  it("drives every adopter, discovered from the tests directory", () => {
    const files = adopters();
    // A discovery that came back empty would report green for the wrong
    // reason — and `test_f4_writer_side.py` is the member this file was
    // written for, so its absence is a defect however many others there are.
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files).toContain("test_f4_writer_side.py");

    for (const file of files) {
      const suite = path.join(TESTS_DIR, file);
      let output: string;
      try {
        output = runPython([suite, "--standalone"]);
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        throw new Error(
          `${file} failed:\n${e.stdout ?? ""}\n${e.stderr ?? e.message}`,
        );
      }
      const tally = output.match(/(\d+)\/(\d+) passed/);
      expect(tally, `no tally in ${file} output:\n${output}`).not.toBeNull();
      const [, passed, total] = tally!;
      // A suite that silently collected ZERO tests must not read as a pass.
      expect(Number(total), `${file} collected nothing`).toBeGreaterThan(0);
      expect(passed, `${file}: ${passed}/${total}`).toBe(total);
    }
  });

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
