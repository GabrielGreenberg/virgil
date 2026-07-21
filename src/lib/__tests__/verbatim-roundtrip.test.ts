import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/core";

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findCodeBlocks(node: any, out: any[] = []): any[] {
  if (node.type === "codeBlock") out.push(node);
  if (node.content) for (const c of node.content) findCodeBlocks(c, out);
  return out;
}

function codeBlockText(node: any): string {
  return (node.content ?? []).map((c: any) => c.text ?? "").join("");
}

/** Serialize a single-codeBlock doc, then re-parse it, and return the recovered body. */
function roundTrip(body: string): { blocks: any[]; topLevel: number; text: string } {
  const doc: JSONContent = {
    type: "doc",
    content: [{ type: "codeBlock", content: [{ type: "text", text: body }] }],
  };
  const tex = serializeBody(doc);
  const reparsed = parseBody(tex);
  const blocks = findCodeBlocks(reparsed);
  return {
    blocks,
    topLevel: (reparsed.content ?? []).length,
    text: blocks.length ? codeBlockText(blocks[0]) : "",
  };
}

describe("verbatim codeBlock round-trip", () => {
  it("round-trips a simple body losslessly", () => {
    const { blocks, text } = roundTrip("const x = 1;\nconst y = 2;");
    expect(blocks).toHaveLength(1);
    expect(text).toBe("const x = 1;\nconst y = 2;");
  });

  // Member 1 — the destructive one. An embedded `\end{verbatim}` must NOT
  // truncate the block into sibling paragraphs.
  it("preserves an embedded \\end{verbatim} without truncating (member 1)", () => {
    const body = "line1\n\\end{verbatim}\nline2";
    const { blocks, topLevel, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(topLevel).toBe(1); // no leaked sibling paragraphs
    expect(text).toBe(body);
  });

  it("serializes an embedded \\end{verbatim} as the escaped sentinel", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          content: [{ type: "text", text: "a\n\\end{verbatim}\nb" }],
        },
      ],
    };
    const tex = serializeBody(doc);
    expect(tex).toContain("\\end{verbatim%!v-esc}");
    // Exactly one real terminator remains (the block's true close).
    expect(tex.match(/\\end\{verbatim\}/g)).toHaveLength(1);
  });

  // Symmetric latent cousin of member 1: a literal `\begin{verbatim}` in the
  // body would bump the old depth-counter and swallow the real close.
  it("preserves a literal \\begin{verbatim} in the body", () => {
    const body = "before\n\\begin{verbatim}\nafter";
    const { blocks, topLevel, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(topLevel).toBe(1);
    expect(text).toBe(body);
  });

  it("handles both delimiters embedded in one body", () => {
    const body = "x\n\\begin{verbatim}\ny\n\\end{verbatim}\nz";
    const { blocks, text } = roundTrip(body);
    expect(blocks).toHaveLength(1);
    expect(text).toBe(body);
  });

  // Member 2 — edge whitespace. Only the serializer's single wrapping `\n`
  // on each side is removed; no other whitespace change.
  it("preserves leading indentation on line 1 (member 2)", () => {
    const { text } = roundTrip("    indented();\nflush();");
    expect(text).toBe("    indented();\nflush();");
  });

  it("preserves a single trailing blank line (member 2)", () => {
    const { text } = roundTrip("code();\n");
    expect(text).toBe("code();\n");
  });

  it("preserves a leading blank line (member 2)", () => {
    const { text } = roundTrip("\ncode();");
    expect(text).toBe("\ncode();");
  });

  // The `\n{3,}` collapse in serializeBodyOnly must be verbatim-aware, or
  // interior double-blank-lines would be silently squashed each save.
  it("preserves multiple interior blank lines byte-faithfully", () => {
    const body = "def a():\n    pass\n\n\ndef b():\n    pass";
    const { text } = roundTrip(body);
    expect(text).toBe(body);
  });

  it("preserves trailing blank lines byte-faithfully", () => {
    const body = "code();\n\n\n";
    const { text } = roundTrip(body);
    expect(text).toBe(body);
  });

  it("round-trips the block UUID anchor", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { uuid: "ab12" },
          content: [{ type: "text", text: "keep();" }],
        },
      ],
    };
    const tex = serializeBody(doc);
    const blocks = findCodeBlocks(parseBody(tex));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs?.uuid).toBe("ab12");
    expect(codeBlockText(blocks[0])).toBe("keep();");
  });

  it("parses a hand-written verbatim with no wrapping newlines", () => {
    // `\begin{verbatim}code\end{verbatim}` — no leading/trailing \n to strip.
    const blocks = findCodeBlocks(
      parseBody("\\begin{verbatim}code\\end{verbatim}"),
    );
    expect(blocks).toHaveLength(1);
    expect(codeBlockText(blocks[0])).toBe("code");
  });
});

