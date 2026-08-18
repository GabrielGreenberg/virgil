// Task 350 defect C — the example-body builder dropped, in silence, every block
// kind its target schema could not hold.
//
// `parseExampleBodyAsBlocks` had a whitelist `if`, two rescue branches
// (`codeBlock` → task 264, `latexComment` → task 347) and **no `else`**. Its own
// trailing comment admitted it: "Other unknown block types are still dropped."
// So a `heading`, `blockquote`, `figureBlock`, `texBlock`, `horizontalRule`, a
// NESTED `exampleBlock`, and a `\[…\]` in a `\pex` preamble all fell off the end
// of the loop and out of the user's document — on the first save, with no edit.
// Two sibling drop sites went with it: `buildExampleItemFromText`'s head filter
// deleted any `bulletList`/`orderedList` that reached an `\a` item (task 348's
// recorded residual) and every gloss after the first.
//
// The fix is 342's sentence twice over: the two rescues ARE the pattern, so make
// the DEFAULT what they do. A child the target cannot hold is CARRIED as a
// byte-literal paragraph cut from the ORIGINAL SOURCE — byte-exact by
// construction rather than by re-serialization luck, which is what makes it
// reachable from a leaf that cannot import the serializer.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-350 expex suite spells its
// example bodies with the constructs the whitelist happens to KEEP — prose, a
// gloss, a picture — so a heading or a blockquote inside an `\ex` body is
// unrepresentable in all of them. That is how this shipped. Each leg here drives
// the REAL save pipeline over TWO cycles: cycle 1 is where the loss happened,
// and cycle 2 is what proves nothing accumulates and nothing OSCILLATES — the
// failure mode the first cut of this fix had, and the reason the multiplicity
// rule is all-or-none rather than keep-the-first.
//
// Every CONTROL (a plain `\ex`, a `\pex` with a gloss, a single nested `xlist`)
// runs through the identical harness, so no leg can pass by breaking expex.
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";

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

