import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedFiles } from "../lib/__tests__/_source-scan";

/**
 * THE GUIDE ENVELOPE (task 2026-09-15-588, floor + alias half 2026-09-19-649).
 *
 * `CLAUDE.md` is `@AGENTS.md`, and Claude Code loads it into EVERY session —
 * every worker, auditor, catcher, release run and non-Explore subagent. The
 * file's own header promised it was a lean index with doctrine loaded on
 * demand; an emergent convention (each task appending its "The X half" note)
 * grew it from 12 KB to 1.24 MB in three months. Every session then started at
 * ~530k tokens, and a worker whose Read of a worktree file nested-loaded a
 * SECOND copy hit the 1M window and died in "Autocompact is thrashing".
 *
 * A convention with no guard is how it got there, so the budget is pinned:
 *   1. `AGENTS.md` stays under the budget (Claude Code's own large-file line).
 *   2. Every tracked `CLAUDE.md`, WITH everything it `@`-imports, does too —
 *      a nested CLAUDE.md is loaded whenever a session reads under its folder.
 *   3. The Laws index and `docs/agents/laws/` agree both ways: an indexed doc
 *      exists, and every law doc is indexed (a doc nobody can find is lost
 *      doctrine; an index entry with no doc is a dead pointer).
 * Doctrine goes in its law's doc. AGENTS.md changes only to index a new law.
 *
 * A CEILING CANNOT NOTICE A GUIDE BEING DESTROYED. The commit that installed
 * this guard also destroyed `library/AGENTS.md` — 93 KB of Library doctrine
 * down to a 560-byte stub pointing at itself — and CI stayed green for four
 * days, because every budget assertion is MORE satisfied by a file that is
 * gone. Two halves close that:
 *   4. Every guide file sits inside a declared `{ min, max }` ENVELOPE. A
 *      pointer declares a small max so it cannot grow back into a copy; a
 *      substantial guide declares a real min so it cannot collapse. The table
 *      is TOTAL over tracked `AGENTS.md`/`CLAUDE.md` — a new guide with no row
 *      fails, so the census cannot silently stop covering the tree.
 *   5. No guide is a SYMLINK, and no two guides share an inode. That is what
 *      actually destroyed the file: `library/CLAUDE.md` was a symlink to
 *      `library/AGENTS.md`, so writing the intended pointer text to the one
 *      overwrote the other, leaving the symlink blob byte-identical in the
 *      diff. Two names for one inode make a write to either a write to both,
 *      and no size check can ever see it coming.
 */

const BUDGET_BYTES = 40_000;
const LAWS_DIR = "docs/agents/laws";

/** A law doc that has collapsed to a stub is lost doctrine, same as a guide. */
const LAW_MIN_BYTES = 1_000;

/** A guide file and the size band it is allowed to live in. */
export interface GuideRow {
  path: string;
  /** Floor: below this the file has COLLAPSED (destroyed, truncated, stubbed). */
  min: number;
  /** Ceiling, or `null` where the file is never auto-loaded so size is free. */
  max: number | null;
  why: string;
}

/**
 * Every tracked `AGENTS.md` / `CLAUDE.md`. Totality is asserted below, so a
 * new guide file must land with a row stating what it is.
 */
