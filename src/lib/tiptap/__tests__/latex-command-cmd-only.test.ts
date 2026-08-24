// @vitest-environment jsdom
/**
 * `p-cmd-only` — the write-time twin of the retired
 * `p:has(> .latex-cmd:first-child:last-child)` rhythm selector (perf Wave 0,
 * plan P5.1). A paragraph is flagged iff it renders exactly ONE element child
 * and that element is a `.latex-cmd` span — the DOM semantics the old `:has()`
 * selector keyed on. The class feeds the `.tiptap p.p-cmd-only + p.p-cmd-only`
 * run-tightening rule in globals.css (pinned by
 * latex-cmd-paragraph-rhythm.test.ts).
 *
 * Task 400 made the latex-command plugin re-derive PER TOUCHED BLOCK. Task 430
 * then took the aggregate OFF decorations altogether: a `Decoration.node` over
 * a paragraph sits in the root set's `local` array, so every keystroke's
 * `find`/`remove`/`add` still swept O(command-only paragraphs). The class is
 * now stamped by the paragraph NODEVIEW (`stampCmdOnly`, cmd-only-paragraph.ts)
 * from the node that changed — the card bodies' `CardParagraph` and the main
 * editor's titled paragraph read ONE predicate. The transition legs below are
 * byte-for-byte the task-400 contract (0 -> 1, 1 -> 2, 2 -> 1, 1 -> 0, plus a
 * mark step), now asserted against the stamp; the harness mounts the card
 * body's paragraph, because StarterKit's own has no NodeView and stamps
 * nothing — which is the point, and is pinned below.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

// `editor-extensions` (the main paragraph NodeView) reaches `@/lib/storage`.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DecorationSet } from "@tiptap/pm/view";
import { LatexCommandMark } from "@/lib/tiptap/latex-command";
import {
  CardParagraph,
  paragraphIsCmdOnly,
} from "@/lib/tiptap/cmd-only-paragraph";
import { createParagraphWithTitle } from "@/lib/editor-extensions";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";

let editor: Editor | null = null;

function makeEditor(
  content: string,
  paragraph: typeof CardParagraph = CardParagraph,
): Editor {
  editor = new Editor({
    extensions: [StarterKit.configure({ paragraph: false }), paragraph, LatexCommandMark],
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

describe("p-cmd-only NodeView stamp", () => {
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
describe("p-cmd-only survives a BLOCK-SCOPED rebuild (task 400) — and the move off decorations (task 430)", () => {
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

describe("the stamp is a NodeView fact, not a decoration (task 430)", () => {
  it("the decoration set carries NO node decoration — its root `local` array is empty", () => {
    // The whole point of the move: a `Decoration.node` over a paragraph cannot
    // be filed under the paragraph's child set (strict containment), so it
    // lives in the root `local` array that every `find`/`remove`/`add` sweeps.
    const ed = makeEditor("<p>\\noindent</p><p>\\bigskip</p><p>prose \\emph{x}</p>");
    expect(paragraphClasses(ed).filter((c) => c.includes("p-cmd-only"))).toHaveLength(3);
    const sets = ed.state.plugins
      .map((p) => p.getState(ed.state))
      .filter((st): st is DecorationSet => st instanceof DecorationSet);
    expect(sets.length).toBeGreaterThan(0);
    for (const set of sets) {
      expect((set as unknown as { local: unknown[] }).local).toHaveLength(0);
    }
    // …while the inline spans are still painted.
    expect(ed.view.dom.querySelectorAll(".latex-cmd")).toHaveLength(3);
  });

  it("the main editor's titled paragraph stamps its OUTER dom — where the node decoration used to land", () => {
    const ed = makeEditor("<p>\\noindent</p><p>plain</p>", createParagraphWithTitle() as never);
    const wrappers = [...ed.view.dom.querySelectorAll(".par-title-wrapper")];
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0]!.classList.contains("p-cmd-only")).toBe(true);
    expect(wrappers[1]!.classList.contains("p-cmd-only")).toBe(false);
    typeAt(ed, ed.state.doc.child(0).nodeSize - 1, " and \\bar");
    expect(wrappers[0]!.classList.contains("p-cmd-only")).toBe(false);
  });

  it("a surface without the latexCommand mark never stamps", () => {
    editor = new Editor({
      extensions: [StarterKit.configure({ paragraph: false }), CardParagraph],
      content: "<p>\\noindent</p>",
    });
    expect(paragraphClasses(editor)[0]).not.toContain("p-cmd-only");
    expect(paragraphIsCmdOnly(editor.state.doc.firstChild!)).toBe(false);
  });

  it("StarterKit's bare paragraph stamps nothing — which is why every mark-bearing surface mounts a stamping one", () => {
    editor = new Editor({ extensions: [StarterKit, LatexCommandMark], content: "<p>\\noindent</p>" });
    expect(paragraphClasses(editor)[0]).not.toContain("p-cmd-only");
  });
});

// ── Census ────────────────────────────────────────────────────────────────
// The stamp was never the part that could misbehave; a paragraph NodeView that
// does not call it is, and so is a plugin that brings the node decoration back.
// Both type-check perfectly.
const ROOTS = ["src", "library"];
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|out|coverage)(\/|$)/;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_DIR.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}
const isTest = (f: string) => /__tests__|\.test\.tsx?$/.test(f);

describe("p-cmd-only census (task 430)", () => {
  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !isTest(f));
  // Literals KEPT for the class needle (the drift lives in a quoted class
  // name); blanked for the symbol needles.
  const sources = files.map((f) => {
    const raw = readFileSync(f, "utf8");
    return { f, code: codeOnly(raw), text: commentsStripped(raw) };
  });

  it("every paragraph extension that adds a NodeView stamps through `stampCmdOnly`", () => {
    const owners = sources.filter(
      ({ code }) => /Paragraph\.extend\(/.test(code) && /addNodeView\(/.test(code),
    );
    expect(owners.map((o) => o.f).sort()).toEqual(
      ["src/lib/editor-extensions.ts", "src/lib/tiptap/cmd-only-paragraph.ts"].sort(),
    );
    for (const { f, code } of owners) {
      expect(code.includes("stampCmdOnly("), `${f} must stamp p-cmd-only`).toBe(true);
    }
  });

  it("no production file spells the class by hand, and no decoration plugin files a node deco for it", () => {
    const spellers = sources
      .filter(({ text }) => /p-cmd-only/.test(text))
      .map((o) => o.f);
    // The leaf declares `CMD_ONLY_CLASS`; CSS reads the class; nothing else.
    expect(spellers).toEqual(["src/lib/tiptap/cmd-only-paragraph.ts"]);
    const latexCommand = readFileSync("src/lib/tiptap/latex-command.ts", "utf8");
    expect(codeOnly(latexCommand)).not.toMatch(/Decoration\.node\(/);
  });
});
