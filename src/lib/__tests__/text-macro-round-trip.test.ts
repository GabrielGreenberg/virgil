/**
 * Task 2026-08-19-380 — the text-macro table is one-directional.
 *
 * Two halves of one rule, measured through the REAL save pipeline:
 *
 *  M1  `\LaTeX` / `\LaTeX{}` / `\TeX` were converted to the plain WORD on the
 *      parse rung with no reverse map anywhere, so the command was DELETED
 *      from the user's only copy on OPEN, with no edit — a fixed point from
 *      cycle 1, on BOTH inline surfaces and inside headings. In the PDF
 *      `\LaTeX` typesets the stylized logo and the word does not.
 *
 *  M2  the mirror image, on the EMIT side: a `…` glyph re-emitted as `\ldots`
 *      with no `{}` token break, and TeX gobbles every space after a control
 *      word — so `So on… and so forth.` printed "So on…and so forth.", a space
 *      the user typed deleted IN THE PDF ONLY, for every ellipsis followed by
 *      a word. The `.tex` round trip was perfectly stable, so nothing
 *      downstream noticed.
 *
 * Neither is visible to any gate: the `\LaTeX`→`LaTeX` conversion changes zero
 * word tokens under `WORD_RE = [A-Za-z0-9]+`, and M2 changes no bytes at all.
 *
 * WHY NO PRE-380 SUITE COULD SEE THIS. Every round-trip fixture in the repo
 * spells its typography the one way the code happens to handle, and the two
 * legs that named the macros at all (`citation-display-projection`) asserted
 * the CONVERSION as intended behaviour — the defect pinned as the contract.
 * So each leg here runs TWO cycles, over BOTH inline surfaces and inside a
 * heading, with a live CONTROL through the identical harness.
 *
 * Every case list is swept FROM the tables, so a new member is covered by
 * declaration alone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";
import {
  matchTextMacroAt,
  latexToDisplayText,
  typographyToLatex,
  ELLIPSIS,
  __typographyTables,
} from "@/lib/latex-typography";
import { commentsStripped } from "./_source-scan";

const { LITERAL_TABLE, TEXT_MACRO_TABLE, DISPLAY_ONLY_MACRO_TABLE, literalEmitForm } =
  __typographyTables;

const REPO_ROOT = join(__dirname, "..", "..", "..");

// ── harness ─────────────────────────────────────────────────────────────────

/** One REAL save cycle over the main document body. */
function bodyCycle(src: string): string {
  const doc = parseLatex(
    `\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}\n`,
  );
  assignUuids(doc);
  return serializeBodyOnly(doc)
    .replace(/ *%!v:[0-9a-f]{4}/g, "")
    .trim();
}

/** One REAL save cycle over the card / `\footnote{}` fork (the second parser). */
function cardCycle(src: string): string {
  return richJsonToLatex(richLatexToJson(src));
}

const SURFACES: ReadonlyArray<{ name: string; cycle: (s: string) => string }> = [
  { name: "body", cycle: bodyCycle },
  { name: "card", cycle: cardCycle },
  // A heading's argument runs the SAME inline parser through a different
  // caller, which is where M1 was also reachable (`\section{About \LaTeX}`).
  {
    name: "heading",
    cycle: (s) => {
      const out = bodyCycle(`\\section{${s}}`);
      const m = /^\\section\{([\s\S]*)\}$/.exec(out);
      return m ? m[1] : out;
    },
  },
];

/** Assert `src` is a FIXED POINT of the save pipeline on every surface. */
function expectStable(src: string) {
  for (const { name, cycle } of SURFACES) {
    const c1 = cycle(src);
    expect(c1, `${name}: cycle 1 must not move the bytes`).toBe(src);
    expect(cycle(c1), `${name}: cycle 2`).toBe(src);
  }
}

