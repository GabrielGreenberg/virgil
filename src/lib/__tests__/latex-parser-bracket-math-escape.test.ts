import { describe, expect, it } from "vitest";
import { parseInlineContent, parseLatex } from "@/lib/latex-parser";

// Task 2026-07-27-242 — `\[…\]` / `\(…\)` math closers must resolve through the
// escape-aware `findUnescaped` parity SSOT (the same rule task 210 gave `$`/`$$`),
// not a raw escape-blind `indexOf`. A `\\` line break immediately before a literal
// `]`/`)` (e.g. a matrix/aligned row ending `\\` right before the display close)
// used to be mis-matched as the closer, truncating the math body and leaking the
// real `\]`/`\)` out as stray text.

function firstParagraphContent(doc: any): any[] {
  const para = (doc.content || []).find((n: any) => n.type === "paragraph");
  return para?.content || [];
}

function parseBlock(body: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${body}\n\\end{document}`;
  return parseLatex(wrapped);
}

describe("bracket-math closer is escape-aware (task 242 — completes the 210 SSOT migration)", () => {
  // ── mid-paragraph inline site (parseInlineContent :293) ───────────────────
  it("inline \\[…\\]: a `\\\\` before a literal `]` does not close early — full body retained, no leak", () => {
    // Actual chars: \[ a \\] \]   (escaped `\\]` inside, real `\]` closes)
    const nodes = parseInlineContent("\\[ a \\\\] \\]");
    const math = nodes.filter((n) => n.type === "inlineMath");
    expect(math).toHaveLength(1);
    // FAILS on main: `indexOf` matches the `\]` inside `\\]` and truncates to `a \`.
    expect(math[0].attrs?.latex).toBe("a \\\\]");
    // The real closer terminated the math — nothing leaks out as a text node.
    expect(nodes.some((n) => n.type === "text" && /\\[\])]/.test(n.text ?? ""))).toBe(false);
  });

  it("inline \\(…\\): the `\\)` twin is escape-aware too", () => {
    // Actual chars: \( a \\) \)
    const nodes = parseInlineContent("\\( a \\\\) \\)");
    const math = nodes.filter((n) => n.type === "inlineMath");
    expect(math).toHaveLength(1);
    expect(math[0].attrs?.latex).toBe("a \\\\)");
    expect(nodes.some((n) => n.type === "text" && /\\[\])]/.test(n.text ?? ""))).toBe(false);
  });

  // ── block display-math site (parseBody :1427) ─────────────────────────────
  it("block \\[…\\]: a `\\\\` before a literal `]` does not close early", () => {
    const doc = parseBlock("\\[ a \\\\] \\]");
    const math = (doc.content || []).find((n: any) => n.type === "displayMath");
    expect(math).toBeTruthy();
    expect(math?.attrs?.latex).toBe("a \\\\]");
  });

  // ── no-escaped-delimiter equivalence: findUnescaped ≡ indexOf ─────────────
  it("plain inline \\[ x^2 \\] / \\( a+b \\) parse byte-identically (fallback matches indexOf)", () => {
    const disp = parseInlineContent("\\[ x^2 \\]").filter((n) => n.type === "inlineMath");
    expect(disp).toHaveLength(1);
    expect(disp[0].attrs?.latex).toBe("x^2");

    const inl = parseInlineContent("\\( a+b \\)").filter((n) => n.type === "inlineMath");
    expect(inl).toHaveLength(1);
    expect(inl[0].attrs?.latex).toBe("a+b");
  });

  it("plain block \\[ x^2 \\] parses byte-identically", () => {
    const doc = parseBlock("\\[ x^2 \\]");
    const math = (doc.content || []).find((n: any) => n.type === "displayMath");
    expect(math?.attrs?.latex).toBe("x^2");
  });
});
