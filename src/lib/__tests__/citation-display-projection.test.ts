import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAR_ESCAPE_TABLE,
  QUOTE_PAIR_LEADS,
  latexToDisplayText,
  matchQuotePairAt,
  matchTextMacroAt,
  NBSP,
} from "@/lib/latex-typography";
import {
  formatAuthorsTruncated,
  formatInlineCitation,
  formatMediumCitationParts,
  formatMinimalCitation,
  parseCiteCommand,
} from "@/lib/bib-parser";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import { commentsStripped } from "./_source-scan";
import type { BibEntry } from "@/lib/types";

/**
 * Task 2026-08-18-368 — a raw LaTeX fragment shown as DISPLAY TEXT is
 * projected, through the SAME tables the parse rungs read.
 *
 * The reported shape (Gabriel's screenshot, 2026-08-18): a chip inside an
 * example rendered "(Kehler, 2002, ex.\textasciitilde{}38, p.\textasciitilde{}22)"
 * — the `[prenote][postnote]` bytes shown to the reader verbatim. Every
 * surface that displays a citation reads ONE formatter
 * (`formatInlineCitation`), and that formatter interpolated raw command bytes
 * AND raw `.bib` field bytes into its output with no projection at all.
 *
 * WHY NO PRE-368 SUITE COULD SEE THIS: every citation fixture in the repo
 * spells its notes and its `.bib` fields in plain ASCII — `[p. 22]`,
 * `author = {Smith, John}` — where the projection is the identity and the
 * divergence between "what the body shows" and "what the chip shows" is
 * unrepresentable. The defect needs a fragment that HOLDS a construct, which is
 * exactly what a real paper's `.bib` and a real `\citep[…]` carry.
 *
 * The leg with teeth is the CENSUS at the bottom: the door was never the part
 * that could misbehave — a formatter that interpolates without asking it is,
 * and it type-checks perfectly.
 */

// ── harnesses ────────────────────────────────────────────────────────────────

/** What BODY TEXT shows for the same bytes: the concatenated text of the first
 *  paragraph the real parser produces. Marked runs (`latexCommand`) keep their
 *  raw bytes, so this is the reader's actual characters, not a model. */
function bodyDisplay(fragment: string): string {
  const doc = parseLatex(
    `\\documentclass{article}\n\\begin{document}\n${fragment}\n\\end{document}\n`,
  );
  const para = (doc.content ?? []).find((n) => n.type === "paragraph");
  return (para?.content ?? []).map((c) => c.text ?? "").join("");
}

const KEHLER: BibEntry = {
  key: "kehler2002coherence",
  type: "book",
  fields: { author: "Kehler, Andrew", year: "2002", title: "Coherence in Discourse" },
  raw: "",
  uid: "",
};

/** A real-world entry: an accented surname, a brace-protected acronym, an
 *  en-dashed page range, an escaped ampersand. */
const LOPEZ: BibEntry = {
  key: "lopez2009",
  type: "article",
  fields: {
    author: "L{\\'o}pez, Luis and M{\\\"u}ller, Ana",
    year: "2009",
    title: "Ellipsis, Anaphora \\& the {DNA} of Language",
    pages: "15--20",
  },
  raw: "",
  uid: "",
};

const BIB = [KEHLER, LOPEZ];

// ── the reported defect ──────────────────────────────────────────────────────

describe("the reported chip (Gabriel, 2026-08-18)", () => {
  // main.tex ~:354, verbatim.
  const REPORTED = "\\citep[ex.\\textasciitilde{}38, p.\\textasciitilde{}22]{kehler2002coherence}";

  it("renders with NO backslash anywhere in the chip", () => {
    const shown = formatInlineCitation(REPORTED, BIB, "natbib");
    expect(shown).not.toContain("\\");
    expect(shown).not.toContain("textasciitilde");
    expect(shown).toBe("(Kehler, 2002, ex.~38, p.~22)");
  });

  it("shows exactly what BODY TEXT would show for the same note bytes", () => {
    // The whole point: two surfaces, one vocabulary. The note text alone (the
    // cite command itself becomes an atom in the body, not text).
    const note = "ex.\\textasciitilde{}38, p.\\textasciitilde{}22";
    expect(latexToDisplayText(note)).toBe(bodyDisplay(note));
  });

  it("the STORED command and the `.tex` are byte-unchanged (display only)", () => {
    // The projection is a VIEW. The atom keeps the bytes it was parsed from and
    // the document round-trips them, or this fix would be the one-directional
    // rewrite of the user's source that every rung of this vocabulary exists to
    // prevent.
    const parsed = parseCiteCommand(REPORTED)!;
    // One bracket in natbib is the POSTnote — `\citep[post]{k}`.
    expect(parsed.postnote).toBe("ex.\\textasciitilde{}38, p.\\textasciitilde{}22");

    const tex = `\\documentclass{article}\n\\begin{document}\nSee ${REPORTED} here.\n\\end{document}\n`;
    const out = serializeToLatex(parseLatex(tex));
    expect(out).toContain(REPORTED);
    // …and a second cycle, so nothing accumulates.
    expect(serializeToLatex(parseLatex(out))).toContain(REPORTED);
  });

  it("a TIE in the note renders as the character it means, not as a printed tilde", () => {
    // Task 349 M5's decision, inherited rather than re-decided: a source `~` is
    // U+00A0, `\textasciitilde{}` is the ASCII tilde. Two spellings, two
    // characters — the provenance the round trip rests on.
    const tie = formatInlineCitation("\\citep[p.~22]{kehler2002coherence}", BIB, "natbib");
    expect(tie).toBe(`(Kehler, 2002, p.${NBSP}22)`);
    expect(tie).not.toContain("~");
  });
});

