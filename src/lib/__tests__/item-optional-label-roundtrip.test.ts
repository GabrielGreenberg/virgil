import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly as serializeBody } from "@/lib/latex-serializer";
import type { JSONContent } from "@tiptap/react";

/**
 * Task 340 — a list item's `\item[label]` optional argument was READ (to find
 * where the body starts) and then thrown away, so a hand-lettered enumeration
 * or a custom bullet was destroyed on the first save with no edit and no
 * warning. The machinery to preserve unmodeled list content already existed
 * one field over (`listPreamble`), so this was a per-attribute omission in an
 * otherwise preservation-minded design.
 *
 * The label is stored RAW and OPAQUE on the `listItem` node (`itemLabel`) —
 * `[$\bullet$]` is arbitrary LaTeX, and re-parsing it into nodes would need a
 * nested inline model that buys nothing today.
 */

function parseBody(input: string) {
  const wrapped = `\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`;
  return parseLatex(wrapped);
}

function findAll(doc: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  function walk(n: JSONContent) {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  }
  walk(doc);
  return out;
}

/** Parse → serialize, normalizing only the leading/trailing blank lines the
 *  body serializer adds around a top-level block. */
function roundTrip(tex: string): string {
  return serializeBody(parseBody(tex)).trim();
}

describe("task 340 — \\item[label] survives the round trip", () => {
  it("keeps a hand-lettered enumeration byte-identically", () => {
    const tex = `\\begin{enumerate}
  \\item[(a)] alpha
  \\item[(b)] beta
\\end{enumerate}`;
    expect(roundTrip(tex)).toBe(tex);
  });

  it("keeps a custom bullet in itemize byte-identically", () => {
    const tex = `\\begin{itemize}
  \\item[$\\bullet$] first
  \\item[--] second
\\end{itemize}`;
    expect(roundTrip(tex)).toBe(tex);
  });

  it("keeps labels on a NESTED list byte-identically", () => {
    // Written in the serializer's own canonical indentation, so this is a
    // fixed point — the shape a Virgil-saved paper actually holds.
    const tex = `\\begin{itemize}
  \\item[--] outer
  \\begin{enumerate}
    \\item[(i)] inner one
    \\item[(ii)] inner two
  \\end{enumerate}
\\end{itemize}`;
    expect(roundTrip(tex)).toBe(tex);
  });

  it("is IDEMPOTENT — a second open/save cycle changes nothing", () => {
    // The symptom was "opening and saving is enough", so the contract that
    // matters is that repeated cycles never drift. Hand-written indentation
    // is normalized on the first pass; from there the bytes must be stable.
    const tex = `\\begin{itemize}
  \\item[--] outer
    \\begin{enumerate}
      \\item[(i)] inner one
    \\end{enumerate}
\\end{itemize}`;
    const once = roundTrip(tex);
    expect(roundTrip(once)).toBe(once);
    expect(once).toContain("\\item[--]");
    expect(once).toContain("\\item[(i)]");
  });

  it("parses the label onto the listItem node, opaque and unparsed", () => {
    const json = parseBody(`\\begin{itemize}
  \\item[$\\bullet$] first
  \\item plain
\\end{itemize}`);
    const items = findAll(json, "listItem");
    expect(items).toHaveLength(2);
    expect(items[0].attrs?.itemLabel).toBe("$\\bullet$");
    // The label is NOT inline-parsed — it stays raw LaTeX text.
    expect(items[0].attrs?.itemLabel).not.toContain("inlineMath");
    expect(items[1].attrs?.itemLabel ?? null).toBeNull();
  });

  it("a plain \\item still emits a plain \\item — never an empty []", () => {
    const tex = `\\begin{itemize}
  \\item one
  \\item two
\\end{itemize}`;
    const out = roundTrip(tex);
    expect(out).toBe(tex);
    expect(out).not.toContain("[]");
  });

  it("an EMPTY label \\item[] is preserved as an empty label, not dropped", () => {
    // `\item[]` is meaningful LaTeX (an item with no marker at all), so the
    // empty string must be distinguishable from "no optional argument".
    const tex = `\\begin{itemize}
  \\item[] unmarked
\\end{itemize}`;
    const json = parseBody(tex);
    expect(findAll(json, "listItem")[0].attrs?.itemLabel).toBe("");
    expect(roundTrip(tex)).toBe(tex);
  });

  it("survives an edit to the item's TEXT (lives on the node, not on a re-parse)", () => {
    const json = parseBody(`\\begin{enumerate}
  \\item[(a)] alpha
\\end{enumerate}`);
    const item = findAll(json, "listItem")[0];
    // Simulate the user typing in the body: replace the paragraph's text.
    const para = item.content?.[0] as JSONContent;
    para.content = [{ type: "text", text: "alpha rewritten" }];
    expect(serializeBody(json).trim()).toBe(`\\begin{enumerate}
  \\item[(a)] alpha rewritten
\\end{enumerate}`);
  });

  it("scans the bracket BRACE-AWARE — a ] inside braces does not close it", () => {
    const tex = `\\begin{itemize}
  \\item[\\textbf{a]b}] tricky
\\end{itemize}`;
    const json = parseBody(tex);
    expect(findAll(json, "listItem")[0].attrs?.itemLabel).toBe("\\textbf{a]b}");
    expect(roundTrip(tex)).toBe(tex);
  });

  it("treats an escaped \\] as literal, not as the close bracket", () => {
    const tex = `\\begin{itemize}
  \\item[a\\]b] escaped
\\end{itemize}`;
    const json = parseBody(tex);
    expect(findAll(json, "listItem")[0].attrs?.itemLabel).toBe("a\\]b");
    expect(roundTrip(tex)).toBe(tex);
  });

  it("keeps the per-item %!v: marker AFTER the body, with the label before it", () => {
    const tex = `\\begin{enumerate}
  \\item[(a)] alpha %!v:aaaa
  \\item[(b)] beta %!v:bbbb
\\end{enumerate}`;
    const json = parseBody(tex);
    const items = findAll(json, "listItem");
    expect(items[0].attrs?.uuid).toBe("aaaa");
    expect(items[0].attrs?.itemLabel).toBe("(a)");
    expect(items[1].attrs?.uuid).toBe("bbbb");
    expect(items[1].attrs?.itemLabel).toBe("(b)");
    expect(roundTrip(tex)).toBe(tex);
  });

  it("preserves the label alongside a listPreamble (the sibling that worked)", () => {
    const tex = `\\begin{itemize}
  \\setlength{\\itemsep}{0pt}
  \\item[--] one
\\end{itemize}`;
    expect(roundTrip(tex)).toBe(tex);
  });
});
