#!/usr/bin/env node
/**
 * Vendor a DECLARED package family into the offline TeX bundle (task 520).
 *
 *   node scripts/vendor-tex-family.mjs <family> [--dry-run]
 *   node scripts/vendor-tex-family.mjs --all
 *
 * Resolves the family's closure against the TeXlive mirror by walking what the
 * fetched TeX source actually inputs, writes the bytes into
 * public/swiftlatex/texbundle/, and merges the rows into the two generated
 * tables through scripts/lib/tex-bundle-manifest.mjs (merge BY FAMILY, so this
 * is idempotent and a shrunk closure prunes its own orphans).
 *
 * WHY THIS EXISTS. The sibling producer, build-tex-bundle.mjs, bakes a LIVE
 * capture — and a capture needs a browser, a warm worker, and a document that
 * happens to exercise the packages you want. That is the right instrument for
 * discovering the compiler-internal cacheKeys of assets whose numeric format
 * code cannot be hand-authored (fonts, maps, encodings). It is the wrong
 * instrument for "vendor this package family", where the format code is known
 * (kpse `tex` = 26) and the closure is derivable from the sources themselves.
 *
 * THE SCAN IS A PROPOSAL, NOT A PROOF. See tex-bundle-families.mjs: both error
 * directions fail open, so a declaration plus a reviewed diff is the honest
 * shape. What the scan must NOT do is mistake TALKING about a load for a load —
 * a `\tikzerror{You need to say \string\usetikzlibrary{calc}}` names a library
 * it does not load, which is the difference between a 1.16 MB pgf/tikz closure
 * and a 2.16 MB one (measured).
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { FAMILIES, EXCLUDE, FORMAT_TEX } from "./tex-bundle-families.mjs";
import {
  texbundleDir,
  publicPathFor,
  fmtBytes,
  writeBundle,
  readManifestTs,
  FMT_FILEID,
  CORE_FAMILY,
} from "./lib/tex-bundle-manifest.mjs";

/**
 * The SAME mirror the RUNTIME asks (`TEXLIVE_ENDPOINT` in src/lib/swiftlatex.ts).
 * It has to be: a vendored byte and a streamed byte for the same package must
 * come from one TeX Live snapshot, or a paper compiles against two versions of
 * pgf depending on which half of its closure was cached. A build script cannot
 * import the TS module, so the agreement is pinned in tex-bundle-integrity.
 */
const ENDPOINT = "https://texlive.texlyre.org/";
const MAX_FILES = 400; // runaway backstop, far above any real family

function fail(msg) {
  console.error(`vendor-tex-family: ${msg}`);
  process.exit(1);
}

/** Strip TeX comments: an unescaped `%` to end of line. */
function stripComments(src) {
  return src
    .split(/\r?\n/)
    .map((line) => {
      let out = "";
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "\\") {
          out += line.slice(i, i + 2);
          i++;
          continue;
        }
        if (c === "%") break;
        out += c;
      }
      return out;
    })
    .join("\n");
}

const splitList = (s) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Blank the balanced `{...}` group starting at `from` (which must be the `{`),
 * preserving length so every other offset still lines up.
 */
function blankGroupAt(text, from) {
  if (text[from] !== "{") return null;
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") { i++; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(0, from) + " ".repeat(i + 1 - from) + text.slice(i + 1);
    }
  }
  return null;
}

/**
 * The reqnames a TeX source loads. Every rule mirrors a real loader:
 * `\input`, LaTeX's `\RequirePackage`/`\usepackage`, pgf's own
 * `\pgfutil@InputIfFileExists`, and pgf/tikz's three `\use…` forms, each of
 * which expands a bare name into `<prefix><name>.code.tex`.
 *
 * Two things are NOT loads, and both are one mistake — reading a load that is
 * merely SPOKEN OF as one that happens. Together they are the difference
 * between a 1.16 MB pgf/tikz closure and a 2.16 MB one (measured).
 *
 * A THIRD rule was written and DELETED: dropping any line carrying an
 * `…error`/`…warning`/`…typeout` macro. Measured with the two below in place it
 * changed the closure by ZERO files — every diagnostic in this corpus that
 * names a load names it with `\string`, which is how TeX prints a control
 * sequence and therefore how authors write one into a message. It was also the
 * only rule that could lose a REAL load, being line- rather than
 * construct-granular. A rule that does nothing is worse than no rule: the next
 * reader trusts it.
 */