// ── the sweep: `.bib` FIELD text reaches the same surfaces just as raw ────────

describe("bib field text is projected too", () => {
  it("an accented surname renders as its glyph in every formatter", () => {
    // BibTeX's grouping braces survive, deliberately — see the "no vocabulary
    // is invented" leg below and the recorded residual. What must not survive
    // is the ACCENT COMMAND, which is what made the name unreadable.
    for (const shown of [
      formatInlineCitation("\\citep{lopez2009}", BIB, "natbib"),
      formatMinimalCitation("lopez2009", BIB),
      formatMediumCitationParts("lopez2009", BIB).author,
      formatAuthorsTruncated(LOPEZ.fields.author!),
    ]) {
      expect(shown).toContain("ó");
      expect(shown).toContain("ü");
      expect(shown).not.toContain("\\");
    }
    expect(formatMinimalCitation("lopez2009", BIB)).toBe(
      "L{ó}pez and M{ü}ller (2009)",
    );
  });

  it("an escaped ampersand and an en-dashed range in a title/parts render as glyphs", () => {
    const parts = formatMediumCitationParts("lopez2009", BIB);
    expect(parts.title).toBe("Ellipsis, Anaphora & the {DNA} of Language");
    expect(parts.title).not.toContain("\\&");
  });

  it("the formatter's own intentional markup survives the projection", () => {
    // `formatInlineCitation` emits `<i>…</i>` for a standalone work; the
    // projection runs over the finished string and must leave those tags alone
    // (no lead character appears in them), while still un-escaping the field
    // text they wrap.
    expect(latexToDisplayText("<i>Ellipsis \\& Anaphora</i>")).toBe(
      "<i>Ellipsis & Anaphora</i>",
    );
    const out = formatInlineCitation("\\citetitle{lopez2009}", BIB, "biblatex");
    expect(out).toContain("&");
    expect(out).not.toContain("\\&");
  });
});

// ── the door is DERIVED, not hand-listed ─────────────────────────────────────

describe("latexToDisplayText reads the shared tables", () => {
  it("every CHAR_ESCAPE_TABLE member projects to its literal character", () => {
    for (const e of CHAR_ESCAPE_TABLE) {
      expect(latexToDisplayText(`a${e.tex}b`), e.tex).toBe(`a${e.text}b`);
    }
    expect(CHAR_ESCAPE_TABLE.length).toBeGreaterThanOrEqual(12);
  });

  it("accents, special letters, dashes and text macros all resolve", () => {
    expect(latexToDisplayText("caf\\'e")).toBe("café");
    expect(latexToDisplayText("Wei\\ss{}")).toBe("Weiß");
    expect(latexToDisplayText("15--20")).toBe("15–20");
    expect(latexToDisplayText("a---b")).toBe("a—b");
    expect(latexToDisplayText("and so on\\ldots")).toBe("and so on…");
    // RENEGOTIATED (task 380). This used to expect "LaTeX{} and TeX{}" — the
    // `{}` after a control word is a TOKEN BREAK, not content, so showing it to
    // a reader was never right; the shared macro door consumes it now.
    expect(latexToDisplayText("\\LaTeX{} and \\TeX{}")).toBe("LaTeX and TeX");
    expect(latexToDisplayText("and so on\\ldots{} etc")).toBe("and so on… etc");
  });

  it("quote pairs come from the shared table, lone quotes pass through", () => {
    expect(latexToDisplayText("``x''")).toBe("“x”");
    expect(latexToDisplayText("it's")).toBe("it's");
    expect([...QUOTE_PAIR_LEADS].sort()).toEqual(["'", "`"]);
    expect(matchQuotePairAt("`x", 0)).toBeNull();
  });

  it("is TOTAL by passing unknown constructs through, never by guessing", () => {
    // No formatting-command vocabulary exists in this codebase as an SSOT, so
    // the door models no marks — an unknown command arrives at the reader
    // exactly as it sits in the file, which is what the BODY shows too.
    expect(latexToDisplayText("\\emph{x}")).toBe("\\emph{x}");
    expect(latexToDisplayText("p.\\,22")).toBe("p.\\,22");
    // …and a construct NESTED inside an unknown command is still reached,
    // because the fallback advances by one byte rather than eating the token.
    expect(latexToDisplayText("\\emph{caf\\'e}")).toBe("\\emph{café}");
  });

  it("plain text is returned unchanged (the bail)", () => {
    for (const s of ["", "Smith 2002", "pp. 15-20", "n.d."]) {
      expect(latexToDisplayText(s)).toBe(s);
    }
  });
});

