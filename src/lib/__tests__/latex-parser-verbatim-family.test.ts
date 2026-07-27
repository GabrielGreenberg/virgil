import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { VERBATIM_ENVS_FULL } from "@/lib/latex-lexer";

/**
 * Task 243 — the parser's `\begin{env}` end-finding must treat EVERY member of
 * the `VERBATIM_ENVS_FULL` vocab SSOT as a literal, non-nestable body (first
 * `\end{env}` wins), not just bare `verbatim`. Before the fix, `verbatim*` /
 * `lstlisting` / `minted` fell onto the depth-counting path: a literal
 * `\begin{env}` inside the body bumped the counter, the real close was skipped,
 * `findMatchingEnd` returned -1, and the block swallowed the rest of the
 * document into one grey paragraph — following paragraphs vanished on reload.
 */
function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function topLevel(doc: any): any[] {
  return doc.content ?? [];
}

function nodeText(node: any): string {
  return (node.content ?? []).map((c: any) => c.text ?? "").join("");
}

describe("parser verbatim-family end-finding (task 243)", () => {
  // Bare `verbatim` was already correct — pin it so the family generalization
  // doesn't regress the original member.
  const MEMBERS = VERBATIM_ENVS_FULL;

  for (const env of MEMBERS) {
    it(`terminates a ${env} block at the FIRST \\end{${env}} and keeps the trailing paragraph`, () => {
      // A LITERAL `\begin{${env}}` inside the body (a listing showing LaTeX
      // source). Depth-counting would skip the real close and swallow to EOF.
      const input = [
        `\\begin{${env}}`,
        `here is a nested \\begin{${env}} shown literally`,
        `\\end{${env}}`,
        ``,
        `SURVIVOR PARAGRAPH`,
      ].join("\n");

      const nodes = topLevel(parseBody(input));

      // Representation-agnostic (bare `verbatim` → codeBlock; the other family
      // members → raw grey paragraphs): the survivor is a DISTINCT top-level
      // node whose text is exactly the survivor line — never fused into the
      // block. On `main` the non-`verbatim` members FAIL here (swallow-to-EOF).
      const survivor = nodes.find(
        (n: any) => nodeText(n).trim() === "SURVIVOR PARAGRAPH",
      );
      expect(
        survivor,
        `survivor paragraph should survive for ${env}`,
      ).toBeTruthy();

      // No single node may hold both the block opener AND the survivor line —
      // that fusion is the swallow signature.
      const swallowed = nodes.some((n: any) => {
        const t = nodeText(n);
        return t.includes(`\\begin{${env}}`) && t.includes("SURVIVOR PARAGRAPH");
      });
      expect(swallowed, `${env} block must not swallow the survivor`).toBe(false);
    });
  }
});