const GUIDES: GuideRow[] = [
  {
    path: "AGENTS.md",
    min: 8_000,
    max: BUDGET_BYTES,
    why: "the always-loaded index: intro, codebase guide, glossary, Style, sample paper, Laws index",
  },
  {
    path: "CLAUDE.md",
    min: 5,
    max: 200,
    why: "one line, `@AGENTS.md` — the import that makes AGENTS.md the always-loaded file",
  },
  {
    path: "editor/AGENTS.md",
    min: 30_000,
    max: null,
    why: "the editor-side skill set; read on demand, never nested-loaded, so no ceiling",
  },
  {
    path: "library/AGENTS.md",
    min: 60_000,
    max: null,
    why: "the Library subsystem guide; read on demand, never nested-loaded, so no ceiling",
  },
  {
    path: "library/CLAUDE.md",
    min: 200,
    max: 2_000,
    why: "a POINTER at library/AGENTS.md — nested-loaded under library/, so it must stay a pointer",
  },
  {
    path: "library/scripts/skill-bundle-template/CLAUDE.md",
    min: 1_000,
    max: BUDGET_BYTES,
    why: "the workspace entry point shipped into a user's library folder by the skill bundle",
  },
];

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** A memory file plus every `@path` import it pulls in, transitively. */
export function loadedBytes(rel: string, readRel: (r: string) => string | null, seen = new Set<string>()): number {
  const norm = path.normalize(rel);
  if (seen.has(norm)) return 0;
  seen.add(norm);
  const text = readRel(norm);
  if (text === null) return 0;
  let total = bytes(text);
  for (const m of text.matchAll(/^@(\S+)\s*$/gm)) {
    total += loadedBytes(path.join(path.dirname(norm), m[1]), readRel, seen);
  }
  return total;
}

/** `trackedFiles` answers absolute paths; this census speaks repo-relative. */
function tracked(root: string, ext: RegExp): string[] {
  return trackedFiles(root, ext).map((p) => path.relative(REPO_ROOT, p));
}

