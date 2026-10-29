// @vitest-environment jsdom
//
// The colour-form FACT, guarded once across every agent-facing doc that
// states it (task 1348).
//
// Only `\textcolor[HTML]{RRGGBB}{…}` parses to the `textColor` mark; a named
// colour (`\textcolor{red}{…}`) survives byte-for-byte but as a grey raw-LaTeX
// `latexCommand` span. That fact is restated in the shared allowlist (both
// silo twins) and in the operational manifest (`docs/workspace/*.md`, which
// ships in the skill bundle). Task 803 fixed one stale restatement — "named
// colors round-trip as plain text" — in the allowlist, and the same sentence
// survived one doc over in `atoms.md`, because only the sentence was fixed and
// nothing guarded the fact.
//
// So this suite guards the FACT, not each sentence:
//   1. The PARSER answers what each form becomes — never a constant in this
//      file. If the parser one day accepts named colours, leg 1's answer
//      flips and every doc that still calls them raw fails, rather than the
//      docs going silently wrong the other way.
//   2. The doc population is DISCOVERED (every `.md` under `editor/skills/`,
//      `library/skills/` and `docs/workspace/`), so a new doc that restates the
//      fact is covered by shipping.
//   3. Every claim UNIT (paragraph, list item, table row) that speaks of a
//      named colour must agree with the parser's answer, and every unit that
//      names the colour mark beside `\textcolor` must name the `[HTML]` form.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { parseLatex } from "@/lib/latex-parser";

const repoRoot = join(__dirname, "..", "..", "..");
const DOC_DIRS = ["editor/skills", "library/skills", "docs/workspace"];

function marksOf(tex: string): string[][] {
  const doc = parseLatex(
    `\\documentclass{article}\n\\begin{document}\n${tex}\n\\end{document}\n`,
  );
  const out: string[][] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "text") out.push((n.marks ?? []).map((m) => m.type));
    for (const c of n.content ?? []) walk(c);
  };
  walk(doc);
  return out;
}

const isColourMark = (tex: string) =>
  marksOf(tex).some((ms) => ms.includes("textColor"));
const isCarrier = (tex: string) =>
  marksOf(tex).some((ms) => ms.includes("latexCommand")) && !isColourMark(tex);

type Unit = { doc: string; text: string };

function docs(): { rel: string; body: string }[] {
  const out: { rel: string; body: string }[] = [];
  for (const dir of DOC_DIRS) {
    for (const name of readdirSync(join(repoRoot, dir)).sort()) {
      if (!name.endsWith(".md")) continue;
      const rel = `${dir}/${name}`;
      out.push({ rel, body: readFileSync(join(repoRoot, rel), "utf8") });
    }
  }
  return out;
}

/** Paragraphs, then list items / table rows within them — the grain at which a
 *  doc makes one claim. */
function units(): Unit[] {
  const out: Unit[] = [];
  for (const { rel, body } of docs()) {
    for (const block of body.split(/\n\s*\n/)) {
      for (const piece of block.split(/\n(?=\s*(?:[-*] |\|))/)) {
        out.push({ doc: rel, text: piece.replace(/\s+/g, " ") });
      }
    }
  }
  return out;
}

const NAMES_NAMED_FORM = /named colou?rs?|\\textcolor\{[a-z]+\}/i;
const CARRIER_VOCAB = /raw[- ]LaTeX|latexCommand/;
const PLAIN_TEXT = /plain[- ]text/i;
const NAMES_COLOUR_MARK = /\btextColor\b|colou?r mark/;

describe("the colour form: the parser is the authority", () => {
  it("the [HTML]{RRGGBB} form parses to the textColor mark", () => {
    expect(isColourMark("\\textcolor[HTML]{FF0000}{hi}")).toBe(true);
  });

  it("a named colour is the raw-LaTeX carrier, not the mark (the docs' premise)", () => {
    // If this leg fails, the parser has started accepting named colours —
    // rewrite every doc the next suite names, then update this premise.
    expect(isCarrier("\\textcolor{red}{hi}")).toBe(true);
  });
});

describe("every shipped doc agrees with the parser about colour", () => {
  const all = units();
  const namedIsCarrier = isCarrier("\\textcolor{red}{hi}");

  it("discovers the known restatements (non-vacuity)", () => {
    const docsSeen = new Set(all.map((u) => u.doc));
    for (const d of [
      "editor/skills/_latex-allowlist.md",
      "library/skills/_latex-allowlist.md",
      "docs/workspace/atoms.md",
      "docs/workspace/latex.md",
    ]) {
      expect(docsSeen.has(d)).toBe(true);
    }
  });

  it("no doc mis-describes what a named-colour \\textcolor becomes", () => {
    const claims = all.filter((u) => NAMES_NAMED_FORM.test(u.text));
    // allowlist ×2 + atoms + latex at least.
    expect(claims.length).toBeGreaterThanOrEqual(4);
    const wrong = claims
      .filter((u) =>
        namedIsCarrier
          ? !CARRIER_VOCAB.test(u.text) || PLAIN_TEXT.test(u.text)
          : CARRIER_VOCAB.test(u.text),
      )
      .map((u) => `${u.doc}: ${u.text}`);
    expect(wrong).toEqual([]);
  });

  it("every doc that names the colour mark beside \\textcolor names the [HTML] form", () => {
    const claims = all.filter(
      (u) => NAMES_COLOUR_MARK.test(u.text) && u.text.includes("\\textcolor"),
    );
    expect(claims.length).toBeGreaterThanOrEqual(4);
    const wrong = claims
      .filter((u) => !u.text.includes("[HTML]"))
      .map((u) => `${u.doc}: ${u.text}`);
    expect(wrong).toEqual([]);
  });
});
