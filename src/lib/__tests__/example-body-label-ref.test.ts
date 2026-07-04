/**
 * Task 2026-07-03-025 — body-positioned example `\label` capture.
 *
 * expex lets `\label{…}` sit anywhere inside an `\ex`/`\pex` body, not just
 * immediately after the header. Only the header-adjacent form was promoted onto
 * `exampleBlock.attrs.label`; a body-line `\label` survived as a raw
 * `latexCommand`-marked text node, so all three example-number resolvers
 * (keyed only on `attrs.tag`/`attrs.label`) rendered the ref as "??" — first
 * entry looked fine only because it round-tripped once, then degraded on reload.
 *
 * The fix extracts ONE `collectExampleBodyLabels` SSOT
 * (`src/lib/example-refs.ts`) that harvests every body `\label` with its
 * binding (parent → N, enclosing item → N+sub) and unifies the parse/reload,
 * live-doc, and popover resolvers onto it. These locks pin the parse/reload arm
 * + the shared helper + the serialize→re-parse durability.
 */

import { describe, expect, it } from "vitest";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { collectExampleBodyLabelsJSON } from "@/lib/example-refs";
import type { JSONContent } from "@tiptap/react";

function parseBody(input: string): JSONContent {
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

/** Map each labelRef to { label → displayText } after parse (which runs
 *  `resolveRefs` eagerly). */
function refDisplays(doc: JSONContent): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of findAll(doc, "labelRef")) {
    out[r.attrs?.label as string] = r.attrs?.displayText as string;
  }
  return out;
}

describe("collectExampleBodyLabels — the harvest SSOT", () => {
  it("binds a single-`\\ex` body `\\label` to the parent (subLabel null)", () => {
    const doc = parseBody(`\\ex My example.\\label{ex:foo}\\xe`);
    const block = findAll(doc, "exampleBlock")[0];
    expect(collectExampleBodyLabelsJSON(block)).toEqual([
      { key: "ex:foo", subLabel: null },
    ]);
  });

  it("binds a `\\pex` preamble label to the parent and an item label to its sub", () => {
    const doc = parseBody(
      `\\pex Preamble.\\label{ex:par}\n\\a First.\\label{ex:one}\n\\a Second.\n\\xe`,
    );
    const block = findAll(doc, "exampleBlock")[0];
    const labels = collectExampleBodyLabelsJSON(block);
    expect(labels).toContainEqual({ key: "ex:par", subLabel: null });
    expect(labels).toContainEqual({ key: "ex:one", subLabel: "a" });
    // Exactly those two — no phantom captures.
    expect(labels).toHaveLength(2);
  });
});

describe("parse/reload exampleMap — body `\\label` resolves to the number", () => {
  it("a single-`\\ex` body `\\label` gives `\\getref` its number, not '??'", () => {
    const doc = parseBody(
      `\\ex My example sentence.\\label{ex:foo}\\xe\n\nSee \\getref{ex:foo}.`,
    );
    expect(refDisplays(doc)["ex:foo"]).toBe("(1)");
  });

  it("a `\\getref` to a `\\pex` item body `\\label` resolves to N+sub", () => {
    const doc = parseBody(
      `\\pex\n\\a First.\\label{ex:one}\n\\a Second.\n\\xe\n\nRef \\getref{ex:one}.`,
    );
    expect(refDisplays(doc)["ex:one"]).toBe("(1a)");
  });

  it("marks the in-text labelRef targetKind as 'example' (not a bare label)", () => {
    const doc = parseBody(
      `\\ex Body.\\label{ex:foo}\\xe\n\n\\getref{ex:foo}`,
    );
    const ref = findAll(doc, "labelRef")[0];
    expect(ref.attrs?.targetKind).toBe("example");
  });

  it("an explicit header-adjacent tag still wins for its own key", () => {
    const doc = parseBody(
      `\\ex<mytag> Body.\\label{ex:body}\\xe\n\n\\getref{mytag} \\getref{ex:body}`,
    );
    const d = refDisplays(doc);
    expect(d["mytag"]).toBe("(1)");
    expect(d["ex:body"]).toBe("(1)");
  });
});

describe("serialize → re-parse durability (the reload path)", () => {
  it("a body-`\\label` example round-trips without the ref degrading to '??'", () => {
    const src = `\\ex My example sentence.\\label{ex:foo}\\xe\n\nSee \\getref{ex:foo}.`;
    const once = parseBody(src);
    // Serialize the parsed doc back to LaTeX and re-parse — the reload path.
    const reparsed = parseBody(serializeBodyOnly(once));
    expect(refDisplays(reparsed)["ex:foo"]).toBe("(1)");
    // And the label is still a body label (not spuriously promoted to header).
    const block = findAll(reparsed, "exampleBlock")[0];
    expect(block.attrs?.label).toBe("");
    expect(collectExampleBodyLabelsJSON(block)).toEqual([
      { key: "ex:foo", subLabel: null },
    ]);
  });
});
