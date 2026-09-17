#!/usr/bin/env node
// The ONE runner for every stdlib-Python test suite in the repo (task 622).
//
// WHY ONE. `npm test` is vitest, and the CI python step used to loop over
// `editor/scripts/tests/` only — so a Library suite ran in CI exactly when
// someone remembered to hand-write a vitest shell for it. Half of them never
// got one (10 of 20 on 2026-09-17), and one of those,
// `test_master_bib_field_preservation.py` (the task-164 master.bib data-loss
// guard), had no `__main__` either: `python3` on it exited 0 having run
// NOTHING, so even a loop over it would have read green.
//
// So this module owns the three questions every per-suite shell answered for
// itself, once:
//   1. WHICH suites exist — DISCOVERED (`test_*.py` anywhere under a silo's
//      `scripts/`), never listed, so a new suite is run the day it lands.
//   2. HOW to run one — `python3 <file>`, plus `--standalone` for a suite that
//      understands it (the shared `_standalone` runner, or its three
//      hand-spelled siblings), so the tally is the runner's own on any machine
//      whether or not pytest is installed.
//   3. WHAT counts as a pass — exit 0 AND a pass tally this module can READ,
//      with at least one test run and none failed. A suite that exits 0
//      printing no readable tally FAILS, naming itself: that is the
//      "ran nothing" case, and it is the reason a bare exit-code loop is not
//      enough.
//
// Two callers, one rule: `scripts/__tests__/python-suites.test.ts` (so
// `npx vitest run` drives every suite) and the CI python step in
// `.github/workflows/{deploy,coherence}.yml` (`node scripts/lib/python-suites.mjs`),
// which keeps a readable per-suite log at the last door.
//
// If `python3` is genuinely unavailable a suite FAILS rather than skips — a
// guard that quietly opts out of the environment it protects is the thing
// this file exists to stop.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** The silos whose `scripts/` trees hold Python suites. */
export const SUITE_ROOTS = ["editor/scripts", "library/scripts"];

/**
 * Per-suite FLOORS on the number of tests run — for a suite whose gutting
 * down to a handful of legs would otherwise still print a clean tally. A
 * floor, not an equality, so adding a leg is a one-file change; it only ever
 * moves up. Every other suite's floor is 1 (it must run SOMETHING).
 */
export const FLOORS = {
  "editor/scripts/tests/test_reflect_tail_trigger.py": 40,
  "editor/scripts/tests/test_dream_synced_sink.py": 50,
  "editor/scripts/tests/test_dream_task_filing.py": 21,
  "editor/scripts/tests/test_field_policy_slice.py": 101,
  "editor/scripts/tests/test_bib_family_slice.py": 41,
};

const SKIP_DIRS = new Set(["__pycache__", "node_modules", ".git"]);

/** Every `test_*.py` under the suite roots, repo-relative, sorted. */
export function discoverSuites(repoRoot = REPO_ROOT) {
  const found = [];
  const walk = (rel) => {
    for (const ent of readdirSync(path.join(repoRoot, rel), {
      withFileTypes: true,
    })) {
      const child = `${rel}/${ent.name}`;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(child);
      } else if (/^test_.*\.py$/.test(ent.name)) {
        found.push(child);
      }
    }
  };
  for (const root of SUITE_ROOTS) walk(root);
  return found.sort();
}

/** Does this suite accept `--standalone` (force the no-pytest runner)? */
export function acceptsStandalone(source) {
  return (
    /from\s+_standalone\s+import/.test(source) ||
    /["']--standalone["']/.test(source)
  );
}

/**
 * The pass-tally grammar: every shape a suite in this repo prints. Returns
 * `{ passed, failed }` from the LAST tally in the output, or null when there
 * is none. Adding a shape is a row here — but prefer adopting `_standalone`
 * (`<n>/<n> passed`) over inventing one.
 */
const TALLIES = [
  // `_standalone` and its hand-spelled siblings; also "RESULT: 61/61 passed".
  {
    re: /(\d+)\/(\d+) passed/g,
    read: (m) => ({ passed: +m[1], failed: +m[2] - +m[1] }),
  },
  // The editor slices' `===== 48 passed, 0 failed =====`; "RESULT: 32 passed, 0 failed".
  {
    re: /(\d+) passed, (\d+) failed/g,
    read: (m) => ({ passed: +m[1], failed: +m[2] }),
  },
  // `PASS: 37   FAIL: 0`.
  {
    re: /PASS: (\d+)\s+FAIL: (\d+)/g,
    read: (m) => ({ passed: +m[1], failed: +m[2] }),
  },
];

export function readTally(output) {
  let best = null;
  for (const { re, read } of TALLIES) {
    for (const m of output.matchAll(re)) {
      if (!best || m.index > best.at) best = { at: m.index, ...read(m) };
    }
  }
  // unittest: "Ran N tests in …" then "OK" / "OK (skipped=1)" / "FAILED (…)".
  const ran = [...output.matchAll(/^Ran (\d+) tests? in .*$/gm)].pop();
  if (ran && (!best || ran.index > best.at)) {
    const after = output.slice(ran.index);
    const ok = /^OK\b/m.test(after);
    const skipped = +(after.match(/skipped=(\d+)/)?.[1] ?? 0);
    const bad = after.match(/^FAILED \((.*)\)$/m)?.[1] ?? "";
    const nBad = [...bad.matchAll(/(?:failures|errors)=(\d+)/g)].reduce(
      (s, m) => s + +m[1],
      0,
    );
    best = {
      at: ran.index,
      passed: +ran[1] - skipped - nBad,
      failed: ok ? 0 : Math.max(nBad, 1),
    };
  }
  return best && { passed: best.passed, failed: best.failed };
}

/**
 * Run one suite. Returns `{ file, ok, reason, tally, output }`; `reason`
 * names why a non-ok suite failed.
 */
export function runSuite(file, repoRoot = REPO_ROOT) {
  const abs = path.join(repoRoot, file);
  const args = [abs];
  if (acceptsStandalone(readFileSync(abs, "utf8"))) args.push("--standalone");
  const r = spawnSync("python3", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  });
  // unittest writes its tally to STDERR, so both streams are read — an
  // stdout-only reader passes vacuously on a suite that printed nothing.
  const output = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const tally = readTally(output);
  const floor = FLOORS[file] ?? 1;
  let reason = null;
  if (r.error) reason = `could not run python3: ${r.error.message}`;
  else if (r.status !== 0) reason = `exited ${r.status ?? r.signal}`;
  else if (!tally)
    reason =
      "exited 0 but printed no pass tally — it may have run nothing " +
      "(give it the `_standalone` __main__ runner)";
  else if (tally.failed > 0) reason = `${tally.failed} failed`;
  else if (tally.passed < floor)
    reason = `ran ${tally.passed} test(s), below its floor of ${floor}`;
  return { file, ok: reason === null, reason, tally, output };
}

// CLI: `node scripts/lib/python-suites.mjs` — the CI python step.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suites = discoverSuites();
  let bad = 0;
  for (const file of suites) {
    const res = runSuite(file);
    if (res.ok) {
      console.log(`ok    ${file} (${res.tally.passed} passed)`);
    } else {
      bad++;
      console.log(`FAIL  ${file}: ${res.reason}\n${res.output}`);
    }
  }
  console.log(`\n${suites.length - bad}/${suites.length} python suites passed`);
  process.exit(bad ? 1 : 0);
}
