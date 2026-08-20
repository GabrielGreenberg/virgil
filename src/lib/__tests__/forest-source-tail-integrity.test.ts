/**
 * Task 387 (adversarial run 1 over the forest cluster, DATA-SAFETY lens) —
 * the two defects a USER-EDITABLE body attr introduced into the emit path, and
 * the render defect that painted text the source does not say.
 *
 * **Why no pre-387 suite could see any of these.** Every fixture in
 * `forest-block-roundtrip.test.ts` has a `source` that ends EXACTLY at
 * `\end{forest}` (they all come from a parse, which slices to the closer), so
 * a trailing byte is unrepresentable in all of them; its one list fixture
 * asserts the MODEL SHAPE (`paragraph` head + `forestBlock` tail) and never the
 * bytes, so the separator is invisible to it; and every grammar fixture spells
 * its labels without TeX's end-of-line `%` continuation.
 *
 * All three are silent by construction. The write gate's multiset word measure
 * is unchanged by any of them; the 384 refusal badge stays green for the first
 * (its `END_RE` tolerates `\s*$`, which is precisely the gap) and for the third
 * (the parse succeeds, it just describes a different label).
 */
import { describe, it, expect } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import { parseForestSource } from "@/lib/forest/grammar";
import type { JSONContent } from "@tiptap/core";

function find(node: JSONContent, type: string): JSONContent | null {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = find(child, type);
    if (hit) return hit;
  }
  return null;
}

