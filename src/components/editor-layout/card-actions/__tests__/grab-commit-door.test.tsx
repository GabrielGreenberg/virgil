// @vitest-environment jsdom
//
// TASK 735 — the grab bar's card-side effects follow a MEASURED document commit.
//
// `view.dispatch(tr)` returns nothing, and a transaction a `filterTransaction`
// refuses is dropped silently. The grab-bar dispatcher's destructive and
// card-creating legs are compounds — a document change plus sidecar writes —
// and each used to run the irreversible sidecar half around a dispatch whose
// outcome nobody read:
//
//   - Archive: card deletes + Mode-A retarget BEFORE the delete, snippet after;
//   - Delete: card deletes BEFORE the delete;
//   - Duplicate: every clone minted BEFORE `tr.doc.check()` and the dispatch;
//   - linked anchor: a record returned for a mark that was filtered away.
//
// Every leg below drives the REAL dispatcher on the REAL main extension stack,
// with the document half refused — either by a plugin filter (surface still
// "editable") or by the host flipping read-only while the confirm is open — and
// is paired with a POSITIVE CONTROL on the identical fixture, so a refusal can
// never pass because the fixture was inert.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { cleanup, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { tryCreateLinkedAnchor } from "@/links/links";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

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

/** First paragraph carries a Mode-B `linkedAnchor` over "beta" (a note's), so
 *  the range legs have a card for the lifecycle to delete and Duplicate has a
 *  card to clone. The second paragraph survives every leg. */
const FIXTURE = (): JSONContent[] => [
  {
    type: "paragraph",
    attrs: { uuid: "p-A" },
    content: [
      { type: "text", text: "alpha " },
      {
        type: "text",
        text: "beta",
        marks: [
          {
            type: "linkedAnchor",
            attrs: {
              anchorId: "a-1",
              kind: "note",
              linkId: "a-1",
              linkKind: "anchor",
              linkCard: "note:n-1",
            },
          },
        ],
      },
      { type: "text", text: " gamma" },
    ],
  },
  { type: "paragraph", attrs: { uuid: "p-B" }, content: [{ type: "text", text: "second" }] },
];

const BLOCK_REF: DragHandleRef = { kind: "paragraph", id: "p-A" };
/** "alpha" — plain text, so a new Mode-B anchor there is a fresh mark. */
const SELECTION_REF: DragHandleRef = { kind: "selection", from: 1, to: 6, paragraphId: "p-A" };

interface Mounted {
  editor: Editor;
  editableRef: RefObject<boolean>;
}

function mountHost(): Mounted {
  const editableRef: RefObject<boolean> = { current: true };
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: { type: "doc", content: FIXTURE() },
  });
  return { editor, editableRef };
}

/** A plugin that refuses every document change while the surface still reads
 *  editable — the "some filter vetoed it" case the editability gate can't see. */
function refuseDocChanges(editor: Editor): void {
  editor.registerPlugin(
    new Plugin({ filterTransaction: (tr) => !tr.docChanged }),
  );
}

interface Harness {
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => Promise<void>;
  creations: string[];
  clones: number;
  deletes: number;
  retargets: number;
  notify: ReturnType<typeof vi.fn>;
}

function makeHarness(
  editor: Editor,
  opts: { onConfirm?: () => void; throwOn?: string } = {},
): Harness {
  const creations: string[] = [];
  const counts = { clones: 0, deletes: 0, retargets: 0 };
  let n = 0;
  const cardCreation = new Proxy(
    {},
    {
      get: (_t, prop: string) => (..._args: unknown[]) => {
        if (prop === opts.throwOn) throw new Error(`boom in ${prop}`);
        creations.push(prop);
        const id = `card-${++n}`;
        return { id, footnoteId: id };
      },
    },
  ) as unknown as DragHandleActionsDeps["cardCreation"];
  const notify = vi.fn();

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: {
      get: () => ({
        clone: (id: string) => {
          counts.clones += 1;
          return `clone-of-${id}-${counts.clones}`;
        },
        delete: () => {
          counts.deletes += 1;
        },
      }),
    },
    anchorRetarget: {
      retarget: () => {
        counts.retargets += 1;
        return 0;
      },
    },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm: async () => {
      opts.onConfirm?.();
      return true;
    },
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch,
    creations,
    notify,
    get clones() {
      return counts.clones;
    },
    get deletes() {
      return counts.deletes;
    },
    get retargets() {
      return counts.retargets;
    },
  };
}

beforeEach(installLayoutShims);
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// (A) A FILTERED document half runs no card half — one leg per site
// ---------------------------------------------------------------------------

