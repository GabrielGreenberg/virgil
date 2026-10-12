// @vitest-environment jsdom
// Task 1080 — the figure source popover is a TRUE round trip of the serializer.
//
// Leg 1: the popover seeded its `\caption{…}` from the caption child's
// `textContent`, which is "" for every inline atom (citation, math, footnote)
// and bare text for every mark. A save that changed only the WIDTH re-parsed
// that flattened caption and replaced the structured child — deleting the
// citations, math and formatting from the model, then from the `.tex`.
//
// Leg 2: the popover writeback threaded every extracted fact but `numbered`
// (from `\caption*`), so adding or removing the star there was reverted on the
// next save.
//
// Harness: the REAL parse → PM schema → popover seed (`figurePopoverRaw`,
// pinned equal to `serializeFigureEnvBody`) → `applyFigureEnvBodyEdit` →
// `serializeToLatex` pipeline, over the full main-editor schema.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema, type Editor, type JSONContent } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  assignUuids,
  serializeFigureEnvBody,
  serializeToLatex,
} from "@/lib/latex-serializer";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { applyFigureEnvBodyEdit } from "@/lib/figures/apply-env-body";
import { figurePopoverRaw } from "@/components/FigureBlockNodeView";
import {
  extractFigureAttrs,
  figureNodeAttrsFromSource,
} from "@/lib/figures/parse-attrs";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}
const SCHEMA = getSchema(buildEditorExtensions(mainCtx()));

const PRE = "\\documentclass{article}\n\\begin{document}\n";
const POST = "\n\\end{document}\n";

/** A minimal Editor stand-in — the writeback reads `state`, dispatches through
 *  `view`, and checks `isDestroyed`; nothing else. */
function stateEditor(tex: string) {
  const json = parseLatex(tex);
  assignUuids(json);
  let state = EditorState.create({ schema: SCHEMA, doc: SCHEMA.nodeFromJSON(json) });
  const editor = {
    isDestroyed: false,
    get state() {
      return state;
    },
    view: {
      dispatch(tr: Parameters<EditorState["apply"]>[0]) {
        state = state.apply(tr);
      },
    },
  } as unknown as Editor;
  return editor;
}

function figureAt(editor: Editor): { pos: number; node: PMNode } {
  let found: { pos: number; node: PMNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === "figureBlock") found = { pos, node };
    return !found;
  });
  if (!found) throw new Error("no figureBlock");
  return found;
}

/** What the popover opens on — the NodeView's own seed, pinned equal to the
 *  serializer's env body for the same node. */
function popoverRaw(editor: Editor): string {
  const { node } = figureAt(editor);
  const raw = figurePopoverRaw(node);
  expect(raw).toBe(serializeFigureEnvBody(node.toJSON() as JSONContent));
  return raw;
}

function save(editor: Editor, tex: string): string {
  return serializeToLatex(
    editor.state.doc.toJSON() as JSONContent,
    extractPreambleAndPostamble(tex) ?? undefined,
  );
}

const RICH_CAPTION =
  "See \\citet{smith2020}, $x^2$, \\emph{note}\\footnote{A footnote.} here.";

const RICH_TEX =
  PRE +
  "\\begin{figure}[h]\n" +
  "  \\centering\n" +
  "  \\includegraphics[width=0.5\\textwidth]{a.png}\n" +
  `  \\caption{${RICH_CAPTION}}\n` +
  "  \\label{fig:a}\n" +
  "\\end{figure}\n" +
  POST;

