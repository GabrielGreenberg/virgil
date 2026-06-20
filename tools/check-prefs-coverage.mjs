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
 *   2b. Every GLOBAL key in `VIEW_PREF_REGISTRY` (the SSOT for the View-
 *      menu display prefs — these live in `RegistryPrefs`, not the
 *      `ViewPrefs` body) has a matching entry in `useViewPrefs.defaults.json`.
 *      Window-scoped registry keys are exempt by scope.
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
const VIEW_PREF_REGISTRY_TS = path.join(REPO_ROOT, "src/lib/view-prefs/registry.ts");
const REGISTRY = path.join(REPO_ROOT, "src/lib/dev-prefs-registry.json");

/* ── View-pref registry parsing ───────────────────────────────────
 *
 * VIEW_PREF_REGISTRY is the SSOT for the View-menu display prefs +
 * the Bibliography filter; its keys live in `RegistryPrefs` (which
 * `ViewPrefs extends`), NOT the ViewPrefs interface body, so the
 * interface parser above can't see them. Extract each entry's key +
 * `scope` directly. Each entry's `scope: "..."` sits before any nested
 * `{ ... }` (memberLabels / valueLabels), so a brace-free lazy match
 * from the entry key to its scope is unambiguous. */
function parseRegistryScopes(file) {
  const src = fs.readFileSync(file, "utf-8");
  const body = src.slice(src.indexOf("VIEW_PREF_REGISTRY = {"));
  const re = /(\w+):\s*\{[^{}]*?scope:\s*"(global|window)"/g;
  const out = {};
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2];
  return out;
}

/* ── Interface parsing ────────────────────────────────────────────
 *
 * Tiny regex-based parser sized for the two `interface ... { ... }`
 * blocks we care about. Captures each property name from lines of
 * the form `  someName: SomeType;` or `  someName?: SomeType;` inside
 * the interface body. Skips comment-only lines.
 */
function parseInterfaceKeys(file, interfaceName) {
  const src = fs.readFileSync(file, "utf-8");
  // Allow an optional `extends Foo, Bar` clause — `ViewPrefs extends
  // RegistryPrefs` (the registry-owned keys live in RegistryPrefs, not this
  // interface body; they're validated separately in check 2b). NOTE: the
  // body capture is lazy to the first `}`, so inline-brace fields cut it
  // short — this check effectively validates only the leading flat keys.
  // The meaningful coverage is checks 2b / 3 / 4.
  const re = new RegExp(
    String.raw`(?:export\s+)?interface\s+${interfaceName}(?:\s+extends\s+[\w,\s]+)?\s*\{([\s\S]*?)\}`,
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

// 2b. Every GLOBAL view-pref registry key must have a default in
//     useViewPrefs.defaults.json. The registry is the SSOT for these keys
//     (they're in RegistryPrefs, not the ViewPrefs interface body), so this
//     is the check that actually guarantees showParTitles / showLatexComments
//     / showMarginalia / … ship a default. Window-scoped registry keys
//     (bibFilter) persist per-window and are intentionally absent from the
//     global defaults JSON, so they're exempt by scope.
{
  const scopes = parseRegistryScopes(VIEW_PREF_REGISTRY_TS);
  const globalKeys = Object.keys(scopes).filter((k) => scopes[k] === "global");
  if (globalKeys.length === 0) {
    fail(
      `no global keys parsed from ${path.relative(REPO_ROOT, VIEW_PREF_REGISTRY_TS)} — the registry parser is stale`,
    );
  }
  const defaults = readJson(VIEW_DEFAULTS);
  for (const k of globalKeys) {
    if (!(k in defaults)) {
      fail(
        `global registry key "${k}" missing from ${path.relative(REPO_ROOT, VIEW_DEFAULTS)}`,
      );
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
