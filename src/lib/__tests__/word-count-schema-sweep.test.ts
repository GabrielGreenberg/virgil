// @vitest-environment jsdom
//
// Task 2026-09-25-767 — the word counter's vocabulary is the SCHEMA's.
//
// The walker in `word-count-core.ts` used to run its inline collector only for
// the textblocks it NAMED, so every textblock it did not — `titleField`, the
// native `figureCaption`, the expex `proseGlossRow` / `glossCell` — counted
// ZERO words, silently, on every word-count surface. A fixture cannot guard
// that: a hand list of fixtures drifts exactly as the hand list of names did.
// So this sweep asks the LIVE main schema (the real `buildEditorExtensions`
// stack, the `prose-index.test.ts` precedent) for every textblock it declares
// and requires a one-word body in each to count in SOME category. A new
// textblock kind arrives with no fixture and fails here before it can ship
// counting nothing.
import { describe, expect, it, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";
import { ALL_CATEGORIES, computeCategoryCounts } from "@/lib/word-count-core";
import { getBlockJson } from "@/lib/doc-products/block-caches";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mountMain(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    extensions: buildEditorExtensions({
      surface: "main",
      editableRef: { current: true },
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set<string>() },
      host: null,
    } as unknown as EditorExtensionsCtx),
  });
  return editor;
}

/** Textblocks allowed to count zero, each with its reason. Empty today —
 *  adding a row is a DECISION, stated here, never an accident. */
const MAY_COUNT_ZERO: Record<string, string> = {};

describe("every textblock the live schema declares counts its words", () => {
  it("a one-word body in each textblock counts ≥ 1 in some category", () => {
    const schema = mountMain().state.schema;
    const zero: string[] = [];
    const swept: string[] = [];
    for (const [name, type] of Object.entries(schema.nodes)) {
      if (!type.isTextblock) continue;
      const node = type.createChecked(null, schema.text("word"));
      const { words } = computeCategoryCounts({
        type: "doc",
        content: [node.toJSON()],
      });
      const total = ALL_CATEGORIES.reduce((s, c) => s + words[c], 0);
      swept.push(name);
      if (total < 1 && !(name in MAY_COUNT_ZERO)) zero.push(name);
    }
    expect(zero, "textblocks whose words the counter drops").toEqual([]);
    // The sweep is not vacuous: it reaches the kinds task 767 found dropped.
    for (const name of [
      "paragraph",
      "heading",
      "titleField",
      "figureCaption",
      "proseGlossRow",
      "glossCell",
    ]) {
      expect(swept).toContain(name);
    }
  });
});

// Task 1631 — the per-block tally cache RECURSES into every container the
// JSON cache composes (`isBlock && !isTextblock`), summing its children's
// tallies each counted from `mainText`. That is sound only while no container
// takes a context-changing walker arm. So: for EVERY container the live
// schema declares, the composed (recursive) tally must equal the direct walk
// of the same node's fresh `toJSON()` — in every category.
describe("every container the live schema declares tallies additively (task 1631)", () => {
  it("recursive tally of composed JSON === direct walk, per container kind", () => {
    const schema = mountMain().state.schema;
    // Fill every empty textblock of a minimal instance with a word, so the
    // comparison is not 0 === 0.
    const fill = (node: PMNode): PMNode => {
      if (node.isTextblock) {
        if (node.content.size > 0) return node;
        try {
          return node.type.createChecked(node.attrs, schema.text("word"), node.marks);
        } catch {
          return node;
        }
      }
      if (node.isLeaf) return node;
      const kids: PMNode[] = [];
      node.forEach((c) => kids.push(fill(c)));
      return node.type.create(node.attrs, kids, node.marks);
    };
    const swept: string[] = [];
    const mismatched: string[] = [];
    for (const [name, type] of Object.entries(schema.nodes)) {
      if (!type.isBlock || type.isTextblock || type.isLeaf || name === "doc") continue;
      const raw = type.createAndFill();
      if (!raw || raw.content.size === 0) continue;
      const node = fill(raw);
      const composed = computeCategoryCounts({ type: "doc", content: [getBlockJson(node)] });
      const direct = computeCategoryCounts(node.toJSON() as JSONContent);
      swept.push(name);
      if (JSON.stringify(composed) !== JSON.stringify(direct)) mismatched.push(name);
    }
    expect(mismatched, "containers whose recursive tally drifts from the direct walk").toEqual([]);
    for (const name of ["bulletList", "orderedList", "listItem", "blockquote", "exampleItem", "exampleGloss"]) {
      expect(swept).toContain(name);
    }
  });
});
