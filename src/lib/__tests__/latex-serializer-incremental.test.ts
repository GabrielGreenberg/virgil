// @vitest-environment node
/**
 * Per-block serialize + assembly (perf Wave 0, plan P2-S1) — the substrate
 * the Wave-1 DocProducts pipeline memoizes per PM node.
 *
 * `serializeToLatex` is now literally `assembleLatex(content.map(
 * serializeTopLevelBlock), …)`, so the whole roundtrip suite pins the shared
 * path. What THIS file adds:
 *   1. memoization-correctness — reusing a cached per-block result for
 *      untouched blocks after an edit reproduces the cold serialize byte-
 *      for-byte (the property the incremental cache depends on);
 *   2. the cross-block bib-family fold (first concrete wins; conflict is
 *      absorbed to natbib — matching one whole-walk collector);
 *   3. the requirement-id union across blocks.
 */
import { describe, it, expect } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  serializeToLatex,
  serializeTopLevelBlock,
  assembleLatex,
  collectPreambleTitleFields,
  type TopLevelBlockLatex,
} from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

const RICH_TEX = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{natbib}
\\providecommand{\\vfid}[1]{}
\\providecommand{\\vcid}[1]{}

\\title{Fixture} %!v:0a11

\\begin{document}

\\maketitle %!v:00aa

\\section{One}
\\label{sec:one} %!v:1100

First paragraph with a cite \\vcid{c001}\\citet{key2020} and a
footnote\\vfid{f001}\\footnote{A note body.}. %!v:1101

\\begin{itemize}
  \\item item one; %!v:1102
  \\item item two. %!v:1103
\\end{itemize} %!v:1104

\\begin{verbatim}
raw   bytes   preserved

exactly
\\end{verbatim} %!v:1105

Second paragraph, plain prose. %!v:1106

\\end{document}
`;

function partsOf(doc: JSONContent): TopLevelBlockLatex[] {
  return (doc.content ?? []).map((n) => serializeTopLevelBlock(n));
}

describe("per-block serialize + assembly", () => {
  it("cached untouched-block parts + fresh changed-block part reassemble byte-identically", () => {
    const doc = parseLatex(RICH_TEX);
    const delimiters = extractPreambleAndPostamble(RICH_TEX) ?? undefined;

    // "Cache" every block's part (the WeakMap stand-in: index-keyed here).
    const cachedParts = partsOf(doc);

    // Edit ONE block (append text to the second paragraph's JSON).
    const edited: JSONContent = {
      ...doc,
      content: doc.content!.map((n, i) => {
        if (i !== doc.content!.length - 1) return n; // untouched — same ref
        return {
          ...n,
          content: [...(n.content ?? []), { type: "text", text: " Appended." }],
        };
      }),
    };

    // Incremental: reuse cached parts for same-reference blocks, re-serialize
    // only the miss.
    const incrementalParts = edited.content!.map((n, i) =>
      n === doc.content![i] ? cachedParts[i] : serializeTopLevelBlock(n),
    );
    const incremental = assembleLatex(
      incrementalParts,
      collectPreambleTitleFields(edited),
      { ...delimiters },
    );

    // Oracle: the cold whole-doc serialize of the edited doc.
    const cold = serializeToLatex(edited, delimiters);
    expect(incremental).toBe(cold);
    expect(incremental).toContain("Appended.");
    // Verbatim block survived the reassembly byte-for-byte.
    expect(incremental).toContain("raw   bytes   preserved");
  });

  it("requirement ids union across blocks (cite requirements reach the preamble from any block)", () => {
    const doc = parseLatex(RICH_TEX);
    const out = serializeToLatex(doc, extractPreambleAndPostamble(RICH_TEX) ?? undefined);
    // The cite emit-site declares the natbib family/shims; the assembled
    // preamble must carry the cite machinery even though only ONE block
    // declared it. (natbib is already in the fixture preamble — the pin is
    // that assembly didn't LOSE it and the vcid shim survives.)
    expect(out).toContain("\\usepackage{natbib}");
    expect(out).toContain("\\providecommand{\\vcid}");
  });

  it("bib-family fold: conflict across blocks absorbs to natbib, matching a whole-walk collector", () => {
    // Build two synthetic parts declaring different families and assemble —
    // the declaredFamily handed to the preamble reconciler must be natbib.
    // (Direct unit pin on foldBibFamilies via assembleLatex's observable:
    // a biblatex-only part list keeps biblatex; adding a natbib part after
    // it must absorb the conflict to natbib.)
    const biblatexOnly: TopLevelBlockLatex[] = [
      { latex: "A \\autocite{k}. ", requirementIds: [], bibFamily: "biblatex" },
    ];
    const conflicted: TopLevelBlockLatex[] = [
      ...biblatexOnly,
      { latex: "B \\citet{k}. ", requirementIds: [], bibFamily: "natbib" },
    ];
    // The observable: which family's package the reconciler injects into a
    // bare preamble.
    const bare = "\\documentclass{article}\n\\begin{document}\n";
    const outBiblatex = assembleLatex(biblatexOnly, [], { preamble: bare });
    const outConflicted = assembleLatex(conflicted, [], { preamble: bare });
    expect(outBiblatex).toMatch(/biblatex/);
    expect(outConflicted).toMatch(/natbib/);
    expect(outConflicted).not.toMatch(/\\usepackage.*\{biblatex\}/);
  });
});
