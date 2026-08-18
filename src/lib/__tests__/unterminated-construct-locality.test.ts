// Task 350 — an unterminated construct swallowed the REST OF THE DOCUMENT, and
// the load-writeback then persisted the truncation to disk with zero user edits.
//
// Reported by Gabriel: a paper written outside Virgil (Overleaf) lost ~350 of
// its 394 lines by being OPENED. Two independent defects compounded:
//
//   A  RECOGNITION.  `rest.match(/^\\(ex|pex)(~?)/)` never looked at what
//      followed, so linguex's `\ex.` was claimed as an expex example (the cut
//      file's stranded `.` is the fingerprint) — as were `\example`,
//      `\exercise` and the primitive `\expandafter`.
//   B  UNTERMINATED CLOSE FAILS OPEN.  `findMatchingXe` → -1 took
//      `ctx.src.slice(bodyStart)` and set `ctx.pos = ctx.src.length`: the whole
//      remainder became one example body, whose whitelist then kept the
//      paragraphs and silently discarded every heading, figure, blockquote,
//      nested example and texBlock in the tail. The `\begingl` twin did the
//      same, FOLDING a heading and its prose into an interlinear gloss tier.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-350 expex suite spells its
// fixtures WELL-FORMED — an `\ex` always has its `\xe` — so an unterminated
// construct is unrepresentable in all of them, which is how this shipped. Each
// leg here therefore drives the REAL save pipeline (`parseLatex` →
// `assignUuids` → `serializeToLatex` with the REAL extracted delimiters —
// exactly what `storage-fsa.writeDocBundle` and the load-writeback do) and
// asserts on CONTENT SURVIVAL rather than on bytes: the question the incident
// asks is "is the user's writing still there?", and a byte assertion would
// couple these legs to the carrier's formatting choices.
//
// Every CONTROL (well-formed `\ex`, `\pex`, `\begingl`) runs through the
// identical harness, so no leg can pass vacuously by breaking expex outright.
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { matchExpexOpenerAt } from "@/lib/latex-lexer";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

/** Two full cycles. Cycle 1 is where the loss happens; cycle 2 is what proves
 *  nothing accumulates — and the pre-350 truncation was a FIXED POINT, so a
 *  single-cycle assertion could never have distinguished damage from calm. */
function twoCycles(input: string): { c1: string; c2: string } {
  const c1 = save(input);
  return { c1, c2: save(c1) };
}

