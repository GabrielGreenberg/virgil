// @vitest-environment jsdom
//
// TASK 638 — the collab gate at the seams `run()` never sees.
//
// `ACTION_REGISTRY` calls the check at the top of its sixteen `run()` bodies the
// "uniform collab gate". It was not uniform: three live invocation paths never
// enter `run()` at all, and the sibling `applicability-collab-gate.test.ts` could
// not see that, because it drives `applies()` and `run()` — the two things those
// paths skip. Both halves of the proof are here:
//
//   (A) THE CARD-DISPATCH SEAM. All eleven card rows declare
//       `surfaces: { grab: true, lightning: true }`, and neither menu ever calls
//       `spec.run()` for one: `DragHandleMenu` and `ActionsMenuPanel` both hand
//       the id to `useDragHandleActions().dispatch`. So the run-side gate was
//       unreachable from exactly the two surfaces those rows exist on, and the
//       only thing left was a `disabled` flag computed once at menu-build time.
//       `readOnlyEnforcer` is not the backstop: it refuses doc-changing PM
//       transactions, so it covers `delete`/`archive`, but a note / todo /
//       report / cutter / suggest-edit REGISTERS A CARD — React state plus a
//       sidecar write, which never passes through ProseMirror.
//
//   (B) THE DEFERRED-COMMIT SEAM. `refRun` / `citationRun` gate the create
//       popover's OPEN; the atom lands on COMMIT, which can be many seconds
//       later — long enough for the pen to change hands while the user picks
//       citekeys in a portal `<input>`. The gate now sits in `insertInlineAtom`
//       beside the container gate task 396 put there for the same reason.
//
// The population is SWEPT from `cardActionRows("grab")`, never hand-listed: a
// hand list can only be missing the row that drifted, and a twelfth card row
// must fail this suite rather than quietly inherit an exemption.
//
// Every read-only leg is paired with a POSITIVE CONTROL on the identical
// fixture, so a refusal can never be passing because the dispatch did nothing
// anyway.
//
// (The extension barrel transitively imports `@/lib/storage`; stub it — the
// sibling-suite gotcha.)
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "mutateBib", "mutateSidecar",
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
import { cardActionRows } from "@/lib/actions/action-registry";
import { ATOM_CREATE_POPOVER_EVENT } from "@/lib/actions/atom-create";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";

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

function mountDoc(content: JSONContent[], editable: boolean): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable,
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
  for (const l of openPopoverListeners.splice(0)) {
    window.removeEventListener(ATOM_CREATE_POPOVER_EVENT, l);
  }
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Harness. `cardCreation` is a PROXY, not a hand-written stub: every method the
// dispatcher reaches is recorded by NAME, whichever it is. A hand-written stub
// would have to enumerate the factory methods, which is the same hand list the
// swept population exists to avoid — and a card row wired to a method nobody
// thought to stub would read as "created nothing" and pass the refusal leg
// vacuously.
// ---------------------------------------------------------------------------

interface Harness {
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => Promise<void>;
  creations: string[];
  /** `citation` neither mutates the doc nor registers a card from this seam: it
   *  opens the shared create popover by hopping a window event, and the ATOM
   *  lands later at the deferred-commit seam (part B). Counting the popover is
   *  what keeps its two legs here non-vacuous — and offering a read-only
   *  collaborator a live create popover is itself the defect. */
  popovers: number;
}

function makeHarness(editor: Editor): Harness {
  const creations: string[] = [];
  let n = 0;
  const cardCreation = new Proxy(
    {},
    {
      get: (_t, prop: string) => (..._args: unknown[]) => {
        creations.push(prop);
        const id = `card-${++n}`;
        // The dispatcher reads `.id` from most factories and `.footnoteId` from
        // `createFootnote`; hand back both so no branch takes a failure path
        // that would mask a creation we are counting.
        return { id, footnoteId: id };
      },
    },
  ) as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: { get: () => undefined } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: { retarget: () => 0 },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm: async () => true,
    notify: vi.fn(),
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
    clearBlankIfSet: () => {},
  };

  const popovers = { n: 0 };
  const onPopover = () => { popovers.n += 1; };
  window.addEventListener(ATOM_CREATE_POPOVER_EVENT, onPopover);
  openPopoverListeners.push(onPopover);

  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch,
    creations,
    get popovers() {
      return popovers.n;
    },
  };
}

/** Torn down in `afterEach` so a leg's listener can't count another leg's
 *  event (the harness is built once per leg, on a shared `window`). */
const openPopoverListeners: Array<() => void> = [];

const PARA = (uuid: string, text: string): JSONContent => ({
  type: "paragraph",
  attrs: { uuid },
  content: [{ type: "text", text }],
});

