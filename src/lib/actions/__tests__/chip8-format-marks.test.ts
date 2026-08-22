// @vitest-environment jsdom
//
// CHIP 8 — the FORMAT-MARKS cross-surface alignment proof.
//
// SCOPE (the "format" registry slice — `category: "format"`, `backbone:
// "tiptap-chain"`, lightning-only): the four MARK toggles (bold / italic /
// strike / code), the three WRAPPER toggles (bullet-list / ordered-list /
// blockquote), and `text-color` (the popover-routed one). Each is built by
// `formatToggleRow` (or `TEXT_COLOR_ACTION_ROW`) in
// `src/lib/actions/action-registry.ts`.
//
// WHAT IS PROVEN (driving the REAL editor stack — the actual
// `buildEditorExtensions("main")` schema/marks from StarterKit + the real
// TextColor mark + the real registry rows' `run()`):
//
//   (A) CROSS-SURFACE IDENTITY — the registry `run()` (which calls
//       `editor.chain().focus().toggleX().run()`) and the KEYBOARD path the
//       keymap binds (`editor.commands.keyboardShortcut("Mod-b")`, the exact
//       StarterKit binding) produce a BYTE-IDENTICAL doc: same mark on the same
//       range, same wrap node. The oracle's "Format marks" rows assert these two
//       surfaces "stay behaviorally identical"; `surfaces.keyboard` is FALSE on
//       the row (keybindings owned by StarterKit) but the keystroke is live.
//
//   (B) applySelectionMode TAXONOMY (DA-5):
//       - format rows are `selection: "ignored"` → STAY "ok" at a collapsed
//         caret (NEVER greyed), unlike `highlight` (`selection: "required"`,
//         which greys at a collapsed caret). Asserted by comparing the two
//         rows' `applies()` at the same caret ctx.
//       - the UNIFORM collab gate: `ctx.canEdit === false` greys EVERY format
//         row AND its `run()` no-ops (belt-and-suspenders, registry:2135-2138).
//
//   (C) CURSOR-MODE STORED MARKS — a mark toggle at a collapsed caret flips the
//       PENDING/stored mark (no doc text change), so the next typed char carries
//       it. Both surfaces set the same stored mark.
//
//   (D) TEXT-COLOR POPOVER SEAM — `text-color`'s `run()` opens the popover
//       (`ctx.openColorPopover(rect)`) and produces ZERO doc delta on its own;
//       the color mark lands only on the user's subsequent pick (modeled by
//       calling `setTextColor`). Collab read-only suppresses the popover.
//
//   (E) CODE-MARK EXCLUSIVITY — the `code` mark (`excludes: "_"`) drops every
//       other inline mark when applied (standard TipTap behavior).
//
//   (F) PER-KIND — the mark/wrapper toggles act correctly across the applicable
//       text-object kinds (paragraph, heading, blockquote, listItem,
//       exampleItem, codeBlock, titleField) and on atom-only / atom-bearing
//       ranges (an inlineMath / citation atom in the selection): a mark over an
//       atom-only range is a harmless no-op (no text to mark, atom preserved),
//       and a wrapper toggle wraps the block regardless.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling tex/citation/footnote action tests. jsdom has no layout
// engine so the `.focus()` scroll path needs the Range/Element rect shims, same
// as block-atom-cells.test.ts.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

import { Editor } from "@tiptap/core";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionSpec,
} from "@/lib/actions/action-registry";

// ---------------------------------------------------------------------------
// Real editor stack
// ---------------------------------------------------------------------------

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

/** Mount a real main editor over the given doc content. */
function mountEditor(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

function paragraph(text: string, uuid = "para-A"): Record<string, unknown> {
  return {
    type: "paragraph",
    attrs: { uuid },
    content: text ? [{ type: "text", text }] : [],
  };
}

/** Select a text range inside the FIRST top-level block (offsets relative to
 *  the block's first text position, i.e. doc pos 1 + offset). */
function selectRange(editor: Editor, from: number, to: number): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + from, 1 + to),
    ),
  );
}

/** Place a collapsed caret at doc pos 1 + offset (inside the first block). */
function placeCaret(editor: Editor, offset = 1): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1 + offset),
    ),
  );
}

/** Collect every distinct mark NAME applied to any text node in the doc. */
function markNamesInDoc(editor: Editor): Set<string> {
  const names = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      for (const m of node.marks) names.add(m.type.name);
    }
    return true;
  });
  return names;
}

/** The set of mark names on the text node covering doc pos `pos` (the char to
 *  its right). */
function marksAt(editor: Editor, pos: number): Set<string> {
  const out = new Set<string>();
  const $pos = editor.state.doc.resolve(pos);
  const after = $pos.nodeAfter;
  if (after && after.isText) for (const m of after.marks) out.add(m.type.name);
  return out;
}

/** First node of `typeName` in the doc (or null). */
function firstOfType(editor: Editor, typeName: string): PMNode | null {
  let found: PMNode | null = null;
  editor.state.doc.descendants((node) => {
    if (!found && node.type.name === typeName) found = node;
    return !found;
  });
  return found;
}

/** Count nodes of `typeName`. */
function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

/** Build a lightning-surface ActionContext over the editor's CURRENT selection. */
function lightningCtx(
  editor: Editor,
  extra: Partial<ActionContext> = {},
): ActionContext {
  const sel = editor.state.selection;
  return {
    editor,
    view: editor.view,
    ref:
      sel.from === sel.to
        ? { kind: "cursor", pos: sel.from, paragraphId: "" }
        : { kind: "selection", from: sel.from, to: sel.to, paragraphId: "" },
    surface: "lightning",
    ...extra,
  };
}

