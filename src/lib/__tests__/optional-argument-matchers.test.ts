// Task 376 — a MODELED construct's matcher hand-wrote "name then `{`", so a
// legal LaTeX spelling the hand regex did not accept either DEMOTED the
// construct to the raw carrier (bytes safe, model gone, every feature derived
// from the node silently dead) or was CLAIMED and then re-emitted without the
// part the matcher could not see (bytes changed).
//
// Six measured members, every one of them a FIXED POINT and every one landing
// on OPEN via `readDocBundle`'s unconditional load-writeback:
//
//   M1  `\section[Intro]{Introduction}`        → a PARAGRAPH, not a heading
//   M2  the level↔command vocabulary spelled FOUR times; `headingTypeCommand` dead
//   M3  `\begin{enumerate}[label=(\roman*)]`   → options DELETED, (i)/(ii) → 1./2.
//   M4  `\caption*{Overview}`                  → star DELETED, every later figure renumbers
//   M5  `\footnote[3]{…}`                      → no footnote node, no card, no marker
//   M6  `\title[Short]{Long}`                  → not a title field
//
// The unifying diagnosis: task 349 built `matchCommandArgumentRun` for exactly
// the question "what are this command's arguments?" and answered it correctly
// for any arity, any order, star included — and only the CARRIER path adopted
// it. Every matcher for a construct Virgil actually MODELS kept its own regex.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-376 fixture in the repo spells
// these constructs the one way the code happens to handle — `\section{X}`,
// `\begin{enumerate}`, `\caption{X}`, `\footnote{X}`, `\title{X}` — so an
// optional argument or a star reaching a modeled matcher was unrepresentable in
// all of them. Each leg here drives the REAL save pipeline (`parseLatex` →
// `assignUuids` → `serializeToLatex` with the REAL extracted delimiters, which
// is byte for byte what `storage-fsa.writeDocBundle` does) over TWO cycles,
// because cycle 1 is where the loss happens and cycle 2 is what proves nothing
// accumulates. Every PLAIN-FORM CONTROL runs through the identical harness so
// no leg can pass vacuously — and every leg asserts the node TYPE as well as
// the bytes, because a heading that round-trips as a carrier IS the defect and
// a byte assertion alone cannot see it.
//
// MEASURED by neutering each half in turn: the sectioning door takes 18 legs,
// the list options 4 (from either side), the caption star 3, the title door 3,
// the footnote door 2, and the brace-aware bracket scanner 1. The serializer's
// level-indexed `commands` array takes exactly ONE — the CENSUS — because it
// emits byte-identical output, which is the whole reason the census is the leg
// with teeth here and a behavioural assertion is not.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { HEADING_TYPES } from "@/lib/heading-types";
import { findSectioningCommands } from "@/lib/document-class";
import {
  matchSectioningCommandAt,
  matchSectioningUseAt,
  matchStarOptBraceAt,
} from "@/lib/latex-lexer";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

// ───────────────────────────────────────────────────────────────────────────
// Harness — the real save pipeline, twice.
// ───────────────────────────────────────────────────────────────────────────

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

/** The `\begin{document}` … `\end{document}` body with `%!v:` anchors and the
 *  `\vfid`/`\vcid` id markers blanked — both are freshly minted on a first save,
 *  so a byte comparison against hand-written input is only about CONTENT. */
function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/\\v[fc]id\{[0-9a-f]+\}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

/** Two full cycles; the body must be a FIXED POINT from cycle 1 — the property
 *  every one of these defects also had, which is precisely why a single-cycle
 *  assertion could never have caught any of them. */
function twoCycles(input: string): string {
  const c1 = save(input);
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  return body(c1);
}

/** The strongest statement available: the bytes the user wrote come back
 *  byte-identical, and stay that way on the next save. */
function expectStable(input: string): void {
  expect(twoCycles(input)).toBe(input.trim());
}

/** Every node of `type` anywhere in the tree. */
function findByType(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  (function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  })(doc);
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// M1 / M2 — sectioning
// ───────────────────────────────────────────────────────────────────────────
//
// `/^\\(part|…)(\*?)\{/` required the brace to ABUT the name, so
// `\section[Intro]{Introduction}` parsed to a PARAGRAPH carrying a
// `latexCommand` mark. The bytes round-tripped (task 349/360's carrier did its
// job) and the whole heading apparatus was dead for an ordinary construct: no
// Outline row, no folding, no section number, no `\label`/`\ref` resolution, no
// `\partitle`, no focus band, no heading word counts, and grey monospace where
// a styled heading belongs.
//
// The sweep runs FROM `HEADING_TYPES`, so an eighth level is covered by
// declaration alone.

