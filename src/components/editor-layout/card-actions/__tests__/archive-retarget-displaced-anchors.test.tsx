// @vitest-environment jsdom
//
// TASK 491 — archiving a passage that carries another card's anchor must not
// "lose" that card.
//
// Gabriel, from a real paper (remote drop 2026-08-26): *"when you archive a
// passage that has an archive card, you loose the original archive card. they
// should just stack up on the preceeding paragraph."*
//
// THE PRE-491 CONTRACT, and why it was a contract rather than an accident: task
// 393 pinned "archiving text that carries another card's anchor puts that card
// on the normal ORPHAN path" as an EQUALITY with a plain Delete over the same
// range. That leg is about a **Mode-B** (`linkedAnchor`) card, and it is
// UNCHANGED — a Mode-B anchor names the TEXT RANGE, which is exactly what left.
// What this suite renegotiates is the **Mode-A** half: a paragraph-anchored
// card's anchor is an IDENTITY the surviving neighbour can carry, and an archive
// SETS THE TEXT ASIDE rather than destroying it, so the reader's margin context
// re-homes instead of vanishing into the pod header's "N unanchored" chip.
//
// WHY NO PRE-491 SUITE COULD SEE THIS: every archive fixture in the repo either
// has no other card in the captured range at all, or (task 393's) carries a
// Mode-B mark, whose fate is decided by `cleanupLinksInRange` rather than by any
// anchor question. A Mode-A card anchored INSIDE the captured range is
// unrepresentable in all of them.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack and the REAL `links.ts` mutators, so the section resolution,
// the cascade, the capture, the retarget and the delete all run for real.
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
import {
  addTextObjectLink,
  getLinkedTextObjectIds,
  removeTextObjectLink,
  type CardWithLinks,
} from "@/links/links";
import type { MarginItemHandlers, MarginItemKind } from "@/cards/delete-margin-item";
import { retargetDisplacedAnchors } from "@/cards/retarget-anchors";
import {
  collectRemovedAnchorUuids,
  findNextAnchorableBlock,
  resolveDisplacedAnchorTarget,
} from "@/text-objects/anchor-resolution";
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
// Fixture: three top-level paragraphs; a Mode-A ARCHIVE card anchored to the
// middle one, which is what the user archives.
// ---------------------------------------------------------------------------

