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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
  createLinkedAnchor,
  getLinkedTextObjectIds,
  removeTextObjectLink,
  detachAnchorSources,
  type CardWithLinks,
} from "@/links/links";
import type { MarginItemHandlers, MarginItemKind } from "@/cards/delete-margin-item";
import {
  dormantSnippetOf,
  isDormantLink,
  markDormant,
  reviveLiveLinks,
  reviveRemapped,
  type CarriedKeys,
  type ReturningRemap,
} from "@/links/dormant";
import { collectBlockUuids } from "@/lib/tiptap/node-identity";
import {
  landReturningDisplaced,
  carryDisplacedAnchors,
  retargetDisplacedAnchors,
  returnDisplacedAnchors,
} from "@/cards/retarget-anchors";
import { restoreExcerptAtAnchor } from "@/lib/tiptap/restore-excerpt";
import { captureParagraphSnapshot } from "@/links/links";
import type { DisplacedAnchorRecord } from "@/lib/types";
import {
  collectRemovedAnchorUuids,
  findNextAnchorableBlock,
  resolveDisplacedAnchorPlacement,
} from "@/text-objects/anchor-resolution";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { Link } from "@/links/_shared/types";
import { buildResolveIndex } from "@/links/resolve-card-anchor";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
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
      detach: (id, sources) => {
        const arr = list();
        const i = arr.findIndex((c) => c.id === id);
        if (i >= 0) arr[i] = detachAnchorSources(arr[i], sources);
      },
      reanchor: (id, pid, targetKind, snapshot) => {
        const arr = list();
        const i = arr.findIndex((c) => c.id === id);
        if (i >= 0) arr[i] = addTextObjectLink(arr[i], "archive", pid, targetKind, snapshot);
      },
      delete: async () => true,
    } as MarginItemHandlers;
  }
  const pidsOf = (kind: MarginItemKind, id: string) => {
    const c = byKind.get(kind)!.find((x) => x.id === id);
    return c ? getLinkedTextObjectIds(c) : null;
  };
  const cardOf = (kind: MarginItemKind, id: string) =>
    byKind.get(kind)!.find((x) => x.id === id) as
      | (CardWithLinks & { archived?: boolean; archivedWith?: string })
      | undefined;
  /** The per-kind lifecycle `carry` (task 1194) over this store — the REAL
   *  `markDormant`, exactly what `useDormantRevival`'s writer applies. */
  const carry = (id: string, snippetId: string, keys: CarriedKeys) => {
    for (const arr of byKind.values()) {
      const i = arr.findIndex((c) => c.id === id);
      if (i >= 0) arr[i] = markDormant(arr[i], snippetId, keys);
    }
  };
  /** The reviver's answer against the live doc (task 1193's liveness rule). */
  const revive = (editor: Editor) => {
    const live = collectBlockUuids(editor.state.doc);
    for (const arr of byKind.values()) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = reviveLiveLinks(arr[i], {
          isUuidLive: (u) => live.has(u),
          isAnchorIdLive: () => false,
        });
      }
    }
  };
  /** The dormant cards' collision door (`useDormantRevival.returnRemapped`) —
   *  the REAL `reviveRemapped`, fed the map the restore door hands `onRemap`. */
  const returnRemapped = (snippetId: string, remap: ReturningRemap) => {
    for (const arr of byKind.values()) {
      for (let i = 0; i < arr.length; i++) arr[i] = reviveRemapped(arr[i], snippetId, remap);
    }
  };
  return { seed, handlers, pidsOf, cardOf, carry, revive, returnRemapped };
}

/** Every pid the card STORES, dormant or live — `getLinkedTextObjectIds`
 *  answers only the live ones (task 1193). */
function storedPids(card: CardWithLinks): string[] {
  return (card.links ?? []).flatMap((l) =>
    l.anchor.type === "textObject" ? l.anchor.textObjectIds : [],
  );
}

