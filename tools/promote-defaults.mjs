#!/usr/bin/env node
/**
 * Promote Gabriel's personal localStorage prefs (mirrored to
 * tools/personal-snapshot.json by the dev server) into the shipped
 * defaults under src/.
 *
 * Reads the snapshot and iterates the registry at
 * src/lib/dev-prefs-registry.json — the same file the browser mirror
 * imports. Per-entry strategy decides how the source merges onto the
 * existing default JSON sidecar. Also regenerates the marker-comment
 * block inside src/app/globals.css from the ONE pref→CSS table
 * (src/lib/pref-css-table.mjs) so first-paint CSS is exactly what the
 * runtime paints at the shipped editor defaults.
 *
 * Idempotent. Safe to run any time. No deps.
 *
 * Flags (task 623 — the unattended wrapper promotes in an ISOLATED worktree
 * and commits exactly what this script reports, never the live tree's diff):
 *   --root <dir>         repo root to read the registry from and write into
 *                        (default: this script's own repo)
 *   --snapshot <file>    snapshot to read (default: <this script's repo>/
 *                        tools/personal-snapshot.json — the snapshot is
 *                        gitignored, so a fresh worktree has none of its own)
 *   --dry-run            compute and report, write NOTHING; exit 1 on drift
 *   --changed-out <file> write the changed files (root-relative, one per
 *                        line) to <file> — the wrapper's commit pathspec
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The ONE pref→CSS table (task 902) — the first-paint seed below is rendered
// from the same rows the runtime paints, and the transform bake uses the same
// math the runtime applies. Both are import-free leaves under src/lib.
import { PREF_CSS_ROWS, renderPrefCssSeed } from "../src/lib/pref-css-table.mjs";
import { applyTransforms } from "../src/lib/color-transform-math.mjs";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const opts = { root: SELF_ROOT, snapshot: null, dryRun: false, changedOut: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--root") opts.root = path.resolve(val());
    else if (a === "--snapshot") opts.snapshot = path.resolve(val());
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--changed-out") opts.changedOut = path.resolve(val());
    else throw new Error(`Unknown argument: ${a}`);
  }
  opts.snapshot ??= path.join(SELF_ROOT, "tools", "personal-snapshot.json");
  return opts;
}

const OPTS = parseArgs(process.argv.slice(2));
const REPO_ROOT = OPTS.root;
const DRY_RUN = OPTS.dryRun;
const SNAPSHOT_PATH = OPTS.snapshot;
const REGISTRY_PATH = path.join(REPO_ROOT, "src", "lib", "dev-prefs-registry.json");
const GLOBALS_CSS = path.join(REPO_ROOT, "src", "app", "globals.css");

const EDITOR_PREFS_JSON_REL = "src/hooks/usePreferences.defaults.json";

/* ── Utilities ──────────────────────────────────────────────────── */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file, value) {
  const next = JSON.stringify(value, null, 2) + "\n";
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  if (next === prev) return false;
  if (!DRY_RUN) fs.writeFileSync(file, next, "utf-8");
  return true;
}

/**
 * THE one door every strategy promotes through (task 904): a KEY-INTERSECTION
 * of the snapshot with the shipped shape, value-typed against the shipped
 * value. The snapshot supplies VALUES, never vocabulary and never types (the
 * full rationale is on `applyAll` below):
 *   - a snapshot key the shipped object does not OWN is dropped (retired or
 *     unknown — the resurrection class);
 *   - a value whose type differs from the shipped value's (`typeof`, with
 *     arrays, plain objects and null told apart) is dropped — the shipped
 *     JSON is cast `as T` at runtime (`print.ts`, `DEFAULT_PREFS`), so nothing
 *     downstream would catch it. A shipped `null` is a nullable slot and
 *     accepts any value;
 *   - with `deep`, a plain-object value is intersected RECURSIVELY rather than
 *     replaced, so a nested section (`printOptions.panels`) is closed too.
 * Every drop is LOGGED with its dotted path — the log line is the only signal
 * an unattended promote emits.
 */
