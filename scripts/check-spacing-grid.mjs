#!/usr/bin/env node
/**
 * Spacing-grid guard (task 2026-09-28-821).
 *
 * Spacing is a 4-pixel grid, and it is a prohibition, not a preference
 * (STYLE_GUIDE.md "Spacing & icons"): padding, margin, gap and offsets come
 * from Tailwind's scale. The ONE exception is aligning to a non-grid asset — an
 * icon's optical centre, a glyph width, the folder-tab geometry — and a site
 * that takes it SAYS WHAT IT ALIGNS TO. Until this guard, that sentence was
 * enforced by nobody, and hand-added offsets (a corner cluster's `3.125rem`, an
 * indent's `18px` = grip + gap) sat beside the value they were computed from
 * with nothing to fail when that value moved. This is the radius guard's
 * sibling (`check-radius-tokens.mjs`) for the spacing half of the scale.
 *
 * The guard FLAGS, in `src/` + `library/` `.ts`/`.tsx`: every arbitrary
 * Tailwind spacing utility — `p`/`m` (+ side), `gap`, `space-x|y`, `inset`,
 * `top|right|bottom|left|start|end` with a `-[…]` value (negatives included).
 *
 * A site PASSES when:
 *   - its bracketed value is a `var(…)` reference — the token vouches for
 *     itself, exactly as in the radius guard (`mb-[var(--bar-seam-lift)]`); or
 *   - it carries an `aligns:` note — on the same line, or in the contiguous
 *     comment block directly above it — naming what the off-grid value aligns
 *     to. That is the style guide's own exception, now machine-checked.
 * Comment lines themselves are not scanned (prose may quote a class), nor is
 * test source (its class strings are fixtures, not rendered UI).
 *
 * A value that is DERIVED from its source belongs in a constant or a style
 * binding computed from that source, not in an annotated literal — the note is
 * for genuinely foreign geometry, not for arithmetic that could be code.
 *
 * Usage: `node scripts/check-spacing-grid.mjs [path…]` (wired as
 * `npm run check:spacing`; explicit paths let the contract test scan a planted
 * fixture). Exit 1 with a report on any violation; exit 0 when clean.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["src", "library"];
const EXTS = new Set([".ts", ".tsx"]);

// Whole-file exceptions (path suffix match): the guard + its contract test,
// which plants arbitrary spacing as fixture SOURCE STRINGS on purpose.
const ALLOWLIST_FILES = [
  "scripts/check-spacing-grid.mjs",
  "src/__tests__/spacing-grid.test.ts",
];

// `(?<![\w-])` keeps `text-[…]`/`max-w-[…]`/`rounded-[…]` etc. from matching on
// a trailing substring, while still admitting a leading `-` (negative) and a
// variant prefix (`md:`, `hover:`, `[&>svg]:`).
const UTILITY = new RegExp(
  String.raw`(?<![\w-])-?(?:p[trblxyse]?|m[trblxyse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|start|end)-\[([^\]\s]+)\]`,
  "g",
);

const isCommentLine = (l) => /^\s*(\/\/|\/\*|\*|\{\s*\/\*)/.test(l);
const MARKER = /\baligns:/;

/** The `aligns:` note on this line or in the comment block directly above. */
function hasAlignsNote(lines, i) {
  if (MARKER.test(lines[i])) return true;
  for (let k = i - 1; k >= 0 && k >= i - 8; k--) {
    if (!isCommentLine(lines[k])) break;
    if (MARKER.test(lines[k])) return true;
  }
  return false;
}

const violations = [];

function scanFile(file) {
  if (ALLOWLIST_FILES.some((a) => file.endsWith(a))) return;
  // Test SOURCE is not rendered UI — its class strings are fixtures (a
  // guardrail test plants `mt-[3px]` to prove IT rejects it).
  if (/(^|\/)__tests__\//.test(file) || /\.test\.tsx?$/.test(file)) return;
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const m of line.matchAll(UTILITY)) {
      if (m[1].includes("var(")) continue;
      if (hasAlignsNote(lines, i)) continue;
      violations.push([rel, i + 1, m[0]]);
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

const targets = process.argv.slice(2);
for (const t of targets.length ? targets : SCAN_DIRS) {
  const abs = path.resolve(ROOT, t);
  if (!fs.existsSync(abs)) continue;
  if (fs.statSync(abs).isDirectory()) walk(abs);
  else if (EXTS.has(path.extname(abs))) scanFile(abs);
}

if (violations.length) {
  console.error(`\n✖ Spacing-grid guard: ${violations.length} arbitrary spacing value${violations.length === 1 ? "" : "s"} found.\n`);
  console.error("  Spacing comes from the 4px scale (src/STYLE_GUIDE.md \"Spacing & icons\"):");
  console.error("  use a scale step (`p-1.5`, `gap-px`), a `var(--token)`, or DERIVE the value");
  console.error("  from its source in code. A genuinely off-grid alignment carries an");
  console.error("  `aligns: <what>` comment on the line or directly above it.\n");
  for (const [file, ln, val] of violations) console.error(`    ${file}:${ln}  ${val}`);
  console.error("");
  process.exit(1);
}

console.log("✓ Spacing-grid guard: every arbitrary spacing value is a token or says what it aligns to.");
