// @vitest-environment jsdom
//
// CHIP 4a-ii — the CITATION cross-surface alignment proof.
//
// THE GOAL (MEMO_ACTION_ALIGNMENT.md §3 citation row): a citation created from
// any of the four surfaces — menu (grab/lightning), slash `\cite`, typed
// `\cite{key}`, typed `\cite ` — must land at the SAME destination: a
// byte-identical `\cite{}` inline atom (`{citationId, command, displayText}`)
// AND a registered citation CARD via `cardCreation.createCitation`. This file
// drives the REAL editor stack (the actual `commands.ts` slash action + the
// actual `citation.ts` typed input rules + the real `buildEditorExtensions`
// schema) with a REAL published bridge handle (mirroring EditorPane), so the
// join is exercised end-to-end, not stubbed.
//
// WHAT IS PROVEN
//   1. ATOM SHAPE — every surface inserts a citation node whose attrs are
//      `{citationId: <minted>, command: <\cite…>, displayText: ""}`.
//   2. CARD REGISTRATION — every surface calls `createCitation` exactly once,
//      with `{citationId: <same as the atom>, command, unanchored:false,
//      mode:"omni"}` — so the card is anchored to the atom + soft-routed.
//   3. THE BUG FIX — typed `\cite{key}` now creates a card (it made NONE before
//      CHIP 4a-ii). Explicitly asserted.
//   4. ATOM DURABILITY — with the card host unmounted (bridge handle cleared),
//      slash + typed STILL insert the atom (and don't throw); only the card is
//      skipped. The PM-synchronous insert is the robustness feature.
//   5. SOFT-ROUTE — slash/typed surface OMNI only when the citations side is
//      collapsed/blank; never when another panel covers it (backlog #2). The
//      EXACT prefs-inspecting route now lives inside `citation.run`.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the
// same gotcha as the sibling action tests.)
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
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type ActionRef,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import {
  setEditorActionsHandle,
  getEditorActionsHandle,
} from "@/lib/actions/editor-actions-bridge";
import { buildFloatKey } from "@/floats/float-key";
import { paragraphUuidAt } from "@/links/links";
import type { ViewPrefs } from "@/hooks/useViewPrefs";

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

/** Mount a real main editor whose single paragraph (uuid "para-A") holds the
 *  given text, with the caret placed at `caretOffset` inside it (1-based doc
 *  pos = 1 + caretOffset). */
function mountEditor(text: string, caretOffset = text.length): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: text ? [{ type: "text", text }] : [],
        },
      ],
    },
  });
  const pos = 1 + caretOffset;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
  return editor;
}