function threeParagraphDoc(): JSONContent[] {
  return [
    { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
    { type: "paragraph", attrs: { uuid: "p-target" }, content: [{ type: "text", text: "Target passage." }] },
    { type: "paragraph", attrs: { uuid: "p-after" }, content: [{ type: "text", text: "After." }] },
  ];
}

/** A live in-memory card store per kind, mutated through the REAL link
 *  mutators — so the links this suite asserts on have the shape the sidecar
 *  actually persists. */
function makeCardStore() {
  const byKind = new Map<MarginItemKind, CardWithLinks[]>();
  const KINDS: MarginItemKind[] = ["note", "archive", "cut", "todo", "revision", "report"];
  for (const k of KINDS) byKind.set(k, []);

  const seed = (kind: MarginItemKind, id: string, pids: string[]) => {
    let card = { id, kind, links: [] } as unknown as CardWithLinks;
    for (const pid of pids) card = addTextObjectLink(card, "archive", pid, "paragraph");
    byKind.get(kind)!.push(card);
    return card;
  };

  const handlers = {} as Record<MarginItemKind, MarginItemHandlers>;
  for (const kind of KINDS) {
    const list = () => byKind.get(kind)!;
    handlers[kind] = {
      findCard: (id) => list().find((c) => c.id === id),
      get cards() {
        return list();
      },
      contentKind: "archive",
      unanchor: (id, pid) => {
        const arr = list();
        const i = arr.findIndex((c) => c.id === id);
        if (i >= 0) arr[i] = removeTextObjectLink(arr[i], pid);
      },
      reanchor: (id, pid, targetKind, snapshot) => {
        const arr = list();
        const i = arr.findIndex((c) => c.id === id);
        if (i >= 0) arr[i] = addTextObjectLink(arr[i], "archive", pid, targetKind, snapshot);
      },
      delete: () => {},
    } as MarginItemHandlers;
  }
  const pidsOf = (kind: MarginItemKind, id: string) => {
    const c = byKind.get(kind)!.find((x) => x.id === id);
    return c ? getLinkedTextObjectIds(c) : null;
  };
  return { seed, handlers, pidsOf };
}

function makeHarness(editor: Editor, handlers: Record<MarginItemKind, MarginItemHandlers>) {
  const notify = vi.fn();
  const archiveCalls: { paragraphId: unknown }[] = [];
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
    createArchiveSnippet: (opts: { paragraphId?: unknown }) => {
      archiveCalls.push({ paragraphId: opts.paragraphId });
      return { id: nextId() };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: { get: () => ({ delete: () => {} }) } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: {
      retarget: (args) => retargetDisplacedAnchors({ ...args, handlers }),
    },
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
    archiveCalls,
    notify,
  };
}

const TARGET_REF = { kind: "paragraph", id: "p-target" } as DragHandleRef;

describe("task 491 — an archived passage re-homes the cards it displaced", () => {
  it("moves a Mode-A anchor inside the captured range onto the PRECEDING paragraph", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "old-clip", ["p-target"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", TARGET_REF);

    // THE DEFECT LEG. Pre-491 the card kept naming `p-target`, which the
    // orphan sweep then stripped: the marker left the margin entirely.
    expect(store.pidsOf("archive", "old-clip")).toEqual(["p-before"]);
    // …and the passage really did leave the document.
    expect(editor.state.doc.textContent).not.toContain("Target passage.");
  });

  it("STACKS the displaced card on the same paragraph the fresh snippet takes", async () => {
    // "they should just stack up on the preceeding paragraph" — one neighbour
    // resolved once for the whole gesture, so both halves land together.
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "old-clip", ["p-target"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", TARGET_REF);

    expect(h.archiveCalls).toHaveLength(1);
    expect(h.archiveCalls[0].paragraphId).toBe("p-before");
    expect(store.pidsOf("archive", "old-clip")).toEqual(["p-before"]);
  });

  it("re-homes EVERY paragraph-anchored kind, not just archive cards", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    for (const kind of ["note", "todo", "cut", "revision", "report", "archive"] as MarginItemKind[]) {
      store.seed(kind, `${kind}-1`, ["p-target"]);
    }
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", TARGET_REF);

    for (const kind of ["note", "todo", "cut", "revision", "report", "archive"] as MarginItemKind[]) {
      expect(store.pidsOf(kind, `${kind}-1`)).toEqual(["p-before"]);
    }
  });

  it("a multi-anchor card moves ONLY the consumed anchor", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "multi", ["p-target", "p-after"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", TARGET_REF);

    const pids = store.pidsOf("note", "multi")!;
    expect(new Set(pids)).toEqual(new Set(["p-after", "p-before"]));
  });

  it("a card already anchored to the neighbour gains no DUPLICATE row", async () => {
    // Repeated adjacent archives converge on one survivor; a second identical
    // link would paint a second marker on it.
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "both", ["p-target", "p-before"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", TARGET_REF);

    expect(store.pidsOf("note", "both")).toEqual(["p-before"]);
  });

  it("falls FORWARD when the captured passage is the document's first block", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "first-clip", ["p-before"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("archive", { kind: "paragraph", id: "p-before" } as DragHandleRef);

    // Pre-491 the snippet anchored to "" (unanchored) and the displaced card
    // orphaned: nothing above the first block to fall back on.
    expect(store.pidsOf("archive", "first-clip")).toEqual(["p-target"]);
    expect(h.archiveCalls[0].paragraphId).toBe("p-target");
  });

  it("a plain DELETE still ORPHANS — the two actions mean different things", async () => {
    // RENEGOTIATED half of task 393's equality (its Mode-B leg is untouched):
    // a delete genuinely removes the context, so the card has nowhere to be and
    // stays on the orphan path. Only the SET-ASIDE re-homes.
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "doomed", ["p-target"]);
    const h = makeHarness(editor, store.handlers);

    await h.dispatch("delete", TARGET_REF);

    expect(store.pidsOf("archive", "doomed")).toEqual(["p-target"]);
    expect(editor.state.doc.textContent).not.toContain("Target passage.");
  });

  it("a REFUSED capture retargets nothing — the sweep runs after the guard", async () => {
    // The never-destroy invariant aborts before anything is dispatched; the
    // retarget must sit inside that branch, or a refusal moves anchors for a
    // passage that is still in the document.
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
      { type: "paragraph", attrs: { uuid: "p-target" }, content: [{ type: "text", text: "Target passage." }] },
    ]);
    const store = makeCardStore();
    store.seed("archive", "safe", ["p-target"]);
    const h = makeHarness(editor, store.handlers);

    // A stale ref never resolves, so the branch bails before the capture.
    await h.dispatch("archive", { kind: "paragraph", id: "p-nope" } as DragHandleRef);

    expect(store.pidsOf("archive", "safe")).toEqual(["p-target"]);
    expect(editor.state.doc.textContent).toContain("Target passage.");
  });
});