/** Assert `src` settles to `canonical` on cycle 1 and never moves again. */
function expectSettles(src: string, canonical: string) {
  for (const { name, cycle } of SURFACES) {
    const c1 = cycle(src);
    expect(c1, `${name}: cycle 1`).toBe(canonical);
    expect(cycle(c1), `${name}: cycle 2 must be a fixed point`).toBe(canonical);
  }
}

// ── M1 · a logo macro is CARRIED, not converted ─────────────────────────────

describe("M1 · a macro with no glyph is raw LaTeX, and survives the save", () => {
  // Swept from the table, so a third logo macro is covered by declaring itself.
  const LOGOS = DISPLAY_ONLY_MACRO_TABLE.flatMap((e) => e.names);

  it("has logo macros to test (the sweep is not vacuous)", () => {
    expect(LOGOS).toEqual(expect.arrayContaining(["LaTeX", "TeX"]));
  });

  for (const name of LOGOS) {
    it(`\\${name} round-trips byte-identically, bare and with a token break`, () => {
      expectStable(`Written in \\${name} by hand.`);
      expectStable(`Written in \\${name}{} by hand.`);
      // At the very end of a run, where the pre-fix code left a stray `{}`.
      expectStable(`Written in \\${name}{}`);
    });

    it(`\\${name} reaches the document on the raw-LaTeX carrier`, () => {
      const doc = parseLatex(
        `\\documentclass{article}\n\\begin{document}\nA \\${name}{} b\n\\end{document}\n`,
      );
      const marks: string[] = [];
      const walk = (n: { type?: string; text?: string; marks?: { type: string }[]; content?: unknown[] }) => {
        if (n.text?.includes(`\\${name}`)) {
          for (const m of n.marks ?? []) marks.push(m.type);
        }
        for (const c of (n.content ?? []) as typeof n[]) walk(c);
      };
      walk(doc as never);
      expect(marks, "the bytes must be carried, not prose").toContain("latexCommand");
    });

    it(`\\${name} is NOT in the parsers' vocabulary (the direction rule)`, () => {
      expect(matchTextMacroAt(`\\${name}`, 0)).toBeNull();
    });

    it(`a DISPLAY projection may still read \\${name} — a view never writes back`, () => {
      expect(latexToDisplayText(`Written in \\${name}{} by hand.`)).toBe(
        `Written in ${name} by hand.`,
      );
    });

    it(`the word "${name}" typed as PROSE is never rewritten into a command`, () => {
      // The surgical fix this task rejected (a reverse map) would have done
      // exactly that, to every literal occurrence in the paper.
      expectStable(`I wrote about ${name} last year.`);
    });
  }
});

// ── M2 · a glyph leaves as LaTeX that MEANS THE SAME THING ──────────────────

