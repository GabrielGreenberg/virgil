/**
 * Task 1021 — CENSUS: no new private brace/bracket matcher in `src/lib`.
 *
 * Task 777 made `findGroupClose` (`latex-lexer.ts`) THE group scanner: brace-
 * nested, escape-parity, comment-aware, inline-verbatim-aware, and fail-closed
 * to the blind close. Every private copy it left behind was a place where a `}`
 * or `]` inside a `%` comment (or a nested group) could end an argument TeX
 * never ended — `\caption{A % old}\n B.}` saved with `B.}` outside the caption.
 * 1021 routed the round-tripping copies through the door; this census keeps a
 * new one from appearing silently.
 *
 * Two shapes are counted per file, in comment-stripped source:
 *  - a DEPTH MATCHER: a `depth++` within two lines after a `"{"` literal;
 *  - a RAW BRACKET READ: `indexOf("]", …)` — an optional argument read without
 *    `extractBracketed`.
 *
 * A file not listed here must have zero of either; a listed file's count is
 * EXACT (a drop means a copy was folded in — lower the number; a rise means a
 * new copy — route it through `findGroupClose` / `extractBraced` /
 * `extractBracketed` instead, or argue its reason here).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, REPO_ROOT, walkFiles } from "./_source-scan";

interface Allowed {
  depth: number;
  bracket: number;
  reason: string;
}

const ALLOWED: Record<string, Allowed> = {
  "src/lib/latex-lexer.ts": {
    // 4 → 5 (task 1370): `blankFalseConditionals` tags each control word with
    // its brace DEPTH (a top-level `\iffalse` test + same-depth `\fi`
    // matching) over an already comment-projected source — a depth test, not
    // a group-close search.
    depth: 5,
    bracket: 0,
    reason:
      "THE door itself (findGroupClose + its blind fallback), the inline-verbatim " +
      "payload/option readers, whose payload is literal by definition, and the " +
      "conditional-false pass's depth tagging (task 1370)",
  },
  "src/lib/bib-source.ts": {
    // 5 → 3 (task 1156): the block / citekey-head / braced-value walks fold into
    // ONE `walkDelimited`; the quoted-value walk and `bracesBalance` remain.
    depth: 3,
    bracket: 0,
    reason: "BibTeX grammar, not TeX: `%` is not a comment inside a .bib field's braces",
  },
  "src/lib/latex-typography.ts": {
    depth: 1,
    bracket: 0,
    reason:
      "zero-import leaf the lexer imports (cannot call up); an accent base is never a " +
      "comment, so it REFUSES a group holding `%` instead of skipping it",
  },
  "src/lib/forest/grammar.ts": {
    depth: 1,
    bracket: 0,
    reason:
      "comment-aware already, bounded by a caller `limit`, and wants -1 (an `unbalanced` " +
      "refusal) where the door would fall back to the blind close",
  },
  "src/lib/latex-counters.ts": {
    depth: 2,
    bracket: 0,
    reason: "runs on comment-STRIPPED source (`stripComments`); scan-only, writes no bytes",
  },
  "src/lib/latex-serializer.ts": {
    depth: 1,
    bracket: 0,
    reason: "`hasTopLevelWhitespace` — a depth TEST over Virgil's own emitted cell, not a close search",
  },
  "src/lib/syntax-check.ts": {
    depth: 1,
    bracket: 0,
    reason: "diagnostic reader, comment-aware on its own; reports, never writes bytes",
  },
  "src/lib/tiptap/cmd-only-paragraph.ts": {
    depth: 1,
    bracket: 1,
    reason:
      "typing-in-progress span: an UNCLOSED group extends to end of text by design; " +
      "classifies a paragraph, writes no bytes",
  },
  "src/lib/tiptap/slash-popup.ts": {
    depth: 1,
    bracket: 0,
    reason: "a depth TEST over ≤200 chars of text before the caret; no close search",
  },
};

const DEPTH_INC = /(\bdepth\w*\s*\+\+|\+\+\s*depth\w*|\bdepth\w*\s*\+=\s*1\b)/;
const OPEN_BRACE_LITERAL = /(["'])\{\1/;
const RAW_BRACKET_READ = /\.indexOf\(\s*(["'])\]\1/g;

function countIn(src: string): { depth: number; bracket: number } {
  const lines = commentsStripped(src).split("\n");
  let depth = 0;
  lines.forEach((line, i) => {
    if (!DEPTH_INC.test(line)) return;
    const win = lines.slice(Math.max(0, i - 2), i + 1).join("\n");
    if (OPEN_BRACE_LITERAL.test(win)) depth++;
  });
  const bracket = lines.join("\n").match(RAW_BRACKET_READ)?.length ?? 0;
  return { depth, bracket };
}

describe("task 1021 — group-scanner CENSUS", () => {
  const files = walkFiles(path.join(REPO_ROOT, "src/lib"), { skipDirs: ["__tests__"] }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it("walks a real population", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no private brace/bracket matcher outside the allowlist; listed counts are exact", () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      const got = countIn(fs.readFileSync(abs, "utf8"));
      const allowed = ALLOWED[rel];
      if (!allowed) {
        if (got.depth || got.bracket) {
          problems.push(
            `${rel}: ${got.depth} depth matcher(s), ${got.bracket} raw indexOf("]") — ` +
              "route through findGroupClose / extractBraced / extractBracketed (latex-lexer.ts)",
          );
        }
        continue;
      }
      seen.add(rel);
      if (got.depth !== allowed.depth || got.bracket !== allowed.bracket) {
        problems.push(
          `${rel}: expected ${allowed.depth} depth / ${allowed.bracket} bracket, found ` +
            `${got.depth} / ${got.bracket} — a drop means a copy was folded (lower the count); ` +
            "a rise is a new private scanner",
        );
      }
    }
    for (const rel of Object.keys(ALLOWED)) {
      if (!seen.has(rel)) problems.push(`${rel}: allowlisted but not found — delete the row`);
    }
    expect(problems).toEqual([]);
  });

  it("the detector sees the shapes it forbids", () => {
    expect(
      countIn('function f(s){let depth=0;for(const c of s){\n if (c === "{") depth++;\n}}'),
    ).toEqual({ depth: 1, bracket: 0 });
    expect(countIn('const close = src.indexOf("]", i);')).toEqual({ depth: 0, bracket: 1 });
    // A comment mentioning the shape is not code.
    expect(countIn('// never a local indexOf("]")')).toEqual({ depth: 0, bracket: 0 });
  });
});

/**
 * Task 1141 — the CITE-ARGUMENT files read `[…]`/`{…}` groups through THE
 * reader (`readCiteUnitsAt` in `cite-commands.ts`, over `extractBracketed` /
 * `extractBraced`), never a regex character class. The model's private
 * `\[([^\]]*)\]` predated the census above (which counts depth matchers and
 * raw `indexOf("]")`, not regexes) and drifted from the scanner: a braced `]`
 * in a note made a citation the scanner built unreadable to the model.
 * Counted per file in comment-stripped source; counts are EXACT.
 */
