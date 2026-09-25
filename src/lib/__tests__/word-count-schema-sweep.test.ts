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
import { ALL_CATEGORIES, computeCategoryCounts } from "@/lib/word-count-core";

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
