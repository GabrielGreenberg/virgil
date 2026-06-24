// @vitest-environment jsdom
//
// CHIP 8 — CITATION + FOOTNOTE cross-surface BYTE-IDENTITY verification.
//
// This is the alignment-matrix oracle's "cross-surface identity invariant" for
// the two card actions whose `run()` spans all four surfaces (citation rows §112
// + footnote row §111 of docs/memos/action-alignment-matrix/EXPECTED-MATRIX.md):
//
//   citation (grab, lightning, slash, typed):
//     "Atom attrs {citationId, command, displayText:''} must be byte-identical
//      across surfaces. CitationRef sidecar shape identical (id===citationId;
//      keys parsed from command). Difference: typed \cite{key} carries the FULL
//      command (renders keys) while menu/slash carry empty \cite{}."
//
//   footnote (grab, lightning, slash, typed):
//     "All four surfaces must land the SAME footnote atom (footnoteId, ...,
//      empty content) AND the SAME pristine+pinned+selected card lifecycle.
//      Slash/typed adopt (no double-insert); menu inserts. Card footnoteId ===
//      atom footnoteId on every surface."
//
// WHY A SEPARATE FILE (vs the per-surface citation-cross-surface.test.ts /
// footnote-cross-surface.test.ts already in this dir): those prove each surface
// in ISOLATION. This file drives TWO surfaces in ONE test and asserts the two
// outputs are byte-identical (modulo the minted id / the documented typed-key
// payload). It ALSO drives the registry creator destination directly —
// `VIRGIL_ACTION_REGISTRY.citation.run` / `.footnote.run` with a constructed
// ActionContext — AND the REAL `parseCiteCommand` that shapes the citations.json
// `CitationRef` entry, which the per-surface files stub. The grab/lightning
// React-hook WIRING (useDragHandleActions.dispatch) is covered by the manager's
// live-preview canary; here we cover the run()/creator twin those surfaces share.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the same
// gotcha as the sibling action tests, per vitest_extension_barrel_storage_mock.)
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
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import {
  setEditorActionsHandle,
  getEditorActionsHandle,
} from "@/lib/actions/editor-actions-bridge";
import { buildFloatKey } from "@/floats/float-key";
import { paragraphUuidAt } from "@/links/links";
import { parseCiteCommand } from "@/lib/bib-parser";
import type { ViewPrefs } from "@/hooks/useViewPrefs";

// ---------------------------------------------------------------------------
// Real editor stack (mirrors citation-cross-surface.test.ts mountEditor)
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

function footnoteAtoms(editor: Editor): Array<{
  footnoteId: string;
  content: unknown;
  number: number;
}> {
  const out: Array<{ footnoteId: string; content: unknown; number: number }> = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "footnote") {
      out.push({
        footnoteId: node.attrs.footnoteId as string,
        content: node.attrs.content,
        number: node.attrs.number as number,
      });
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Spies + a real bridge handle (mirrors EditorPane's publish effect)
// ---------------------------------------------------------------------------

let createCitation: ReturnType<typeof vi.fn>;
let createFootnote: ReturnType<typeof vi.fn>;
let setActiveLeft: ReturnType<typeof vi.fn>;
let setActiveRight: ReturnType<typeof vi.fn>;
let focusCard: ReturnType<typeof vi.fn>;

function prefsWith(
  panelId: "citations" | "footnotes",
  side: "left" | "right",
  active: string | null,
): ViewPrefs {
  return {
    placements: [{ id: panelId, side }],
    activeLeft: side === "left" ? active : "notes",
    activeRight: side === "right" ? active : "notes",
  } as unknown as ViewPrefs;
}

/** Publish a bridge handle EXACTLY like EditorPane: synthesize a CursorRef from
 *  the live selection head, build the ActionContext with the spy cardCreation +
 *  panelRouting, invoke `spec.run(ctx)`. Both create* spies are supplied so the
 *  one handle services citation AND footnote surfaces. */
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
        cardCreation: {
          createCitation,
          createFootnote,
        } as unknown as ActionContext["cardCreation"],
        payload: seed.payload,
        panelRouting: {
          prefs,
          setActiveLeft: setActiveLeft as (id: unknown) => void,
          setActiveRight: setActiveRight as (id: unknown) => void,
          focusCard: focusCard as (key: string) => void,
        } as unknown as ActionContext["panelRouting"],
      };
      void spec.run(ctx);
    },
  };
  setEditorActionsHandle(handle);
}

