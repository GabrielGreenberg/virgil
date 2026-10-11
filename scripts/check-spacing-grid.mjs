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
 * And it judges the prohibition's OTHER spellings (task 2026-10-11-1060) —
 * until then CSS files, inline styles and `cssText` strings shipped ~26
 * off-grid values the guard could not see:
 *   - a CSS declaration — `padding`/`margin` (+ side/logical), `gap`,
 *     `row-|column-gap`, `inset*`, `top|right|bottom|left` — in `src/**.css`
 *     + `library/**.css`, in a `cssText` string, or in a Tailwind arbitrary
 *     property (`[padding:5px]`); and
 *   - a React style-object key (`paddingRight: 5`, `padding: "5px 8px"`,
 *     `gap`, `inset*`; `top|right|bottom|left` only as a px STRING, since a
 *     bare number there is as often a rect as a style).
 * These are literal px rather than an escape hatch, so they are judged on the
 * VALUE: off-grid = an odd px above 1, or a fractional px (the half-steps
 * 2/6/10/14 are Tailwind's own). A `var(--x, 5px)` fallback is judged too.
 * `em`/`rem`/`%` are not judged — the `em` margins are typographic prose
 * rhythm, outside the pixel grid. `translate-*` is a transform nudge, not
 * box spacing, and is out of scope.
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
const CSS_EXTS = new Set([".css"]);

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

// The other two spellings of the same prohibition (task 2026-10-11-1060).
// A CSS declaration — in a stylesheet, a `cssText` string, or a Tailwind
// arbitrary property `[padding:5px]` — and a React inline style-object key.
// These are LITERAL px, so unlike a bracket utility (always a deliberate
// escape from the scale) they are judged on the value: on-grid passes.
const CSS_DECL = new RegExp(
  String.raw`(?<![\w-])(padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap|inset(?:-(?:inline|block)(?:-(?:start|end))?)?|top|right|bottom|left)\s*:\s*([^;}"'\`]+)`,
  "g",
);
const STYLE_KEY = new RegExp(
  String.raw`(?<![\w.$-])((?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block)?(?:Start|End)?|gap|rowGap|columnGap|inset(?:Inline|Block)?(?:Start|End)?)\s*:\s*(-?\d+(?:\.\d+)?(?![\w.])|"[^"]*"|'[^']*'|\`[^\`$]*\`)`,
  "g",
);
// Physical offsets in a style object only as a px STRING — a bare number keyed
// `top`/`left` is as often a rect or a coordinate as a style.
const STYLE_OFFSET = new RegExp(
  String.raw`(?<![\w.$-])(top|right|bottom|left)\s*:\s*("-?\d[^"]*px[^"]*"|'-?\d[^']*px[^']*')`,
  "g",
);

/**
 * Off the 4px grid: an odd integer px above 1, or a fractional px. The
 * half-steps 2/6/10/14 are Tailwind's own `0.5`/`1.5`/`2.5`/`3.5` and pass;
 * 0 and 1 (a hairline) pass. `em`/`rem`/`%` are not px and are not judged —
 * the `em` margins are typographic prose rhythm, outside the pixel grid.
 */
function offGridPx(value) {
  const bad = [];
  for (const m of String(value).matchAll(/(-?\d*\.?\d+)px\b/g)) {
    const n = Math.abs(Number(m[1]));
    if (!Number.isInteger(n) || (n > 1 && n % 2 === 1)) bad.push(m[0]);
  }
  return bad;
}
const offGridNumber = (raw) => {
  const n = Math.abs(Number(raw));
  return !Number.isInteger(n) || (n > 1 && n % 2 === 1);
};

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

function scanCss(file) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\/\*.*?\*\//g, (c) => (MARKER.test(c) ? c : ""));
    if (isCommentLine(line)) continue;
    for (const m of line.matchAll(CSS_DECL)) {
      const bad = offGridPx(m[2]);
      if (!bad.length || hasAlignsNote(lines, i)) continue;
      violations.push([rel, i + 1, `${m[1]}: ${m[2].trim()}`]);
    }
  }
}

/** The CSS-declaration and style-object spellings, on one TS line. */
function scanLineSpellings(lines, i, rel) {
  const line = lines[i];
  const hits = [];
  for (const m of line.matchAll(CSS_DECL)) if (offGridPx(m[2]).length) hits.push(`${m[1]}:${m[2].trim()}`);
  for (const m of line.matchAll(STYLE_KEY)) {
    const v = m[2];
    const bad = /^["'`]/.test(v) ? offGridPx(v).length > 0 : offGridNumber(v);
    if (bad) hits.push(`${m[1]}: ${v}`);
  }
  for (const m of line.matchAll(STYLE_OFFSET)) if (offGridPx(m[2]).length) hits.push(`${m[1]}: ${m[2]}`);
  if (!hits.length || hasAlignsNote(lines, i)) return;
  for (const h of hits) violations.push([rel, i + 1, h]);
}

function scanFile(file) {
  if (ALLOWLIST_FILES.some((a) => file.endsWith(a))) return;
  if (CSS_EXTS.has(path.extname(file))) return scanCss(file);
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
    scanLineSpellings(lines, i, rel);
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
      walk(full);
    } else if (EXTS.has(path.extname(entry.name)) || CSS_EXTS.has(path.extname(entry.name))) {
      scanFile(full);
    }
  }
}

const targets = process.argv.slice(2);
for (const t of targets.length ? targets : SCAN_DIRS) {
  const abs = path.resolve(ROOT, t);
  if (!fs.existsSync(abs)) continue;
  if (fs.statSync(abs).isDirectory()) walk(abs);
  else if (EXTS.has(path.extname(abs)) || CSS_EXTS.has(path.extname(abs))) scanFile(abs);
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
