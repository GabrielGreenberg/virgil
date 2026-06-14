// @vitest-environment jsdom
//
// CHIP 4a-i — the PM→React bridge plumbing (INERT this chip).
//
// Proves the bridge's storage contract + that a published `EditorActionsHandle`
// — built EXACTLY the way `EditorPane`'s publish effect builds it — resolves a
// registry spec and invokes `run(ctx)` with a fully-populated `ActionContext`:
// the right `surface` / `payload`, a synthesized `CursorRef` (kind:"cursor")
// from the editor's current selection head, and the React-land mocks
// (`cardCreation` / `cardLifecycle` / `dispatch`) threaded through.
//
// WHAT IS PROVEN
//   1. get/set storage contract — `getEditorActionsHandle()` returns what was
//      published, and is `null` after the handle is cleared (the unmount path);
//   2. `runAction(id, seed)` RESOLVES `VIRGIL_ACTION_REGISTRY[id]` and calls
//      `spec.run(ctx)` with: ref `{kind:"cursor"}` synthesized from the live
//      selection head (incl. the containing-paragraph uuid), the seed's
//      `surface` + `payload`, and the React-land mocks;
//   3. an UNKNOWN id no-ops WITHOUT throwing (and never reaches a spec);
//   4. a registered (non-card) spec's `run` is the SINGLE handler the bridge
//      reaches — spying on an existing card spec's `run` shows the same path.
//
// The registry transitively pulls the extension barrel → `@/lib/storage`;
// stub it (same pattern as action-coverage-assertion.test.ts).
import { describe, it, expect, vi, afterEach } from "vitest";

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

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type ActionSpec,
  type CursorRef,
  type EditorActionsHandle,
} from "@/lib/actions/action-registry";
import {
  setEditorActionsHandle,
  getEditorActionsHandle,
} from "@/lib/actions/editor-actions-bridge";
import { paragraphUuidAt } from "@/links/links";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mainCtx = (): EditorExtensionsCtx => ({
  surface: "main",
  editable: true,
  cardContext: true,
  callbacks: {},
  docIdRef: null,
  host: { getMainEditor: () => null },
});

const schema = getSchema(buildEditorExtensions(mainCtx()));

const docJson: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "para-A" },
      content: [{ type: "text", text: "Hello world." }],
    },
  ],
};

/** Build a real `EditorState` with the caret placed inside "para-A", plus a
 *  minimal `Editor`-shaped object exposing `.state` + `.view` — exactly the
 *  two fields the bridge handle reads (`ed.state.selection.head`,
 *  `ed.state.doc`, `ed.view`). The view's `state` mirrors the editor's. */
function makeEditor(caretPos = 3, isEditable = true) {
  const doc = PMNode.fromJSON(schema, docJson);
  let state = EditorState.create({ schema, doc });
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, caretPos)),
  );
  const view = { state } as unknown as ActionContext["view"];
  // `isEditable` mirrors the live editor's editability — the CHIP 7b collab gate
  // the bridge reads (`!ed.isEditable` → no-op).
  const editor = { state, view, isEditable } as unknown as ActionContext["editor"];
  return { editor, state };
}

/**
 * Re-create the bridge handle EXACTLY as `EditorPane`'s publish effect does:
 * resolve the spec, no-op + dev-warn on an absent row, synthesize a `CursorRef`
 * from the live selection head, build the full `ActionContext`, call
 * `spec.run(ctx)`. Tests the contract the effect publishes (the effect itself is
 * a thin React wrapper around this logic — see EditorPane.tsx).
 */