describe("M1 — a sectioning command with an optional argument is a HEADING", () => {
  for (const { command, level } of HEADING_TYPES) {
    it(`\\${command}[Short]{Long} parses to a heading and keeps its bracket`, () => {
      const src = `\\${command}[Short]{Long title}\n`;
      const doc = parseLatex(src);
      const headings = findByType(doc, "heading");
      expect(headings, `\\${command}[…]{…} must be a heading`).toHaveLength(1);
      expect(headings[0].attrs?.level).toBe(level);
      expect(headings[0].attrs?.shortTitle).toBe("Short");
      expect(headings[0].attrs?.numbered).toBe(true);
      expectStable(src);
    });

    it(`\\${command}*[Short]{Long} keeps BOTH the star and the bracket`, () => {
      const src = `\\${command}*[Short]{Long title}\n`;
      const headings = findByType(parseLatex(src), "heading");
      expect(headings).toHaveLength(1);
      expect(headings[0].attrs?.numbered).toBe(false);
      expect(headings[0].attrs?.shortTitle).toBe("Short");
      expectStable(src);
    });

    // The CONTROL: the plain form, through the identical harness. If a leg
    // above ever passes for the wrong reason, this one says so.
    it(`CONTROL \\${command}{Long} is unchanged`, () => {
      const src = `\\${command}{Long title}\n`;
      const headings = findByType(parseLatex(src), "heading");
      expect(headings).toHaveLength(1);
      expect(headings[0].attrs?.shortTitle ?? null).toBeNull();
      expectStable(src);
    });
  }

  it("the whitespace-separated spelling is a heading (TeX accepts it)", () => {
    // TeX skips spaces while scanning for an argument, so `\section {X}` and
    // `\section\n{X}` are the same document as `\section{X}`. All four
    // hand-written matchers declined them while the compat checker accepted
    // them — the fork this door retires. Both normalize to the canonical
    // spelling on the first save and are fixed points thereafter.
    for (const src of ["\\section {X}\n", "\\section\n{X}\n"]) {
      expect(findByType(parseLatex(src), "heading")).toHaveLength(1);
      expect(twoCycles(src)).toBe("\\section{X}");
    }
  });

  it("a `\\section` with no argument is NOT claimed — it rides the carrier", () => {
    // The refusal direction (task 356): a sectioning command with nothing to
    // name is not a heading, and the carrier keeps its bytes rather than the
    // model claiming it and re-emitting something else.
    //
    // Asserted as a FIXED POINT plus the surviving bytes rather than as byte
    // equality with the input: a mid-line block-boundary command splits the
    // paragraph, which is pre-existing behaviour (measured on the pre-376 tree)
    // and not what this leg is about.
    const src = "The \\section command takes an argument.\n";
    expect(findByType(parseLatex(src), "heading")).toHaveLength(0);
    expect(twoCycles(src)).toContain("\\section command takes an argument.");
  });

  it("a heading's `[short]` survives an edit to its TITLE", () => {
    // The attr is on the NODE, not re-read from source at save time — the same
    // reason `listItem.itemLabel` is (task 340). Editing the title must not
    // drop the running head.
    const doc = parseLatex("\\section[Short]{Long title}\n");
    const heading = findByType(doc, "heading")[0];
    heading.content = [{ type: "text", text: "Different title" }];
    assignUuids(doc);
    expect(serializeToLatex(doc)).toContain("\\section[Short]{Different title}");
  });
});