function makeHarness(
  editor: Editor,
  handlers: Record<MarginItemKind, MarginItemHandlers>,
  carry?: (id: string, snippetId: string, keys: CarriedKeys) => void,
) {
  const notify = vi.fn();
  const archiveCalls: {
    paragraphId: unknown;
    returnBefore?: unknown;
    content?: unknown;
    displaced?: DisplacedAnchorRecord[];
  }[] = [];
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
    createArchiveSnippet: (opts: {
      paragraphId?: unknown;
      returnBefore?: unknown;
      content?: unknown;
      displaced?: DisplacedAnchorRecord[];
    }) => {
      archiveCalls.push({
        paragraphId: opts.paragraphId,
        returnBefore: opts.returnBefore,
        content: opts.content,
        displaced: opts.displaced,
      });
      return { id: nextId() };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];

  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: {
      get: () => ({ delete: () => {}, ...(carry ? { carry } : {}) }),
    } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: {
      retarget: (args) => retargetDisplacedAnchors({ ...args, handlers }),
      carry: (args) => carryDisplacedAnchors({ ...args, handlers }),
    },
    // task 636: the range legs' SETTLE bag. Inert here — no card in these
    // fixtures owns a live applied splice, so `get` answers null and the ask
    // phase is a no-op (which is an ANSWER, not an omission).
    appliedSplice: {
      get: () => null,
      ask: async () => null,
      settle: () => true,
    },
    confirm: async () => true,
    notify,
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
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
    const h = makeHarness(editor, store.handlers, store.carry);

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
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    expect(h.archiveCalls).toHaveLength(1);
    expect(h.archiveCalls[0].paragraphId).toBe("p-before");
    expect(store.pidsOf("archive", "old-clip")).toEqual(["p-before"]);
  });

  // TASK 1194 RENEGOTIATES 491 FOR EVERY KIND BUT `archive`. 491 re-homed
  // every Mode-A card onto the neighbour because the passage's cards had
  // nowhere else to be. Since 1193 they do: the archive itself. Gabriel asked
  // for "an archived text AND archived notes linked to it", so a travelling
  // kind (`lifecycle.carry`) now goes INTO the snippet — link kept, dormant —
  // and comes back on Restore. Only an archive card keeps 491's stacking
  // (an archive nested in an archive is its own question).
  it("CARRIES every travelling kind into the snippet; an archive card still re-homes", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    const travelling: MarginItemKind[] = ["note", "todo", "cut", "revision", "report"];
    for (const kind of [...travelling, "archive"] as MarginItemKind[]) {
      store.seed(kind, `${kind}-1`, ["p-target"]);
    }
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    expect(store.pidsOf("archive", "archive-1")).toEqual(["p-before"]);
    const snippetId = "card-1";
    for (const kind of travelling) {
      const card = store.cardOf(kind, `${kind}-1`)!;
      // Nothing re-homed onto the neighbour, nothing deleted: the link is the
      // same link, dormant in the snippet, and the card archived with it.
      expect(storedPids(card)).toEqual(["p-target"]);
      expect(getLinkedTextObjectIds(card)).toEqual([]); // no live row
      expect(card.links!.every(isDormantLink)).toBe(true);
      expect(dormantSnippetOf(card)).toBe(snippetId);
      expect(card.archived).toBe(true);
    }
    // …and the snippet records no displacement for them: nothing to hand back.
    expect(h.archiveCalls[0].displaced).toEqual([
      { kind: "archive", id: "archive-1", from: ["p-target"], to: "p-before", added: true },
    ]);
  });

  it("a multi-anchor card stays ACTIVE on its surviving anchor; only the archived link sleeps", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "multi", ["p-target", "p-after"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    const card = store.cardOf("note", "multi")!;
    expect(new Set(storedPids(card))).toEqual(new Set(["p-target", "p-after"]));
    expect(getLinkedTextObjectIds(card)).toEqual(["p-after"]);
    expect(card.links!.filter(isDormantLink).map((l) => (l.anchor as { textObjectIds: string[] }).textObjectIds)).toEqual([["p-target"]]);
    expect(card.archived).toBeUndefined();
    expect(dormantSnippetOf(card)).toBeNull();
  });

  it("a card also on the neighbour gains no neighbour row — it was there already", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "both", ["p-target", "p-before"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    const card = store.cardOf("note", "both")!;
    expect(storedPids(card)).toEqual(["p-target", "p-before"]);
    expect(card.links!.map(isDormantLink)).toEqual([true, false]);
    expect(card.archived).toBeUndefined();
  });

  it("falls FORWARD when the captured passage is the document's first block", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "first-clip", ["p-before"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", { kind: "paragraph", id: "p-before" } as DragHandleRef);

    // Pre-491 the snippet anchored to "" (unanchored) and the displaced card
    // orphaned: nothing above the first block to fall back on.
    expect(store.pidsOf("archive", "first-clip")).toEqual(["p-target"]);
    expect(h.archiveCalls[0].paragraphId).toBe("p-target");
    // Task 965: the passage left from just BEFORE its anchor, and only the
    // capture can see that — so the snippet records it for Restore.
    expect(h.archiveCalls[0].returnBefore).toBe("p-target");
  });

  it("an ordinary (preceding-neighbour) archive records NO return side — absent ≡ after (task 965)", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const h = makeHarness(editor, makeCardStore().handlers);

    await h.dispatch("archive", TARGET_REF);

    expect(h.archiveCalls[0].paragraphId).toBe("p-before");
    expect(h.archiveCalls[0].returnBefore).toBeUndefined();
  });

  it("a plain DELETE still ORPHANS — the two actions mean different things", async () => {
    // RENEGOTIATED half of task 393's equality (its Mode-B leg is untouched):
    // a delete genuinely removes the context, so the card has nowhere to be and
    // stays on the orphan path. Only the SET-ASIDE re-homes.
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "doomed", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

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
    const h = makeHarness(editor, store.handlers, store.carry);

    // A stale ref never resolves, so the branch bails before the capture.
    await h.dispatch("archive", { kind: "paragraph", id: "p-nope" } as DragHandleRef);

    expect(store.pidsOf("archive", "safe")).toEqual(["p-target"]);
    expect(editor.state.doc.textContent).toContain("Target passage.");
  });
});

