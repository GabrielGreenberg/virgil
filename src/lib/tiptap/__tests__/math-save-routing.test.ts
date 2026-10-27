// @vitest-environment jsdom
//
// EX-F4-02 — the math save routes to the editor that OWNS the clicked node.
//
// The bug: clicking inline/display math inside an EXAMPLE-CARD body (an
// embedded `surface: "float"` editor with its own pos-space) did nothing. The
// click→edit bridge was gated to the MAIN surface because the save dispatched
// `setNodeMarkup(pos)` against the MAIN editor — a float's `pos` would have
// mis-targeted MAIN.
//
// The fix carries the OWNING editor through `virgil-math-click` and the save
// dispatches into THAT editor (see EditorLayout.handleMathSave + math.ts).
// These locks exercise the exact save contract `handleMathSave` runs
// (`nodeAt(pos)` → type-check → `setNodeMarkup`) against the owning editor, and
// prove the routing isolates pos-spaces: a save into the embedded editor edits
// the embed and never the MAIN doc by absolute pos.
//
// Import-light (same as math-surface-gate.test.ts): only @tiptap, katex, and
// uuid-attr — no `@/lib/storage` chain — so no storage mock is needed.
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { InlineMath, DisplayMath } from "@/lib/tiptap/math";
import { applyMathEdit, trackAtomPos } from "@/lib/tiptap/atom-edit-target";

// The REAL commit `EditorLayout.handleMathSave` calls (task 1071 extracted it
// from a copy this suite used to keep). `clicked` defaults to the identity of
// whatever math sits at `pos` NOW — i.e. a click captured just before the save;
// the identity-refusal legs live in `atom-popover-door.test.ts`.
function saveMath(editor: Editor, pos: number, newLatex: string): boolean {
  let clicked = { kind: "inline" as "inline" | "display", latex: "" };
  if (pos >= 0 && pos < editor.state.doc.content.size) {
    const n = editor.state.doc.nodeAt(pos);
    if (n?.type.name === "displayMath") clicked = { kind: "display", latex: n.attrs.latex || "" };
    else if (n?.type.name === "inlineMath") clicked = { kind: "inline", latex: n.attrs.latex || "" };
  }
  return applyMathEdit(editor, trackAtomPos(editor, pos), clicked, newLatex);
}

function mountInline(latex: string, surface: "main" | "float") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [StarterKit, InlineMath.configure({ surface }), DisplayMath.configure({ surface })],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex } }] },
      ],
    },
  });
  return { editor, element };
}

function mountDisplay(latex: string, surface: "main" | "float") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [StarterKit, InlineMath.configure({ surface }), DisplayMath.configure({ surface })],
    content: { type: "doc", content: [{ type: "displayMath", attrs: { latex } }] },
  });
  return { editor, element };
}

function posOf(editor: Editor, typeName: "inlineMath" | "displayMath"): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === typeName) pos = p;
    return pos < 0;
  });
  return pos;
}

function latexAt(editor: Editor, pos: number): string {
  return (editor.state.doc.nodeAt(pos)?.attrs.latex as string) ?? "";
}

describe("math save routes to the owning editor (EX-F4-02)", () => {
  it("a save into an embedded (float) editor edits the embed, not MAIN", () => {
    // MAIN holds a display equation; an embedded example-card editor holds its
    // own — at a pos that COLLIDES (both at the same numeric pos). The save
    // must edit the embed only.
    const main = mountDisplay("MAIN_ORIGINAL", "main");
    const embed = mountDisplay("EMBED_ORIGINAL", "float");
    try {
      const mainPos = posOf(main.editor, "displayMath");
      const embedPos = posOf(embed.editor, "displayMath");
      expect(mainPos).toBe(embedPos); // same pos-space numeral, different docs

      const ok = saveMath(embed.editor, embedPos, "EMBED_EDITED");
      expect(ok).toBe(true);

      // The embed received the edit…
      expect(latexAt(embed.editor, embedPos)).toBe("EMBED_EDITED");
      // …and MAIN is completely untouched (the corruption the gate prevented).
      expect(latexAt(main.editor, mainPos)).toBe("MAIN_ORIGINAL");
    } finally {
      main.editor.destroy();
      main.element.remove();
      embed.editor.destroy();
      embed.element.remove();
    }
  });

  it("a save into the MAIN editor edits MAIN (unchanged behaviour)", () => {
    const main = mountInline("a", "main");
    try {
      const pos = posOf(main.editor, "inlineMath");
      expect(saveMath(main.editor, pos, "b^2")).toBe(true);
      expect(latexAt(main.editor, pos)).toBe("b^2");
    } finally {
      main.editor.destroy();
      main.element.remove();
    }
  });

  it("inline-math save into an embedded editor round-trips to that editor's getJSON (the embed's write-back source)", () => {
    // The embed propagates to MAIN via its own onUpdate → writeBackToMain, which
    // reads editor.getJSON(). Prove the edited latex is visible there.
    const embed = mountInline("old", "float");
    try {
      const pos = posOf(embed.editor, "inlineMath");
      saveMath(embed.editor, pos, "new");
      const json = JSON.stringify(embed.editor.getJSON());
      expect(json).toContain('"new"');
      expect(json).not.toContain('"old"');
    } finally {
      embed.editor.destroy();
      embed.element.remove();
    }
  });

  it("a stale pos that no longer holds a math node is a safe no-op (no throw, no corruption)", () => {
    const main = mountInline("x", "main");
    try {
      // A pos past the doc / on a non-math node: handleMathSave bails.
      expect(saveMath(main.editor, 9999, "z")).toBe(false);
      // pos 0 is the paragraph open, not a math node → bail.
      expect(saveMath(main.editor, 0, "z")).toBe(false);
      // The real math node is untouched.
      expect(latexAt(main.editor, posOf(main.editor, "inlineMath"))).toBe("x");
    } finally {
      main.editor.destroy();
      main.element.remove();
    }
  });
});
