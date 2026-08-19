/**
 * TASK 341 — the card/footnote body is a SECOND inline parser+serializer, and
 * it had drifted from the main one on three vocabularies.
 *
 * **Why the two-copy shape was invisible.** Every pre-existing suite exercises
 * ONE fork at a time: the latex-parser suites drive body text, the
 * footnote-content suites drive card bodies, and each spells its fixtures the
 * way the code it tests happens to handle them. A divergence between them is
 * unrepresentable in either. So every leg here drives BOTH surfaces over the
 * SAME bytes and asserts they agree — which is the only shape that can see it.
 *
 * The vocabularies are swept FROM THE SSOT (`KNOWN_CITE_COMMANDS`,
 * `MULTI_CITE_NAMES`, `CHAR_ESCAPE_TABLE`), so a future registry addition is
 * covered by declaration alone rather than by someone remembering to extend a
 * fixture list.
 *
 * **Stated renegotiation.** The task's "Done when" asked for `\(x^2\)` and
 * `$$E=mc^2$$` to round-trip BYTE-identically *and* to behave "exactly as body
 * text does". Measured on the pre-fix tree, body text normalizes both to
 * `$…$` — so the two halves cannot both hold, and PARITY is the one that
 * describes the defect. These legs therefore pin parity plus idempotency (a
 * second round trip is a fixed point), and the normalization is recorded as
 * pre-existing main-parser behaviour this task deliberately does not change.
 */

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import { parseInlineContent, parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import {
  KNOWN_CITE_COMMANDS,
  MULTI_CITE_NAMES,
  matchCiteCommandAt,
} from "@/lib/cite-commands";
import { CHAR_ESCAPE_TABLE } from "@/lib/latex-typography";
import { strip } from "./_source-scan";
import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** The fork's inline node stream for `body`. */
function forkNodes(body: string): JSONContent[] {
  const doc = richLatexToJson(body);
  return (doc.content?.[0]?.content ?? []) as JSONContent[];
}

/** Generated ids differ per call by construction — compare everything else. */
function normalizeIds(nodes: JSONContent[]): JSONContent[] {
  return nodes.map((n) => {
    if (!n.attrs) return n;
    const attrs = { ...n.attrs };
    if ("citationId" in attrs) attrs.citationId = "<id>";
    if ("footnoteId" in attrs) attrs.footnoteId = "<id>";
    return { ...n, attrs };
  });
}

/** The card-body round trip: bytes → nodes → bytes. */
function cardRt(body: string): string {
  return richJsonToLatex(richLatexToJson(body));
}

/** The document round trip, with the preamble stripped down to the body. */
function docRt(tex: string): string {
  const out = serializeToLatex(parseLatex(tex) as never);
  return out
    .slice(out.indexOf("\\begin{document}") + "\\begin{document}".length, out.indexOf("\\end{document}"))
    .trim();
}

/** `\vcid{abcd}` ids are minted per parse — blank them for a byte comparison. */
function blankIds(tex: string): string {
  return tex.replace(/\\v(cid|fid)\{[^}]*\}/g, "\\v$1{}");
}

// ---------------------------------------------------------------------------
// 1. Math delimiters — the fork knew `$…$` and nothing else
// ---------------------------------------------------------------------------

/** Every delimiter form, and what the SHARED scanner canonicalizes it to. */
const MATH_FIXTURES: readonly { src: string; canonical: string }[] = [
  { src: "Inline $x_i$ here.", canonical: "Inline $x_i$ here." },
  { src: "See \\(x^2\\) here.", canonical: "See $x^2$ here." },
  { src: "Display $$E=mc^2$$ here.", canonical: "Display $E=mc^2$ here." },
  { src: "Display \\[x^2\\] here.", canonical: "Display $x^2$ here." },
  // A `--` and an accent INSIDE math stay literal (memo §A) on both surfaces.
  { src: "Math \\(a -- \\'e\\) here.", canonical: "Math $a -- \\'e$ here." },
];

