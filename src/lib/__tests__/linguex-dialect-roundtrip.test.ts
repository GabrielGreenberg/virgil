// Task 355 — LINGUEX as a first-class dialect, beside expex, on the same node.
//
// Task 350 made linguex input SAFE: a `\ex.` is not an expex opener, so it is
// carried raw and a linguex paper survives a save byte-intact. This task makes
// it MODELLED — parsed into the existing `exampleBlock`/`exampleItem` model,
// and written back in ITS OWN syntax.
//
// WHY THAT LAST CLAUSE IS THE WHOLE FEATURE. Virgil's `.tex` is the user's only
// copy and it is co-authored on Overleaf. Converting a collaborator's linguex
// examples to expex on OPEN would rewrite every example in the file — a diff
// bomb against a document Virgil was merely asked to read — and, because the
// two packages both define `\ex`, it would also need a `\usepackage{expex}`
// that BREAKS the paper. So the dialect rides the node as an attr and the
// serializer branches on it.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-355 example fixture in the
// repo is spelled in expex, so a dialect divergence is unrepresentable in all
// of them. Each leg here drives the REAL save pipeline (`parseLatex` →
// `assignUuids` → `serializeToLatex` with the REAL extracted delimiters —
// what `storage-fsa.writeDocBundle` and the load-writeback do) over TWO cycles:
// cycle 1 is where a loss would happen, cycle 2 is what proves nothing
// accumulates. Controls (a real expex example, a linguex paper with no linguex
// package) run through the identical harness so no leg can pass vacuously.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { JSONContent } from "@tiptap/react";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  matchExpexOpenerAt,
  matchLinguexOpenerAt,
  matchLinguexItemAt,
  preambleLoadsPackage,
} from "@/lib/latex-lexer";
import { PACKAGE_DETECTORS } from "@/lib/latex-requirement-collector";
import {
  DEFAULT_EXAMPLE_DIALECT,
  dominantExampleDialect,
  exampleDialectOf,
} from "@/lib/example-dialect";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

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

const LINGUEX = "\\usepackage{linguex}";
const BOTH = "\\usepackage{expex}\n\\usepackage{linguex}";

