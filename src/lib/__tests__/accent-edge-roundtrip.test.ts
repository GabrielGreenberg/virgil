// Task 779 — the accent machinery rewrote the user's LaTeX in three ways, each
// a FIXED POINT across saves that changes what LaTeX prints (audit D5, tick 154):
//
//   M1  empty-base accent: `x\^{}2` → `\^{x}2` (the caret glyph became a hat on
//       the previous letter), `a.edu/\~{}user` → a raw U+0303 in the .tex.
//       `\^{}` is not an accent over nothing — it is the SPACING accent glyph,
//       so it is refused to the carrier and written back byte-verbatim.
//   M2  `smartenStraightQuotes` ran its closing catch-all over `latexCommand`
//       runs and turned every escaped `\"` (an umlaut accent inside an
//       unmodelled command) into `\''` — an acute plus a quote.
//   M3  `\"\i ve` — the nested special letter did not consume the space that
//       terminates the control word, so the output kept it ("Naï ve").
//
// Every leg drives the REAL save pipeline over two cycles, mirroring
// `storage-fsa.writeDocBundle` (same harness as `non-prose-bytes-roundtrip`).
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import {
  __typographyTables,
  matchAccent,
  smartenStraightQuotes,
  typographyToLatex,
} from "@/lib/latex-typography";

function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

function doc(bodyText: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${bodyText}\n\\end{document}\n`;
}

function twoCycles(input: string): string {
  const c1 = save(doc(input));
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  return body(c1);
}

/** A standalone combining mark: one not preceded by a base it composes onto. */
const LONE_COMBINING = /(^|[\s{}\\])[̀-ͯ]/u;

describe("task 779 — accent machinery never rewrites the user's LaTeX", () => {
  describe("M1 — an empty-base accent is the spacing glyph, carried verbatim", () => {
    const ROWS = [
      "x\\^{}2 and y",
      "see a.edu/\\~{}user",
      "\\'{} start",
      "a\\`{}b and c\\={} d",
    ];
    for (const input of ROWS) {
      it(`round-trips ${JSON.stringify(input)} byte-identical`, () => {
        expect(twoCycles(input)).toBe(input);
      });
    }

    it("every accent in the table, over an empty base, round-trips and writes no combining mark", () => {
      for (const e of __typographyTables.ACCENT_TABLE) {
        const input = `q\\${e.key}{}z`;
        const out = twoCycles(input);
        expect(out, `\\${e.key}{}`).toBe(input);
        expect(out).not.toMatch(/[̀-ͯ]/u);
      }
    });

    it("matchAccent refuses an empty base (no lone combining glyph is minted)", () => {
      for (const e of __typographyTables.ACCENT_TABLE) {
        expect(matchAccent(`\\${e.key}{}`, 0), `\\${e.key}{}`).toBeNull();
      }
    });

    it("controls: a real accent still composes and canonicalises", () => {
      expect(twoCycles("caf\\'{e} and na\\\"ive")).toBe("caf\\'{e} and na\\\"{i}ve");
    });
  });

  describe("census — no path writes a standalone combining mark into the .tex", () => {
    it("typographyToLatex over every lone combining mark in the accent table", () => {
      for (const e of __typographyTables.ACCENT_TABLE) {
        for (const ctx of [e.combining, ` ${e.combining}x`, `α${e.combining}`, `{${e.combining}}`]) {
          const out = typographyToLatex(ctx);
          expect(out, JSON.stringify(ctx)).not.toMatch(LONE_COMBINING);
        }
      }
    });
  });

  describe("M2 — an escaped quote is never smartened", () => {
    it('round-trips \\index{M\\"uller}', () => {
      expect(twoCycles('\\index{M\\"uller} x')).toBe('\\index{M\\"uller} x');
    });

    it('round-trips a \\" control symbol with a spaced base', () => {
      expect(twoCycles('a \\" o b')).toBe('a \\" o b');
    });

    it("smartenStraightQuotes skips an odd backslash run and keeps an even one", () => {
      expect(smartenStraightQuotes('M\\"uller')).toBe('M\\"uller');
      expect(smartenStraightQuotes('a\\\\"b"')).toBe("a\\\\''b''");
      expect(smartenStraightQuotes('say "hi"')).toBe("say ``hi''");
    });
  });

  describe("M3 — a nested special letter consumes its terminating space", () => {
    it('Na\\"\\i ve serialises to a spelling that prints "Naïve"', () => {
      const out = twoCycles('Na\\"\\i ve');
      expect(out).toBe('Na\\"{\\i{}}ve');
    });

    it("control: \\i{} followed by a space keeps the space", () => {
      expect(twoCycles('Na\\"\\i{} ve')).toBe('Na\\"{\\i{}} ve');
    });
  });
});
