#!/usr/bin/env node
/**
 * check-coherence — CI guard for Virgil's rooted documentation graph.
 *
 * Validates the *edges* of the dependency graph designed in
 * docs/architecture/VIRGIL.md ("Document discipline") and specified in
 * docs/architecture/check-coherence.SKETCH.md. It is the third leg of the
 * rot-prevention division of labour: `/cleanup-virgil` synchronizes
 * code→docs, *this* validates the graph's edges, the future dream phase
 * ripples docs→skills.
 *
 * Six checks (see the SKETCH for the full design + staging rationale):
 *
 *   1. edges     (error)  every derives-from path#anchor resolves to a file
 *                         + a heading whose GitHub slug matches; every
 *                         covers-code path resolves to a file/dir. Plus the
 *                         union invariant (doc-level ⊇ per-section) as a warn.
 *   2. types     (error)  every exported type in src/lib/types.ts is
 *                         accounted for in VIRGIL.md's Public-type registry
 *                         section (following its delegation link to the full
 *                         enumeration). Graduated to error: Phase 0 filled
 *                         the registry (chip 4).
 *   3. concepts  (warn)   every code-identifier-shaped backtick token in
 *                         VIRGIL.md (CONST_CASE, camelCase, *.ts/*.py names,
 *                         \v… macros) appears somewhere in the codebase.
 *   4. drift     (warn)   for each doc, commits touching its covers-code
 *                         paths newer than its last-verified sha.
 *   5. shadow    (warn)   the Python card/panel vocabulary in editor/scripts/
 *                         (apply_response.PANEL_TO_SIDECAR, create_card.ALL_KINDS)
 *                         reconciles with the TS SSOTs (CardKind, PANEL_REGISTRY,
 *                         the …State shapes).
 *   6. allowlist (error)  the cross-silo _latex-allowlist.md command inventory
 *                         reconciles with the renderer SSOTs (KNOWN_CITE_COMMANDS
 *                         + parseInlineContent). Phantom command in the doc =
 *                         error; renderer command the doc omits = warn.
 *
 * Discovery is self-describing: every *.md whose head carries a
 * `<!-- derives-from: -->` or `<!-- covers-code: -->` comment is a graph
 * node (excluding *.SKETCH.md). No hardcoded doc list.
 *
 *   node tools/check-coherence.mjs [--json] [--strict] [--since <sha>]
 *
 * Exit: 0 = clean (no errors) · 1 = ≥1 error · 2 = internal error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import ts from "typescript";

// Root defaults to the repo this script lives in; COHERENCE_ROOT overrides
// it (used by the smoke tests to point at fixture trees, and available to CI).
const REPO_ROOT = process.env.COHERENCE_ROOT
  ? path.resolve(process.env.COHERENCE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ── CLI ─────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const OPT = { json: false, strict: false, since: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") OPT.json = true;
  else if (a === "--strict") OPT.strict = true;
  else if (a === "--since") OPT.since = argv[++i] ?? null;
  else if (a.startsWith("--since=")) OPT.since = a.slice("--since=".length);
  else internalError(`unknown argument: ${a}`);
}

/* ── findings ────────────────────────────────────────────────────────
 * One in-memory array feeds both the human report and --json so they can
 * never diverge. `--strict` promotes every warn to error at emit time. */

const findings = [];
function add(check, severity, doc, section, detail) {
  if (OPT.strict && severity === "warn") severity = "error";
  findings.push({ check, severity, doc, section: section ?? null, detail });
}
function internalError(msg) {
  // Exit 2: distinct from a content violation so CI can tell "the check
  // broke" from "the docs are wrong".
  if (OPT.json) process.stdout.write(JSON.stringify({ ok: false, internalError: msg }) + "\n");
  else process.stderr.write(`check-coherence: internal error: ${msg}\n`);
  process.exit(2);
}

/* ── repo helpers ────────────────────────────────────────────────── */