/** Collect every citation atom in the doc as `{citationId, command, displayText}`. */
function citationAtoms(editor: Editor): Array<{
  citationId: string;
  command: string;
  displayText: string;
}> {
  const out: Array<{ citationId: string; command: string; displayText: string }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") {
      out.push({
        citationId: node.attrs.citationId as string,
        command: node.attrs.command as string,
        displayText: node.attrs.displayText as string,
      });
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// A real bridge handle (mirrors EditorPane's publish effect) wired to spies
// ---------------------------------------------------------------------------

let createCitation: ReturnType<typeof vi.fn>;
let setActiveLeft: ReturnType<typeof vi.fn>;
let setActiveRight: ReturnType<typeof vi.fn>;
let expandLeft: ReturnType<typeof vi.fn>;
let expandRight: ReturnType<typeof vi.fn>;
let clearBlankIfSet: ReturnType<typeof vi.fn>;
let focusCard: ReturnType<typeof vi.fn>;

/** A prefs object with the citations panel docked on `side`, in one of three
 *  visibility states for that side (backlog #2 band-stack model):
 *   - "collapsed" ⇒ the column is folded away; soft-route un-collapses it.
 *   - "blank"     ⇒ the "show nothing" overlay is set; soft-route clears it.
 *   - "shown"     ⇒ omni is already visible behind any docked bands; no-op.
 *  The OTHER side is always "shown" so a soft-route never touches it. */
function prefsWith(
  side: "left" | "right",
  state: "collapsed" | "blank" | "shown",
): ViewPrefs {
  return {
    placements: [{ id: "citations", side }],
    dockStack: { left: [], right: [] },
    collapsedLeft: side === "left" && state === "collapsed",
    collapsedRight: side === "right" && state === "collapsed",
    blankLeft: side === "left" && state === "blank",
    blankRight: side === "right" && state === "blank",
  } as unknown as ViewPrefs;
}

/** Publish a bridge handle EXACTLY like EditorPane: synthesize a CursorRef from
 *  the live selection head, build the ActionContext with the spy cardCreation +
 *  panelRouting, invoke `spec.run(ctx)`. */
function publishHandle(editor: Editor, prefs: ViewPrefs): void {
  const handle: EditorActionsHandle = {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return;
      const pos = editor.state.selection.head;
      const ref: CursorRef = {
        kind: "cursor",
        pos,
        paragraphId: paragraphUuidAt(editor.state.doc, pos) ?? "",
      };
      const ctx: ActionContext = {
        editor,
        view: editor.view,
        ref,
        surface: seed.surface,
        position: seed.position,
        cardCreation: { createCitation } as unknown as ActionContext["cardCreation"],
        payload: seed.payload,
        panelRouting: {
          prefs,
          setActiveLeft: setActiveLeft as (id: unknown) => void,
          setActiveRight: setActiveRight as (id: unknown) => void,
          expandLeft: expandLeft as () => void,
          expandRight: expandRight as () => void,
          clearBlankIfSet: clearBlankIfSet as () => void,
          focusCard: focusCard as (key: string) => void,
        } as unknown as ActionContext["panelRouting"],
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Drive the REAL typed input rule: simulate `text` being typed at the caret by
 *  invoking the citation plugin's `handleTextInput` through `view.someProp`. The
 *  doc already contains the command prefix (the handler reads `textBefore` from
 *  the doc + the typed char). */
function typeChar(editor: Editor, text: string): boolean {
  const { from } = editor.state.selection;
  // `someProp` walks every plugin's `handleTextInput` and STOPS at the first
  // one returning truthy (PM's own contract). Return the result so once the
  // citation rule handles + dispatches (shrinking the doc), no later plugin
  // (latex-comment, …) re-runs against the now-stale `from`.
  type TextInputHandler = (
    view: typeof editor.view,
    from: number,
    to: number,
    text: string,
  ) => boolean;
  const handled = editor.view.someProp("handleTextInput", (f) =>
    (f as TextInputHandler)(editor.view, from, from, text),
  );
  return !!handled;
}

beforeEach(() => {
  createCitation = vi.fn((opts: { citationId?: string }) => ({
    id: opts.citationId ?? "ref-id",
  }));
  setActiveLeft = vi.fn();
  setActiveRight = vi.fn();
  expandLeft = vi.fn();
  expandRight = vi.fn();
  clearBlankIfSet = vi.fn();
  focusCard = vi.fn();
});

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) Slash `\cite` — commands.ts cite action + the published bridge
// ---------------------------------------------------------------------------

describe("slash \\cite", () => {
  it("inserts the \\cite{} atom AND registers an anchored card via the bridge", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("right", "shown"));

    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");

    const atoms = citationAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].command).toBe("\\cite{}");
    expect(atoms[0].displayText).toBe("");
    expect(atoms[0].citationId).toBeTruthy();

    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation).toHaveBeenCalledWith({
      command: "\\cite{}",
      citationId: atoms[0].citationId,
      unanchored: false,
      mode: "omni",
    });
    // focus drops into the card's library-picker via the canonical float key.
    expect(focusCard).toHaveBeenCalledWith(
      buildFloatKey({ domain: "card", kind: "citation", id: atoms[0].citationId }),
    );
  });
});

// ---------------------------------------------------------------------------
// (2) Typed `\cite{key}` — the FULL input rule. THE BUG FIX: now makes a card.
// ---------------------------------------------------------------------------

describe("typed \\cite{key} (full)", () => {
  it("inserts the FULL-command atom AND — the fix — registers a card", () => {
    // Paragraph already holds "\cite{smith" with the caret at the end; typing
    // the closing "}" completes CITE_RE_FULL.
    const editor = mountEditor("\\cite{smith}".slice(0, -1)); // "\cite{smith"
    publishHandle(editor, prefsWith("right", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);

    const atoms = citationAtoms(editor);
    expect(atoms).toHaveLength(1);
    // The FULL typed command is preserved on the atom (NOT collapsed to \cite{}).
    expect(atoms[0].command).toBe("\\cite{smith}");
    expect(atoms[0].displayText).toBe("");
    expect(atoms[0].citationId).toBeTruthy();

    // THE FIX — a card is registered (previously typed \cite{key} made NONE).
    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation).toHaveBeenCalledWith({
      command: "\\cite{smith}",
      citationId: atoms[0].citationId,
      unanchored: false,
      mode: "omni",
    });
  });
});

// ---------------------------------------------------------------------------
// (3) Typed `\cite ` — the BARE input rule.
// ---------------------------------------------------------------------------

describe("typed \\cite  (bare)", () => {
  it("inserts an empty \\cite{} atom AND registers a card", () => {
    const editor = mountEditor("\\cite"); // caret after "\cite"; type a space
    publishHandle(editor, prefsWith("right", "shown"));

    const handled = typeChar(editor, " ");
    expect(handled).toBe(true);

    const atoms = citationAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].command).toBe("\\cite{}");
    expect(atoms[0].displayText).toBe("");

    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation).toHaveBeenCalledWith({
      command: "\\cite{}",
      citationId: atoms[0].citationId,
      unanchored: false,
      mode: "omni",
    });
  });
});