function readRel(rel: string): string | null {
  const abs = path.join(REPO_ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

/** `[docs/agents/laws/x.md](...)` targets named in the Laws index. */
export function indexedLawDocs(agents: string): string[] {
  const laws = agents.split(/^## /m).find((s) => s.startsWith("Laws"));
  if (!laws) return [];
  return [...new Set([...laws.matchAll(/\]\((docs\/agents\/laws\/[^)\s]+\.md)\)/g)].map((m) => m[1]))].sort();
}

/** The law docs, each carrying the shared collapse floor and no ceiling. */
function lawRows(): GuideRow[] {
  return tracked(LAWS_DIR, /\.md$/).map((p) => ({
    path: p,
    min: LAW_MIN_BYTES,
    max: null,
    why: "a law doc; on-demand doctrine, so a floor only",
  }));
}

/**
 * Rows whose file is outside its band. Pure over `sizeOf` so a neutering leg
 * can prove the envelope has teeth on BOTH sides.
 */
export function envelopeViolations(rows: GuideRow[], sizeOf: (rel: string) => number | null): string[] {
  const bad: string[] = [];
  for (const row of rows) {
    const size = sizeOf(row.path);
    if (size === null) {
      bad.push(`${row.path}: MISSING (${row.why})`);
      continue;
    }
    if (size < row.min) bad.push(`${row.path}: ${size} bytes COLLAPSED below floor ${row.min} — ${row.why}`);
    if (row.max !== null && size > row.max) bad.push(`${row.path}: ${size} bytes over ceiling ${row.max} — ${row.why}`);
  }
  return bad;
}

/** What one guide path IS on disk, as far as aliasing is concerned. */
export interface GuideNode {
  symlink: boolean;
  /** Identity of the underlying inode — two equal keys are ONE file. */
  inode: string;
}

/**
 * Guides that are symlinks, or that share an inode with another guide. Pure
 * over `nodeOf` so a neutering leg can re-create the exact 2026-09-15 shape.
 */
export function aliasViolations(paths: string[], nodeOf: (rel: string) => GuideNode | null): string[] {
  const bad: string[] = [];
  const byInode = new Map<string, string[]>();
  for (const p of paths) {
    const node = nodeOf(p);
    if (node === null) continue;
    if (node.symlink) {
      bad.push(`${p}: is a SYMLINK — a write to either name destroys the other`);
      continue;
    }
    byInode.set(node.inode, [...(byInode.get(node.inode) ?? []), p]);
  }
  for (const [inode, group] of byInode) {
    if (group.length > 1) bad.push(`${group.join(" + ")}: one inode (${inode}) under two names — a write to either is a write to both`);
  }
  return bad.sort();
}

function realSize(rel: string): number | null {
  const text = readRel(rel);
  return text === null ? null : bytes(text);
}

function realNode(rel: string): GuideNode | null {
  const abs = path.join(REPO_ROOT, rel);
  if (!existsSync(abs)) return null;
  if (lstatSync(abs).isSymbolicLink()) return { symlink: true, inode: "" };
  const st = statSync(abs);
  return { symlink: false, inode: `${st.dev}:${st.ino}` };
}

describe("always-loaded context budget", () => {
  it("AGENTS.md is under budget", () => {
    const size = bytes(readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8"));
    expect(
      size,
      `AGENTS.md is ${size} bytes (budget ${BUDGET_BYTES}). It is loaded into every session — ` +
        `move doctrine into its law's file under ${LAWS_DIR}/ and keep only the index entry here.`,
    ).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("the budget has teeth: a 50 KB section appended would fail it", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const grown = `${agents}\n## Some new half\n\n${"doctrine ".repeat(6_000)}`;
    const size = loadedBytes("CLAUDE.md", (r) => (path.normalize(r) === "AGENTS.md" ? grown : readRel(r)));
    expect(size).toBeGreaterThan(BUDGET_BYTES);
  });

  it("every tracked CLAUDE.md, with its @imports, is under budget", () => {
    const files = tracked(".", /^CLAUDE\.md$/);
    expect(files).toContain("CLAUDE.md");
    const over = files
      .map((f) => [f, loadedBytes(f, readRel)] as const)
      .filter(([, n]) => n > BUDGET_BYTES)
      .map(([f, n]) => `${f}: ${n} bytes loaded`);
    expect(over, "a CLAUDE.md is nested-loaded when a session reads under its folder — point, don't copy").toEqual([]);
  });

  it("the Laws index and docs/agents/laws agree both ways", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const indexed = indexedLawDocs(agents);
    const onDisk = tracked(LAWS_DIR, /\.md$/);
    expect(indexed.length, "AGENTS.md lost its '## Laws' index").toBeGreaterThan(0);
    expect(indexed.filter((d) => !existsSync(path.join(REPO_ROOT, d))), "indexed law doc does not exist").toEqual([]);
    expect(onDisk.filter((d) => !indexed.includes(d)), "law doc not indexed in AGENTS.md").toEqual([]);
  });

  it("each law doc is titled as its index entry and carries the doc header", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const headings = new Set([...agents.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim()));
    const bad: string[] = [];
    for (const d of tracked(LAWS_DIR, /\.md$/)) {
      const text = readFileSync(path.join(REPO_ROOT, d), "utf8");
      const title = text.match(/^# (.+)$/m)?.[1].trim();
      if (!title || !headings.has(title)) bad.push(`${d}: title ${JSON.stringify(title)} has no '### ' index entry`);
      if (!/^<!-- last-verified: /.test(text) || !/<!-- derives-from: /.test(text)) bad.push(`${d}: missing header`);
    }
    expect(bad).toEqual([]);
  });

  it("the synthetic loader follows @imports (canary)", () => {
    const files: Record<string, string> = { "CLAUDE.md": "@a.md\n", "a.md": "x".repeat(10) + "\n@b/c.md\n", "b/c.md": "yy" };
    expect(loadedBytes("CLAUDE.md", (r) => files[r] ?? null)).toBe(6 + 19 + 2);
  });
});

describe("the guide envelope has a FLOOR", () => {
  it("the table is total over every tracked AGENTS.md and CLAUDE.md", () => {
    const declared = new Set(GUIDES.map((g) => g.path));
    const onDisk = tracked(".", /^(AGENTS|CLAUDE)\.md$/);
    expect(onDisk.length, "the guide census found nothing — the scan is broken").toBeGreaterThan(3);
    expect(
      onDisk.filter((p) => !declared.has(p)),
      "a guide file with no envelope row: state its floor and ceiling in GUIDES (a guide nobody bounds is a guide that can be destroyed silently)",
    ).toEqual([]);
    expect(
      [...declared].filter((p) => !onDisk.includes(p)),
      "an envelope row for a file that is no longer tracked — drop the row",
    ).toEqual([]);
  });

  it("every guide and law doc sits inside its envelope", () => {
    expect(envelopeViolations([...GUIDES, ...lawRows()], realSize)).toEqual([]);
  });

  it("the floor has teeth: destroying library/AGENTS.md to a 560-byte stub fails it", () => {
    // The literal 2026-09-15 accident: 93,125 bytes -> the pointer text.
    const bad = envelopeViolations(GUIDES, (rel) => (rel === "library/AGENTS.md" ? 560 : realSize(rel)));
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain("library/AGENTS.md");
    expect(bad[0]).toContain("COLLAPSED");
  });

  it("the floor has teeth: a deleted guide fails it", () => {
    const bad = envelopeViolations(GUIDES, (rel) => (rel === "editor/AGENTS.md" ? null : realSize(rel)));
    expect(bad).toEqual([expect.stringContaining("editor/AGENTS.md: MISSING")]);
  });

  it("the pointer ceiling has teeth: library/CLAUDE.md grown back into a copy fails it", () => {
    const bad = envelopeViolations(GUIDES, (rel) => (rel === "library/CLAUDE.md" ? 93_125 : realSize(rel)));
    expect(bad).toEqual([expect.stringContaining("library/CLAUDE.md")]);
    expect(bad[0]).toContain("over ceiling");
  });
});

describe("no guide file aliases another", () => {
  const paths = () => [...GUIDES.map((g) => g.path), ...lawRows().map((r) => r.path)];

  it("no guide is a symlink and no two guides share an inode", () => {
    expect(aliasViolations(paths(), realNode)).toEqual([]);
  });

  it("has teeth: the library/CLAUDE.md -> AGENTS.md symlink that caused this fails it", () => {
    const bad = aliasViolations(paths(), (rel) =>
      rel === "library/CLAUDE.md" ? { symlink: true, inode: "" } : realNode(rel),
    );
    expect(bad).toEqual([expect.stringContaining("library/CLAUDE.md")]);
    expect(bad[0]).toContain("SYMLINK");
  });

  it("has teeth: a hard link between two guides fails it", () => {
    const shared = { symlink: false, inode: "1:4242" };
    const bad = aliasViolations(paths(), (rel) =>
      rel === "library/CLAUDE.md" || rel === "library/AGENTS.md" ? shared : realNode(rel),
    );
    expect(bad).toEqual([expect.stringContaining("one inode")]);
    expect(bad[0]).toContain("library/AGENTS.md");
    expect(bad[0]).toContain("library/CLAUDE.md");
  });
});

// ---------------------------------------------------------------------------
// REGION: a cited SECTION resolves
// ---------------------------------------------------------------------------

/**
 * A file can also be destroyed one section at a time. `library/AGENTS.md` is
 * cited by name-and-section from both guardrail suites' FAILURE-TIME escape
 * hatches ("add it to PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS **and** to the
 * library/AGENTS.md 'Perf doctrine' prose list"), so a citation that no longer
 * resolves silently retires the "why it's O(1)" half of keystroke sanctity for
 * the whole Reader silo. The envelope above notices the file collapsing; this
 * notices the SECTION going away under a guide that is still the right size.
 */
const CITED_GUIDE = "library/AGENTS.md";

/** Roots swept for citations. `library/dev/` is dated iteration memos — history, not doctrine. */
const CITATION_ROOTS = ["src", "library", "docs/agents", "editor"];
const CITATION_SKIP = [/^library\/dev\//, /^src\/__tests__\/agents-md-budget\.test\.ts$/];

/** `library/AGENTS.md "Section"` or `library/AGENTS.md §Section`, comment wrapping folded out. */
const CITATION_RE = new RegExp(
  `${CITED_GUIDE.replace("/", "\\/").replace(".", "\\.")}[^"“§\\n]{0,14}(?:["“]([^"”\\n]{3,90})["”]|§\\s*([A-Za-z][^,.;)"\\n]{2,60}))`,
  "g",
);

/** Headings AND `**Bold lead.**` labels — this guide anchors doctrine as both. */
export function guideAnchors(text: string): string[] {
  return [
    ...[...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^\*\*(.+?)\*\*/gm)].map((m) => m[1]),
  ].map(normalizeAnchor);
}

function normalizeAnchor(s: string): string {
  return s.replace(/`/g, "").replace(/\s+/g, " ").trim().replace(/[.:—-]+$/, "").trim().toLowerCase();
}

/** Every `<guide> "<section>"` citation in the swept tree, as `file | section`. */
export function guideCitations(files: string[], readRel: (r: string) => string | null): { file: string; section: string }[] {
  const out: { file: string; section: string }[] = [];
  for (const f of files) {
    const raw = readRel(f);
    if (raw === null) continue;
    // Fold comment wrapping: a citation routinely spans two `//` lines.
    const flat = raw.replace(/\n\s*(?:\/\/|\*|#)?[ \t]*/g, " ");
    for (const m of flat.matchAll(CITATION_RE)) out.push({ file: f, section: (m[1] ?? m[2]).trim() });
  }
  return out;
}

/** Citations naming a section the guide no longer has. Pure, so it can be neutered. */
export function unresolvedCitations(
  citations: { file: string; section: string }[],
  anchors: string[],
): string[] {
  const bad: string[] = [];
  for (const c of citations) {
    const want = normalizeAnchor(c.section);
    if (!anchors.some((a) => a.startsWith(want))) bad.push(`${c.file}: cites ${CITED_GUIDE} "${c.section}" — no such section`);
  }
  return [...new Set(bad)].sort();
}

function citationFiles(): string[] {
  const files = CITATION_ROOTS.flatMap((r) => tracked(r, /\.(ts|tsx|py|md|mjs)$/));
  return [...new Set(files)].filter((f) => !CITATION_SKIP.some((re) => re.test(f))).sort();
}

describe(`every cited section of ${CITED_GUIDE} exists`, () => {
  const anchors = () => guideAnchors(readRel(CITED_GUIDE) ?? "");

  it("the guide's anchors are found (canary)", () => {
    const a = anchors();
    expect(a.length, `${CITED_GUIDE} yielded no headings — it is gone or the scan is broken`).toBeGreaterThan(20);
    expect(a).toContain("perf doctrine — keystroke sanctity, scroll anchors, pane drags");
    expect(a, "`**Deep-index subskills.**` is a bold-lead anchor, not a heading").toContain("deep-index subskills");
  });

  it("the citation scan finds the guardrails' escape hatches (canary)", () => {
    const cites = guideCitations(citationFiles(), readRel);
    expect(cites.length, "no citations found — the scan is broken").toBeGreaterThan(10);
    expect(cites).toContainEqual({ file: "src/lib/__tests__/keystroke-subscriber-guardrail.test.ts", section: "Perf doctrine" });
    expect(cites).toContainEqual({ file: "src/lib/__tests__/pane-drag-guardrail.test.ts", section: "Pane-drag doctrine" });
  });

  it("every citation resolves to a real section", () => {
    expect(unresolvedCitations(guideCitations(citationFiles(), readRel), anchors())).toEqual([]);
  });

  it("has teeth: deleting the 'Perf doctrine' section makes the escape hatches dangle", () => {
    const gutted = anchors().filter((a) => !a.startsWith("perf doctrine"));
    const bad = unresolvedCitations(guideCitations(citationFiles(), readRel), gutted);
    expect(bad.length).toBeGreaterThan(2);
    expect(bad.join("\n")).toContain("keystroke-subscriber-guardrail");
    expect(bad.join("\n")).toContain("pane-drag-guardrail");
  });
});
