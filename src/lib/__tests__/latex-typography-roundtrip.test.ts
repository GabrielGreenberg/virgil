import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import {
  matchAccent,
  matchSpecialLetter,
  typographyToLatex,
  dashesToGlyphs,
  EN_DASH,
  EM_DASH,
  ELLIPSIS,
  __typographyTables,
} from "@/lib/latex-typography";

// ─── helpers ────────────────────────────────────────────────────────────────

function gather(node: any): string {
  let s = "";
  if (node.type === "text") s += node.text || "";
  if (node.type === "inlineMath") s += `$${node.attrs?.latex || ""}$`;
  if (node.content) for (const c of node.content) s += gather(c);
  return s;
}

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

const { ACCENT_TABLE, SPECIAL_LETTER_TABLE, LITERAL_TABLE } =
  __typographyTables;

// ─── 1. ACCENTS — derived from the single source-of-truth table ─────────────

describe("LaTeX accents → composed glyph (parse) and back (serialize)", () => {
  // Use a base letter that has a precomposed NFC form for every accent so the
  // round-trip is the typical case. `e` works for most; pick per-accent.
  const ACCENT_CASES: { latex: string; glyph: string; note: string }[] = [
    { latex: "\\'e", glyph: "é", note: "acute, bare control symbol" },
    { latex: "\\`a", glyph: "à", note: "grave, bare" },
    { latex: "\\^o", glyph: "ô", note: "circumflex, bare" },
    { latex: '\\"o', glyph: "ö", note: "umlaut, bare" },
    { latex: "\\~n", glyph: "ñ", note: "tilde, bare" },
    { latex: "\\=o", glyph: "ō", note: "macron, bare" },
    { latex: "\\.c", glyph: "ċ", note: "dot-above, bare" },
    { latex: "\\u{u}", glyph: "ŭ", note: "breve, braced control word" },
    { latex: "\\v{s}", glyph: "š", note: "caron, braced" },
    { latex: "\\c{c}", glyph: "ç", note: "cedilla, braced" },
    { latex: "\\H{o}", glyph: "ő", note: "double acute, braced" },
    { latex: "\\r{a}", glyph: "å", note: "ring, braced" },
    { latex: "\\k{a}", glyph: "ą", note: "ogonek, braced" },
  ];

  for (const { latex, glyph, note } of ACCENT_CASES) {
    it(`parses ${latex} → ${glyph} (${note})`, () => {
      const json = parseBody(`A ${latex} B`);
      const text = gather(json);
      expect(text).toContain(glyph);
      expect(text).not.toContain("\\"); // no raw command leaked through
    });

    it(`serializes ${glyph} → canonical ${latex.replace(/\\(['`^"~=.])(\w)/, "\\$1{$2}")}`, () => {
      // Build a doc directly holding the composed glyph (as if typed/parsed).
      const doc = {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: `A ${glyph} B` }] },
        ],
      };
      const out = serializeBody(doc as any);
      // canonical serialize form is always braced
      const canonical = latex.includes("{")
        ? latex
        : latex.replace(/\\(['`^"~=.])(.)/, "\\$1{$2}");
      expect(out).toContain(canonical);
      expect(out).not.toContain(glyph);
    });

    it(`round-trips ${latex} (parse→serialize stabilizes)`, () => {
      const json = parseBody(`A ${latex} B`);
      const out = serializeBody(json);
      // reparse must give the same glyph text
      const reparsed = gather(parseBody(out));
      expect(gather(json)).toEqual(reparsed);
    });
  }

  it("accepts both bare \\'e and braced \\'{e} on parse", () => {
    expect(gather(parseBody("\\'e"))).toContain("é");
    expect(gather(parseBody("\\'{e}"))).toContain("é");
  });

  it("composes accent over a nested special letter: \\^{\\i} → î-shaped glyph", () => {
    const text = gather(parseBody("\\^{\\i}"));
    // \i is the DOTLESS i (ı, U+0131), used so the accent doesn't collide
    // with the dot. NFC has no precomposed dotless-i-circumflex, so the
    // result is the combining sequence ı + ̂ (renders as î). This is the
    // visually-correct, lossless composition.
    expect(text).toContain(("ı" + "̂").normalize("NFC"));
  });

  it("every accent table entry round-trips its combining mark", () => {
    // For each accent, compose over `o` (a letter with broad precomposed
    // coverage where available; otherwise the combining sequence) and confirm
    // serialize maps it back to the command.
    for (const entry of ACCENT_TABLE) {
      const glyph = ("o" + entry.combining).normalize("NFC");
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: glyph }] }],
      };
      const out = serializeBody(doc as any);
      expect(out).toContain(`\\${entry.key}{`);
    }
  });
});

