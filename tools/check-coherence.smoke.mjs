#!/usr/bin/env node
/**
 * Smoke tests for check-coherence.mjs.
 *
 * Builds throwaway fixture doc-trees in a temp dir and runs the real CLI
 * against each (COHERENCE_ROOT override + the filesystem-walk discovery
 * fallback, since fixtures aren't git repos). Asserts the load-bearing edge
 * check (1) behaves: a clean graph passes (exit 0); a broken derives-from
 * anchor and a missing covers-code path each error (exit 1); and --strict
 * promotes warnings to errors.
 *
 *   node tools/check-coherence.smoke.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "check-coherence.mjs");
let failures = 0;

function mkfixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coherence-smoke-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function run(root, extraArgs = []) {
  const opts = { env: { ...process.env, COHERENCE_ROOT: root }, encoding: "utf-8" };
  try {
    const out = execFileSync("node", [SCRIPT, "--json", ...extraArgs], opts);
    return { exit: 0, json: JSON.parse(out) };
  } catch (e) {
    // Non-zero exit → execFileSync throws; --json stdout still carries the report.
    return { exit: e.status, json: JSON.parse(e.stdout) };
  }
}

function check(name, cond) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    console.error(`  ✗ ${name}`);
    failures++;
  }
}

const HEADER = (lines) => lines.join("\n");

/* ── A: clean graph — root + derivative, anchor + paths resolve ── */
{
  const root = mkfixture({
    "code/thing.ts": "export const x = 1;\n",
    "docs/ROOT.md": HEADER([
      "<!-- last-verified: abc1234 2026-01-01 -->",
      "<!-- derives-from: (root — verified against code) -->",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "# Root Doc",
      "",
      "## The Section",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "Prose.",
    ]),
    "docs/child.md": HEADER([
      "<!-- last-verified: abc1234 2026-01-01 -->",
      "<!-- derives-from: docs/ROOT.md#the-section -->",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "# Child",
      "",
      "Body.",
    ]),
  });
  const { exit, json } = run(root);
  const edgeErrors = json.findings.filter((f) => f.check === "edges" && f.severity === "error");
  check("clean fixture: exit 0", exit === 0);
  check("clean fixture: ok=true", json.ok === true);
  check("clean fixture: zero edge errors", edgeErrors.length === 0);
  check("clean fixture: discovered both docs", json.summary.docsScanned === 2);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── B: broken derives-from anchor → check 1 error, exit 1 ── */
{
  const root = mkfixture({
    "code/thing.ts": "export const x = 1;\n",
    "docs/ROOT.md": HEADER([
      "<!-- derives-from: (root — verified against code) -->",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "# Root Doc",
      "",
      "## The Section",
      "",
      "Prose.",
    ]),
    "docs/child.md": HEADER([
      "<!-- derives-from: docs/ROOT.md#no-such-heading -->",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "# Child",
    ]),
  });
  const { exit, json } = run(root);
  const anchorErr = json.findings.find(
    (f) => f.check === "edges" && f.severity === "error" && /no-such-heading/.test(f.detail),
  );
  check("broken anchor: exit 1", exit === 1);
  check("broken anchor: ok=false", json.ok === false);
  check("broken anchor: edge error names the anchor", !!anchorErr);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── C: missing covers-code path → check 1 error, exit 1 ── */
{
  const root = mkfixture({
    "docs/child.md": HEADER([
      "<!-- derives-from: (root — verified against code) -->",
      "<!-- covers-code: code/ghost.ts -->",
      "",
      "# Child",
    ]),
  });
  const { exit, json } = run(root);
  const pathErr = json.findings.find(
    (f) => f.check === "edges" && f.severity === "error" && /ghost\.ts/.test(f.detail),
  );
  check("missing covers-code: exit 1", exit === 1);
  check("missing covers-code: edge error names the path", !!pathErr);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── D: --strict promotes warnings to errors ── */
{
  const root = mkfixture({
    "code/thing.ts": "export const x = 1;\n",
    "docs/child.md": HEADER([
      "<!-- derives-from: (root — verified against code) -->",
      "<!-- covers-code: code/thing.ts -->",
      "",
      "# Child (no last-verified stamp)",
    ]),
  });
  const lenient = run(root); // missing-stamp is a warn → exit 0
  const strict = run(root, ["--strict"]); // warn promoted → exit 1
  check("no-stamp lenient: exit 0", lenient.exit === 0);
  check("no-stamp strict: exit 1", strict.exit === 1);
  check(
    "no-stamp strict: the warn became an error",
    strict.json.findings.some((f) => f.severity === "error"),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\ncheck-coherence smoke: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\ncheck-coherence smoke: all assertions passed");
