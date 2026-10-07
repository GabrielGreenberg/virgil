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
// The census legs (discovery, the pass rule, hermeticity) live in
// `python-suites-census.test.ts`, so `npm run test:guards` runs them on every
// task without paying for the suites themselves (task 988).
import { describe, it, expect } from "vitest";
import { discoverSuites, runSuite } from "../lib/python-suites.mjs";

const suites = discoverSuites();

describe("python suites — every suite passes", () => {
  it.each(suites)(
    "%s",
    (file) => {
      const res = runSuite(file);
      expect(res.ok, `${file}: ${res.reason}\n${res.output}`).toBe(true);
    },
    300_000,
  );
});