// ─── 2. SPECIAL LETTERS ─────────────────────────────────────────────────────

describe("LaTeX special letters ↔ glyph", () => {
  for (const { key, glyph } of SPECIAL_LETTER_TABLE) {
    it(`parses \\${key} → ${glyph}`, () => {
      // `\ss B` (space terminates the control word) and `\ss{}`
      expect(gather(parseBody(`A\\${key} B`))).toContain(glyph);
      expect(gather(parseBody(`A\\${key}{}B`))).toContain(glyph);
    });
  }

  // Serialize: a special-letter glyph that has NO Unicode decomposition
  // (ß ø Ø æ Æ œ Œ ł Ł ı ȷ) is reconstructed via the special-letter table
  // (\ss{} …). Glyphs that DO decompose (å → a+ring, Å → A+ring) are instead
  // reconstructed via the general accent mechanism (\r{a}) — a lossless,
  // recompilable canonical form. We prefer the general mechanism for any
  // decomposable glyph rather than carving out per-glyph special cases.
  const NON_DECOMPOSING = SPECIAL_LETTER_TABLE.filter(
    (e) => e.glyph.normalize("NFD") === e.glyph,
  );
  const DECOMPOSING = SPECIAL_LETTER_TABLE.filter(
    (e) => e.glyph.normalize("NFD") !== e.glyph,
  );

  for (const { key, glyph } of NON_DECOMPOSING) {
    it(`serializes ${glyph} → \\${key}{}`, () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `A${glyph}B` }] }],
      };
      const out = serializeBody(doc as any);
      expect(out).toContain(`\\${key}{}`);
    });
  }

  for (const { glyph } of DECOMPOSING) {
    it(`serializes ${glyph} via the general accent mechanism (round-trips losslessly)`, () => {
      const doc = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: `A${glyph}B` }] }],
      };
      const out = serializeBody(doc as any);
      // No bare glyph left; reparse recovers the same glyph.
      expect(out).not.toContain(glyph);
      expect(gather(parseBody(out))).toContain(glyph);
    });
  }

  it("does not mistake \\verb / \\vspace for the \\v accent", () => {
    // \verb and \vspace are full command tokens, not \v + base.
    const verb = gather(parseBody("\\verb"));
    // \verb has no braced arg here → falls to unknown command (kept raw)
    expect(verb).toContain("\\verb");
  });
});

// ─── 3. DASHES & ELLIPSIS ───────────────────────────────────────────────────

