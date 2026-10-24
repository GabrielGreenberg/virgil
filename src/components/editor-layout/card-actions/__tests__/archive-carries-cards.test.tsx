// @vitest-environment jsdom
//
// TASK 1194 — archiving a passage CARRIES the cards attached to it, and
// Restore brings the text AND its cards back.
//
// Gabriel (2026-10-20): "an archived text AND archived notes linked to it".
// Before this task an archive re-homed a Mode-A card onto the preceding
// paragraph (task 491) and DELETED a Mode-B card through its kind's
// `lifecycle.delete` (task 393) — so the notes on a passage you set aside were
// either stacked on the wrong paragraph or gone. Now every kind that declares
// `lifecycle.carry` travels: its links go dormant in the snippet (1193's
// state), the snippet records the `linkedAnchor` runs those cards rode on
// (`carriedMarks`, offsets inside the captured content), and Restore
// re-stamps them over exactly the same words — which is what revives the
// links by liveness.
//
// These drive the REAL `useDragHandleActions` hook over the REAL main-editor
// extension stack, the REAL `markDormant` / `reviveLiveLinks`, and the REAL
// landing door (`restoreExcerptAtAnchor`) with the pane's re-stamp
// (`withCarriedMarks`), so capture, carry, record, land and revive all run.
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
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  useDragHandleActions,
  type DragHandleActionsDeps,
  type DragHandleRef,
} from "../drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";
import type { Link } from "@/links/_shared/types";
import {
  dormantSnippetOf,
  isDormantLink,
  markDormant,
  reviveLiveLinks,
  reviveRemapped,
  type CarriedKeys,
  type DormantCardShape,
  type ReturningRemap,
} from "@/links/dormant";
import type { MarginItemHandlers, MarginItemKind } from "@/cards/delete-margin-item";
import {
  carryDisplacedAnchors,
  landReturningDisplaced,
  retargetDisplacedAnchors,
} from "@/cards/retarget-anchors";
import { restoreExcerptAtAnchor } from "@/lib/tiptap/restore-excerpt";
import { collectBlockUuids } from "@/lib/tiptap/node-identity";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import type { CarriedMarkRecord } from "@/lib/types";

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
beforeEach(() => {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture: P carries a Mode-B NOTE mark over "beta gamma", a Mode-B HIGHLIGHT
// over "delta", and a Mode-A note on the whole paragraph.
// ---------------------------------------------------------------------------

function mark(anchorId: string, card: string): JSONContent["marks"] {
  return [
    {
      type: "linkedAnchor",
      attrs: { anchorId, linkId: anchorId, linkKind: "anchor", linkCard: card },
    },
  ];
}

function doc(): JSONContent[] {
  return [
    { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
    {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [
        { type: "text", text: "Alpha " },
        { type: "text", text: "beta gamma", marks: mark("A-note", "note:m1") },
        { type: "text", text: " " },
        { type: "text", text: "delta", marks: mark("A-hl", "highlight:h1") },
        { type: "text", text: "." },
      ],
    },
    { type: "paragraph", attrs: { uuid: "p-after" }, content: [{ type: "text", text: "After." }] },
  ];
}

function modeA(pid: string): Link {
  return {
    id: `la-${pid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [pid] },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-10-20T00:00:00Z",
  } as Link;
}

function modeB(pid: string, anchorId: string, text: string): Link {
  return {
    id: `lb-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [pid],
      textRange: { anchorId, textSnapshot: text },
    },
    target: { type: "card", ref: { kind: "note", id: "x" } },
    createdAt: "2026-10-20T00:00:00Z",
  } as Link;
}

type Card = DormantCardShape & { kind: string };

/** One store for the whole fixture; `carry` is the real `markDormant`. */
function makeStore(cards: Card[]) {
  const all = cards.map((c) => ({ ...c }));
  const byId = (id: string) => all.find((c) => c.id === id)!;
  const carry = (id: string, snippetId: string, keys: CarriedKeys) => {
    const i = all.findIndex((c) => c.id === id);
    if (i >= 0) all[i] = markDormant(all[i], snippetId, keys);
  };
  const handlers = {} as Record<MarginItemKind, MarginItemHandlers>;
  for (const kind of ["note", "archive", "cut", "todo", "revision", "report"] as MarginItemKind[]) {
    handlers[kind] = {
      findCard: (id: string) => all.find((c) => c.id === id && c.kind === kind),
      get cards() {
        return all.filter((c) => c.kind === kind);
      },
      contentKind: "note",
      unanchor: () => {},
      detach: () => {},
      reanchor: () => {},
      delete: async () => true,
    } as unknown as MarginItemHandlers;
  }
  /** The reviver, against the live document (task 1193's liveness rule). */
  const revive = (editor: Editor) => {
    const uuids = collectBlockUuids(editor.state.doc);
    const anchorIds = new Set<string>();
    editor.state.doc.descendants((n) => {
      for (const m of n.marks) if (m.type.name === "linkedAnchor") anchorIds.add(m.attrs.anchorId);
      return true;
    });
    for (let i = 0; i < all.length; i++) {
      all[i] = reviveLiveLinks(all[i], {
        isUuidLive: (u) => uuids.has(u),
        isAnchorIdLive: (a) => anchorIds.has(a),
      });
    }
  };
  /** The hooks' `returnRemapped` door over this store. */
  const returnRemapped = (snippetId: string, remap: ReturningRemap) => {
    for (let i = 0; i < all.length; i++) all[i] = reviveRemapped(all[i], snippetId, remap);
  };
  return { byId, carry, handlers, revive, returnRemapped };
}

function fixtureStore() {
  return makeStore([
    { id: "m1", kind: "note", links: [modeB("p-target", "A-note", "beta gamma")] },
    { id: "h1", kind: "highlight", links: [modeB("p-target", "A-hl", "delta")] },
    { id: "n1", kind: "note", links: [modeA("p-target")] },
  ]);
}

interface SnippetCall {
  id: string;
  paragraphId: unknown;
  returnBefore?: unknown;
  content: JSONContent;
  carriedMarks?: CarriedMarkRecord[];
}

function makeHarness(editor: Editor, store: ReturnType<typeof makeStore>) {
  const snippets: SnippetCall[] = [];
  const deletes: string[] = [];
  let n = 0;
  const cardCreation = {
    createArchiveSnippet: (opts: {
      paragraphId?: unknown;
      returnBefore?: unknown;
      content?: unknown;
      carriedMarks?: CarriedMarkRecord[];
    }) => {
      const id = `snip-${++n}`;
      snippets.push({
        id,
        paragraphId: opts.paragraphId,
        returnBefore: opts.returnBefore,
        content: opts.content as JSONContent,
        carriedMarks: opts.carriedMarks,
      });
      return { id };
    },
  } as unknown as DragHandleActionsDeps["cardCreation"];
  const deps: DragHandleActionsDeps = {
    editorRef: { current: { getEditor: () => editor } as never },
    cardCreation,
    cardLifecycle: {
      get: (kind: string) => ({
        delete: (id: string) => deletes.push(`${kind}:${id}`),
        ...(CARD_REGISTRY[kind as CardKind]?.lifecycle.carry ? { carry: store.carry } : {}),
      }),
    } as unknown as DragHandleActionsDeps["cardLifecycle"],
    anchorRetarget: {
      retarget: (args) => retargetDisplacedAnchors({ ...args, handlers: store.handlers }),
      carry: (args) => carryDisplacedAnchors({ ...args, handlers: store.handlers }),
    },
    appliedSplice: { get: () => null, ask: async () => null, settle: () => true },
    confirm: async () => true,
    notify: vi.fn(),
    prefs: { placements: [], activeLeft: null, activeRight: null } as never,
    expandLeft: () => {},
    expandRight: () => {},
  };
  const { result } = renderHook(() => useDragHandleActions(deps));
  return {
    dispatch: result.current.dispatch as (a: DragHandleAction, r: DragHandleRef) => Promise<void>,
    snippets,
    deletes,
  };
}

/** The pane's Restore, minus React — the SAME door `handleArchiveRestore`
 *  calls (`landReturningDisplaced`): re-stamp the carried marks by their
 *  words, freshen colliding uuids AND anchorIds, land at the return address,
 *  and hand any remap to the stores' `returnRemapped`. */
function restore(
  editor: Editor,
  s: SnippetCall,
  returnRemapped?: (snippetId: string, remap: ReturningRemap) => void,
): boolean {
  const anchor = s.paragraphId as string;
  return landReturningDisplaced({
    doc: () => editor.state.doc,
    content: s.content,
    carriedMarks: s.carriedMarks,
    land: (content) =>
      restoreExcerptAtAnchor(editor, content, {
        uuid: anchor,
        side: s.returnBefore === anchor ? "before" : "after",
      }) === true,
    onRemap: (remap) => returnRemapped?.(s.id, remap),
    displaced: undefined,
    retarget: { returnDisplaced: () => 0 },
    snapshotOf: () => null,
  });
}

/** The words a `linkedAnchor` covers in the live doc. */
function markedText(editor: Editor, anchorId: string): string {
  let out = "";
  editor.state.doc.descendants((n) => {
    if (n.isText && n.marks.some((m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId)) {
      out += n.text;
    }
    return true;
  });
  return out;
}

function uuidsInOrder(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => out.push(node.attrs.uuid as string));
  return out;
}

function posOf(editor: Editor, needle: string): { from: number; to: number } {
  let found = { from: -1, to: -1 };
  editor.state.doc.descendants((n, pos) => {
    if (found.from >= 0 || !n.isText) return true;
    const i = n.text!.indexOf(needle);
    if (i >= 0) found = { from: pos + i, to: pos + i + needle.length };
    return true;
  });
  return found;
}

const P_REF = { kind: "paragraph", id: "p-target" } as DragHandleRef;

describe("task 1194 — a whole-paragraph archive carries every card on it", () => {
  it("archives the cards WITH the passage: links kept dormant, nothing deleted, nothing re-homed", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);

    await h.dispatch("archive", P_REF);

    expect(editor.state.doc.textContent).not.toContain("Alpha");
    expect(h.deletes).toEqual([]);
    const snip = h.snippets[0];
    for (const id of ["m1", "h1", "n1"]) {
      const card = store.byId(id);
      expect(dormantSnippetOf(card), id).toBe(snip.id);
      expect(card.archived, id).toBe(true);
      expect(card.links!.every(isDormantLink), id).toBe(true);
      // The link is the SAME link — nothing re-pointed at p-before.
      expect((card.links![0].anchor as { textObjectIds: string[] }).textObjectIds).toEqual(["p-target"]);
    }
    // The snippet records the two Mode-B runs, at positions inside its content.
    expect(snip.carriedMarks?.map((m) => m.anchorId).sort()).toEqual(["A-hl", "A-note"]);
  });

  it("Restore brings P back with its uuid and the marks back over EXACTLY the same words; the cards revive", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const before = { note: markedText(editor, "A-note"), hl: markedText(editor, "A-hl") };
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);

    expect(restore(editor, h.snippets[0])).toBe(true);

    expect(uuidsInOrder(editor)).toEqual(["p-before", "p-target", "p-after"]);
    expect(markedText(editor, "A-note")).toBe(before.note);
    expect(markedText(editor, "A-hl")).toBe(before.hl);
    store.revive(editor);
    for (const id of ["m1", "h1", "n1"]) {
      const card = store.byId(id);
      expect(card.links!.some(isDormantLink), id).toBe(false);
      expect(card.archived, id).toBeUndefined();
      expect(dormantSnippetOf(card), id).toBeNull();
    }
  });

  it("the record survives a JSON save → reload (archive.json is the store)", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    const reloaded = JSON.parse(JSON.stringify(h.snippets[0])) as SnippetCall;
    expect(restore(editor, reloaded)).toBe(true);
    expect(markedText(editor, "A-note")).toBe("beta gamma");
  });
});