function doc(body: string): string {
  return `\\documentclass{article}\n\\usepackage{expex}\n\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

/** Content survival is the contract; the carrier's exact formatting is not. */
function expectAllPresent(out: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !out.includes(n));
  expect(
    missing,
    `content destroyed by the save pipeline: ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

/** Survives cycle 1 AND settles — a fixed point by cycle 2. The second half is
 *  not decoration: the pre-fix drop was a fixed point too, so "stable" alone
 *  proves nothing, and "present" alone would have passed the oscillating first
 *  cut of this fix, which never stops rewriting the user's file. */
function expectCarriedAndSettled(
  input: string,
  needles: readonly string[],
): { c1: string; c2: string } {
  const { c1, c2 } = twoCycles(input);
  expectAllPresent(c1, needles);
  expect(c2, "the save pipeline never reached a fixed point").toBe(c1);
  return { c1, c2 };
}

// ---------------------------------------------------------------------------
// 1. Everything the whitelist dropped, swept per construct.
// ---------------------------------------------------------------------------

/** Each entry is a block kind `parseBody` produces that `exampleBlock` /
 *  `exampleItem` cannot hold. Pre-350 EVERY one of these lost its needles on
 *  cycle 1 (measured by neutering the carrier). */
const DROPPED_INSIDE_AN_EXAMPLE: ReadonlyArray<{
  name: string;
  body: string;
  needles: readonly string[];
}> = [
  {
    name: "heading",
    body: [
      "\\ex",
      "Body paragraph one.",
      "",
      "\\section{A heading inside the example}",
      "",
      "Body paragraph two.",
      "\\xe",
    ].join("\n"),
    needles: ["\\section{A heading inside the example}", "Body paragraph two."],
  },
  {
    name: "blockquote",
    body: [
      "\\ex",
      "Before.",
      "",
      "\\begin{quote}",
      "A quoted passage.",
      "\\end{quote}",
      "",
      "After.",
      "\\xe",
    ].join("\n"),
    needles: ["\\begin{quote}", "A quoted passage.", "\\end{quote}", "After."],
  },
  {
    name: "figure",
    body: [
      "\\ex",
      "Before fig.",
      "\\begin{figure}",
      "\\includegraphics{a.png}",
      "\\caption{The caption}",
      "\\end{figure}",
      "After fig.",
      "\\xe",
    ].join("\n"),
    needles: ["\\includegraphics{a.png}", "The caption", "After fig."],
  },
  {
    name: "horizontal rule",
    body: ["\\ex", "Before.", "", "\\hrule", "", "After.", "\\xe"].join("\n"),
    needles: ["\\hrule", "After."],
  },
  {
    name: "a NESTED example",
    body: [
      "\\ex",
      "Outer prose.",
      "\\ex",
      "Inner example prose.",
      "\\xe",
      "Outer tail.",
      "\\xe",
    ].join("\n"),
    needles: ["Inner example prose.", "Outer tail."],
  },
  {
    name: "display math in a \\pex PREAMBLE",
    // The `preamble` target is deliberately narrower than `block` by
    // `displayMath` — pre-350 it passed `allowDisplayMath: false` and the
    // equation was DROPPED. Narrower is fine; dropping is not.
    body: [
      "\\pex",
      "Preamble prose.",
      "\\[",
      "x^2 = y",
      "\\]",
      "\\a item one",
      "\\xe",
    ].join("\n"),
    needles: ["x^2 = y", "item one"],
  },
];

describe("an example body carries what its schema cannot model", () => {
  for (const c of DROPPED_INSIDE_AN_EXAMPLE) {
    it(`${c.name} survives an open, and settles`, () => {
      expectCarriedAndSettled(doc(c.body), c.needles);
    });
  }

  it("a texBlock's raw LaTeX inside an example body survives", () => {
    // `%!vtex:begin` is Virgil's OWN round-trip marker for raw passthrough, so
    // dropping it lost source the user had explicitly asked to be left alone.
    const { c1 } = expectCarriedAndSettled(
      doc(
        [
          "\\ex",
          "Before.",
          "",
          "%!vtex:begin aa11",
          "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}",
          "%!vtex:end aa11",
          "",
          "After.",
          "\\xe",
        ].join("\n"),
      ),
      ["\\draw (0,0) -- (1,1);", "After."],
    );
    // …and it is carried ONCE, not duplicated. A single `parseBody` iteration
    // can push more than one child, and both carry the same span; emitting that
    // span per child would double the user's bytes on every save.
    expect(c1.split("\\begin{tikzpicture}").length - 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The two sibling drop sites inside an `\a` item.
// ---------------------------------------------------------------------------

describe("the item head filter is a partition, not a whitelist", () => {
  // Measured, so the claim is not overstated: what rescues these two shapes is
  // the CARRIER, which hands the head filter a `paragraph` where the pre-350
  // code handed it a `bulletList` and the three-name filter then deleted it.
  // Rewriting the filter back to that whitelist fails nothing here — the
  // partition is a hardening against a future widening of the item's accept
  // set, and the comment at the site says so.
  it("a nested itemize inside an \\a item survives (task 348's residual)", () => {
    expectCarriedAndSettled(
      doc(
        [
          "\\pex",
          "\\a First item.",
          "\\begin{itemize}",
          "\\item alpha",
          "\\item beta",
          "\\end{itemize}",
          "\\a Second item.",
          "\\xe",
        ].join("\n"),
      ),
      ["\\item alpha", "\\item beta", "Second item."],
    );
  });

  it("a nested enumerate inside an \\a item survives", () => {
    expectCarriedAndSettled(
      doc(
        [
          "\\pex",
          "\\a Head.",
          "\\begin{enumerate}",
          "\\item one",
          "\\end{enumerate}",
          "\\xe",
        ].join("\n"),
      ),
      ["\\item one"],
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Multiplicity — all-or-none, because keep-the-first OSCILLATES.
// ---------------------------------------------------------------------------

describe("a container slot that holds ONE holds none when there are two", () => {
  it("two glosses in one item both survive, in the user's order", () => {
    const { c1 } = expectCarriedAndSettled(
      doc(
        [
          "\\pex",
          "\\a",
          "\\begingl",
          "\\gla one two//",
          "\\glft 'first'//",
          "\\endgl",
          "\\begingl",
          "\\gla three four//",
          "\\glft 'second'//",
          "\\endgl",
          "\\xe",
        ].join("\n"),
      ),
      ["'first'", "'second'"],
    );
    // ORDER, not just survival. Keep-the-first put the CARRIED gloss ahead of
    // the modelled one (a carrier is a paragraph, and the schema puts every
    // paragraph before the trailing `exampleGloss?`) — so the two swapped on
    // every save, forever, on a document nobody was editing.
    expect(c1.indexOf("'first'")).toBeLessThan(c1.indexOf("'second'"));
  });

  it("two sibling xlists in one item both survive, in order", () => {
    const { c1 } = expectCarriedAndSettled(
      doc(
        [
          "\\pex",
          "\\a Head.",
          "\\begin{xlist}",
          "\\a inner one",
          "\\end{xlist}",
          "\\begin{xlist}",
          "\\a inner two",
          "\\end{xlist}",
          "\\xe",
        ].join("\n"),
      ),
      ["inner one", "inner two"],
    );
    expect(c1.indexOf("inner one")).toBeLessThan(c1.indexOf("inner two"));
  });
});

// ---------------------------------------------------------------------------
// 4. What the carrier must NOT do.
// ---------------------------------------------------------------------------

describe("a carrier conveys bytes; it never rewrites them", () => {
  it("straight quotes and double hyphens inside a carried env are untouched", () => {
    // The mark matters: the raw-LaTeX mark runs `smartenStraightQuotes`, so a
    // carried `\begin{quote}` would come back with `` `` ``…'' `` on the first
    // save — silent, durable and idempotent on the corrupted form (task 342's
    // fancyvrb finding, one construct over). The carrier takes the VERBATIM
    // mark for exactly that reason.
    const { c1 } = expectCarriedAndSettled(
      doc(
        [
          "\\ex",
          "Before.",
          "",
          "\\begin{quote}",
          'He said "hello" -- twice.',
          "\\end{quote}",
          "\\xe",
        ].join("\n"),
      ),
      ['He said "hello" -- twice.'],
    );
    expect(c1).not.toContain("``hello''");
    expect(c1).not.toContain("–"); // en dash from `--`
  });

  it("a footnote beside a carried construct is not doubled", () => {
    // The fallback this REPLACES re-emitted `body.trim()` — the WHOLE body — as
    // a latex-command paragraph, which leaked every `\vfid{}` / `\vcid{}`
    // marker back into the source verbatim and doubled the matched footnotes on
    // every save→reload. That is why it was deleted with nothing put in its
    // place. Carrying THIS CHILD's span rather than the body is what makes a
    // carrier affordable.
    const { c1 } = expectCarriedAndSettled(
      doc(
        [
          "\\ex",
          "Prose with a note.\\footnote{The note body.}",
          "",
          "\\section{Buried}",
          "\\xe",
        ].join("\n"),
      ),
      ["The note body.", "\\section{Buried}"],
    );
    expect(c1.split("The note body.").length - 1).toBe(1);
    expect(c1.split("\\section{Buried}").length - 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Controls — the model is not thrown away to buy the carrier.
// ---------------------------------------------------------------------------

describe("controls: expex still models what it always modelled", () => {
  const CONTROLS: ReadonlyArray<{ name: string; body: string }> = [
    { name: "a plain \\ex", body: "\\ex\nJust prose here.\n\\xe" },
    {
      name: "a \\pex with items",
      body: "\\pex\n\\a first\n\\a second\n\\xe",
    },
    {
      name: "an item with ONE gloss",
      body:
        "\\pex\n\\a\n\\begingl\n\\gla one two//\n\\glft 'a gloss'//\n\\endgl\n\\xe",
    },
    {
      name: "an item with ONE nested xlist",
      body:
        "\\pex\n\\a Head.\n\\begin{xlist}\n\\a inner\n\\end{xlist}\n\\xe",
    },
    {
      name: "a picture and an equation in a single \\ex body",
      body: "\\ex\nPic:\n\\includegraphics{p.png}\n\\[\nz = 1\n\\]\n\\xe",
    },
  ];

  for (const c of CONTROLS) {
    it(`${c.name} round-trips and settles`, () => {
      const { c1, c2 } = twoCycles(doc(c.body));
      expect(c2).toBe(c1);
    });
  }

  it("the single nested xlist is still MODELLED, not merely carried", () => {
    // The all-or-none multiplicity rule costs the nested-list model when there
    // are two. It must cost nothing when there is one — a `\vxid{…}` on the
    // inner item is the fingerprint of a real `exampleItem`, which a
    // byte-literal carrier would never grow.
    const c1 = save(
      doc("\\pex\n\\a Head.\n\\begin{xlist}\n\\a inner\n\\end{xlist}\n\\xe"),
    );
    expect(c1).toMatch(/\\begin\{xlist\}\s*\n\\vxid\{[0-9a-f]+\}\\a inner/);
  });

  it("the shipped reference paper is byte-stable across two saves", () => {
    // The corpus control: whatever this fix does, it must not move the bytes of
    // the document the whole app is developed against.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../../../samples/annotation-history/document.tex"),
      "utf8",
    ) as string;
    const { c1, c2 } = twoCycles(src);
    expect(c2).toBe(c1);
  });
});