describe("M2 · a command-shaped literal emits its token break", () => {
  const COMMAND_LITERALS = LITERAL_TABLE.filter((e) =>
    e.latexForms[0].startsWith("\\"),
  );
  const RUN_LITERALS = LITERAL_TABLE.filter((e) => !e.latexForms[0].startsWith("\\"));

  it("both kinds of literal exist (neither sweep is vacuous)", () => {
    expect(COMMAND_LITERALS.length).toBeGreaterThan(0);
    expect(RUN_LITERALS.length).toBeGreaterThan(0);
  });

  for (const e of COMMAND_LITERALS) {
    const canonical = e.latexForms[0];

    it(`${canonical} emits with a token break, so TeX cannot eat the space`, () => {
      expect(literalEmitForm(e)).toBe(`${canonical}{}`);
      const out = typographyToLatex(`So on${e.glyph} and so forth.`);
      expect(out).toBe(`So on${canonical}{} and so forth.`);
      // The whole point: what follows the control word is still a SPACE.
      expect(out).not.toContain(`${canonical} and`);
    });

    it(`${canonical} written bare settles ONCE and is then a fixed point`, () => {
      expectSettles(
        `So on${canonical} and so forth.`,
        `So on${canonical}{} and so forth.`,
      );
      expectStable(`So on${canonical}{} and so forth.`);
    });

    for (const alias of e.latexForms.slice(1).filter((f) => f.startsWith("\\"))) {
      it(`${alias} is an accepted PARSE alias and settles on the canonical form`, () => {
        // Declared normalization, and PRE-EXISTING: the glyph is what the model
        // holds, so the alias has nowhere to live and `latexForms[0]` is what
        // "canonical" means. Task 380 adds the token break to that answer and
        // nothing else. (The task text asserted the alias was preserved as
        // written — measured on the pre-380 tree, it was not.)
        expectSettles(`So on${alias} and`, `So on${canonical}{} and`);
      });
    }

    it(`${canonical}{} re-parses to exactly ONE glyph and no stray empty group`, () => {
      // The oscillation this closes: without the parse side consuming the token
      // break, the emitted `\ldots{}` reads back as the glyph PLUS a raw-carried
      // `{}` (task 349 M6's bare-group carrier) and re-emits as `\ldots{}{}` —
      // two more bytes on every save, forever.
      const inner = richLatexToJson(`a${canonical}{}b`);
      const flat = JSON.stringify(inner);
      expect((flat.match(new RegExp(e.glyph, "g")) ?? []).length).toBe(1);
      expect(flat).not.toContain("{}");
      expectStable(`a${canonical}{}b`);
    });

    it(`a SECOND group after ${canonical}{} is content and is kept`, () => {
      // Only the token break is consumed. `{}{}` keeps one.
      expectStable(`A${canonical}{}{}B`);
    });
  }

  for (const e of RUN_LITERALS) {
    it(`a character run (${e.latexForms[0]}) picks up NO token break`, () => {
      // It has no gobble to prevent, and `{}` would print as a stray group.
      expect(literalEmitForm(e)).toBe(e.latexForms[0]);
      expectStable(`Fifteen to twenty (15${e.latexForms[0]}20) items.`);
    });
  }
});

// ── M3 · a code span converts in NEITHER direction ─────────────────────────

describe("M3 · a text macro inside a code span stays raw", () => {
  // The same fork task 377 M4 closed for `--` and the accents, one member over:
  // the EMIT side suppresses typography under a `code` wrapper, so converting
  // on the parse rung had no way back and wrote a raw U+2026 into the `.tex`.
  const CODE_LITERALS = LITERAL_TABLE.filter((e) => e.latexForms[0].startsWith("\\"));

  for (const e of CODE_LITERALS) {
    const canonical = e.latexForms[0];

    it(`${canonical} inside \\texttt{} round-trips byte-identically`, () => {
      expect(bodyCycle(`Code \\texttt{a${canonical} b} here.`)).toBe(
        `Code \\texttt{a${canonical} b} here.`,
      );
      expect(cardCycle(`a \\texttt{x${canonical} y} b`)).toBe(
        `a \\texttt{x${canonical} y} b`,
      );
    });

    it(`${canonical} inside a command NESTED in \\texttt{} stays raw too`, () => {
      // `inCode` is INHERITED by every mark recursion (task 377 M4) — the depth
      // at which the pre-377 tree lost the fact.
      expect(bodyCycle(`\\texttt{\\textbf{a${canonical} b}}`)).toBe(
        `\\texttt{\\textbf{a${canonical} b}}`,
      );
    });

    it(`${canonical} OUTSIDE a code span is still converted (the control)`, () => {
      expect(bodyCycle(`Plain a${canonical} b.`)).toBe(`Plain a${canonical}{} b.`);
    });
  }
});

// ── the closure the split makes structural ──────────────────────────────────

