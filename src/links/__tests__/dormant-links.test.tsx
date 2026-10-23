// @vitest-environment jsdom
//
// Task 1193 — DORMANT links ("archived with its text"). A link whose text sits
// inside an archive snippet is absent ON PURPOSE: every resolver, sweep and
// reconcile must leave it alone, nothing may draw it, and it revives by
// LIVENESS — when its uuid / mark is back in the document — not by a button.
//
// Each block below pins one reader. Every one of them fails on the pre-1193
// code if the `archivedWith` field is ignored (the resolver snapshot-rebinds,
// the rows draw an orphan, the sweep strips, the reconcile converts, …).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import type { Link } from "@/links/_shared/types";
import {
  dormantKeysOf,
  insertionTouchesDormant,
  isArchivedWithText,
  isDormantLink,
  isFullyDormant,
  markDormant as markDormantWriter,
  releaseFromSnippet,
  reviveLiveLinks,
  type DormantCardShape,
} from "@/links/dormant";
import { resolveCardAnchor, reconcileCardToResolved, type ResolveIndex } from "@/links/resolve-card-anchor";
import { resolveCardAnchorRows } from "@/links/card-anchor-rows";
import {
  clearTextAnchorLink,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
} from "@/links/links";
import { hasSeparateModeALink } from "@/links/_shared/reapply-mode-b-anchors";
import {
  ANCHORS_REVIVED_EVENT,
  dispatchAnchorsRevived,
  type AnchorsRevivedDetail,
} from "@/lib/tiptap/orphan-events";
import { useDormantRevival } from "@/hooks/useDormantRevival";
import { useReconcileModeAAnchors } from "@/hooks/useReconcileModeAAnchors";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function modeA(id: string, pid: string, snapshot?: string, archivedWith?: string): Link {
  return {
    id,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [pid],
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-10-20T00:00:00Z",
    ...(archivedWith ? { archivedWith } : {}),
  };
}

function modeB(id: string, pid: string, anchorId: string, text: string, archivedWith?: string): Link {
  return {
    id,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [pid],
      textRange: { anchorId, textSnapshot: text },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-10-20T00:00:00Z",
    ...(archivedWith ? { archivedWith } : {}),
  };
}

type Card = DormantCardShape & { kind?: string };

/** Fixture: the state task 1194's archive capture will write — every anchor
 *  link (or those in `linkIds`) dormant in `snippetId`, and the card archived
 *  WITH its text when that covers all of them. Hand-built on purpose: the app
 *  writer arrives with its caller (1194). */
function markDormant<T extends Card>(card: T, snippetId: string, linkIds?: Set<string>): T {
  const links = (card.links ?? []).map((l) =>
    l.anchor.type === "textObject" && (!linkIds || linkIds.has(l.id))
      ? { ...l, archivedWith: snippetId }
      : l,
  );
  const all = links.filter((l) => l.anchor.type === "textObject").every((l) => l.archivedWith === snippetId);
  return { ...card, links, ...(all ? { archived: true, archivedWith: snippetId } : {}) };
}

