import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * SPEC AUTHORITY — there is exactly ONE style spec, and everything else says so
 * (task 2026-07-18-173).
 *
 * The bug class is a doc SSOT **fork**: two documents claiming the same
 * authority, one maintained and one frozen, with the frozen one carrying the
 * louder framing. `docs/virgil-design-system/` opened by calling itself the
 * authoritative UI reference and telling the reader to read every file before
 * changing anything; its `11-style-guide.md` presented itself as a file to drop
 * over `src/STYLE_GUIDE.md`. Both were true for one pass in April 2026 and
 * inverted afterwards — the live guide grew to ~1300 lines while the fork stayed
 * at 272, so "replacing" the live file would have deleted ~1000 lines of current
 * doctrine. Worse, `src/STYLE_GUIDE.md` had been *created by copying* the fork
 * and kept its header, so the live spec's own first paragraph deferred authority
 * to the frozen one.
 *
 * Nothing failed. The cost was paid in agent-hours: the D6 token audit burned
 * several finder lanes on candidates that turned out to be stale-doc artifacts
 * rather than code defects, and a `--pod-shadow-light` snippet in the fork would
 * have made an agent emit a silently no-op shadow.
 *
 * Three legs, because the first alone only proves someone once wrote a banner:
 *
 *   1. BANNER      every file in the historical folder is marked historical.
 *   2. NO RIVAL    no doc anywhere claims to be, or to replace, the style spec.
 *   3. ROUTING     the live spec asserts its own authority and AGENTS.md points
 *                  at it — and a live surface may cite the historical folder
 *                  only in an explicitly historical frame.
 *
 * Leg 2's allowlist is deliberately EMPTY. A doc that wants to state spec is
 * either the spec (edit `src/STYLE_GUIDE.md`) or history (mark it) — there is
 * no third status to allowlist into.
 *
 * ESCAPE HATCH — a line that must reproduce one of these claims verbatim
 * (quoting history, or a test fixture) carries `spec-authority-allow`, the same
 * convention as `token-doc-allow` in the sibling token-contract guard.
 */

const ROOT = path.resolve(__dirname, "..", "..");

/** The one live style spec. Every rule below is stated relative to it. */
const LIVE_SPEC = "src/STYLE_GUIDE.md";

/** The demoted fork, kept for its rationale (see its README). */
const HISTORICAL_DIR = "docs/virgil-design-system";

/** Line 1 of every file in the historical folder. Machine-checkable on purpose. */
const HISTORICAL_MARKER = `<!-- historical-record: ${HISTORICAL_DIR} -->`;

/** Roots swept for markdown. Excludes generated/vendored/sample trees. */
const DOC_ROOTS = ["docs", "src", "library", "editor"];
const ROOT_DOCS = ["AGENTS.md", "CLAUDE.md", "README.md"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-preview",
  ".git",
  ".claude",
  "virgil-data",
  "library-data",
  "samples",
  "dist",
  "build",
]);

function walkMarkdown(rel: string, out: string[] = []): string[] {
  const abs = path.join(ROOT, rel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = path.join(rel, name);
    const st = statSync(path.join(ROOT, childRel));
    if (st.isDirectory()) walkMarkdown(childRel, out);
    else if (name.endsWith(".md")) out.push(childRel);
  }
  return out;
}

const ALL_DOCS: string[] = [
  ...ROOT_DOCS.filter((f) => {
    try {
      statSync(path.join(ROOT, f));
      return true;
    } catch {
      return false;
    }
  }),
  ...DOC_ROOTS.flatMap((r) => walkMarkdown(r)),
].sort();

