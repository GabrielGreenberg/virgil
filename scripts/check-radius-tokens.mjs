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
 * The guard keys on the DECLARATION, not on the file extension — a `.tsx` file
 * routinely carries both syntaxes (camelCase React style objects AND kebab-case
 * CSS inside `style.cssText = "…"` strings / template-literal stylesheets), so
 * every JS/TS file is scanned for every JS-reachable declaration form. Keying on
 * the file kind is how six untokenized drag-ghost radii hid in `.tsx` cssText
 * strings for a full release cycle (task 2026-07-18-169).
 *
 * The guard FLAGS, in `src/` + `library/`:
 *   - CSS `border-radius` / `border-<corner>-radius:` — in `.css` files AND in
 *     CSS authored inside `.ts`/`.tsx` strings
 *   - inline `borderRadius` / `border<Corner>Radius:` in a style object
 *   - `el.style.borderRadius = …` property assignments
 *   - arbitrary Tailwind `rounded-[…]` classes
 * Values are read as whole EXPRESSIONS (quote- and bracket-aware, following a
 * wrapped value onto the next line), so a ternary or arithmetic radius is
 * inspected rather than skipped. `var(…)` spans — fallback literal included —
 * vouch for themselves and drop out; a declaration is flagged when what REMAINS
 * carries a numeric literal that isn't an allowed non-corner LEAVE (`0`, `1px`,
 * `1.5px`, hairline insertion/indicator bars; `50%` / `100%` perfect circles;
 * `inherit`). Note a token branch does NOT immunize a literal beside it —
 * `big ? "var(--panel-radius)" : "7px"` is a violation, since that half-migrated
 * ternary is precisely what an unfinished sweep leaves behind.
 *
 * Escape hatches (documented exceptions):
 *   - files listed in ALLOWLIST_FILES (SVG path geometry, generated bundles)
 *   - an inline `radius-allow` comment on the offending line
 *
 * Usage: `node scripts/check-radius-tokens.mjs [path…]` (wired as
 * `npm run check:radius`; explicit paths are used by the contract test to scan a
 * planted fixture). Exit 1 with a report on any violation; exit 0 when clean.
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
  // The guard's own contract test: its "guard reach" cases plant literal radii
  // as fixture SOURCE STRINGS and assert the guard rejects them. They are
  // scanned deliberately, via a temp fixture file, not by the tree sweep.
  "src/__tests__/radius-scale.test.ts",
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

// Corner-property spellings, one per authoring syntax.
const KEBAB = String.raw`border(?:-(?:top|bottom)-(?:left|right))?-radius`;
const CAMEL = String.raw`border(?:Top|Bottom)?(?:Left|Right)?Radius`;

// A declaration form = how the corner property is spelled + what separates it
// from its value. The value itself is never captured by the regex — it's read by
// `readValueExpr` below, so ternaries, arithmetic and nested calls survive.
//   `cssOnly`: also applies to `.css` files (the others are JS syntax).
const DECLARATIONS = [
  { kind: "css border-radius literal", re: new RegExp(String.raw`\b${KEBAB}\s*:`, "g"), inCss: true },
  { kind: "inline borderRadius literal", re: new RegExp(String.raw`\b${CAMEL}\s*:`, "g"), inCss: false },
  // `=(?!=)`: an ASSIGNMENT, not a comparison — `el.style.borderRadius === "6px"`
  // is a read, and flagging it would fail CI on innocent code.
  { kind: "style.borderRadius assignment", re: new RegExp(String.raw`\.style\.${CAMEL}\s*=(?!=)`, "g"), inCss: false },
];

/**
 * Read the value expression that starts at `from`, quote- and bracket-aware.
 * Stops at the first `,` / `;` or unbalanced closer at depth 0 — i.e. at the end
 * of the declaration, whether it sits in a CSS rule, a cssText string, or a JS
 * object literal.
 */
