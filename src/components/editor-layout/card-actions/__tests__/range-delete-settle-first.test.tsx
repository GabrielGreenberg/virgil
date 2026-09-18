// @vitest-environment jsdom
//
// TASK 636 — the range/archive walker must ASK before it destroys.
//
// THE DEFECT. Deleting or archiving a block through the drag handle ran a
// cleanup walk that called each contained card's lifecycle `delete`, then
// deleted the text on the very next statement. The card delete is ASYNCHRONOUS
// and DECLINABLE (`makeUnbridgingDelete` → the executor's SETTLE obligation
// raises a three-way keep / revert / cancel prompt whenever the card owns a live
// in-document splice); the text delete was SYNCHRONOUS and UNCONDITIONAL. Nothing
// awaited in between, so the two raced:
//
//   • Cancel → the card survived over a paragraph that had already vanished.
//   • Revert → `revertPendingChange` could no longer resolve its range, so the
//     pre-suggestion ORIGINAL was never restored — and the delete reported
//     success anyway. Silent, unrecoverable loss of the user's own writing.
//   • The prompt itself was shown over a document the text had already left,
//     saying "the suggested text has replaced the original" about text that was
//     no longer anywhere.
//
// THE FIX is the shape this very dispatcher already uses two cases up: archive's
// `prepareCardBodyCapture` runs BEFORE any mutation precisely so "an abort leaves
// the document and every sidecar completely untouched". This is that law's other
// half — a second declinable question was being asked AFTER the point of no
// return. `settleRangeCardObligations` hoists it: every applied splice inside the
// passage is settled first, a decline aborts the whole gesture, and only then does
// the unconditional half run.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack, so the ref resolution, the cascade, the capture, the ask and
// the delete all run for real. The only stub is the `appliedSplice` bag —
// EditorPane's own wiring of the prompt and the pending-change SSOT.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "mutateBib",
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

vi.mock("@/lib/focus-new-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/focus-new-card")>();
  return { ...actual, focusNewCard: vi.fn() };
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import { linkCardKey } from "@/links/link-dom-contract";
import type {
  AppliedSpliceOps,
  AppliedSpliceResolution,
} from "@/cards/lifecycle/applied-splice";
import { settleAppliedSpliceForCard } from "@/cards/lifecycle/run-event";
import type { CardKind } from "@/cards/types";
import type { DragHandleAction } from "@/components/DragHandleMenu";

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

function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
}

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

beforeEach(installLayoutShims);
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture: three paragraphs, the middle one carrying the light-blue applied
// splice of a `revision-suggestion` — a `linkedAnchor` mark whose `linkCard`
// token is exactly what the walker's mark branch parses. This is the reachable
// live surface the audit named: an APPLIED suggestion inside a drag-handle-
// deleted or archived block.
// ---------------------------------------------------------------------------

const SUGGESTION_ID = "sugg-1";
const TARGET_TEXT = "The suggested replacement text.";

