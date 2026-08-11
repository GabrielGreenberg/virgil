// Transient-highlight guardrail (task 120) — the CI half of the
// "transient state is never document content" law, in the same shape as the
// keystroke-sanctity, scroll-reposition, pane-drag, editor-observer and
// cross-window-storage guards:
//
//   SOURCE-GREP ALLOWLIST — walk `src/` AND `library/` and flag every file that
//   APPLIES or UNSETS the `highlight` mark (`.setHighlight(` / `.toggleHighlight(`
//   / `.unsetHighlight(`). The permitted set is EMPTY: no code may paint a
//   view-only signal into the document. Transient bands route through
//   `setTransientHighlights` (a meta-only decoration dispatch) instead.
//
// WHY this deserves a guard rather than care. Painting a UI signal as a mark is
// invisible at the call site — the band looks right — and breaks three things
// that never point back at it:
//
//   1. the mark-add is a HISTORY entry, so clicking a search result cleared the
//      redo branch and undone edits became unrecoverable;
//   2. the clear was itself a recorded doc-changing tx, so the first Cmd+Z after
//      closing the search panel UNDID the clear and RESURRECTED the band;
//   3. the tx was `docChanged`, so it armed the autosaver and wrote an unedited
//      doc to disk on a mere hover.
//
// A mark also cannot be scoped: the only way to clear "the transient one" was to
// select the WHOLE doc and unset EVERY highlight — so a real user highlight
// would have been collateral. And because a mark is content, a card that
// captures a document slice captures the amber band with it.
//
// If a genuinely USER-FACING highlight feature ever lands (a formatting-toolbar
// highlighter the user applies and expects to persist), that IS document content
// and belongs here as an allowlist entry with that justification — the guard
// draws the line at transient vs. authored, not at the mark itself. The
// `highlight` mark stays registered in the schema (`borrowed-schema.ts`,
// `editor-extensions.ts`) precisely so that door is open; only its use as a
// transient carrier is closed.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── The permitted highlight-mark writer allowlist ───────────────────────────
// Deliberately EMPTY. An entry means some surface writes the `highlight` mark
// into the document — only correct for AUTHORED, persisted highlighting.
const PERMITTED_HIGHLIGHT_MARK_WRITERS: Record<string, string> = {};

// Deliberately EMPTY: the Library silo renders papers read-only and has no
// highlight affordance at all.
const PERMITTED_LIBRARY_HIGHLIGHT_MARK_WRITERS: Record<string, string> = {};

/** A call that writes the `highlight` MARK into the document. */
export function detectHighlightMarkWrite(source: string): boolean {
  return /\.(set|unset|toggle)Highlight\(/.test(source);
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      if (entry === "node_modules") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function flagged(root: string): string[] {
  return walkSource(root)
    .filter((f) => detectHighlightMarkWrite(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
}

describe("transient-highlight guardrail — source allowlist", () => {
  it("no src/ file paints a transient band as a document mark", () => {
    // If this fails: you are writing a view-only signal into the document.
    // Route it through `setTransientHighlights` (lib/tiptap/transient-highlight.ts)
    // — a meta-only decoration dispatch that is invisible to history, to the
    // autosaver and to DocStructureObserver. Only add an entry here if the
    // highlight is AUTHORED content the user expects to persist.
    expect(flagged(SRC)).toEqual(
      Object.keys(PERMITTED_HIGHLIGHT_MARK_WRITERS).sort(),
    );
  });

  it("keeps the Library silo free of highlight-mark writes", () => {
    expect(flagged(LIBRARY)).toEqual(
      Object.keys(PERMITTED_LIBRARY_HIGHLIGHT_MARK_WRITERS).sort(),
    );
  });

  it("would flag the exact shape that was removed (regression fixture)", () => {
    const oldPainter = `
      const prevSelection = editor.state.selection;
      editor.chain().selectAll().unsetHighlight().setTextSelection(prevSelection.from).run();
      editor.chain().setTextSelection(range).setHighlight({ color: "#fbbf2480" }).run();
    `;
    expect(detectHighlightMarkWrite(oldPainter)).toBe(true);
    // …and the decoration bridge does NOT trip it.
    expect(
      detectHighlightMarkWrite(
        `setTransientHighlights(editor.view, [{ from, to, color: TRANSIENT_HIGHLIGHT_COLOR }]);`,
      ),
    ).toBe(false);
  });
});