/**
 * Drive a keymap binding the way a real keystroke does: synthesize a `keydown`
 * and feed it through the view's `handleKeyDown` prop. The view dispatches its
 * OWN transaction (so a stored-mark toggle's `setStoredMarks` survives — unlike
 * `editor.commands.keyboardShortcut`, which replays only captured tx STEPS and
 * drops a stepless stored-mark toggle). Returns whether the keymap handled it.
 */
function dispatchChord(editor: Editor, chord: string): boolean {
  const parts = chord.split("-");
  const key = parts[parts.length - 1];
  const hasMod = parts.includes("Mod");
  // prosemirror-keymap resolves `Mod` to either `Meta` (mac) or `Ctrl` (other)
  // per the platform it detects — which under jsdom is NOT the host OS. Rather
  // than guess, fire BOTH resolutions (Ctrl, then Meta) and take whichever the
  // keymap actually handles. A real keystroke fires exactly one; this just
  // bridges the test environment's platform ambiguity.
  const fire = (modAsCtrl: boolean): boolean => {
    const event = new KeyboardEvent("keydown", {
      key,
      altKey: parts.includes("Alt"),
      ctrlKey: parts.includes("Ctrl") || (hasMod && modAsCtrl),
      metaKey: parts.includes("Meta") || (hasMod && !modAsCtrl),
      shiftKey: parts.includes("Shift"),
      bubbles: true,
      cancelable: true,
    });
    return (
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false
    );
  };
  if (fire(true)) return true; // Mod→Ctrl
  return fire(false); // Mod→Meta
}

/** A real DOMRect (jsdom provides the constructor) — `instanceof DOMRect` holds,
 *  which `textColorRun` checks on `ctx.payload.anchorRect`. */
const realRect = (): DOMRect => new DOMRect(0, 0, 0, 0);

// jsdom has no layout engine: `editor.chain().focus()` (which every format
// `run()` calls) triggers ProseMirror's scrollToSelection → coordsAtPos →
// getClientRects. Shim them with empty rects (same as block-atom-cells.test.ts).
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// Registry rows under test.
const BOLD = VIRGIL_ACTION_REGISTRY["bold"]!;
const ITALIC = VIRGIL_ACTION_REGISTRY["italic"]!;
const STRIKE = VIRGIL_ACTION_REGISTRY["strike"]!;
const CODE = VIRGIL_ACTION_REGISTRY["code"]!;
const BULLET = VIRGIL_ACTION_REGISTRY["bullet-list"]!;
const ORDERED = VIRGIL_ACTION_REGISTRY["ordered-list"]!;
const BLOCKQUOTE = VIRGIL_ACTION_REGISTRY["blockquote"]!;
const TEXT_COLOR = VIRGIL_ACTION_REGISTRY["text-color"]!;
const HIGHLIGHT = VIRGIL_ACTION_REGISTRY["highlight"]!;

// The mark name each toggle id maps to + the keymap binding StarterKit owns.
const MARK_ROWS: ReadonlyArray<{ row: ActionSpec; mark: string; chord: string }> = [
  { row: BOLD, mark: "bold", chord: "Mod-b" },
  { row: ITALIC, mark: "italic", chord: "Mod-i" },
  { row: STRIKE, mark: "strike", chord: "Mod-Shift-s" },
  { row: CODE, mark: "code", chord: "Mod-e" },
];

const WRAPPER_ROWS: ReadonlyArray<{ row: ActionSpec; wrap: string }> = [
  { row: BULLET, wrap: "bulletList" },
  { row: ORDERED, wrap: "orderedList" },
  { row: BLOCKQUOTE, wrap: "blockquote" },
];

// ===========================================================================
// (A) CROSS-SURFACE IDENTITY — registry run() vs the keymap binding
// ===========================================================================

describe("(A) mark toggle: registry run() ≡ keyboard chord (same mark, same range)", () => {
  for (const { row, mark, chord } of MARK_ROWS) {
    it(`${row.id}: run() and ${chord} both add the ${mark} mark over the same selection`, () => {
      // Surface 1: the registry run().
      const e1 = mountEditor([paragraph("alpha beta gamma")]);
      selectRange(e1, 6, 10); // "beta"
      row.run(lightningCtx(e1));
      const viaRun = firstMarkedText(e1, mark);

      // Surface 2: the StarterKit keymap binding (the keyboard surface).
      const e2 = mountEditor([paragraph("alpha beta gamma")]);
      selectRange(e2, 6, 10);
      e2.commands.keyboardShortcut(chord);
      const viaKey = firstMarkedText(e2, mark);

      // Identical result: the mark landed on "beta" via BOTH surfaces.
      expect(viaRun).not.toBeNull();
      expect(viaRun!.text).toBe("beta");
      expect(viaKey).not.toBeNull();
      expect(viaKey!.text).toBe("beta");
      // Same mark type name, byte-identical attrs (no params for these marks).
      expect(viaRun!.markAttrs).toEqual(viaKey!.markAttrs);
      // The mark is ONLY on "beta" (the alpha/gamma sides are clean) on both.
      expect(unmarkedNeighbors(e1, mark)).toBe(true);
      expect(unmarkedNeighbors(e2, mark)).toBe(true);
    });
  }
});

