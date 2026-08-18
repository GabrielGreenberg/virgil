// Task 356 — content-loss class, ROUND 2 (parse side).
//
// Gabriel's directive after task 350: "no matter what, even if the syntax is not
// parseable into good .tex, there should never be data loss like this... where
// else might it show up?" 350 closed the `\ex` / `\begingl` members of the
// unterminated-close family and the expex `[label]` member of the
// whitelist-drop family. This suite covers the members that survived it:
//
//   1  The `\begin{env}` DISPATCHER — 350's exact disease one branch over.
//      `findMatchingEnv` → -1 took `ctx.src.slice(ctx.pos)` and set
//      `ctx.pos = ctx.src.length`, so the whole document TAIL became one
//      environment body — and the modeled branches then kept only what their
//      node can hold (`parseList` keeps `\item` slices; `figure` keeps its
//      recognised attrs), so the tail was DESTROYED, not merely mis-shaped.
//      The routine trigger is TYPING: in the code pane the close does not exist
//      yet for the seconds it takes to write the body.
//   2  `splitListItems` — `firstItemPos > 0 ? slice : ""` conflated "no `\item`"
//      (-1) with "an item at offset 0", so a body with CONTENT but no item
//      reported zero items and an empty preamble, and `parseList` substituted
//      one empty `listItem`. Every byte destroyed, on WELL-FORMED input, so no
//      fail-closed arm anywhere could have caught it.
//   3  The `\title`/`\author`/`\date` family — TWO scans that disagreed twice.
//      Both comment-blind (a `%\title{old draft}` was promoted to be the title
//      and the real one deleted); and strip-ALL against a keep-FIRST parse, so
//      a repeated field (amsart / ACM multi-`\author`) lost all but one.
//   4  expex `[opts]` — every key but `exno=` consumed and discarded.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Same reason 350's does, one layer over:
// every pre-356 env / list / title fixture in the repo is WELL-FORMED and
// single-valued, so each of these losses is UNREPRESENTABLE in all of them —
// which is how they shipped with the suite green. Each leg drives the REAL save
// pipeline (`parseLatex` → `assignUuids` → `serializeToLatex` with the REAL
// extracted delimiters, exactly what `storage-fsa.writeDocBundle` and the
// load-writeback do) over TWO cycles: cycle 1 is where the loss happens, and
// cycle 2 is what proves nothing accumulates — every one of these was a FIXED
// POINT, so a single-cycle assertion cannot tell damage from calm.
//
// Every CONTROL (a well-formed env, a real list, a single title) runs through
// the identical harness, so no leg can pass by breaking the modeled path.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { JSONContent } from "@tiptap/core";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { codeOnlyLines } from "./_source-scan";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function twoCycles(input: string): { c1: string; c2: string } {
  const c1 = save(input);
  return { c1, c2: save(c1) };
}