function abs(rel) {
  return path.join(REPO_ROOT, rel);
}
function exists(rel) {
  return fs.existsSync(abs(rel));
}
function read(rel) {
  return fs.readFileSync(abs(rel), "utf-8");
}
function git(args) {
  // Returns stdout (trimmed). Throws on non-zero exit — callers that can
  // tolerate failure must wrap.
  return execFileSync("git", ["-C", REPO_ROOT, ...args], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    // Discard git's stderr — callers handle failure via exit code + catch,
    // so "fatal: not a git repository" (fixtures) must not leak to the report.
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/**
 * GitHub heading-slug algorithm: lowercase, drop anything outside
 * [a-z0-9 _-], then spaces→hyphens. (GitHub keeps underscores; the SKETCH's
 * `[a-z0-9 -]` shorthand omits them, but every real anchor here is
 * underscore-free, so this faithful variant is a strict superset.)
 */
function ghSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

/* ── structural doc parser ───────────────────────────────────────────
 *
 * Header fields are recognized only in the two sanctioned positions, never
 * by loose grep (the SKETCH's lesson — a repo-wide grep matches the
 * convention's own prose examples + fenced samples and invents phantom
 * paths):
 *   (a) the top-of-file header block — the leading run of <!--…--> comment
 *       lines before the first heading;
 *   (b) the run of comment lines *immediately* under a `##`/`###`(+) heading.
 * Fenced code blocks (``` / ~~~) are skipped entirely, so the format
 * examples inside them are never read as headers.
 */
function parseDoc(rel) {
  const lines = read(rel).split("\n");
  const doc = {
    rel,
    lastVerified: null, // short sha
    derivesFrom: [], // [{ path, anchor }]
    coversCode: [], // doc-level paths
    sections: [], // [{ title, slug, level, coversCode:[], stub:bool, line }]
    headingSlugs: new Set(),
  };

  const COMMENT = /^\s*<!--\s*(.*?)\s*-->\s*$/;
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const FENCE = /^\s*(```|~~~)/;

  let inFence = false;
  let i = 0;

  // (a) top-of-file header block: leading comments/blanks before 1st heading.
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) break;
    if (HEADING.test(line)) break;
    const m = COMMENT.exec(line);
    if (m) {
      ingestHeaderComment(doc, m[1], /*section*/ null);
      continue;
    }
    if (line.trim() === "") continue;
    break; // first prose line ends the header block
  }

  // (b) body walk: headings + their immediately-following comment runs.
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const h = HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim();
      const slug = ghSlug(title);
      doc.headingSlugs.add(slug);
      const section = { title, slug, level, coversCode: [], stub: false, line: i + 1 };
      doc.sections.push(section);
      // Collect the run of comment lines directly under this heading.
      let j = i + 1;
      for (; j < lines.length; j++) {
        const c = COMMENT.exec(lines[j]);
        if (!c) break; // first non-comment line ends the run (incl. blank)
        ingestHeaderComment(doc, c[1], section);
      }
      i = j - 1;
      continue;
    }
  }
  return doc;
}

function ingestHeaderComment(doc, body, section) {
  let m;
  if ((m = /^last-verified:\s*(\S+)/.exec(body))) {
    if (!section) doc.lastVerified = m[1];
  } else if ((m = /^derives-from:\s*(.+)$/.exec(body))) {
    if (!section) doc.derivesFrom = parseDerivesFrom(m[1]);
  } else if ((m = /^covers-code:\s*(.+)$/.exec(body))) {
    const paths = splitPaths(m[1]);
    if (section) section.coversCode = paths;
    else doc.coversCode = paths;
  } else if (/^STUB\b/.test(body)) {
    if (section) section.stub = true;
  }
}

function parseDerivesFrom(spec) {
  // The root sentinel carries no edge.
  if (/\(root\b/.test(spec)) return [];
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((tok) => {
      const hash = tok.indexOf("#");
      return hash === -1
        ? { path: tok, anchor: null }
        : { path: tok.slice(0, hash).trim(), anchor: tok.slice(hash + 1).trim() };
    });
}

function splitPaths(spec) {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does the doc-level path set `cover` path `p` (equal or ancestor dir)? */
function pathCoveredBy(p, coverSet) {
  if (coverSet.has(p)) return true;
  for (const c of coverSet) {
    if (p === c) return true;
    if (p.startsWith(c.endsWith("/") ? c : c + "/")) return true;
  }
  return false;
}

/* ── discovery ───────────────────────────────────────────────────────
 * Every tracked *.md whose head carries a derives-from/covers-code comment
 * is a graph node. *.SKETCH.md design docs are excluded (they describe
 * future tooling, not current code). */
function discoverDocs() {
  let rels;
  try {
    const listing = git(["ls-files", "*.md", "**/*.md"]);
    rels = [...new Set(listing.split("\n").map((s) => s.trim()).filter(Boolean))];
  } catch {
    // Not a git repo (e.g. a smoke-test fixture tree) — walk the filesystem.
    rels = walkMarkdown(REPO_ROOT);
  }
  const docs = [];
  for (const rel of rels) {
    if (rel.endsWith(".SKETCH.md")) continue;
    // Peek the head: does the leading comment block carry an edge field?
    let head;
    try {
      head = read(rel);
    } catch {
      continue;
    }
    if (!headHasEdgeField(head)) continue;
    docs.push(rel);
  }
  return docs.sort();
}

const WALK_SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out"]);
function walkMarkdown(rootAbs, relPrefix = "") {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(rootAbs, relPrefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (WALK_SKIP.has(e.name)) continue;
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkMarkdown(rootAbs, rel));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

function headHasEdgeField(text) {
  const lines = text.split("\n");
  for (const line of lines) {
    if (/^\s*```|^\s*~~~/.test(line)) break;
    if (/^#{1,6}\s/.test(line)) break;
    const m = /^\s*<!--\s*(.*?)\s*-->\s*$/.exec(line);
    if (m) {
      if (/^(derives-from|covers-code):/.test(m[1])) return true;
      continue;
    }
    if (line.trim() === "") continue;
    break;
  }
  return false;
}

/* ── TypeScript surface (shared by checks 2 & 5) ─────────────────────── */

function tsSource(rel) {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, /*setParentNodes*/ true);
}

/** Exported interface/type-alias/enum names of a .ts file. */
function exportedTypeNames(rel) {
  const sf = tsSource(rel);
  const names = new Set();
  sf.forEachChild((node) => {
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      const exported = (node.modifiers ?? []).some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (exported && node.name) names.add(node.name.text);
    }
  });
  return names;
}