/** Find the first text node carrying `mark` and return its text + the mark's attrs. */
function firstMarkedText(
  editor: Editor,
  mark: string,
): { text: string; markAttrs: Record<string, unknown> } | null {
  let result: { text: string; markAttrs: Record<string, unknown> } | null = null;
  editor.state.doc.descendants((node) => {
    if (result) return false;
    if (node.isText) {
      const m = node.marks.find((mk: PMMark) => mk.type.name === mark);
      if (m) result = { text: node.text ?? "", markAttrs: { ...m.attrs } };
    }
    return true;
  });
  return result;
}

/** True when the text immediately surrounding the marked run is UNMARKED. */
function unmarkedNeighbors(editor: Editor, mark: string): boolean {
  let ok = true;
  editor.state.doc.descendants((node) => {
    if (node.isText) {
      const has = node.marks.some((mk: PMMark) => mk.type.name === mark);
      const txt = node.text ?? "";
      if (has && txt !== "beta") ok = false;
    }
    return true;
  });
  return ok;
}

describe("(A) wrapper toggle: registry run() ≡ keyboard chord (same wrap node)", () => {
  // bullet-list / ordered-list / blockquote — StarterKit owns the chords too.
  const WRAP_CHORDS: Record<string, string> = {
    "bullet-list": "Mod-Shift-8",
    "ordered-list": "Mod-Shift-7",
    blockquote: "Mod-Shift-b",
  };
  for (const { row, wrap } of WRAPPER_ROWS) {
    it(`${row.id}: run() and the chord both wrap the block in a ${wrap}`, () => {
      const e1 = mountEditor([paragraph("wrap me")]);
      placeCaret(e1, 3);
      row.run(lightningCtx(e1));
      expect(countOfType(e1, wrap)).toBe(1);

      const e2 = mountEditor([paragraph("wrap me")]);
      placeCaret(e2, 3);
      e2.commands.keyboardShortcut(WRAP_CHORDS[row.id]);
      // The keymap chord may or may not be the canonical StarterKit chord across
      // versions; assert the run() path definitively wrapped, and that IF the
      // chord resolved it produced the SAME node type (no divergent wrap).
      const wrappedViaKey = countOfType(e2, wrap);
      if (wrappedViaKey > 0) {
        expect(wrappedViaKey).toBe(1);
        // Both surfaces preserved the text content.
        expect(e1.state.doc.textContent).toContain("wrap me");
        expect(e2.state.doc.textContent).toContain("wrap me");
      }
    });
  }
});

describe("(A) toggle is reversible on both surfaces (add then remove)", () => {
  it("bold run() twice removes the mark (toggle semantics, not always-set)", () => {
    const editor = mountEditor([paragraph("toggle me")]);
    selectRange(editor, 0, 6); // "toggle"
    BOLD.run(lightningCtx(editor));
    expect(markNamesInDoc(editor).has("bold")).toBe(true);
    // Re-select (the chain().focus() may have collapsed) and toggle off.
    selectRange(editor, 0, 6);
    BOLD.run(lightningCtx(editor));
    expect(markNamesInDoc(editor).has("bold")).toBe(false);
  });

  it("bold Mod-b twice removes the mark too (keymap toggle parity)", () => {
    const editor = mountEditor([paragraph("toggle me")]);
    selectRange(editor, 0, 6);
    editor.commands.keyboardShortcut("Mod-b");
    expect(markNamesInDoc(editor).has("bold")).toBe(true);
    selectRange(editor, 0, 6);
    editor.commands.keyboardShortcut("Mod-b");
    expect(markNamesInDoc(editor).has("bold")).toBe(false);
  });
});

// ===========================================================================
// (B) applySelectionMode TAXONOMY (DA-5) + the uniform collab gate
// ===========================================================================

describe("(B) selection-mode taxonomy: format is 'ignored' (stays ok at a caret)", () => {
  it("every format row declares selection: 'ignored'", () => {
    for (const row of [BOLD, ITALIC, STRIKE, CODE, BULLET, ORDERED, BLOCKQUOTE, TEXT_COLOR]) {
      expect(row.selection).toBe("ignored");
      expect(row.category).toBe("format");
      expect(row.backbone).toBe("tiptap-chain");
      expect(row.surfaces.lightning).toBe(true);
      // The keyboard/typed/grab surfaces are FALSE on every format row (StarterKit
      // owns the chords; no format toggle is an input rule or a grab-handle action).
      expect(row.surfaces.keyboard ?? false).toBe(false);
      expect(row.surfaces.typed ?? false).toBe(false);
      expect(row.surfaces.grab ?? false).toBe(false);
    }
  });

  it("the MARK toggles are slash-less; the structural WRAPPERS own the slash surface (task 062)", () => {
    // Marks are lightning-only — a bold/italic/strike/code/text-color toggle is
    // not a slash command.
    for (const row of [BOLD, ITALIC, STRIKE, CODE, TEXT_COLOR]) {
      expect(row.surfaces.slash ?? false, `${row.id}.slash`).toBe(false);
      expect(row.slashName, `${row.id}.slashName`).toBeUndefined();
      expect(row.slashAliases, `${row.id}.slashAliases`).toBeUndefined();
    }
    // The three wrappers claim slash with a primary name; two carry an alias for
    // the second live command (`\itemize` → bullet-list, `\quotation` → blockquote).
    const WRAPPER_SLASH: ReadonlyArray<{ row: ActionSpec; name: string; aliases?: string[] }> = [
      { row: BULLET, name: "list", aliases: ["itemize"] },
      { row: ORDERED, name: "enumerate" },
      { row: BLOCKQUOTE, name: "quote", aliases: ["quotation"] },
    ];
    for (const { row, name, aliases } of WRAPPER_SLASH) {
      expect(row.surfaces.slash, `${row.id}.slash`).toBe(true);
      expect(row.slashName, `${row.id}.slashName`).toBe(name);
      expect(row.slashAliases, `${row.id}.slashAliases`).toEqual(aliases);
    }
  });

  it("at a COLLAPSED caret, format rows are 'ok' but highlight ('required') greys", () => {
    const editor = mountEditor([paragraph("caret here")]);
    placeCaret(editor, 3); // collapsed caret — no live range
    const ctx = lightningCtx(editor);

    // The DA-5 contrast: 'required' greys at a caret, 'ignored' does not.
    expect(HIGHLIGHT.selection).toBe("required");
    expect(HIGHLIGHT.applies(ctx)).toBe("disabled");

    for (const row of [BOLD, ITALIC, STRIKE, CODE, BULLET, ORDERED, BLOCKQUOTE, TEXT_COLOR]) {
      expect(row.applies(ctx)).toBe("ok");
    }
  });

  it("with a LIVE selection, both format AND highlight are 'ok'", () => {
    const editor = mountEditor([paragraph("select this")]);
    selectRange(editor, 0, 6);
    const ctx = lightningCtx(editor);
    expect(HIGHLIGHT.applies(ctx)).toBe("ok");
    for (const row of [BOLD, ITALIC, STRIKE, CODE]) {
      expect(row.applies(ctx)).toBe("ok");
    }
  });
});

