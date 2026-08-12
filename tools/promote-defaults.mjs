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
 * block inside src/app/globals.css so first-paint CSS stays in sync
 * with the JS defaults.
 *
 * Idempotent. Safe to run any time. No deps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "tools", "personal-snapshot.json");
const REGISTRY_PATH = path.join(REPO_ROOT, "src", "lib", "dev-prefs-registry.json");
const GLOBALS_CSS = path.join(REPO_ROOT, "src", "app", "globals.css");

const EDITOR_PREFS_JSON_REL = "src/hooks/usePreferences.defaults.json";
const VIEW_PREFS_JSON_REL = "src/hooks/useViewPrefs.defaults.json";

/* ── Utilities ──────────────────────────────────────────────────── */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function writeJson(file, value) {
  const next = JSON.stringify(value, null, 2) + "\n";
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : "";
  if (next === prev) return false;
  fs.writeFileSync(file, next, "utf-8");
  return true;
}

/** Replace only whitelisted top-level keys; leave the rest of `target` intact. */
function applyWhitelist(target, source, whitelist) {
  const next = { ...target };
  for (const key of whitelist) {
    if (key in source) next[key] = source[key];
  }
  return next;
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
 * tsc and no tests) — and it commits and pushes to main unattended.
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
 * Dropped keys are LOGGED rather than silently skipped.
 */
function applyAll(target, source, label) {
  const next = { ...target };
  const ignored = [];
  for (const [key, value] of Object.entries(source)) {
    // `Object.hasOwn`, not `key in target`: `in` consults the prototype chain,
    // so a snapshot key spelled `constructor` / `toString` / `valueOf` would
    // read as DECLARED and be written into the shipped defaults — the exact
    // inverse of this rule. `label` is required for the same reason the mode
    // argument in `bridgeCardAiRequestFlag` is: the log line below is the only
    // signal this mechanism emits, and a defaulted "" would silently strip the
    // filename out of it.
    if (!Object.hasOwn(target, key)) {
      ignored.push(key);
      continue;
    }
    next[key] = value;
  }
  if (ignored.length) {
    console.log(
      `  ${label}: ignored ${ignored.length} snapshot key(s) the shipped defaults do not declare` +
        ` (retired or unknown) — ${ignored.join(", ")}`,
    );
  }
  return next;
}

/** Deep-merge `printOptions`: replace top-level scalars (e.g.
 *  `fontSizeRem`), per-section merge `elements` + `panels`. */
function applyPrintOptions(target, source) {
  return {
    ...target,
    ...source,
    elements: { ...target.elements, ...(source.elements ?? {}) },
    panels: { ...target.panels, ...(source.panels ?? {}) },
  };
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
    process.exit(0);
  }
  const snapshot = readJson(SNAPSHOT_PATH);
  const registry = readJson(REGISTRY_PATH);

  let changedFiles = 0;
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
        next = applyWhitelist(cur, src, entry.whitelist ?? []);
        break;
      case "replace-all":
        next = applyAll(cur, src, entry.defaultsFile);
        break;
      case "print-options":
        next = applyPrintOptions(cur, src);
        break;
      default:
        throw new Error(`Unknown promotion strategy: ${entry.strategy}`);
    }
    finalByPath[entry.defaultsFile] = next;
    if (writeJson(target, next)) {
      console.log("Updated", entry.defaultsFile);
      changedFiles++;
    }
  }

  // globals.css managed block — sourced from the post-merge values for
  // the editor + view buckets. The CSS_VAR_MAP entry's `source` field
  // is `"bucket.key"`, where bucket is one of those two.
  const editorNext = finalByPath[EDITOR_PREFS_JSON_REL] ?? readJson(path.join(REPO_ROOT, EDITOR_PREFS_JSON_REL));
  const viewNext = finalByPath[VIEW_PREFS_JSON_REL] ?? readJson(path.join(REPO_ROOT, VIEW_PREFS_JSON_REL));
  if (rewriteCssBlock(registry.cssVarMap, { editor: editorNext, view: viewNext })) {
    console.log("Updated", path.relative(REPO_ROOT, GLOBALS_CSS));
    changedFiles++;
  }

  console.log(changedFiles === 0 ? "No changes." : `${changedFiles} file(s) updated.`);
}

function rewriteCssBlock(cssVarMap, values) {
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

  const lines = [];
  for (const [cssVar, spec] of Object.entries(cssVarMap)) {
    const [bucket, key] = spec.source.split(".");
    const raw = values[bucket]?.[key];
    if (raw === undefined || raw === null) continue;
    let rendered;
    if (spec.quote) {
      rendered = `"${String(raw)}"`;
    } else if (spec.unit) {
      rendered = `${raw}${spec.unit}`;
    } else {
      rendered = String(raw);
    }
    lines.push(`${indent}${cssVar}: ${rendered};`);
  }
  const block = "\n" + lines.join("\n") + "\n" + indent + END;
  const next = before + block + after;
  if (next === cur) return false;
  fs.writeFileSync(GLOBALS_CSS, next, "utf-8");
  return true;
}

main();