function intersectShape(shipped, source, label, { deep = false } = {}) {
  const dropped = [];
  const walk = (cur, src, prefix) => {
    const next = { ...cur };
    if (!isPlainObject(src)) return next;
    for (const [key, value] of Object.entries(src)) {
      const at = prefix + key;
      // `Object.hasOwn`, not `key in cur`: `in` consults the prototype chain,
      // so a snapshot key spelled `constructor` / `toString` / `valueOf` would
      // read as DECLARED and be written into the shipped defaults — the exact
      // inverse of this rule.
      if (!Object.hasOwn(cur, key)) {
        dropped.push(`${at} (unknown)`);
        continue;
      }
      const want = cur[key];
      if (want !== null && typeTag(value) !== typeTag(want)) {
        dropped.push(`${at} (${typeTag(value)}, expected ${typeTag(want)})`);
        continue;
      }
      next[key] = deep && isPlainObject(want) ? walk(want, value, at + ".") : value;
    }
    return next;
  };
  const next = walk(shipped, source, "");
  if (dropped.length) {
    console.log(
      `  ${label}: ignored ${dropped.length} snapshot value(s) the shipped defaults do not declare` +
        ` (retired, unknown or wrong-typed) — ${dropped.join(", ")}`,
    );
  }
  return next;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function typeTag(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/** Replace only whitelisted top-level keys (through the one door); leave the
 *  rest of `target` intact. */
function applyWhitelist(target, source, whitelist, label) {
  const picked = {};
  for (const key of whitelist) {
    if (isPlainObject(source) && Object.hasOwn(source, key)) picked[key] = source[key];
  }
  return intersectShape(target, picked, label);
}

/**
 * Replace every key the TARGET already declares; IGNORE keys it does not.
 *
 * The snapshot supplies VALUES, never vocabulary. Gabriel's localStorage blob
 * is written by `loadPrefs`'s `{ ...DEFAULT_PREFS, ...JSON.parse(raw) }` and
 * re-serialized whole, so a preference retired from the interface is never
 * pruned from his storage — and the mirror POSTs that blob verbatim. Copying
 * every source key therefore RESURRECTS a retired preference into the shipped
 * defaults on the next cron tick, which `check-prefs-coverage` cannot see (it
 * asserts interface ⊆ defaults, so an extra key in the JSON is not a failure)
 * and `sync-defaults.sh` cannot see (its gate is `JSON.parse`, deliberately no
 * tsc and no tests) — and it commits to main unattended.
 *
 * That is not hypothetical: `aiMarkerText`/`aiMarkerBg`/`aiMarkerBorder` were
 * retired from `EditorPreferences` and from the defaults JSON in `1c0c52be`,
 * and the routine promote commit `ffa7dfe0` put all three back into the JSON
 * the next day, where they sat unread until task 326 deleted them again.
 *
 * Both `replace-all` targets (the only two: this file and
 * `panel-theme.defaults.json`) are closed vocabularies in TRACKED SOURCE, so a
 * legitimately NEW key is always already present in the target and survives
 * this rule untouched. What holds each closed is a TEST, not a type — say so
 * precisely, because the obvious answer is wrong in both cases:
 *   - `usePreferences.defaults.json`: `check-prefs-coverage` check 1 (every
 *     `EditorPreferences` key must appear here). NOT tsc — `DEFAULT_PREFS` is
 *     an `as` cast (usePreferences.ts), which cannot see a missing key.
 *   - `panel-theme.defaults.json`: the hand-written `FROZEN_THEME_KEYS` set in
 *     `panel-theme-key-freeze.test.ts`, which asserts the JSON's key set
 *     EXACTLY. `DEFAULT_PANEL_COLORS` is likewise a cast
 *     (`defaultPanelColorsJson as Record<PanelThemeKey, string>`), so the type
 *     annotation proves nothing — the same thing `print.ts` already says out
 *     loud about its own `as PrintOptions`. (Precisely: that test closes the
 *     JSON's key set, which is what this rule needs. It does NOT pin the
 *     `PanelThemeKey` union to the JSON, so a new union member with no JSON
 *     row is invisible to it — but such a member is unreachable anyway, since
 *     `CARD_THEMES` folds over the JSON and every `CARD_REGISTRY.themeKey`
 *     must be frozen.)
 *
 * The REGRESSION this rule accepts, stated rather than hidden: a preference
 * added to `EditorPreferences` and forgotten in the defaults JSON used to be
 * healed silently by the next promote tick (it arrived via Gabriel's blob).
 * Now it is dropped every tick, and `sync-defaults.sh` does NOT run
 * `check-prefs-coverage` (its only gate is `JSON.parse`), so under launchd the
 * sole signal is the log line below. That trade is deliberate: acquiring
 * VOCABULARY from one developer's browser is how a retired pref comes back
 * from the dead, and a shipped default that no interface declares is worse
 * than a loud missing one. Run `npm run test:prefs` when adding a preference.
 *
 * Dropped keys are LOGGED rather than silently skipped (by `intersectShape`,
 * which since task 904 also drops a wrong-typed value).
 */
function applyAll(target, source, label) {
  return intersectShape(target, source, label);
}

/** Deep-intersect `printOptions`: top-level scalars (e.g. `fontSizeRem`) and
 *  each section (`elements`, `panels`) take only the keys and types the
 *  shipped file declares (task 904 — this used to spread the snapshot, so a
 *  retired print option resurrected into the shipped defaults). */
function applyPrintOptions(target, source, label) {
  return intersectShape(target, source, label, { deep: true });
}

/**
 * Bake the snapshot's global colour transforms (hue / brightness / contrast)
 * into the shipped palette (task 902). The shipped `DEFAULT_TRANSFORMS` stay
 * the identity, so a fresh install's sliders read zero and the shipped colours
 * ARE what Gabriel sees — rather than his raw colours, which he only ever sees
 * through his transform.
 *
 * Idempotent by construction: every baked value is computed from the RAW
 * colour in the snapshot's prefs blob (`entry.rawFrom`), never from the
 * already-promoted defaults, so a re-run cannot compound the transform. Only
 * the table's colour rows are baked — the rows the runtime transforms — and
 * only keys the target already declares (the `applyAll` vocabulary rule).
 */
function applyBakeTransforms(target, transforms, rawPrefs) {
  const t = { contrast: 0, hue: 0, brightness: 0, ...transforms };
  const next = { ...target };
  for (const row of PREF_CSS_ROWS) {
    if (!row.color) continue;
    if (!Object.hasOwn(target, row.key) || !Object.hasOwn(rawPrefs, row.key)) continue;
    const raw = rawPrefs[row.key];
    if (typeof raw !== "string") continue;
    next[row.key] = applyTransforms(raw, t);
  }
  return next;
}

/** Pull a possibly-nested sub-value from the parsed snapshot blob. */
function extractSource(rawValue, subPath) {
  if (!subPath) return rawValue ?? {};
  return rawValue?.[subPath] ?? {};
}

/* ── Main ──────────────────────────────────────────────────────── */

function main() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot at ${SNAPSHOT_PATH} — nothing to promote.`);
    if (OPTS.changedOut) fs.writeFileSync(OPTS.changedOut, "", "utf-8");
    process.exit(0);
  }
  const snapshot = readJson(SNAPSHOT_PATH);
  const registry = readJson(REGISTRY_PATH);

  /** Root-relative paths this run changed (or, dry, WOULD change). */
  const changed = [];
  const verb = DRY_RUN ? "Would update" : "Updated";
  /** Final shape of each defaults file after promotion, keyed by
   *  the registry's defaultsFile path. Used downstream to regenerate
   *  the CSS managed block from authoritative post-merge values. */
  const finalByPath = {};

  for (const entry of registry.promotable) {
    const target = path.join(REPO_ROOT, entry.defaultsFile);
    const rawSnap = snapshot[entry.storageKey];
    const src = extractSource(rawSnap, entry.subPath);
    const cur = finalByPath[entry.defaultsFile] ?? readJson(target);
    let next;
    switch (entry.strategy) {
      case "whitelist":
        next = applyWhitelist(cur, src, entry.whitelist ?? [], entry.defaultsFile);
        break;
      case "replace-all":
        next = applyAll(cur, src, entry.defaultsFile);
        break;
      case "print-options":
        next = applyPrintOptions(cur, src, entry.defaultsFile);
        break;
      case "bake-transforms":
        next = applyBakeTransforms(cur, src, extractSource(snapshot[entry.rawFrom]));
        break;
      default:
        throw new Error(`Unknown promotion strategy: ${entry.strategy}`);
    }
    finalByPath[entry.defaultsFile] = next;
    if (writeJson(target, next)) {
      if (!changed.includes(entry.defaultsFile)) changed.push(entry.defaultsFile);
      console.log(verb, entry.defaultsFile);
    }
  }

  // globals.css managed block — the ONE pref→CSS table rendered from the
  // post-merge editor defaults.
  const editorNext = finalByPath[EDITOR_PREFS_JSON_REL] ?? readJson(path.join(REPO_ROOT, EDITOR_PREFS_JSON_REL));
  if (rewriteCssBlock(renderPrefCssSeed(editorNext))) {
    const rel = path.relative(REPO_ROOT, GLOBALS_CSS).split(path.sep).join("/");
    changed.push(rel);
    console.log(verb, rel);
  }

  if (OPTS.changedOut) {
    fs.writeFileSync(OPTS.changedOut, changed.map((f) => f + "\n").join(""), "utf-8");
  }
  if (changed.length === 0) console.log("No changes.");
  else console.log(`${changed.length} file(s) ${DRY_RUN ? "would be " : ""}updated.`);
  if (DRY_RUN && changed.length > 0) process.exit(1);
}

function rewriteCssBlock(seed) {
  const END = "/* PROMOTE-DEFAULTS-END */";
  const cur = fs.readFileSync(GLOBALS_CSS, "utf-8");
  const startMatch = /^([ \t]*)\/\* PROMOTE-DEFAULTS-START[\s\S]*?\*\//m.exec(cur);
  if (!startMatch) {
    throw new Error("globals.css missing PROMOTE-DEFAULTS-START marker");
  }
  const indent = startMatch[1];
  const startBlockEnd = startMatch.index + startMatch[0].length;
  const endIdx = cur.indexOf(END, startBlockEnd);
  if (endIdx === -1) {
    throw new Error("globals.css missing PROMOTE-DEFAULTS-END marker");
  }
  // Cut from the end of the START comment through the END marker
  // (excluding the marker itself) so we can rebuild the body. The
  // indent captured from START is reused for END so re-runs don't drift.
  const before = cur.slice(0, startBlockEnd);
  const after = cur.slice(endIdx + END.length);

  const lines = seed.map(([cssVar, value]) => `${indent}${cssVar}: ${value};`);
  const block = "\n" + lines.join("\n") + "\n" + indent + END;
  const next = before + block + after;
  if (next === cur) return false;
  if (!DRY_RUN) fs.writeFileSync(GLOBALS_CSS, next, "utf-8");
  return true;
}

main();