// ---------------------------------------------------------------------------
// The resolver's own rungs. Driven against a REAL doc so the container descent
// and the strict-containment rule are exercised, not restated.
// ---------------------------------------------------------------------------

describe("resolveDisplacedAnchorTarget", () => {
  function doc(content: JSONContent[]) {
    return mountDoc(content).state.doc;
  }

  it("collects only blocks WHOLLY inside the range", () => {
    const d = doc(threeParagraphDoc());
    // The whole second paragraph: [pos, pos + nodeSize).
    let from = -1;
    let to = -1;
    d.descendants((node, pos) => {
      if (node.attrs?.uuid === "p-target") { from = pos; to = pos + node.nodeSize; }
      return true;
    });
    expect(collectRemovedAnchorUuids(d, from, to)).toEqual(new Set(["p-target"]));
    // Reaching one position INTO the next block does not consume it.
    expect(collectRemovedAnchorUuids(d, from, to + 1)).toEqual(new Set(["p-target"]));
  });

  it("descends into a container's LAST child going backward and FIRST going forward", () => {
    const listDoc = doc([
      {
        type: "bulletList",
        attrs: { uuid: "ul" },
        content: [
          { type: "listItem", attrs: { uuid: "li-1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          { type: "listItem", attrs: { uuid: "li-2" }, content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
        ],
      },
      { type: "paragraph", attrs: { uuid: "p-tail" }, content: [{ type: "text", text: "Tail." }] },
    ]);
    // Backward from the tail paragraph lands on the list's LAST item.
    let tailPos = -1;
    listDoc.descendants((node, pos) => {
      if (node.attrs?.uuid === "p-tail") tailPos = pos;
      return true;
    });
    expect(resolveDisplacedAnchorTarget(listDoc, tailPos, listDoc.content.size, new Set())?.uuid).toBe("li-2");
    // Forward from the document start lands on the list's FIRST item.
    expect(findNextAnchorableBlock(listDoc, 0)?.uuid).toBe("li-1");
  });

  it("keeps a partially-captured HOST block rather than its neighbour", () => {
    const d = doc(threeParagraphDoc());
    let inside = -1;
    d.descendants((node, pos) => {
      if (node.attrs?.uuid === "p-target") inside = pos + 3; // mid-text
      return true;
    });
    expect(resolveDisplacedAnchorTarget(d, inside, inside + 2, new Set())?.uuid).toBe("p-target");
  });

  it("returns null when nothing anchorable survives", () => {
    const d = doc(threeParagraphDoc());
    const removed = new Set(["p-before", "p-target", "p-after"]);
    expect(resolveDisplacedAnchorTarget(d, 0, d.content.size, removed)).toBeNull();
  });
});
