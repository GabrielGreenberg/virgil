// @vitest-environment jsdom
//
// The CITATION cross-surface proof — UPDATED for the deferred create popover.
//
// THE MODEL: the explicit "create citation" surfaces (slash `\cite`, menu
// grab/lightning) no longer land a blank `\cite{}` atom + pristine card up
// front. They OPEN the deferred create popover (`citation.run` →
// `ctx.openAtomCreate("citation")`); the popover stages citekeys and, on commit
// (OK / click-away with ≥1 key), inserts the real atom + calls `citation.run`
// AGAIN with a `{citationId, command}` payload — the COMMIT half — which
// registers the anchored card + soft-routes. The TYPED LaTeX surfaces stay
// atom-first (the user typed the exact command, key and all): `\cite{key}`
// (full) and `\cite ` / `\citep ` (bare) still insert synchronously + register
// the card via a payload, preserving the typed command verbatim.
//
// This drives the REAL editor stack (the actual `commands.ts` slash action +
// the actual `citation.ts` typed input rules + the real `buildEditorExtensions`
// schema) with a REAL published bridge handle (mirroring EditorPane).
//
// WHAT IS PROVEN
//   1. SLASH `\cite` OPENS THE POPOVER — `openAtomCreate("citation")` fires;
//      NO atom + NO card land at the trigger (deferred to commit).
//   2. TYPED `\cite{key}` / `\cite ` — atom-first, command preserved, card
//      registered via the payload (COMMIT half) — unchanged.
//   3. POPOVER COMMIT — `citation.run` WITH a `{citationId, command}` payload
//      registers the card (`createCitation({…unanchored:false, mode:"omni"})`)
//      + focuses + soft-routes. This is the unified destination.
//   4. DURABILITY — typed insert lands the atom even with the card host
//      unmounted; slash with no host no-ops cleanly (no atom, no throw).
//   5. SOFT-ROUTE — the COMMIT surfaces OMNI only when the citations side is
//      collapsed/blank (backlog #2). The prefs-inspecting route lives in
//      `citation.run`'s commit branch.
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
let openAtomCreate: ReturnType<typeof vi.fn>;
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
        cardCreation: { createCitation } as unknown as ActionContext["cardCreation"],
        openAtomCreate: openAtomCreate as ActionContext["openAtomCreate"],
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
      // Task 061: mirror EditorPane's bridge — consult `applies()` and no-op on
      // "disabled" (e.g. the caret in a titleField for citation) BEFORE run().
      if (spec.applies(ctx) === "disabled") return;
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Mount a real main editor whose FIRST top-level block is `blockType`, holding
 *  `text`, with the caret at the END of that block's text — for the task-061
 *  per-kind applicability cases (caret in a titleField / codeBlock). A trailing
 *  empty paragraph keeps the doc schema-valid. */
function mountInBlock(
  blockType: "titleField" | "codeBlock",
  text: string,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const block =
    blockType === "titleField"
      ? {
          type: "titleField",
          attrs: { field: "title", uuid: "title-A" },
          content: text ? [{ type: "text", text }] : [],
        }
      : {
          type: "codeBlock",
          attrs: { uuid: "code-A" },
          content: text ? [{ type: "text", text }] : [],
        };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        block,
        { type: "paragraph", attrs: { uuid: "para-A" }, content: [] },
      ],
    },
  });
  let caret: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (caret === null && node.type.name === blockType) {
      caret = pos + 1 + node.content.size;
    }
    return true;
  });
  if (caret === null) throw new Error(`no ${blockType} mounted`);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)),
  );
  return editor;
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
  openAtomCreate = vi.fn();
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
// (1) Slash `\cite` — opens the deferred create popover (no atom, no card)
// ---------------------------------------------------------------------------

