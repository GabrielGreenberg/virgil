// @vitest-environment jsdom
/**
 * `p-cmd-only` node decoration — the plugin-painted twin of the retired
 * `p:has(> .latex-cmd:first-child:last-child)` rhythm selector (perf Wave 0,
 * plan P5.1). The latex-command plugin flags a paragraph iff it renders
 * exactly ONE element child and that element is a `.latex-cmd` span — the
 * DOM semantics the old `:has()` selector keyed on. The class feeds the
 * `.tiptap p.p-cmd-only + p.p-cmd-only` run-tightening rule in globals.css
 * (pinned by latex-cmd-paragraph-rhythm.test.ts).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { LatexCommandMark } from "@/lib/tiptap/latex-command";

let editor: Editor | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({
    extensions: [StarterKit, LatexCommandMark],
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** Class lists of the top-level <p> elements in render order. */
function paragraphClasses(ed: Editor): string[] {
  return [...ed.view.dom.querySelectorAll("p")].map((p) => p.className);
}

describe("latex-command p-cmd-only node decoration", () => {
  it("flags command-only paragraphs and not prose or mixed paragraphs", () => {
    const ed = makeEditor(
      "<p>\\noindent</p><p>\\bigskip</p><p>plain prose</p><p>prose with \\emph{x} inside</p>",
    );
    const classes = paragraphClasses(ed);
    expect(classes[0]).toContain("p-cmd-only");
    expect(classes[1]).toContain("p-cmd-only");
    expect(classes[2]).not.toContain("p-cmd-only");
    // Command + surrounding prose still renders ONE element child (the
    // deco span) — same as the old :has() semantics, so it IS flagged.
    expect(classes[3]).toContain("p-cmd-only");
  });

  it("a lone backslash flags (the #56 affordance case) and typing prose after a command clears the flag", () => {
    const ed = makeEditor("<p>\\foo</p>");
    expect(paragraphClasses(ed)[0]).toContain("p-cmd-only");
    // Append plain prose + a second element-producing run via a real
    // transaction: the changed region overlaps the node deco → rebuild.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " and <em>x</em>");
    expect(paragraphClasses(ed)[0]).not.toContain("p-cmd-only");
  });

  it("two element children (two commands) do not flag", () => {
    // Two separate command runs → two .latex-cmd spans → not the
    // first-child:last-child shape.
    const ed = makeEditor("<p>\\foo and \\bar</p>");
    expect(paragraphClasses(ed)[0]).not.toContain("p-cmd-only");
  });
});
