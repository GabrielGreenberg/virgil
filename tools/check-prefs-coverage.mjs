#!/usr/bin/env node
/**
 * Coverage validator for the personal-prefs promotion pipeline.
 *
 * Confirms what the TYPES cannot see. Key coverage of the two preference
 * defaults files (every `EditorPreferences` / `ViewPrefs` key has a shipped
 * default) is NOT checked here: since task 1306 it is a compile error, through
 * `shippedDefaults` (src/lib/shipped-defaults.ts), whose call-site `Omit<>` is
 * the only exemption list. This script used to approximate that with a regex
 * over the interface text — which stopped at the first inline `}` and so saw
 * two of ViewPrefs' ~35 keys — plus a hand-kept exemption list that drifted.
 * The old check 2b (every GLOBAL `VIEW_PREF_REGISTRY` key has a default) is
 * subsumed too: those keys are `RegistryPrefs`, which `ViewPrefs` extends, so
 * the same compile-time coverage reaches them.
 *
 *   3. Every entry in the registry's `whitelist` arrays resolves to a
 *      key in the corresponding defaults file.
 *   4. Every row of the ONE pref→CSS table (`src/lib/pref-css-table.mjs`,
 *      task 902) resolves to a key in the editor defaults JSON, AND the
 *      first-paint seed block in `globals.css` (PROMOTE-DEFAULTS) is exactly
 *      that table rendered at the defaults — so a runtime row the seed lacks,
 *      or a seed value that differs from what the runtime paints at the
 *      defaults, fails here instead of flashing on load.
 *   5. The Library column-order default is a permutation of its union.
 *
 * Fails fast with a human-readable list of missing keys. No deps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PREF_CSS_BLOCK_HAND_EDIT_HINT,
  PREF_CSS_ROWS,
  renderPrefCssBlockBody,
  renderPrefCssSeed,
  splitPrefCssBlock,
} from "../src/lib/pref-css-table.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EDITOR_DEFAULTS = path.join(REPO_ROOT, "src/hooks/usePreferences.defaults.json");
const REGISTRY = path.join(REPO_ROOT, "src/lib/dev-prefs-registry.json");
const GLOBALS_CSS = path.join(REPO_ROOT, "src/app/globals.css");
// F#13: the Library column-order shipped default (rides promote-defaults).
const LIST_COL_DEFAULTS = path.join(REPO_ROOT, "library/lib/list-columns.defaults.json");
const LIST_COLUMNS_TS = path.join(REPO_ROOT, "library/lib/list-columns.ts");

/* ── Checks ──────────────────────────────────────────────────────── */

const failures = [];

function fail(msg) {
  failures.push(msg);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

// 3 + 4. Registry consistency.
{
  const registry = readJson(REGISTRY);
  const editorDefaults = readJson(EDITOR_DEFAULTS);

  for (const entry of registry.promotable) {
    if (entry.strategy !== "whitelist") continue;
    // Whitelist entries are checked against the matching defaults file: the
    // promoter only writes keys the target already declares, so a whitelisted
    // key absent from it could never be promoted.
    const target = path.join(REPO_ROOT, entry.defaultsFile);
    const defaults = readJson(target);
    for (const key of entry.whitelist ?? []) {
      if (!(key in defaults)) {
        fail(
          `registry whitelist for "${entry.storageKey}" includes "${key}" but it's missing from ${entry.defaultsFile}`,
        );
      }
    }
  }

  for (const row of PREF_CSS_ROWS) {
    if (!(row.key in editorDefaults)) {
      fail(`pref-css-table row ${row.cssVar} — key "${row.key}" missing from the editor defaults`);
    }
  }

  const globals = fs.readFileSync(GLOBALS_CSS, "utf-8");
  const block = splitPrefCssBlock(globals);
  if (!block) {
    fail("globals.css has no PROMOTE-DEFAULTS block");
  } else {
    const seed = renderPrefCssSeed(editorDefaults);
    // Byte-for-byte: the promoter's own render, so a hand-added line inside the
    // block (a trailing comment and all) is drift too.
    if (block.body !== renderPrefCssBlockBody(seed, block.indent)) {
      const seeded = block.body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const expected = seed.map(([cssVar, value]) => `${cssVar}: ${value};`);
      const have = new Set(seeded);
      const want = new Set(expected);
      const missing = expected.filter((l) => !have.has(l));
      const extra = seeded.filter((l) => !want.has(l));
      fail(
        "globals.css PROMOTE-DEFAULTS block is not the pref-css-table rendered at the defaults" +
          (missing.length ? ` — missing/different: ${missing.join(" ")}` : "") +
          (extra.length ? ` — unexpected: ${extra.join(" ")}` : "") +
          (!missing.length && !extra.length ? " — same lines, wrong order or spacing" : "") +
          ". " +
          PREF_CSS_BLOCK_HAND_EDIT_HINT,
      );
    }
  }
}

// 5. F#13 — library column-order shipped default must be a valid PERMUTATION
//    of the ReorderableColId union. The default rides promote-defaults (check
//    3 already confirms "colOrder" exists in the file via the whitelist entry);
//    this guards the *value* against a typo'd or incomplete promotion that
//    could silently drop or duplicate a column.
{
  // Parse the union members from `type ReorderableColId = "a" | "b" | ...;`.
  const src = fs.readFileSync(LIST_COLUMNS_TS, "utf-8");
  const m = /type\s+ReorderableColId\s*=\s*([^;]+);/.exec(src);
  if (!m) {
    fail(`could not parse ReorderableColId union from ${path.relative(REPO_ROOT, LIST_COLUMNS_TS)}`);
  } else {
    const union = new Set(
      [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]),
    );
    if (union.size === 0) {
      fail(`ReorderableColId union parsed empty from ${path.relative(REPO_ROOT, LIST_COLUMNS_TS)}`);
    }
    const defaults = readJson(LIST_COL_DEFAULTS);
    const order = defaults.colOrder;
    const rel = path.relative(REPO_ROOT, LIST_COL_DEFAULTS);
    if (!Array.isArray(order)) {
      fail(`colOrder in ${rel} must be an array`);
    } else {
      const seen = new Set();
      for (const c of order) {
        if (!union.has(c)) fail(`colOrder in ${rel} has unknown column "${c}"`);
        if (seen.has(c)) fail(`colOrder in ${rel} has duplicate column "${c}"`);
        seen.add(c);
      }
      for (const c of union) {
        if (!seen.has(c)) fail(`colOrder in ${rel} is missing column "${c}"`);
      }
    }
  }
}

if (failures.length === 0) {
  console.log("prefs coverage: OK");
  process.exit(0);
}

console.error("prefs coverage check FAILED:");
for (const m of failures) console.error("  - " + m);
process.exit(1);