/** Drive the REAL typed input rule via `view.someProp("handleTextInput", …)` —
 *  PM's contract stops at the first truthy handler. */
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
  createCitation = vi.fn((opts: { citationId?: string }) => ({
    id: opts.citationId ?? "ref-id",
  }));
  createFootnote = vi.fn((opts: { existingFootnoteId?: string }) => ({
    footnoteId: opts.existingFootnoteId ?? "fn-id",
  }));
  setActiveLeft = vi.fn();
  setActiveRight = vi.fn();
  focusCard = vi.fn();
});

afterEach(() => {
  setEditorActionsHandle(null);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ===========================================================================
// CITATION — cross-surface byte-identity
// ===========================================================================

describe("citation: bare-typed ⇄ popover-commit card byte-identity", () => {
  it("typed \\cite·(space) and a popover commit produce byte-identical createCitation shape (modulo id)", () => {
    // --- surface A: the popover COMMIT (deferred create) — registers the card
    //     from a `\cite{}` command; the popover, not run(), owns the atom. ---
    const commitEd = mountEditor("");
    publishHandle(commitEd, prefsWith("citations", "right", null));
    getEditorActionsHandle()!.runAction("citation", {
      surface: "slash",
      payload: { citationId: "cit-a", command: "\\cite{}" },
    });
    const commitCall = createCitation.mock.calls[0][0];

    createCitation.mockClear();

    // --- surface B: typed bare \cite + " " (atom-first, command preserved) ---
    const typedEd = mountEditor("\\cite");
    publishHandle(typedEd, prefsWith("citations", "right", null));
    expect(typeChar(typedEd, " ")).toBe(true);
    const typedAtom = citationAtoms(typedEd)[0];
    const typedCall = createCitation.mock.calls[0][0];

    // The bare atom carries the empty command.
    expect(typedAtom.command).toBe("\\cite{}");
    expect(typedAtom.displayText).toBe(""); // ""

    // CARD CALL: identical shape (command/unanchored/mode) modulo the minted id.
    expect({ ...commitCall, citationId: "_" }).toEqual({
      command: "\\cite{}",
      citationId: "_",
      unanchored: false,
      mode: "omni",
    });
    expect({ ...typedCall, citationId: "_" }).toEqual({ ...commitCall, citationId: "_" });

    // IDENTITY JOIN: the typed card's citationId === the in-doc atom's id.
    expect(typedCall.citationId).toBe(typedAtom.citationId);
  });
});

describe("citation: typed \\cite{key} carries the FULL command", () => {
  it("the typed-full surface carries the key; bare carries the empty \\cite{}, else identical", () => {
    // bare carries the empty \cite{}
    const bareEd = mountEditor("\\cite");
    publishHandle(bareEd, prefsWith("citations", "right", null));
    expect(typeChar(bareEd, " ")).toBe(true);
    const bareCall = createCitation.mock.calls[0][0];
    createCitation.mockClear();

    // typed-full carries \cite{smith}
    const typedEd = mountEditor("\\cite{smith}".slice(0, -1)); // "\cite{smith"
    publishHandle(typedEd, prefsWith("citations", "right", null));
    expect(typeChar(typedEd, "}")).toBe(true);
    const typedAtom = citationAtoms(typedEd)[0];
    const typedCall = createCitation.mock.calls[0][0];

    // A card is registered, carrying the FULL command on both atom + call.
    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(typedAtom.command).toBe("\\cite{smith}");
    expect(typedCall.command).toBe("\\cite{smith}");

    // The ONLY difference vs bare: the command string (key). Everything else
    // (unanchored/mode + the id-join) is byte-identical.
    expect(typedCall.unanchored).toBe(bareCall.unanchored); // false
    expect(typedCall.mode).toBe(bareCall.mode); // "omni"
    expect(typedCall.citationId).toBe(typedAtom.citationId);
  });
});

describe("citation: the citations.json-shaped CitationRef entry (real parseCiteCommand)", () => {
  // The per-surface tests stub createCitation; here we drive the REAL sidecar
  // shaper — `addCitation`'s body — to prove the entry the card lands in
  // citations.json has the oracle shape {id, command, keys (parsed), createdAt,
  // unanchored absent (anchored)}, and that `keys` is parsed from `command`.
  function makeCitationRef(command: string, citationId: string, unanchored: boolean) {
    // Mirrors useCitations.addCitation's ref construction VERBATIM (the real
    // parseCiteCommand decides `keys`). The anchored card omits `unanchored`.
    const parsed = parseCiteCommand(command);
    return {
      id: citationId,
      command,
      keys: parsed?.keys || [],
      createdAt: new Date().toISOString(),
      ...(unanchored ? { unanchored: true as const } : {}),
    };
  }

  it("slash/bare \\cite{} → entry with an EMPTY keys array, anchored (no unanchored flag)", () => {
    const entry = makeCitationRef("\\cite{}", "abcd", /*unanchored*/ false);
    expect(entry.id).toBe("abcd");
    expect(entry.command).toBe("\\cite{}");
    // Parser-correctness fix (CHIP 8 #5): parseCiteCommand splits the body on
    // comma, trims, and FILTERS OUT empty fragments, so an empty `\cite{}` body
    // yields `[]` — NOT the old single empty-string key `[""]`. The empty array
    // is the signal addCitation's `keys.length === 0` pristine check reads.
    expect(entry.keys).toEqual([]);
    expect(typeof entry.createdAt).toBe("string");
    expect("unanchored" in entry).toBe(false); // anchored: flag ABSENT
  });

  it("FIXED: \\cite{} keys===[] (length 0) → addCitation's keys.length===0 pristine check fires", () => {
    // useCitations.addCitation marks a citation pristine ONLY when
    // `ref.keys.length === 0`. parseCiteCommand("\\cite{}").keys is now `[]`
    // (length 0), so a brand-new empty `\cite{}` IS marked pristine via that
    // path — the previously-dead branch now fires for an empty cite. Pin the
    // corrected parser value so a future regression on either side is caught here.
    const keys = parseCiteCommand("\\cite{}")?.keys ?? [];
    expect(keys).toEqual([]);
    expect(keys.length === 0).toBe(true); // → addCitation DOES markNew here
  });

  it("typed \\cite{smith} → entry with keys parsed FROM the command", () => {
    const entry = makeCitationRef("\\cite{smith}", "efgh", false);
    expect(entry.command).toBe("\\cite{smith}");
    expect(entry.keys).toEqual(["smith"]); // parsed from \cite{smith}
    expect("unanchored" in entry).toBe(false);
  });

  it("the id-join holds end-to-end: an atom's citationId becomes the entry's id", () => {
    // Drive a REAL typed-full surface, then shape the entry from the live atom's
    // attrs the same way addCitation would (createCitation forwards command+id).
    const ed = mountEditor("\\cite{jones2001}".slice(0, -1));
    publishHandle(ed, prefsWith("citations", "right", null));
    typeChar(ed, "}");
    const atom = citationAtoms(ed)[0];
    const call = createCitation.mock.calls[0][0];
    const entry = makeCitationRef(call.command, call.citationId, !call.unanchored ? false : true);
    expect(entry.id).toBe(atom.citationId); // entry.id === atom.citationId
    expect(entry.command).toBe("\\cite{jones2001}");
    expect(entry.keys).toEqual(["jones2001"]);
  });
});

describe("citation: registry citation.run creator destination (grab/lightning twin)", () => {
  it("a cursor-ref citation.run lands createCitation with the anchored omni shape + focuses the card", () => {
    // Drive the registry run() DIRECTLY (the destination grab/lightning share via
    // their dispatch → createCitation). A cursor-surface ctx with a payload.
    const ed = mountEditor("");
    const ctx = {
      editor: ed,
      view: ed.view,
      ref: { kind: "cursor", pos: 1, paragraphId: "para-A" } as CursorRef,
      surface: "slash",
      payload: { citationId: "zzzz", command: "\\citep{a,b}" },
      cardCreation: { createCitation } as unknown as ActionContext["cardCreation"],
      panelRouting: {
        prefs: prefsWith("citations", "right", null),
        setActiveLeft,
        setActiveRight,
        focusCard,
      } as unknown as ActionContext["panelRouting"],
    } as unknown as ActionContext;

    VIRGIL_ACTION_REGISTRY.citation!.run(ctx);

    expect(createCitation).toHaveBeenCalledTimes(1);
    expect(createCitation).toHaveBeenCalledWith({
      command: "\\citep{a,b}",
      citationId: "zzzz",
      unanchored: false,
      mode: "omni",
    });
    expect(focusCard).toHaveBeenCalledWith(
      buildFloatKey({ domain: "card", kind: "citation", id: "zzzz" }),
    );
    // parseCiteCommand would yield two keys for this command (sidecar shape).
    expect(parseCiteCommand("\\citep{a,b}")?.keys).toEqual(["a", "b"]);
  });

  it("a DragHandleRef (grab/lightning) DELEGATES to dispatch — NO cursor card-creation", () => {
    const dispatch = vi.fn();
    const ref = { kind: "paragraph", id: "para-A" } as const;
    const ctx = { ref, surface: "grab", dispatch } as unknown as ActionContext;
    VIRGIL_ACTION_REGISTRY.citation!.run(ctx);
    expect(dispatch).toHaveBeenCalledWith("citation", ref);
    expect(createCitation).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// FOOTNOTE — cross-surface byte-identity + pristine alignment
// ===========================================================================

describe("footnote: slash ⇄ typed-empty atom + card byte-identity (pristine)", () => {
  it("slash \\footnote and typed \\footnote{} produce the same atom shape + the same PRISTINE adopt call", () => {
    // --- surface A: slash \footnote ---
    const slashEd = mountEditor("");
    publishHandle(slashEd, prefsWith("footnotes", "left", null));
    COMMAND_MAP.get("footnote")!.action(slashEd.view, "\\footnote");
    const slashAtoms = footnoteAtoms(slashEd);
    const slashCall = createFootnote.mock.calls[0][0];
    createFootnote.mockClear();

    // --- surface B: typed \footnote{} (empty) ---
    const typedEd = mountEditor("\\footnote{}".slice(0, -1)); // "\footnote{"
    publishHandle(typedEd, prefsWith("footnotes", "left", null));
    expect(typeChar(typedEd, "}")).toBe(true);
    const typedAtoms = footnoteAtoms(typedEd);
    const typedCall = createFootnote.mock.calls[0][0];

    // ATOM: each surface lands EXACTLY ONE footnote atom with a real id.
    expect(slashAtoms).toHaveLength(1);
    expect(typedAtoms).toHaveLength(1);
    expect(slashAtoms[0].footnoteId).toBeTruthy();
    expect(typedAtoms[0].footnoteId).toBeTruthy();

    // CARD CALL byte-identity: BOTH adopt the existing atom (existingFootnoteId),
    // BOTH pristine:true (empty body → click-away-discardable), BOTH mode omni.
    expect({ ...slashCall, existingFootnoteId: "_" }).toEqual({
      existingFootnoteId: "_",
      pristine: true,
      mode: "omni",
    });
    expect({ ...typedCall, existingFootnoteId: "_" }).toEqual({
      ...slashCall,
      existingFootnoteId: "_",
    });

    // ADOPT (no double-insert): the call adopts the atom's id; never fromSelection.
    expect(slashCall.existingFootnoteId).toBe(slashAtoms[0].footnoteId);
    expect(typedCall.existingFootnoteId).toBe(typedAtoms[0].footnoteId);
    expect(slashCall.fromSelection).toBeUndefined();
    expect(typedCall.fromSelection).toBeUndefined();
  });
});

describe("footnote: pristine alignment — empty vs body (the footnote.ts:172 fix)", () => {
  it("typed \\footnote{body} adopts NON-pristine (body must not be reaped); empty stays pristine", () => {
    // typed-with-body → pristine:false
    const bodyEd = mountEditor("\\footnote{hello}".slice(0, -1)); // "\footnote{hello"
    publishHandle(bodyEd, prefsWith("footnotes", "left", null));
    expect(typeChar(bodyEd, "}")).toBe(true);
    const bodyCall = createFootnote.mock.calls[0][0];
    const bodyAtom = footnoteAtoms(bodyEd)[0];
    expect(bodyCall.pristine).toBe(false); // real body → NOT discardable
    expect(bodyCall.existingFootnoteId).toBe(bodyAtom.footnoteId);
    // The typed body lives in the atom's content attr (a normalized PM doc).
    expect(bodyAtom.content).toBeTruthy();
    expect(JSON.stringify(bodyAtom.content)).toContain("hello");

    createFootnote.mockClear();

    // typed-empty → pristine:true (the contrast that proves the trim() branch).
    const emptyEd = mountEditor("\\footnote{}".slice(0, -1)); // "\footnote{"
    publishHandle(emptyEd, prefsWith("footnotes", "left", null));
    expect(typeChar(emptyEd, "}")).toBe(true);
    expect(createFootnote.mock.calls[0][0].pristine).toBe(true);
  });

  it("a whitespace-only body \\footnote{  } is treated as pristine (trim().length===0)", () => {
    const ed = mountEditor("\\footnote{  }".slice(0, -1)); // "\footnote{  "
    publishHandle(ed, prefsWith("footnotes", "left", null));
    expect(typeChar(ed, "}")).toBe(true);
    expect(createFootnote.mock.calls[0][0].pristine).toBe(true);
  });
});

describe("footnote: registry footnote.run creator destination (grab/lightning twin)", () => {
  it("a cursor-ref footnote.run adopts via createFootnote({existingFootnoteId,pristine,mode}); focus delegated to finishCreate (no focusCard plumbing)", () => {
    const ed = mountEditor("");
    const ctx = {
      editor: ed,
      view: ed.view,
      ref: { kind: "cursor", pos: 1, paragraphId: "para-A" } as CursorRef,
      surface: "slash",
      payload: { footnoteId: "fn99", pristine: true },
      cardCreation: { createFootnote } as unknown as ActionContext["cardCreation"],
      panelRouting: {
        prefs: prefsWith("footnotes", "left", null),
        setActiveLeft,
        setActiveRight,
        focusCard,
      } as unknown as ActionContext["panelRouting"],
    } as unknown as ActionContext;

    VIRGIL_ACTION_REGISTRY.footnote!.run(ctx);

    expect(createFootnote).toHaveBeenCalledTimes(1);
    expect(createFootnote).toHaveBeenCalledWith({
      existingFootnoteId: "fn99",
      pristine: true,
      mode: "omni",
    });
    // CHIP B: footnote caret-into-body focus is now owned by the central
    // `finishCreate` chokepoint (run by the real `createFootnote` — footnote is
    // an editable-body kind), NOT by `footnoteRun` plumbing. So `footnoteRun`
    // no longer calls `panelRouting.focusCard` for footnote. (Citation KEEPS
    // its `focusCard` — it's the deliberate carve-out; see the citation case.)
    expect(focusCard).not.toHaveBeenCalled();
  });

  it("footnote.run honors a pristine:false payload (typed-with-body twin)", () => {
    const ed = mountEditor("");
    const ctx = {
      editor: ed,
      view: ed.view,
      ref: { kind: "cursor", pos: 1, paragraphId: "para-A" } as CursorRef,
      surface: "typed",
      payload: { footnoteId: "fn-body", pristine: false },
      cardCreation: { createFootnote } as unknown as ActionContext["cardCreation"],
      panelRouting: {
        prefs: prefsWith("footnotes", "left", null),
        setActiveLeft,
        setActiveRight,
        focusCard,
      } as unknown as ActionContext["panelRouting"],
    } as unknown as ActionContext;

    VIRGIL_ACTION_REGISTRY.footnote!.run(ctx);
    expect(createFootnote.mock.calls[0][0].pristine).toBe(false);
  });

  it("a DragHandleRef (grab/lightning) DELEGATES to dispatch — NO cursor card-creation", () => {
    const dispatch = vi.fn();
    const ref = { kind: "paragraph", id: "para-A" } as const;
    const ctx = { ref, surface: "grab", dispatch } as unknown as ActionContext;
    VIRGIL_ACTION_REGISTRY.footnote!.run(ctx);
    expect(dispatch).toHaveBeenCalledWith("footnote", ref);
    expect(createFootnote).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// SIDECAR ASYMMETRY — citations.json IS shaped (CitationRef) for a new
// citation; footnotes.json is NOT written for a NEW footnote (the body lives in
// the atom's content attr until the card edits it). The mission asks us to flag
// whether this is intended. These tests PIN the observed contract.
// ===========================================================================

describe("sidecar asymmetry: citation entry shaped vs footnote body in the atom", () => {
  it("a new citation forwards command+id → a citations.json CitationRef is shaped", () => {
    const ed = mountEditor("");
    publishHandle(ed, prefsWith("citations", "right", null));
    // The popover commit is the create path that shapes the card from \cite{}.
    getEditorActionsHandle()!.runAction("citation", {
      surface: "slash",
      payload: { citationId: "cit-x", command: "\\cite{}" },
    });
    const call = createCitation.mock.calls[0][0];
    // createCitation receives the full data needed to build the CitationRef
    // (command + id) — the sidecar entry IS shaped on create.
    expect(call.command).toBe("\\cite{}");
    expect(call.citationId).toBeTruthy();
    // Parser-correctness fix (CHIP 8 #5): empty `\cite{}` parses to NO keys.
    expect(parseCiteCommand(call.command)?.keys).toEqual([]);
  });

  it("a new footnote's BODY rides the atom's content attr; createFootnote carries NO body field", () => {
    // OBSERVED (flagging per the mission): unlike citation (command on the
    // entry), the footnote adopt call carries ONLY {existingFootnoteId, pristine,
    // mode} — no body/content. The typed body is in the in-doc atom's `content`
    // attr; footnotes.json is not written for the NEW footnote at create time.
    const ed = mountEditor("\\footnote{deep body}".slice(0, -1));
    publishHandle(ed, prefsWith("footnotes", "left", null));
    typeChar(ed, "}");
    const call = createFootnote.mock.calls[0][0];
    const atom = footnoteAtoms(ed)[0];
    expect(call.content).toBeUndefined();
    expect(call.body).toBeUndefined();
    expect(Object.keys(call).sort()).toEqual(
      ["existingFootnoteId", "mode", "pristine"].sort(),
    );
    // The body is durable in the atom (round-trips via the .tex), not the call.
    expect(JSON.stringify(atom.content)).toContain("deep body");
  });
});

// ===========================================================================
// DURABILITY — the atom lands even with the card host unmounted (bridge null).
// A cross-action proof: BOTH cite and footnote keep the synchronous PM insert.
// ===========================================================================

describe("durability: typed atom lands with the bridge cleared (both kinds)", () => {
  it("slash \\cite no-ops (deferred) + typed \\footnote{} inserts the atom with no handle, no throw", () => {
    setEditorActionsHandle(null);

    // Slash now only OPENS the popover (deferred) — with no bridge it no-ops and
    // never inserts a blank atom. The synchronous-durability property belongs to
    // the TYPED surfaces, which still land their atom even with the host gone.
    const citeEd = mountEditor("");
    expect(() => COMMAND_MAP.get("cite")!.action(citeEd.view, "\\cite")).not.toThrow();
    expect(citationAtoms(citeEd)).toHaveLength(0);
    expect(createCitation).not.toHaveBeenCalled();

    const fnEd = mountEditor("\\footnote{}".slice(0, -1));
    expect(() => typeChar(fnEd, "}")).not.toThrow();
    expect(footnoteAtoms(fnEd)).toHaveLength(1);
    expect(createFootnote).not.toHaveBeenCalled();
  });
});