describe("slash \\cite opens the create popover", () => {
  it("routes to openAtomCreate('citation') and lands NO atom + NO card", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("right", "shown"));

    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");

    // Deferred: nothing materializes at the trigger.
    expect(citationAtoms(editor)).toHaveLength(0);
    expect(createCitation).not.toHaveBeenCalled();
    // The front door opened instead.
    expect(openAtomCreate).toHaveBeenCalledTimes(1);
    expect(openAtomCreate).toHaveBeenCalledWith("citation");
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
  it("slash \\cite with no host no-ops cleanly (no atom, no throw)", () => {
    const editor = mountEditor("");
    setEditorActionsHandle(null); // host unmounted — getEditorActionsHandle() → null

    // Slash now only OPENS the popover via the bridge; with no bridge it no-ops
    // (and never inserted a blank atom in the first place — deferred model).
    expect(() => COMMAND_MAP.get("cite")!.action(editor.view, "\\cite")).not.toThrow();

    expect(citationAtoms(editor)).toHaveLength(0);
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
// (6) The POPOVER COMMIT — `citation.run` WITH a payload registers the card.
//     This is the unified destination both the popover commit and the typed
//     surfaces funnel through (the atom is already inserted; run() only does the
//     card registration + focus + soft-route).
// ---------------------------------------------------------------------------

describe("popover commit (citation.run with payload)", () => {
  it("registers the anchored card with the payload's id + command, and focuses it", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("right", "shown"));

    // Simulate the commit: the popover already inserted the atom; it calls
    // run() again carrying the citationId + the staged command.
    getEditorActionsHandle()!.runAction("citation", {
      surface: "slash",
      payload: { citationId: "cit-1", command: "\\cite{smith,jones}" },
    });

    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation).toHaveBeenCalledWith({
      command: "\\cite{smith,jones}",
      citationId: "cit-1",
      unanchored: false,
      mode: "omni",
    });
    expect(focusCard).toHaveBeenCalledWith(
      buildFloatKey({ domain: "card", kind: "citation", id: "cit-1" }),
    );
    // The popover owns the atom insert; run() itself lands none.
    expect(citationAtoms(editor)).toHaveLength(0);
    // It did NOT re-open the popover (a payload means commit, not front-door).
    expect(openAtomCreate).not.toHaveBeenCalled();
  });

  it("typed `\\cite{key}` and a popover commit register the SAME createCitation shape", () => {
    // typed full
    const e1 = mountEditor("\\cite{smith}".slice(0, -1));
    publishHandle(e1, prefsWith("right", "shown"));
    typeChar(e1, "}");
    const typedCall = createCitation.mock.calls[0][0];

    // reset + a popover commit carrying the same command
    createCitation.mockClear();
    const e2 = mountEditor("");
    publishHandle(e2, prefsWith("right", "shown"));
    getEditorActionsHandle()!.runAction("citation", {
      surface: "slash",
      payload: { citationId: typedCall.citationId, command: "\\cite{smith}" },
    });
    const commitCall = createCitation.mock.calls[0][0];

    expect(commitCall).toEqual(typedCall);
  });
});

// ---------------------------------------------------------------------------
// (7) backlog #2 soft-route — fires on the COMMIT (run with payload), where the
//     card is actually registered. In the band-stack model omni is the always-on
//     background, so the soft-route REVEALS omni only when the citations side is
//     HIDDEN: un-collapse a collapsed side, or un-blank a blanked side. An
//     already-shown side is a no-op, and the OTHER side is never touched.
// ---------------------------------------------------------------------------

describe("soft-route into omni (backlog #2)", () => {
  function runCommit(prefs: ViewPrefs): void {
    const editor = mountEditor("");
    publishHandle(editor, prefs);
    getEditorActionsHandle()!.runAction("citation", {
      surface: "slash",
      payload: { citationId: "cit-sr", command: "\\cite{a}" },
    });
  }

  it("un-collapses the RIGHT side when the citations (right) side is collapsed", () => {
    runCommit(prefsWith("right", "collapsed"));
    expect(expandRight).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("clears the blank when the citations side is blank", () => {
    runCommit(prefsWith("right", "blank"));
    expect(clearBlankIfSet).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
  });

  it("leaves the side ALONE when it's already shown (omni already behind any bands)", () => {
    runCommit(prefsWith("right", "shown"));
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("respects a LEFT dock placement for the citations panel", () => {
    runCommit(prefsWith("left", "collapsed"));
    expect(expandLeft).toHaveBeenCalledTimes(1);
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (Task 061) Per-kind applicability across surfaces — a citation atom must NOT
// land where the curated set greys `citation` out (titleField / non-prose
// block). The gate is the SAME `TEXT_OBJECT_REGISTRY[kind].actions` set the
// grab-bar consults, resolved from the caret's containing block kind. Proves
// the negative contract for the TYPED and SLASH surfaces + the positive (prose)
// control, so the fix can't over-refuse.
// ---------------------------------------------------------------------------

describe("task 061 — citation applicability is per containing-block kind", () => {
  it("TYPED \\cite{key} in a titleField is a NO-OP (no atom, no card)", () => {
    const editor = mountInBlock("titleField", "\\cite{smith}".slice(0, -1));
    publishHandle(editor, prefsWith("right", "shown"));

    const handled = typeChar(editor, "}");
    // The input rule declines — no citation recognized in a title.
    expect(handled).toBe(false);
    expect(citationAtoms(editor)).toHaveLength(0);
    expect(createCitation).not.toHaveBeenCalled();
  });

  it("TYPED \\cite{key} in a codeBlock is a NO-OP (no atom, no throw)", () => {
    const editor = mountInBlock("codeBlock", "\\cite{smith}".slice(0, -1));
    publishHandle(editor, prefsWith("right", "shown"));

    let handled = true;
    expect(() => {
      handled = typeChar(editor, "}");
    }).not.toThrow();
    expect(handled).toBe(false);
    expect(citationAtoms(editor)).toHaveLength(0);
    expect(createCitation).not.toHaveBeenCalled();
  });

  it("SLASH \\cite in a titleField is a NO-OP (popover never opens)", () => {
    const editor = mountInBlock("titleField", "");
    publishHandle(editor, prefsWith("right", "shown"));

    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");

    expect(openAtomCreate).not.toHaveBeenCalled();
    expect(citationAtoms(editor)).toHaveLength(0);
    expect(createCitation).not.toHaveBeenCalled();
  });

  it("SLASH \\cite in a codeBlock is a NO-OP (popover never opens)", () => {
    const editor = mountInBlock("codeBlock", "");
    publishHandle(editor, prefsWith("right", "shown"));

    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");

    expect(openAtomCreate).not.toHaveBeenCalled();
    expect(citationAtoms(editor)).toHaveLength(0);
  });

  it("POSITIVE control — TYPED \\cite{key} in a prose paragraph still inserts + registers", () => {
    // Same block-kind gate must NOT over-refuse the prose case.
    const editor = mountEditor("\\cite{smith}".slice(0, -1));
    publishHandle(editor, prefsWith("right", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);
    expect(citationAtoms(editor)).toHaveLength(1);
    expect(createCitation).toHaveBeenCalledTimes(1);
  });

  it("POSITIVE control — SLASH \\cite in a prose paragraph still opens the popover", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("right", "shown"));

    COMMAND_MAP.get("cite")!.action(editor.view, "\\cite");
    expect(openAtomCreate).toHaveBeenCalledTimes(1);
    expect(openAtomCreate).toHaveBeenCalledWith("citation");
  });
});