// ── the text-macro table is the parsers' vocabulary, byte-identically ────────

describe("matchTextMacroAt replaces the hand-written alternation", () => {
  it("matches the GLYPH-backed names, whole", () => {
    expect(matchTextMacroAt("\\ldots", 0)).toEqual({ text: "…", end: 6 });
    expect(matchTextMacroAt("\\dots", 0)).toEqual({ text: "…", end: 5 });
    // RENEGOTIATED (task 380). This used to expect `\LaTeX` / `\TeX` to convert
    // here too — which IS the defect that task closed: neither stands for a
    // character the document model can hold, so the parsers' door has no way
    // back and the command was destroyed on open. They live in the DISPLAY
    // vocabulary now (asserted above, through `latexToDisplayText`) and reach
    // the document only on the raw-LaTeX carrier.
    expect(matchTextMacroAt("\\LaTeX", 0)).toBeNull();
    expect(matchTextMacroAt("\\TeX", 0)).toBeNull();
  });

  it("declines a LONGER command that merely starts with one (the `\\b` rule)", () => {
    expect(matchTextMacroAt("\\dotsc", 0)).toBeNull();
    expect(matchTextMacroAt("\\TeXt", 0)).toBeNull();
    expect(matchTextMacroAt("\\ldotsx", 0)).toBeNull();
  });

  it("both inline parsers show the ellipsis, from the same table", () => {
    expect(bodyDisplay("a\\ldots b")).toBe("a… b");
    expect(latexToDisplayText("a\\ldots b")).toBe("a… b");
  });
});

// ── the leg with teeth: nobody displays raw bytes ────────────────────────────

const REPO_ROOT = join(__dirname, "..", "..", "..");
const BIB_PARSERS = [
  join("src", "lib", "bib-parser.ts"),
  join("library", "lib", "bib-parser.ts"),
];

/**
 * A formatter that legitimately does NOT project, keyed by NAME with its
 * reason. `formatBibliography` returns citation-js's own HTML rendering: it is
 * a different medium (its consumers hand it to `dangerouslySetInnerHTML` after
 * an allowlist sanitizer), and citation-js does some LaTeX handling of its own,
 * so projecting it is a decision about that renderer rather than about this
 * door. RECORDED, not fixed — see the residual note in the task.
 */
const PERMITTED_UNPROJECTED_FORMATTERS: Record<string, string> = {
  formatBibliography:
    "returns citation-js HTML, a different medium with its own sanitizer path",
};

/** The declaration region of a top-level `export function NAME(` — up to the
 *  next column-0 `}`. */
function declarationRegion(code: string, decl: string): string {
  const at = code.indexOf(decl);
  if (at === -1) return "";
  const end = code.indexOf("\n}", at);
  return code.slice(at, end === -1 ? code.length : end);
}

describe("census — every exported display formatter asks the door", () => {
  it("membership is DISCOVERED from the file, and each member projects", () => {
    const offenders: string[] = [];
    let discovered = 0;
    for (const rel of BIB_PARSERS) {
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      for (const m of code.matchAll(/export function (format[A-Za-z]*)\(/g)) {
        const name = m[1];
        discovered++;
        if (PERMITTED_UNPROJECTED_FORMATTERS[name]) continue;
        const region = declarationRegion(code, m[0]);
        if (!region.includes("latexToDisplayText(")) offenders.push(`${rel}: ${name}`);
      }
    }
    // Not vacuous: both copies of the formatter family must have been seen.
    expect(discovered).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  it("the raw dispatch is module-PRIVATE in both copies", () => {
    // An exported raw formatter is a SECOND display door, and the one a caller
    // reaches for is the one that skips the projection.
    for (const rel of BIB_PARSERS) {
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect(code, rel).toContain("function formatInlineCitationRaw(");
      expect(code, rel).not.toContain("export function formatInlineCitationRaw(");
    }
  });

  it("nobody outside latex-typography.ts spells a quote-pair or text-macro table", () => {
    // The two vocabularies this task consolidated. Both were hand-written in
    // BOTH inline parsers before it (task 341's twin rule), which is precisely
    // the drift a behavioural test of the door cannot see.
    for (const rel of [
      join("src", "lib", "latex-parser.ts"),
      join("src", "lib", "footnote-content.ts"),
    ]) {
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect(code, `${rel} must ask the shared quote door`).toContain(
        "matchQuotePairAt(",
      );
      expect(code, `${rel} must ask the shared macro door`).toContain(
        "matchTextMacroAt(",
      );
      expect(code, `${rel} must not re-alternate the text macros`).not.toContain(
        "ldots|dots",
      );
    }
  });
});
