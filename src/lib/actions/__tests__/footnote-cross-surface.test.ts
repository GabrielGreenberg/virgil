// @vitest-environment jsdom
//
// CHIP 4b — the FOOTNOTE cross-surface alignment proof.
//
// THE GOAL (MEMO_ACTION_ALIGNMENT.md §3 footnote row + §4 settled decision): a
// footnote created from any of the four surfaces — menu (grab/lightning), slash
// `\footnote`, typed `\footnote{}` / `\footnote{body}` — must land at the SAME
// destination: a footnote inline atom in the doc AND a registered footnote CARD
// via `cardCreation.createFootnote`, with the SAME pristine + pinned lifecycle.
// This file drives the REAL editor stack (the actual `commands.ts` slash action
// + the actual `footnote.ts` typed input rule + the real `buildEditorExtensions`
// schema) with a REAL published bridge handle (mirroring EditorPane), so the
// join is exercised end-to-end, not stubbed.
//
// WHAT IS PROVEN
//   1. ATOM — every surface inserts EXACTLY ONE footnote node (no double-insert
//      — the wrinkle the chip had to resolve: `createFootnote` would normally
//      insert the atom itself, but the slash/typed PM caller already inserted
//      it, so the registry ADOPTS the existing id instead of re-inserting).
//   2. CARD REGISTRATION — every PM surface calls `createFootnote` exactly once
//      with `{existingFootnoteId: <same as the atom>, pristine, mode:"omni"}`.
//   3. PRISTINE — slash `\footnote` (empty body) + typed `\footnote{}` (empty)
//      register pristine:true (blank → click-away-discardable, matching the
//      menu); typed `\footnote{body}` registers pristine:false (real content
//      must NOT be reaped on click-away). This is the alignment fix: slash/typed
//      were NOT pristine+pinned before CHIP 4b.
//   4. ATOM DURABILITY — with the card host unmounted (bridge handle cleared),
//      slash + typed STILL insert the atom (and don't throw); only the card is
//      skipped. The PM-synchronous insert is the robustness feature.
//   5. SOFT-ROUTE — slash/typed surface OMNI only when the footnotes side is
//      collapsed/blank; never when another panel covers it (backlog #2). The
//      prefs-inspecting route lives inside `footnote.run`.
//   6. RETIRED PLUMBING — `virgil-footnote-created` has ZERO emitters AND ZERO
//      listeners after this chip (asserted by a source-free runtime probe: the
//      input rule + slash no longer dispatch it).
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
 *  given text, caret at `caretOffset` (1-based doc pos = 1 + caretOffset). */
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