const REGEX_GROUP_READ = /\[\^\\{1,2}\]\]|\[\^\}\]/g;

const CITE_ARGUMENT_FILES: Record<string, { count: number; reason: string }> = {
  "src/lib/cite-command-model.ts": { count: 0, reason: "THE model — reads through readCiteUnitsAt" },
  "src/lib/cite-commands.ts": {
    count: 4,
    reason:
      "`CITE_RE_FULL`: the input rule's END-anchored trigger over typed text — the " +
      "InputRule API takes a RegExp; what it builds is re-read by the scanner",
  },
};

describe("task 1141 — cite-argument regex CENSUS", () => {
  it("cite-argument files hold no private regex group reader beyond the listed count", () => {
    const problems: string[] = [];
    for (const [rel, allowed] of Object.entries(CITE_ARGUMENT_FILES)) {
      const src = commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      const got = src.match(REGEX_GROUP_READ)?.length ?? 0;
      if (got !== allowed.count) {
        problems.push(
          `${rel}: expected ${allowed.count} regex group read(s), found ${got} — read ` +
            "`[…]`/`{…}` through readCiteUnitsAt (cite-commands.ts)",
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("the detector sees the shape it forbids", () => {
    expect("const R = /\\[([^\\]]*)\\]\\{([^}]+)\\}/;".match(REGEX_GROUP_READ)?.length).toBe(2);
    expect("`(?:\\\\[[^\\\\]]*\\\\]){0,2}`".match(REGEX_GROUP_READ)?.length).toBe(1);
  });
});