// ---------------------------------------------------------------------------
// Task 1328 — a Mode-B link's stored pids are its BIRTH RECORD, not where it
// is. Highlight words in P, press Enter before them: the mark rides into P'
// while the stored pid stays P (the task-934 state). Archiving P used to read
// the stored pid as the anchor — `unanchor(P)` (a no-op on a Mode-B link) then
// `reanchor(neighbour)` — so a highlight whose live mark was never touched
// gained a spurious second marker on the neighbour.
// ---------------------------------------------------------------------------

function modeBArchiveLink(anchorId: string, textObjectIds: string[]): Link {
  return {
    id: anchorId,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds,
      textRange: { anchorId, textSnapshot: "passage" },
    },
    target: { type: "card", ref: { kind: "archive", id: "hl" } },
    createdAt: "",
  };
}

/** Highlight "passage" in p-target; return its mark id. */
function highlightPassage(editor: Editor): string {
  const from = 1 + "Before.".length + 2 + "Target ".length;
  const rec = createLinkedAnchor(editor, "archive", { from, to: from + "passage".length });
  if (!rec) throw new Error("expected a linkedAnchor record");
  return rec.anchorId;
}

describe("task 1328 — the archive re-home reads where a Mode-B link IS, not where it was born", () => {
  it("archiving the block a highlight's STORED pid names, while its mark lives in P', changes nothing", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const anchorId = highlightPassage(editor);
    // Enter before the highlighted word: the mark rides into the new tail P'.
    editor.chain().setTextSelection(1 + "Before.".length + 2 + "Target ".length).splitBlock().run();
    const markPid = buildResolveIndex(editor).anchorIdToParagraph.get(anchorId)!;
    expect(markPid).not.toBe("p-target");

    const store = makeCardStore();
    const card = store.seed("archive", "hl", []);
    const links = [modeBArchiveLink(anchorId, ["p-target"])];
    card.links = links;
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    expect(editor.state.doc.textContent).not.toContain("Target passage");
    expect(store.cardOf("archive", "hl")!.links, "no new link, no unanchor").toEqual(links);
    expect(buildResolveIndex(editor).anchorIdToParagraph.get(anchorId)).toBe(markPid);
    expect(h.archiveCalls[0].displaced ?? []).toEqual([]);
  });

  it("CONTROL — a Mode-B link whose mark IS in the archived block still re-homes as before", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const anchorId = highlightPassage(editor);
    const store = makeCardStore();
    const card = store.seed("archive", "hl", []);
    card.links = [modeBArchiveLink(anchorId, ["p-target"])];
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);

    expect(store.pidsOf("archive", "hl")).toContain("p-before");
    expect(h.archiveCalls[0].displaced?.map((d) => d.id)).toEqual(["hl"]);
  });
});

// ---------------------------------------------------------------------------
// The resolver's own rungs. Driven against a REAL doc so the container descent
// and the strict-containment rule are exercised, not restated.
// ---------------------------------------------------------------------------