describe("task 1194 — the two other ways the text comes back", () => {
  it("a uuid COLLISION on restore remaps the dormant links onto the fresh block and revives them", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    // Something now holds the archived uuid.
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      attrs: { uuid: "p-target" },
      content: [{ type: "text", text: "Squatter." }],
    });

    expect(restore(editor, h.snippets[0], store.returnRemapped)).toBe(true);
    store.revive(editor);

    // The returned paragraph has a fresh uuid; the squatter keeps its own.
    let returned = "";
    editor.state.doc.forEach((n) => {
      if (n.textContent.startsWith("Alpha")) returned = n.attrs.uuid as string;
    });
    expect(returned).not.toBe("p-target");
    expect(returned).toBeTruthy();
    const n1 = store.byId("n1");
    expect(n1.links!.some(isDormantLink)).toBe(false);
    expect(n1.archived).toBeUndefined();
    // Onto the RETURNED words — never the squatter.
    expect((n1.links![0].anchor as { textObjectIds: string[] }).textObjectIds).toEqual([returned]);
    // Mode B revives by its re-stamped mark, collision or not.
    expect(store.byId("m1").archived).toBeUndefined();
    expect(markedText(editor, "A-note")).toBe("beta gamma");
  });

  it("a doc UNDO of the archive revives the cards by liveness; the snippet stays in the Archive", async () => {
    // DECISION (task 1194): Undo restores the text — uuids and marks alike —
    // so every carried card revives through 1193's liveness rule, with no
    // undo-specific code. The snippet is NOT deleted: it is user data in
    // archive.json, written by a gesture the editor's history does not own,
    // and dropping it would make a later Redo lose the only copy. It stays,
    // a harmless duplicate the user can delete — and Restoring it then lands
    // a second copy whose colliding uuids are freshened (the leg above), so
    // nothing is ever re-attached to the wrong block.
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    expect(store.byId("n1").archived).toBe(true);

    editor.commands.undo();

    expect(uuidsInOrder(editor)).toEqual(["p-before", "p-target", "p-after"]);
    store.revive(editor);
    for (const id of ["m1", "h1", "n1"]) {
      expect(store.byId(id).archived, id).toBeUndefined();
      expect(store.byId(id).links!.some(isDormantLink), id).toBe(false);
    }
    expect(h.snippets).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TASK 1269 — the round trip re-derives identity at landing instead of
// trusting the capture-time record.
// ---------------------------------------------------------------------------

/** `useArchive.updateSnippet`'s effect on the record: the BODY changes, the
 *  `carriedMarks` table does not. `edit` rewrites the text of every text node. */
function editBody(s: SnippetCall, edit: (text: string, i: number) => string): SnippetCall {
  let i = 0;
  const visit = (n: JSONContent): JSONContent => ({
    ...n,
    ...(typeof n.text === "string" ? { text: edit(n.text, i++) } : {}),
    ...(n.content ? { content: n.content.map(visit) } : {}),
  });
  return { ...s, content: visit(s.content) };
}

/** Every `linkedAnchor` id in the live doc → the words it covers. */
function anchorRuns(editor: Editor): Map<string, string> {
  const out = new Map<string, string>();
  editor.state.doc.descendants((n) => {
    if (!n.isText) return true;
    for (const m of n.marks) {
      if (m.type.name !== "linkedAnchor") continue;
      const id = m.attrs.anchorId as string;
      out.set(id, (out.get(id) ?? "") + n.text);
    }
    return true;
  });
  return out;
}

describe("task 1269 — an EDITED archive body never moves a mark onto other words", () => {
  it("text prepended to the body: the marks ride along onto their own words", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    const edited = editBody(h.snippets[0], (t, i) => (i === 0 ? `Note: ${t}` : t));

    expect(restore(editor, edited)).toBe(true);

    expect(editor.state.doc.textContent).toContain("Note: Alpha");
    expect(markedText(editor, "A-note")).toBe("beta gamma");
    expect(markedText(editor, "A-hl")).toBe("delta");
    store.revive(editor);
    for (const id of ["m1", "h1"]) expect(store.byId(id).archived, id).toBeUndefined();
  });

  it("the run's OWN words edited: that run is skipped (its card stays dormant), the other lands", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    const edited = editBody(h.snippets[0], (t) => t.replace("beta gamma", "beta GAMMA"));

    expect(restore(editor, edited)).toBe(true);

    expect(markedText(editor, "A-note")).toBe("");
    expect(markedText(editor, "A-hl")).toBe("delta");
    store.revive(editor);
    expect(store.byId("m1").archived).toBe(true);
    expect(store.byId("m1").links!.every(isDormantLink)).toBe(true);
    expect(store.byId("h1").archived).toBeUndefined();
  });

  it("the run's words now appear TWICE: ambiguous, so skipped — never guessed", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    const edited = editBody(h.snippets[0], (t, i) => (i === 0 ? `delta ${t}` : t));

    expect(restore(editor, edited)).toBe(true);

    expect(markedText(editor, "A-hl")).toBe("");
    expect(markedText(editor, "A-note")).toBe("beta gamma");
  });

  it("a pre-1269 record (no `text`) is trusted at its offsets, as before", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    const legacy: SnippetCall = {
      ...h.snippets[0],
      carriedMarks: h.snippets[0].carriedMarks!.map(({ text: _t, ...rest }) => rest),
    };
    expect(restore(editor, legacy)).toBe(true);
    expect(markedText(editor, "A-note")).toBe("beta gamma");
  });
});