function docWithAppliedSuggestion(): JSONContent[] {
  return [
    { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
    {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [
        {
          type: "text",
          text: TARGET_TEXT,
          marks: [
            {
              type: "linkedAnchor",
              attrs: {
                anchorId: "anchor-1",
                linkCard: linkCardKey("revision-suggestion", SUGGESTION_ID),
              },
            },
          ],
        },
      ],
    },
    { type: "paragraph", attrs: { uuid: "p-after" }, content: [{ type: "text", text: "After." }] },
  ];
}

const TARGET_REF = { kind: "paragraph", id: "p-target" } as DragHandleRef;

/**
 * The host's SETTLE bag, scripted. `answer` is what the user picks; `onSettle`
 * is where we observe the document AS THE SETTLEMENT SEES IT — which is the
 * whole bug: pre-636 the text was already gone by then.
 */
function makeSpliceOps(opts: {
  answer: AppliedSpliceResolution | null;
  settleReturns?: boolean;
  onSettle?: () => void;
}): { ops: AppliedSpliceOps; counts: { asks: number; settles: number } } {
  const counts = { asks: 0, settles: 0 };
  // STATEFUL, like the real bag: `get` reads the live card, and a landed
  // settlement clears the card's `appliedChange`, so the splice is gone
  // afterwards. Without that a second door asking the same question would be
  // prompted twice, which is precisely what the real wiring does not do.
  let live = true;
  const ops: AppliedSpliceOps = {
    get: (kind, id) =>
      live && kind === "revision-suggestion" && id === SUGGESTION_ID
        ? { anchorId: "anchor-1", mode: "replace" }
        : null,
    ask: async () => {
      counts.asks++;
      return opts.answer;
    },
    settle: () => {
      counts.settles++;
      opts.onSettle?.();
      if (opts.settleReturns === false) return false;
      live = false;
      return true;
    },
  };
  return { ops, counts };
}

function makeHarness(editor: Editor, appliedSplice: AppliedSpliceOps) {
  const notify = vi.fn();
  const deleted: string[] = [];
  const archiveCalls: { text?: unknown }[] = [];
  let n = 0;
  const nextId = () => `card-${++n}`;

  const cardCreation = {
    createNote: () => ({ id: nextId() }),
    createTodo: () => ({ id: nextId() }),
    createHighlight: () => ({ id: nextId() }),
    createRevisionRequest: () => ({ id: nextId() }),
    createFootnote: () => ({ footnoteId: nextId() }),
    createCitation: () => ({ id: nextId() }),
    createCutterComment: () => ({ id: nextId() }),
    createReportRequest: () => ({ id: nextId() }),
    createArchiveSnippet: (opts: { text?: unknown }) => {
      archiveCalls.push({ text: opts.text });
      return { id: nextId() };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: {
      // FAITHFUL TO PRODUCTION, and that is the point of this suite. Every
      // panel hook's delete is a `makeUnbridgingDelete`, which routes through
      // `runCardLifecycleEvent` — so the walker's `delete` is ASYNC and raises
      // the SETTLE prompt ITSELF whenever the card still owns a live splice,
      // resolving false when the user declines. A plain synchronous `push`
      // stub would model a walker no user ever runs, and is exactly why no
      // existing suite could see this defect.
      get: (kind: string) => ({
        delete: async (id: string) => {
          const outcome = await settleAppliedSpliceForCard(
            "delete",
            kind as CardKind,
            id,
            appliedSplice,
          );
          if (outcome === "declined") return false;
          deleted.push(`${kind}:${id}`);
          return true;
        },
      }),
    } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: { retarget: () => 0 },
    appliedSplice,
    confirm: async () => true,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch as (a: DragHandleAction, r: DragHandleRef) => Promise<void>,
    deleted,
    archiveCalls,
    notify,
  };
}

describe("task 636 — a declined settle aborts the whole range gesture", () => {
  it("DELETE: cancelling the settle prompt leaves the document byte-identical", async () => {
    const editor = mountDoc(docWithAppliedSuggestion());
    const before = JSON.stringify(editor.state.doc.toJSON());
    const splice = makeSpliceOps({ answer: null });
    const h = makeHarness(editor, splice.ops);

    await h.dispatch("delete", TARGET_REF);

    // THE DEFECT LEG: pre-636 the paragraph was gone by the time the user
    // answered, so "cancel" undid nothing.
    expect(splice.counts.asks).toBe(1);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    expect(editor.state.doc.textContent).toContain(TARGET_TEXT);
    // …and the card the user chose to keep was never deleted either.
    expect(h.deleted).toEqual([]);
  });

  it("ARCHIVE: cancelling the settle prompt leaves the document AND the archive panel untouched", async () => {
    const editor = mountDoc(docWithAppliedSuggestion());
    const before = JSON.stringify(editor.state.doc.toJSON());
    const splice = makeSpliceOps({ answer: null });
    const h = makeHarness(editor, splice.ops);

    await h.dispatch("archive", TARGET_REF);

    expect(splice.counts.asks).toBe(1);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    // Pre-636 the archive leg was worse than delete: the passage was already
    // captured into an archive card by the time the prompt was answered, so a
    // cancel left a snippet of text that was still in the document too.
    expect(h.archiveCalls).toEqual([]);
    expect(h.deleted).toEqual([]);
  });

  it("a REFUSED settle (no editor to splice) aborts exactly as a cancel does", async () => {
    // `AppliedSpliceOps.settle` returns false when it could not act. The
    // executor treats that as a decline; so must the range gesture, or the
    // record ends over a range nothing can then manage.
    const editor = mountDoc(docWithAppliedSuggestion());
    const before = JSON.stringify(editor.state.doc.toJSON());
    const splice = makeSpliceOps({ answer: "revert", settleReturns: false });
    const h = makeHarness(editor, splice.ops);

    await h.dispatch("delete", TARGET_REF);

    expect(splice.counts.settles).toBe(1);
    expect(JSON.stringify(editor.state.doc.toJSON())).toBe(before);
    expect(h.deleted).toEqual([]);
  });
});

describe("task 636 — the settle sees the document it is settling", () => {
  it("DELETE: the text is STILL THERE when `settle` runs, so Revert has something to restore", async () => {
    const editor = mountDoc(docWithAppliedSuggestion());
    let textAtSettle = "";
    const splice = makeSpliceOps({
      answer: "revert",
      onSettle: () => {
        textAtSettle = editor.state.doc.textContent;
      },
    });
    const h = makeHarness(editor, splice.ops);

    await h.dispatch("delete", TARGET_REF);

    // THE HEART OF IT. Pre-636 this read "Before.After." — the paragraph had
    // already been deleted, `revertPendingChange` could not resolve the anchor,
    // and the pre-suggestion original was lost with the delete still reporting
    // success.
    expect(textAtSettle).toContain(TARGET_TEXT);
    // The gesture then completes: settled first, deleted after.
    expect(editor.state.doc.textContent).not.toContain(TARGET_TEXT);
    expect(h.deleted).toEqual([`revision-suggestion:${SUGGESTION_ID}`]);
  });

  it("ARCHIVE: the same ordering holds on the leg that also CAPTURES", async () => {
    const editor = mountDoc(docWithAppliedSuggestion());
    let textAtSettle = "";
    const splice = makeSpliceOps({
      answer: "keep",
      onSettle: () => {
        textAtSettle = editor.state.doc.textContent;
      },
    });
    const h = makeHarness(editor, splice.ops);

    await h.dispatch("archive", TARGET_REF);

    expect(textAtSettle).toContain(TARGET_TEXT);
    expect(h.archiveCalls).toHaveLength(1);
    expect(editor.state.doc.textContent).not.toContain(TARGET_TEXT);
  });
});

describe("task 636 — nothing changes for a passage with no live splice", () => {
  it("no splice ⇒ no prompt, and the delete runs exactly as before", async () => {
    const editor = mountDoc(docWithAppliedSuggestion());
    const inert: AppliedSpliceOps = {
      get: () => null,
      ask: async () => null,
      settle: () => true,
    };
    const h = makeHarness(editor, inert);

    await h.dispatch("delete", TARGET_REF);

    expect(editor.state.doc.textContent).toBe("Before.After.");
    expect(h.deleted).toEqual([`revision-suggestion:${SUGGESTION_ID}`]);
  });
});
