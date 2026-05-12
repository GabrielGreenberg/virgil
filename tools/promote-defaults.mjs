#!/usr/bin/env node
/**
 * Promote Gabriel's personal localStorage prefs (mirrored to
 * tools/personal-snapshot.json by the dev server) into the shipped
 * defaults under src/.
 *
 * Reads the snapshot, takes the whitelisted subset of each prefs blob,
 * deep-merges it onto the existing default JSON sidecar, and writes
 * back. Also regenerates the marker-comment block inside
 * src/app/globals.css so first-paint CSS stays in sync with the JS
 * defaults.
 *
 * Idempotent. Safe to run any time. No deps.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "tools", "personal-snapshot.json");

const VIEW_PREFS_JSON = path.join(REPO_ROOT, "src", "hooks", "useViewPrefs.defaults.json");
const EDITOR_PREFS_JSON = path.join(REPO_ROOT, "src", "hooks", "usePreferences.defaults.json");
const PANEL_THEME_JSON = path.join(REPO_ROOT, "src", "lib", "panel-theme.defaults.json");
const PRINT_JSON = path.join(REPO_ROOT, "src", "lib", "print.defaults.json");
const GLOBALS_CSS = path.join(REPO_ROOT, "src", "app", "globals.css");

// Whitelist of ViewPrefs keys treated as "stable defaults" worth
// promoting. The rest of ViewPrefs is per-window noise (dock state,
// active panels, float positions) and stays at its shipped value.
const VIEW_PREFS_WHITELIST = new Set([
  "placements",
  "showHighlights",
  "hiddenHighlightTypes",
  "pageWidth",
  "editorLeftMargin",
  "editorRightMargin",
  "topGutter",
  "bottomGutter",
]);

// CSS variables that mirror EditorPreferences/ViewPrefs scalar values.
// Regenerated into the PROMOTE-DEFAULTS block so the first paint matches
// the JS defaults before the prefs hook hydrates.
const CSS_VAR_MAP = [
  ["--background",                "editor.backgroundColor"],
  ["--foreground",                "editor.foreground"],
  ["--surface",                   "editor.surfaceColor"],
  ["--border",                    "editor.borderColor"],
  ["--border-light",              "editor.borderLight"],
  ["--muted",                     "editor.mutedColor"],
  ["--muted-light",               "editor.mutedLight"],
  ["--accent",                    "editor.accentColor"],
  ["--topbar-bg",                 "editor.topbarBackground"],
  ["--topbar-bg-bottom",          "editor.topbarBackgroundBottom"],
  ["--topbar-border",             "editor.topbarBorder"],
  ["--tab-bg",                    "editor.tabBg"],
  ["--library-bg",                "editor.libraryBg"],
  ["--virgil-bar-text",           "editor.virgilBarText"],
  ["--pod-panel",                 "editor.podPanel"],
  ["--pod-toolbar",               "editor.podToolbar"],
  ["--pod-dark",                  "editor.podDark"],
  ["--header-bg",                 "editor.headerBg"],
  ["--panel-admin-text-color",    "editor.panelAdminTextColor"],
  ["--panel-admin-text-font",     "editor.panelAdminTextFont", { quote: true }],
  ["--editor-font-size",          "editor.editorFontSize", { unit: "rem" }],
  ["--editor-line-height",        "editor.editorLineHeight"],
  ["--editor-text-color",         "editor.editorTextColor"],
  ["--par-title-size",            "editor.parTitleSize", { unit: "rem" }],
  ["--par-title-color",           "editor.parTitleColor"],
  ["--heading-annotation-color",  "editor.headingAnnotationColor"],
  ["--heading-annotation-border", "editor.headingAnnotationBorder"],
  ["--blockquote-border",         "editor.blockquoteBorder"],
  ["--blockquote-text",           "editor.blockquoteText"],
  ["--code-bg",                   "editor.codeBackground"],
  ["--code-block-bg",             "editor.codeBlockBackground"],
  ["--math-color",                "editor.mathColor"],
  ["--math-prefix-color",         "editor.mathPrefixColor"],
  ["--comment-color",             "editor.commentColor"],
  ["--latex-comment-color",       "editor.latexCommentColor"],
  ["--citation-color",            "editor.citationColor"],
  ["--citation-border-color",     "editor.citationBorderColor"],
  ["--note-color",                "editor.noteColor"],
  ["--note-marker-border",        "editor.noteMarkerBorder"],
  ["--ai-marker-text",            "editor.aiMarkerText"],
  ["--ai-marker-bg",              "editor.aiMarkerBg"],
  ["--ai-marker-border",          "editor.aiMarkerBorder"],
  ["--mark-bg",                   "editor.markBackground"],
  ["--mark-border",               "editor.markBorder"],
  ["--latex-cmd-color",           "editor.latexCmdColor"],
  ["--drag-highlight",            "editor.dragHighlight"],
  ["--scrollbar-thumb",           "editor.scrollbarThumb"],
  ["--panel-font-size",           "editor.panelFontSize", { unit: "px" }],
  ["--panel-header-size",         "editor.panelHeaderSize", { unit: "px" }],
  ["--page-preferred",            "view.pageWidth", { unit: "px" }],
];

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

/* ── Main ──────────────────────────────────────────────────────── */