describe("task 1269 — one identity answer for uuids AND anchorIds", () => {
  it("Undo then Restore: no two runs share an anchorId; the cards keep the original copy", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    editor.commands.undo();
    store.revive(editor);

    expect(restore(editor, h.snippets[0], store.returnRemapped)).toBe(true);

    // Each id names ONE run: the original keeps "A-note" / "A-hl" …
    const runs = anchorRuns(editor);
    expect(runs.get("A-note")).toBe("beta gamma");
    expect(runs.get("A-hl")).toBe("delta");
    // … and the second copy's runs carry FRESH ids over the same words.
    const fresh = [...runs].filter(([id]) => id !== "A-note" && id !== "A-hl");
    expect(fresh.map(([, t]) => t).sort()).toEqual(["beta gamma", "delta"]);
    // The live (revived) cards are not moved by the restore.
    expect((store.byId("m1").links![0].anchor as { textRange: { anchorId: string } }).textRange.anchorId).toBe("A-note");
    expect(store.byId("m1").archived).toBeUndefined();
  });

  it("an anchorId COLLISION with a dormant card: the card follows the fresh id and revives", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);
    // Something now carries the archived mark id.
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "paragraph",
      attrs: { uuid: "p-squat" },
      content: [{ type: "text", text: "Squatter.", marks: mark("A-note", "note:other") }],
    });

    expect(restore(editor, h.snippets[0], store.returnRemapped)).toBe(true);
    store.revive(editor);

    expect(markedText(editor, "A-note")).toBe("Squatter.");
    const m1 = store.byId("m1");
    expect(m1.archived).toBeUndefined();
    expect(m1.links!.some(isDormantLink)).toBe(false);
    const id = (m1.links![0].anchor as { textRange: { anchorId: string } }).textRange.anchorId;
    expect(id).not.toBe("A-note");
    // Onto the RETURNED words — never the squatter.
    expect(markedText(editor, id)).toBe("beta gamma");
  });
});

