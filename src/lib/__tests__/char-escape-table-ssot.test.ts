import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CHAR_ESCAPE_TABLE,
  escapeLatexChars,
  matchCharEscapeAt,
  type CharEscapeEntry,
} from "@/lib/latex-typography";
import { parseLatex } from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";
import { commentsStripped } from "./_source-scan";

/**
 * Task 2026-08-16-339 — escape and unescape are ONE table, not two hand lists.
 *
 * The un-escape rung accepted nine spellings and the escape rung emitted six.
 * Three of them (`\{`, `\}`, `\textbackslash{}`) were read and not written, so
 * they were destroyed on the FIRST save with no edit by the user, and the damage
 * was stable under a second round trip — `\{` left an unmatched `{` that
 * swallows the rest of the document into a group; a `\{…\}` pair simply vanished
 * from the PDF. The card/footnote fork carried a second copy that additionally
 * dropped `$` and the bracket protections, so a prose `$` in a footnote came
 * back as an `inlineMath` atom.
 *
 * Both rungs, on BOTH inline surfaces, now read `CHAR_ESCAPE_TABLE`. The legs
 * below are DERIVED from the table, so a future member is covered by
 * declaration rather than by someone remembering to add a case here.
 *
 * The leg with teeth is the CENSUS at the bottom: the table was never the part
 * that could misbehave — a call site spelling its own copy is.
 */

// ── harnesses ────────────────────────────────────────────────────────────────