// ---------------------------------------------------------------------------
// (4) Menu (grab / lightning) — citation.run delegates to the dispatcher.
//     The grab/lightning behavior is byte-identical to today (it routes
//     through `ctx.dispatch("citation", ref)`), so the card + atom land via the
//     SAME dispatcher case the menu always used. Here we assert the delegation
//     edge directly (a DragHandleRef → dispatch), since driving the full React
//     dispatcher needs the EditorHandle; the dispatcher itself is unchanged.
// ---------------------------------------------------------------------------

describe("menu (grab/lightning) citation", () => {
  it("delegates a DragHandleRef to ctx.dispatch('citation', ref) (unchanged path)", () => {
    const dispatch = vi.fn();
    const ref: ActionRef = { kind: "paragraph", id: "para-A" };
    const ctx = {
      ref,
      surface: "grab",
      dispatch,
    } as unknown as ActionContext;
    VIRGIL_ACTION_REGISTRY.citation!.run(ctx);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("citation", ref);
    // The cursor-surface card-creation path is NOT taken for a DragHandleRef.
    expect(createCitation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (5) Atom durability — host unmounted (bridge handle cleared)
// ---------------------------------------------------------------------------

describe("atom lands even when the card host is unmounted", () => {
  it("slash \\cite still inserts the atom (no card, no throw)", () => {
    const editor = mountEditor("");
    setEditorActionsHandle(null); // host unmounted — getEditorActionsHandle() → null

    expect(() => COMMAND_MAP.get("cite")!.action(editor.view, "\\cite")).not.toThrow();

    const atoms = citationAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].command).toBe("\\cite{}");
    expect(createCitation).not.toHaveBeenCalled();
  });

  it("typed \\cite{key} still inserts the atom (no card, no throw)", () => {
    const editor = mountEditor("\\cite{jones}".slice(0, -1));
    setEditorActionsHandle(null);

    expect(() => typeChar(editor, "}")).not.toThrow();

    const atoms = citationAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].command).toBe("\\cite{jones}");
    expect(createCitation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (6) Cross-surface CONSISTENCY — the four surfaces agree on atom + card shape
// ---------------------------------------------------------------------------

describe("cross-surface consistency", () => {
  it("slash and bare-typed produce the SAME atom + createCitation shape", () => {
    // slash
    const e1 = mountEditor("");
    publishHandle(e1, prefsWith("right", "shown"));
    COMMAND_MAP.get("cite")!.action(e1.view, "\\cite");
    const slashAtom = citationAtoms(e1)[0];
    const slashCall = createCitation.mock.calls[0][0];

    // reset spies + DOM, then bare-typed
    createCitation.mockClear();
    const e2 = mountEditor("\\cite");
    publishHandle(e2, prefsWith("right", "shown"));
    typeChar(e2, " ");
    const typedAtom = citationAtoms(e2)[0];
    const typedCall = createCitation.mock.calls[0][0];

    // Atom shape identical except the minted id.
    expect(typedAtom.command).toBe(slashAtom.command); // "\cite{}"
    expect(typedAtom.displayText).toBe(slashAtom.displayText); // ""
    // createCitation shape identical except the minted id.
    expect({ ...typedCall, citationId: "_" }).toEqual({ ...slashCall, citationId: "_" });
    expect(typedCall.citationId).toBe(typedAtom.citationId);
    expect(slashCall.citationId).toBe(slashAtom.citationId);
  });
});

// ---------------------------------------------------------------------------
// (7) backlog #2 soft-route — in the band-stack model omni is the always-on
//     background, so `setActiveX("omni")` is gone. The soft-route REVEALS omni
//     only when the citations side is HIDDEN: un-collapse a collapsed side, or
//     un-blank a blanked side. An already-shown side is a no-op (omni's already
//     behind any docked bands), and the OTHER side is never touched.
// ---------------------------------------------------------------------------

describe("soft-route into omni (backlog #2)", () => {
  function runSlash(prefs: ViewPrefs): void {
    const editor = mountEditor("");
    publishHandle(editor, prefs);
    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");
  }

  it("un-collapses the RIGHT side when the citations (right) side is collapsed", () => {
    runSlash(prefsWith("right", "collapsed"));
    expect(expandRight).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("clears the blank when the citations side is blank", () => {
    runSlash(prefsWith("right", "blank"));
    expect(clearBlankIfSet).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
  });

  it("leaves the side ALONE when it's already shown (omni already behind any bands)", () => {
    runSlash(prefsWith("right", "shown"));
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("respects a LEFT dock placement for the citations panel", () => {
    runSlash(prefsWith("left", "collapsed"));
    expect(expandLeft).toHaveBeenCalledTimes(1);
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });
});