describe("M2 — one vocabulary, read by every layer", () => {
  it("`headingTypeCommand` is what the serializer emits, for every level", () => {
    // It had ZERO callers anywhere while the serializer kept its own
    // level-indexed array — the dead-SSOT shape (task 202).
    //
    // Stated honestly rather than generously: this leg pins the OUTPUT, and the
    // array it replaced produced the same bytes, so reinstating that array
    // leaves this leg green. What catches the re-fork is the CENSUS below —
    // measured, it is the only leg that fails on that neuter. This one exists
    // so a WRONG derivation (a stale table, an off-by-one clamp) is caught by
    // something other than a grep.
    for (const { command, level } of HEADING_TYPES) {
      const doc: JSONContent = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level }, content: [{ type: "text", text: "T" }] },
        ],
      };
      expect(serializeToLatex(doc)).toContain(`\\${command}{T}`);
    }
  });

  it("the compat checker sees exactly what the parser sees", () => {
    // Pre-376 these two disagreed and only the checker was right: it accepted
    // the bracket AND the whitespace, so it correctly reported a
    // `\chapter[Short]{X}` the parser had already thrown away.
    for (const src of [
      "\\chapter[Short]{X}\n",
      "\\chapter*{X}\n",
      "\\chapter {X}\n",
      "\\chapter{X}\n",
    ]) {
      expect(findSectioningCommands(src), src).toEqual(new Set(["chapter"]));
      expect(findByType(parseLatex(src), "heading"), src).toHaveLength(1);
    }
  });

  it("the compat checker still answers for a spelling the PARSER refuses", () => {
    // Deliberately weaker than the parser's question: an undefined control
    // sequence errors whatever its arguments look like, so a malformed
    // `\chapter[Short]` still reaches for `\chapter`.
    expect(findSectioningCommands("\\chapter[Short]\n")).toEqual(
      new Set(["chapter"]),
    );
  });

  it("a commented-out or verbatim sectioning command is still inert", () => {
    // Non-regression: the projection half of `findSectioningCommands`.
    expect(findSectioningCommands("% \\chapter{X}\n")).toEqual(new Set());
    expect(
      findSectioningCommands("\\begin{verbatim}\n\\chapter{X}\n\\end{verbatim}\n"),
    ).toEqual(new Set());
  });

  it("a bare mention with no argument is not a use", () => {
    expect(findSectioningCommands("Prose about \\section and friends.\n")).toEqual(
      new Set(),
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M3 — list options
// ───────────────────────────────────────────────────────────────────────────
//
// `parseBody` captured the `[...]` and used it ONLY on the refusal path;
// `parseList` took no options parameter and the serializer emitted a bare
// `\begin{enumerate}`. The user's list reverted from (i)/(ii) to 1./2. in the
// PDF at a cost of three word tokens — under `PRESERVATION_SLACK_WORDS = 4`, so
// the write gate was silent. `figure` kept its `[htbp]` and the unmodeled-env
// carrier re-emitted its bracket; this branch was the outlier.

describe("M3 — a list keeps its options", () => {
  for (const env of ["itemize", "enumerate"] as const) {
    const type = env === "itemize" ? "bulletList" : "orderedList";

    it(`\\begin{${env}}[opts] keeps them and is still a ${type}`, () => {
      const src = `\\begin{${env}}[label=(\\roman*),leftmargin=*]\n  \\item one\n  \\item two\n\\end{${env}}\n`;
      const lists = findByType(parseLatex(src), type);
      expect(lists).toHaveLength(1);
      expect(lists[0].attrs?.listOptions).toBe("[label=(\\roman*),leftmargin=*]");
      expectStable(src);
    });

    it(`CONTROL a bare \\begin{${env}} stays bare`, () => {
      const src = `\\begin{${env}}\n  \\item one\n\\end{${env}}\n`;
      const lists = findByType(parseLatex(src), type);
      expect(lists).toHaveLength(1);
      expect(lists[0].attrs?.listOptions ?? null).toBeNull();
      expectStable(src);
    });
  }

  it("an option holding a braced `]` is captured whole", () => {
    // The pre-376 capture was `/^\[[^\]]*\]/`, which stops at the first `]`
    // whatever encloses it — so `[label={[\arabic*]}]`, an ordinary enumitem
    // spelling for bracketed markers, was truncated mid-option and the
    // remainder fell into the list body. Survivable while the options were
    // being DELETED anyway; not once the bytes are carried and re-emitted.
    // `extractBracketed` is brace-depth aware, which is the whole difference.
    const src =
      "\\begin{enumerate}[label={[\\arabic*]}]\n  \\item one\n\\end{enumerate}\n";
    const list = findByType(parseLatex(src), "orderedList")[0];
    expect(list.attrs?.listOptions).toBe("[label={[\\arabic*]}]");
    expectStable(src);
  });

  it("options survive alongside a list preamble and per-item labels", () => {
    const src =
      "\\begin{itemize}[leftmargin=*]\n  \\setlength{\\itemsep}{0pt}\n  \\item[(a)] one\n\\end{itemize}\n";
    const list = findByType(parseLatex(src), "bulletList")[0];
    expect(list.attrs?.listOptions).toBe("[leftmargin=*]");
    expect(list.attrs?.listPreamble).toContain("\\setlength");
    expectStable(src);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M4 — `\caption*`
// ───────────────────────────────────────────────────────────────────────────
//
// `CONTROL_WORD_RE` swallowed the star into `m[0]` while `m[1]` was `caption`,
// so the starred caption was claimed as the figure's own, its range (star
// included) was cut from `extras`, and the builder re-emitted `\caption{…}`
// unconditionally. The figure then consumed a figure number and a
// List-of-Figures row, so every LATER figure renumbered and every `\ref` to
// them printed a different number. One byte, zero word tokens — invisible to
// every gate.
//
// The star is read into `numbered`, which is what it MEANS in LaTeX, rather
// than a second parallel fact — and that also gives the `numbered` toggle
// persistence it never had (nothing serialized it before).

describe("M4 — a starred caption keeps its star", () => {
  it("`\\caption*` round-trips and marks the figure UNNUMBERED", () => {
    const src =
      "\\begin{figure}\n  \\includegraphics{a}\n  \\caption*{Overview}\n\\end{figure}\n";
    const fig = findByType(parseLatex(src), "figureBlock")[0];
    expect(fig.attrs?.hasCaption).toBe(true);
    expect(fig.attrs?.numbered).toBe(false);
    expect(fig.attrs?.figureNumber ?? null).toBeNull();
    // Fixed point plus the byte that matters. (`buildFigureEnvBody` puts one
    // blank line before `extras`; that normalization is pre-existing and is
    // what the figure round-trip suite already pins.)
    expect(twoCycles(src)).toContain("\\caption*{Overview}");
  });

  it("CONTROL a plain `\\caption` is numbered and unchanged", () => {
    const src =
      "\\begin{figure}\n  \\includegraphics{a}\n  \\caption{Overview}\n\\end{figure}\n";
    const fig = findByType(parseLatex(src), "figureBlock")[0];
    expect(fig.attrs?.numbered).toBe(true);
    expect(fig.attrs?.figureNumber).toBe(1);
    const out = twoCycles(src);
    expect(out).toContain("\\caption{Overview}");
    expect(out).not.toContain("\\caption*");
  });

  it("a starred caption does not consume a number from its siblings", () => {
    // The user-visible harm: with the star deleted, the starred figure took
    // number 1 and every later figure — and every `\ref` to it — moved by one.
    const src =
      "\\begin{figure}\n  \\caption*{Decoration}\n\\end{figure}\n\n" +
      "\\begin{figure}\n  \\caption{Real one}\n\\end{figure}\n";
    const figs = findByType(parseLatex(src), "figureBlock");
    expect(figs.map((f) => f.attrs?.figureNumber ?? null)).toEqual([null, 1]);
    const out = twoCycles(src);
    expect(out).toContain("\\caption*{Decoration}");
    expect(out).toContain("\\caption{Real one}");
  });

  it("`\\caption*[Short]` keeps both the star and the LoF argument", () => {
    const src = "\\begin{figure}\n  \\caption*[Short]{Long}\n\\end{figure}\n";
    const fig = findByType(parseLatex(src), "figureBlock")[0];
    expect(fig.attrs?.shortCaption).toBe("Short");
    expect(fig.attrs?.numbered).toBe(false);
    expect(twoCycles(src)).toContain("\\caption*[Short]{Long}");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M5 — `\footnote[n]{}`
// ───────────────────────────────────────────────────────────────────────────
//
// Measured pre-376: no `footnote` node, no `\vfid` marker, no card, no panel
// row — it stayed raw text, where the plain form gets the full apparatus.

describe("M5 — `\\footnote[n]{…}` is a footnote", () => {
  it("parses to a footnote node and keeps its optional argument", () => {
    const src = "Text.\\footnote[3]{A note.}\n";
    const notes = findByType(parseLatex(src), "footnote");
    expect(notes).toHaveLength(1);
    expect(notes[0].attrs?.numberOverride).toBe("3");
    expect(save(src)).toContain("\\footnote[3]{A note.}");
    expectStable(src);
  });

  it("CONTROL a plain `\\footnote` is unchanged and carries no override", () => {
    const src = "Text.\\footnote{A note.}\n";
    const notes = findByType(parseLatex(src), "footnote");
    expect(notes).toHaveLength(1);
    expect(notes[0].attrs?.numberOverride ?? null).toBeNull();
    expectStable(src);
  });

  it("gets the id marker the plain form gets (the apparatus, not just bytes)", () => {
    // The `\vfid` marker is what makes a footnote's card identity survive a
    // save; a footnote that is merely raw text has none.
    expect(save("Text.\\footnote[3]{A note.}\n")).toMatch(/\\vfid\{[0-9a-f]+\}\\footnote\[3\]/);
  });

  it("`\\thanks` never takes an optional argument", () => {
    // It has none in LaTeX, so the emitter must not invent one even if a node
    // arrives carrying an override.
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "footnote",
              attrs: { thanks: true, numberOverride: "3", content: null },
            },
          ],
        },
      ],
    };
    expect(serializeToLatex(doc)).toContain("\\thanks{");
    expect(serializeToLatex(doc)).not.toContain("\\thanks[");
  });

  it("`\\thanks` takes the same door and REFUSES a spelling it cannot carry", () => {
    // The last hand-written twin of this shape, converted with its sibling so
    // the two cannot drift on what an argument looks like. `\thanks` has
    // neither a star nor an optional argument, so a spelling carrying one goes
    // to the carrier rather than being claimed and re-emitted without it.
    const plain = "\\author{Jane\\thanks{Supported by X.}}\n";
    expect(findByType(parseLatex(plain), "footnote")).toHaveLength(1);
    expect(save(plain)).toContain("\\thanks{Supported by X.}");

    const spaced = "\\author{Jane\\thanks {Supported by X.}}\n";
    expect(findByType(parseLatex(spaced), "footnote")).toHaveLength(1);

    const withOpt = "Text.\\thanks[2]{Nope.}\n";
    expect(findByType(parseLatex(withOpt), "footnote")).toHaveLength(0);
    expect(twoCycles(withOpt)).toContain("\\thanks[2]{Nope.}");
  });

  it("a modeled construct consumes its OWN arity, not the maximal run", () => {
    // `matchCommandArgumentRun` is deliberately MAXIMAL (up to nine groups) —
    // right for the carrier, wrong here. `\footnote{a}{b}` is a footnote whose
    // body is `a`, followed by a bare prose group; a maximal read would swallow
    // `{b}` into the note.
    const notes = findByType(parseLatex("x\\footnote{a}{b}\n"), "footnote");
    expect(notes).toHaveLength(1);
    expect(JSON.stringify(notes[0].attrs?.content)).toContain("a");
    expect(JSON.stringify(notes[0].attrs?.content)).not.toContain("b");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M6 — `\title[Short]{Long}`
// ───────────────────────────────────────────────────────────────────────────
//
// Legal on all three fields in beamer / revtex / acmart. Pre-376 it was not a
// `titleField`: not hoisted into the preamble and not editable in the title
// strip.

describe("M6 — a title field with a short form", () => {
  const doc = (preamble: string) =>
    `\\documentclass{beamer}\n${preamble}\\begin{document}\n\\maketitle\n\nBody.\n\\end{document}\n`;

  it("`\\title[Short]{Long}` in the preamble is a titleField and keeps its bracket", () => {
    const src = doc("\\title[Short]{Long Title}\n");
    const fields = findByType(parseLatex(src), "titleField");
    expect(fields).toHaveLength(1);
    expect(fields[0].attrs?.field).toBe("title");
    expect(fields[0].attrs?.shortTitle).toBe("Short");
    const c1 = save(src);
    expect(c1).toContain("\\title[Short]{Long Title}");
    expect(save(c1)).toBe(c1);
  });

  it("`\\author[JD]{Jane Doe}` and `\\date[s]{long}` too", () => {
    const src = doc("\\author[JD]{Jane Doe}\n\\date[s]{September}\n");
    const fields = findByType(parseLatex(src), "titleField");
    expect(fields.map((f) => f.attrs?.field)).toEqual(["author", "date"]);
    const c1 = save(src);
    expect(c1).toContain("\\author[JD]{Jane Doe}");
    expect(c1).toContain("\\date[s]{September}");
    expect(save(c1)).toBe(c1);
  });

  it("CONTROL the plain forms are unchanged", () => {
    const src = doc("\\title{Long Title}\n\\author{Jane Doe}\n");
    const fields = findByType(parseLatex(src), "titleField");
    expect(fields).toHaveLength(2);
    expect(fields[0].attrs?.shortTitle ?? null).toBeNull();
    const c1 = save(src);
    expect(c1).toContain("\\title{Long Title}");
    expect(c1).not.toContain("\\title[");
    expect(save(c1)).toBe(c1);
  });

  it("a BODY-position `\\title[Short]{Long}` reads the same grammar", () => {
    const src = "\\title[Short]{Long Title}\n\n\\maketitle\n\nBody.\n";
    const fields = findByType(parseLatex(src), "titleField");
    expect(fields).toHaveLength(1);
    expect(fields[0].attrs?.shortTitle).toBe("Short");
    expect(save(src)).toContain("\\title[Short]{Long Title}");
  });

  it("a repeated field still stays RAW in the preamble (task 356 unchanged)", () => {
    // Non-regression: hoisting is only for a field that occurs exactly ONCE
    // live, and an optional argument must not change that rule.
    const src = doc("\\author[A]{Alice}\n\\author[B]{Bob}\n");
    expect(findByType(parseLatex(src), "titleField")).toHaveLength(0);
    const c1 = save(src);
    expect(c1).toContain("\\author[A]{Alice}");
    expect(c1).toContain("\\author[B]{Bob}");
    expect(save(c1)).toBe(c1);
  });

  it("a commented-out `\\title` is still inert (task 356 unchanged)", () => {
    const src = doc("%\\title[Old]{Old draft}\n\\title{Real}\n");
    const fields = findByType(parseLatex(src), "titleField");
    expect(fields).toHaveLength(1);
    expect(fields[0].content?.[0]?.text).toBe("Real");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The shared door's own contract
// ───────────────────────────────────────────────────────────────────────────

describe("matchStarOptBraceAt — the `[opt]{req}` shape", () => {
  it("reads star, bracket and brace in the LaTeX order", () => {
    const hit = matchStarOptBraceAt("*[a]{b}rest", 0);
    expect(hit).toEqual({ starred: true, optional: "a", required: "b", end: 7 });
  });

  it("a bare brace has no optional argument", () => {
    expect(matchStarOptBraceAt("{b}", 0)).toEqual({
      starred: false,
      optional: null,
      required: "b",
      end: 3,
    });
  });

  it("REFUSES when no required brace follows", () => {
    expect(matchStarOptBraceAt("[a]", 0)).toBeNull();
    expect(matchStarOptBraceAt(" prose", 0)).toBeNull();
  });

  it("skips the gap before the FIRST argument but not a blank line", () => {
    expect(matchStarOptBraceAt(" {b}", 0)?.required).toBe("b");
    expect(matchStarOptBraceAt("\n{b}", 0)?.required).toBe("b");
    expect(matchStarOptBraceAt("\n\n{b}", 0)).toBeNull();
  });

  it("stops at the FIRST brace — the arity is the construct's, not maximal", () => {
    const hit = matchStarOptBraceAt("{a}{b}", 0);
    expect(hit?.required).toBe("a");
    expect(hit?.end).toBe(3);
  });

  it("fails closed on an unbalanced group", () => {
    expect(matchStarOptBraceAt("{a", 0)).toBeNull();
  });
});

describe("the sectioning door", () => {
  it("membership is the seven names and nothing else", () => {
    // Asked through the DOOR rather than a published `isSectioningCommand`
    // predicate: that export had no production caller, and a suite is not a
    // consumer (task 202's WIRE-it-or-DELETE-it).
    for (const { command } of HEADING_TYPES) {
      expect(matchSectioningUseAt(`\\${command}{X}`, 0)?.command).toBe(command);
    }
    for (const other of ["sectioning", "sec", "subsubsubsection", "caption"]) {
      expect(matchSectioningUseAt(`\\${other}{X}`, 0)).toBeNull();
    }
  });

  it("a longer command that merely STARTS with a sectioning name is not one", () => {
    // `matchCommandToken` is greedy, so `\sectionmark` reads as `sectionmark`.
    expect(matchSectioningUseAt("\\sectionmark{X}", 0)).toBeNull();
    expect(matchSectioningCommandAt("\\sectionmark{X}", 0)).toBeNull();
  });

  it("reports the whole construct's extent", () => {
    const hit = matchSectioningCommandAt("\\section*[S]{Long} tail", 0);
    expect(hit).toMatchObject({
      command: "section",
      level: 2,
      starred: true,
      shortTitle: "S",
      title: "Long",
    });
    expect(hit?.end).toBe("\\section*[S]{Long}".length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The census — the leg with teeth
// ───────────────────────────────────────────────────────────────────────────
//
// The door was never the part that could misbehave; a call site that spells the
// vocabulary itself is, and that type-checks perfectly. Measured on the pre-376
// tree this names FOUR spellings of one alternation — the parser's regex, the
// serializer's level-indexed array, `document-class`'s scanning regex, and the
// lexer's own block-boundary set — of which only the one that decided nothing
// had the grammar right.

const SECTIONING_NAMES = HEADING_TYPES.map((t) => t.command);

/** Every production `.ts`/`.tsx` under `src/`. */
function productionSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      productionSources(p, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

/** Lines naming three or more DISTINCT sectioning commands — what an
 *  alternation, an array or a level-indexed list looks like, and what a single
 *  mention (a slash-command row, an action id) never does. Comments are
 *  stripped; string literals are KEPT, because that is where the drift lives. */
function sectioningVocabularyLines(): Array<{ file: string; line: number }> {
  const hits: Array<{ file: string; line: number }> = [];
  for (const file of productionSources("src")) {
    // `commentsStripped` BLANKS rather than deletes, so line numbers below are
    // the stripped text's own — which is what the exemption range is computed
    // against too, so the two can never be off by a comment.
    commentsStripped(readFileSync(file, "utf8"))
      .split("\n")
      .forEach((line, i) => {
        const named = SECTIONING_NAMES.filter((n) =>
          new RegExp(`\\b${n}\\b`).test(line),
        );
        if (named.length >= 3) hits.push({ file, line: i + 1 });
      });
  }
  return hits;
}

/** The 1-based line range of a top-level `const NAME … };` declaration, read
 *  from the SAME stripped text the census scans. */
function declarationLines(
  file: string,
  name: string,
): { from: number; to: number } {
  const code = commentsStripped(readFileSync(file, "utf8"));
  const start = code.indexOf(`const ${name}`);
  expect(start, `${name} must exist in ${file}`).toBeGreaterThan(-1);
  const end = code.indexOf("\n};", start);
  expect(end, `${name} must be a closed declaration`).toBeGreaterThan(start);
  return {
    from: code.slice(0, start).split("\n").length,
    to: code.slice(0, end).split("\n").length + 1,
  };
}

describe("census — the sectioning vocabulary is spelled once", () => {
  // The ONE exemption, keyed by the DECLARATION rather than by the file: a
  // per-class capability table answers a different question ("which commands
  // does THIS class define?") and is legitimately a data table over the
  // vocabulary — it decides nothing about how a construct is lexed. A
  // file-scoped exemption would also excuse a real matcher added beside it.
  const EXEMPT_DECLARATION = "CLASS_COMMANDS";

  it("no production line outside the capability table lists the seven names", () => {
    const exempt = declarationLines("src/lib/document-class.ts", EXEMPT_DECLARATION);
    const offenders = sectioningVocabularyLines()
      .filter(
        (hit) =>
          hit.file !== "src/lib/document-class.ts" ||
          hit.line < exempt.from ||
          hit.line > exempt.to,
      )
      .map((hit) => `${hit.file}:${hit.line}`);
    expect(offenders).toEqual([]);
  });

  it("the exemption still COVERS a real table (it has not gone stale)", () => {
    // An exemption that has stopped excusing anything is a standing licence for
    // the next matcher written under the exempted name.
    const exempt = declarationLines("src/lib/document-class.ts", EXEMPT_DECLARATION);
    const inside = sectioningVocabularyLines().filter(
      (hit) =>
        hit.file === "src/lib/document-class.ts" &&
        hit.line >= exempt.from &&
        hit.line <= exempt.to,
    );
    expect(inside.length).toBeGreaterThanOrEqual(5);
  });

  it("the census can SEE a spelling (it is not vacuous)", () => {
    // A canary on synthetic bytes rather than on a production line — a canary
    // standing on the defect evaporates the day the defect is drained.
    const canary =
      "const re = /\\\\(part|chapter|section|subsection|subsubsection)\\{/;";
    const named = SECTIONING_NAMES.filter((n) =>
      new RegExp(`\\b${n}\\b`).test(commentsStripped(canary)),
    );
    expect(named.length).toBeGreaterThanOrEqual(3);
  });

  it("the census SWEPT a real population", () => {
    expect(productionSources("src").length).toBeGreaterThan(400);
  });
});