function wrapDoc(body: string): string {
  return `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;
}

function bodyOf(tex: string): string {
  const m = tex.match(/\\begin\{document\}\n?([\s\S]*?)\n?\\end\{document\}/);
  return (m?.[1] ?? "").trim();
}

/** The two inline surfaces, each as a tex→tex round trip and a text reader. */
const SURFACES = [
  {
    name: "main body (parseLatex / serializeToLatex)",
    roundTrip: (tex: string) => bodyOf(serializeToLatex(parseLatex(wrapDoc(tex)))),
    readText: (tex: string) => {
      const doc = parseLatex(wrapDoc(tex));
      const para = (doc.content ?? []).find((n) => n.type === "paragraph");
      return (para?.content ?? []).map((c) => c.text ?? "").join("");
    },
    writeText: (text: string) =>
      bodyOf(
        serializeToLatex({
          type: "doc",
          content: [
            {
              type: "paragraph",
              attrs: { uuid: null },
              content: [{ type: "text", text }],
            },
          ],
        }),
      ),
  },
  {
    name: "card/footnote body (richLatexToJson / richJsonToLatex)",
    roundTrip: (tex: string) => richJsonToLatex(richLatexToJson(tex)),
    readText: (tex: string) => {
      const doc = richLatexToJson(tex);
      const para = (doc.content ?? []).find((n) => n.type === "paragraph");
      return (para?.content ?? []).map((c) => c.text ?? "").join("");
    },
    writeText: (text: string) =>
      richJsonToLatex({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      }),
  },
] as const;

/**
 * Task 360 RETIRED this file's one exemption, and the deletion is the finding.
 *
 * A member whose LITERAL is a backslash could not survive the tex→doc→tex
 * direction while bare text was an undeclared carrier for raw LaTeX: once
 * parsed, `\textbackslash{}` was a run indistinguishable from a `\command` the
 * user had typed, and the emit rung deliberately did not touch those. With the
 * type-time carrier marking what an edit WRITES, and both inline parsers
 * carrying a control symbol, a bare backslash reaching the emit rung is a
 * literal one — so every member now round-trips from source, and the sweeps
 * below run over the WHOLE table with nothing excused.
 */

// ── the vocabulary, both directions, both surfaces ───────────────────────────

describe("CHAR_ESCAPE_TABLE — one vocabulary, read by both rungs", () => {
  it("declares each member exactly once, in both directions", () => {
    const texts = CHAR_ESCAPE_TABLE.map((e) => e.text);
    const texs = CHAR_ESCAPE_TABLE.map((e) => e.tex);
    expect(new Set(texts).size).toBe(texts.length);
    expect(new Set(texs).size).toBe(texs.length);
    // Non-empty and rich enough that the sweeps below are not vacuous.
    expect(CHAR_ESCAPE_TABLE.length).toBeGreaterThanOrEqual(12);
  });

  it("matches the LONGEST spelling first (`\\textbackslash{}` is not a bare `\\t…`)", () => {
    // Every member must be matched whole at position 0 of its own spelling —
    // the property a hand-ordered alternation gets wrong when a new member
    // prefixes an existing one.
    for (const e of CHAR_ESCAPE_TABLE) {
      expect(matchCharEscapeAt(e.tex, 0)).toEqual({
        char: e.text,
        end: e.tex.length,
      });
    }
  });

  for (const surface of SURFACES) {
    describe(surface.name, () => {
      // doc → tex → doc: holds for EVERY member, including `\`.
      for (const e of CHAR_ESCAPE_TABLE) {
        it(`round-trips the literal ${JSON.stringify(e.text)} through a save`, () => {
          const text = `Prose ${e.text} tail.`;
          const tex = surface.writeText(text);
          expect(surface.readText(tex)).toBe(text);
        });
      }

      // tex → doc → tex: byte identity, the direction that was destroying data.
      for (const e of CHAR_ESCAPE_TABLE) {
        const src = `Prose ${e.tex} tail.`;
        it(`preserves ${JSON.stringify(e.tex)} byte-identically on save`, () => {
          expect(surface.roundTrip(src)).toBe(src);
        });
        it(`…and is STABLE on a second round trip (${JSON.stringify(e.tex)})`, () => {
          // The pre-fix damage was permanent precisely because it was stable:
          // nothing ever healed it. A fix that oscillated would be no better.
          expect(surface.roundTrip(surface.roundTrip(src))).toBe(src);
        });
      }

      it("keeps an escaped brace PAIR (the set-notation case)", () => {
        const src = "The pair \\{a, b\\} and \\textbf{bold}.";
        expect(surface.roundTrip(src)).toBe(src);
      });
    });
  }

  it("339's one-way member round-trips (the residual task 360 closed)", () => {
    // It PARSES — the editor shows a backslash, not four literal words …
    expect(SURFACES[0].readText("Use \\textbackslash{}emph here.")).toBe(
      "Use \\emph here.",
    );
    // … and it now EMITS. Before task 360 this returned `Use \emph here.`:
    // a literal backslash and a typed command were the same document state, so
    // the escape rung left the backslash alone and the source's escaped
    // backslash became a LIVE command on the first save, with no edit by the
    // user. The type-time carrier is what makes the distinction real.
    expect(SURFACES[0].roundTrip("Use \\textbackslash{}emph here.")).toBe(
      "Use \\textbackslash{}emph here.",
    );
  });
});

// ── the emit rule itself ─────────────────────────────────────────────────────

describe("escapeLatexChars — the whole vocabulary, unconditionally", () => {
  it("escapes every member of the table", () => {
    for (const e of CHAR_ESCAPE_TABLE) {
      expect(escapeLatexChars(`a ${e.text} b`)).toBe(`a ${e.tex} b`);
    }
    expect(CHAR_ESCAPE_TABLE.length).toBeGreaterThanOrEqual(12);
  });

  it("does not soften for a run that HOLDS a backslash", () => {
    // Task 339 read a backslash as evidence of ambiguity and withheld the
    // `{`/`}`/`\`/`[`/`]` members from such a run — the only honest rule while
    // a bare text node could still be raw LaTeX. Task 360 removed that
    // possibility at the source (the type-time carrier, plus a control-symbol
    // carrier in both parsers), so a backslash reaching this rung is a LITERAL
    // backslash and the softening would now be a one-directional rewrite:
    // `see {this} and \emph{that}` lost its printed braces to it.
    for (const e of CHAR_ESCAPE_TABLE) {
      expect(escapeLatexChars(`\\cmd ${e.text}`)).toBe(
        `\\textbackslash{}cmd ${e.tex}`,
      );
    }
  });
});

// ── the premise task 360 made TRUE ──────────────────────────────────────────

describe("a bare text node is PROSE (the premise, now by construction)", () => {
  // This block used to assert the OPPOSITE and was right to: bare text was a
  // fourth, undeclared carrier, because `tiptap/latex-command.ts` painted a
  // typed `\command` span grey WITHOUT marking it and the autosave fired 1500 ms
  // later. Each of these strings, as bare document text, then had to survive the
  // escape rung untouched.
  //
  // Task 360 closed the gap in the DOCUMENT MODEL instead of describing it: a
  // raw-LaTeX span takes the `latexCommand` mark as soon as an edit writes one,
  // so a bare run really is prose and its braces really are literal. The typing
  // half is driven through a REAL editor in
  // `tiptap/__tests__/typed-raw-latex-carrier.test.ts`; what this file can still
  // pin is the SOURCE direction — the same strings, arriving as `.tex`, keep
  // their bytes, which is what proves the two halves agree.
  const TYPED = [
    "\\emph{hi} there",
    "{\\bf hi} there",
    "\\cmd[opt]{x} tail",
    "\\textcolor{red}{hi}",
  ];
  for (const surface of SURFACES) {
    for (const typed of TYPED) {
      it(`${surface.name}: keeps ${JSON.stringify(typed)} arriving as source`, () => {
        expect(surface.roundTrip(typed)).toBe(typed);
      });
      it(`${surface.name}: escapes ${JSON.stringify(typed)} as BARE prose`, () => {
        // The other half of the same statement, and the one that would be a
        // corruption if bare text could still be raw LaTeX. Nothing reaches
        // this state by typing any more; a document that somehow holds it is
        // holding literal characters and gets literal characters back.
        const out = surface.writeText(typed);
        expect(out).not.toBe(typed);
        expect(surface.readText(out)).toBe(typed);
      });
    }
  }
});

// ── the protections keep their task-037 job ──────────────────────────────────

describe("bracket protections still protect the case they were built for", () => {
  it("a prose `[` in its OWN run (the `\\\\[len]` / `\\cmd[opt]` abutment) is protected", () => {
    // The abutting hard break / command is a separate NODE, so the run holding
    // the prose bracket has no backslash — which is why `prose-only` costs the
    // task-037 protection nothing.
    expect(escapeLatexChars("[Note]")).toBe("{[}Note{]}");
  });

  it("`{[}` / `{]}` are not folded into a preceding command's arguments", () => {
    const src = "\\cmd{[}x{]} tail";
    expect(SURFACES[0].readText(src)).toBe("\\cmd[x] tail");
  });
});

// ── the leg with teeth: nobody spells their own copy ─────────────────────────

const REPO_ROOT = join(__dirname, "..", "..", "..");

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry === "node_modules" || entry === "__tests__") continue;
        walk(p);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push(p);
      }
    }
  };
  walk(join(REPO_ROOT, root));
  return out;
}

describe("census — the escape vocabulary is spelled in ONE place", () => {
  // Comments are stripped and string literals KEPT: the drift lives in
  // literals (task 255's rule). The distinctive multi-character spellings are
  // the census needles — a single-char `\\&` appears in too many legitimate
  // regex contexts to be a signal, while these five have exactly one home.
  const NEEDLES = [
    "textbackslash{}",
    "textasciitilde{}",
    "textasciicircum{}",
    "{[}",
    "{]}",
  ];
  const OWNER = join("src", "lib", "latex-typography.ts");

  /**
   * A REGEX literal spells the same member differently — `\{` / `\}` are
   * escaped inside a pattern, so the pre-fix alternation reads
   * `textbackslash\{\}` and contains none of the plain needles. That is not a
   * hypothetical spelling: it is precisely how both inline parsers spelled the
   * vocabulary before this task, so a census blind to it would be blind to the
   * exact drift it exists to catch (measured — the first cut of this leg passed
   * with a live second speller in the tree). Searching a de-regex-escaped copy
   * as well covers both forms under one rule.
   */
  const deRegexEscaped = (code: string) => code.replace(/\\([{}[\]])/g, "$1");

  it("no production file outside latex-typography.ts spells a table member", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ["src", "library"]) {
      for (const file of sourceFiles(root)) {
        const rel = file.slice(REPO_ROOT.length + 1);
        if (rel === OWNER) continue;
        scanned++;
        const code = commentsStripped(readFileSync(file, "utf8"));
        const forms = [code, deRegexEscaped(code)];
        for (const n of NEEDLES) {
          if (forms.some((f) => f.includes(n))) offenders.push(`${rel}: ${n}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(500); // the census can actually see the repo
    expect(offenders).toEqual([]);
  });

  it("the owner really does spell them (the census is falsifiable)", () => {
    // A canary on a synthetic fixture would prove nothing here: what must be
    // true is that these needles are findable AT ALL after stripping, or the
    // leg above passes vacuously.
    const owner = commentsStripped(
      readFileSync(join(REPO_ROOT, OWNER), "utf8"),
    );
    for (const n of NEEDLES) expect(owner).toContain(n);
  });

  it("neither inline parser hand-writes an escape alternation", () => {
    // The pre-fix shape, verbatim from both files: a regex alternation of the
    // three text commands plus a `[&%$#_{}]` character class.
    const ALTERNATION = /textbackslash\\\{\\\}\|/;
    for (const rel of [
      join("src", "lib", "latex-parser.ts"),
      join("src", "lib", "footnote-content.ts"),
    ]) {
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect(code).not.toMatch(ALTERNATION);
      // Both must READ the table's matcher instead.
      expect(code).toContain("matchCharEscapeAt");
    }
  });

  it("neither serializer hand-writes an escape replace chain", () => {
    for (const rel of [
      join("src", "lib", "latex-serializer.ts"),
      join("src", "lib", "footnote-content.ts"),
    ]) {
      const code = commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect(code).not.toMatch(/\.replace\(\/\(\?<!\\\\\\\\\)/);
      expect(code).toContain("escapeLatexChars");
    }
  });

  it("the dead `unescapeLatex` identity stub is gone", () => {
    // It was the name the serializer's own comment cited as the round trip's
    // other half — and it was `return text;`, which is how the two rungs came
    // to disagree unnoticed.
    for (const root of ["src", "library"]) {
      for (const file of sourceFiles(root)) {
        const code = commentsStripped(readFileSync(file, "utf8"));
        expect(code).not.toContain("unescapeLatex");
      }
    }
  });
});