describe("the parse vocabulary is CLOSED under the round trip, by construction", () => {
  it("every member the parsers convert is restored by the serialize rung", () => {
    // This is the whole of the direction rule: a member may join the parsers'
    // table only if its `text` is a glyph `typographyToLatex` writes back.
    expect(TEXT_MACRO_TABLE.length).toBeGreaterThan(0);
    for (const entry of TEXT_MACRO_TABLE) {
      const emitted = typographyToLatex(entry.text);
      expect(emitted, `${entry.names[0]} must have a reverse direction`).not.toBe(
        entry.text,
      );
      const back = matchTextMacroAt(emitted, 0);
      expect(back, `${entry.names[0]} must parse back`).not.toBeNull();
      expect(back!.text).toBe(entry.text);
      expect(back!.end, "the whole emitted form is consumed").toBe(emitted.length);
    }
  });

  it("no logo macro leaked into the parse vocabulary", () => {
    const parseNames = new Set(TEXT_MACRO_TABLE.flatMap((e) => e.names));
    for (const e of DISPLAY_ONLY_MACRO_TABLE) {
      for (const n of e.names) expect(parseNames.has(n)).toBe(false);
    }
  });

  it("still declines a LONGER command that merely starts with a member", () => {
    expect(matchTextMacroAt("\\dotsc", 0)).toBeNull();
    expect(matchTextMacroAt("\\ldotsx", 0)).toBeNull();
  });

  it("the ellipsis glyph is the one the document model holds", () => {
    expect(ELLIPSIS).toBe("…");
  });
});

// ── the census: the door was never the part that could misbehave ────────────

describe("census · nothing that writes a DOCUMENT may read the display vocabulary", () => {
  const TYPOGRAPHY = join("src", "lib", "latex-typography.ts");
  const WRITERS = [
    join("src", "lib", "latex-parser.ts"),
    join("src", "lib", "footnote-content.ts"),
    join("src", "lib", "latex-serializer.ts"),
  ];
  const read = (rel: string) =>
    commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));

  it("the wider door is module-private — it cannot travel", () => {
    const code = read(TYPOGRAPHY);
    expect(code).toContain("function matchDisplayMacroAt(");
    expect(code, "a document writer must not be able to import it").not.toContain(
      "export function matchDisplayMacroAt(",
    );
  });

  it("no document writer names a logo macro, or the display door", () => {
    // The realistic re-fork: a parser that spells `\LaTeX` itself, or reaches
    // the wider vocabulary — either way the destruction comes straight back,
    // and neither is visible to any behavioural test of the shared door.
    for (const rel of WRITERS) {
      const code = read(rel);
      for (const name of DISPLAY_ONLY_MACRO_TABLE.flatMap((e) => e.names)) {
        expect(code, `${rel} must not spell \\${name}`).not.toContain(`\\\\${name}`);
      }
      expect(code, `${rel} must not reach the display vocabulary`).not.toContain(
        "matchDisplayMacroAt",
      );
    }
  });

  it("the parse table is DERIVED, never stated", () => {
    // A hand-written member is how a macro with no reverse direction gets back
    // in — the pre-380 shape exactly. The derivation is what forbids it.
    const code = read(TYPOGRAPHY);
    const decl = code.slice(
      code.indexOf("const TEXT_MACRO_TABLE"),
      code.indexOf("const DISPLAY_ONLY_MACRO_TABLE"),
    );
    expect(decl).toContain("LITERAL_TABLE.filter(");
    expect(decl, "no member may be written out by hand").not.toContain("names: [");
  });

  it("the emit form is spelled once, and both directions read it", () => {
    const code = read(TYPOGRAPHY);
    expect(code).toContain("function literalEmitForm(");
    // The serialize map is built FROM it — a second `latexForms[0]` here is the
    // fork that would restore the gobble.
    expect(code).toContain("LITERAL_TABLE.map((e) => [e.glyph, literalEmitForm(e)])");
  });

  it("the census can see (canary)", () => {
    const code = read(TYPOGRAPHY);
    expect(code).toContain("matchTextMacroAt");
    for (const rel of WRITERS.slice(0, 2)) {
      expect(read(rel)).toContain("matchTextMacroAt(");
    }
  });
});
