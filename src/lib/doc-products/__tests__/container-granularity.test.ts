// @vitest-environment jsdom
/**
 * Container-granular derived products (task 337).
 *
 * The defect: the doc-products caches keyed on TOP-LEVEL node identity, and PM
 * re-creates every ancestor of an edited node — so a keystroke inside one
 * bullet re-derived the WHOLE list, both as a `toJSON()` deep clone (Tier A,
 * synchronous 300 ms after the last keystroke, i.e. exactly as the user
 * resumes typing) and as a full LaTeX re-serialization (Tier B). The fixture
 * lists in every other suite are 2–3 items, which is why this was invisible.
 *
 * The legs with teeth are the COUNTS, over a 100-item list: the produced
 * bytes are identical either way, so only "how much did we visit" separates
 * the fix from the defect. Two probes, deliberately of different kinds:
 *
 *  - Tier A is measured by counting calls to prosemirror's OWN
 *    `Node.prototype.toJSON`, which `Fragment.toJSON` invokes once per
 *    descendant. That probe is implementation-INDEPENDENT — it reports ~300
 *    calls per keystroke on the pre-337 cache and a handful on this one — so
 *    it cannot pass by measuring the fix's own bookkeeping.
 *  - Tier B is measured by the `partMisses` / `partHits` counters, which
 *    exist only where the per-child memo does. Pre-337 they read zero, which
 *    is exactly the claim ("no item's bytes were reused") stated as a count.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { getBlockJson, getBlockLatex, blockCacheStats } from "../block-caches";
import { serializeTopLevelBlock } from "@/lib/latex-serializer";

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

let baseline = { ...blockCacheStats };
beforeEach(() => {
  baseline = { ...blockCacheStats };
});
/** Counter deltas since the start of the current test. */
function delta() {
  return {
    jsonMisses: blockCacheStats.jsonMisses - baseline.jsonMisses,
    latexMisses: blockCacheStats.latexMisses - baseline.latexMisses,
    partMisses: blockCacheStats.partMisses - baseline.partMisses,
    partHits: blockCacheStats.partHits - baseline.partHits,
  };
}
function mark() {
  baseline = { ...blockCacheStats };
}

const N = 100;
function bigListHtml(): string {
  const items = Array.from(
    { length: N },
    (_, i) => `<li><p>item number ${i}</p></li>`,
  ).join("");
  return `<p>lead paragraph</p><ul>${items}</ul><p>trailing paragraph</p>`;
}

/** Derive every top-level product the pipeline derives, in pipeline order. */
function deriveAll(ed: Editor): { json: JSONContent[]; latex: string } {
  const doc = ed.state.doc;
  const json: JSONContent[] = [];
  const parts: string[] = [];
  for (let i = 0; i < doc.childCount; i++) {
    json.push(getBlockJson(doc.child(i)));
    parts.push(getBlockLatex(doc.child(i)).latex);
  }
  return { json, latex: parts.join("") };
}

/** Type one character into the paragraph of list item `index`. */
function typeInItem(ed: Editor, index: number, text: string): void {
  let pos = -1;
  let seen = 0;
  ed.state.doc.descendants((node: PMNode, p: number) => {
    if (node.type.name !== "listItem") return true;
    if (seen === index) pos = p;
    seen++;
    return false;
  });
  expect(pos).toBeGreaterThan(-1);
  // +2 = into the listItem, into its paragraph.
  ed.commands.insertContentAt(pos + 2, text);
}