function doc(body: string, preambleExtra = ""): string {
  return `\\documentclass{article}\n${preambleExtra}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

/** Content survival is the contract; the carrier's exact formatting is not. */
function expectAllPresent(out: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !out.includes(n));
  expect(
    missing,
    `content destroyed by the save pipeline: ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

function blockTypes(tex: string): string[] {
  return (parseLatex(tex).content ?? []).map((n) => n.type ?? "?");
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · the `\begin{env}` dispatcher — unterminated ⇒ transparent
// ───────────────────────────────────────────────────────────────────────────

describe("1 · an unterminated \\begin{env} costs its own line, not the document", () => {
  // The three shapes the report names: mid-typing (no close yet), a typo'd
  // close, and a commented-out close. All three reach `findMatchingEnv → -1`.
  const tails = [
    ["mid-typing (no close at all)", ""],
    ["a typo'd close", "\\end{itmize}\n\n"],
    ["a commented-out close", "% \\end{itemize}\n\n"],
  ] as const;

  for (const [label, closer] of tails) {
    it(`survives ${label}`, () => {
      const input = doc(
        `Intro paragraph.\n\n\\begin{itemize}\n\\item one\n\\item two\n\n${closer}\\section{Survivor}\n\nTail prose must survive.`,
      );
      const { c1, c2 } = twoCycles(input);
      for (const out of [c1, c2]) {
        expectAllPresent(out, [
          "Intro paragraph.",
          "one",
          "two",
          "Survivor",
          "Tail prose must survive.",
        ]);
      }
      // The heading below the stranded opener is still a HEADING, not prose
      // folded into a list body — the tail was never claimed.
      expect(blockTypes(c1)).toContain("heading");
      expect(c1).toBe(c2);
    });
  }

  it("does not fabricate the \\end{itemize} the user never typed", () => {
    const input = doc("\\begin{itemize}\n\\item one\n\nAfter.");
    const { c1 } = twoCycles(input);
    // Pre-356 the parser claimed the tail as a list body and the serializer
    // closed it, which is what made the damage a fixed point.
    expect(c1).not.toContain("\\end{itemize}");
    expectAllPresent(c1, ["\\begin{itemize}", "one", "After."]);
  });

  it("CONTROL — a well-formed \\begin{itemize} is still a real list", () => {
    const input = doc("\\begin{itemize}\n\\item one\n\\end{itemize}\n\nAfter.");
    const { c1, c2 } = twoCycles(input);
    expect(blockTypes(c1)).toContain("bulletList");
    expectAllPresent(c1, ["\\begin{itemize}", "\\item one", "After."]);
    expect(c1).toBe(c2);
  });

  it("CONTROL — an unmodeled env still round-trips as a carrier", () => {
    const input = doc("\\begin{align}\na &= b\n\\end{align}\n\nAfter.");
    const { c1, c2 } = twoCycles(input);
    expectAllPresent(c1, ["\\begin{align}", "a &= b", "\\end{align}", "After."]);
    expect(c1).toBe(c2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 · a list body with no `\item` is CARRIED, never emptied
// ───────────────────────────────────────────────────────────────────────────

describe("2 · an item-less list body survives (well-formed input)", () => {
  const bodies = [
    ["an \\input-only body", "\\input{bullets}"],
    ["a tuning-only body", "\\itemsep0pt\n\\setlength{\\parskip}{0pt}"],
    ["items hidden in an opaque construct", "\\begin{verbatim}\n\\item not mine\n\\end{verbatim}"],
  ] as const;

  for (const [label, body] of bodies) {
    for (const env of ["itemize", "enumerate"] as const) {
      it(`${env}: ${label}`, () => {
        const input = doc(`\\begin{${env}}\n${body}\n\\end{${env}}\n\nAfter.`);
        const { c1, c2 } = twoCycles(input);
        // The whole environment is carried BYTE-FOR-BYTE — which is also the
        // strongest possible form of "no `\item` the user never wrote". (A
        // substring check for `\item` cannot say that: `\itemsep` contains it,
        // and the verbatim fixture's body legitimately holds one.)
        for (const out of [c1, c2]) {
          expect(out).toContain(`\\begin{${env}}\n${body}\n\\end{${env}}`);
          expectAllPresent(out, ["After."]);
        }
        expect(c1).toBe(c2);
      });
    }
  }

  it("CONTROL — a list with a preamble AND items keeps both", () => {
    const input = doc(
      "\\begin{itemize}\n\\itemsep0pt\n\\item one\n\\item two\n\\end{itemize}\n\nAfter.",
    );
    const { c1, c2 } = twoCycles(input);
    expect(blockTypes(c1)).toContain("bulletList");
    expectAllPresent(c1, ["\\itemsep0pt", "\\item one", "\\item two", "After."]);
    expect(c1).toBe(c2);
  });

  it("CONTROL — a genuinely EMPTY body is still an editable empty list", () => {
    // Nothing to lose, and the one-empty-item node is what the user can type
    // into — the refusal is scoped to a body with CONTENT.
    const input = doc("\\begin{itemize}\n\\end{itemize}\n\nAfter.");
    expect(blockTypes(input)).toContain("bulletList");
    const { c1, c2 } = twoCycles(input);
    expect(c1).toBe(c2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 · the title family — one comment-aware scan behind both halves
// ───────────────────────────────────────────────────────────────────────────

function titleFields(tex: string, field: string): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "titleField" && n.attrs?.field === field) out.push(n);
    n.content?.forEach(walk);
  };
  walk(parseLatex(tex));
  return out;
}

describe("3 · a commented-out or repeated title field is neither promoted nor deleted", () => {
  it("a commented-out \\title above the live one does not become the title", () => {
    const input =
      "\\documentclass{article}\n%\\title{old draft}\n\\title{Real Title}\n\n\\begin{document}\n\\maketitle\nHello.\n\\end{document}\n";
    const { c1, c2 } = twoCycles(input);
    for (const out of [c1, c2]) {
      expectAllPresent(out, ["\\title{Real Title}", "%\\title{old draft}", "Hello."]);
    }
    const hoisted = titleFields(input, "title");
    expect(hoisted).toHaveLength(1);
    expect(hoisted[0].content?.[0]?.text).toBe("Real Title");
    expect(c1).toBe(c2);
  });

  it("a mid-line comment shadows a \\title on the same line", () => {
    const input =
      "\\documentclass{article}\n\\newcommand{\\x}{y} % \\title{shadowed}\n\\title{Real}\n\n\\begin{document}\n\\maketitle\nHi.\n\\end{document}\n";
    expect(titleFields(input, "title").map((n) => n.content?.[0]?.text)).toEqual([
      "Real",
    ]);
    const { c1, c2 } = twoCycles(input);
    expectAllPresent(c1, ["% \\title{shadowed}", "\\title{Real}"]);
    expect(c1).toBe(c2);
  });

  it("an ESCAPED percent is not a comment", () => {
    // `\%` can never open one — the escaping rule is the lexer's, not a local
    // `%` scan, so a `\title` after a literal percent is still live.
    const input =
      "\\documentclass{article}\n\\newcommand{\\pct}{100\\% } \\title{Live}\n\n\\begin{document}\n\\maketitle\nHi.\n\\end{document}\n";
    expect(titleFields(input, "title").map((n) => n.content?.[0]?.text)).toEqual([
      "Live",
    ]);
  });

  it("a multi-author preamble keeps EVERY author, in order", () => {
    const input =
      "\\documentclass{amsart}\n\\title{Paper}\n\\author{Jane Q. Doe}\n\\author{Bob Roe}\n\\author{Ann Poe}\n\n\\begin{document}\n\\maketitle\nHello.\n\\end{document}\n";
    const { c1, c2 } = twoCycles(input);
    for (const out of [c1, c2]) {
      expectAllPresent(out, [
        "\\author{Jane Q. Doe}",
        "\\author{Bob Roe}",
        "\\author{Ann Poe}",
      ]);
      expect(out.indexOf("Jane Q. Doe")).toBeLessThan(out.indexOf("Bob Roe"));
      expect(out.indexOf("Bob Roe")).toBeLessThan(out.indexOf("Ann Poe"));
    }
    // A repeated field is outside the one-field-per-kind model, so it is
    // carried raw rather than hoisted — data over affordance.
    expect(titleFields(input, "author")).toHaveLength(0);
    // …while the UNREPEATED title is still hoisted and editable.
    expect(titleFields(input, "title")).toHaveLength(1);
    expect(c1).toBe(c2);
  });

  it("the strip leaves no orphaned `%` to comment out the next line", () => {
    const input =
      "\\documentclass{article}\n%\\title{old}\n\\usepackage{amsmath}\n\\title{Real}\n\n\\begin{document}\nHi.\n\\end{document}\n";
    const { c1 } = twoCycles(input);
    // Pre-356 the strip removed the commented title AND its newline, fusing the
    // orphaned `%` onto `\usepackage{amsmath}` — commenting THAT out too.
    expect(c1).toMatch(/^\\usepackage\{amsmath\}$/m);
  });

  it("CONTROL — a single title/author/date is still hoisted and editable", () => {
    const input =
      "\\documentclass{article}\n\\title{T}\n\\author{A}\n\\date{D}\n\n\\begin{document}\n\\maketitle\nHi.\n\\end{document}\n";
    expect(titleFields(input, "title")).toHaveLength(1);
    expect(titleFields(input, "author")).toHaveLength(1);
    expect(titleFields(input, "date")).toHaveLength(1);
    const { c1, c2 } = twoCycles(input);
    expectAllPresent(c1, ["\\title{T}", "\\author{A}", "\\date{D}"]);
    expect(c1).toBe(c2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4 · expex options are CARRIED, not filtered down to `exno`
// ───────────────────────────────────────────────────────────────────────────

describe("4 · every expex [opt] survives, not just exno", () => {
  const EXPEX = "\\usepackage{expex}\n";

  it("a block-level option run round-trips byte-for-byte", () => {
    const input = doc(
      "\\ex[everypar={\\itshape}][exno=7]\nSome example.\n\\xe",
      EXPEX,
    );
    const { c1, c2 } = twoCycles(input);
    for (const out of [c1, c2]) {
      expectAllPresent(out, ["[everypar={\\itshape}][exno=7]", "Some example."]);
    }
    expect(c1).toBe(c2);
  });

  it("an item-level option run round-trips byte-for-byte", () => {
    const input = doc(
      "\\pex\n\\a[aboveexskip=1ex] first\n\\a second\n\\xe",
      EXPEX,
    );
    const { c1, c2 } = twoCycles(input);
    for (const out of [c1, c2]) {
      expectAllPresent(out, ["[aboveexskip=1ex]", "first", "second"]);
    }
    expect(c1).toBe(c2);
  });

  it("keeps interpreting exno — the renumberer still reads it", () => {
    const input = doc("\\ex[exno=42]\nBody.\n\\xe", EXPEX);
    const block = (parseLatex(input).content ?? []).find(
      (n) => n.type === "exampleBlock",
    );
    expect(block?.attrs?.exnoOverride).toBe("42");
    const { c1, c2 } = twoCycles(input);
    expectAllPresent(c1, ["[exno=42]"]);
    expect(c1).toBe(c2);
  });

  it("CONTROL — an option-free example emits no bracket at all", () => {
    const input = doc("\\ex\nBody.\n\\xe", EXPEX);
    const { c1, c2 } = twoCycles(input);
    expect(c1).toMatch(/\\ex\n/);
    // Scoped to the opener's own line — the injected `\providecommand{…}[1]{}`
    // shims in the preamble carry brackets of their own.
    const exLine = c1.split("\n").find((l) => l.includes("\\ex")) ?? "";
    expect(exLine).not.toContain("[");
    expect(c1).toBe(c2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5 · the `%!vtex` twin the census turned up
// ───────────────────────────────────────────────────────────────────────────

describe("5 · a stranded %!vtex:begin does not swallow the document", () => {
  it("carries the marker line and keeps parsing", () => {
    const input = doc(
      "%!vtex:begin abcd\n\\somemacro{x}\n\n\\section{Survivor}\n\nTail prose.",
    );
    const { c1, c2 } = twoCycles(input);
    for (const out of [c1, c2]) {
      expectAllPresent(out, ["\\somemacro{x}", "Survivor", "Tail prose."]);
    }
    expect(blockTypes(c1)).toContain("heading");
    expect(c1).toBe(c2);
  });

  it("CONTROL — a well-formed texBlock still round-trips whole", () => {
    const input = doc(
      "%!vtex:begin abcd\n\\somemacro{x}\n%!vtex:end abcd\n\nAfter.",
    );
    const { c1, c2 } = twoCycles(input);
    expectAllPresent(c1, ["%!vtex:begin abcd", "\\somemacro{x}", "%!vtex:end abcd", "After."]);
    expect(c1).toBe(c2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6 · CENSUS — the unterminated-close family, with teeth
// ───────────────────────────────────────────────────────────────────────────
//
// The leg with teeth. The four fixes above were never the part that can
// misbehave — the NEXT `\begin{…}`-shaped branch someone adds is, and it would
// reinstate the hole with every behavioural leg green. So: every place in the
// two parsers that lets a cursor or a bound reach the END OF SOURCE must carry
// an `unterminated-ok:` comment stating why EOF is genuinely the end of that
// construct. There is no allowlist — a hit is JUSTIFY-it or FAIL-CLOSED-it.

const PARSER_FILES = ["src/lib/latex-parser.ts", "src/lib/footnote-content.ts"];

/** An assignment (never a comparison) whose right-hand side reaches the end of
 *  a SOURCE string. `x.content.length` and friends are excluded by the
 *  no-dot-before rule; `pos < src.length` by the no-comparison rule. */
const EOF_REACH =
  /(?<![<>=!+\-*/%&|^])=(?!=)[^;]*?(?<![.\w])(?:ctx\.src|src|content|body|text|latex|preamble)\.length\b/;

function repoFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("6 · census · every EOF-reaching bound states why EOF is safe there", () => {
  it("finds no unjustified EOF slice in either parser", () => {
    const unjustified: string[] = [];
    for (const rel of PARSER_FILES) {
      const raw = repoFile(rel);
      const rawLines = raw.split("\n");
      const codeLines = codeOnlyLines(raw).split("\n");
      expect(
        codeLines.length,
        `${rel}: the stripper must stay LINE-ALIGNED with the source`,
      ).toBe(rawLines.length);
      codeLines.forEach((line, idx) => {
        if (!EOF_REACH.test(line)) return;
        // The justification may sit on the line itself or in the comment block
        // directly above it — 8 lines is comfortably more than any real
        // preamble here and far less than the distance to an unrelated one.
        const window = rawLines.slice(Math.max(0, idx - 8), idx + 1).join("\n");
        if (!window.includes("unterminated-ok:")) {
          unjustified.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      unjustified,
      "an EOF-reaching bound with no `unterminated-ok:` justification — either " +
        "fail closed (restore the cursor and carry the bytes) or state why EOF " +
        "genuinely is this construct's end",
    ).toEqual([]);
  });

  it("the census can SEE a violation (canary) and reads CODE, not prose", () => {
    // Synthetic, deliberately — a canary standing on the very lines the census
    // drains would evaporate the moment they are fixed.
    const offenders = [
      "  ctx.pos = ctx.src.length;",
      "  const envContent = envEnd !== -1 ? s : ctx.src.slice(p);",
      "  bodyEnd = body.length;",
      "  advanceTo = src.length;",
    ];
    for (const line of offenders.filter((l) => !l.includes("slice"))) {
      expect(EOF_REACH.test(line), `should flag: ${line}`).toBe(true);
    }
    // …and does NOT flag the shapes that are not EOF claims.
    for (const clean of [
      "  if (ctx.pos >= ctx.src.length) break;",
      "  pendingFrom = parent.content.length;",
      "  while (i < src.length && /\\s/.test(src[i])) i++;",
      "  if (r.content.length > maxCells) maxCells = r.content.length;",
    ]) {
      expect(EOF_REACH.test(clean), `should NOT flag: ${clean}`).toBe(false);
    }
    // A mention inside a COMMENT is prose, and the stripper blanks it — which
    // matters here because this task's own fixes explain themselves by quoting
    // the pre-fix line verbatim.
    const prose = codeOnlyLines("// ctx.pos = ctx.src.length;\nconst a = 1;\n");
    expect(EOF_REACH.test(prose)).toBe(false);
    expect(prose.split("\n").length).toBe(3);
  });

  it("swallow self-check — the stripper did not eat either parser", () => {
    for (const rel of PARSER_FILES) {
      const raw = repoFile(rel);
      const code = codeOnlyLines(raw);
      const rawDecls = (raw.match(/^(?:export )?function /gm) ?? []).length;
      const codeDecls = (code.match(/^(?:export )?function /gm) ?? []).length;
      expect(rawDecls, `${rel} should hold real declarations`).toBeGreaterThan(5);
      expect(codeDecls, `${rel}: stripper swallowed declarations`).toBe(rawDecls);
    }
  });
});
