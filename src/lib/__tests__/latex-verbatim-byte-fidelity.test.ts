import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import {
  assignUuids,
  serializeBodyOnly as serializeBody,
} from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  hasVerbatimMark,
  matchInlineVerbAt,
  VERBATIM_ENVS_FULL,
} from "@/lib/latex-lexer";
import type { JSONContent } from "@tiptap/react";

/**
 * Task 264 — VERBATIM CONTENT IS BYTE-LITERAL.
 *
 * The contract the task-243 fixtures dodge: those bodies are quote-free, so
 * they never exercised the one transform that corrupts verbatim content. Both
 * inline `\verb` runs and the three non-`verbatim` `VERBATIM_ENVS_FULL`
 * members used to ride the undifferentiated `latexCommand` mark, whose
 * serializer path runs `smartenStraightQuotes` — so `x = "hi"` came back
 * ``x = ``hi''`` on the FIRST save, permanently, and (the env being verbatim)
 * visibly wrong in the compiled PDF.
 *
 * Every assertion below FAILS on the pre-264 code and passes after it.
 */

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

/** The argument each family member carries after `\begin{env}` — the bit that
 *  a "map them all to bare verbatim" fix would have thrown away. */
function envArg(env: string): string {
  if (env === "lstlisting") return "[language=Python,caption={a \"quoted\" cap}]";
  if (env === "minted") return "{python}";
  return "";
}

/** A body deliberately loaded with every character the prose paths rewrite:
 *  straight double quotes, an apostrophe, `--`, `[`/`]`, `&%#_$`, `~`, `^`,
 *  and a backslash-letter sequence that looks like an accent command. */
const HOSTILE_BODY = [
  `x = "hi"  # it's a comment -- not an en dash`,
  `arr[0] = a & b % c # d _ e $ f ~ g ^ h`,
  `printf("%d items\\n", n);`,
  `s = 'single' + "double" + \\'e`,
].join("\n");

describe("verbatim-family block bodies are byte-literal (task 264)", () => {
  for (const env of VERBATIM_ENVS_FULL) {
    it(`round-trips a quote-bearing ${env} body byte-exactly`, () => {
      const block = `\\begin{${env}}${envArg(env)}\n${HOSTILE_BODY}\n\\end{${env}}`;
      const out = serializeBody(parseBody(block));

      // The whole block — env name, arguments and body — survives verbatim.
      expect(out, `${env} body must survive byte-for-byte`).toContain(block);
      // And specifically: no smart-quote ligature anywhere in the output.
      expect(out, `${env} must not smart-quote its body`).not.toContain("``");
      expect(out).not.toContain("''");
    });

    it(`is idempotent across three save cycles for ${env}`, () => {
      const block = `\\begin{${env}}${envArg(env)}\n${HOSTILE_BODY}\n\\end{${env}}`;
      let text = serializeBody(parseBody(block));
      const first = text;
      for (let i = 0; i < 2; i++) text = serializeBody(parseBody(text));
      expect(text, `${env} must reach a fixed point, not drift per save`).toBe(
        first,
      );
      expect(text).toContain(block);
    });
  }

  for (const env of VERBATIM_ENVS_FULL) {
    it(`preserves an interior blank-line run in an argument-bearing ${env}`, () => {
      // The serializer's `collapseBlankRuns` stash used to require a newline
      // IMMEDIATELY after `\begin{env}`, so the two members that normally
      // carry an argument never stashed — every `minted` block (its language
      // argument is MANDATORY) and every option-bearing `lstlisting` had its
      // body run through the `\n{3,}` collapse. A PEP8 listing silently lost
      // one of its two blank lines between top-level defs on the first save.
      const body = `def a():\n    pass\n\n\ndef b():\n    pass`;
      const block = `\\begin{${env}}${envArg(env)}\n${body}\n\\end{${env}}`;
      expect(serializeBody(parseBody(block))).toContain(block);
    });

    it(`keeps a stable uuid and mints no orphan anchor for ${env}`, () => {
      // Every family member now produces a uuid-bearing node, so the
      // serializer emits a `%!v:` anchor after `\end{env}`. The parser's
      // harvest list covered only bare `verbatim`, so the other three's anchor
      // was re-read as a STANDALONE empty paragraph: fresh uuid every save
      // (orphaning anchored cards) plus one stray `%!v:` line per save,
      // unbounded. Three real cycles must be a fixed point.
      let tex = `Prose.\n\n\\begin{${env}}${envArg(env)}\nx = "hi"\n\\end{${env}}\n\nAfter.`;
      const seen: string[] = [];
      for (let i = 0; i < 3; i++) {
        const doc = parseBody(tex);
        assignUuids(doc);
        tex = serializeBody(doc);
        seen.push(tex);
      }
      expect(seen[1], `${env} must not drift between saves`).toBe(seen[0]);
      expect(seen[2]).toBe(seen[0]);
      // Exactly three anchors — prose, block, prose. No orphans accumulating.
      expect((seen[2].match(/%!v:/g) ?? []).length).toBe(3);
    });
  }

  it("carries the verbatim mark on every non-`verbatim` family member", () => {
    // Bare `verbatim` is the one member with a modeled node (codeBlock, whose
    // markless byte-raw path predates this task); the other three ride the
    // carrier. Pinned so a future member added to the SSOT can't quietly fall
    // back to the smart-quoting `latexCommand` default branch.
    for (const env of VERBATIM_ENVS_FULL) {
      const doc = parseBody(
        `\\begin{${env}}${envArg(env)}\nx = "hi"\n\\end{${env}}`,
      );
      const top = (doc.content ?? [])[0] as JSONContent;
      if (env === "verbatim") {
        expect(top.type).toBe("codeBlock");
        continue;
      }
      const child = (top.content ?? [])[0] as JSONContent;
      expect(hasVerbatimMark(child.marks), `${env} must carry the carrier`).toBe(
        true,
      );
    }
  });
});