/** A hand-built index: `live` uuids, `marks` anchorId → pid, `texts` snapshot → pid. */
function index(
  live: string[],
  marks: Record<string, string> = {},
  texts: Record<string, string> = {},
): ResolveIndex {
  return {
    uuidToParagraph: new Set(live),
    uuidToPos: new Map(live.map((u, i) => [u, i * 10])),
    anchorIdToParagraph: new Map(Object.entries(marks)),
    snapshotToParagraph: (s) => texts[s] ?? null,
  };
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

describe("dormant vocabulary", () => {
  it("reviveLiveLinks revives only links whose target is live, and unarchives the card", () => {
    const card = markDormant<Card>(
      { id: "n1", links: [modeA("l1", "P1"), modeB("l2", "P9", "A1", "words")] },
      "snip",
    );
    const none = reviveLiveLinks(card, { isUuidLive: () => false, isAnchorIdLive: () => false });
    expect(none).toBe(card);

    // Mode B revives by its MARK, never by a stored pid that is live.
    const byPid = reviveLiveLinks(card, {
      isUuidLive: (u) => u === "P9",
      isAnchorIdLive: () => false,
    });
    expect(isDormantLink(byPid.links![1])).toBe(true);

    const back = reviveLiveLinks(card, {
      isUuidLive: (u) => u === "P1",
      isAnchorIdLive: (a) => a === "A1",
    });
    expect(back.links!.some(isDormantLink)).toBe(false);
    expect(back.archived).toBeUndefined();
    expect(back.archivedWith).toBeUndefined();
  });

  it("dormantKeysOf indexes exactly the dormant uuids and marks", () => {
    const keys = dormantKeysOf([
      { links: [modeA("l1", "P1", undefined, "s"), modeA("l2", "P2")] },
      { links: [modeB("l3", "P3", "A3", "t", "s")] },
    ]);
    expect([...keys.uuids]).toEqual(["P1"]);
    expect([...keys.anchorIds]).toEqual(["A3"]);
    expect(insertionTouchesDormant(keys, { uuids: ["P2"], anchorIds: [] })).toBe(false);
    expect(insertionTouchesDormant(keys, { uuids: [], anchorIds: ["A3"] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The card-level state is isFullyDormant in EVERY archive order (task 1254)
// ---------------------------------------------------------------------------

describe("a card whose anchors went into two snippets (task 1254)", () => {
  const twoLinks = (): Card => ({ id: "n1", links: [modeA("l1", "P1"), modeA("l2", "P2")] });
  const archiveBoth = (): Card => {
    const once = markDormantWriter(twoLinks(), "S1", { pids: new Set(["P1"]) });
    // Still live on P2 — the card stays active.
    expect(once.archived).toBeUndefined();
    expect(once.archivedWith).toBeUndefined();
    return markDormantWriter(once, "S2", { pids: new Set(["P2"]) });
  };
  const live = (uuid: string) => ({ isUuidLive: (u: string) => u === uuid, isAnchorIdLive: () => false });

  it("is archived with the completing snippet once every link is dormant", () => {
    const card = archiveBoth();
    expect(isFullyDormant(card)).toBe(true);
    expect(card.archived).toBe(true);
    expect(card.archivedWith).toBe("S2");
  });

  it("restoring EITHER snippet revives that link and un-archives the card", () => {
    for (const [pid, other] of [["P1", "S2"], ["P2", "S1"]] as const) {
      const back = reviveLiveLinks(archiveBoth(), live(pid));
      expect(back.archived).toBeUndefined();
      expect(back.archivedWith).toBeUndefined();
      expect(back.links!.filter(isDormantLink).map((l) => l.archivedWith)).toEqual([other]);
    }
  });

  it("the single-snippet archive is unchanged", () => {
    const card = markDormantWriter(twoLinks(), "S1", { pids: new Set(["P1", "P2"]) });
    expect(card.archived).toBe(true);
    expect(card.archivedWith).toBe("S1");
  });

  it("a hand archive stays a hand archive", () => {
    const hand = { ...twoLinks(), archived: true };
    const once = markDormantWriter(hand, "S1", { pids: new Set(["P1"]) });
    const both = markDormantWriter(once, "S2", { pids: new Set(["P2"]) });
    expect(both.archived).toBe(true);
    expect(both.archivedWith).toBeUndefined();
  });

  it("deleting the completing snippet keeps the card archived with the OTHER one", () => {
    const released = releaseFromSnippet(archiveBoth(), "S2");
    expect(released.links!.map((l) => l.id)).toEqual(["l1"]);
    expect(released.archived).toBe(true);
    expect(released.archivedWith).toBe("S1");
    // …so restoring S1 still brings the card back.
    const back = reviveLiveLinks(released, live("P1"));
    expect(back.archived).toBeUndefined();
    expect(back.links!.some(isDormantLink)).toBe(false);
  });

  it("deleting the earlier snippet leaves the card archived with the completing one", () => {
    const released = releaseFromSnippet(archiveBoth(), "S1");
    expect(released.links!.map((l) => l.id)).toEqual(["l2"]);
    expect(released.archived).toBe(true);
    expect(released.archivedWith).toBe("S2");
  });

  it("deleting the only snippet leaves an ordinary archived card", () => {
    const card = markDormantWriter(twoLinks(), "S1", { pids: new Set(["P1", "P2"]) });
    const released = releaseFromSnippet(card, "S1");
    expect(released.links).toEqual([]);
    expect(released.archived).toBe(true);
    expect(released.archivedWith).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Every reader honours it
// ---------------------------------------------------------------------------

describe("the resolver never snapshot-rebinds or orphans a dormant card", () => {
  it("an all-dormant card resolves `dormant`, even when its snapshot matches a duplicate", () => {
    const card: Card = {
      id: "n1",
      archived: true,
      archivedWith: "snip",
      links: [modeA("l1", "P1", "the duplicated text", "snip")],
    };
    const idx = index(["P7"], {}, { "the duplicated text": "P7" });
    const res = resolveCardAnchor(card, null, idx);
    expect(res.source).toBe("dormant");
    expect(res.paragraphId).toBeNull();
    // …and the reconcile writes nothing for it.
    expect(reconcileCardToResolved(card, res).changed).toBe(false);
  });

  it("a multi-anchor card resolves on its LIVE link, skipping a dormant one", () => {
    const card: Card = {
      id: "n1",
      links: [modeA("l1", "P1", "dup", "snip"), modeA("l2", "P2")],
    };
    const res = resolveCardAnchor(card, null, index(["P2", "P5"], {}, { dup: "P5" }));
    expect(res).toMatchObject({ paragraphId: "P2", source: "uuid", linkIndex: 1 });
  });

  it("the uuid reconcile does not convert a dormant highlight as a dead-mark hybrid", () => {
    const card: Card = {
      id: "n1",
      links: [modeA("l1", "P2"), modeB("l2", "P2", "A1", "words", "snip")],
    };
    const idx = index(["P2"]);
    const res = resolveCardAnchor(card, null, idx);
    const out = reconcileCardToResolved(card, res, { isAnchorIdLive: () => false });
    expect(out.card.links).toHaveLength(2);
    expect(out.card.links![1]).toEqual(card.links![1]);
  });
});

describe("the row authority draws nothing for a dormant link", () => {
  it("an all-dormant card has NO rows (not an orphan row)", () => {
    const card: Card = {
      id: "n1",
      archived: true,
      archivedWith: "snip",
      links: [modeA("l1", "P1", undefined, "snip")],
    };
    expect(resolveCardAnchorRows(card, null, index(["P2"])).rows).toEqual([]);
    // Mount gap (no index yet): still nothing — no raw stored pid row.
    expect(resolveCardAnchorRows(card, null, null).rows).toEqual([]);
  });

  it("a multi-anchor card renders only its live anchors", () => {
    const card: Card = { id: "n1", links: [modeA("l1", "P1", undefined, "snip"), modeA("l2", "P2")] };
    const rows = resolveCardAnchorRows(card, null, index(["P1", "P2"])).rows;
    expect(rows.map((r) => r.pid)).toEqual(["P2"]);
  });
});

describe("the link helpers the sweeps go through never strip a dormant link", () => {
  const card: Card = {
    id: "n1",
    links: [modeA("l1", "P1", undefined, "snip"), modeB("l2", "P2", "A2", "w", "snip"), modeA("l3", "P3")],
  };

  it("the Mode-A orphan sweep (removeTextObjectLink) keeps a dormant pid", () => {
    expect(removeTextObjectLink(card, "P1")).toBe(card);
    expect(removeTextObjectLink(card, "P3").links!.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("getTextAnchor / getLinkedTextObjectIds see only live links", () => {
    expect(getTextAnchor(card)).toBeNull();
    expect(getLinkedTextObjectIds(card)).toEqual(["P3"]);
  });

  it("setTextAnchorLink / clearTextAnchorLink carry dormant links through", () => {
    const set = setTextAnchorLink(card, "note", "A9", "new words");
    expect(set.links!.filter(isDormantLink).map((l) => l.id)).toEqual(["l1", "l2"]);
    const cleared = clearTextAnchorLink(set, "note");
    expect(cleared.links!.filter(isDormantLink).map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  it("a dormant Mode-A link is not a relocation hybrid for the Mode-B re-apply", () => {
    expect(
      hasSeparateModeALink({ id: "n1", links: [modeB("l1", "P1", "A1", "w"), modeA("l2", "P2", undefined, "s")] }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Revival by liveness — the editor side
// ---------------------------------------------------------------------------

function mainCtx(docId: string): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: docId },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountDoc(docId = "doc-1"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(docId)),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: "First." }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: "Second." }] },
      ],
    },
  });
}

const flush = () => new Promise((r) => setTimeout(r, 5));

function captureRevived(): { events: AnchorsRevivedDetail[]; stop: () => void } {
  const events: AnchorsRevivedDetail[] = [];
  const on = (e: Event) => events.push((e as CustomEvent<AnchorsRevivedDetail>).detail);
  window.addEventListener(ANCHORS_REVIVED_EVENT, on);
  return { events, stop: () => window.removeEventListener(ANCHORS_REVIVED_EVENT, on) };
}

describe("the guards announce re-inserted anchors (the reviver's feed)", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it("inserting a block with a known uuid announces it, scoped to the doc", async () => {
    editor = mountDoc();
    const cap = captureRevived();
    const end = editor.state.doc.content.size;
    editor.view.dispatch(
      editor.state.tr.insert(
        end,
        editor.schema.nodes.paragraph.create({ uuid: "PX" }, editor.schema.text("Back.")),
      ),
    );
    await flush();
    cap.stop();
    expect(cap.events.some((d) => d.docId === "doc-1" && d.uuids.includes("PX"))).toBe(true);
  });

  it("a re-inserted linkedAnchor mark is announced", async () => {
    editor = mountDoc();
    const cap = captureRevived();
    const mark = editor.schema.marks.linkedAnchor.create({ anchorId: "AX", kind: "note" });
    editor.view.dispatch(editor.state.tr.insert(1, editor.schema.text("marked ", [mark])));
    await flush();
    cap.stop();
    expect(cap.events.some((d) => d.anchorIds.includes("AX"))).toBe(true);
  });

  it("a doc Undo of a (test-constructed) capture announces the paragraph's return", async () => {
    editor = mountDoc();
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((n, pos) => {
      if (n.attrs?.uuid === "P2") {
        from = pos;
        to = pos + n.nodeSize;
        return false;
      }
      return true;
    });
    editor.view.dispatch(editor.state.tr.delete(from, to));
    await flush();
    const cap = captureRevived();
    editor.commands.undo();
    await flush();
    cap.stop();
    expect(cap.events.some((d) => d.uuids.includes("P2"))).toBe(true);
  });

  it("typing announces nothing", async () => {
    editor = mountDoc();
    const cap = captureRevived();
    for (const ch of "hello") editor.view.dispatch(editor.state.tr.insertText(ch, 2));
    await flush();
    cap.stop();
    expect(cap.events).toEqual([]);
  });
});

describe("useDormantRevival — the card-hook side", () => {
  type S = { cards: Card[] };

  function setup(initial: Card[]) {
    let updates = 0;
    const hook = renderHook(() => {
      const [state, setState] = useState<S>({ cards: initial });
      const update = (fn: (p: S) => S) => {
        updates++;
        setState(fn);
      };
      useDormantRevival<S, Card>("doc-1", update, state, (s) => s.cards, (_s, cards) => ({ cards }));
      return state;
    });
    return { hook, updates: () => updates };
  }

  it("revives exactly the matching card and unarchives it", () => {
    const dormant = markDormant<Card>({ id: "n1", links: [modeA("l1", "P1")] }, "snip");
    const other = markDormant<Card>({ id: "n2", links: [modeA("l2", "P2")] }, "snip");
    const { hook } = setup([dormant, other]);
    act(() => dispatchAnchorsRevived({ docId: "doc-1", uuids: ["P1"], anchorIds: [] }));
    const [a, b] = hook.result.current.cards;
    expect(a.archived).toBeUndefined();
    expect(a.links!.some(isDormantLink)).toBe(false);
    expect(b).toBe(other);
  });

  it("ignores another document and an insertion touching nothing dormant (zero updates)", () => {
    const dormant = markDormant<Card>({ id: "n1", links: [modeA("l1", "P1")] }, "snip");
    const { hook, updates } = setup([dormant]);
    act(() => dispatchAnchorsRevived({ docId: "doc-2", uuids: ["P1"], anchorIds: [] }));
    act(() => dispatchAnchorsRevived({ docId: "doc-1", uuids: ["P9"], anchorIds: [] }));
    expect(updates()).toBe(0);
    expect(hook.result.current.cards[0]).toBe(dormant);
  });
});

describe("load revival — useReconcileModeAAnchors", () => {
  it("a dormant link whose paragraph is live on load revives; one still archived is untouched", () => {
    const editor = mountDoc();
    type S = { cards: Card[] };
    const revivable = markDormant<Card>({ id: "n1", links: [modeA("l1", "P1")] }, "snip");
    const stillArchived = markDormant<Card>(
      { id: "n2", links: [modeA("l2", "PGONE", "Second.")] },
      "snip",
    );
    let state: S = { cards: [revivable, stillArchived] };
    const { result } = renderHook(() =>
      useReconcileModeAAnchors<S, Card>(
        (fn) => {
          state = fn(state);
        },
        () => state,
        (s) => s.cards,
        (_s, cards) => ({ cards }),
      ),
    );
    result.current(editor as never);
    const [a, b] = state.cards;
    expect(a.archived).toBeUndefined();
    expect(a.links!.some(isDormantLink)).toBe(false);
    // Its snapshot matches live P2 — a dormant link is never rebound by it.
    expect(b).toBe(stillArchived);
    editor.destroy();
  });
});

describe("the dormant fields survive the load migrators", () => {
  it("migrateCardLinks keeps Link.archivedWith; carryUnknownKeys keeps the card's", async () => {
    const { migrateCardLinks } = await import("@/links/migrate-card");
    const { carryUnknownKeys } = await import("@/lib/sidecar-migrate");
    const raw = markDormant<Card>({ id: "n1", links: [modeA("l1", "P1"), modeB("l2", "P1", "A1", "w")] }, "snip");
    const links = migrateCardLinks("note", raw);
    expect(links.every((l) => isDormantLink(l))).toBe(true);
    const card = carryUnknownKeys(raw, { id: "n1", archived: raw.archived, links });
    expect(isArchivedWithText(card as Card)).toBe(true);
  });
});
