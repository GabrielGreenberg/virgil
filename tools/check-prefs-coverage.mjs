#!/usr/bin/env node
/**
 * Coverage validator for the personal-prefs promotion pipeline.
 *
 * Confirms:
 *   1. Every key in the `EditorPreferences` interface has a matching
 *      entry in `usePreferences.defaults.json`.
 *   2. Every key in the `ViewPrefs` interface (excluding session-only
 *      keys excluded by name pattern) has a matching entry in
 *      `useViewPrefs.defaults.json`.
 *   3. Every entry in the registry's `whitelist` arrays resolves to a
 *      key in the corresponding interface.
 *   4. Every `cssVarMap[*].source` of shape `bucket.key` resolves to a
 *      key in the bucket's defaults JSON.
 *
 * Fails fast with a human-readable list of missing keys. No deps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const EDITOR_DEFAULTS = path.join(REPO_ROOT, "src/hooks/usePreferences.defaults.json");
const VIEW_DEFAULTS = path.join(REPO_ROOT, "src/hooks/useViewPrefs.defaults.json");
const EDITOR_TS = path.join(REPO_ROOT, "src/hooks/usePreferences.ts");
const VIEW_TS = path.join(REPO_ROOT, "src/hooks/useViewPrefs.ts");
const REGISTRY = path.join(REPO_ROOT, "src/lib/dev-prefs-registry.json");

/* ── Interface parsing ────────────────────────────────────────────
 *
 * Tiny regex-based parser sized for the two `interface ... { ... }`
 * blocks we care about. Captures each property name from lines of
 * the form `  someName: SomeType;` or `  someName?: SomeType;` inside
 * the interface body. Skips comment-only lines.
 */
function parseInterfaceKeys(file, interfaceName) {
  const src = fs.readFileSync(file, "utf-8");
  const re = new RegExp(
    String.raw`(?:export\s+)?interface\s+${interfaceName}\s*\{([\s\S]*?)\}`,
    "m",
  );
  const m = re.exec(src);
  if (!m) throw new Error(`Could not find interface ${interfaceName} in ${file}`);
  const body = m[1];
  const keys = new Set();
  // Strip block comments first so `/* foo: bar */` doesn't leak.
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const line of stripped.split("\n")) {
    // Skip line comments and obvious non-property lines.
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    // Match `key:` or `key?:` at start of line.
    const km = /^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/.exec(trimmed);
    if (km) keys.add(km[1]);
  }
  return keys;
}

/* ── Checks ──────────────────────────────────────────────────────── */

const failures = [];

function fail(msg) {
  failures.push(msg);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

// 1. EditorPreferences interface ⊆ usePreferences.defaults.json
{
  const interfaceKeys = parseInterfaceKeys(EDITOR_TS, "EditorPreferences");
  const defaults = readJson(EDITOR_DEFAULTS);
  for (const k of interfaceKeys) {
    if (!(k in defaults)) {
      fail(`EditorPreferences key "${k}" missing from ${path.relative(REPO_ROOT, EDITOR_DEFAULTS)}`);
    }
  }
}

// 2. ViewPrefs interface ⊆ useViewPrefs.defaults.json, with documented
//    exceptions (keys built at runtime, session-only, or derived).
const VIEW_RUNTIME_KEYS = new Set([
  // Filled from DEFAULT_PRINT_OPTIONS / DEFAULT_OMNI_CATEGORIES at hook init.
  "printOptions",
  "omniCategories",
  // Underscore-prefixed = internal stash/dock memory, never persisted as
  // a default.
  "_stashedLeft",
  "_stashedRight",
]);
{
  const interfaceKeys = parseInterfaceKeys(VIEW_TS, "ViewPrefs");
  const defaults = readJson(VIEW_DEFAULTS);
  for (const k of interfaceKeys) {
    if (VIEW_RUNTIME_KEYS.has(k)) continue;
    if (!(k in defaults)) {
      fail(`ViewPrefs key "${k}" missing from ${path.relative(REPO_ROOT, VIEW_DEFAULTS)}`);
    }
  }
}

// 3 + 4. Registry consistency.
{
  const registry = readJson(REGISTRY);
  const editorDefaults = readJson(EDITOR_DEFAULTS);
  const viewDefaults = readJson(VIEW_DEFAULTS);

  for (const entry of registry.promotable) {
    if (entry.strategy !== "whitelist") continue;
    // Whitelist entries are checked against the matching defaults file.
    // Runtime-defaulted ViewPrefs keys (filled in by the hook at init
    // from DEFAULT_OMNI_CATEGORIES / DEFAULT_PRINT_OPTIONS rather than
    // the JSON) are exempt — the promote script populates the JSON the
    // first time the user overrides them.
    const target = path.join(REPO_ROOT, entry.defaultsFile);
    const defaults = readJson(target);
    const exempt =
      entry.defaultsFile === "src/hooks/useViewPrefs.defaults.json"
        ? VIEW_RUNTIME_KEYS
        : new Set();
    for (const key of entry.whitelist ?? []) {
      if (exempt.has(key)) continue;
      if (!(key in defaults)) {
        fail(
          `registry whitelist for "${entry.storageKey}" includes "${key}" but it's missing from ${entry.defaultsFile}`,
        );
      }
    }
  }

  for (const [cssVar, spec] of Object.entries(registry.cssVarMap)) {
    const [bucket, key] = String(spec.source).split(".");
    const bucketDefaults =
      bucket === "editor" ? editorDefaults : bucket === "view" ? viewDefaults : null;
    if (!bucketDefaults) {
      fail(`cssVarMap[${cssVar}].source "${spec.source}" has unknown bucket "${bucket}"`);
      continue;
    }
    if (!(key in bucketDefaults)) {
      fail(
        `cssVarMap[${cssVar}].source "${spec.source}" — key "${key}" missing from the "${bucket}" defaults`,
      );
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