describe("inline \\verb payloads are byte-literal (task 264)", () => {
  const CASES: [string, string][] = [
    ["pipe delimiter, quoted payload", `See \\verb|x = "hi"| ok.`],
    // The quote AS the delimiter: pre-264 this became `\verb''code''`, which
    // is not merely corrupted content but an invalid \verb invocation.
    ["quote delimiter", `See \\verb"code" ok.`],
    ["starred form", `See \\verb*!a "b" c! ok.`],
    ["apostrophes and dashes", `See \\verb|it's a--b| ok.`],
    ["latex specials in payload", `See \\verb|a & b % c $ d _ e [f]| ok.`],
  ];

  for (const [name, src] of CASES) {
    it(`round-trips ${name} byte-exactly`, () => {
      expect(serializeBody(parseBody(src))).toContain(src);
    });

    it(`round-trips ${name} byte-exactly inside a footnote body`, () => {
      // The footnote/card fork (footnote-content.ts) is a SECOND inline
      // parser+serializer; before 264 it had no \verb handling at all, so the
      // payload landed in its plain text buffer and was escaped + smartened.
      expect(richJsonToLatex(richLatexToJson(src))).toBe(src);
    });
  }

  it("does not match a \\verb run whose close is on the NEXT line", () => {
    // LaTeX forbids a \verb run crossing a line, and the lexer's drop
    // projection has always cut at EOL. The anchored matcher now stops there
    // too, so the node tree and the projection agree about which bytes are
    // verbatim.
    expect(matchInlineVerbAt('\\verb|open\nclose |', 0)).toBe(-1);
    const src = `A \\verb|open\nand | later.`;
    const out = serializeBody(parseBody(src));
    expect(out).not.toContain("latexVerbatim");
    expect(out).toContain("\\verb");
  });

  it("does not mis-lex \\verbatim / \\verbdef as \\verb + delimiter", () => {
    // The delimiter must be a non-letter — otherwise `\verbatim` reads as
    // `\verb` + delimiter `a`. Asserted on the shared matcher directly.
    expect(matchInlineVerbAt("\\verbatim{x}", 0)).toBe(-1);
    expect(matchInlineVerbAt("\\verbdef\\foo{bar}", 0)).toBe(-1);
    expect(matchInlineVerbAt("\\verb|a|", 0)).toBe(8);
    expect(matchInlineVerbAt("\\verb*!a!", 0)).toBe(9);
    // Unterminated run: no match, so the text falls through as ordinary prose.
    expect(matchInlineVerbAt("\\verb|unterminated", 0)).toBe(-1);
  });
});

describe("the verbatim carrier does not leak into prose (task 264)", () => {
  it("still smartens straight quotes in ordinary prose", () => {
    const out = serializeBody(parseBody(`He said "hello" to me.`));
    expect(out).toContain("``hello''");
  });

  it("still smartens a STRAY latexCommand span", () => {
    // The smartening on the `latexCommand` path is load-bearing for marks
    // TipTap inherited onto plain prose — 264 must not disable it.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: `\\unknowncmd{he said "hi"}`,
              marks: [{ type: "latexCommand" }],
            },
          ],
        },
      ],
    } as JSONContent;
    expect(serializeBody(doc)).toContain("``hi''");
  });

  it("still smartens straight quotes in a footnote body", () => {
    expect(richJsonToLatex(richLatexToJson(`He said "hello".`))).toContain(
      "``hello''",
    );
  });

  it("smartens a `/`-preceded quote in a footnote the same way body prose does", () => {
    // The footnote fork carried its own copy of the smart-quote transform that
    // had drifted from the serializer's — it omitted `/` from the opener class,
    // so `and/"or"` produced a wrong-way CLOSING pair. Both now read the one
    // `smartenStraightQuotes` SSOT.
    const footnote = richJsonToLatex(richLatexToJson(`and/"or" here`));
    expect(footnote).toContain("and/``or''");
    expect(serializeBody(parseBody(`and/"or" here`))).toContain("and/``or''");
  });

  it("leaves a bare `verbatim` body on its own byte-raw codeBlock path", () => {
    // Regression net over task 207 / 243: the member that DOES have a modeled
    // node keeps it, sentinel escaping and all.
    const block = `\\begin{verbatim}\n${HOSTILE_BODY}\n\\end{verbatim}`;
    const doc = parseBody(block);
    expect((doc.content ?? [])[0]?.type).toBe("codeBlock");
    expect(serializeBody(doc)).toContain(block);
  });
});
