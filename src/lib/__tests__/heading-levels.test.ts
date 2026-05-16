import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function collectHeadings(doc: ReturnType<typeof parseLatex>) {
  const out: Array<{ level: number; text: string }> = [];
  function walk(n: { type?: string; attrs?: { level?: number }; content?: unknown[] }) {
    if (n.type === "heading") {
      const text = (((n as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text || "").join(""));
      out.push({ level: n.attrs?.level ?? -1, text });
    }
    if (n.content) for (const c of n.content as Array<typeof n>) walk(c);
  }
  walk(doc as unknown as { content?: unknown[] });
  return out;
}

describe("heading levels 0..6 (\\part .. \\subparagraph)", () => {
  it("parses every LaTeX heading command at the correct level", () => {
    const json = parseBody(
      "\\part{Pa}\n\\chapter{Ch}\n\\section{Se}\n\\subsection{Su}\n\\subsubsection{Ss}\n\\paragraph{Pg}\n\\subparagraph{Sb}\n"
    );
    expect(collectHeadings(json)).toEqual([
      { level: 0, text: "Pa" },
      { level: 1, text: "Ch" },
      { level: 2, text: "Se" },
      { level: 3, text: "Su" },
      { level: 4, text: "Ss" },
      { level: 5, text: "Pg" },
      { level: 6, text: "Sb" },
    ]);
  });

  it("round-trips all seven heading commands through parse → serialize", () => {
    const src = "\\part{Pa}\n\\chapter{Ch}\n\\section{Se}\n\\subsection{Su}\n\\subsubsection{Ss}\n\\paragraph{Pg}\n\\subparagraph{Sb}\n";
    const json = parseBody(src);
    const out = serializeBodyOnly(json);
    expect(out).toContain("\\part{Pa}");
    expect(out).toContain("\\chapter{Ch}");
    expect(out).toContain("\\section{Se}");
    expect(out).toContain("\\subsection{Su}");
    expect(out).toContain("\\subsubsection{Ss}");
    expect(out).toContain("\\paragraph{Pg}");
    expect(out).toContain("\\subparagraph{Sb}");
  });

  it("round-trips the starred (unnumbered) variant at every level", () => {
    const src =
      "\\part*{Pa}\n\\chapter*{Ch}\n\\section*{Se}\n\\subsection*{Su}\n\\subsubsection*{Ss}\n\\paragraph*{Pg}\n\\subparagraph*{Sb}\n";
    const json = parseBody(src);
    const out = serializeBodyOnly(json);
    expect(out).toContain("\\part*{Pa}");
    expect(out).toContain("\\chapter*{Ch}");
    expect(out).toContain("\\section*{Se}");
    expect(out).toContain("\\subsection*{Su}");
    expect(out).toContain("\\subsubsection*{Ss}");
    expect(out).toContain("\\paragraph*{Pg}");
    expect(out).toContain("\\subparagraph*{Sb}");
  });
});