function main() {
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot at ${SNAPSHOT_PATH} — nothing to promote.`);
    process.exit(0);
  }
  const snapshot = readJson(SNAPSHOT_PATH);

  const viewSrc = snapshot["virgil-view-prefs/global"] ?? {};
  const editorSrc = snapshot["virgil-editor-prefs"] ?? {};
  const panelColorsSrc = snapshot["virgil-panel-colors"] ?? {};
  const printSrc = viewSrc.printOptions ?? {};

  let changedFiles = 0;

  // ViewPrefs: whitelisted keys only.
  const viewCur = readJson(VIEW_PREFS_JSON);
  const viewNext = applyWhitelist(viewCur, viewSrc, VIEW_PREFS_WHITELIST);
  if (writeJson(VIEW_PREFS_JSON, viewNext)) {
    console.log("Updated", path.relative(REPO_ROOT, VIEW_PREFS_JSON));
    changedFiles++;
  }

  // EditorPreferences: replace any key the snapshot provides.
  const editorCur = readJson(EDITOR_PREFS_JSON);
  const editorNext = applyAll(editorCur, editorSrc);
  if (writeJson(EDITOR_PREFS_JSON, editorNext)) {
    console.log("Updated", path.relative(REPO_ROOT, EDITOR_PREFS_JSON));
    changedFiles++;
  }

  // Panel theme overrides: every overridden key wins.
  const panelCur = readJson(PANEL_THEME_JSON);
  const panelNext = applyAll(panelCur, panelColorsSrc);
  if (writeJson(PANEL_THEME_JSON, panelNext)) {
    console.log("Updated", path.relative(REPO_ROOT, PANEL_THEME_JSON));
    changedFiles++;
  }

  // Print options: deep-merge elements + panels sub-objects, replace
  // the top-level scalar (fontSizeRem).
  const printCur = readJson(PRINT_JSON);
  const printNext = {
    ...printCur,
    ...printSrc,
    elements: { ...printCur.elements, ...(printSrc.elements ?? {}) },
    panels: { ...printCur.panels, ...(printSrc.panels ?? {}) },
  };
  if (writeJson(PRINT_JSON, printNext)) {
    console.log("Updated", path.relative(REPO_ROOT, PRINT_JSON));
    changedFiles++;
  }

  // globals.css managed block.
  if (rewriteCssBlock({ editor: editorNext, view: viewNext })) {
    console.log("Updated", path.relative(REPO_ROOT, GLOBALS_CSS));
    changedFiles++;
  }

  console.log(changedFiles === 0 ? "No changes." : `${changedFiles} file(s) updated.`);
}

function rewriteCssBlock(values) {
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
  for (const entry of CSS_VAR_MAP) {
    const [cssVar, sourcePath, opts = {}] = entry;
    const [bucket, key] = sourcePath.split(".");
    const raw = values[bucket]?.[key];
    if (raw === undefined || raw === null) continue;
    let rendered;
    if (opts.quote) {
      rendered = `"${String(raw)}"`;
    } else if (opts.unit) {
      rendered = `${raw}${opts.unit}`;
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