/**
 * Task 207 — the serializer used to route the codeBlock body through
 * `serializeInlineSequence` → `escapeLatex` (the PROSE path, typography on)
 * while the parser reads it byte-for-byte. That asymmetry corrupted code
 * punctuation, and for brackets it was unbounded: `{[}` re-ingests literally
 * and gets re-wrapped on the next save, growing a brace layer per cycle.
 * The pre-existing tests above all use special-char-free bodies (`const x = 1;`),
 * so none of this was covered.
 */
describe("verbatim codeBlock is byte-raw (task 207)", () => {
  /** Run N full save→reload cycles; return every emitted `.tex` and body. */
  function cycles(body: string, n: number) {
    let doc: JSONContent = {
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: body }] }],
    };
    const texts: string[] = [];
    const bodies: string[] = [];
    for (let i = 0; i < n; i++) {
      const tex = serializeBody(doc);
      texts.push(tex);
      doc = parseBody(tex) as JSONContent;
      const blocks = findCodeBlocks(doc);
      bodies.push(blocks.length ? codeBlockText(blocks[0]) : "");
    }
    return { texts, bodies };
  }

  const PUNCTUATION_BODIES: [name: string, body: string][] = [
    // The unbounded one: `[`/`]` were rewritten to `{[}`/`{]}` and re-wrapped
    // on every subsequent save.
    ["brackets", "const first = arr[0];\nconst last = arr[arr.length - 1];"],
    // Char escapes: & % # $ _ ^ ~ were all backslash-escaped.
    ["latex-special chars", "x_2 = a & b;  # 50% of $total\ny = z^2 ~ w"],
    ["printf format string", 'printf("%d items, %s\\n", n, name);'],
    // Straight quotes were smart-mapped to `` / '' — fatal in code.
    ["straight quotes", 'const s = "hello";\nconst t = \'world\';'],
    // Typography: directly-typed Unicode glyphs were mapped to LaTeX commands.
    ["directly-typed Unicode", "// café — naïve…\nconst π = 3.14159;"],
    // Shell/markup soup — the whole vocabulary at once.
    ["shell + markup", 'grep -E "^\\[a-z]+$" f.txt | awk \'{print $1}\' & echo ~/x'],
  ];

  for (const [name, body] of PUNCTUATION_BODIES) {
    it(`emits ${name} byte-for-byte and stays idempotent across cycles`, () => {
      const { texts, bodies } = cycles(body, 3);

      // 1. The emitted verbatim body IS the input, byte-for-byte.
      expect(texts[0]).toContain(`\\begin{verbatim}\n${body}\n\\end{verbatim}`);

      // 2. Every reload recovers the original body exactly.
      expect(bodies[0]).toBe(body);
      expect(bodies[1]).toBe(body);
      expect(bodies[2]).toBe(body);

      // 3. Idempotent: serialize∘parse reaches a fixed point immediately.
      //    (Pre-fix, the bracket case FAILED here — it grew every cycle.)
      expect(texts[1]).toBe(texts[0]);
      expect(texts[2]).toBe(texts[0]);
    });
  }

  it("never brace-wraps a bracket, at any cycle depth", () => {
    const { texts } = cycles("arr[0]", 4);
    for (const tex of texts) {
      expect(tex).toContain("arr[0]");
      expect(tex).not.toContain("{[}");
      expect(tex).not.toContain("{]}");
    }
  });

  it("never backslash-escapes a LaTeX special char in the body", () => {
    const { texts } = cycles("a & b % c # d $ e _ f", 2);
    for (const tex of texts) {
      expect(tex).toContain("a & b % c # d $ e _ f");
    }
  });

  it("keeps the \\end{verbatim} sentinel guard working on the raw body", () => {
    // The guard now runs on RAW bytes rather than post-escape ones — it must
    // still fire, and still reverse.
    const body = 'if (x) { print("\\end{verbatim}"); }';
    const { texts, bodies } = cycles(body, 2);
    expect(texts[0]).toContain("\\end{verbatim%!v-esc}");
    expect(bodies[0]).toBe(body);
    expect(bodies[1]).toBe(body);
    expect(texts[1]).toBe(texts[0]);
  });
});
