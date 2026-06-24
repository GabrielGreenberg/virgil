// @vitest-environment jsdom
//
// CHIP 5 (TYPO #5) round-trip: a footnote body that contains a nested `\cite`
// AND a nested `\ref` — produced when those atoms are created while editing
// INSIDE a footnote (the create flow now routes the insert to the focused
// footnote editor) — must SERIALIZE back to valid LaTeX with the cite/ref
// INSIDE the `\footnote{…}` braces, and must RE-PARSE into the same atoms.
//
// The footnote node serializes its body through `richJsonToLatex`
// (footnote-content.ts) — the main serializer's `case "footnote"` delegates
// there — and re-parses it through `richLatexToJson`. So both directions live
// in footnote-content.ts; this test pins them at the unit level AND through the
// full-document parse↔serialize loop.

import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson, richJsonToPlainText } from "@/lib/footnote-content";

function parseBody(input: string): JSONContent {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findByType(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  if (node.content) for (const c of node.content) findByType(c, type, out);
  return out;
}

describe("footnote-nested \\cite + \\ref round-trip (CHIP 5)", () => {
  // ── Unit level: the footnote-body serializer/parser pair ──────────────────
  it("serializes a footnote body with a nested cite + ref to LaTeX", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            {
              type: "citation",
              attrs: {
                citationId: "ab12",
                command: "\\cite{smith2020}",
                displayText: "Smith 2020",
              },
            },
            { type: "text", text: " and section " },
            {
              type: "labelRef",
              attrs: {
                label: "sec:intro",
                displayText: "2",
                refCommand: "ref",
                targetKind: "heading",
              },
            },
          ],
        },
      ],
    };
    const latex = richJsonToLatex(body);
    // The cite carries its `\vcid{}` id marker; the ref serializes as `\ref{}`.
    expect(latex).toContain("\\vcid{ab12}\\cite{smith2020}");
    expect(latex).toContain("\\ref{sec:intro}");
    // The whole body is a single inline run — no atom dropped.
    expect(latex).toBe("see \\vcid{ab12}\\cite{smith2020} and section \\ref{sec:intro}");
  });

  it("re-parses a footnote body LaTeX with a cite + ref back into atoms", () => {
    const latex = "see \\vcid{ab12}\\cite{smith2020} and section \\ref{sec:intro}";
    const json = richLatexToJson(latex);
    const cites = findByType(json, "citation");
    const refs = findByType(json, "labelRef");
    expect(cites).toHaveLength(1);
    expect(cites[0].attrs?.citationId).toBe("ab12");
    expect(cites[0].attrs?.command).toBe("\\cite{smith2020}");
    expect(refs).toHaveLength(1);
    expect(refs[0].attrs?.label).toBe("sec:intro");
    expect(refs[0].attrs?.refCommand).toBe("ref");
  });

  it("the \\getref / \\getfullref ref commands round-trip too", () => {
    for (const cmd of ["getref", "getfullref"] as const) {
      const body: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "labelRef",
                attrs: { label: "ex:1", displayText: "(1)", refCommand: cmd, targetKind: "example" },
              },
            ],
          },
        ],
      };
      const latex = richJsonToLatex(body);
      expect(latex).toBe(`\\${cmd}{ex:1}`);
      const back = findByType(richLatexToJson(latex), "labelRef");
      expect(back).toHaveLength(1);
      expect(back[0].attrs?.refCommand).toBe(cmd);
      expect(back[0].attrs?.label).toBe("ex:1");
    }
  });

  // ── Plain-text projection: the nested ref must SURVIVE ───────────────────
  // Regression for the adversarial-review defect: `richJsonToPlainText` had a
  // `citation` case but no `labelRef` case, so a footnote-nested `\ref` (a leaf
  // atom with no `content`) fell through to `return ""` and SILENTLY VANISHED
  // from the plain-text projection that feeds drag ghosts, copy-to-clipboard,
  // tooltips, search, and the compressed/omni card previews. The citation
  // sibling survived; the ref didn't. This pins symmetry between the two.
  it("a nested \\ref survives the plain-text projection (was silently dropped)", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see section " },
            {
              type: "labelRef",
              attrs: { label: "sec:intro", displayText: "2", refCommand: "ref", targetKind: "heading" },
            },
            { type: "text", text: " here" },
          ],
        },
      ],
    };
    const plain = richJsonToPlainText(body);
    // The resolved number is projected (not "" — which would give "see section  here").
    expect(plain).toBe("see section 2 here");
    // And no atom was dropped — the ref text is present.
    expect(plain).toContain("2");
  });

  it("an UNRESOLVED nested \\ref (displayText='') projects its raw command, not ''", () => {
    // On a freshly-parsed (pre-resolution) footnote body the ref has no
    // displayText yet. It must still not vanish — fall back to the raw command.
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x " },
            { type: "labelRef", attrs: { label: "ex:1", displayText: "", refCommand: "getfullref", targetKind: null } },
          ],
        },
      ],
    };
    expect(richJsonToPlainText(body)).toBe("x \\getfullref{ex:1}");
  });

  it("the citation projection still works (the case the ref was missing parity with)", () => {
    const body: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            { type: "citation", attrs: { citationId: "ab12", command: "\\cite{smith2020}", displayText: "Smith 2020" } },
            { type: "text", text: " here" },
          ],
        },
      ],
    };
    expect(richJsonToPlainText(body)).toBe("see Smith 2020 here");
  });

  // ── Full-document level: parse → serialize → parse through the MAIN loop ──
  it("a \\footnote{… \\cite … \\ref …} in document prose round-trips with the cite + ref INSIDE the braces", () => {
    // The label site lives in the body so \ref resolves; the footnote nests
    // both a cite and a ref.
    const input = `\\section{Intro}\\label{sec:intro}

A claim.\\footnote{See \\cite{smith2020} and section \\ref{sec:intro} for context.}`;
    const json = parseBody(input);

    // The footnote node parses with its body content holding the nested atoms.
    const footnotes = findByType(json, "footnote");
    expect(footnotes).toHaveLength(1);
    const fnBody = footnotes[0].attrs?.content as JSONContent;
    expect(findByType(fnBody, "citation")).toHaveLength(1);
    expect(findByType(fnBody, "labelRef")).toHaveLength(1);

    // Serialize the whole doc back to LaTeX — the cite + ref must land INSIDE
    // the `\footnote{…}` braces, not leak into the surrounding prose.
    const out = serializeBody(json);
    const fnMatch = out.match(/\\footnote\{([^}]*\}[^}]*)*?\}/);
    // Pull the footnote argument out and assert both atoms are within it.
    const fnArg = out.slice(out.indexOf("\\footnote{") + "\\footnote{".length);
    expect(fnArg).toContain("\\cite{smith2020}");
    expect(fnArg).toContain("\\ref{sec:intro}");
    // And the cite/ref do NOT appear before the footnote (no leak into prose).
    const beforeFootnote = out.slice(0, out.indexOf("\\footnote{"));
    expect(beforeFootnote).not.toContain("\\cite{smith2020}");
    expect(beforeFootnote).not.toContain("\\ref{sec:intro}");
    expect(fnMatch).not.toBeNull();

    // Re-parse the serialized output — the atoms survive a second loop
    // (idempotency of the nested-atom round-trip).
    const json2 = parseBody(out);
    const footnotes2 = findByType(json2, "footnote");
    expect(footnotes2).toHaveLength(1);
    const fnBody2 = footnotes2[0].attrs?.content as JSONContent;
    expect(findByType(fnBody2, "citation")).toHaveLength(1);
    expect(findByType(fnBody2, "labelRef")).toHaveLength(1);
    expect(findByType(fnBody2, "labelRef")[0].attrs?.label).toBe("sec:intro");
  });
});
