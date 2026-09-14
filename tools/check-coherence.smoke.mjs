#!/usr/bin/env node
/**
 * Smoke tests for check-coherence.mjs.
 *
 * Builds throwaway fixture doc-trees in a temp dir and runs the real CLI
 * against each (COHERENCE_ROOT override + the filesystem-walk discovery
 * fallback, since fixtures aren't git repos). Asserts the load-bearing edge
 * check (1) behaves: a clean graph passes (exit 0); a broken derives-from
 * anchor and a missing covers-code path each error (exit 1); and --strict
 * promotes warnings to errors. Fixtures E–J drive check 2 (type accounting) in
 * BOTH directions over a miniature registry graph (task 562): an export named
 * nowhere, a name exported nowhere (in the registry, in the delegated section,
 * and in a derived doc OUTSIDE that section), the `**N** exported` count pin,
 * the type-externals declaration and its two stale shapes, and the
 * section-in-whole-doc dedupe — with the two accepting controls (a sibling
 * covers-code type, a declared external) that keep the reverse arm honest.
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

/* ══════════════════════════════════════════════════════════════════════
 *  Check 2 — type accounting, both directions (task 562)
 * ══════════════════════════════════════════════════════════════════════
 * A miniature registry graph: an SSOT exporting two types, a sibling
 * covers-code SSOT exporting `Link`, the root's Public-type registry
 * section (which names one type directly and delegates the enumeration to
 * the manifest's Coverage section), and the manifest — which derives-from
 * the registry, declares TipTap's `JSONContent` external, and names the
 * rest. `typeFixture(overrides)` returns the clean shape with any file
 * replaced. */
const REGISTRY_HEAD = [
  "<!-- derives-from: (root — verified against code) -->",
  "<!-- covers-code: src/lib/types.ts -->",
  "",
  "# Root",
  "",
  "## Public-type registry",
  "<!-- covers-code: src/lib/types.ts, src/links/_shared/types.ts -->",
  "",
];
const registryDoc = (prose) => HEADER([...REGISTRY_HEAD, ...prose]);
const manifestDoc = (headerExtra, prose) =>
  HEADER([
    "<!-- derives-from: docs/architecture/VIRGIL.md#public-type-registry -->",
    "<!-- covers-code: src/lib/types.ts -->",
    ...headerExtra,
    "",
    "# Sidecars",
    "",
    ...prose,
  ]);
const CLEAN_REGISTRY = registryDoc([
  "The SSOT has **2** exported types — `Alpha` and friends; the `Link` family is",
  "owned elsewhere. The full list is the [Coverage](../workspace/sidecars.md#coverage) index.",
]);
const CLEAN_MANIFEST = manifestDoc(
  ["<!-- type-externals: JSONContent (TipTap's document type) -->"],
  [
    "Bodies are a `JSONContent` doc.",
    "",
    "## Coverage",
    "",
    "All **2** exported types: `Alpha`, `Beta`.",
  ],
);
function typeFixture(overrides = {}) {
  return mkfixture({
    "src/lib/types.ts": "export interface Alpha { a: string }\nexport type Beta = string;\n",
    "src/links/_shared/types.ts": "export interface Link { id: string }\n",
    "docs/architecture/VIRGIL.md": CLEAN_REGISTRY,
    "docs/workspace/sidecars.md": CLEAN_MANIFEST,
    ...overrides,
  });
}
const typeFindings = (json) => json.findings.filter((f) => f.check === "types");
const typeErrors = (json) => typeFindings(json).filter((f) => f.severity === "error");

