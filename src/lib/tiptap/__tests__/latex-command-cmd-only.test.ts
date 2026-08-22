// @vitest-environment jsdom
/**
 * `p-cmd-only` node decoration — the plugin-painted twin of the retired
 * `p:has(> .latex-cmd:first-child:last-child)` rhythm selector (perf Wave 0,
 * plan P5.1). The latex-command plugin flags a paragraph iff it renders
 * exactly ONE element child and that element is a `.latex-cmd` span — the
 * DOM semantics the old `:has()` selector keyed on. The class feeds the
 * `.tiptap p.p-cmd-only + p.p-cmd-only` run-tightening rule in globals.css
 * (pinned by latex-cmd-paragraph-rhythm.test.ts).
 *
 * Since task 400 the decoration is re-derived PER TOUCHED BLOCK rather than by
 * rebuilding the whole document, so this aggregate is the thing that has to
 * survive the narrowing: it is paragraph-LOCAL, which is exactly what makes a
 * block-scoped rebuild sufficient. The transition legs below prove all four
 * crossings (0 -> 1, 1 -> 2, 2 -> 1, 1 -> 0) plus the one no probe could see
 * before — a mark step, which carries an EMPTY step map.
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

/** Type `text` one CHARACTER at a time at `pos` — the real gesture, and the
 *  one that fires the type-time carrier's mark steps. */
function typeAt(ed: Editor, pos: number, text: string): void {
  let at = pos;
  for (const ch of text) {
    ed.commands.insertContentAt(at, ch);
    at += 1;
  }
}

const flagged = (ed: Editor, i = 0) =>
  paragraphClasses(ed)[i]!.includes("p-cmd-only");

// The four TRANSITION legs are non-regression pins rather than defect legs —
// the pre-400 whole-document rebuild got them right too, and the point of
// pinning them is that the NARROWING still does. Measured against the pre-fix
// tree, exactly one leg in this block fails: the mark step, whose empty
// StepMap no probe could see.
describe("p-cmd-only survives a BLOCK-SCOPED rebuild (task 400)", () => {
  it("0 -> 1: typing a command into plain prose flags the paragraph", () => {
    const ed = makeEditor("<p>plain prose</p>");
    expect(flagged(ed)).toBe(false);
    typeAt(ed, 1, "\\foo ");
    expect(flagged(ed)).toBe(true);
  });

  it("1 -> 2: typing a SECOND command run clears the flag", () => {
    const ed = makeEditor("<p>\\foo</p>");
    expect(flagged(ed)).toBe(true);
    typeAt(ed, ed.state.doc.content.size - 1, " \\bar");
    expect(flagged(ed)).toBe(false);
  });

  it("2 -> 1: deleting one of two command runs restores the flag", () => {
    const ed = makeEditor("<p>\\foo and \\bar</p>");
    expect(flagged(ed)).toBe(false);
    // Drop " and \bar" — the tail after `\foo`.
    ed.commands.deleteRange({ from: 5, to: ed.state.doc.content.size - 1 });
    expect(ed.state.doc.textContent).toBe("\\foo");
    expect(flagged(ed)).toBe(true);
  });

  it("1 -> 0: deleting the backslash clears the flag", () => {
    const ed = makeEditor("<p>\\foo</p>");
    expect(flagged(ed)).toBe(true);
    ed.commands.deleteRange({ from: 1, to: 2 });
    expect(ed.state.doc.textContent).toBe("foo");
    expect(flagged(ed)).toBe(false);
  });

  it("a MARK step in the paragraph clears the flag — the case no probe could see", () => {
    // `AddMarkStep` contributes an EMPTY StepMap, so the pre-400 backslash
    // scan and the overlap probe both read "nothing happened", and the third
    // probe filtered on `latexCommand` alone. Bolding a word beside the
    // command therefore left a STALE `p-cmd-only` class on a paragraph that
    // now renders TWO element children. Block-scoped re-derivation asks the
    // STEP, so the aggregate is recomputed and the flag goes.
    const ed = makeEditor("<p>prose with \\emph{x} inside</p>");
    expect(flagged(ed)).toBe(true);
    ed.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run();
    expect(ed.state.doc.firstChild!.childCount).toBeGreaterThan(1);
    expect(flagged(ed)).toBe(false);
  });

  it("the carrier's own mark step drops the deco span it replaces (no nested 0.81em)", () => {
    // The correctness the third probe bought, kept whole. The type-time
    // carrier MARKS the run it has just seen typed; the mark renders its own
    // `.latex-cmd` span, so an inline decoration left standing over the same
    // characters paints a SECOND one inside it and `font-size: 0.9em`
    // compounds. Exactly one element per run, and it is the mark's.
    const ed = makeEditor("<p></p>");
    typeAt(ed, 1, "\\emph{hi}");
    const spans = [...ed.view.dom.querySelectorAll(".latex-cmd")];
    expect(spans).toHaveLength(1);
    expect(spans[0]!.hasAttribute("data-latex-cmd")).toBe(true);
    expect(spans[0]!.querySelector(".latex-cmd")).toBeNull();
    expect(spans[0]!.textContent).toBe("\\emph{hi}");
  });

  it("splitting a command run leaves NO decoration straddling the new boundary", () => {
    // A mapped inline decoration can cross a block boundary: Enter inside
    // `\\emph{hi}` maps the deco's `from` into the first paragraph and its `to`
    // into the second, and prosemirror's `forChild` then paints it on BOTH
    // halves. The retired whole-document rebuild cleaned that up by accident;
    // a block-scoped one has to remove anything REACHING INTO a touched block,
    // not merely what lies wholly inside it.
    const ed = makeEditor("<p>\\emph{hi}</p>");
    ed.chain().setTextSelection(4).splitBlock().run();
    expect(ed.state.doc.childCount).toBe(2);
    expect(ed.state.doc.child(0).textContent).toBe("\\em");
    expect(ed.state.doc.child(1).textContent).toBe("ph{hi}");
    const spans = [...ed.view.dom.querySelectorAll(".latex-cmd")].map(
      (n) => n.textContent,
    );
    // The first half is still a command; the second half is prose now.
    expect(spans).toEqual(["\\em"]);
  });

  it("a document REPLACEMENT still takes the cold build", () => {
    // `setContent` (the load, and the code-pane bridge's re-parse) replaces
    // 0…size in one step, so every block is touched and the whole-document
    // build is both correct and cheaper than removing and re-adding block by
    // block. The same `replacesWholeDoc` predicate the carrier reads.
    const ed = makeEditor("<p>plain prose</p>");
    expect(flagged(ed)).toBe(false);
    ed.commands.setContent("<p>\\bigskip</p><p>plain</p><p>\\noindent</p>");
    const classes = paragraphClasses(ed);
    expect(classes[0]).toContain("p-cmd-only");
    expect(classes[1]).not.toContain("p-cmd-only");
    expect(classes[2]).toContain("p-cmd-only");
  });
});