describe("task 735 (A) — a filtered transaction leaves every sidecar untouched", () => {
  it("archive: no card delete, no retarget, no snippet — and the user is told", async () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);

    await h.dispatch("archive", BLOCK_REF);

    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(h.deletes, "a card was deleted for a passage that stayed").toBe(0);
    expect(h.retargets, "an anchor was re-homed off a paragraph that stayed").toBe(0);
    expect(h.creations, "an archive snippet was minted for text never archived").toEqual([]);
    expect(h.notify).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("delete: no card delete — and the user is told", async () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);

    await h.dispatch("delete", BLOCK_REF);

    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(h.deletes).toBe(0);
    expect(h.notify).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("duplicate: no clone is minted — and the user is told", async () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);

    await h.dispatch("duplicate", BLOCK_REF);

    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(h.clones, "clones exist for content that was never inserted").toBe(0);
    expect(h.notify).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("note on a selection: the Mode-B mark is filtered, so NO card is registered", async () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const before = editor.state.doc.toJSON();
    const h = makeHarness(editor);

    await h.dispatch("note", SELECTION_REF);

    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(h.creations, "a note was written against an anchor that exists nowhere").toEqual([]);
    expect(h.notify).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it("highlight on a selection: same — no card for a mark that never landed", async () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const h = makeHarness(editor);

    await h.dispatch("highlight", SELECTION_REF);

    expect(h.creations).toEqual([]);
    expect(h.notify).toHaveBeenCalledTimes(1);
    editor.destroy();
  });
});

describe("task 735 (A) — POSITIVE CONTROLS on the identical fixture", () => {
  it("archive: the passage goes, its card is deleted, the snippet is minted", async () => {
    const { editor } = mountHost();
    const h = makeHarness(editor);

    await h.dispatch("archive", BLOCK_REF);

    expect(editor.state.doc.childCount).toBe(1);
    expect(h.deletes).toBe(1);
    expect(h.retargets).toBe(1);
    expect(h.creations).toEqual(["createArchiveSnippet"]);
    expect(h.notify).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("delete: the passage goes and its card is deleted", async () => {
    const { editor } = mountHost();
    const h = makeHarness(editor);

    await h.dispatch("delete", BLOCK_REF);

    expect(editor.state.doc.childCount).toBe(1);
    expect(h.deletes).toBe(1);
    expect(h.notify).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("duplicate: the copy lands and its card is cloned exactly once", async () => {
    const { editor } = mountHost();
    const h = makeHarness(editor);

    await h.dispatch("duplicate", BLOCK_REF);

    expect(editor.state.doc.childCount).toBe(3);
    expect(h.clones, "the dry validation pass must mint nothing").toBe(1);
    expect(h.notify).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("note on a selection: the mark lands and the card is registered", async () => {
    const { editor } = mountHost();
    const h = makeHarness(editor);

    await h.dispatch("note", SELECTION_REF);

    expect(h.creations).toEqual(["createNote"]);
    expect(h.notify).not.toHaveBeenCalled();
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// (B) Editability is re-asked at the COMMIT seam, after the await
// ---------------------------------------------------------------------------

describe("task 735 (B) — a host flip DURING the confirm refuses the compound as a unit", () => {
  for (const action of ["archive", "delete"] as DragHandleAction[]) {
    it(`${action}: the flip lands while the dialog is open — nothing moves`, async () => {
      const { editor, editableRef } = mountHost();
      const before = editor.state.doc.toJSON();
      const h = makeHarness(editor, {
        onConfirm: () => {
          editableRef.current = false;
        },
      });

      await h.dispatch(action, BLOCK_REF);

      expect(editor.state.doc.toJSON()).toEqual(before);
      expect(h.deletes).toBe(0);
      expect(h.retargets).toBe(0);
      expect(h.creations).toEqual([]);
      expect(h.notify, "the user confirmed — the refusal must be loud").toHaveBeenCalledTimes(1);
      editor.destroy();
    });
  }
});

// ---------------------------------------------------------------------------
// (C) `tryCreateLinkedAnchor` tells its two refusals apart
// ---------------------------------------------------------------------------

describe("task 735 (C) — linked-anchor: not-applicable vs filtered", () => {
  it("an empty range is NOT-APPLICABLE", () => {
    const { editor } = mountHost();
    expect(tryCreateLinkedAnchor(editor, "note", { from: 3, to: 3 })).toEqual({
      ok: false,
      reason: "not-applicable",
    });
    editor.destroy();
  });

  it("a filtered mark is FILTERED, and returns no record", () => {
    const { editor } = mountHost();
    refuseDocChanges(editor);
    const before = editor.state.doc;
    expect(tryCreateLinkedAnchor(editor, "note", { from: 1, to: 6 })).toEqual({
      ok: false,
      reason: "filtered",
    });
    expect(editor.state.doc).toBe(before);
    editor.destroy();
  });

  it("POSITIVE CONTROL: the mark lands and its anchorId is in the document", () => {
    const { editor } = mountHost();
    const attempt = tryCreateLinkedAnchor(editor, "note", { from: 1, to: 6 });
    expect(attempt.ok).toBe(true);
    if (!attempt.ok) return;
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.marks.some((m) => m.attrs.anchorId === attempt.record.anchorId)) found = true;
    });
    expect(found).toBe(true);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// (D) A throw reaches the user; the promise never rejects
// ---------------------------------------------------------------------------

describe("task 735 (D) — one failure door", () => {
  it("a throw inside the compound is reported through `notify`, not rejected", async () => {
    const { editor } = mountHost();
    const h = makeHarness(editor, { throwOn: "createNote" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(h.dispatch("note", SELECTION_REF)).resolves.toBeUndefined();

    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0][0]).toMatchObject({ tone: "danger" });
    expect(err).toHaveBeenCalled();
    editor.destroy();
  });
});
