// @vitest-environment jsdom
//
// EX-F4-02 (figure twin of the math fix) — the figure/graphics save routes to
// the editor that OWNS the clicked node.
//
// The bug: clicking a figure/graphics inside the figure's OWN lifted-overlay
// float (an embedded `surface: "float"` editor with its own pos-space) did
// nothing — `FigureFloatView` suppressed the click because the save dispatched
// `setNodeMarkup(pos)` against the MAIN editor, and a float's `pos` would have
// mis-targeted MAIN.
//
// The fix carries the OWNING editor through `virgil-figure-click` and the save
// dispatches into THAT editor (see EditorLayout.handleFigureSave +
// FigureBlockNodeView's click bridge). These locks exercise the exact save
// contract `handleFigureSave` runs (bounds-guard → `nodeAt(pos)` → kind-switch →
// `setNodeMarkup` [+ figureCaption re-tokenize for figureBlock]) against the
// owning editor, and prove the routing isolates pos-spaces: a save into the
// embedded float editor edits the embed and never the MAIN doc by absolute pos.
//
// `@/lib/storage` is mocked (the figure/graphics NodeViews transitively import
// it, and storage.ts's `require("@/…")` calls don't resolve under vitest's
// aliaser — the extension-barrel storage gotcha).
import { describe, it, expect, vi } from "vitest";

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
  const mod: Record<string, unknown> = {};
  for (const fn of STORAGE_FNS) mod[fn] = () => undefined;
  return mod;
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { FigureBlock } from "@/lib/tiptap/figure-block";
import { GraphicsBlock } from "@/lib/tiptap/graphics-block";
import { FigureCaption } from "@/lib/tiptap/figure-caption";
import {
  applyFigureEnvBodyEdit,
  applyFigureExtrasEdit,
  applyGraphicsCommandEdit,
} from "@/lib/figures/apply-env-body";

// The REAL save contract, not a transcription of it (tasks 318/319).
//
// This helper used to be a hand-copied body of `EditorLayout.handleFigureSave`,
// under a comment claiming it pinned "the exact save contract" — and it had
// already fallen behind the thing it pinned: task 263 added `shortCaption` to
// the production writeback and not to this copy, so the suite went green over
// a version of the contract that predates the byte it protects. A test that
// re-implements what it tests can only pin what someone remembered to copy.
//
// The production sites now share ONE writeback, and this drives it. What the
// helper still owns is the DISPATCH — which door a `pos` goes through — since
// that is what `handleFigureSave` decides, and targeting the wrong editor is
// the EX-F4-02 corruption these locks exist for.
function saveFigure(editor: Editor, pos: number, newText: string): boolean {
  if (!editor || editor.isDestroyed) return false;
  return (
    applyFigureEnvBodyEdit(editor, pos, newText) ||
    applyGraphicsCommandEdit(editor, pos, newText)
  );
}

// `figureFloat` is the figure node's only mode flag (there is no `surface`
// option on FigureBlock/GraphicsBlock — `figureFloat`/`cardContext` distinguish
// the NodeView modes). The "embed" mounts with `figureFloat: true` so its
// NodeView renders the float view that now carries the owning-editor click.
function mountFigure(
  args: { source: string; caption: string },
  surface: "main" | "float",
) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      StarterKit,
      FigureCaption,
      FigureBlock.configure({ figureFloat: surface === "float" }),
      GraphicsBlock.configure({ figureFloat: surface === "float" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "figureBlock",
          attrs: {
            extras: `\\centering\n\\includegraphics[width=0.5\\textwidth]{${args.source}}`,
            source: args.source,
            widthPercent: 50,
            sources: [{ path: args.source, options: "width=0.5\\textwidth", widthPercent: 50 }],
            label: "fig:orig",
            numbered: true,
            figureNumber: "1",
          },
          content: [
            { type: "figureCaption", content: [{ type: "text", text: args.caption }] },
          ],
        },
      ],
    },
  });
  return { editor, element };
}

function mountGraphics(source: string, surface: "main" | "float") {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: [
      StarterKit,
      FigureCaption,
      FigureBlock.configure({ figureFloat: surface === "float" }),
      GraphicsBlock.configure({ figureFloat: surface === "float" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "graphicsBlock",
          attrs: {
            command: `\\includegraphics[width=0.5\\textwidth]{${source}}`,
            source,
            widthPercent: 50,
          },
        },
      ],
    },
  });
  return { editor, element };
}

