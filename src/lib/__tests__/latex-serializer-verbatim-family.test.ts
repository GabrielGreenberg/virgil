import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { VERBATIM_ENVS_FULL } from "@/lib/latex-lexer";

/**
 * Task 243 — `collapseBlankRuns` stashes verbatim blocks behind placeholders
 * before squashing `\n{3,}` → `\n\n`, so their byte-preserving bodies keep
 * interior blank runs. Before the fix the stash pattern matched ONLY bare
 * `\begin{verbatim}`, so a `verbatim*` / `lstlisting` / `minted` body with 3+
 * consecutive blank lines had them silently collapsed on every save.
 */
function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

describe("serializer verbatim-family blank-run preservation (task 243)", () => {
  for (const env of VERBATIM_ENVS_FULL) {
    it(`preserves a 3-blank-line run inside a ${env} body`, () => {
      // Three consecutive blank lines (four newlines) between two code lines.
      const body = `code a\n\n\n\ncode b`;
      const input = `before\n\n\\begin{${env}}\n${body}\n\\end{${env}}\n\nafter`;

      const out = serializeBodyOnly(parseBody(input));

      // The interior blank run survives byte-for-byte inside the block.
      expect(
        out,
        `${env} interior blank run must not be collapsed`,
      ).toContain(body);
      // And prose OUTSIDE the block is still collapsed (paragraph separator).
      expect(out).toContain("before\n\n\\begin{" + env + "}");
    });
  }

  it("still collapses blank runs in ordinary prose (no false stash)", () => {
    const input = "one\n\n\n\ntwo";
    const out = serializeBodyOnly(parseBody(input));
    expect(out).not.toContain("one\n\n\n\ntwo");
    expect(out).toContain("one\n\ntwo");
  });
});
