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

/** Replace every key present in `source`; leave others intact. */
function applyAll(target, source) {
  const next = { ...target };
  for (const [key, value] of Object.entries(source)) {
    next[key] = value;
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
        next = applyAll(cur, src);
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