describe("figure popover seed is the serializer's own env body (task 1080)", () => {
  it("shows a caption's atoms and marks as the file holds them", () => {
    const editor = stateEditor(RICH_TEX);
    const raw = popoverRaw(editor);
    // Byte-equal to what the save writes between `\begin{figure}[h]` and
    // `\end{figure}` — the popover cannot show a caption the file does not hold.
    const saved = save(editor, RICH_TEX);
    expect(saved).toContain(`\\begin{figure}[h]${raw}\\end{figure}`);
    expect(raw).toContain("\\citet");
    expect(raw).toContain("$x^2$");
    expect(raw).toContain("\\emph{note}");
    expect(raw).toContain("\\footnote{A footnote.}");
  });

  it("an UNTOUCHED save leaves the doc identical (positive control)", () => {
    const editor = stateEditor(RICH_TEX);
    const before = editor.state.doc;
    const { pos } = figureAt(editor);
    expect(applyFigureEnvBodyEdit(editor, pos, popoverRaw(editor))).toBe(true);
    // Uuids on the re-parsed caption atoms are carried by the emitted bytes,
    // so the re-tokenized child is the same child.
    expect(save(editor, RICH_TEX)).toBe(
      serializeToLatex(before.toJSON() as JSONContent, extractPreambleAndPostamble(RICH_TEX) ?? undefined),
    );
  });

  it("a width-only edit keeps every caption byte and changes the width", () => {
    const editor = stateEditor(RICH_TEX);
    const original = save(editor, RICH_TEX);
    const captionLine = original
      .split("\n")
      .find((l) => l.includes("\\caption{"));
    expect(captionLine).toBeDefined();

    const { pos } = figureAt(editor);
    const edited = popoverRaw(editor).replace(
      "width=0.5\\textwidth",
      "width=0.8\\textwidth",
    );
    expect(applyFigureEnvBodyEdit(editor, pos, edited)).toBe(true);

    const after = save(editor, RICH_TEX);
    expect(after).toContain("width=0.8\\textwidth");
    expect(after).not.toContain("width=0.5\\textwidth");
    // The caption line is byte-identical — citation, math, emphasis, footnote.
    expect(after.split("\n")).toContain(captionLine);
    expect(figureAt(editor).node.attrs.widthPercent).toBeCloseTo(80);
  });
});

describe("the popover writeback threads `\\caption*` (task 1080 leg 2)", () => {
  const starredTex = (star: boolean) =>
    PRE +
    "\\begin{figure}\n" +
    "  \\includegraphics{a.png}\n" +
    `  \\caption${star ? "*" : ""}{X}\n` +
    "\\end{figure}\n" +
    POST;

  it("removing the star numbers the figure and emits `\\caption{X}`", () => {
    const tex = starredTex(true);
    const editor = stateEditor(tex);
    expect(figureAt(editor).node.attrs.numbered).toBe(false);
    const { pos } = figureAt(editor);
    const edited = popoverRaw(editor).replace("\\caption*{X}", "\\caption{X}");
    expect(edited).not.toBe(popoverRaw(editor));
    applyFigureEnvBodyEdit(editor, pos, edited);
    expect(figureAt(editor).node.attrs.numbered).toBe(true);
    const out = save(editor, tex);
    expect(out).toContain("\\caption{X}");
    expect(out).not.toContain("\\caption*");
  });

  it("adding the star un-numbers the figure and emits `\\caption*{X}`", () => {
    const tex = starredTex(false);
    const editor = stateEditor(tex);
    expect(figureAt(editor).node.attrs.numbered).toBe(true);
    const { pos } = figureAt(editor);
    const edited = popoverRaw(editor).replace("\\caption{X}", "\\caption*{X}");
    applyFigureEnvBodyEdit(editor, pos, edited);
    expect(figureAt(editor).node.attrs.numbered).toBe(false);
    expect(save(editor, tex)).toContain("\\caption*{X}");
  });
});

describe("figureNodeAttrsFromSource threads every extracted fact", () => {
  // The parse-then-drop class on this door (tasks 263/318/319/1080): every key
  // `extractFigureAttrs` returns reaches the node, either under its own name or
  // through its one declared carrier — and every key it produces is a real
  // `figureBlock` attr, so nothing is threaded into a void.
  const DERIVED: Record<string, string | null> = {
    caption: null, // → the figureCaption CHILD, built by each caller
    captionStarred: "numbered",
  };

  it("maps each extracted key to a figureBlock schema attr", () => {
    const extracted = extractFigureAttrs(
      "\\includegraphics[width=.3\\linewidth]{a.png}\n\\caption*[s]{c}\\label{fig:x}\n% tail",
    );
    const mapped = figureNodeAttrsFromSource(extracted);
    const schemaAttrs = Object.keys(SCHEMA.nodes.figureBlock.spec.attrs ?? {});
    for (const key of Object.keys(extracted)) {
      const carrier = key in DERIVED ? DERIVED[key] : key;
      if (carrier === null) {
        expect(mapped).not.toHaveProperty(key);
        continue;
      }
      expect(mapped, `extracted "${key}" is dropped`).toHaveProperty(carrier);
      expect(schemaAttrs, `"${carrier}" is not a figureBlock attr`).toContain(carrier);
    }
    for (const key of Object.keys(mapped)) {
      expect(schemaAttrs, `"${key}" is not a figureBlock attr`).toContain(key);
    }
    expect(mapped.numbered).toBe(false);
  });
});