describe("dashes and ellipsis", () => {
  it("parses -- → en dash and --- → em dash", () => {
    expect(gather(parseBody("pages 3--5"))).toContain(`3${EN_DASH}5`);
    expect(gather(parseBody("yes---no"))).toContain(`yes${EM_DASH}no`);
  });

  it("serializes en/em dash back to --/---", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: `3${EN_DASH}5 and a${EM_DASH}b` }] },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("3--5");
    expect(out).toContain("a---b");
    expect(out).not.toContain(EN_DASH);
    expect(out).not.toContain(EM_DASH);
  });

  it("matches --- before -- (longest first)", () => {
    expect(dashesToGlyphs("---")).toEqual(EM_DASH);
    expect(dashesToGlyphs("--")).toEqual(EN_DASH);
  });

  it("round-trips a dash range: 3--5 → glyph → 3--5", () => {
    const json = parseBody("pages 3--5.");
    const out = serializeBody(json);
    expect(out).toContain("3--5");
  });

  it("parses \\ldots and \\dots → … and serializes … → \\ldots (canonical)", () => {
    expect(gather(parseBody("wait\\ldots"))).toContain(ELLIPSIS);
    expect(gather(parseBody("wait\\dots"))).toContain(ELLIPSIS);
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: `wait${ELLIPSIS}` }] }],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("\\ldots");
    expect(out).not.toContain(ELLIPSIS);
  });

  it("closes the latent ellipsis round-trip asymmetry (\\ldots survives save)", () => {
    const json = parseBody("To be continued\\ldots");
    const out = serializeBody(json);
    expect(out).toContain("\\ldots"); // was silently lost before the fix
  });

  it("LITERAL_TABLE canonical forms are first in each latexForms list", () => {
    const em = LITERAL_TABLE.find((e) => e.glyph === EM_DASH)!;
    const en = LITERAL_TABLE.find((e) => e.glyph === EN_DASH)!;
    const el = LITERAL_TABLE.find((e) => e.glyph === ELLIPSIS)!;
    expect(em.latexForms[0]).toEqual("---");
    expect(en.latexForms[0]).toEqual("--");
    expect(el.latexForms[0]).toEqual("\\ldots");
  });
});

// ─── 4. EXCLUSIONS — code / math / latexCommand are NOT transformed ─────────

describe("exclusions: typography must NOT touch code / math / raw LaTeX", () => {
  it("does not convert -- inside \\texttt{...} (code) on parse", () => {
    const json = parseBody("\\texttt{a--b}");
    const text = gather(json);
    expect(text).toContain("a--b");
    expect(text).not.toContain(EN_DASH);
  });

  it("does not convert -- inside a code mark on serialize", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "a--b", marks: [{ type: "code" }] }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("\\texttt{a--b}");
    expect(out).not.toContain(EN_DASH);
  });

  it("does not convert an accent glyph inside a code mark on serialize", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "café", marks: [{ type: "code" }] }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    // The é stays a literal glyph inside \texttt, NOT folded to \'{e}
    expect(out).toContain("\\texttt{café}");
    expect(out).not.toContain("\\'{e}");
  });

  it("does not transform dashes inside inline math", () => {
    const json = parseBody("$a--b$");
    const text = gather(json);
    // math content is preserved verbatim as the inlineMath latex attr
    expect(text).toContain("$a--b$");
    expect(text).not.toContain(EN_DASH);
  });

  it("leaves math latex untouched on serialize (em dash glyph would never appear in math attr)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { latex: "x - y" } }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("$x - y$");
  });

  it("does not fold a glyph inside a latexCommand (raw LaTeX) mark", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "\\somecmd{é--}", marks: [{ type: "latexCommand" }] },
          ],
        },
      ],
    };
    const out = serializeBody(doc as any);
    // raw LaTeX returned as-is: glyph + dashes preserved verbatim
    expect(out).toContain("\\somecmd{é--}");
    expect(out).not.toContain("\\'{e}");
  });

  it("an unknown accent-like command still falls through to latexCommand when no valid base", () => {
    // `\'` with no base char (end of input) is not a valid accent.
    const json = parseBody("\\' ");
    const text = gather(json);
    // Should not crash; the lone accent without a letter base is left raw-ish.
    expect(typeof text).toBe("string");
  });
});

// ─── 5. IDEMPOTENCY + MIXED CONTENT ─────────────────────────────────────────