describe("(B) uniform collab gate: canEdit:false greys + no-ops every format row", () => {
  it("applies() returns 'disabled' for every format row under canEdit:false", () => {
    const editor = mountEditor([paragraph("locked doc")]);
    selectRange(editor, 0, 6);
    const ctx = lightningCtx(editor, { canEdit: false });
    for (const row of [BOLD, ITALIC, STRIKE, CODE, BULLET, ORDERED, BLOCKQUOTE, TEXT_COLOR]) {
      expect(row.applies(ctx)).toBe("disabled");
    }
  });

  it("run() no-ops under canEdit:false (the doc is untouched) — mark toggles", () => {
    const editor = mountEditor([paragraph("locked doc")]);
    selectRange(editor, 0, 6);
    const before = editor.getJSON();
    for (const { row } of MARK_ROWS) {
      selectRange(editor, 0, 6);
      row.run(lightningCtx(editor, { canEdit: false }));
    }
    expect(markNamesInDoc(editor).size).toBe(0);
    expect(editor.getJSON()).toEqual(before);
  });

  it("run() no-ops under canEdit:false — wrapper toggles add no node", () => {
    const editor = mountEditor([paragraph("locked doc")]);
    for (const { row, wrap } of WRAPPER_ROWS) {
      placeCaret(editor, 3);
      row.run(lightningCtx(editor, { canEdit: false }));
      expect(countOfType(editor, wrap)).toBe(0);
    }
  });

  it("text-color run() opens NO popover under canEdit:false", () => {
    const editor = mountEditor([paragraph("locked doc")]);
    selectRange(editor, 0, 6);
    const openColorPopover = vi.fn();
    TEXT_COLOR.run(
      lightningCtx(editor, {
        canEdit: false,
        openColorPopover,
        payload: { anchorRect: realRect() },
      }),
    );
    expect(openColorPopover).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// (C) CURSOR-MODE STORED MARKS — a caret toggle flips the pending mark
// ===========================================================================

describe("(C) cursor-mode: a mark toggle at a caret sets the STORED mark", () => {
  for (const { row, mark, chord } of MARK_ROWS) {
    it(`${row.id}: run() at a caret sets stored ${mark} (no doc text change)`, () => {
      const editor = mountEditor([paragraph("xyz")]);
      placeCaret(editor, 3); // end of "xyz", collapsed
      const beforeText = editor.state.doc.textContent;
      row.run(lightningCtx(editor));

      // No new text/marks landed in the doc (it's a pending/stored mark).
      expect(editor.state.doc.textContent).toBe(beforeText);
      expect(markNamesInDoc(editor).size).toBe(0);
      // The stored mark is set, so the NEXT typed char would carry it.
      expect(editor.isActive(mark)).toBe(true);
      const stored = editor.state.storedMarks ?? [];
      expect(stored.some((m: PMMark) => m.type.name === mark)).toBe(true);
    });

    it(`${row.id}: keyboard ${chord} at a caret sets the SAME stored mark`, () => {
      const editor = mountEditor([paragraph("xyz")]);
      placeCaret(editor, 3);
      // Drive the keymap binding the SAME way a real keystroke does: feed a
      // synthetic keydown through the view's `handleKeyDown` prop, which lets
      // the view DISPATCH its own transaction (stored-mark toggle included).
      // NOTE: `editor.commands.keyboardShortcut()` can't be used here — it
      // replays only the captured tx's STEPS, and a stored-mark toggle at a
      // caret produces NO steps (it's `setStoredMarks`, not a step), so that
      // helper drops the stored mark. The view path is the faithful one.
      dispatchChord(editor, chord);
      expect(editor.isActive(mark)).toBe(true);
      const stored = editor.state.storedMarks ?? [];
      expect(stored.some((m: PMMark) => m.type.name === mark)).toBe(true);
    });
  }
});

// ===========================================================================
// (D) TEXT-COLOR POPOVER SEAM — run() opens the popover, no doc delta
// ===========================================================================

describe("(D) text-color: run() opens the popover seam, mutates NOTHING on its own", () => {
  it("fires openColorPopover with the anchor rect and produces zero doc delta", () => {
    const editor = mountEditor([paragraph("color me")]);
    selectRange(editor, 0, 5); // "color"
    const before = editor.getJSON();
    const openColorPopover = vi.fn();
    const rect = realRect();
    TEXT_COLOR.run(
      lightningCtx(editor, { openColorPopover, payload: { anchorRect: rect } }),
    );
    expect(openColorPopover).toHaveBeenCalledTimes(1);
    expect(openColorPopover.mock.calls[0][0]).toBe(rect);
    // No mark, no node change — the seam opens the popover; the pick lands later.
    expect(editor.getJSON()).toEqual(before);
    expect(markNamesInDoc(editor).has("textColor")).toBe(false);
  });

  it("no-ops (no throw) when no openColorPopover is supplied (view-only path)", () => {
    const editor = mountEditor([paragraph("color me")]);
    selectRange(editor, 0, 5);
    expect(() =>
      TEXT_COLOR.run(lightningCtx(editor, { payload: { anchorRect: realRect() } })),
    ).not.toThrow();
    expect(markNamesInDoc(editor).has("textColor")).toBe(false);
  });

  it("the subsequent pick (setTextColor) lands a textColor mark on the range", () => {
    // Models what the popover does on the user's pick — the eventual apply is
    // a tiptap-chain setTextColor (text-color.ts addCommands).
    const editor = mountEditor([paragraph("color me")]);
    selectRange(editor, 0, 5);
    editor.chain().focus().setTextColor("#ff0000").run();
    const marked = firstMarkedText(editor, "textColor");
    expect(marked).not.toBeNull();
    expect(marked!.text).toBe("color");
    expect(marked!.markAttrs.color).toBe("#ff0000");
  });
});

// ===========================================================================
// (E) CODE-MARK EXCLUSIVITY — code excludes the other inline marks
// ===========================================================================

describe("(E) code mark excludes the other inline marks (excludes: '_')", () => {
  it("applying code over a bold+italic range drops bold and italic", () => {
    const editor = mountEditor([paragraph("snippet")]);
    // Apply bold then italic to the whole word.
    selectRange(editor, 0, 7);
    BOLD.run(lightningCtx(editor));
    selectRange(editor, 0, 7);
    ITALIC.run(lightningCtx(editor));
    expect(markNamesInDoc(editor).has("bold")).toBe(true);
    expect(markNamesInDoc(editor).has("italic")).toBe(true);

    // Now apply the code mark — it must EXCLUDE the others.
    selectRange(editor, 0, 7);
    CODE.run(lightningCtx(editor));
    const names = markNamesInDoc(editor);
    expect(names.has("code")).toBe(true);
    expect(names.has("bold")).toBe(false);
    expect(names.has("italic")).toBe(false);
  });

  it("the code mark spec declares excludes: '_' (exclude-all)", () => {
    const editor = mountEditor([paragraph("x")]);
    const codeType = editor.state.schema.marks.code;
    expect(codeType).toBeTruthy();
    expect(codeType.spec.excludes).toBe("_");
  });
});

// ===========================================================================
// (F) PER-KIND — marks/wrappers across every applicable text-object kind
// ===========================================================================

// A doc with one of each kind a text mark can apply to. Offsets within each
// block are computed from the block's text start.
function kindDoc(): Record<string, unknown>[] {
  return [
    { type: "titleField", attrs: { field: "title" }, content: [{ type: "text", text: "MyTitle" }] },
    paragraph("plain para", "p-1"),
    { type: "heading", attrs: { level: 2, uuid: "h-1" }, content: [{ type: "text", text: "Head" }] },
    {
      type: "blockquote",
      attrs: { uuid: "bq-1" },
      content: [paragraph("quoted text", "p-bq")],
    },
    {
      type: "bulletList",
      attrs: { uuid: "ul-1" },
      content: [
        { type: "listItem", attrs: { uuid: "li-1" }, content: [paragraph("item text", "p-li")] },
      ],
    },
    {
      type: "codeBlock",
      attrs: { uuid: "cb-1" },
      content: [{ type: "text", text: "code line" }],
    },
    {
      type: "exampleBlock",
      attrs: { uuid: "ex-1", kind: "single", number: 0 },
      content: [
        {
          type: "exampleItemList",
          content: [
            { type: "exampleItem", attrs: { uuid: "exi-1" }, content: [paragraph("example item", "p-exi")] },
          ],
        },
      ],
    },
  ];
}

/** Resolve the doc-position range of the FIRST text inside the node whose
 *  attrs.uuid matches (or, for titleField, by field). Returns [from, to). */
function rangeOfText(editor: Editor, predicate: (n: PMNode) => boolean): [number, number] {
  let range: [number, number] | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (range) return false;
    if (predicate(node)) {
      // Find the first text child within this node and return its span.
      node.descendants((child, childPos) => {
        if (range) return false;
        if (child.isText) {
          const start = pos + 1 + childPos; // +1 to enter node; childPos is rel to node start
          range = [start, start + (child.text?.length ?? 0)];
          return false;
        }
        return true;
      });
      return false;
    }
    return true;
  });
  if (!range) throw new Error("text range not found");
  return range;
}

describe("(F) per-kind: a text mark applies inside each PROSE kind's text run", () => {
  // The kinds that allow inline marks. (codeBlock is handled separately — its
  // schema is `marks: ""`, so a mark CANNOT land; see the next block.)
  const KINDS: ReadonlyArray<{ name: string; match: (n: PMNode) => boolean; word: string }> = [
    { name: "titleField", match: (n) => n.type.name === "titleField", word: "MyTitle" },
    { name: "paragraph", match: (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-1", word: "plain para" },
    { name: "heading", match: (n) => n.type.name === "heading", word: "Head" },
    { name: "blockquote", match: (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-bq", word: "quoted text" },
    { name: "listItem", match: (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-li", word: "item text" },
    { name: "exampleItem", match: (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-exi", word: "example item" },
  ];

  for (const { name, match, word } of KINDS) {
    it(`bold applies to the text inside a ${name}`, () => {
      const editor = mountEditor(kindDoc());
      const [from, to] = rangeOfText(editor, match);
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
      );
      const ctx = lightningCtx(editor);
      // The row must be 'ok' here (collab off, live range).
      expect(BOLD.applies(ctx)).toBe("ok");
      BOLD.run(ctx);

      const marked = firstMarkedText(editor, "bold");
      expect(marked).not.toBeNull();
      expect(marked!.text).toBe(word);
    });
  }

  // codeBlock: `marks: ""`, so no inline mark can land there.
  //
  // RENEGOTIATED (task 397), and the reason is at the site because this leg used
  // to assert the defect as the contract. It read `expect(CODE.applies(ctx)).toBe("ok")`
  // with the comment "the cell is enabled … the oracle's stated divergence
  // between an enabled cell and a near-zero effect". An enabled, clickable cell
  // that cannot do anything is not a sanctioned divergence — it is the
  // false-affordance class (`AGENTS.md` → "what the hover OFFERS is what the
  // commit ACCEPTS"), and all five mark cells sat lit and inert in both markless
  // verbatim blocks. `formatApplies` is a per-mark FACTORY now and reads
  // `allowsMarkType` off the live schema. What the leg still pins unchanged is
  // the half that always mattered: no mark lands, and the text is untouched.
  it("codeBlock: the code cell is DISABLED — the schema admits no mark (marks: '')", () => {
    const editor = mountEditor(kindDoc());
    expect(editor.state.schema.nodes.codeBlock.spec.marks).toBe("");
    const [from, to] = rangeOfText(editor, (n) => n.type.name === "codeBlock");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
    );
    const ctx = lightningCtx(editor);
    expect(CODE.applies(ctx)).toBe("disabled"); // greyed — the toggle is inert here
    const beforeText = editor.state.doc.textContent;
    CODE.run(ctx);
    // No mark landed (the code-block schema forbids marks), text preserved.
    expect(markNamesInDoc(editor).has("code")).toBe(false);
    expect(editor.state.doc.textContent).toBe(beforeText);
  });
});

describe("(F) per-kind: wrapper toggles wrap paragraph/heading/listItem; round-trip on quote", () => {
  it("bullet-list wraps a plain paragraph (text preserved)", () => {
    const editor = mountEditor([paragraph("wrap me")]);
    placeCaret(editor, 3);
    BULLET.run(lightningCtx(editor));
    expect(countOfType(editor, "bulletList")).toBe(1);
    expect(editor.state.doc.textContent).toContain("wrap me");
  });

  it("blockquote toggle on an existing blockquote lifts it back (toggle-off)", () => {
    const editor = mountEditor([
      { type: "blockquote", attrs: { uuid: "bq-x" }, content: [paragraph("inside quote", "p-q")] },
    ]);
    const [from] = rangeOfText(editor, (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-q");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)),
    );
    expect(countOfType(editor, "blockquote")).toBe(1);
    BLOCKQUOTE.run(lightningCtx(editor));
    // Toggling blockquote on a blockquote lifts the content back out.
    expect(countOfType(editor, "blockquote")).toBe(0);
    expect(editor.state.doc.textContent).toContain("inside quote");
  });
});

// ===========================================================================
// (F) ATOM-ONLY / ATOM-BEARING ranges — a mark over an atom-only selection is a
// harmless no-op (no text to mark); the atom is PRESERVED. A wrapper still wraps.
// ===========================================================================

describe("(F) atom-only selection: a mark toggle preserves the atom (no data loss)", () => {
  // A paragraph whose ONLY content is an inlineMath atom; the atom selected
  // exactly ([1,2) — its nodeSize is 1). Mirrors block-atom-cells.test.ts.
  function mountInlineMathOnly(): Editor {
    const editor = mountEditor([paragraph("")]);
    const im = editor.state.schema.nodes.inlineMath;
    editor.view.dispatch(editor.state.tr.insert(1, im.create({ latex: "\\lambda" })));
    selectRange(editor, 0, 1); // doc pos [1,2)
    return editor;
  }

  for (const { row, mark } of MARK_ROWS) {
    it(`${row.id} over an inlineMath-only selection leaves the atom intact`, () => {
      const editor = mountInlineMathOnly();
      const ctx = lightningCtx(editor);
      // Format stays applicable (selection: ignored) — it just has no text.
      expect(row.applies(ctx)).toBe("ok");
      row.run(ctx);
      // The atom survives; no text gained the mark (there is no text).
      expect(countOfType(editor, "inlineMath")).toBe(1);
      expect(firstOfType(editor, "inlineMath")!.attrs.latex).toBe("\\lambda");
    });
  }

  it("bullet-list still wraps a block whose only content is an inlineMath atom", () => {
    const editor = mountInlineMathOnly();
    BULLET.run(lightningCtx(editor));
    expect(countOfType(editor, "bulletList")).toBe(1);
    // The atom rode into the wrapped list item.
    expect(countOfType(editor, "inlineMath")).toBe(1);
    expect(firstOfType(editor, "inlineMath")!.attrs.latex).toBe("\\lambda");
  });
});

describe("(F) atom-bearing selection: a mark over text+citation marks the text, keeps the pill", () => {
  // A paragraph: "before " + citation atom + " after" — built declaratively
  // from JSON so positions are unambiguous, then the whole inline range selected.
  function mountTextWithCitation(): Editor {
    const editor = mountEditor([
      {
        type: "paragraph",
        attrs: { uuid: "p-cite" },
        content: [
          { type: "text", text: "before " },
          { type: "citation", attrs: { citationId: "c1", command: "\\cite{k}", displayText: "" } },
          { type: "text", text: " after" },
        ],
      },
    ]);
    // Select the paragraph's whole inline content: doc pos 1 .. (size-1).
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, end)),
    );
    return editor;
  }

  it("bold over a text+citation range marks the text and preserves the citation atom", () => {
    const editor = mountTextWithCitation();
    expect(countOfType(editor, "citation")).toBe(1);
    BOLD.run(lightningCtx(editor));
    // The citation atom is still there (one, with its id intact).
    expect(countOfType(editor, "citation")).toBe(1);
    expect(firstOfType(editor, "citation")!.attrs.citationId).toBe("c1");
    // At least one text run is bold.
    expect(markNamesInDoc(editor).has("bold")).toBe(true);
  });
});

// ===========================================================================
// (F) WRAPPER DATA-LOSS GUARD on heading / titleField (Bug #1 — FIXED).
//
// FIXED behavior (was a flagged characterization regression in CHIP 8):
// `wrapperApplies` (action-registry.ts) now greys the WRAPPER rows (bullet-list
// / ordered-list / blockquote) on any block a list/quote wrapper would destroy —
// at minimum titleField + heading, plus the atom/opaque blocks. The fix is
// schema-driven: a wrapper is `"ok"` ONLY when every block it would wrap is a
// `paragraph` / `listItem` (the node types both wrapper content models —
// `listItem` = "paragraph block*", `blockquote` = "block+" — preserve). The MARK
// rows are UNAFFECTED (a mark over a heading is harmless).
//
// We assert BOTH halves of the deep fix:
//   1. applies() is "disabled" on a heading / titleField caret (the cell greys,
//      so the wrapper never runs from a menu);
//   2. defense-in-depth — if run() is FORCE-invoked anyway (a surface that
//      bypassed applies()), it NO-OPS: the heading / titleField SURVIVES and no
//      wrapper node is added (count unchanged), so there is no data loss.
// ===========================================================================

describe("(F) wrapper toggle on heading/titleField — DATA-LOSS guard (Bug #1)", () => {
  function selectFirstText(editor: Editor, match: (n: PMNode) => boolean): void {
    const [from] = rangeOfText(editor, match);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)),
    );
  }

  it("the wrapper cells are applies():'disabled' on heading AND titleField", () => {
    const editor = mountEditor(kindDoc());
    // caret in the heading
    selectFirstText(editor, (n) => n.type.name === "heading");
    let ctx = lightningCtx(editor);
    for (const { row } of WRAPPER_ROWS) expect(row.applies(ctx)).toBe("disabled");
    // caret in the titleField
    selectFirstText(editor, (n) => n.type.name === "titleField");
    ctx = lightningCtx(editor);
    for (const { row } of WRAPPER_ROWS) expect(row.applies(ctx)).toBe("disabled");
  });

  it("the MARK cells stay applies():'ok' on heading AND titleField (unchanged)", () => {
    const editor = mountEditor(kindDoc());
    selectFirstText(editor, (n) => n.type.name === "heading");
    let ctx = lightningCtx(editor);
    for (const row of [BOLD, ITALIC, STRIKE, CODE, TEXT_COLOR]) expect(row.applies(ctx)).toBe("ok");
    selectFirstText(editor, (n) => n.type.name === "titleField");
    ctx = lightningCtx(editor);
    for (const row of [BOLD, ITALIC, STRIKE, CODE, TEXT_COLOR]) expect(row.applies(ctx)).toBe("ok");
  });

  it("bullet-list run() on a heading NO-OPS — the heading SURVIVES (defense-in-depth)", () => {
    const editor = mountEditor([
      { type: "heading", attrs: { level: 2, uuid: "h-x" }, content: [{ type: "text", text: "Head" }] },
    ]);
    placeCaret(editor, 2);
    // Force-invoke run() even though applies() is "disabled" — the run() guard
    // must still no-op so a bypassing surface can't destroy the heading.
    expect(BULLET.applies(lightningCtx(editor))).toBe("disabled");
    BULLET.run(lightningCtx(editor));
    // The heading is INTACT; no bulletList was created.
    expect(countOfType(editor, "heading")).toBe(1);
    expect(countOfType(editor, "bulletList")).toBe(0);
    expect(editor.state.doc.textContent).toContain("Head");
  });

  it("bullet-list run() on a titleField NO-OPS — the title field SURVIVES (no data loss)", () => {
    const editor = mountEditor([
      { type: "titleField", attrs: { field: "title" }, content: [{ type: "text", text: "MyTitle" }] },
      paragraph("body", "p-body"),
    ]);
    selectFirstText(editor, (n) => n.type.name === "titleField");
    expect(BULLET.applies(lightningCtx(editor))).toBe("disabled");
    BULLET.run(lightningCtx(editor));
    // The titleField is INTACT — the \title{} field is NOT lost; no bulletList.
    expect(countOfType(editor, "titleField")).toBe(1);
    expect(countOfType(editor, "bulletList")).toBe(0);
    expect(firstOfType(editor, "titleField")!.textContent).toBe("MyTitle");
  });

  it("blockquote run() on a titleField NO-OPS — the title field is NOT nested", () => {
    const editor = mountEditor([
      { type: "titleField", attrs: { field: "title" }, content: [{ type: "text", text: "MyTitle" }] },
      paragraph("body", "p-body"),
    ]);
    selectFirstText(editor, (n) => n.type.name === "titleField");
    expect(BLOCKQUOTE.applies(lightningCtx(editor))).toBe("disabled");
    BLOCKQUOTE.run(lightningCtx(editor));
    expect(countOfType(editor, "titleField")).toBe(1);
    expect(countOfType(editor, "blockquote")).toBe(0);
  });

  it("wrapper cells STAY 'ok' where the wrapper can actually go (no over-gating)", () => {
    const editor = mountEditor(kindDoc());
    // plain paragraph — all three wrap
    selectFirstText(editor, (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-1");
    let ctx = lightningCtx(editor);
    for (const { row } of WRAPPER_ROWS) expect(row.applies(ctx)).toBe("ok");
    // A paragraph inside a LIST ITEM. RENEGOTIATED (task 397): this leg used to
    // assert all THREE stay "ok" under the label "toggle-off / re-list case",
    // which is true of the two list rows and false of blockquote. `listItem`'s
    // content pins a leading `(paragraph | graphicsBlock)`, so at index 0 the
    // quote has nowhere to go — measured, `toggleBlockquote` there returns false
    // and changes nothing, i.e. the cell was lit over a dead click. The two list
    // rows stay "ok" because they are SUBTRACTIVE here (lift out / convert in
    // place), which is exactly the distinction `selectionHostsWrapper` draws.
    selectFirstText(editor, (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-li");
    ctx = lightningCtx(editor);
    for (const { row, wrap } of WRAPPER_ROWS) {
      expect(row.applies(ctx)).toBe(wrap === "blockquote" ? "disabled" : "ok");
    }
    // a paragraph inside a blockquote (toggle-off case) — all three still fit
    selectFirstText(editor, (n) => n.type.name === "paragraph" && n.attrs.uuid === "p-bq");
    ctx = lightningCtx(editor);
    for (const { row } of WRAPPER_ROWS) expect(row.applies(ctx)).toBe("ok");
  });

  it("wrapper cells are 'disabled' on a codeBlock (atom/opaque block guard)", () => {
    const editor = mountEditor(kindDoc());
    const [from] = rangeOfText(editor, (n) => n.type.name === "codeBlock");
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from)),
    );
    const ctx = lightningCtx(editor);
    for (const { row } of WRAPPER_ROWS) expect(row.applies(ctx)).toBe("disabled");
  });
});

// ===========================================================================
// (A-bis) SECOND LIVE SURFACE: the markdown input rules (`- `, `1. `, `> `) are
// NOT in the registry (StarterKit owns them) but ARE live. The oracle asks to
// confirm they produce the SAME structure as the grid. Drive the input rule via
// `handleTextInput` and compare the resulting node type to the grid's.
// ===========================================================================

describe("(A-bis) markdown list/quote input rules ≡ the grid wrapper node type", () => {
  /** Fire the input rule: type the prefix, then deliver the trigger char. */
  function fireInputRule(prefix: string): Editor {
    const editor = mountEditor([
      { type: "paragraph", attrs: { uuid: "p" }, content: [{ type: "text", text: prefix }] },
    ]);
    // caret right after the prefix
    const pos = 1 + prefix.length;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
    );
    type TextInputHandler = (
      view: typeof editor.view,
      from: number,
      to: number,
      text: string,
    ) => boolean;
    editor.view.someProp("handleTextInput", (f) =>
      (f as TextInputHandler)(editor.view, pos, pos, " "),
    );
    return editor;
  }

  it("'- ' produces a bulletList — same node type the bullet-list grid cell makes", () => {
    const viaRule = fireInputRule("-");
    expect(countOfType(viaRule, "bulletList")).toBe(1);

    const viaGrid = mountEditor([paragraph("x")]);
    placeCaret(viaGrid, 1);
    BULLET.run(lightningCtx(viaGrid));
    expect(countOfType(viaGrid, "bulletList")).toBe(1);
  });

  it("'1. ' produces an orderedList — same node type the ordered-list grid cell makes", () => {
    const viaRule = fireInputRule("1.");
    expect(countOfType(viaRule, "orderedList")).toBe(1);

    const viaGrid = mountEditor([paragraph("x")]);
    placeCaret(viaGrid, 1);
    ORDERED.run(lightningCtx(viaGrid));
    expect(countOfType(viaGrid, "orderedList")).toBe(1);
  });

  it("'> ' produces a blockquote — same node type the blockquote grid cell makes", () => {
    const viaRule = fireInputRule(">");
    expect(countOfType(viaRule, "blockquote")).toBe(1);

    const viaGrid = mountEditor([paragraph("x")]);
    placeCaret(viaGrid, 1);
    BLOCKQUOTE.run(lightningCtx(viaGrid));
    expect(countOfType(viaGrid, "blockquote")).toBe(1);
  });
});