export function referencesIn(raw) {
  let text = stripComments(raw);

  // (1) `\string\usepackage{fp}` PRINTS the call; it never performs it. That
  //     is a fact about TeX, so the rule covers every loader rather than a
  //     list of the ones someone remembered — which is what makes it, and not
  //     an error-macro filter, the thing that answers pgf's dozen
  //     "you need to say \usetikzlibrary{calc}" branches.
  text = text.replace(/\\string\s*\\[A-Za-z@]+\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, "");

  // (2) A `\DeclareOption{x}{...\RequirePackage{y}...}` body runs only if the
  //     caller passes that option. Virgil emits bare \usepackage lines, so
  //     xcolor's `table` (colortbl -> array, color) and `fixpdftex`
  //     (pdfcolmk) never fire. A user who does pass one streams them, as today.
  for (;;) {
    const m = /\\DeclareOption\*?\s*(?:\{[^}]*\})?\s*\{/.exec(text);
    if (!m) break;
    const blanked = blankGroupAt(text, m.index + m[0].length - 1) ?? text;
    text =
      blanked.slice(0, m.index) +
      " ".repeat(m[0].length) +
      blanked.slice(m.index + m[0].length);
  }

  const out = new Set();
  // A reference carrying TeX syntax is a macro, not a filename — those are the
  // ones a declaration's seeds have to name (see `pgfsys-pdftex.def`).
  const add = (n) => {
    const name = String(n).trim();
    if (name && !/[\\#{}]/.test(name)) out.add(name);
  };

  for (const m of text.matchAll(/\\input\s*\{([^}]+)\}/g)) add(m[1]);
  for (const m of text.matchAll(/\\input\s+([A-Za-z0-9@\-_.]+)/g)) add(m[1]);
  for (const m of text.matchAll(
    /\\(?:RequirePackage|usepackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
  ))
    for (const p of splitList(m[1])) add(`${p}.sty`);
  for (const m of text.matchAll(/\\(?:pgfutil@)?InputIfFileExists\s*\{([^}]+)\}/g)) add(m[1]);
  for (const m of text.matchAll(/\\usepgfmodule\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
    for (const p of splitList(m[1])) add(`pgfmodule${p}.code.tex`);
  for (const m of text.matchAll(/\\usepgflibrary\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
    for (const p of splitList(m[1])) add(`pgflibrary${p}.code.tex`);
  // \usetikzlibrary{X} loads tikzlibraryX and, per tikz.code.tex, ALSO tries
  // pgflibraryX — so both are candidates and a 404 on either is ordinary.
  for (const m of text.matchAll(/\\usetikzlibrary\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))
    for (const p of splitList(m[1])) {
      add(`tikzlibrary${p}.code.tex`);
      add(`pgflibrary${p}.code.tex`);
    }
  return out;
}

/** Only a TeX SOURCE file can reference more files; bytes cannot. */
const isScannable = (fileid) =>
  !fileid.includes(".") || /\.(sty|tex|def|cfg|clo|cls|fd|src)$/.test(fileid);

async function fetchAsset(reqname) {
  const url = `${ENDPOINT}pdftex/${FORMAT_TEX}/${encodeURIComponent(reqname)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, reason: `network: ${err.message}` };
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  const fileid = res.headers.get("fileid") || reqname;
  const bytes = Buffer.from(await res.arrayBuffer());
  return { ok: true, fileid, bytes };
}

async function resolveFamily(name) {
  const family = FAMILIES[name];
  if (!family) fail(`unknown family "${name}". Known: ${Object.keys(FAMILIES).join(", ")}`);

  const found = new Map(); // reqname -> { fileid, bytes }
  const missed = new Map(); // reqname -> reason
  const excluded = new Map(); // reqname -> why
  const queue = family.seeds.map((s) => [s, "(seed)"]);
  const from = new Map();

  while (queue.length) {
    const [reqname, parent] = queue.shift();
    if (found.has(reqname) || missed.has(reqname) || excluded.has(reqname)) continue;
    if (EXCLUDE[reqname]) {
      excluded.set(reqname, EXCLUDE[reqname]);
      continue;
    }
    if (found.size >= MAX_FILES) fail(`closure exceeded ${MAX_FILES} files — check the seeds`);

    const res = await fetchAsset(reqname);
    from.set(reqname, parent);
    if (!res.ok) {
      missed.set(reqname, res.reason);
      continue;
    }
    found.set(reqname, res);
    if (!isScannable(res.fileid)) continue;
    for (const ref of referencesIn(res.bytes.toString("latin1"))) {
      if (!found.has(ref) && !missed.has(ref) && !excluded.has(ref)) queue.push([ref, reqname]);
    }
  }
  return { found, missed, excluded, from };
}

async function vendor(name, { dryRun, claimed }) {
  console.log(`\n=== ${name} — ${FAMILIES[name].description}`);
  const { found, missed, excluded } = await resolveFamily(name);

  const rows = [];
  const bytesByFileid = new Map();
  let total = 0;
  let shared = 0;
  for (const [reqname, { fileid, bytes }] of [...found].sort()) {
    const cacheKey = `${FORMAT_TEX}/${reqname}`;
    // A closure OVERLAPS its predecessors (forest's begins with all of tikz's).
    // The overlap is still fetched — its references are how the graph is walked
    // — but one key has one OWNER, so the first family to declare it keeps it.
    if (claimed.has(cacheKey)) {
      shared++;
      continue;
    }
    claimed.add(cacheKey);
    total += bytes.length;
    // The .fmt ships beside the WASM; a family must never re-copy it.
    if (fileid !== FMT_FILEID) bytesByFileid.set(fileid, bytes);
    rows.push({ cacheKey, fileid, path: publicPathFor(fileid), family: name });
  }

  console.log(
    `  resolved ${found.size} reqname(s); ${shared} shared with an earlier family`,
  );
  console.log(
    `  OWNS ${rows.length} reqname(s) -> ${bytesByFileid.size} file(s), ${fmtBytes(total)}`,
  );
  if (excluded.size)
    console.log(
      `  excluded ${excluded.size}: ` +
        [...excluded].map(([k, why]) => `${k} (${why})`).join(", "),
    );
  if (missed.size)
    console.log(
      `  not on the mirror (fails open — streams at compile time if ever asked): ` +
        [...missed.keys()].sort().join(", "),
    );

  if (dryRun) {
    console.log("  --dry-run: nothing written");
    return;
  }

  for (const [fileid, bytes] of bytesByFileid) {
    await writeFile(join(texbundleDir, fileid), bytes);
  }
  const report = await writeBundle({ family: name, rows });
  console.log(
    `  wrote ${bytesByFileid.size} file(s); manifest now ${report.total} row(s), ${report.paths} precache path(s)`,
  );
  if (report.rejected)
    console.log(`  ${report.rejected} row(s) already owned by another family — left there`);
  if (report.pruned.length)
    console.log(`  pruned ${report.pruned.length} orphaned file(s): ${report.pruned.join(", ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const names = args.filter((a) => !a.startsWith("--"));
  const all = args.includes("--all");
  if (!all && names.length === 0)
    fail(`usage: vendor-tex-family.mjs <family|--all> [--dry-run]\nknown: ${Object.keys(FAMILIES).join(", ")}`);

  // Declaration order is resolution order: a family's rows are whatever its
  // closure adds over the families declared BEFORE it (see `claimed`). Only
  // the LABEL depends on that order — the set of vendored bytes does not.
  const targets = all ? Object.keys(FAMILIES) : names;
  const existing = await readManifestTs();

  // `--all` means "make the bundle match the declaration", so it REBUILDS
  // ownership rather than merging into it: every declared family's rows are
  // cleared first, and so are the rows of any family the declaration no longer
  // names. Two things go wrong without that, and each is only reachable by the
  // maintenance operation this script exists to make easy:
  //
  //   - a family REMOVED from the declaration leaves rows nothing can
  //     regenerate (and bytes nothing prunes), so "trimming a family is one
  //     config edit" would be false; and
  //   - a key cannot be RE-ASSIGNED between families, because writeBundle's
  //     one-key-one-owner rule reads the manifest and would reject the new
  //     owner's rows. Re-order the declaration, or re-add a family another has
  //     since absorbed, and the bundle silently loses that closure.
  //
  // The clearing pass does NOT prune: the bytes are about to be re-resolved,
  // and the last real write prunes whatever the rebuild left behind.
  if (all) {
    const declared = new Set([CORE_FAMILY, ...targets]);
    const present = [...new Set(existing.map((r) => r.family))];
    const stale = present.filter((f) => !declared.has(f));
    for (const family of stale)
      console.log(`\n=== ${family} — no longer declared: its rows will be dropped`);
    if (!dryRun) for (const family of [...stale, ...targets]) await writeBundle({ family, rows: [], prune: false });
  }

  // Read AFTER the clearing pass — `existing` predates it, so seeding `claimed`
  // from it would leave a cleared family's keys claimed and the family that
  // should now own them would skip them as "shared". A dry run clears nothing,
  // so it correctly keeps the pre-clear snapshot.
  const afterClear = dryRun ? existing : await readManifestTs();
  const claimed = new Set(
    afterClear.filter((r) => !targets.includes(r.family)).map((r) => r.cacheKey),
  );
  for (const name of targets) await vendor(name, { dryRun, claimed });

  console.log("");
  console.log("NEXT: bump CACHE_NAME in public/sw.js so a warm service-worker cache");
  console.log("      does not shadow the new texbundle.");
}

// Run only when invoked as a script — `referencesIn` is imported by its
// contract test, and an import that ran `main()` would exit the test process.
const invokedDirectly = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch((err) => fail(err.stack || err.message));
