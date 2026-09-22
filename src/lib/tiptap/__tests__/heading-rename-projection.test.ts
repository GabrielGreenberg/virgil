// @vitest-environment jsdom
//
// Task 707 — the Outline heading rename changes ONLY the characters the user
// changed. The rename box is seeded from `projectInline(heading).text` and the
// splice (`buildHeadingRenameFragment`) reads the SAME projection, so:
//   - marks outside the edit are byte-identical (M1),
//   - a footnote's body is never heading text — not in the seed, not in the
//     result (M2),
//   - a citation mid-heading stays in place (M3).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { projectInline } from "@/lib/inline-content";
import { findNodeByUuid, renameHeadingByUuid } from "@/lib/tiptap/structural-edit";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const H = "h-707";

function withHeading(
  content: JSONContent[],
  run: (editor: Editor, seed: string) => void,
) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1, uuid: H }, content }],
    },
  });
  try {
    run(editor, projectInline(heading(editor)).text);
  } finally {
    editor.destroy();
    element.remove();
  }
}

function heading(editor: Editor): PMNode {
  const hit = findNodeByUuid(editor, H);
  if (!hit) throw new Error("heading missing");
  return hit.node;
}

/** The heading's direct children as [kind-or-text, markNames]. */
function runs(editor: Editor): [string, string[]][] {
  const out: [string, string[]][] = [];
  heading(editor).forEach((c) =>
    out.push([
      c.isText ? (c.text ?? "") : `<${c.type.name}>`,
      c.marks.map((m) => m.type.name),
    ]),
  );
  return out;
}

const em = [{ type: "italic" }];
const FN_BODY: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "I thank X." }] }],
};

describe("heading rename — marks outside the edit are untouched (M1)", () => {
  it("editing the plain run leaves the emphasis run byte-identical", () => {
    withHeading(
      [
        { type: "text", text: "The " },
        { type: "text", text: "Tractatus", marks: em },
        { type: "text", text: " revisited" },
      ],
      (editor, seed) => {
        expect(seed).toBe("The Tractatus revisited");
        expect(renameHeadingByUuid(editor, H, "The Tractatus reconsidered")).toBe(true);
        expect(runs(editor)).toEqual([
          ["The ", []],
          ["Tractatus", ["italic"]],
          [" reconsidered", []],
        ]);
      },
    );
  });

  it("fixing one letter inside the emphasis run does not italicize the rest", () => {
    withHeading(
      [
        { type: "text", text: "Syntx", marks: em },
        { type: "text", text: " and semantics" },
      ],
      (editor) => {
        renameHeadingByUuid(editor, H, "Syntax and semantics");
        expect(runs(editor)).toEqual([
          ["Syntax", ["italic"]],
          [" and semantics", []],
        ]);
      },
    );
  });

  it("replacing a whole emphasized word keeps it emphasized", () => {
    withHeading(
      [
        { type: "text", text: "The " },
        { type: "text", text: "Tractatus", marks: em },
        { type: "text", text: " revisited" },
      ],
      (editor) => {
        renameHeadingByUuid(editor, H, "The Investigations revisited");
        expect(runs(editor)).toEqual([
          ["The ", []],
          ["Investigations", ["italic"]],
          [" revisited", []],
        ]);
      },
    );
  });
});

describe("heading rename — a footnote body is never heading text (M2)", () => {
  const content: JSONContent[] = [
    { type: "text", text: "Intro" },
    { type: "footnote", attrs: { footnoteId: "fn1", content: FN_BODY } },
  ];

  it("the seed does not carry the footnote body", () => {
    withHeading(content, (_editor, seed) => {
      expect(seed).toBe("Intro");
    });
  });

  it("renaming the prefix keeps the footnote atom and adds no body text", () => {
    withHeading(content, (editor, seed) => {
      expect(renameHeadingByUuid(editor, H, seed.replace("Intro", "Introduction"))).toBe(true);
      expect(runs(editor)).toEqual([["Introduction", []], ["<footnote>", []]]);
      expect(heading(editor).textContent).not.toContain("I thank");
    });
  });

  it("round-trips to \\section{Introduction\\footnote{I thank X.}}", () => {
    withHeading(content, (editor) => {
      renameHeadingByUuid(editor, H, "Introduction");
      const tex = serializeBodyOnly(editor.getJSON());
      // (The serializer may stamp a `\\vfid{…}` identity marker before it.)
      expect(tex).toMatch(/\{Introduction(\\vfid\{fn1\})?\\footnote\{I thank X\.\}\}/);
      expect(tex).not.toContain("IntroductionI thank");
    });
  });

  it("text after a mid-heading footnote stays after it", () => {
    withHeading(
      [
        { type: "text", text: "Intro" },
        { type: "footnote", attrs: { footnoteId: "fn1", content: FN_BODY } },
        { type: "text", text: " and more" },
      ],
      (editor, seed) => {
        expect(seed).toBe("Intro and more");
        renameHeadingByUuid(editor, H, "Intro and much more");
        expect(runs(editor)).toEqual([
          ["Intro", []],
          ["<footnote>", []],
          [" and much more", []],
        ]);
      },
    );
  });
});

describe("heading rename — atoms keep their place (M3)", () => {
  const content: JSONContent[] = [
    { type: "text", text: "On " },
    {
      type: "citation",
      attrs: { citationId: "c1", command: "\\citet{foo}", displayText: "Foo 2020" },
    },
    { type: "text", text: " and its critics" },
  ];

  it("an edit before a mid-heading citation leaves it in place", () => {
    withHeading(content, (editor, seed) => {
      expect(seed).toBe("On Foo 2020 and its critics");
      renameHeadingByUuid(editor, H, "Against Foo 2020 and its critics");
      expect(runs(editor)).toEqual([
        ["Against ", []],
        ["<citation>", []],
        [" and its critics", []],
      ]);
    });
  });

  it("a citation whose command differs from its display is still located", () => {
    // The pre-707 splice projected a citation through a different registry
    // than the seed; a display that differed sent it to the append fallback.
    withHeading(
      [
        { type: "text", text: "On " },
        { type: "citation", attrs: { citationId: "c1", command: "\\citet{foo}" } },
        { type: "text", text: " today" },
      ],
      (editor, seed) => {
        renameHeadingByUuid(editor, H, seed.replace("today", "now"));
        expect(runs(editor).map(([t]) => t)).toEqual(["On ", "<citation>", " now"]);
      },
    );
  });

  it("typing over an atom's display is refused — the atom is not text", () => {
    withHeading(content, (editor) => {
      expect(renameHeadingByUuid(editor, H, "On Foo 2021 and its critics")).toBe(false);
      expect(runs(editor).map(([t]) => t)).toEqual(["On ", "<citation>", " and its critics"]);
    });
  });

  it("deleting an atom's display does not delete the atom", () => {
    withHeading(content, (editor) => {
      renameHeadingByUuid(editor, H, "On  and its critics");
      expect(runs(editor).map(([t]) => t)).toEqual(["On ", "<citation>", " and its critics"]);
    });
  });
});
