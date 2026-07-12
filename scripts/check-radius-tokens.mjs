#!/usr/bin/env node
/**
 * Radius-token guard.
 *
 * Corner radii are tokenized (STYLE_GUIDE.md "Radius scale"): every radius in
 * the app flows from the six-step scale defined in `src/app/globals.css`
 * (`--radius-xs` · `--radius-sm` · `--radius-md` · `--pod-radius` ·
 * `--panel-radius` · `--radius-pill`, plus the deliberate `--library-manila-radius`
 * exception). This is the same "tokens are the single source of truth" rule the
 * guide already imposes on colors — now enforced for radius so new literals
 * can't creep back in.
 *
 * The guard FLAGS, in `src/` + `library/`:
 *   - CSS `border-radius` / `border-<corner>-radius:` with a numeric/px/rem literal
 *   - inline `borderRadius` / `border<Corner>Radius:` with a numeric or px/rem-string literal
 *   - arbitrary Tailwind `rounded-[…]` classes
 * unless the value is an allowed non-corner LEAVE (`0`, `1px`, `1.5px`, hairline
 * insertion/indicator bars; `50%` / `100%` perfect circles; `inherit`), or it is
 * already a `var(--…)` token.
 *
 * Escape hatches (documented exceptions):
 *   - files listed in ALLOWLIST_FILES (SVG path geometry, generated bundles)
 *   - an inline `radius-allow` comment on the offending line
 *
 * Usage: `node scripts/check-radius-tokens.mjs` (wired as `npm run check:radius`).
 * Exit 1 with a report on any violation; exit 0 when clean.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "library"];
const EXTS = new Set([".css", ".ts", ".tsx"]);

// Whole-file exceptions (path substring match).
const ALLOWLIST_FILES = [
  // Folder-tab SVG silhouette: R/S sweep constants are path geometry, not CSS
  // corners — they must be touched at the geometry layer, never tokenized.
  "src/components/chrome/folder-tab-geometry.ts",
  // The guard itself + generated skill bundles.
  "scripts/check-radius-tokens.mjs",
];

// Values that are NOT a scale corner and are allowed to stay literal.
//  - 0 / resets: intentional flattening.
//  - 1px / 1 / 1.5(px): hairline insertion & drop-indicator bars.
//  - 50% / 100%: perfect circles, avatars, dots (aspect-ratio driven).
const LEAVE_VALUES = new Set([
  "0", "0px", "1px", "1", "1.5px", "1.5", "50%", "100%", "inherit", "unset", "initial",
]);
const isLeaveValue = (v) => {
  const t = v.trim();
  if (t.includes("var(")) return true;
  // multi-value shorthand (e.g. "1px 1px 0 0"): every part must be a leave.
  return t.split(/\s+/).every((p) => LEAVE_VALUES.has(p));
};

const violations = [];

function scanFile(file) {
  if (ALLOWLIST_FILES.some((a) => file.endsWith(a))) return;
  const ext = path.extname(file);
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bradius-allow\b/.test(line)) continue; // per-line escape hatch

    if (ext === ".css") {
      const m = line.match(/\bborder(?:-(?:top|bottom)-(?:left|right))?-radius\s*:\s*([^;]+)/);
      if (m && !isLeaveValue(m[1])) {
        violations.push([rel, i + 1, m[1].trim(), "css border-radius literal"]);
      }
    } else {
      // inline styles: borderRadius / borderTopLeftRadius: <number | 'px-string'>
      const m = line.match(/\bborder(?:Top|Bottom)?(?:Left|Right)?Radius\s*:\s*("[^"]*"|'[^']*'|[0-9][0-9.]*)/);
      if (m) {
        const raw = m[1];
        const val = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
        if (!isLeaveValue(val)) {
          violations.push([rel, i + 1, raw, "inline borderRadius literal"]);
        }
      }
      // arbitrary Tailwind rounded-[…] class
      const am = line.match(/\brounded(?:-[tbrxysel]{1,2})?-\[([^\]]+)\]/);
      if (am && !am[1].includes("var(")) {
        violations.push([rel, i + 1, `rounded-[${am[1]}]`, "arbitrary rounded-[] class"]);
      }
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
      walk(full);
    } else if (EXTS.has(path.extname(entry.name))) {
      scanFile(full);
    }
  }
}

for (const d of SCAN_DIRS) {
  const abs = path.join(ROOT, d);
  if (fs.existsSync(abs)) walk(abs);
}

if (violations.length) {
  console.error(`\n✖ Radius-token guard: ${violations.length} literal radius${violations.length === 1 ? "" : "es"} found.\n`);
  console.error("  Use a token from the scale (src/STYLE_GUIDE.md \"Radius scale\"):");
  console.error("    var(--radius-xs) 3 · var(--radius-sm) 4 · var(--radius-md) 6 ·");
  console.error("    var(--pod-radius) 8 · var(--panel-radius) 14 · var(--radius-pill).");
  console.error("  Hairline bars (1px), circles (50%) and resets (0) are allowed as-is.");
  console.error("  A genuine exception can carry a `radius-allow` comment on the line.\n");
  for (const [file, ln, val, kind] of violations) {
    console.error(`    ${file}:${ln}  ${kind}: ${val}`);
  }
  console.error("");
  process.exit(1);
}

console.log("✓ Radius-token guard: no stray literal radii.");