/** Two paragraphs, so a `delete`/`archive` of the first leaves a doc to compare
 *  against rather than PM's empty-doc backfill. */
const FIXTURE = (): JSONContent[] => [PARA("p-A", "alpha beta gamma"), PARA("p-B", "second")];

/** A live SELECTION over "beta" in the first paragraph — the ref shape the grab
 *  bar hands the dispatcher, and the one that exercises the Mode-B anchor drop. */
const SELECTION_REF: DragHandleRef = {
  kind: "selection",
  from: 7,
  to: 11,
  paragraphId: "p-A",
};

// ---------------------------------------------------------------------------
// (A) The card-dispatch seam
// ---------------------------------------------------------------------------

const CARD_IDS = cardActionRows("grab").map((r) => r.id as DragHandleAction);

describe("task 638 (A) — the card dispatcher refuses while the partner holds the pen", () => {
  it("population self-check — the sweep found the card rows", () => {
    // Eleven rows shipped at 638. A FLOOR, so a new row fails its own leg below
    // rather than this one; if it ever drops, the sweep is stale and every leg
    // below passes vacuously.
    expect(CARD_IDS.length).toBeGreaterThanOrEqual(11);
  });

  for (const id of CARD_IDS) {
    it(`\`${id}\` mutates nothing and registers no card on a read-only editor`, async () => {
      const editor = mountDoc(FIXTURE(), false);
      expect(editor.view.editable, "precondition: the pen is held elsewhere").toBe(false);
      const before = editor.state.doc.toJSON();
      const h = makeHarness(editor);

      await h.dispatch(id, SELECTION_REF);

      expect(h.creations, `\`${id}\` registered a card while read-only`).toEqual([]);
      expect(h.popovers, `\`${id}\` opened a create popover while read-only`).toBe(0);
      expect(editor.state.doc.toJSON(), `\`${id}\` mutated the doc while read-only`).toEqual(before);
      editor.destroy();
    });

    it(`POSITIVE CONTROL: \`${id}\` does something on an editable editor`, async () => {
      const editor = mountDoc(FIXTURE(), true);
      const before = editor.state.doc.toJSON();
      const h = makeHarness(editor);

      await h.dispatch(id, SELECTION_REF);

      const didSomething =
        h.creations.length > 0 ||
        h.popovers > 0 ||
        JSON.stringify(editor.state.doc.toJSON()) !== JSON.stringify(before);
      expect(
        didSomething,
        `\`${id}\` is inert even when editable — its refusal leg proves nothing`,
      ).toBe(true);
      editor.destroy();
    });
  }
});

// ---------------------------------------------------------------------------
// (B) The deferred-commit seam
// ---------------------------------------------------------------------------

describe("task 638 (B) — a deferred atom commit refuses while the partner holds the pen", () => {
  // The exact shape `commitCitationCreate` / `handleInsertRef` use: a position
  // captured at TRIGGER time, committed later.
  const CAPTURED_POS = 5;

  it("`insertInlineAtom` refuses and leaves the document byte-identical", () => {
    const editor = mountDoc(FIXTURE(), false);
    const before = editor.state.doc.toJSON();

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "c-1", command: "\\cite{k}", displayText: "" },
      at: CAPTURED_POS,
    });

    expect(landed.refused, "the commit must report its refusal").toBe(true);
    expect(landed.pos).toBe(-1);
    expect(editor.state.doc.toJSON(), "the document is untouched").toEqual(before);
    editor.destroy();
  });

  it("POSITIVE CONTROL: the identical commit lands on an editable editor", () => {
    const editor = mountDoc(FIXTURE(), true);

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "c-1", command: "\\cite{k}", displayText: "" },
      at: CAPTURED_POS,
    });

    expect(landed.refused).toBe(false);
    let found = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === "citation") found += 1;
      return true;
    });
    expect(found, "the atom lands when editable").toBe(1);
    editor.destroy();
  });

  it("the pen can flip BETWEEN the popover's open and its commit", () => {
    // The whole point of the seam: `citationRun` was gated at open, and passed.
    // Nothing re-asked at commit, which is the window this closes.
    const editor = mountDoc(FIXTURE(), true);
    expect(editor.view.editable, "open-time: we hold the pen").toBe(true);
    const before = editor.state.doc.toJSON();

    editor.setEditable(false); // …the partner takes over while the popover is open

    const landed = insertInlineAtom({
      editor,
      type: "citation",
      attrs: { citationId: "c-1", command: "\\cite{k}", displayText: "" },
      at: CAPTURED_POS,
    });

    expect(landed.refused).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });
});