/** Collect every footnote atom in the doc as `{footnoteId}`. */
function footnoteAtoms(editor: Editor): Array<{ footnoteId: string }> {
  const out: Array<{ footnoteId: string }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") {
      out.push({ footnoteId: node.attrs.footnoteId as string });
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// A real bridge handle (mirrors EditorPane's publish effect) wired to spies.
// `createFootnote` is the spy; it must NOT re-insert (the adopt path), so the
// spy just records the call and returns a result.
// ---------------------------------------------------------------------------

let createFootnote: ReturnType<typeof vi.fn>;
let setActiveLeft: ReturnType<typeof vi.fn>;
let setActiveRight: ReturnType<typeof vi.fn>;
let expandLeft: ReturnType<typeof vi.fn>;
let expandRight: ReturnType<typeof vi.fn>;
let clearBlankIfSet: ReturnType<typeof vi.fn>;
let focusCard: ReturnType<typeof vi.fn>;

/** A prefs object with the footnotes panel docked on `side`, in one of three
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
    placements: [{ id: "footnotes", side }],
    dockStack: { left: [], right: [] },
    collapsedLeft: side === "left" && state === "collapsed",
    collapsedRight: side === "right" && state === "collapsed",
    blankLeft: side === "left" && state === "blank",
    blankRight: side === "right" && state === "blank",
  } as unknown as ViewPrefs;
}

/** Publish a bridge handle EXACTLY like EditorPane. */
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
        cardCreation: { createFootnote } as unknown as ActionContext["cardCreation"],
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
      // "disabled" (e.g. the caret in a codeBlock for footnote) BEFORE run().
      if (spec.applies(ctx) === "disabled") return;
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Mount a real main editor whose FIRST top-level block is `blockType`, holding
 *  `text`, with the caret at the END of that block's text — for the task-061
 *  per-kind applicability cases. A trailing empty paragraph keeps the doc
 *  schema-valid. */
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

/** Drive the REAL typed input rule: invoke the footnote plugin's
 *  `handleTextInput` via `view.someProp` (stops at the first truthy handler). */
function typeChar(editor: Editor, text: string): boolean {
  const { from } = editor.state.selection;
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
  // The adopt-path spy: returns a result, does NOT touch the doc.
  createFootnote = vi.fn((opts: { existingFootnoteId?: string }) => ({
    footnoteId: opts.existingFootnoteId ?? "fn-id",
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
// (1) Slash `\footnote` — commands.ts footnote action + the published bridge
// ---------------------------------------------------------------------------

describe("slash \\footnote", () => {
  it("inserts EXACTLY ONE footnote atom AND adopts it via the bridge (pristine)", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("left", "shown"));

    COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote");

    // Exactly one atom — NO double-insert (the adopt path doesn't re-insert).
    const atoms = footnoteAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].footnoteId).toBeTruthy();

    // Card registered once, ADOPTING the atom's id (pristine — empty body).
    expect(createFootnote).toHaveBeenCalledTimes(1);
    expect(createFootnote).toHaveBeenCalledWith({
      existingFootnoteId: atoms[0].footnoteId,
      pristine: true,
      mode: "omni",
    });
    // CHIP B: caret-into-body focus is now owned by the central `finishCreate`
    // chokepoint (which the real `createFootnote` runs — footnote is an
    // editable-body kind), NOT by `footnoteRun` plumbing. So `footnoteRun` no
    // longer calls `panelRouting.focusCard` for footnote; the focus contract is
    // proven at the `createFootnote` boundary above (+ in the dedicated
    // finish-create-autofocus test).
    expect(focusCard).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (2) Typed `\footnote{body}` — the FULL input rule (body present → NOT pristine)
// ---------------------------------------------------------------------------

describe("typed \\footnote{body} (with content)", () => {
  it("inserts ONE atom AND registers a NON-pristine card (body must not be reaped)", () => {
    // Paragraph holds "\footnote{hello" with caret at end; typing "}" completes.
    const editor = mountEditor("\\footnote{hello}".slice(0, -1)); // "\footnote{hello"
    publishHandle(editor, prefsWith("left", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);

    const atoms = footnoteAtoms(editor);
    expect(atoms).toHaveLength(1);
    expect(atoms[0].footnoteId).toBeTruthy();

    expect(createFootnote).toHaveBeenCalledTimes(1);
    // Body present ⇒ pristine:false (a typed-prose footnote is NOT discardable).
    expect(createFootnote).toHaveBeenCalledWith({
      existingFootnoteId: atoms[0].footnoteId,
      pristine: false,
      mode: "omni",
    });
  });
});

// ---------------------------------------------------------------------------
// (3) Typed `\footnote{}` — the FULL input rule, EMPTY body → pristine
// ---------------------------------------------------------------------------

describe("typed \\footnote{} (empty)", () => {
  it("inserts ONE atom AND registers a PRISTINE card (blank → discardable)", () => {
    const editor = mountEditor("\\footnote{}".slice(0, -1)); // "\footnote{"
    publishHandle(editor, prefsWith("left", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);

    const atoms = footnoteAtoms(editor);
    expect(atoms).toHaveLength(1);

    expect(createFootnote).toHaveBeenCalledTimes(1);
    expect(createFootnote).toHaveBeenCalledWith({
      existingFootnoteId: atoms[0].footnoteId,
      pristine: true,
      mode: "omni",
    });
  });
});

// ---------------------------------------------------------------------------
// (4) Menu (grab / lightning) — footnote.run delegates to the dispatcher.
//     Byte-identical to today (routes through `ctx.dispatch("footnote", ref)`).
// ---------------------------------------------------------------------------

describe("menu (grab/lightning) footnote", () => {
  it("delegates a DragHandleRef to ctx.dispatch('footnote', ref) (unchanged path)", () => {
    const dispatch = vi.fn();
    const ref: ActionRef = { kind: "paragraph", id: "para-A" };
    const ctx = {
      ref,
      surface: "grab",
      dispatch,
    } as unknown as ActionContext;
    VIRGIL_ACTION_REGISTRY.footnote!.run(ctx);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith("footnote", ref);
    // The cursor-surface card-creation path is NOT taken for a DragHandleRef.
    expect(createFootnote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (5) Atom durability — host unmounted (bridge handle cleared)
// ---------------------------------------------------------------------------

describe("atom lands even when the card host is unmounted", () => {
  it("slash \\footnote still inserts the atom (no card, no throw)", () => {
    const editor = mountEditor("");
    setEditorActionsHandle(null); // host unmounted — getEditorActionsHandle() → null

    expect(() =>
      COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote"),
    ).not.toThrow();

    expect(footnoteAtoms(editor)).toHaveLength(1);
    expect(createFootnote).not.toHaveBeenCalled();
  });

  it("typed \\footnote{body} still inserts the atom (no card, no throw)", () => {
    const editor = mountEditor("\\footnote{x}".slice(0, -1));
    setEditorActionsHandle(null);

    expect(() => typeChar(editor, "}")).not.toThrow();

    expect(footnoteAtoms(editor)).toHaveLength(1);
    expect(createFootnote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (6) NO double-insert — explicit. The whole-chip wrinkle: the PM caller
//     inserts the atom AND routes to createFootnote; if createFootnote ALSO
//     inserted, there'd be two. The spy proves the registry never asks the
//     real `createEmptyFootnote` to fire — it passes `existingFootnoteId`.
// ---------------------------------------------------------------------------

describe("no double-insert", () => {
  it("createFootnote is called with existingFootnoteId (adopt — never re-inserts)", () => {
    const editor = mountEditor("");
    publishHandle(editor, prefsWith("left", "shown"));
    COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote");

    expect(footnoteAtoms(editor)).toHaveLength(1);
    const call = createFootnote.mock.calls[0][0];
    expect(call.existingFootnoteId).toBe(footnoteAtoms(editor)[0].footnoteId);
    // The adopt key is present (so the real createFootnote skips the insert);
    // fromSelection is NOT set (that path WOULD insert).
    expect(call.fromSelection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (7) backlog #2 soft-route — in the band-stack model omni is the always-on
//     background, so `setActiveX("omni")` is gone. The soft-route REVEALS omni
//     only when the footnotes side is HIDDEN: un-collapse a collapsed side, or
//     un-blank a blanked side. An already-shown side is a no-op (omni's already
//     behind any docked bands), the OTHER side is never touched, and the
//     dedicated Footnotes panel is never force-opened.
// ---------------------------------------------------------------------------

describe("soft-route into omni (backlog #2)", () => {
  function runSlash(prefs: ViewPrefs): void {
    const editor = mountEditor("");
    publishHandle(editor, prefs);
    COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote");
  }

  it("un-collapses the LEFT side when the footnotes (left) side is collapsed", () => {
    runSlash(prefsWith("left", "collapsed"));
    expect(expandLeft).toHaveBeenCalledTimes(1);
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("clears the blank when the footnotes side is blank", () => {
    runSlash(prefsWith("left", "blank"));
    expect(clearBlankIfSet).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
  });

  it("leaves the side ALONE when it's already shown (omni already behind any bands)", () => {
    runSlash(prefsWith("left", "shown"));
    expect(expandLeft).not.toHaveBeenCalled();
    expect(expandRight).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("respects a RIGHT dock placement for the footnotes panel", () => {
    runSlash(prefsWith("right", "collapsed"));
    expect(expandRight).toHaveBeenCalledTimes(1);
    expect(expandLeft).not.toHaveBeenCalled();
    expect(clearBlankIfSet).not.toHaveBeenCalled();
  });

  it("never force-opens the dedicated Footnotes panel", () => {
    runSlash(prefsWith("left", "collapsed"));
    expect(setActiveLeft).not.toHaveBeenCalledWith("footnotes");
    expect(setActiveRight).not.toHaveBeenCalledWith("footnotes");
  });
});

// ---------------------------------------------------------------------------
// (8) RETIRED — `virgil-footnote-created` has zero emitters. Firing a real slash
//     `\footnote` + typed `\footnote{}` must NOT dispatch it (a listener-side
//     probe proves no emit reaches the window).
// ---------------------------------------------------------------------------

describe("virgil-footnote-created is retired (zero emitters)", () => {
  it("neither slash nor typed footnote dispatches the dead event", () => {
    const spy = vi.fn();
    window.addEventListener("virgil-footnote-created", spy);
    try {
      const e1 = mountEditor("");
      publishHandle(e1, prefsWith("left", "shown"));
      COMMAND_MAP.get("footnote")!.action(e1.view, "\\footnote");

      const e2 = mountEditor("\\footnote{}".slice(0, -1));
      publishHandle(e2, prefsWith("left", "shown"));
      typeChar(e2, "}");

      expect(spy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("virgil-footnote-created", spy);
    }
  });
});

// ---------------------------------------------------------------------------
// (Task 061) Per-kind applicability across surfaces. Footnote's curated set
// (unlike citation) PERMITS a titleField (TITLE_FIELD_ACTIONS keeps footnote)
// but a non-prose block (codeBlock) greys it out. So the contract is asymmetric
// from citation: refuse in codeBlock, ALLOW in a titleField, allow in prose.
// ---------------------------------------------------------------------------

describe("task 061 — footnote applicability is per containing-block kind", () => {
  it("TYPED \\footnote{body} in a codeBlock is a NO-OP (no atom, no throw)", () => {
    const editor = mountInBlock("codeBlock", "\\footnote{hello}".slice(0, -1));
    publishHandle(editor, prefsWith("left", "shown"));

    let handled = true;
    expect(() => {
      handled = typeChar(editor, "}");
    }).not.toThrow();
    expect(handled).toBe(false);
    expect(footnoteAtoms(editor)).toHaveLength(0);
    expect(createFootnote).not.toHaveBeenCalled();
  });

  it("SLASH \\footnote in a codeBlock is a NO-OP (no atom, no card)", () => {
    const editor = mountInBlock("codeBlock", "");
    publishHandle(editor, prefsWith("left", "shown"));

    COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote");

    expect(footnoteAtoms(editor)).toHaveLength(0);
    expect(createFootnote).not.toHaveBeenCalled();
  });

  it("POSITIVE — TYPED \\footnote{body} in a titleField IS allowed (footnote ∈ TITLE_FIELD_ACTIONS)", () => {
    const editor = mountInBlock("titleField", "\\footnote{hello}".slice(0, -1));
    publishHandle(editor, prefsWith("left", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);
    expect(footnoteAtoms(editor)).toHaveLength(1);
    expect(createFootnote).toHaveBeenCalledTimes(1);
  });

  it("POSITIVE — SLASH \\footnote in a titleField IS allowed (atom + card)", () => {
    const editor = mountInBlock("titleField", "");
    publishHandle(editor, prefsWith("left", "shown"));

    COMMAND_MAP.get("footnote")!.action(editor.view, "\\footnote");

    expect(footnoteAtoms(editor)).toHaveLength(1);
    expect(createFootnote).toHaveBeenCalledTimes(1);
  });

  it("POSITIVE — TYPED \\footnote{body} in a prose paragraph still inserts + registers", () => {
    const editor = mountEditor("\\footnote{hello}".slice(0, -1));
    publishHandle(editor, prefsWith("left", "shown"));

    const handled = typeChar(editor, "}");
    expect(handled).toBe(true);
    expect(footnoteAtoms(editor)).toHaveLength(1);
    expect(createFootnote).toHaveBeenCalledTimes(1);
  });
});