function posOf(editor: Editor, typeName: string): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos < 0 && node.type.name === typeName) pos = p;
    return pos < 0;
  });
  return pos;
}

function attrsAt(editor: Editor, pos: number): Record<string, unknown> {
  return (editor.state.doc.nodeAt(pos)?.attrs ?? {}) as Record<string, unknown>;
}

function captionTextAt(editor: Editor, pos: number): string {
  const node = editor.state.doc.nodeAt(pos);
  return node?.firstChild?.textContent ?? "";
}

describe("figure save routes to the owning editor (EX-F4-02 figure twin)", () => {
  it("a graphicsBlock save into an embedded (float) editor edits the embed, not MAIN", () => {
    const main = mountGraphics("main.png", "main");
    const embed = mountGraphics("embed.png", "float");
    try {
      const mainPos = posOf(main.editor, "graphicsBlock");
      const embedPos = posOf(embed.editor, "graphicsBlock");
      expect(mainPos).toBe(embedPos); // same pos-space numeral, different docs

      const ok = saveFigure(
        embed.editor,
        embedPos,
        "\\includegraphics[width=0.9\\textwidth]{embed-edited.png}",
      );
      expect(ok).toBe(true);

      // The embed received the edit…
      expect(attrsAt(embed.editor, embedPos).source).toBe("embed-edited.png");
      // …and MAIN is completely untouched (the corruption the gate prevented).
      expect(attrsAt(main.editor, mainPos).source).toBe("main.png");
    } finally {
      main.editor.destroy();
      main.element.remove();
      embed.editor.destroy();
      embed.element.remove();
    }
  });

  it("a figureBlock save into an embedded (float) editor edits the embed's source + caption, not MAIN", () => {
    const main = mountFigure({ source: "main.png", caption: "Main caption" }, "main");
    const embed = mountFigure({ source: "embed.png", caption: "Embed caption" }, "float");
    try {
      const mainPos = posOf(main.editor, "figureBlock");
      const embedPos = posOf(embed.editor, "figureBlock");
      expect(mainPos).toBe(embedPos);

      const ok = saveFigure(
        embed.editor,
        embedPos,
        "\\centering\n\\includegraphics[width=0.8\\textwidth]{embed-edited.png}\n\\caption{Embed edited caption}\n\\label{fig:embed}",
      );
      expect(ok).toBe(true);

      // The embed received the attr + caption edit (the richer-than-math path)…
      expect(attrsAt(embed.editor, embedPos).source).toBe("embed-edited.png");
      expect(attrsAt(embed.editor, embedPos).label).toBe("fig:embed");
      expect(captionTextAt(embed.editor, embedPos)).toBe("Embed edited caption");
      // …and MAIN is completely untouched.
      expect(attrsAt(main.editor, mainPos).source).toBe("main.png");
      expect(captionTextAt(main.editor, mainPos)).toBe("Main caption");
    } finally {
      main.editor.destroy();
      main.element.remove();
      embed.editor.destroy();
      embed.element.remove();
    }
  });

  it("a save into the MAIN editor edits MAIN (unchanged behaviour)", () => {
    const main = mountGraphics("before.png", "main");
    try {
      const pos = posOf(main.editor, "graphicsBlock");
      expect(
        saveFigure(main.editor, pos, "\\includegraphics{after.png}"),
      ).toBe(true);
      expect(attrsAt(main.editor, pos).source).toBe("after.png");
    } finally {
      main.editor.destroy();
      main.element.remove();
    }
  });

  it("a figureBlock save round-trips to the embed's getJSON (its write-back source)", () => {
    // The float propagates to MAIN via its own onUpdate → writeBackToMain, which
    // reads editor.getJSON(). Prove the edited source/caption are visible there.
    const embed = mountFigure({ source: "old.png", caption: "Old" }, "float");
    try {
      const pos = posOf(embed.editor, "figureBlock");
      saveFigure(
        embed.editor,
        pos,
        "\\includegraphics{new.png}\n\\caption{New}\n\\label{fig:e}",
      );
      const json = JSON.stringify(embed.editor.getJSON());
      expect(json).toContain("new.png");
      expect(json).toContain("New");
      expect(json).not.toContain("old.png");
    } finally {
      embed.editor.destroy();
      embed.element.remove();
    }
  });

  it("a stale / out-of-range pos is a safe no-op (no throw, no corruption)", () => {
    const main = mountGraphics("keep.png", "main");
    try {
      // A pos past the doc end: handleFigureSave's bounds guard bails BEFORE
      // nodeAt() (which THROWS on an out-of-range pos).
      expect(saveFigure(main.editor, 9999, "\\includegraphics{z.png}")).toBe(false);
      // The real graphics node is untouched.
      expect(attrsAt(main.editor, posOf(main.editor, "graphicsBlock")).source).toBe(
        "keep.png",
      );
    } finally {
      main.editor.destroy();
      main.element.remove();
    }
  });
});