/** String-literal members of an exported `type X = "a" | "b" | …` union. */
function stringUnionMembers(rel, typeName) {
  if (!exists(rel)) return null;
  const sf = tsSource(rel);
  let members = null;
  sf.forEachChild((node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName) {
      members = new Set();
      const collect = (t) => {
        if (ts.isUnionTypeNode(t)) t.types.forEach(collect);
        else if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
          members.add(t.literal.text);
      };
      collect(node.type);
    }
  });
  return members; // null if not found
}

/** Array-typed property names of an exported interface. */
function interfaceArrayFields(rel, ifaceName) {
  if (!exists(rel)) return null;
  const sf = tsSource(rel);
  let fields = null;
  sf.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === ifaceName) {
      fields = new Set();
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) || !member.type) continue;
        const name = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
        if (!name) continue;
        const isArray =
          ts.isArrayTypeNode(member.type) ||
          (ts.isTypeReferenceNode(member.type) &&
            ts.isIdentifier(member.type.typeName) &&
            (member.type.typeName.text === "Array" ||
              member.type.typeName.text === "ReadonlyArray"));
        if (isArray) fields.add(name);
      }
    }
  });
  return fields; // null if iface not found
}

/* ── markdown section extraction (for check 2) ───────────────────────── */

/** Body text of the section whose heading slug === `slug`, fences stripped. */
function sectionBody(rel, slug) {
  const lines = read(rel).split("\n");
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const FENCE = /^\s*(```|~~~)/;
  let inFence = false;
  let startLevel = null;
  const out = [];
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    const h = !inFence && HEADING.exec(line);
    if (h) {
      const level = h[1].length;
      if (startLevel === null) {
        if (ghSlug(h[2].trim()) === slug) startLevel = level;
        continue;
      }
      if (level <= startLevel) break; // next sibling/parent heading ends it
      continue;
    }
    if (startLevel !== null && !inFence) out.push(line);
  }
  return startLevel === null ? null : out.join("\n");
}

const PASCAL = /^[A-Z][A-Za-z0-9]+$/;
function backtickTokens(text) {
  const set = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return set;
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 1 — edges resolve (+ union invariant)
 * ════════════════════════════════════════════════════════════════════ */
function checkEdges(docs) {
  for (const doc of docs) {
    // derives-from: path exists + anchor matches a heading slug.
    for (const { path: p, anchor } of doc.derivesFrom) {
      if (!exists(p)) {
        add("edges", "error", doc.rel, null, `derives-from path '${p}' does not exist`);
        continue;
      }
      if (anchor) {
        const target = parseDocLite(p);
        if (!target.headingSlugs.has(anchor)) {
          add(
            "edges",
            "error",
            doc.rel,
            null,
            `derives-from anchor '#${anchor}' not found in ${p}`,
          );
        }
      }
    }
    // covers-code (doc-level): each path resolves.
    for (const p of doc.coversCode) {
      if (!exists(p))
        add("edges", "error", doc.rel, null, `covers-code path '${p}' does not exist`);
    }
    // covers-code (per-section): each path resolves + union invariant.
    const docLevel = new Set(doc.coversCode);
    const uncovered = [];
    for (const section of doc.sections) {
      for (const p of section.coversCode) {
        if (!exists(p))
          add(
            "edges",
            "error",
            doc.rel,
            section.title,
            `covers-code path '${p}' does not exist`,
          );
        else if (docLevel.size && !pathCoveredBy(p, docLevel) && !uncovered.includes(p))
          uncovered.push(p);
      }
    }
    // One compact warn per doc rather than N (keeps the report readable).
    if (uncovered.length) {
      add(
        "edges",
        "warn",
        doc.rel,
        null,
        `doc-level covers-code is not a superset of ${uncovered.length} per-section path(s): ${uncovered.join(", ")}`,
      );
    }
  }
}

// Lightweight parse cache for anchor-target docs (which may not be graph nodes).
const _liteCache = new Map();
function parseDocLite(rel) {
  if (_liteCache.has(rel)) return _liteCache.get(rel);
  const lines = read(rel).split("\n");
  const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const FENCE = /^\s*(```|~~~)/;
  let inFence = false;
  const headingSlugs = new Set();
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const h = HEADING.exec(line);
    if (h) headingSlugs.add(ghSlug(h[2].trim()));
  }
  const out = { headingSlugs };
  _liteCache.set(rel, out);
  return out;
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 2 — type accounting
 * ════════════════════════════════════════════════════════════════════ */