function buildHandle(
  editor: ActionContext["editor"],
  deps: {
    cardCreation?: ActionContext["cardCreation"];
    cardLifecycle?: ActionContext["cardLifecycle"];
    dispatch?: ActionContext["dispatch"];
  },
): EditorActionsHandle {
  return {
    runAction(id: ActionId, seed) {
      const spec = VIRGIL_ACTION_REGISTRY[id];
      if (!spec) return; // unknown id → no-op (dev-warns in the real effect)
      const ed = editor;
      // CHIP 7b: the uniform collab read-only gate — the bridge no-ops entirely
      // when the partner holds the pen (mirrors EditorPane's `if (!ed.isEditable)
      // return`). Treat a missing `isEditable` as editable (no over-gating).
      if (ed.isEditable === false) return;
      const pos = ed.state.selection.head;
      const ref: CursorRef = {
        kind: "cursor",
        pos,
        paragraphId: paragraphUuidAt(ed.state.doc, pos) ?? "",
      };
      const ctx: ActionContext = {
        editor: ed,
        view: ed.view,
        ref,
        surface: seed.surface,
        position: seed.position,
        canEdit: ed.isEditable,
        cardCreation: deps.cardCreation,
        cardLifecycle: deps.cardLifecycle,
        dispatch: deps.dispatch,
        payload: seed.payload,
      };
      void spec.run(ctx);
    },
  };
}

