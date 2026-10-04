// @vitest-environment jsdom
//
// Task 937 — the Link layer DERIVES its Card-bearing atom kinds from
// `atom-registry.ts`; it does not restate them.
//
// `collectLinksFromEditor` had one hand-written arm per atom
// (`node.type.name === "footnote"` / `=== "citation"`), and the inline-atom
// lookups typed their node name as the literal union `"footnote" | "citation"`
// — three places to edit, beside a registry that already answers "which atoms
// own a Card" (`CARD_ATOMS` / `cardAtomMetaForNodeName` / `CardAtomNodeName`).
// A fifth Card-bearing row would have joined every registry consumer and been
// silently skipped by the cowork link scan.
//
// Two legs: the scan collects one link per Card-bearing atom (real editor), and
// a census forbids the hand-listed spellings from coming back.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { collectLinksFromEditor } from "@/links/links";
import { CARD_ATOMS } from "@/lib/tiptap/atom-registry";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("Card-bearing atom kinds are derived from the atom registry (task 937)", () => {
  it("collectLinksFromEditor emits one inline-atom link per Card-bearing atom", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, Citation, Footnote],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Claim " },
              {
                type: "citation",
                attrs: { citationId: "cit-1", command: "\\cite{a}", displayText: "A" },
              },
              { type: "footnote", attrs: { footnoteId: "fn-1", number: 1 } },
            ],
          },
        ],
      },
    });
    const atoms = collectLinksFromEditor(editor)
      .filter((l) => l.anchor.type === "inline-atom")
      .map((l) => [l.kind, l.id, l.target.ref.id]);
    expect(atoms).toEqual([
      ["citation", "cit-1", "cit-1"],
      ["footnote", "fn-1", "fn-1"],
    ]);
    // The registry still names exactly the kinds this leg mounts.
    expect(CARD_ATOMS.map((m) => m.kind).sort()).toEqual(["citation", "footnote"]);
    editor.destroy();
    element.remove();
  });

  it("CENSUS — no hand-listed Card-bearing atom kinds in the Link layer", () => {
    for (const rel of [
      "src/links/links.ts",
      "src/links/_shared/types.ts",
      "src/lib/inline-content.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/"footnote"\s*\|\s*"citation"/);
      expect(src, rel).not.toMatch(/node\.type\.name\s*===\s*"(footnote|citation)"/);
    }
  });
});