// ── tasks 318 + 319 ─────────────────────────────────────────────────────────
// The writeback's own contract, against a REAL editor: what the popover save
// re-threads, and what the visual chrome is allowed to touch. These are the
// legs the hand-copied helper above could not have had — it never carried the
// fields whose loss they pin.
describe("figure writeback re-threads every declared fact", () => {
  it("threads hasCaption + shortCaption back off the edited body", () => {
    const { editor, element } = mountFigure(
      { source: "a.png", caption: "Before" },
      "main",
    );
    try {
      const pos = posOf(editor, "figureBlock");
      expect(
        saveFigure(
          editor,
          pos,
          "\\includegraphics{a.png}\n\\caption[Short]{Long}\n\\label{fig:a}",
        ),
      ).toBe(true);
      expect(attrsAt(editor, pos).shortCaption).toBe("Short");
      expect(attrsAt(editor, pos).hasCaption).toBe(true);
      expect(captionTextAt(editor, pos)).toBe("Long");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  // Removing the `\caption` line in the popover is a real edit: the figure
  // becomes caption-less (and therefore unnumbered) rather than silently
  // regaining an empty caption on the next save.
  it("lets the popover REMOVE a caption", () => {
    const { editor, element } = mountFigure(
      { source: "a.png", caption: "Before" },
      "main",
    );
    try {
      const pos = posOf(editor, "figureBlock");
      expect(saveFigure(editor, pos, "\\includegraphics{a.png}")).toBe(true);
      expect(attrsAt(editor, pos).hasCaption).toBe(false);
      expect(captionTextAt(editor, pos)).toBe("");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  // The width stepper / file picker own `extras` and nothing else. They used to
  // rebuild the WHOLE env from a plain-text projection of the caption, so every
  // click dropped the `[short]` bracket, flattened any citation or mark in the
  // caption, and re-indented the body two spaces further right.
  it("chrome width/path edits leave caption, label and provenance untouched", () => {
    const { editor, element } = mountFigure(
      { source: "a.png", caption: "Keep me" },
      "main",
    );
    try {
      const pos = posOf(editor, "figureBlock");
      // Seed the fields a whole-env round-trip would lose.
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...editor.state.doc.nodeAt(pos)!.attrs,
          shortCaption: "Short",
          hasCaption: true,
        }),
      );
      const before = attrsAt(editor, pos);
      expect(
        applyFigureExtrasEdit(
          editor,
          pos,
          "\\centering\n\\includegraphics[width=0.9\\textwidth]{a.png}",
        ),
      ).toBe(true);
      const after = attrsAt(editor, pos);
      expect(after.widthPercent).toBe(90);
      expect(after.extras).toBe(
        "\\centering\n\\includegraphics[width=0.9\\textwidth]{a.png}",
      );
      expect(after.shortCaption).toBe("Short");
      expect(after.hasCaption).toBe(true);
      expect(after.label).toBe(before.label);
      expect(captionTextAt(editor, pos)).toBe("Keep me");
    } finally {
      editor.destroy();
      element.remove();
    }
  });

  it("refuses a pos that holds the other node kind", () => {
    const fig = mountFigure({ source: "a.png", caption: "C" }, "main");
    const gfx = mountGraphics("b.png", "main");
    try {
      expect(
        applyGraphicsCommandEdit(
          fig.editor,
          posOf(fig.editor, "figureBlock"),
          "\\includegraphics{z.png}",
        ),
      ).toBe(false);
      expect(
        applyFigureEnvBodyEdit(
          gfx.editor,
          posOf(gfx.editor, "graphicsBlock"),
          "\\includegraphics{z.png}\n\\caption{C}",
        ),
      ).toBe(false);
      expect(attrsAt(fig.editor, posOf(fig.editor, "figureBlock")).source).toBe(
        "a.png",
      );
      expect(attrsAt(gfx.editor, posOf(gfx.editor, "graphicsBlock")).source).toBe(
        "b.png",
      );
    } finally {
      fig.editor.destroy();
      fig.element.remove();
      gfx.editor.destroy();
      gfx.element.remove();
    }
  });
});