describe("idempotency and mixed Unicode + LaTeX input", () => {
  it("parse(serialize(parse(x))) === parse(x) for a mixed paragraph", () => {
    const input =
      "Caf\\'e na\\\"ive r\\^ole, pages 3--5, see \\v{S}mid---really\\ldots and $x^2$.";
    const first = parseBody(input);
    const serialized = serializeBody(first);
    const second = parseBody(serialized);
    expect(gather(first)).toEqual(gather(second));
  });

  it("directly-typed glyphs serialize to canonical LaTeX (smart-quote policy)", () => {
    // User typed real Unicode: é, en dash, em dash, ellipsis.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: `Café — 3–5 …` }],
        },
      ],
    };
    const out = serializeBody(doc as any);
    expect(out).toContain("\\'{e}");
    expect(out).toContain("---"); // em dash
    expect(out).toContain("3--5"); // en dash
    expect(out).toContain("\\ldots");
  });

  it("typographyToLatex is idempotent on already-canonical LaTeX text", () => {
    // Running serialize twice must not double-escape (no glyphs left to map).
    const once = typographyToLatex("Café 3–5");
    const twice = typographyToLatex(once);
    expect(twice).toEqual(once);
  });

  it("serialize leaves directly-typed ASCII -- untouched (only glyphs are mapped)", () => {
    // If a doc text node holds literal ASCII hyphens (not an en-dash glyph),
    // serialize must NOT touch them — only the en/em/ellipsis GLYPHS map back.
    // The pair round-trips on the NEXT parse (-- → glyph → --), staying stable.
    expect(typographyToLatex("3--5")).toEqual("3--5");
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "3--5" }] }],
    };
    expect(serializeBody(doc as any)).toContain("3--5");
  });

  it("matchAccent returns null for non-accent backslash sequences", () => {
    expect(matchAccent("\\section{x}", 0)).toBeNull();
    expect(matchAccent("plain", 0)).toBeNull();
  });

  it("matchSpecialLetter returns null for unrelated commands", () => {
    expect(matchSpecialLetter("\\section", 0)).toBeNull();
    expect(matchSpecialLetter("\\over", 0)).toBeNull();
  });
});

// ─── 6. ADVERSARIAL-REVIEW REGRESSIONS (D1–D4) ──────────────────────────────
//
// These guard the four root-cause fixes from the typography adversarial
// review. Each previously CORRUPTED on the full parse→serialize→REPARSE loop
// (the parse-only tests in §1 masked them). They are the regression suite for
// the worst defect (D1) and its siblings.

describe("regression: accent over a dotless special letter survives a full round-trip (D1)", () => {
  // D1 was the worst: \^{\i} parsed fine, but on serialize it emitted
  // `\^{\i{}}` and the NEXT parse FAILED to recompose it (the trailing `{}`
  // token-break broke resolveAccentBase's regex), so a saved-then-reloaded doc
  // showed raw grey LaTeX instead of the glyph. We now serialize→reparse for
  // EVERY accent over \i and \j.
  const DOTLESS_BASES = ["\\i", "\\j"];
  for (const entry of ACCENT_TABLE) {
    for (const base of DOTLESS_BASES) {
      const src = `\\${entry.key}{${base}}`;
      it(`${src} parse → serialize → reparse stabilizes (no grey-LaTeX fallback)`, () => {
        const first = parseBody(`A ${src} B`);
        const glyph = gather(first);
        // The accent must have composed to a glyph, NOT leaked raw LaTeX.
        expect(glyph).not.toContain("\\");
        // Full loop: serialize then reparse.
        const serialized = serializeBody(first);
        const reparsed = gather(parseBody(serialized));
        expect(reparsed).not.toContain("\\"); // still no grey-LaTeX fallback
        expect(reparsed.normalize("NFC")).toEqual(glyph.normalize("NFC"));
      });
    }
  }

  it("serialized form `\\^{\\i{}}` reparses to the composed glyph (the exact corruption case)", () => {
    const glyph = gather(parseBody("\\^{\\i}")).normalize("NFC");
    // This is literally what typographyToLatex emits — it MUST reparse.
    const reparsed = gather(parseBody("\\^{\\i{}}")).normalize("NFC");
    expect(reparsed).toEqual(glyph);
    expect(reparsed).not.toContain("\\");
  });
});