const TYPES_TS = "src/lib/types.ts";
const REGISTRY_DOC = "docs/architecture/VIRGIL.md";
const REGISTRY_SLUG = "public-type-registry";

function checkTypes() {
  if (!exists(TYPES_TS)) {
    add("types", "warn", TYPES_TS, null, "types SSOT not found — skipping type accounting");
    return;
  }
  const exported = exportedTypeNames(TYPES_TS);
  const body = sectionBody(REGISTRY_DOC, REGISTRY_SLUG);
  if (body === null) {
    add("types", "warn", REGISTRY_DOC, "Public-type registry", "registry section not found — types unaccounted (warn-only)");
    return;
  }
  // Accounted = backtick PascalCase tokens in the registry section ∪ those
  // in every local .md#section it delegates the enumeration to.
  const accounted = new Set([...backtickTokens(body)].filter((t) => PASCAL.test(t)));
  for (const link of markdownLinks(body)) {
    const tgt = resolveDocLink(REGISTRY_DOC, link);
    if (!tgt) continue;
    const delegated = sectionBody(tgt.rel, tgt.slug);
    if (delegated === null) continue;
    for (const t of backtickTokens(delegated)) if (PASCAL.test(t)) accounted.add(t);
  }
  const unaccounted = [...exported].filter((t) => !accounted.has(t)).sort();
  const n = exported.size;
  if (unaccounted.length === 0) {
    return; // 58/58 — silent pass
  }
  // Registry filled (Phase 0) → per-type error, per the SKETCH graduation.
  for (const t of unaccounted) {
    add(
      "types",
      "error",
      REGISTRY_DOC,
      "Public-type registry",
      `exported type '${t}' (src/lib/types.ts) is unaccounted (${unaccounted.length}/${n} unaccounted)`,
    );
  }
}

function markdownLinks(text) {
  const out = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1].trim());
  return out;
}
function resolveDocLink(fromRel, link) {
  // Only follow local `<relpath>.md#<anchor>` links.
  const hash = link.indexOf("#");
  if (hash === -1) return null;
  const rel = link.slice(0, hash);
  const anchor = link.slice(hash + 1);
  if (!rel.endsWith(".md")) return null;
  const resolved = path.normalize(path.join(path.dirname(fromRel), rel));
  if (!exists(resolved)) return null;
  return { rel: resolved, slug: anchor };
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 3 — concept → code (advisory)
 * ════════════════════════════════════════════════════════════════════ */
function checkConcepts() {
  if (!exists(REGISTRY_DOC)) return;
  const body = read(REGISTRY_DOC);
  // Strip fenced code so format examples don't seed phantom symbols.
  const prose = stripFences(body);
  const tokens = backtickTokens(prose);

  const macros = new Set();
  const consts = new Set();
  const idents = new Set();
  const files = new Set();

  for (const raw of tokens) {
    const t = raw.trim();
    let mm;
    if ((mm = /^\\(v[A-Za-z]+)/.exec(t))) macros.add("\\" + mm[1]);
    // Source-file names only (the SKETCH scopes check 3 to "*.py/*.ts
    // filenames"). Runtime data sidecars (*.json/*.css) are string-
    // referenced artifacts, not code identifiers — out of scope.
    else if (/^[\w./-]+\.(ts|tsx|mjs|py)$/.test(t) && !t.includes(" ")) files.add(t);
    else if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t)) consts.add(t); // CONST_CASE
    else if (/^[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*$/.test(t)) idents.add(t); // camelCase
  }

  const report = (token, scopes, label) => {
    if (!repoHasToken(token, scopes)) {
      add("concepts", "warn", REGISTRY_DOC, null, `${label} '${token}' not found in the codebase`);
    }
  };
  for (const m of [...macros].sort()) report(m, ["src/lib"], "macro");
  for (const c of [...consts].sort()) report(c, ["src", "library", "editor"], "constant");
  for (const id of [...idents].sort()) report(id, ["src", "library", "editor"], "identifier");
  for (const f of [...files].sort()) {
    if (!fileBasenameExists(f))
      add("concepts", "warn", REGISTRY_DOC, null, `file '${f}' not found in the codebase`);
  }
}