function open(body: string): JSONContent {
  const doc = parseLatex(`\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  assignUuids(doc);
  return doc;
}

function save(doc: JSONContent): string {
  return serializeBodyOnly(doc);
}

const TREE = "\\begin{forest}\n[S [NP] [VP]]\n\\end{forest}";

describe("a pod edit that leaves a tail cannot move the block's identity", () => {
  // The gesture: caret after `\end{forest}`, press Enter — or Cmd+A and paste a
  // tree copied out of another `.tex`, since every editor line-copies with a
  // trailing newline. Both pod surfaces write CodeMirror's buffer verbatim.
  it.each([
    ["a trailing newline (Enter after the closer)", "\n"],
    ["a pasted trailing newline + blank line", "\n\n"],
    ["trailing spaces", "   "],
    ["a trailing tab", "\t"],
    ["mixed trailing whitespace", " \n \t"],
  ])("%s keeps the uuid ON the tree", (_name, tail) => {
    const doc = open(TREE);
    const node = find(doc, "forestBlock")!;
    const uuid = node.attrs?.uuid as string;
    expect(uuid).toBeTruthy();
    // Sidecar-only facts keyed on that uuid — the things that follow it.
    node.attrs = { ...node.attrs, parTitle: "Fig. 3 tree", collapsed: true };
    // THE EDIT.
    node.attrs = { ...node.attrs, source: TREE + tail };

    const back = open(save(doc));

    // The identity did not move, and no phantom block appeared beside it.
    const tree = find(back, "forestBlock");
    expect(tree, "the tree stopped being a forestBlock").not.toBeNull();
    expect(tree!.attrs?.uuid, "the tree's uuid was RE-MINTED").toBe(uuid);
    expect(back.content?.map((n) => n.type)).toEqual(["forestBlock"]);
    // …which is the same statement read from the other side: nothing else in
    // the document answers to the old uuid.
    const claimants = (back.content ?? []).filter((n) => n.attrs?.uuid === uuid);
    expect(claimants.map((n) => n.type)).toEqual(["forestBlock"]);
  });

  it("is a FIXED POINT — the trailing bytes normalize once and stay normalized", () => {
    const doc = open(TREE);
    find(doc, "forestBlock")!.attrs = {
      ...find(doc, "forestBlock")!.attrs,
      source: TREE + "\n",
    };
    const c1 = save(doc);
    const c2 = save(open(c1));
    expect(c2).toBe(c1);
    // And the bytes the user wrote are all still there.
    expect(c1).toContain("\\begin{forest}");
    expect(c1).toContain("[S [NP] [VP]]");
    expect(c1).toContain("\\end{forest}");
  });

  it("CONTROL — an untouched tree is byte-identical (the trim changes nothing else)", () => {
    const doc = open(TREE);
    const uuid = find(doc, "forestBlock")!.attrs?.uuid as string;
    const out = save(doc);
    expect(out.trim()).toBe(`${TREE} %!v:${uuid}`);
  });

  it("CONTROL — non-whitespace after the closer is already LOUD, so it is left alone", () => {
    // The renderer refuses it (`END_RE` is `\\end{forest}\s*$`), so the 384
    // badge names the problem. This leg exists so the stated residual is a
    // recorded decision rather than an oversight.
    const r = parseForestSource(`${TREE} % a note`);
    expect(r.ok).toBe(false);
  });
});

describe("a carried child's SENTINEL is invisible to the item separator", () => {
  it("a forest tree as a list-item tail gains no spurious \\par", () => {
    const body = `\\begin{itemize}\n  \\item A tree:\n${TREE}\n\\end{itemize}`;
    const out = save(open(body));
    // The head and the tree are separated by ONE newline — the tree's own
    // `\begin{forest}` is self-delimiting, exactly like a nested list.
    expect(out).toContain("\\item A tree:\n\\begin{forest}");
    expect(out, "a blank line inside \\item typesets the tree as a new paragraph")
      .not.toContain("\\item A tree:\n\n");
  });

  it("CONTROL — a nested list in the identical slot is unchanged", () => {
    const body =
      "\\begin{itemize}\n  \\item A list:\n\\begin{itemize}\n  \\item inner\n\\end{itemize}\n\\end{itemize}";
    const out = save(open(body));
    expect(out).toContain("\\item A list:\n  \\begin{itemize}");
  });

  it("CONTROL — a second PARAGRAPH still gets its blank line (task 348 (a))", () => {
    // The separator rule's whole point: a plain paragraph is NOT self-delimiting
    // and must keep its `\par`. A sentinel strip that widened the predicate
    // would break this.
    const body = "\\begin{itemize}\n  \\item Head.\n\nSecond paragraph.\n\\end{itemize}";
    const out = save(open(body));
    expect(out).toContain("\\item Head.\n\nSecond paragraph.");
  });

  it("the tree still round-trips whole from inside the item", () => {
    const body = `\\begin{itemize}\n  \\item A tree:\n${TREE}\n\\end{itemize}`;
    const c1 = save(open(body));
    const c2 = save(open(c1));
    expect(c2).toBe(c1);
    const node = find(open(c1), "forestBlock");
    expect(node?.attrs?.source).toBe(TREE);
  });
});

describe("a label's end-of-line % is TeX's continuation, not a space", () => {
  it.each([
    ["braced", "\\begin{forest}\n[{Deter%\nmine}]\n\\end{forest}", "Determine"],
    ["bare", "\\begin{forest}\n[Deter%\nmine]\n\\end{forest}", "Determine"],
    [
      "with the continuation line indented (TeX eats the leading spaces too)",
      "\\begin{forest}\n[{Deter%\n    mine}]\n\\end{forest}",
      "Determine",
    ],
  ])("%s", (_name, source, expected) => {
    const r = parseForestSource(source);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree.labelText).toBe(expected);
  });

  it("CONTROL — a comment that is NOT at a line end still just vanishes", () => {
    // `[a %c]` is a node labelled "a": the comment eats to the end of the line,
    // and the `]` on the NEXT line closes it.
    const r = parseForestSource("\\begin{forest}\n[a %c\n]\n\\end{forest}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree.labelText).toBe("a");
  });

  it("CONTROL — an ordinary line break inside a label is still ONE space", () => {
    // The whitespace collapse is untouched: only the COMMENT branch changed.
    const r = parseForestSource("\\begin{forest}\n[{two\nwords}]\n\\end{forest}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree.labelText).toBe("two words");
  });

  it("CONTROL — an escaped \\% is ink, not a comment", () => {
    const r = parseForestSource("\\begin{forest}\n[{100\\% sure}]\n\\end{forest}");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree.labelText).toContain("100");
    expect(r.tree.labelText).toContain("sure");
  });
});