const HISTORICAL_DOCS = ALL_DOCS.filter((f) => f.startsWith(`${HISTORICAL_DIR}${path.sep}`));

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("the historical design-system record is marked as historical", () => {
  it("finds the folder (a silent empty sweep would pass every other check)", () => {
    expect(HISTORICAL_DOCS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(HISTORICAL_DOCS)("%s opens with the historical marker", (file) => {
    const first = read(file).split("\n")[0]?.trim();
    expect(
      first,
      `${file} must begin with ${HISTORICAL_MARKER} — a reader who greps INTO this ` +
        `folder never sees its README, so the demotion has to be stated per file.`,
    ).toBe(HISTORICAL_MARKER);
  });

  it("keeps the two removed traps removed", () => {
    // `11-style-guide.md` told the reader to overwrite the live spec with a
    // frozen subset; `patches/` was an unapplied proposal that "defined" two of
    // the folder's phantom tokens. Both are recoverable from git history.
    const revived = HISTORICAL_DOCS.filter(
      (f) => f.endsWith("11-style-guide.md") || f.includes(`${path.sep}patches${path.sep}`),
    );
    expect(revived).toEqual([]);
  });
});

/**
 * Claims that assert style-spec authority. Each is the literal shape that
 * actually shipped — a paraphrase detector would be noise, and the point is to
 * catch the specific reintroduction, not to police prose.
 */
const RIVAL_CLAIMS: ReadonlyArray<readonly [string, RegExp]> = [
  [
    "declares itself a replacement for the style guide",
    /drop-in replacement for\s+`?src\/STYLE_GUIDE\.md`?/i,
  ],
  ["declares itself the canonical UI reference", /canonical reference for Virgil'?s UI/i],
  ["tells the reader the doc outranks the code", /treat the prose as the spec/i],
  [
    "routes the reader to a second style spec as the full reference",
    /full reference lives in\s+`?docs\/virgil-design-system/i,
  ],
];

describe("no document rivals the style spec", () => {
  it.each(RIVAL_CLAIMS)("nothing %s", (_label, pattern) => {
    const hits: string[] = [];
    for (const file of ALL_DOCS) {
      read(file)
        .split("\n")
        .forEach((text, i) => {
          if (text.includes("spec-authority-allow")) return;
          if (pattern.test(text)) hits.push(`${file}:${i + 1} — ${text.trim().slice(0, 100)}`);
        });
    }
    expect(
      hits,
      `${LIVE_SPEC} is the only style spec. A doc that wants to state spec is ` +
        `either the spec (edit that file) or history (mark it historical). If the ` +
        `line genuinely quotes history, mark it spec-authority-allow.`,
    ).toEqual([]);
  });
});

describe("the routing points at the one spec", () => {
  it(`${LIVE_SPEC} asserts its own authority`, () => {
    // Without this the guide can quietly re-acquire a deferring header — which
    // is exactly how it shipped for a year, having been created by copying the
    // fork and inheriting its "drop-in replacement" opener.
    expect(read(LIVE_SPEC)).toMatch(/\*\*This file is the style spec[^*]*\*\*/);
  });

  it("AGENTS.md routes agents to it", () => {
    const styleSection = read("AGENTS.md").split(/^## /m).find((s) => s.startsWith("Style"));
    expect(styleSection, "AGENTS.md lost its Style section").toBeTruthy();
    expect(styleSection).toContain(LIVE_SPEC);
    expect(
      styleSection,
      "the Style section must name exactly one spec — a second path here is the fork",
    ).not.toContain(HISTORICAL_DIR);
  });

  it("a live surface cites the historical folder only in a historical frame", () => {
    // Live surfaces may reference the record (it holds real rationale), but the
    // reference has to carry its own frame: an agent lands on ONE line.
    const liveSurfaces = [LIVE_SPEC, "AGENTS.md", "CLAUDE.md", ...walkMarkdown("docs/agents")];
    const FRAME = /histor|frozen|migration record|no longer|used to|deferred/i;
    const bare: string[] = [];
    for (const file of liveSurfaces) {
      const lines = read(file).split("\n");
      lines.forEach((text, i) => {
        if (!text.includes(HISTORICAL_DIR)) return;
        // ±2 lines: the frame and the path routinely sit in one wrapped sentence.
        const window = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        if (!FRAME.test(window)) bare.push(`${file}:${i + 1} — ${text.trim().slice(0, 100)}`);
      });
    }
    expect(
      bare,
      `An unframed pointer into ${HISTORICAL_DIR} reads as a pointer to current spec. ` +
        `Say it is historical on or beside the line that names it.`,
    ).toEqual([]);
  });
});