function stripFences(text) {
  const lines = text.split("\n");
  let inFence = false;
  const out = [];
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

function repoHasToken(token, scopes) {
  const dirs = scopes.filter((d) => exists(d));
  if (dirs.length === 0) return false;
  try {
    git(["grep", "-l", "--fixed-strings", "-e", token, "--", ...dirs]);
    return true;
  } catch {
    return false; // git grep exits 1 when nothing matches
  }
}
function fileBasenameExists(name) {
  const base = name.split("/").pop();
  try {
    const out = git(["ls-files", `*${base}`]);
    return out.split("\n").some((l) => l.trim().endsWith("/" + base) || l.trim() === base);
  } catch {
    return false;
  }
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 4 — drift candidates
 * ════════════════════════════════════════════════════════════════════ */
function checkDrift(docs) {
  for (const doc of docs) {
    if (!doc.lastVerified && !OPT.since) {
      add("drift", "warn", doc.rel, null, "no last-verified stamp — cannot drift-check");
      continue;
    }
    const baseline = OPT.since ?? doc.lastVerified;
    // Multi-section docs: report per-section using the section's own
    // covers-code so the punch-list says *which* section drifted. Skip stub
    // sections (their freshness claim is void). Fall back to the doc-level
    // covers-code for single-topic docs.
    const sectioned = doc.sections.filter((s) => s.coversCode.length && !s.stub);
    if (sectioned.length) {
      for (const s of sectioned) {
        const n = countCommits(baseline, s.coversCode, doc.rel);
        if (n > 0)
          add("drift", "warn", doc.rel, s.title, `${n} commit(s) touch covers-code since ${baseline}`);
      }
    } else if (doc.coversCode.length) {
      const n = countCommits(baseline, doc.coversCode, doc.rel);
      if (n > 0)
        add("drift", "warn", doc.rel, null, `${n} commit(s) touch covers-code since ${baseline}`);
    }
  }
}

function countCommits(baseline, paths, docRel) {
  const existing = paths.filter((p) => exists(p));
  if (!existing.length) return 0;
  let out;
  try {
    out = git(["log", "--oneline", `${baseline}..HEAD`, "--", ...existing]);
  } catch (e) {
    add(
      "drift",
      "warn",
      docRel,
      null,
      `could not compute drift from '${baseline}' (sha unknown to git?) — ${String(e.message).split("\n")[0]}`,
    );
    return 0;
  }
  return out.split("\n").filter((l) => l.trim()).length;
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 5 — Python shadow ↔ TS registry
 * ════════════════════════════════════════════════════════════════════ */
const APPLY_PY = "editor/scripts/apply_response.py";
const CREATE_PY = "editor/scripts/create_card.py";
const CARDKIND_TS = "src/panels/_shared/types.ts";
const PANELREG_TS = "src/panels/panel-registry.ts";

// AiRequestLink.panel → PanelKind alias gap (the panel value "todos" vs the
// PanelKind "todo"; see docs/workspace/sidecars.md → the Task store).
const PANEL_ALIAS = { todos: "todo" };

// Card-hosting panels intentionally NOT apply_response writeback targets.
// "Hosts a card" (PANEL_REGISTRY) over-approximates "is a skill-writeback
// target", so these four are correctly absent from PANEL_TO_SIDECAR — absence
// is by design, not a forgotten wiring. Rationale (mirrored in
// docs/architecture/check-coherence.SKETCH.md → Check 5):
//   archive       — snippets are user-cut text; no skill mechanically authors them.
//   bibliography  — backed by the .bib file, not a virgil/ sidecar (find-citation
//                   + the bib skills own it), so it has no PANEL_TO_SIDECAR row.
//   errors        — not persisted; re-derived from the LaTeX lint each pass.
//   examples      — examples.json is an app-derived SHADOW of the .tex
//                   (useExamples.syncFromEditor); create-card writes the .tex
//                   \vexid…\ex…\xe block, not the sidecar (create_card.py
//                   _create_example), so examples is correctly absent.
const WRITEBACK_EXEMPT_PANELS = new Set(["archive", "bibliography", "errors", "examples"]);

function checkShadow() {
  // ── TS SSOTs ──
  const cardKinds = stringUnionMembers(CARDKIND_TS, "CardKind");
  if (!cardKinds) {
    add("shadow", "warn", CARDKIND_TS, null, "could not parse CardKind union — skipping ALL_KINDS check");
  }
  const panelRegistry = parsePanelRegistry(); // { panel: { hostsCard: bool } } | null

  // ── ALL_KINDS ⊆ CardKind ──
  const allKinds = parsePySet(CREATE_PY, "ALL_KINDS");
  if (allKinds && cardKinds) {
    for (const k of [...allKinds].sort()) {
      if (!cardKinds.has(k))
        // Error (graduated): the create-card fan-out reconciled ALL_KINDS to the
        // kinds it actually implements, so a member outside CardKind is now a
        // hard re-drift, not an advisory. (Sketch Check 5 staging.)
        add(
          "shadow",
          "error",
          CREATE_PY,
          null,
          `ALL_KINDS member '${k}' is not a real CardKind (removed/never-real) — src/panels/_shared/types.ts`,
        );
    }
  } else if (!allKinds) {
    add("shadow", "warn", CREATE_PY, null, "could not parse ALL_KINDS set");
  }

  // ── PANEL_TO_SIDECAR ──
  const panelMap = parsePanelToSidecar(APPLY_PY); // [{ panel, filename, listKey }] | null
  if (!panelMap) {
    add("shadow", "warn", APPLY_PY, null, "could not parse PANEL_TO_SIDECAR");
    return;
  }
  const mapped = new Set();
  for (const { panel, filename, listKey } of panelMap) {
    const pk = PANEL_ALIAS[panel] ?? panel;
    mapped.add(pk);
    // (2) key resolves to a card-hosting panel.
    if (panelRegistry) {
      const entry = panelRegistry[pk];
      if (!entry)
        add("shadow", "warn", APPLY_PY, null, `PANEL_TO_SIDECAR key '${panel}' is not a PANEL_REGISTRY panel`);
      else if (!entry.hostsCard)
        add("shadow", "warn", APPLY_PY, null, `PANEL_TO_SIDECAR key '${panel}' maps to a panel that hosts no card`);
    }
    // (3a) list-key is a real array field on the panel's …State interface.
    const stateName = pascal(pk) + "State";
    const fields = interfaceArrayFields(TYPES_TS, stateName);
    if (fields === null) {
      add("shadow", "warn", APPLY_PY, null, `${stateName} not found in ${TYPES_TS} — cannot verify '${panel}' list-key (heuristic)`);
    } else if (!fields.has(listKey)) {
      add(
        "shadow",
        "warn",
        APPLY_PY,
        null,
        `PANEL_TO_SIDECAR['${panel}'] list-key '${listKey}' is not an array field on ${stateName} {${[...fields].join(", ")}}`,
      );
    }
    // (3b) filename referenced somewhere under src/hooks (light form).
    if (!repoHasToken(filename, ["src/hooks"]))
      add("shadow", "warn", APPLY_PY, null, `PANEL_TO_SIDECAR['${panel}'] file '${filename}' not referenced under src/hooks (heuristic)`);
  }
  // (2 inverse) card panels absent from PANEL_TO_SIDECAR. Only a panel absent
  // AND not on the writeback-exempt allowlist is a real finding (a new card
  // writeback target the shadow forgot — the inverse of the quotations→reports
  // slip). The allowlist itself is kept honest: an exempt panel that is no
  // longer absent (now mapped, or not a card panel) is flagged as stale.
  if (panelRegistry) {
    const missing = Object.entries(panelRegistry)
      .filter(([pk, e]) => e.hostsCard && !mapped.has(pk))
      .map(([pk]) => pk);
    const unexpected = missing.filter((pk) => !WRITEBACK_EXEMPT_PANELS.has(pk)).sort();
    if (unexpected.length)
      add(
        "shadow",
        "warn",
        APPLY_PY,
        null,
        `card-hosting panel(s) absent from PANEL_TO_SIDECAR and not on the writeback-exempt allowlist: ${unexpected.join(", ")}`,
      );
    const staleExempt = [...WRITEBACK_EXEMPT_PANELS].filter((pk) => !missing.includes(pk)).sort();
    if (staleExempt.length)
      add(
        "shadow",
        "warn",
        APPLY_PY,
        null,
        `writeback-exempt allowlist is stale (no longer a card-hosting panel absent from PANEL_TO_SIDECAR): ${staleExempt.join(", ")}`,
      );
  }
}

function pascal(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ════════════════════════════════════════════════════════════════════
 *  CHECK 6 — allowable-LaTeX inventory ↔ renderer SSOT
 *
 *  The cross-silo `_latex-allowlist.md` doctrine (editor + library) carries a
 *  machine-checked ```latex-allowlist``` inventory of the commands Virgil's
 *  renderer handles. This check keeps that inventory honest against the two
 *  renderer SSOTs — `KNOWN_CITE_COMMANDS` (src/lib/cite-commands.ts) and the
 *  `parseInlineContent` inline cases (src/lib/latex-parser.ts). Asymmetry
 *  (task 2026-07-03-029, decision 2): the doc listing a phantom command the
 *  renderer can't handle is a hard ERROR; the renderer gaining a command the
 *  doc omits is a WARN (the doc is a deliberately narrower curated subset).
 *  `/cleanup-virgil` runs this check.
 * ════════════════════════════════════════════════════════════════════ */
const ALLOWLIST_EDITOR = "editor/skills/_latex-allowlist.md";
const ALLOWLIST_LIBRARY = "library/skills/_latex-allowlist.md";
const CITE_TS = "src/lib/cite-commands.ts";
const PARSER_TS = "src/lib/latex-parser.ts";

// Serializer-internal UUID markers — emitted by latex-serializer.ts, not
// author vocabulary, so they are excluded from the allowlist inventory.
const ALLOWLIST_INTERNAL_MARKERS = new Set(["vfid", "vcid", "vlid", "vlidend"]);
// Escape-special commands the parser handles (the escMatch branch) that the
// alternation extractor below can't fully see — it stops at the first source
// `{`, so it captures only `textbackslash`. Add the other two explicitly.
const ALLOWLIST_ESCAPE_SPECIALS = new Set(["textasciitilde", "textasciicircum"]);
// `\verb<delim>…<delim>` / `\verb*` — inline verbatim, genuinely rendered
// (latex-parser.ts handles it via the delimiter-based verbatim branch →
// `verbatimMark()`, task 264), but NOT as a `/^\\cmd\{/` literal inside
// parseInlineContent, so the extractor above can't see it. Add explicitly.
const ALLOWLIST_VERBATIM_HANDLED = new Set(["verb"]);

/** Parse `KNOWN_CITE_COMMANDS = [ "cite", … ] as const` from cite-commands.ts. */
function knownCiteCommands() {
  if (!exists(CITE_TS)) return null;
  const m = /KNOWN_CITE_COMMANDS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(read(CITE_TS));
  if (!m) return null;
  const out = new Set();
  for (const sm of m[1].matchAll(/["']([A-Za-z]+)["']/g)) out.add(sm[1]);
  return out;
}

/** Extract the inline command names `parseInlineContent()` matches, from the
 *  parser source. Scoped to the function body so block-level commands don't
 *  leak in. Handles both `/^\\cmd\{/` literals and `/^\\(a|b|c)…/`
 *  alternations; the `\v*id` markers are filtered out. */
function parserInlineCommands() {
  if (!exists(PARSER_TS)) return null;
  const src = read(PARSER_TS);
  const start = src.indexOf("export function parseInlineContent");
  if (start === -1) return null;
  const end = src.indexOf("\nfunction extractBraced", start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const out = new Set();
  // In the .ts source a regex `/^\\textbf\{/` is the chars `^ \ \ t e x t …`,
  // so match `^` + two literal backslashes + an optional `(` + the command
  // name / alternation group.
  for (const m of body.matchAll(/\^\\\\(?:\()?([A-Za-z|]+)/g)) {
    for (const name of m[1].split("|")) {
      if (name && !ALLOWLIST_INTERNAL_MARKERS.has(name)) out.add(name);
    }
  }
  for (const e of ALLOWLIST_ESCAPE_SPECIALS) out.add(e);
  for (const e of ALLOWLIST_VERBATIM_HANDLED) out.add(e);
  return out;
}

/** Extract the `\command` tokens from the doc's machine-checked
 *  ```latex-allowlist``` inventory block. */
function allowlistInventory(md) {
  const m = /```latex-allowlist\n([\s\S]*?)```/.exec(md);
  if (!m) return null;
  const out = new Set();
  for (const sm of m[1].matchAll(/\\([A-Za-z]+)/g)) out.add(sm[1]);
  return out;
}

function checkAllowlist() {
  if (!exists(ALLOWLIST_EDITOR)) {
    add("allowlist", "warn", ALLOWLIST_EDITOR, null, "allowable-LaTeX doctrine missing — skipping drift check");
    return;
  }
  const md = read(ALLOWLIST_EDITOR);

  // Silo parity (byte-identical copies). The vitest drift-guard is the
  // authoritative check; this is a cheap early signal for /cleanup-virgil.
  if (exists(ALLOWLIST_LIBRARY) && read(ALLOWLIST_LIBRARY) !== md) {
    add("allowlist", "error", ALLOWLIST_LIBRARY, null,
      `${ALLOWLIST_LIBRARY} differs from ${ALLOWLIST_EDITOR} — the two silo copies must be byte-identical`);
  }

  const inv = allowlistInventory(md);
  if (!inv) {
    add("allowlist", "warn", ALLOWLIST_EDITOR, null, "no ```latex-allowlist inventory block found — cannot check drift");
    return;
  }
  const cites = knownCiteCommands();
  const inline = parserInlineCommands();
  if (!cites) add("allowlist", "warn", CITE_TS, null, "could not parse KNOWN_CITE_COMMANDS");
  if (!inline) add("allowlist", "warn", PARSER_TS, null, "could not parse parseInlineContent inline commands");
  const rendered = new Set([...(cites || []), ...(inline || [])]);
  if (rendered.size === 0) return; // both SSOTs unparseable — warned above.

  // (a) phantom — inventory lists a command the renderer does not handle → ERROR.
  for (const cmd of [...inv].sort()) {
    if (!rendered.has(cmd))
      add("allowlist", "error", ALLOWLIST_EDITOR, null,
        `inventory lists \\${cmd} which the renderer does not handle (phantom) — absent from KNOWN_CITE_COMMANDS (${CITE_TS}) and parseInlineContent (${PARSER_TS})`);
  }
  // (b) omission — renderer gained a command the inventory lost → WARN (the
  // inventory is a deliberately narrower curated subset, so this is advisory).
  for (const cmd of [...rendered].sort()) {
    if (!inv.has(cmd))
      add("allowlist", "warn", ALLOWLIST_EDITOR, null,
        `renderer handles \\${cmd} but the inventory omits it — add it or confirm the curated-subset omission`);
  }
}

/** Parse a flat Python set literal `NAME = { "a", "b", … }`. */
function parsePySet(rel, name) {
  if (!exists(rel)) return null;
  const src = read(rel);
  const re = new RegExp(String.raw`${name}\s*=\s*\{([\s\S]*?)\}`, "m");
  const m = re.exec(src);
  if (!m) return null;
  const out = new Set();
  for (const sm of m[1].matchAll(/["']([^"']+)["']/g)) out.add(sm[1]);
  return out;
}

/** Parse `PANEL_TO_SIDECAR = { "p": ("f.json", "key"), … }`. */
function parsePanelToSidecar(rel) {
  if (!exists(rel)) return null;
  const src = read(rel);
  const m = /PANEL_TO_SIDECAR\s*=\s*\{([\s\S]*?)\n\}/m.exec(src);
  if (!m) return null;
  const out = [];
  const re = /["']([^"']+)["']\s*:\s*\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g;
  let e;
  while ((e = re.exec(m[1]))) out.push({ panel: e[1], filename: e[2], listKey: e[3] });
  return out.length ? out : null;
}

/**
 * Parse PANEL_REGISTRY keys + whether each hosts a card. An entry hosts a
 * card if `card:` is a `{ … }` object, or it's polymorphic (`card: null`
 * but listed in POLYMORPHIC_CARD_PANEL).
 */
function parsePanelRegistry() {
  if (!exists(PANELREG_TS)) return null;
  const sf = tsSource(PANELREG_TS);
  const out = {};
  let polymorphic = new Set();

  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      if (decl.name.text === "PANEL_REGISTRY" && ts.isObjectLiteralExpression(decl.initializer)) {
        for (const prop of decl.initializer.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const key = propKey(prop);
          if (!key) continue;
          let hostsCard = false;
          if (ts.isObjectLiteralExpression(prop.initializer)) {
            for (const inner of prop.initializer.properties) {
              if (
                ts.isPropertyAssignment(inner) &&
                propKey(inner) === "card" &&
                ts.isObjectLiteralExpression(inner.initializer)
              )
                hostsCard = true;
            }
          }
          out[key] = { hostsCard };
        }
      }
      if (decl.name.text === "POLYMORPHIC_CARD_PANEL" && ts.isObjectLiteralExpression(decl.initializer)) {
        for (const prop of decl.initializer.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isStringLiteralLike(prop.initializer))
            polymorphic.add(prop.initializer.text);
        }
      }
    }
  });
  // Mark polymorphic host panels as card-hosting.
  for (const panel of polymorphic) if (out[panel]) out[panel].hostsCard = true;
  return Object.keys(out).length ? out : null;
}

function propKey(prop) {
  const n = prop.name;
  if (!n) return null;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isStringLiteralLike(n)) return n.text;
  return null;
}

/* ════════════════════════════════════════════════════════════════════
 *  run + report
 * ════════════════════════════════════════════════════════════════════ */
function main() {
  const docRels = discoverDocs();
  const docs = docRels.map(parseDoc);

  runCheck("edges", () => checkEdges(docs));
  runCheck("types", () => checkTypes());
  runCheck("concepts", () => checkConcepts());
  runCheck("drift", () => checkDrift(docs));
  runCheck("shadow", () => checkShadow());
  runCheck("allowlist", () => checkAllowlist());

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warn").length;
  const summary = { errors, warnings, docsScanned: docs.length };

  if (OPT.json) {
    process.stdout.write(JSON.stringify({ ok: errors === 0, summary, findings }, null, 2) + "\n");
  } else {
    renderHuman(docs, summary);
  }
  process.exit(errors > 0 ? 1 : 0);
}

function runCheck(name, fn) {
  try {
    fn();
  } catch (e) {
    // A check that throws on unexpected input degrades to a single warning
    // instead of aborting the run (exit 2) — the other checks still run.
    add(name, "warn", null, null, `check did not complete: ${String(e && e.message).split("\n")[0]}`);
  }
}

const CHECK_ORDER = ["edges", "types", "concepts", "drift", "shadow", "allowlist"];
const CHECK_LABEL = {
  edges: "1 · edges resolve",
  types: "2 · type accounting",
  concepts: "3 · concept → code",
  drift: "4 · drift candidates",
  shadow: "5 · python shadow ↔ ts",
  allowlist: "6 · allowlist ↔ renderer",
};
const GLYPH = { error: "✗", warn: "⚠" };

function renderHuman(docs, summary) {
  const out = [];
  out.push(`check-coherence — ${summary.docsScanned} graph node(s) scanned${OPT.strict ? " (--strict)" : ""}`);
  out.push("");
  for (const check of CHECK_ORDER) {
    const group = findings.filter((f) => f.check === check);
    if (group.length === 0) {
      out.push(`✓ ${CHECK_LABEL[check]} — clean`);
      continue;
    }
    out.push(`${CHECK_LABEL[check]}`);
    for (const f of group) {
      const where = f.section ? `${f.doc} › ${f.section}` : f.doc;
      out.push(`  ${GLYPH[f.severity]} ${where}`);
      out.push(`      ${f.detail}`);
    }
  }
  out.push("");
  out.push(
    `summary: ${summary.errors} error(s), ${summary.warnings} warning(s) across ${summary.docsScanned} doc(s)`,
  );
  const sink = summary.errors > 0 ? process.stderr : process.stdout;
  sink.write(out.join("\n") + "\n");
}

// Run only when executed directly (importing for tests must not auto-run).
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    internalError(e && e.stack ? e.stack : String(e));
  }
}