/* ── E: clean graph — both directions pass, with both accepting controls ── */
{
  const root = typeFixture();
  const { exit, json } = run(root);
  check("types clean: exit 0", exit === 0);
  check("types clean: zero type findings", typeFindings(json).length === 0);
  // The controls: `Link` resolves through the registry's sibling covers-code
  // source, `JSONContent` through the manifest's declaration — neither flagged.
  check(
    "types clean: sibling covers-code type and declared external are not flagged",
    !typeFindings(json).some((f) => /'(Link|JSONContent)'/.test(f.detail)),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── F: FORWARD — an export named nowhere errors (the pre-562 direction) ── */
{
  const root = typeFixture({
    "docs/workspace/sidecars.md": manifestDoc(
      ["<!-- type-externals: JSONContent -->"],
      ["Bodies are a `JSONContent` doc.", "", "## Coverage", "", "All **2** exported types: `Alpha`."],
    ),
  });
  const { exit, json } = run(root);
  check("forward: exit 1", exit === 1);
  check(
    "forward: the unnamed export is the error",
    typeErrors(json).length === 1 && /'Beta'.*unaccounted/.test(typeErrors(json)[0].detail),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── G: REVERSE — a name exported nowhere errors, on all three surfaces ── */
{
  const root = typeFixture({
    // The registry names a deleted type directly …
    "docs/architecture/VIRGIL.md": registryDoc([
      "The SSOT has **2** exported types — `Alpha`, `Delta`; see [Coverage](../workspace/sidecars.md#coverage).",
    ]),
    // … the delegated Coverage enumerates another, and a THIRD sits in the
    // derived doc OUTSIDE the delegated section (the reported comments.json
    // schema shape) — a section-scoped reverse arm would miss it.
    "docs/workspace/sidecars.md": manifestDoc(
      ["<!-- type-externals: JSONContent -->"],
      [
        "Bodies are a `JSONContent` doc.",
        "",
        "## Legacy",
        "",
        "- `legacy.json` — `Epsilon { id; resolved }`, the pre-card shape (the manifest's schema idiom: the LEADING name is the claim).",
        "",
        "## Coverage",
        "",
        "All **2** exported types: `Alpha`, `Beta`, `Gamma`.",
      ],
    ),
  });
  const { exit, json } = run(root);
  const errs = typeErrors(json);
  const named = (t) => errs.filter((f) => new RegExp(`names type '${t}'`).test(f.detail));
  check("reverse: exit 1", exit === 1);
  check("reverse: the registry's own stale name is flagged at VIRGIL.md", named("Delta").length === 1 && named("Delta")[0].doc === "docs/architecture/VIRGIL.md");
  check("reverse: the delegated enumeration's stale name is flagged at the manifest", named("Gamma").length === 1 && named("Gamma")[0].doc === "docs/workspace/sidecars.md");
  check("reverse: a stale name OUTSIDE the delegated section, in schema form, is flagged (whole derived doc is a surface; leading identifier is the claim)", named("Epsilon").length === 1);
  check("reverse: the delegated section inside the derived doc is reported ONCE, not twice", named("Gamma").length === 1);
  check("reverse: the sibling covers-code type and the declared external stay clean", named("Link").length === 0 && named("JSONContent").length === 0);
  check("reverse: nothing else is flagged", errs.length === 3);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── H: COUNT — a stated `**N** exported` that is not the real count errors ── */
{
  const root = typeFixture({
    "docs/architecture/VIRGIL.md": registryDoc([
      "The SSOT has **3** exported types — `Alpha`; see [Coverage](../workspace/sidecars.md#coverage).",
    ]),
  });
  const { exit, json } = run(root);
  const errs = typeErrors(json);
  check("count: exit 1", exit === 1);
  check("count: the stale count is the one error, naming both numbers", errs.length === 1 && /\*\*3\*\* exported types; src\/lib\/types\.ts exports 2/.test(errs[0].detail));
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── I: STALE EXTERNALS — a declaration must still excuse something ── */
{
  const root = typeFixture({
    "docs/workspace/sidecars.md": manifestDoc(
      // Alpha IS exported (stale), Zeta is named nowhere (stale), JSONContent is live.
      ["<!-- type-externals: JSONContent, Alpha, Zeta -->"],
      ["Bodies are a `JSONContent` doc.", "", "## Coverage", "", "All **2** exported types: `Alpha`, `Beta`."],
    ),
  });
  const { exit, json } = run(root);
  const errs = typeErrors(json);
  check("stale externals: exit 1", exit === 1);
  check("stale externals: an exported name declared external is flagged", errs.some((f) => /declares 'Alpha' but a registry covers-code source exports it/.test(f.detail)));
  check("stale externals: a declared name the doc never names is flagged", errs.some((f) => /declares 'Zeta' but the doc names it nowhere/.test(f.detail)));
  check("stale externals: the live declaration is not flagged; nothing else is", errs.length === 2);
  fs.rmSync(root, { recursive: true, force: true });
}

/* ── J: an UNDECLARED external is the reverse error, and the message says how to declare it ── */
{
  const root = typeFixture({
    "docs/workspace/sidecars.md": manifestDoc(
      [],
      ["Bodies are a `JSONContent` doc.", "", "## Coverage", "", "All **2** exported types: `Alpha`, `Beta`."],
    ),
  });
  const { exit, json } = run(root);
  const errs = typeErrors(json);
  check("undeclared external: exit 1", exit === 1);
  check(
    "undeclared external: flagged once, with the declaration spelled in the message",
    errs.length === 1 && /'JSONContent'/.test(errs[0].detail) && /type-externals: JSONContent/.test(errs[0].detail),
  );
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures) {
  console.error(`\ncheck-coherence smoke: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log("\ncheck-coherence smoke: all assertions passed");