describe("341 · math delimiters are ONE vocabulary", () => {
  for (const { src, canonical } of MATH_FIXTURES) {
    it(`card body and body text agree on ${JSON.stringify(src)}`, () => {
      // DEFECT LEG. Pre-fix, `\(…\)` / `$$…$$` / `\[…\]` never became a math
      // node in a card body: they fell through to the PROSE buffer, so `^`
      // came back `\textasciicircum{}` (a literal caret in math mode — every
      // superscript in the body lost in the PDF) and `--` would have been
      // glyphified. The `$x_i$` row is the control that already passed.
      expect(normalizeIds(forkNodes(src))).toEqual(
        normalizeIds(parseInlineContent(src)),
      );
    });

    it(`card body round-trips ${JSON.stringify(src)} to its canonical form`, () => {
      expect(cardRt(src)).toBe(canonical);
      // Idempotency: the canonical form is a fixed point, so nothing
      // accumulates across saves.
      expect(cardRt(canonical)).toBe(canonical);
    });
  }

  it("math content never reaches the typography buffer", () => {
    // The whole reason an unknown delimiter is worse than a refused one.
    expect(cardRt("A \\(x^2 \\& y_1\\) B")).toBe("A $x^2 \\& y_1$ B");
    expect(cardRt("A $$x^2$$ B")).toBe("A $x^2$ B");
  });
});

// ---------------------------------------------------------------------------
// 2. Cite commands — swept FROM the registry, not from a fixture list
// ---------------------------------------------------------------------------

/** The canonical single-key / multi-key spelling for a registry member. */
function sampleCommand(cmd: string): string {
  return MULTI_CITE_NAMES.has(cmd)
    ? `\\${cmd}{alpha}{beta}`
    : `\\${cmd}{alpha}`;
}

describe("341 · every KNOWN_CITE_COMMANDS member is a citation in a card body", () => {
  for (const cmd of KNOWN_CITE_COMMANDS) {
    it(`\\${cmd}`, () => {
      const src = `A ${sampleCommand(cmd)} here.`;
      // DEFECT LEG for the ten names the fork's hand alternation was missing
      // (\fullcite, \nocite, \citetitle, \citeurl, \citedate, \smartcite,
      // \smartcites, \footfullcite, \citenum, \citetext) — pre-fix each became
      // a grey `latexCommand` text node inside a card body while behaving as a
      // citation in the document.
      const nodes = forkNodes(src);
      const cites = nodes.filter((n) => n.type === "citation");
      expect(cites).toHaveLength(1);
      expect(cites[0].attrs?.command).toBe(sampleCommand(cmd));
      expect(normalizeIds(nodes)).toEqual(normalizeIds(parseInlineContent(src)));

      // …and its `\vcid` is re-emitted, so the citation's durable identity
      // survives the save. Pre-fix the marker was consumed by the marker branch
      // and never re-emitted, deleting the id from the `.tex`.
      const out = cardRt(`\\vcid{abcd}${sampleCommand(cmd)}`);
      expect(out).toBe(`\\vcid{abcd}${sampleCommand(cmd)}`);
    });
  }
});