function readValueExpr(line, from) {
  let depth = 0;
  let quote = null;
  let out = "";
  for (let i = from; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      out += c;
      if (c === quote && line[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) {
      if (depth === 0) break;
      depth--;
    } else if ((c === "," || c === ";") && depth === 0) break;
    out += c;
  }
  return out.trim();
}

const isCommentLine = (l) => /^\s*(\/\/|\/\*|\*)/.test(l);

/**
 * Read a declaration's value, following it onto the next lines when the author
 * (or prettier) wrapped it — `border-radius:\n  9px 9px 0 0;` and
 * `el.style.borderRadius =\n  "7px";` are ordinary formatting, and a strictly
 * per-line read sees an empty value and waves them through.
 *
 * Continuation is deliberately narrow: only when the declaration line yields
 * NOTHING, never out of a comment, never into one, and at most a few lines. A
 * value that merely *runs long* is not chased — that would let an unterminated
 * expression swallow unrelated lines and their numbers.
 */
function readDeclarationValue(lines, i, from) {
  let expr = readValueExpr(lines[i], from);
  let endLine = i;
  if (!expr && !isCommentLine(lines[i])) {
    for (let k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
      if (isCommentLine(lines[k])) break;
      endLine = k;
      expr = readValueExpr(lines[k], 0);
      if (expr || lines[k].trim()) break; // a non-blank line settles it either way
    }
  }
  return { expr, endLine };
}

const unquote = (v) =>
  (v.startsWith('"') && v.endsWith('"')) ||
  (v.startsWith("'") && v.endsWith("'")) ||
  (v.startsWith("`") && v.endsWith("`"))
    ? v.slice(1, -1)
    : v;

/**
 * Blank out every bracket-balanced `var(…)` span in an expression.
 *
 * A token reference is legitimate wherever it appears — INCLUDING its fallback
 * literal (`var(--panel-radius, 14px)`) — but it must only vouch for ITSELF. A
 * plain `expr.includes("var(")` test would let one token branch immunize every
 * literal beside it (`isBig ? "var(--panel-radius)" : "7px"` — the half-migrated
 * ternary, which is exactly the shape a maintainer leaves behind mid-sweep).
 * So the spans are removed and the RESIDUE is what gets judged.
 */
function stripVarSpans(expr) {
  let out = "";
  for (let i = 0; i < expr.length; ) {
    if (expr.startsWith("var(", i)) {
      let depth = 0;
      let j = i + 3; // at the '('
      for (; j < expr.length; j++) {
        if (expr[j] === "(") depth++;
        else if (expr[j] === ")" && --depth === 0) break;
      }
      i = j + 1;
      continue;
    }
    out += expr[i++];
  }
  return out;
}

/**
 * Offending literals inside a radius value expression, or `null` when it's fine.
 * Token spans vouch for themselves and drop out; a whole-value LEAVE passes.
 * Otherwise every numeric literal left in the expression must itself be a LEAVE —
 * which is what lets a ternary (`dropOver ? 4 : 0`) be judged on its 4 while a
 * type annotation (`borderRadius?: string`) carries no literal at all and is
 * silently fine.
 */
function offendingLiterals(expr) {
  if (!expr) return null;
  const residue = stripVarSpans(expr).trim();
  if (!residue) return null;
  if (isLeaveValue(unquote(residue)) || isLeaveValue(residue)) return null;
  const nums = residue.match(/\d+(?:\.\d+)?(?:px|rem|em|%)?/g) || [];
  const offenders = nums.filter((n) => !LEAVE_VALUES.has(n));
  return offenders.length ? offenders : null;
}

const violations = [];

function scanFile(file) {
  if (ALLOWLIST_FILES.some((a) => file.endsWith(a))) return;
  const isCss = path.extname(file) === ".css";
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/\bradius-allow\b/.test(line)) continue; // per-line escape hatch

    for (const { kind, re, inCss } of DECLARATIONS) {
      if (isCss && !inCss) continue;
      re.lastIndex = 0;
      for (let m = re.exec(line); m; m = re.exec(line)) {
        const { expr, endLine } = readDeclarationValue(lines, i, m.index + m[0].length);
        // The hatch covers every line the declaration spans, not just its first.
        if (lines.slice(i, endLine + 1).some((l) => /\bradius-allow\b/.test(l))) continue;
        if (offendingLiterals(expr)) violations.push([rel, i + 1, expr, kind]);
      }
    }

    if (isCss) continue;
    // arbitrary Tailwind rounded-[…] classes — ALL of them on the line: a
    // className string routinely carries several, and checking only the first
    // lets `rounded-[var(--pod-radius)] rounded-t-[7px]` through.
    for (const am of line.matchAll(/\brounded(?:-[tbrxysel]{1,2})?-\[([^\]]+)\]/g)) {
      if (!am[1].includes("var(")) {
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

// Explicit paths (files or dirs) override the default sweep — the contract test
// uses this to point the guard at a planted fixture.
const targets = process.argv.slice(2);
for (const t of targets.length ? targets : SCAN_DIRS) {
  const abs = path.resolve(ROOT, t);
  if (!fs.existsSync(abs)) continue;
  if (fs.statSync(abs).isDirectory()) walk(abs);
  else if (EXTS.has(path.extname(abs))) scanFile(abs);
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