describe("resolveDisplacedAnchorPlacement — the neighbour", () => {
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
    expect(resolveDisplacedAnchorPlacement(listDoc, tailPos, listDoc.content.size, new Set())?.target.uuid).toBe("li-2");
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
    expect(resolveDisplacedAnchorPlacement(d, inside, inside + 2, new Set())?.target.uuid).toBe("p-target");
  });

  it("returns null when nothing anchorable survives", () => {
    const d = doc(threeParagraphDoc());
    const removed = new Set(["p-before", "p-target", "p-after"]);
    expect(resolveDisplacedAnchorPlacement(d, 0, d.content.size, removed)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 1079 — Archive → Restore is a round trip for the MARGIN too. The
// capture records which cards it re-homed; Restore hands them back to the
// passage it returns, through the pane's ONE door (`landReturningDisplaced`).
// ---------------------------------------------------------------------------

describe("task 1079 — Restore returns the cards the archive displaced", () => {
  /** The pane's Restore, minus React: land at the clip's return address
   *  (task 965) through the same door `handleArchiveRestore` uses. */
  function restore(
    editor: Editor,
    handlers: Record<MarginItemKind, MarginItemHandlers>,
    call: { paragraphId: unknown; returnBefore?: unknown; content?: unknown; displaced?: DisplacedAnchorRecord[] },
    onRemap?: (remap: ReturningRemap) => void,
  ): boolean {
    const anchor = call.paragraphId as string;
    return landReturningDisplaced({
      doc: () => editor.state.doc,
      content: call.content as JSONContent,
      land: (fresh) =>
        restoreExcerptAtAnchor(editor, fresh, {
          uuid: anchor,
          side: call.returnBefore === anchor ? "before" : "after",
        }) === true,
      onRemap,
      displaced: call.displaced,
      retarget: { returnDisplaced: (args) => returnDisplacedAnchors({ ...args, handlers }) },
      snapshotOf: (uuid) => captureParagraphSnapshot(editor, uuid),
    });
  }

  function uuidsInOrder(editor: Editor): string[] {
    const out: string[] = [];
    editor.state.doc.forEach((n) => out.push(n.attrs.uuid as string));
    return out;
  }

  // Since task 1194 only an ARCHIVE card is re-homed (and so recorded in
  // `displaced`); the travelling kinds are carried dormant instead. These
  // 1079 legs therefore drive an archive card through the re-home path, and
  // the carried kinds get their own round trip below.
  it("the archive card goes back to the restored paragraph, which keeps its uuid", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "n", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    expect(store.pidsOf("archive", "n")).toEqual(["p-before"]);
    expect(h.archiveCalls[0].displaced).toEqual([
      { kind: "archive", id: "n", from: ["p-target"], to: "p-before", added: true },
    ]);

    expect(restore(editor, store.handlers, h.archiveCalls[0])).toBe(true);

    // THE DEFECT LEG: pre-1079 the card stayed stacked on p-before.
    expect(uuidsInOrder(editor)).toEqual(["p-before", "p-target", "p-after"]);
    expect(store.pidsOf("archive", "n")).toEqual(["p-target"]);
  });

  it("a CARRIED note comes back with its paragraph: same link, revived by liveness (task 1194)", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "n", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    expect(store.cardOf("note", "n")!.archived).toBe(true);

    expect(restore(editor, store.handlers, h.archiveCalls[0])).toBe(true);
    expect(uuidsInOrder(editor)).toEqual(["p-before", "p-target", "p-after"]);
    store.revive(editor);

    const card = store.cardOf("note", "n")!;
    expect(getLinkedTextObjectIds(card)).toEqual(["p-target"]);
    expect(card.links!.some(isDormantLink)).toBe(false);
    expect(card.archived).toBeUndefined();
    expect(dormantSnippetOf(card)).toBeNull();
  });

  it("every Mode-A kind round-trips, and a card already on the neighbour keeps that anchor", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    const kinds: MarginItemKind[] = ["note", "todo", "cut", "revision", "report", "archive"];
    for (const kind of kinds) store.seed(kind, `${kind}-1`, ["p-target"]);
    store.seed("note", "both", ["p-target", "p-before"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    restore(editor, store.handlers, h.archiveCalls[0]);
    // The carried kinds come back by liveness (task 1194); the archive card
    // through the 1079 hand-back.
    store.revive(editor);

    for (const kind of kinds) expect(store.pidsOf(kind, `${kind}-1`)).toEqual(["p-target"]);
    // It was on p-before BEFORE the archive — the capture didn't put it there,
    // so the restore doesn't take it away.
    expect(new Set(store.pidsOf("note", "both"))).toEqual(new Set(["p-before", "p-target"]));
  });

  it("a card the user moved between archive and restore stays where they put it", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "n", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    // The user re-anchors the card to p-after.
    store.handlers.archive.unanchor("n", "p-before");
    store.handlers.archive.reanchor("n", "p-after", "paragraph", null);

    restore(editor, store.handlers, h.archiveCalls[0]);

    expect(store.pidsOf("archive", "n")).toEqual(["p-after"]);
  });

  // Task 1253 renegotiates this leg. Pre-1194 the collision was answered by
  // `BlockUuidBackfill`'s re-mint, so the new id was unknowable and the card
  // had to stay on the neighbour. Since 1194 the restore door mints the fresh
  // id itself and knows old → new — so the displaced card follows its block,
  // onto the SAME id the dormant cards of that restore revive on.
  it("a restore whose uuid COLLIDES returns the displaced card to the block's FRESH uuid", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "n", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    // Something else now holds the archived uuid (e.g. the user pasted the
    // text back), so the returning block cannot keep `p-target`.
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [{ type: "text", text: "Squatter." }],
    });
    expect(editor.state.doc.textContent).toContain("Squatter.");

    let remap: ReadonlyMap<string, string> = new Map();
    expect(restore(editor, store.handlers, h.archiveCalls[0], (m) => (remap = m.uuids))).toBe(true);

    const fresh = remap.get("p-target");
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe("p-target");
    // The returned passage sits under the fresh id; the squatter keeps its own.
    const uuids = uuidsInOrder(editor);
    expect(uuids.filter((u) => u === "p-target")).toHaveLength(1);
    expect(uuids).toContain(fresh);
    // THE DEFECT LEG: pre-1253 the card stayed on p-before. The neighbour link
    // the capture added is dropped.
    expect(store.pidsOf("archive", "n")).toEqual([fresh]);
  });

  it("a colliding restore lands a DORMANT card and a DISPLACED card on the same fresh uuid", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("note", "carried", ["p-target"]); // travels dormant (task 1194)
    store.seed("archive", "moved", ["p-target"]); // re-homed + recorded (task 1079)
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    const snippetId = dormantSnippetOf(store.cardOf("note", "carried")!);
    expect(snippetId).toBeTruthy();
    expect(store.pidsOf("archive", "moved")).toEqual(["p-before"]);

    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [{ type: "text", text: "Squatter." }],
    });

    let remap: ReadonlyMap<string, string> = new Map();
    restore(editor, store.handlers, h.archiveCalls[0], (m) => {
      remap = m.uuids;
      store.returnRemapped(snippetId!, m);
    });
    const fresh = remap.get("p-target")!;
    expect(fresh).toBeTruthy();

    const carried = store.cardOf("note", "carried")!;
    expect(getLinkedTextObjectIds(carried)).toEqual([fresh]);
    expect(carried.links!.some(isDormantLink)).toBe(false);
    expect(store.pidsOf("archive", "moved")).toEqual([fresh]);
  });

  it("a restore with NO collision hands onRemap nothing and keeps the original uuid", async () => {
    const editor = mountDoc(threeParagraphDoc());
    const store = makeCardStore();
    store.seed("archive", "n", ["p-target"]);
    const h = makeHarness(editor, store.handlers, store.carry);

    await h.dispatch("archive", TARGET_REF);
    const onRemap = vi.fn();
    restore(editor, store.handlers, h.archiveCalls[0], onRemap);

    expect(onRemap).not.toHaveBeenCalled();
    expect(store.pidsOf("archive", "n")).toEqual(["p-target"]);
  });

  it("a REFUSED landing hands nothing back", () => {
    const store = makeCardStore();
    store.seed("note", "n", ["p-before"]);
    const landed = landReturningDisplaced({
      doc: () => null,
      content: { type: "doc", content: [] },
      land: () => false,
      displaced: [{ kind: "note", id: "n", from: ["p-target"], to: "p-before", added: true }],
      retarget: { returnDisplaced: () => { throw new Error("must not run"); } },
      snapshotOf: () => null,
    });
    expect(landed).toBe(false);
    expect(store.pidsOf("note", "n")).toEqual(["p-before"]);
  });
});