function doc(body: string, packages = LINGUEX): string {
  return `\\documentclass{article}\n${packages}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

function blocksOf(parsed: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "exampleBlock") out.push(n);
    n.content?.forEach(walk);
  };
  walk(parsed);
  return out;
}

/** The body of an example, flattened to its text — enough to assert WHICH
 *  words landed in which part without coupling to the inline node shape. */
function textOf(node: JSONContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}

function itemsOf(block: JSONContent): JSONContent[] {
  const list = (block.content ?? []).find((c) => c.type === "exampleItemList");
  return (list?.content ?? []).filter((c) => c.type === "exampleItem");
}

function expectAllPresent(out: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !out.includes(n));
  expect(
    missing,
    `content destroyed by the save pipeline: ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · DETECTION — form says WHICH dialect, the package says WHETHER to model
// ───────────────────────────────────────────────────────────────────────────

describe("1 · detection", () => {
  it("the two openers partition the `\\ex` family by the PERIOD, per site", () => {
    // The discriminator task 350 established, now read by both directions. It
    // is per-SITE and consults no preamble, which is what makes a document
    // that loads BOTH packages (the ordinary linguistics shape, and Gabriel's
    // own paper) readable example by example.
    expect(matchLinguexOpenerAt("\\ex. Susan left.", 0)).toEqual({ end: 4 });
    expect(matchExpexOpenerAt("\\ex. Susan left.", 0)).toBeNull();
    expect(matchLinguexOpenerAt("\\ex Susan left.", 0)).toBeNull();
    expect(matchExpexOpenerAt("\\ex Susan left.", 0)).toMatchObject({
      kind: "single",
    });
    // The control-word boundary is the LANGUAGE's rule, so it holds on both
    // sides: `\exg.` / `\exi.` / `\exr.` are out-of-scope linguex variants and
    // are openers for NEITHER — which is the whole v1 scope line, enforced by
    // construction rather than by a list.
    for (const cmd of ["\\exg. a", "\\exi. a", "\\exr. a", "\\example. a"]) {
      expect(matchLinguexOpenerAt(cmd, 0), cmd).toBeNull();
      expect(matchExpexOpenerAt(cmd, 0), cmd).toBeNull();
    }
  });

  it("a COMMENTED-OUT `\\usepackage{linguex}` enables nothing", () => {
    // The detector law tasks 344/345 earned: only bytes the COMPILER would
    // believe. A commented-out package line is the single most ordinary thing
    // in an academic preamble.
    expect(
      preambleLoadsPackage("% \\usepackage{linguex}\n\\begin{document}\n", "linguex"),
    ).toBe(false);
    expect(
      preambleLoadsPackage("\\usepackage{linguex}\n\\begin{document}\n", "linguex"),
    ).toBe(true);
    // …and the same for the shapes a real preamble actually writes.
    expect(
      preambleLoadsPackage("\\usepackage[force]{linguex}\n\\begin{document}\n", "linguex"),
    ).toBe(true);
    expect(
      preambleLoadsPackage("\\usepackage{expex,linguex}\n\\begin{document}\n", "linguex"),
    ).toBe(true);
    // A load BELOW `\begin{document}` is not a preamble load.
    expect(
      preambleLoadsPackage("\\begin{document}\n\\usepackage{linguex}\n", "linguex"),
    ).toBe(false);
  });

  it("with the package commented out, the example is CARRIED, not modelled", () => {
    // The behavioural half of the leg above, and the one that matters: an
    // enabling decision that reads a commented-out line would MODEL an example
    // in a document whose author had switched the package off.
    const src = doc("\\ex. Susan left.", "% \\usepackage{linguex}");
    expect(blocksOf(parseLatex(src))).toHaveLength(0);
    const { c1, c2 } = twoCycles(src);
    expectAllPresent(c1, ["\\ex. Susan left."]);
    expect(c2).toBe(c1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2 · PARSE — the model, not just the bytes
// ───────────────────────────────────────────────────────────────────────────

describe("2 · parse", () => {
  it("`\\ex.` with no parts is a SINGLE example", () => {
    const parsed = parseLatex(doc("\\ex.\\label{s1} Susan went to the store."));
    const blocks = blocksOf(parsed);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.kind).toBe("single");
    expect(blocks[0].attrs?.label).toBe("s1");
    expect(exampleDialectOf(blocks[0].attrs)).toBe("linguex");
    expect(textOf(blocks[0])).toContain("Susan went to the store.");
  });

  it("`\\ex.` + `\\a.`/`\\b.`/`\\c.` is a MULTI example with three parts", () => {
    // The reproducing document's own shape (task 350), including the first
    // part abutting the header — which is why `matchLinguexItemAt` accepts a
    // marker there as well as at a line start.
    const parsed = parseLatex(
      doc(
        [
          "\\ex.\\label{s1}\\a.\\label{s1a} Susan went to the store.",
          "    \\b.\\label{s1b} Mary wanted cake.",
          "    \\c. It was her birthday.",
        ].join("\n"),
      ),
    );
    const blocks = blocksOf(parsed);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.kind).toBe("multi");
    expect(blocks[0].attrs?.label).toBe("s1");
    const items = itemsOf(blocks[0]);
    expect(items.map((i) => i.attrs?.label)).toEqual(["s1a", "s1b", ""]);
    expect(items.map((i) => textOf(i).trim())).toEqual([
      "Susan went to the store.",
      "Mary wanted cake.",
      "It was her birthday.",
    ]);
  });

  it("body prose runs the NORMAL inline pipeline — cites, math, footnotes", () => {
    const parsed = parseLatex(
      doc("\\ex.\\a. A cite \\citep{smith2020} and math $x^2$ and a \\footnote{note}.\n\\b. Two."),
    );
    const items = itemsOf(blocksOf(parsed)[0]);
    const first = JSON.stringify(items[0]);
    expect(first).toContain("citation");
    expect(first).toContain("inlineMath");
    expect(first).toContain("footnote");
  });

  it("the example STOPS at the blank line, and at a block boundary", () => {
    // The load-bearing safety property, and it is a property of linguex's
    // GRAMMAR: the construct has no closing command, so a reader cannot
    // swallow past its own paragraph. Task 350's catastrophe is
    // unrepresentable here — this leg is what keeps a future "continuation"
    // heuristic from making it representable again.
    const parsed = parseLatex(
      doc(
        [
          "\\ex.\\a. One.",
          "",
          "Prose that must NOT be inside the example.",
          "",
          "\\ex.\\a. Two.",
          "\\section{Later}",
          "Section prose.",
        ].join("\n"),
      ),
    );
    const blocks = blocksOf(parsed);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      expect(textOf(b)).not.toContain("Prose that must NOT");
      expect(textOf(b)).not.toContain("Section prose");
    }
    expect((parsed.content ?? []).some((n) => n.type === "heading")).toBe(true);
  });

  it("numbering and sub-labels are dialect-BLIND", () => {
    // The parity claim in one assertion: everything downstream of the parse
    // reads the NODE, and both dialects produce the same node. A linguex
    // example is numbered in the same sequence as an expex one beside it, and
    // its parts get the same a/b/c sub-labels.
    const parsed = parseLatex(
      doc(
        ["\\ex.\\a. First.", "\\b. Second.", "", "\\ex Expex one.\\xe", ""].join("\n"),
        BOTH,
      ),
    );
    const blocks = blocksOf(parsed);
    expect(blocks.map((b) => b.attrs?.number)).toEqual([1, 2]);
    expect(blocks.map((b) => exampleDialectOf(b.attrs))).toEqual([
      "linguex",
      "expex",
    ]);
    expect(itemsOf(blocks[0]).map((i) => i.attrs?.subLabel)).toEqual(["a", "b"]);
  });

  it("a `\\ref` to a linguex example label resolves like any other", () => {
    const parsed = parseLatex(
      doc(["\\ex.\\label{s1}\\a.\\label{s1a} One.", "", "See \\ref{s1a}."].join("\n")),
    );
    // The resolved display text lives on the ref node; asserting it is present
    // and non-empty is the parity claim (the exact letter is `resolveRefs`'
    // contract, pinned by its own suite).
    const json = JSON.stringify(parsed);
    expect(json).toContain('"s1a"');
    expect(blocksOf(parsed)[0].attrs?.label).toBe("s1");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3 · SERIALIZE — each example in its OWN dialect
// ───────────────────────────────────────────────────────────────────────────

describe("3 · serialize", () => {
  it("a canonical linguex document is BYTE-IDENTICAL from cycle 1", () => {
    // Canonical shape (header on its own line where there are parts, one part
    // per line) — the form Virgil emits, so this is the fixed point every
    // subsequent save must reproduce exactly, uuid markers included.
    const src = doc(
      [
        "\\section{One}",
        "",
        "Consider these:",
        "",
        "\\vexid{aaaa}\\ex.\\label{s1}",
        "\\vxid{bbbb}\\a.\\label{s1a} Susan went to the store.",
        "\\vxid{cccc}\\b.\\label{s1b} Mary wanted cake.",
        "",
        "\\vexid{dddd}\\ex. A single example.",
        "",
        "Tail.",
      ].join("\n"),
    );
    const { c1, c2 } = twoCycles(src);
    expect(c2).toBe(c1);
    expectAllPresent(c1, [
      "\\vexid{aaaa}\\ex.\\label{s1}\n",
      "\\vxid{bbbb}\\a.\\label{s1a} Susan went to the store.\n",
      "\\vxid{cccc}\\b.\\label{s1b} Mary wanted cake.\n",
      "\\vexid{dddd}\\ex. A single example.\n",
    ]);
    // NOTHING was fabricated: a `\xe` the user never typed is exactly the
    // signature the truncated file in task 350 carried.
    expect(c1).not.toContain("\\xe");
  });

  it("hand-written layout normalizes ONCE and is stable after", () => {
    // The stated normalization: author layout inside the example is
    // canonicalized (the same one-time normalization every other construct in
    // the serializer performs). What must never happen is a second change —
    // that would be a document that moves on every save, forever.
    const src = doc(
      ["\\ex.\\label{s1}\\a.\\label{s1a} One.", "    \\b. Two.", "    \\c. Three."].join(
        "\n",
      ),
    );
    const { c1, c2 } = twoCycles(src);
    expect(c2).toBe(c1);
    expectAllPresent(c1, ["\\ex.\\label{s1}", "\\a.\\label{s1a} One.", "\\b. Two.", "\\c. Three."]);
  });

  it("dialect integrity — a MIXED document keeps each example in its own syntax", () => {
    // The claim the whole attr exists for. Gabriel's paper loads both packages
    // and writes linguex; a collaborator's expex examples in the same file must
    // come back as expex.
    const src = doc(
      [
        "\\ex.\\a. Linguex one.",
        "\\b. Linguex two.",
        "",
        "\\ex Expex single.\\xe",
        "",
        "\\pex\\a Expex part one.\\a Expex part two.\\xe",
      ].join("\n"),
      BOTH,
    );
    const { c1, c2 } = twoCycles(src);
    expect(c2).toBe(c1);
    // The linguex example emits linguex …
    expect(c1).toMatch(/\\ex\.\n(?:\\vxid\{\w+\})?\\a\. Linguex one\./);
    // … and the expex ones still emit expex, `\xe` and all.
    expect(c1).toContain("Expex single.");
    expect(c1).toContain("\\xe");
    expect(c1).toContain("\\pex");
    // No linguex example ever grew a `\xe`: exactly two closes, one per expex
    // example.
    expect(c1.match(/\\xe/g)).toHaveLength(2);
    // …and no expex example ever grew a period.
    expect(c1).not.toContain("\\pex.");
  });

  it("a linguex-only paper gets NO `\\usepackage{expex}` injected", () => {
    // A live compile hazard this task closed, and it bit BEFORE the modelling
    // did: the requirements FALLBACK detector matched `\ex` with no lookahead
    // for the period, so a linguex `\ex.` — carried raw, post-350, or modelled,
    // post-355 — declared expex. `ensurePreambleRequirements` then injected
    // `\usepackage{expex}` AFTER the user's own `\usepackage{linguex}`, and the
    // two packages both define `\ex`: the later load wins and EVERY example in
    // the paper stops compiling. A preamble the user never wrote, breaking a
    // document that compiled before Virgil opened it.
    const { c1 } = twoCycles(doc("\\ex.\\a. One.\n\\b. Two."));
    expect(c1).not.toContain("\\usepackage{expex}");
    expect(c1).toContain("\\usepackage{linguex}");
    // The CONTROL, through the identical harness — a real expex example still
    // declares expex, so this leg cannot pass by breaking the detector.
    const control = save(doc("\\ex Expex one.\\xe", "\\usepackage{expex}"));
    expect(control).toContain("\\usepackage{expex}");
  });

  it("the expex DETECTOR agrees with the opener SSOT about the `\\ex` family", () => {
    // The premise CHECKED rather than restated (task 148's instrument). The
    // detector is a hand-spelled regex in a leaf that cannot import the lexer,
    // so nothing but this leg keeps it agreeing with `matchExpexOpenerAt` about
    // what an expex opener IS — and a drift here is silent in the direction
    // that rewrites a user's preamble.
    const expexDetector = PACKAGE_DETECTORS.find((d) => d.id === "expex");
    expect(expexDetector).toBeDefined();
    for (const probe of ["\\ex x", "\\ex~x", "\\pex x", "\\ex\nx"]) {
      expect(expexDetector!.re.test(probe), probe).toBe(true);
      expect(matchExpexOpenerAt(probe, 0), probe).not.toBeNull();
    }
    for (const probe of ["\\ex. x", "\\pex. x", "\\example x", "\\exercise x"]) {
      expect(expexDetector!.re.test(probe), probe).toBe(false);
      expect(matchExpexOpenerAt(probe, 0), probe).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4 · v1 SCOPE — what is not modelled is CARRIED WHOLE, never half-parsed
// ───────────────────────────────────────────────────────────────────────────

describe("4 · out-of-scope constructs are carried raw", () => {
  // Each of these is a real linguex construct this build does not model. The
  // contract is task 350 defect C's, one dialect over: *never emit a node that
  // serializes to less than it consumed.* So the example is refused WHOLE and
  // its bytes are carried — never a partial model with the glossed tier or the
  // nesting flattened out of it.
  const OUT_OF_SCOPE: ReadonlyArray<readonly [string, string]> = [
    ["glossed example `\\exg.`", "\\exg. Der Hund \\\\\nthe dog \\\\\nThe dog"],
    ["glossed part `\\bg.`", "\\ex.\\a. One.\n\\bg. Der Hund \\\\\nthe dog \\\\\nThe dog"],
    ["explicit level close `\\z.`", "\\ex.\\a. One.\n\\z. Last."],
    ["a third nesting tier", "\\ex.\\a. One.\n\\a. Nested one.\n\\b. Nested two."],
    ["indented continuation `\\exi.`", "\\exi. A continued example."],
    ["repeated example `\\exr.`", "\\exr{s1}. The repeat."],
  ];

  for (const [name, body] of OUT_OF_SCOPE) {
    it(`${name} is carried whole, with every byte`, () => {
      const src = doc(body);
      // No node claims it …
      expect(blocksOf(parseLatex(src))).toHaveLength(0);
      // … and every line of it survives two save cycles unchanged.
      const { c1, c2 } = twoCycles(src);
      expect(c2).toBe(c1);
      for (const line of body.split("\n").filter((l) => l.trim() !== "")) {
        expect(c1, `${name}: lost ${JSON.stringify(line)}`).toContain(line.trim());
      }
    });
  }

  it("…while the in-scope CONTROL beside them is modelled", () => {
    // Without this the six legs above would pass with linguex support deleted
    // outright.
    expect(blocksOf(parseLatex(doc("\\ex.\\a. One.\n\\b. Two.")))).toHaveLength(1);
  });

  it("`\\i.` in prose is not read as a part marker", () => {
    // `\i` is dotless i, and `\i.` mid-sentence is ordinary text — the same
    // false-split class `splitPexBody` guards with `matchAccent`. The line-start
    // rule is what keeps it out of the item vocabulary.
    expect(matchLinguexItemAt("\\i. x", 0, false)).toBeNull();
    expect(matchLinguexItemAt("\\a. x", 0, true)).toEqual({ letter: "a", end: 3 });
    // `\z.` is deliberately NOT a part marker — it closes a level, which is a
    // nesting fact this build does not model.
    expect(matchLinguexItemAt("\\z. x", 0, true)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5 · the MINT rule for a new example
// ───────────────────────────────────────────────────────────────────────────

describe("5 · a new example takes the document's dominant dialect", () => {
  it("purely linguex ⇒ linguex; empty, expex, or MIXED ⇒ expex", () => {
    expect(dominantExampleDialect({ expex: 0, linguex: 3 })).toBe("linguex");
    expect(dominantExampleDialect({ expex: 0, linguex: 0 })).toBe("expex");
    expect(dominantExampleDialect({ expex: 2, linguex: 0 })).toBe("expex");
    // MIXED is the genuinely ambiguous case and takes the SAFE fallback: expex
    // is injected by the requirements pass from the emit itself, where linguex
    // is never injected at all.
    expect(dominantExampleDialect({ expex: 1, linguex: 5 })).toBe("expex");
    expect(DEFAULT_EXAMPLE_DIALECT).toBe("expex");
  });

  it("an attr from an older build, a paste, or another build reads as expex", () => {
    expect(exampleDialectOf(undefined)).toBe("expex");
    expect(exampleDialectOf({})).toBe("expex");
    expect(exampleDialectOf({ dialect: null })).toBe("expex");
    expect(exampleDialectOf({ dialect: "gb4e" })).toBe("expex");
    expect(exampleDialectOf({ dialect: "linguex" })).toBe("linguex");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6 · ACCEPTANCE — a `revise-1`-shaped paper
// ───────────────────────────────────────────────────────────────────────────

describe("6 · the reported paper's shape", () => {
  // Reconstructed, never copied: task 350 recorded that both files at the
  // reported Dropbox path are now Virgil output, and nothing of Gabriel's is
  // committed here. What this reproduces is the SHAPE — both packages loaded,
  // every example in linguex, labelled parts, cross-references, sections and
  // prose around them.
  const PAPER = [
    "\\section{Coherence}",
    "",
    "Consider the following three sentences:",
    "",
    "\\ex.\\label{s1}\\a.\\label{s1a} Susan went to the store.",
    "    \\b.\\label{s1b} Mary wanted cake.",
    "    \\c.\\label{s1c} It was her birthday.",
    "",
    "Each sentence in \\ref{s1} could be used independently.",
    "",
    "\\section{Discourse}",
    "",
    "More prose here that must survive.",
    "",
    "\\ex. A single unnumbered-part example.",
    "",
    "\\ex.\\a. Second multi example.",
    "    \\b. Another part.",
    "",
    "Closing paragraph.",
  ].join("\n");

  it("opens, models every example, and round-trips with nothing lost", () => {
    const src = doc(PAPER, BOTH);
    const parsed = parseLatex(src);
    // MODELLED, not carried — the whole difference from task 350's outcome.
    expect(blocksOf(parsed)).toHaveLength(3);
    expect(blocksOf(parsed).map((b) => exampleDialectOf(b.attrs))).toEqual([
      "linguex",
      "linguex",
      "linguex",
    ]);
    // Every example gets a uuid, which is what a card, a marginalia marker and
    // a sidecar title anchor to.
    for (const b of blocksOf(parsed)) expect(b.attrs?.uuid).toBeTruthy();

    const { c1, c2 } = twoCycles(src);
    expectAllPresent(c1, [
      "\\section{Coherence}",
      "Consider the following three sentences:",
      "Susan went to the store.",
      "Mary wanted cake.",
      "It was her birthday.",
      "could be used independently.",
      "\\section{Discourse}",
      "More prose here that must survive.",
      "A single unnumbered-part example.",
      "Second multi example.",
      "Another part.",
      "Closing paragraph.",
      // The linguex markup is content too — it is what makes these examples
      // examples when the paper is compiled.
      "\\ex.",
      "\\label{s1}",
      "\\label{s1c}",
    ]);
    expect(c1).not.toContain("\\xe");
    // A FIXED POINT from cycle 1: the paper does not move again on any later
    // save, which is what makes it safe to keep open in Virgil.
    expect(c2).toBe(c1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7 · CENSUS — everything downstream of the parse stays dialect-BLIND
// ───────────────────────────────────────────────────────────────────────────
//
// The leg with teeth. The parse and the serializer were never the part that
// can misbehave — a CONSUMER that starts special-casing the dialect is, and
// that would type-check perfectly while quietly reintroducing the per-dialect
// fork this design exists to prevent (a panel that hides linguex examples, a
// drop spec that refuses them, a numbering pass that counts them separately).
//
// So: the string literal `"linguex"` may appear in production code only where
// the dialect is DECIDED — the vocabulary, the two scanners that recognize it,
// the parser that stamps it, the serializer that branches on it. Every other
// layer must read the node and nothing else. A hit is a design question, not
// an allowlist entry.

const DIALECT_DECIDERS: readonly string[] = [
  "src/lib/example-dialect.ts", // the vocabulary + the mint rule
  "src/lib/latex-lexer.ts", // the two openers + the package probe
  "src/lib/latex-parser.ts", // asks the preamble, stamps the attr
  "src/lib/latex-serializer.ts", // the ONE branch
  "src/lib/latex-requirement-collector.ts", // the `\ex.` lookahead
];

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("7 · census · no consumer special-cases the dialect", () => {
  it("only the deciding layers spell the dialect", () => {
    const roots = ["src", "library"].filter((r) =>
      fs.existsSync(path.join(process.cwd(), r)),
    );
    const offenders: string[] = [];
    let examined = 0;
    for (const root of roots) {
      for (const file of walkFiles(path.join(process.cwd(), root))) {
        const rel = path.relative(process.cwd(), file);
        if (DIALECT_DECIDERS.includes(rel)) continue;
        examined++;
        // Comments stripped, string literals KEPT — the drift this watches for
        // lives in a literal comparison, and a doc comment mentioning linguex
        // is not a fork.
        if (/"linguex"|'linguex'|`linguex`/.test(commentsStripped(fs.readFileSync(file, "utf8")))) {
          offenders.push(rel);
        }
      }
    }
    expect(examined, "the census must actually sweep both silos").toBeGreaterThan(300);
    expect(
      offenders,
      "a layer outside the parse/serialize seam is special-casing the example " +
        "dialect — read the NODE instead, or make this a stated design decision",
    ).toEqual([]);
  });

  it("…and the needle can see a violation when there is one", () => {
    // A canary on a synthetic line rather than on a real one: a canary that
    // stands on the defect evaporates the moment the defect is drained.
    expect(
      /"linguex"|'linguex'|`linguex`/.test(
        commentsStripped('if (dialect === "linguex") hideCard();\n'),
      ),
    ).toBe(true);
    // …and does not fire on prose about it.
    expect(
      /"linguex"|'linguex'|`linguex`/.test(
        commentsStripped("// linguex examples render like any other\n"),
      ),
    ).toBe(false);
  });
});