describe("task 1194 — a SELECTION archive inside one paragraph", () => {
  it("P survives, the Mode-A note is untouched, the contained marks' cards travel and return", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    const range = { from: posOf(editor, "beta").from, to: posOf(editor, "delta").to };

    await h.dispatch("archive", {
      kind: "selection",
      from: range.from,
      to: range.to,
      paragraphId: "p-target",
    } as DragHandleRef);

    expect(editor.state.doc.textContent).toContain("Alpha");
    expect(editor.state.doc.textContent).not.toContain("gamma");
    expect(h.deletes).toEqual([]);
    expect(store.byId("n1").links!.some(isDormantLink)).toBe(false);
    expect(store.byId("n1").archived).toBeUndefined();
    for (const id of ["m1", "h1"]) expect(store.byId(id).archived, id).toBe(true);

    expect(restore(editor, h.snippets[0])).toBe(true);
    expect(markedText(editor, "A-note")).toBe("beta gamma");
    expect(markedText(editor, "A-hl")).toBe("delta");
    store.revive(editor);
    for (const id of ["m1", "h1"]) expect(store.byId(id).archived, id).toBeUndefined();
  });

  it("a mark the selection only CLIPS survives shrunk and its card stays active (task 897, unchanged)", async () => {
    const editor = mountDoc(doc());
    const store = fixtureStore();
    const h = makeHarness(editor, store);
    // From inside "gamma" through "delta": the note's mark is clipped, the
    // highlight's is contained.
    const range = { from: posOf(editor, "gamma").from, to: posOf(editor, "delta").to };
    await h.dispatch("archive", {
      kind: "selection",
      from: range.from,
      to: range.to,
      paragraphId: "p-target",
    } as DragHandleRef);

    expect(markedText(editor, "A-note")).toBe("beta ");
    expect(store.byId("m1").archived).toBeUndefined();
    expect(store.byId("m1").links!.some(isDormantLink)).toBe(false);
    expect(store.byId("h1").archived).toBe(true);
    expect(h.snippets[0].carriedMarks?.map((m) => m.anchorId)).toEqual(["A-hl"]);
  });
});

