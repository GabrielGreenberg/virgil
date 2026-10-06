import { describe, expect, it } from "vitest";
import { stuffedDelimiterEscape, TEX_BLOCK_END_ESCAPE } from "@/lib/latex-lexer";

// Task 973: the delimiter escape is byte-stuffing — escape adds exactly one pad
// to every `head pad* tail`, unescape removes exactly one — so it is injective
// (unescape ∘ escape = id over ALL strings) and the escaped form never holds the
// bare delimiter.
describe("stuffedDelimiterEscape", () => {
  const alphabet = ["%!v", " ", "tex:end", "x", "\n", "%", "!"];
  function* strings(depth: number, prefix = ""): Generator<string> {
    yield prefix;
    if (depth === 0) return;
    for (const a of alphabet) yield* strings(depth - 1, prefix + a);
  }

  it("is injective over every string built from the sentinel's own pieces", () => {
    let n = 0;
    for (const s of strings(4)) {
      const e = TEX_BLOCK_END_ESCAPE.escape(s);
      expect(e).not.toContain("%!vtex:end");
      expect(TEX_BLOCK_END_ESCAPE.unescape(e)).toBe(s);
      n++;
    }
    expect(n).toBeGreaterThan(2000);
  });

  it("treats regex metacharacters in the delimiter literally", () => {
    const esc = stuffedDelimiterEscape("\\end{verbatim", "%!v-esc", "}");
    for (const s of ["\\end{verbatim}", "\\end{verbatim%!v-esc}", "\\end{verbatimX}"]) {
      expect(esc.unescape(esc.escape(s))).toBe(s);
    }
    expect(esc.escape("\\end{verbatimX}")).toBe("\\end{verbatimX}");
  });
});