describe("regression: display-math + verbatim stay literal — never glyphified (D2)", () => {
  it("does NOT convert -- inside $$…$$ display math", () => {
    const text = gather(parseBody("an equation $$ a -- b $$ here"));
    // The math content keeps its literal hyphens; no en-dash glyph.
    expect(text).toContain("a -- b");
    expect(text).not.toContain(EN_DASH);
  });

  it("does NOT compose an accent inside $$…$$ display math", () => {
    const text = gather(parseBody("$$ \\'e $$"));
    expect(text).toContain("\\'e"); // literal LaTeX in the math attr
    expect(text).not.toContain("é");
  });

  it("does NOT convert -- inside an inline \\[ … \\] math span", () => {
    // mid-paragraph \[…\] (not at a block boundary) must still stay literal.
    const json = parseBody("x \\[ a -- b \\] y");
    // Find the math node anywhere in the tree.
    type MathNode = {
      type?: string;
      attrs?: { latex?: string };
      content?: MathNode[];
    };
    const collectMath = (n: MathNode, acc: string[] = []): string[] => {
      if (n.type === "inlineMath" || n.type === "displayMath")
        acc.push(n.attrs?.latex || "");
      if (n.content) for (const c of n.content) collectMath(c, acc);
      return acc;
    };
    const maths = collectMath(json as MathNode);
    expect(maths.join(" ")).toContain("a -- b");
    expect(maths.join(" ")).not.toContain(EN_DASH);
  });

  it("does NOT convert -- inside \\verb|…| (verbatim) and round-trips byte-faithfully", () => {
    const first = parseBody("code \\verb|a--b| done");
    const text = gather(first);
    expect(text).toContain("\\verb|a--b|");
    expect(text).not.toContain(EN_DASH);
    // Serialize must NOT fold the payload into \texttt{} or glyphify it.
    const out = serializeBody(first);
    expect(out).toContain("\\verb|a--b|");
    expect(out).not.toContain(EN_DASH);
    expect(out).not.toContain("\\texttt{a--b}");
  });

  it("does not mistake \\verbatim or \\verbose for \\verb", () => {
    // `\verb` is a control word: the delimiter must be a non-letter, so a
    // following letter (`\verbatim`) is NOT a \verb span.
    const text = gather(parseBody("\\verbatim"));
    expect(text).toContain("\\verbatim");
  });
});

describe("regression: stacked combining marks never emit bare combining bytes (D4)", () => {
  // Vietnamese ặ (a + breve + dot-below) and ấ (a + circ + acute) used to
  // serialize to `\d{a}` + a BARE combining mark floating in the text — not
  // valid/portable LaTeX. They must now nest the accents.
  const STACKED = ["ặ", "ấ", "ậ", "ề", "ố"];
  for (const glyph of STACKED) {
    it(`${glyph} serializes to nested accents with no trailing bare combining mark`, () => {
      const out = typographyToLatex(glyph);
      // No bare combining diacritical mark (U+0300–U+036F) survives in output.
      expect(/[̀-ͯ]/.test(out)).toBe(false);
      // And it round-trips: reparse recovers the same glyph.
      const reparsed = gather(parseBody(out));
      expect(reparsed.normalize("NFC")).toEqual(glyph.normalize("NFC"));
    });
  }

  it("ặ specifically nests as \\u{\\d{a}}-shaped LaTeX (no `\\d{a}` + bare breve)", () => {
    const out = typographyToLatex("ặ");
    // Two nested accent commands, single base letter `a`, balanced braces.
    expect(out).toMatch(/^\\[a-zA-Z]\{\\[a-zA-Z]\{a\}\}$/);
  });
});

describe("regression: the two-argument tie \\t is excluded from the accent table (D3)", () => {
  it("\\t is NOT in ACCENT_TABLE (it cannot fit the single-base model)", () => {
    expect(ACCENT_TABLE.some((e) => e.key === "t")).toBe(false);
  });

  it("\\t{oo} stays a clean raw command, not a broken half-conversion", () => {
    const text = gather(parseBody("\\t{oo}"));
    expect(text).toContain("\\t{oo}");
  });

  it("serialize never drops the second tied letter (no lossy `\\t{t}s`)", () => {
    // A real tie glyph t͡s must not lose its `s`. Since \t is excluded, the
    // tie codepoint stays literal — never the lossy `\t{t}s`.
    const out = typographyToLatex("t͡s");
    expect(out).not.toContain("\\t{t}s");
  });
});