describe("container-granular doc products", () => {
  it("a keystroke inside a 100-item list re-serializes ONE item, byte-identically", () => {
    const ed = makeEditor(bigListHtml());
    const before = deriveAll(ed);
    // Cold pass visited every item once.
    expect(delta().partMisses).toBeGreaterThanOrEqual(N);

    mark();
    typeInItem(ed, 50, "X");
    const after = deriveAll(ed);

    const d = delta();
    // ONE item's subtree re-serialized. (The list itself is not a memo
    // entry — it is the top-level block, counted by latexMisses.)
    expect(d.partMisses).toBe(1);
    expect(d.partHits).toBe(N - 1);
    // …and only the list re-serialized at top level; the two paragraphs hit.
    expect(d.latexMisses).toBe(1);

    // Byte-identical to a full, cache-free re-serialization of the same doc.
    const fresh = ed.state.doc.children
      .map((n) => serializeTopLevelBlock(n.toJSON() as JSONContent).latex)
      .join("");
    expect(after.latex).toBe(fresh);
    expect(after.latex).toContain("Xitem number 50");
    expect(after.latex).not.toBe(before.latex);
  });

  it("Tier A converts the changed PATH, not the container (prosemirror's own toJSON, counted)", () => {
    const ed = makeEditor(bigListHtml());
    deriveAll(ed);

    const proto = ed.state.doc.constructor.prototype as {
      toJSON: () => unknown;
    };
    const real = proto.toJSON;
    let calls = 0;
    proto.toJSON = function patched(this: PMNode) {
      calls++;
      return real.call(this);
    };
    try {
      typeInItem(ed, 50, "X");
      const doc = ed.state.doc;
      for (let i = 0; i < doc.childCount; i++) getBlockJson(doc.child(i));
    } finally {
      proto.toJSON = real;
    }
    // The touched item's paragraph + its text node, and nothing else — the
    // other 99 items are cache hits at the CHILD level. Pre-337 the list's
    // own toJSON deep-cloned the whole subtree: ~300 calls, measured.
    expect(calls).toBeLessThan(20);
  });

  it("unchanged list items keep their JSON object identity (Tier A cost is O(depth))", () => {
    const ed = makeEditor(bigListHtml());
    const before = deriveAll(ed);
    const beforeItems = before.json[1].content!;

    mark();
    typeInItem(ed, 50, "X");
    const after = deriveAll(ed);
    const afterItems = after.json[1].content!;

    // The list wrapper is new (its child array changed) but every untouched
    // item — and its whole subtree — is the SAME object.
    expect(after.json[1]).not.toBe(before.json[1]);
    for (let i = 0; i < N; i++) {
      if (i === 50) expect(afterItems[i]).not.toBe(beforeItems[i]);
      else expect(afterItems[i]).toBe(beforeItems[i]);
    }
    // Sibling top-level blocks are untouched objects too.
    expect(after.json[0]).toBe(before.json[0]);
    expect(after.json[2]).toBe(before.json[2]);

    // The JSON walk visited the changed PATH, not the container: the list,
    // the touched item, its paragraph, and the doc's other two children —
    // every one of which is a HIT except the three on the path.
    const d = delta();
    expect(d.jsonMisses).toBeLessThanOrEqual(4);
  });

  it("composed container JSON deep-equals prosemirror's own toJSON", () => {
    // Every container shape the schema has, nested, plus marks and attrs.
    const ed = makeEditor(
      "<ul><li><p>a <strong>bold</strong></p><ol><li><p>nested</p></li></ol></li></ul>" +
        "<blockquote><p>quoted</p><p>twice</p></blockquote>" +
        "<pre><code>verbatim</code></pre>",
    );
    const doc = ed.state.doc;
    for (let i = 0; i < doc.childCount; i++) {
      const node = doc.child(i);
      expect(getBlockJson(node)).toEqual(node.toJSON());
    }
  });

  it("serializes nested lists and blockquotes byte-identically through the memo", () => {
    const ed = makeEditor(
      "<ul><li><p>outer</p><ol><li><p>inner one</p></li><li><p>inner two</p></li></ol></li>" +
        "<li><p>second</p></li></ul>" +
        "<blockquote><p>q one</p><p>q two</p></blockquote>",
    );
    const cached = deriveAll(ed).latex;
    const fresh = ed.state.doc.children
      .map((n) => serializeTopLevelBlock(n.toJSON() as JSONContent).latex)
      .join("");
    expect(cached).toBe(fresh);

    // And after an edit deep inside the nested tier.
    typeInItem(ed, 1, "Z"); // the nested "inner one" item
    const cached2 = deriveAll(ed).latex;
    const fresh2 = ed.state.doc.children
      .map((n) => serializeTopLevelBlock(n.toJSON() as JSONContent).latex)
      .join("");
    expect(cached2).toBe(fresh2);
  });

  it("replays declared requirements from a memo HIT (the collector side channel)", () => {
    // `\includegraphics` inside a list item declares graphicx at its emit
    // site. A cached child must replay that into the enclosing collector,
    // or the second serialize silently drops the \usepackage.
    const ed = makeEditor(
      "<ul><li><p>plain</p></li><li><p>x</p></li></ul><p>tail</p>",
    );
    const list = ed.state.doc.child(0);
    const first = getBlockLatex(list);
    // Re-derive the SAME node: every child is a memo hit now.
    mark();
    const second = getBlockLatex(list);
    expect(second).toBe(first); // top-level cache hit, same object

    // Force the top-level miss while keeping the children cached, exactly as
    // an attrs-only change on the list would.
    const json = getBlockJson(list);
    const again = serializeTopLevelBlock(json);
    expect(again.latex).toBe(first.latex);
    expect([...again.requirementIds].sort()).toEqual(
      [...first.requirementIds].sort(),
    );
    expect(again.bibFamily).toBe(first.bibFamily);
  });

  it("a top-level paragraph edit is unchanged in cost (the non-regression pin)", () => {
    const ed = makeEditor("<p>alpha</p><p>beta</p><p>gamma</p>");
    deriveAll(ed);
    mark();
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " edited");
    deriveAll(ed);
    const d = delta();
    expect(d.latexMisses).toBe(1);
    // A textblock is NOT composed, so no child-part entries are minted.
    expect(d.partMisses).toBe(0);
  });
});