describe("341 · the multi-cite argument grammar is ONE grammar", () => {
  const MULTI = "\\footcites[p1][q1]{alpha}[p2][q2]{jones_21}";

  it("per-key [pre][post] groups round-trip byte-identically in a card body", () => {
    // DEFECT LEG, and the one that sharing the NAME list alone would NOT have
    // closed: `\footcites` is a name the fork already had. Its hand-written
    // loop consumed brackets only BEFORE the first key, so the tail fell
    // through to prose and `escapeLatexChars` corrupted the citekey —
    // `…{[}p2{]}{[}q2{]}\{jones\_21\}` on disk.
    expect(blankIds(cardRt(MULTI))).toBe(`\\vcid{}${MULTI}`);
    expect(blankIds(docRt(MULTI))).toBe(`\\vcid{}${MULTI}`);
    expect(normalizeIds(forkNodes(MULTI))).toEqual(
      normalizeIds(parseInlineContent(MULTI)),
    );
  });

  it("the whole command is ONE citation node on both surfaces", () => {
    for (const nodes of [forkNodes(MULTI), parseInlineContent(MULTI)]) {
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe("citation");
      expect(nodes[0].attrs?.command).toBe(MULTI);
    }
  });

  it("a singular command takes exactly ONE key group", () => {
    // The repetition must not leak into the singular forms: `\citep{a}{b}` is
    // a cite of `a` followed by a literal brace group.
    const m = matchCiteCommandAt("\\citep{a}{b}", 0);
    expect(m).toMatchObject({ name: "citep", command: "\\citep{a}", keyed: true });
  });

  it("a bare cite command with no key builds no node, on either surface", () => {
    for (const src of ["\\citep and more", "\\citep[see] and more"]) {
      expect(forkNodes(src).some((n) => n.type === "citation")).toBe(false);
      expect(parseInlineContent(src).some((n) => n.type === "citation")).toBe(false);
      // Byte parity is what matters here — the two surfaces reach it through
      // different fallthroughs (raw buffer vs the grey `latexCommand` node).
      expect(cardRt(src)).toBe(src);
      expect(docRt(src)).toBe(src);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. A `\vcid` binds to the atom that follows it, or to nothing
// ---------------------------------------------------------------------------

describe("341 · a marker id can never rebind to a LATER atom", () => {
  it("an unclaimed \\vcid is dropped, not inherited", () => {
    // DEFECT LEG. Pre-fix `pendingCitationId` was cleared only when a citation
    // consumed it, so a marker whose atom the scanner failed to recognize kept
    // its id alive for the rest of the body and handed it to the next
    // citation — two cards resolving to one identity, the later one writing
    // its edits into the earlier one's `.bib` entry.
    const src = "\\vcid{abcd}\\unknowncmd{x} then \\citep{jones21} end.";
    for (const nodes of [forkNodes(src), parseInlineContent(src)]) {
      const cites = nodes.filter((n) => n.type === "citation");
      expect(cites).toHaveLength(1);
      expect(cites[0].attrs?.citationId).not.toBe("abcd");
    }
  });

  it("an adjacent \\vcid is still claimed", () => {
    // The accepting control — without it the leg above passes with the whole
    // marker mechanism deleted.
    for (const nodes of [
      forkNodes("\\vcid{abcd}\\citep{jones21}"),
      parseInlineContent("\\vcid{abcd}\\citep{jones21}"),
    ]) {
      expect(nodes.filter((n) => n.type === "citation")[0].attrs?.citationId).toBe("abcd");
    }
  });

  it("a \\vfid binds to its own footnote and to nothing else", () => {
    const nodes = parseInlineContent("\\vfid{abcd}\\unknowncmd{x}\\footnote{body}");
    const fns = nodes.filter((n) => n.type === "footnote");
    expect(fns).toHaveLength(1);
    expect(fns[0].attrs?.footnoteId).not.toBe("abcd");
    expect(
      parseInlineContent("\\vfid{abcd}\\footnote{body}").filter((n) => n.type === "footnote")[0]
        .attrs?.footnoteId,
    ).toBe("abcd");
  });
});

// ---------------------------------------------------------------------------
// 4. A block-level command inside an ARGUMENT is not a block boundary
// ---------------------------------------------------------------------------

describe("341 · a footnote argument is not split by the block reader", () => {
  it("\\[…\\] inside a \\footnote{} leaves the footnote a footnote", () => {
    // DEFECT LEG. Pre-fix this round-tripped to
    // `Text.\footnote\{Display` / `\[…\]` / `here.\} tail.` — LaTeX errors on
    // that ("Paragraph ended before \footnote was complete") and no `\vfid` is
    // emitted, so it had stopped being a footnote at all.
    const doc = parseLatex("Text.\\footnote{Display \\[x^2\\] here.} tail.");
    expect(doc.content).toHaveLength(1);
    const inline = (doc.content?.[0].content ?? []) as JSONContent[];
    expect(inline.filter((n) => n.type === "footnote")).toHaveLength(1);
    expect(blankIds(docRt("Text.\\footnote{Display \\[x^2\\] here.} tail.")))
      .toBe("Text.\\vfid{}\\footnote{Display $x^2$ here.} tail.");
  });

  it("the gate is general, not a \\[ special case", () => {
    // Every BLOCK_BOUNDARY_COMMAND_RE member is equally not-a-boundary inside
    // a brace group. `\section` is the loudest of them.
    const doc = parseLatex("Text.\\footnote{a \\section{x} b} tail.");
    expect(doc.content).toHaveLength(1);
    expect(
      ((doc.content?.[0].content ?? []) as JSONContent[]).filter((n) => n.type === "footnote"),
    ).toHaveLength(1);
  });

  it("a top-level block boundary still splits", () => {
    // The non-regression control: the gate must only ever remove splits INSIDE
    // an argument.
    expect(docRt("Para one.\n\n\\section{Head}\n\nPara two.")).toBe(
      "Para one.\n\n\\section{Head}\n\nPara two.",
    );
    const doc = parseLatex("Lead in.\n\\[x^2\\]\nTail.");
    expect(doc.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "displayMath",
      "paragraph",
    ]);
  });

  it("an unbalanced brace costs at most its own paragraph", () => {
    // The blank-line break stays ungated, which is what re-zeroes the depth.
    const doc = parseLatex("Stray { brace.\n\nPara two.\n\n\\section{Head}\n\nPara three.");
    expect(doc.content?.map((n) => n.type)).toEqual([
      "paragraph",
      "paragraph",
      "heading",
      "paragraph",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. Char escaping is ONE implementation (task 339's table), on both surfaces
// ---------------------------------------------------------------------------

describe("341 · the escape table has ONE reader per direction", () => {
  for (const entry of CHAR_ESCAPE_TABLE) {
    it(`${JSON.stringify(entry.text)} reads and writes the same on both surfaces`, () => {
      const src = `pre ${entry.tex} post`;
      expect(normalizeIds(forkNodes(src))).toEqual(
        normalizeIds(parseInlineContent(src)),
      );
      // The bytes must AGREE, whatever they are — which is the contract this
      // task is about. Since task 360 they are also IDENTICAL for every member:
      // 339's `prose-only` narrowing (which left `\`, `{`, `}`, `[` and `]`
      // bare in any run holding a backslash) is retired, because bare text can
      // no longer be raw LaTeX. Both surfaces gained the closing member at the
      // same door — a control-symbol carrier in each inline parser.
      expect(cardRt(src)).toBe(docRt(src));
      expect(cardRt(src)).toBe(src);
    });
  }

  it("a prose $ does not become a math atom on reload", () => {
    // Task 037's defect, in the card body — closed by 339 and pinned here
    // because this suite is where the two surfaces are compared.
    expect(cardRt("It costs \\$5 and \\$10 total.")).toBe("It costs \\$5 and \\$10 total.");
    expect(forkNodes("It costs \\$5 and \\$10 total.").some((n) => n.type === "inlineMath")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. THE CENSUS — the leg with teeth
// ---------------------------------------------------------------------------

/**
 * The scanners were never the part that could misbehave; a call site that
 * spells its own copy of the vocabulary is. So the census asks BOTH silos who
 * hand-lists cite command names.
 *
 * The needle is "three or more DISTINCT registry names on one line, in code" —
 * an alternation, an array or a Set. Not "names a cite command at all": a
 * `"\\cite{}"` seed for a fresh citation card is one name and a legitimate
 * default value, and routing it through the registry would buy an index, not
 * an invariant.
 */
const PERMITTED_CITE_NAME_LISTS: Record<string, string> = {
  // A DIFFERENT question, filed as a residual rather than folded in here:
  // `bib-parser` parses a complete command STRING into normalized typed parts,
  // and its natbib/biblatex split IS that normalization (which branch claims a
  // command decides the pre/post-note semantics), not a recognition vocabulary.
  // Its lists are also not the registry's: they carry `fullcites` /
  // `footfullcites`, which `KNOWN_CITE_COMMANDS` does not have — so deriving
  // them would silently DROP two real biblatex commands unless the vocabulary
  // is widened first, which is a judgement call about what Virgil recognizes,
  // not a de-duplication. `library/lib/bib-parser.ts` is a whole-file copy of
  // the same module (its own pre-existing fork).
  "src/lib/bib-parser.ts": "command→typed-parts normalization; see the note above",
  "library/lib/bib-parser.ts": "whole-file copy of the above; same residual",
};

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(root);
  return out;
}

const NAME_WORD = new RegExp(
  `\\b(${[...KNOWN_CITE_COMMANDS].sort((a, b) => b.length - a.length).join("|")})\\b`,
  "gi",
);

function handListedNames(src: string): number[] {
  // Comments stripped, string literals KEPT — the drift lives in regex
  // literals and quoted arrays, so blanking them would make the leg
  // unfalsifiable (the shape task 205 got wrong).
  return strip(src, true)
    .split("\n")
    .map((line, i) => [new Set([...line.matchAll(NAME_WORD)].map((m) => m[1].toLowerCase())).size, i + 1])
    .filter(([distinct]) => distinct >= 3)
    .map(([, lineNo]) => lineNo);
}

describe("341 · census — nothing hand-lists the cite vocabulary", () => {
  it("no production file outside the registry spells its own cite-name list", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const offenders: string[] = [];
    for (const root of ["src", "library"]) {
      for (const file of sourceFiles(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, file).split(path.sep).join("/");
        if (rel.includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;
        if (rel === "src/lib/cite-commands.ts") continue; // the SSOT itself
        if (rel in PERMITTED_CITE_NAME_LISTS) continue;
        const lines = handListedNames(fs.readFileSync(file, "utf8"));
        if (lines.length) offenders.push(`${rel}:${lines.join(",")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the census can SEE a hand list (canary)", () => {
    // A canary must not stand on the defect, so it runs on a synthetic fixture
    // rather than on the allowlisted lines the census exists to watch.
    expect(
      handListedNames(`const RE = /^\\\\(citeyearpar|citeauthor|citep|citet)/;`),
    ).toEqual([1]);
    // …and must not fire on a lone default-value spelling, or on prose.
    expect(handListedNames(`const seed = "\\\\cite{}";`)).toEqual([]);
    expect(handListedNames(`// \\citep, \\citet and \\fullcite are all cites`)).toEqual([]);
  });

  it("the allowlist entries are still real hits (no stale exemptions)", () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    for (const rel of Object.keys(PERMITTED_CITE_NAME_LISTS)) {
      const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(handListedNames(src).length, `${rel} no longer hand-lists`).toBeGreaterThan(0);
    }
  });

  it("neither inline scanner re-derives the shared vocabularies", () => {
    // The two files this task unified: each must READ the shared scanners and
    // spell neither a delimiter table nor a cite alternation of its own.
    const repoRoot = path.resolve(__dirname, "../../..");
    for (const rel of ["src/lib/latex-parser.ts", "src/lib/footnote-content.ts"]) {
      const code = strip(fs.readFileSync(path.join(repoRoot, rel), "utf8"), true);
      expect(code, `${rel} must call the shared math scanner`).toContain("matchInlineMathAt");
      expect(code, `${rel} must call the shared cite scanner`).toContain("matchCiteCommandAt");
      expect(code, `${rel} must not re-derive the escape table`).toContain("matchCharEscapeAt");
    }
  });
});