function doc(body: string, packages = "\\usepackage{expex}"): string {
  return `\\documentclass{article}\n${packages}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

/** Every one of these strings must still be present in the output. Content
 *  survival is the contract; the carrier's exact formatting is not. */
function expectAllPresent(out: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !out.includes(n));
    expect(
      missing,
      `content destroyed by the save pipeline: ${JSON.stringify(missing)}`,
    ).toEqual([]);
}

// ───────────────────────────────────────────────────────────────────────────
// Defect A — recognition: `\ex.` is linguex, and `\ex` is a control WORD
// ───────────────────────────────────────────────────────────────────────────

describe("A · the opener vocabulary is the lexer's, and it is strict", () => {
  it("declines linguex `\\ex.` / `\\pex.`", () => {
    expect(matchExpexOpenerAt("\\ex.\\a. foo", 0)).toBeNull();
    expect(matchExpexOpenerAt("\\pex.\\a. foo", 0)).toBeNull();
  });

  it("declines any command that merely STARTS with ex/pex", () => {
    // The control-word rule: `\ex` is `\ex` only where the next char is not a
    // word char. Pre-350 each of these entered the example branch with its tail
    // dropped into the body.
    for (const cmd of [
      "\\example{x}",
      "\\exercise",
      "\\expandafter\\foo",
      "\\extract",
      "\\pexpr",
      "\\ex2",
      "\\ex_a",
    ]) {
      expect(matchExpexOpenerAt(cmd, 0), cmd).toBeNull();
    }
  });

  it("still accepts every real expex opener form", () => {
    expect(matchExpexOpenerAt("\\ex foo", 0)).toMatchObject({
      kind: "single",
      suppressSpace: false,
    });
    expect(matchExpexOpenerAt("\\pex foo", 0)).toMatchObject({
      kind: "multi",
      suppressSpace: false,
    });
    expect(matchExpexOpenerAt("\\ex~foo", 0)).toMatchObject({
      kind: "single",
      suppressSpace: true,
    });
    expect(matchExpexOpenerAt("\\ex[exno=7] foo", 0)).toMatchObject({
      kind: "single",
    });
    expect(matchExpexOpenerAt("\\ex\n foo", 0)).toMatchObject({ kind: "single" });
  });

  it("a linguex document survives the save pipeline whole", () => {
    // The reproducing shape: BOTH packages loaded, examples in linguex syntax,
    // no `\xe` anywhere in the file. Pre-350 the first `\ex.` swallowed to EOF
    // and everything after `\section{Two}` was destroyed on OPEN.
    const input = doc(
      [
        "\\section{One}",
        "",
        "Consider the following three sentences:",
        "",
        "\\ex.\\label{s1}\\a.\\label{s1a} Susan went to the store.",
        "    \\b.\\label{s1b} Mary wanted cake.",
        "    \\c.\\label{s1c} It was her birthday.",
        "",
        "Each sentence could be used independently.",
        "",
        "\\section{Two}",
        "",
        "More prose here that must survive.",
        "",
        "\\ex.\\a. Second example.",
        "    \\b. Another line.",
        "",
        "Closing paragraph.",
      ].join("\n"),
      "\\usepackage{expex}\n\\usepackage{linguex}",
    );
    const { c1, c2 } = twoCycles(input);
    const needles = [
      "\\section{One}",
      "Consider the following three sentences:",
      "Susan went to the store.",
      "Mary wanted cake.",
      "It was her birthday.",
      "Each sentence could be used independently.",
      "\\section{Two}",
      "More prose here that must survive.",
      "Second example.",
      "Another line.",
      "Closing paragraph.",
      // The linguex markup itself is content too — it is what makes these
      // examples examples when the paper is compiled.
      "\\ex.",
      "\\label{s1}",
      "\\label{s1c}",
    ];
    expectAllPresent(c1, needles);
    expectAllPresent(c2, needles);
    // …and NOTHING was fabricated. A `\xe` the user never typed is the
    // signature the truncated file carried.
    expect(c1).not.toContain("\\xe");
    expect(c2).not.toContain("\\xe");
  });

  it("a linguex opener with NO linguex package is CARRIED, even when a `\\xe` exists", () => {
    // RENEGOTIATED by task 355, and the assertion is preserved rather than
    // weakened. This leg's claim has always been about the `.` RULE: `\ex.` is
    // not an expex opener, so it is never claimed as one. What 355 changed is
    // what happens to it INSTEAD — with `\usepackage{linguex}` present it is
    // now modelled as a linguex example (the leg directly below), and without
    // it the carry this leg pins is unchanged, byte for byte. So the fixture
    // drops the linguex package and keeps everything else; the pre-355 fixture
    // loaded BOTH, which is why the two tasks meet here.
    //
    // The leg that gives the linguex `.` rule its own teeth, and getting here
    // took two wrong drafts worth recording — because the honest reach of that
    // rule is narrower than it first looks.
    //
    // With NO `\xe` in the file, defect B alone rescues a linguex document (the
    // opener finds no terminator and is carried), so neither of the survival
    // legs above can distinguish the two fixes. A `\xe` therefore has to be
    // present for recognition to be the load-bearing half — and then the
    // CONTENT survives either way, because the swallow is bounded by that `\xe`
    // and `buildExampleBlockFromBody`'s whitelist happens to keep paragraphs.
    //
    // So what the rule buys here is not survival but the MODEL: whether the
    // user's linguex example is carried as the raw LaTeX it is, or claimed as
    // an expex example and rendered as a mangled card with a stranded `.` where
    // its first item should be. That is what this leg asserts, and it is the
    // only shape in which the `.` rule can be falsified.
    const src = doc(
      [
        "\\ex.\\a. Linguex item one.",
        "    \\b. Linguex item two.",
        "",
        "\\xe",
        "",
        "\\section{After}",
      ].join("\n"),
      "\\usepackage{expex}",
    );
    // NO expex example is produced: the linguex opener is carried. Neutering
    // the `.` rule makes this ONE, because the stray `\xe` gives the swallow a
    // terminator and defect B never fires.
    const parsed = parseLatex(src);
    expect(
      (parsed.content ?? []).filter((n) => n.type === "exampleBlock"),
    ).toHaveLength(0);
    const { c1, c2 } = twoCycles(src);
    expectAllPresent(c1, [
      "\\ex.",
      "Linguex item one.",
      "Linguex item two.",
      "\\section{After}",
    ]);
    expect(c2).toBe(c1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Defect B — an unterminated close FAILS CLOSED, at every site
// ───────────────────────────────────────────────────────────────────────────

describe("B · an unterminated construct is not that construct", () => {
  it("`\\ex` with no `\\xe` keeps the rest of the document", () => {
    const input = doc(
      [
        "\\section{One}",
        "",
        "Intro paragraph.",
        "",
        "\\ex",
        "Some example body line.",
        "",
        "\\section{Two}",
        "",
        "This section must survive.",
        "",
        "Closing paragraph.",
      ].join("\n"),
    );
    const { c1, c2 } = twoCycles(input);
    const needles = [
      "\\section{One}",
      "Intro paragraph.",
      "Some example body line.",
      "\\section{Two}",
      "This section must survive.",
      "Closing paragraph.",
    ];
    expectAllPresent(c1, needles);
    expectAllPresent(c2, needles);
    expect(c1).not.toContain("\\xe");
  });

  it("`\\begingl` with no `\\endgl` keeps the rest of the document", () => {
    // Pre-350 this one FOLDED the heading and its prose into a gloss tier:
    // `\glb one two// \section{Two} This section must survive. //`
    const input = doc(
      [
        "\\section{One}",
        "",
        "Intro paragraph.",
        "",
        "\\begingl",
        "\\gla foo bar//",
        "\\glb one two//",
        "",
        "\\section{Two}",
        "",
        "This section must survive.",
      ].join("\n"),
    );
    const { c1, c2 } = twoCycles(input);
    const needles = [
      "\\section{One}",
      "Intro paragraph.",
      "\\gla foo bar",
      "\\glb one two",
      "\\section{Two}",
      "This section must survive.",
    ];
    expectAllPresent(c1, needles);
    expectAllPresent(c2, needles);
    expect(c1).not.toContain("\\endgl");
  });

  it("an unterminated opener does not wedge the parser", () => {
    // The fail-closed branch restores the cursor and falls through rather than
    // `continue`-ing, so progress has to be argued: `readParagraph`'s
    // block-boundary test requires a non-empty accumulated result, which is why
    // the opener that BEGINS a paragraph can never terminate it. A regression
    // here hangs rather than fails, so the leg is a timeout guard by design.
    const out = save(doc("\\ex\n\\ex\n\\begingl\n\\ex\ntail text."));
    expect(out).toContain("tail text.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CONTROLS — well-formed expex is untouched, so no leg above passes vacuously
// ───────────────────────────────────────────────────────────────────────────

describe("controls · well-formed expex still parses as expex", () => {
  it("a real `\\ex … \\xe` still becomes an example block", () => {
    const input = doc("\\ex\nA real example.\n\\xe");
    const { c1, c2 } = twoCycles(input);
    expect(c1).toContain("\\ex");
    expect(c1).toContain("\\xe");
    expect(c1).toContain("A real example.");
    // …and the example is MODELLED, not carried: a carried opener would keep
    // the user's own `\xe` without the serializer minting the `\vexid` marker
    // that only a real exampleBlock emits.
    expect(c1).toContain("\\vexid{");
    expect(c2).toContain("\\vexid{");
  });

  it("a real `\\pex … \\xe` still becomes a multi-part example", () => {
    const input = doc("\\pex\n\\a First item.\n\\a Second item.\n\\xe");
    const { c1 } = twoCycles(input);
    expectAllPresent(c1, ["\\pex", "\\xe", "First item.", "Second item."]);
    expect(c1).toContain("\\vexid{");
  });

  it("a real `\\begingl … \\endgl` still becomes a gloss", () => {
    const input = doc("\\ex\n\\begingl\n\\gla foo bar//\n\\glb one two//\n\\endgl\n\\xe");
    const { c1 } = twoCycles(input);
    expectAllPresent(c1, ["\\begingl", "\\endgl", "\\gla", "\\glb"]);
  });

  it("`\\ex~` (space-suppressed) still round-trips", () => {
    const { c1 } = twoCycles(doc("\\ex~\nSuppressed.\n\\xe"));
    expect(c1).toContain("\\ex~");
    expect(c1).toContain("Suppressed.");
  });
});