describe("task 1194 — footnote and citation atoms (the capture-schema residual, answered)", () => {
  it("ride the slice and come back with every attr; their sidecar refs are deleted at capture", async () => {
    const editor = mountDoc([
      { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
      {
        type: "paragraph",
        attrs: { uuid: "p-target" },
        content: [
          { type: "text", text: "Claim" },
          {
            type: "footnote",
            attrs: {
              footnoteId: "fn1",
              content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Note body." }] }] },
            },
          },
          { type: "text", text: " and source " },
          { type: "citation", attrs: { citationId: "c1", command: "\\citep{doe2020}" } },
          { type: "text", text: "." },
        ],
      },
      { type: "paragraph", attrs: { uuid: "p-after" }, content: [{ type: "text", text: "After." }] },
    ]);
    const atoms = () => {
      const out: Record<string, unknown>[] = [];
      editor.state.doc.descendants((n) => {
        if (n.type.name === "footnote" || n.type.name === "citation") out.push({ type: n.type.name, ...n.attrs });
        return true;
      });
      return out;
    };
    const before = atoms();
    expect(before).toHaveLength(2);
    const store = makeStore([]);
    const h = makeHarness(editor, store);

    await h.dispatch("archive", P_REF);
    expect(atoms()).toEqual([]);
    // Not carried — deleted: the atom IS the card's body, and it rides the
    // captured slice; the sidecar ref is the derivable part.
    expect(h.deletes.sort()).toEqual(["citation:c1", "footnote:fn1"]);

    expect(restore(editor, h.snippets[0])).toBe(true);
    expect(atoms()).toEqual(before);
  });
});

describe("task 1194 — a multi-anchor card", () => {
  it("stays active on surviving Q through the archive, and has both anchors after restore", async () => {
    const editor = mountDoc(doc());
    const store = makeStore([
      { id: "multi", kind: "note", links: [modeA("p-target"), { ...modeA("p-after"), id: "la-q" }] },
    ]);
    const h = makeHarness(editor, store);
    await h.dispatch("archive", P_REF);

    const mid = store.byId("multi");
    expect(mid.archived).toBeUndefined();
    expect(mid.links!.map(isDormantLink)).toEqual([true, false]);

    expect(restore(editor, h.snippets[0])).toBe(true);
    store.revive(editor);
    const back = store.byId("multi");
    expect(back.links!.some(isDormantLink)).toBe(false);
    expect(back.links!.map((l) => (l.anchor as { textObjectIds: string[] }).textObjectIds[0])).toEqual([
      "p-target",
      "p-after",
    ]);
  });
});

// ---------------------------------------------------------------------------
// CENSUS — every kind that declares `lifecycle.carry` has a round trip here.
// Adding a kind to the carry capability without one fails this.
// ---------------------------------------------------------------------------

/** The kinds this file round-trips through the REAL archive + restore. */
const ROUND_TRIPPED: Partial<Record<CardKind, MarginItemKind | null>> = {
  note: "note",
  highlight: null, // Mode-B only — a highlight has no paragraph anchor
  todo: "todo",
  report: "report",
  "report-request": "report",
  "revision-comment": "revision",
  "revision-suggestion": "revision",
  "cutter-comment": "cut",
  "cutter-suggestion": "cut",
};

/** The record `kind` a margin bundle stores each spine kind as. */
const STORED_KIND: Partial<Record<CardKind, string>> = {
  "revision-comment": "comment",
  "revision-suggestion": "suggestion",
  "cutter-comment": "comment",
  "cutter-suggestion": "suggestion",
  "report-request": "request",
  report: "report",
};

describe("archive-carry CENSUS", () => {
  it("every kind that declares lifecycle.carry is round-tripped here", () => {
    const declared = CARD_KINDS.filter((k) => CARD_REGISTRY[k].lifecycle.carry).sort();
    expect(Object.keys(ROUND_TRIPPED).sort()).toEqual(declared);
  });

  for (const [kind, bundle] of Object.entries(ROUND_TRIPPED) as [CardKind, MarginItemKind | null][]) {
    it(`${kind}: a Mode-B card travels with the passage and comes back`, async () => {
      const editor = mountDoc([
        { type: "paragraph", attrs: { uuid: "p-before" }, content: [{ type: "text", text: "Before." }] },
        {
          type: "paragraph",
          attrs: { uuid: "p-target" },
          content: [
            { type: "text", text: "Lead " },
            { type: "text", text: "marked words", marks: mark("A-k", `${kind}:k1`) },
          ],
        },
        { type: "paragraph", attrs: { uuid: "p-after" }, content: [{ type: "text", text: "After." }] },
      ]);
      const recordKind = STORED_KIND[kind] ?? (bundle ?? kind);
      const store = makeStore([
        { id: "k1", kind: recordKind, links: [modeB("p-target", "A-k", "marked words")] },
        ...(bundle
          ? [{ id: "k2", kind: bundle as string, links: [modeA("p-target")] }]
          : []),
      ]);
      // A Mode-A card of this kind lives in its margin bundle under the
      // bundle's name; re-key the stored record kind the bundle filters on.
      const h = makeHarness(editor, store);
      await h.dispatch("archive", P_REF);
      expect(h.deletes).toEqual([]);
      expect(store.byId("k1").archived).toBe(true);
      expect(restore(editor, h.snippets[0])).toBe(true);
      expect(markedText(editor, "A-k")).toBe("marked words");
      store.revive(editor);
      expect(store.byId("k1").archived).toBeUndefined();
      expect(store.byId("k1").links!.some(isDormantLink)).toBe(false);
    });
  }
});