afterEach(() => {
  setEditorActionsHandle(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (1) storage contract
// ---------------------------------------------------------------------------

describe("editor-actions-bridge storage", () => {
  it("getEditorActionsHandle() returns the published handle, null otherwise", () => {
    expect(getEditorActionsHandle()).toBeNull();
    const handle: EditorActionsHandle = { runAction: vi.fn() };
    setEditorActionsHandle(handle);
    expect(getEditorActionsHandle()).toBe(handle);
  });

  it("is null after the handle is cleared (the unmount path)", () => {
    setEditorActionsHandle({ runAction: vi.fn() });
    expect(getEditorActionsHandle()).not.toBeNull();
    setEditorActionsHandle(null);
    expect(getEditorActionsHandle()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) runAction resolves a spec + invokes run(ctx) with the right context
// ---------------------------------------------------------------------------

describe("runAction → spec.run(ctx)", () => {
  it("resolves a temporary spec and invokes run with surface/payload + a CursorRef", () => {
    const { editor } = makeEditor(3);
    const runSpy = vi.fn();
    // Register a temporary spec under an unused-this-chip id (citation row is
    // a card-delegating wrapper; we replace it for the assertion + restore it).
    const original = VIRGIL_ACTION_REGISTRY.citation;
    const tempSpec: ActionSpec = {
      id: "citation",
      label: "Citation (test)",
      category: "card",
      surfaces: { slash: true, typed: true },
      applies: () => "ok",
      run: runSpy,
    };
    (VIRGIL_ACTION_REGISTRY as Record<string, ActionSpec>).citation = tempSpec;

    const cardCreation = { __tag: "cc" } as unknown as ActionContext["cardCreation"];
    const cardLifecycle = { __tag: "cl" } as unknown as ActionContext["cardLifecycle"];
    const dispatch = vi.fn();

    try {
      setEditorActionsHandle(buildHandle(editor, { cardCreation, cardLifecycle, dispatch }));
      getEditorActionsHandle()!.runAction("citation", {
        surface: "slash",
        payload: { citationId: "cit-9" },
      });

      expect(runSpy).toHaveBeenCalledTimes(1);
      const ctx = runSpy.mock.calls[0][0] as ActionContext;
      // surface + payload threaded from the seed
      expect(ctx.surface).toBe("slash");
      expect(ctx.payload).toEqual({ citationId: "cit-9" });
      // CursorRef synthesized from the live selection head, with the
      // containing-paragraph uuid resolved.
      expect(ctx.ref.kind).toBe("cursor");
      const ref = ctx.ref as CursorRef;
      expect(ref.pos).toBe(3);
      expect(ref.paragraphId).toBe("para-A");
      // React-land mocks threaded in by the bridge (the surfaces-3/4 supplier).
      expect(ctx.cardCreation).toBe(cardCreation);
      expect(ctx.cardLifecycle).toBe(cardLifecycle);
      expect(ctx.dispatch).toBe(dispatch);
      // live editor / view present
      expect(ctx.editor).toBe(editor);
      expect(ctx.view).toBe(editor.view);
    } finally {
      if (original) (VIRGIL_ACTION_REGISTRY as Record<string, ActionSpec>).citation = original;
    }
  });

  it("threads surface:'typed' and an empty payload through unchanged", () => {
    const { editor } = makeEditor(5);
    const original = VIRGIL_ACTION_REGISTRY.citation;
    const runSpy = vi.fn();
    (VIRGIL_ACTION_REGISTRY as Record<string, ActionSpec>).citation = {
      id: "citation",
      label: "Citation (test)",
      category: "card",
      surfaces: { slash: true, typed: true },
      applies: () => "ok",
      run: runSpy,
    };
    try {
      setEditorActionsHandle(buildHandle(editor, {}));
      getEditorActionsHandle()!.runAction("citation", { surface: "typed" });
      const ctx = runSpy.mock.calls[0][0] as ActionContext;
      expect(ctx.surface).toBe("typed");
      expect(ctx.payload).toBeUndefined();
      expect((ctx.ref as CursorRef).pos).toBe(5);
    } finally {
      if (original) (VIRGIL_ACTION_REGISTRY as Record<string, ActionSpec>).citation = original;
    }
  });

  it("reaches an existing card spec's run() (the SINGLE handler the bridge invokes)", () => {
    const { editor } = makeEditor(3);
    const note = VIRGIL_ACTION_REGISTRY.note!;
    const runSpy = vi.spyOn(note, "run");
    setEditorActionsHandle(buildHandle(editor, {}));
    getEditorActionsHandle()!.runAction("note", { surface: "slash" });
    expect(runSpy).toHaveBeenCalledTimes(1);
    const ctx = runSpy.mock.calls[0][0] as ActionContext;
    expect(ctx.surface).toBe("slash");
    expect(ctx.ref.kind).toBe("cursor");
  });
});

// ---------------------------------------------------------------------------
// (3) unknown id → no-op, no throw
// ---------------------------------------------------------------------------

describe("runAction on an unknown / not-yet-migrated id", () => {
  it("no-ops without throwing (the registry is partial until later chips)", () => {
    const { editor } = makeEditor(3);
    setEditorActionsHandle(buildHandle(editor, {}));
    // A genuinely-UNKNOWN id (never an `ActionId`) → absent registry row →
    // no-op + dev-warn. Use a fake id rather than a real-but-unmigrated one so
    // this test can't go stale as later chips fill the registry (it broke once
    // when `tex`→CHIP 5b, again when `figure`→CHIP 6a — a fake id is permanent).
    expect(() =>
      getEditorActionsHandle()!.runAction("__no_such_action__" as ActionId, { surface: "slash" }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// (4) CHIP 7b — the uniform collab read-only gate: the bridge no-ops the
//     slash/typed surfaces when the partner holds the pen, and behaves exactly
//     as before when editable (no over-gating).
// ---------------------------------------------------------------------------

describe("runAction collab read-only gate (CHIP 7b)", () => {
  it("does NOT reach the spec's run() when the editor is collab read-only", () => {
    const { editor } = makeEditor(3, /* isEditable */ false);
    const note = VIRGIL_ACTION_REGISTRY.note!;
    const runSpy = vi.spyOn(note, "run");
    setEditorActionsHandle(buildHandle(editor, {}));
    getEditorActionsHandle()!.runAction("note", { surface: "slash" });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("citation/footnote (the PM-land card surfaces) are suppressed when collab read-only", () => {
    const { editor } = makeEditor(3, false);
    setEditorActionsHandle(buildHandle(editor, {}));
    for (const id of ["citation", "footnote"] as const) {
      const spec = VIRGIL_ACTION_REGISTRY[id]!;
      const runSpy = vi.spyOn(spec, "run");
      getEditorActionsHandle()!.runAction(id, { surface: "typed", payload: {} });
      expect(runSpy, `${id}`).not.toHaveBeenCalled();
      runSpy.mockRestore();
    }
  });

  it("DOES reach run() when editable (no over-gating — unchanged from before)", () => {
    const { editor } = makeEditor(3, true);
    const note = VIRGIL_ACTION_REGISTRY.note!;
    const runSpy = vi.spyOn(note, "run");
    setEditorActionsHandle(buildHandle(editor, {}));
    getEditorActionsHandle()!.runAction("note", { surface: "slash" });
    expect(runSpy).toHaveBeenCalledTimes(1);
    // And the ctx carries canEdit:true so the run()'s own guard passes.
    const ctx = runSpy.mock.calls[0][0] as ActionContext;
    expect(ctx.canEdit).toBe(true);
  });
});
