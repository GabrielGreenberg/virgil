// @vitest-environment jsdom
//
// Task 1336 — "archived" is ONE input to EVERY in-document anchor painter.
//
// Gabriel, from a real paper: "When a note annotates a text selection, so there
// is highlighting, then archiving the note should remove the highlighting. This
// works about half the time … Test extensively in different conditions."
//
// The half-the-time symptom was task 1331's (a per-span stamp that a redraw
// dropped; its legs live in `archived-anchor-chrome.test.tsx`). This suite
// closes the paths 1331 did not reach and pins the MATRIX he asked for:
//
//   - the AI-request wash, a decoration INSIDE the span the 1331 sheet selects,
//     was archive-blind (`requestWashAnchor`);
//   - an AGENT archive (`/editor/archive-card`) moves the card into
//     `archive.json` with an origin record — the app counted that as neither
//     archived (the wash stood) nor owned (the reaper stripped the mark the
//     restore re-anchors from);
//   - a card archived WHILE hovered/selected kept its store ref (an unmounting
//     card fires no mouseout), so restoring it painted a phantom wash.
//
// Every cell drives the REAL painters (`useLinkHighlight`'s sheet,
// `useAnchorHighlightReconciler`, `useRequestWash`) against a REAL editor from
// the main `buildEditorExtensions` stack, fed from ONE card record — the
// in-app archive is a flag flip on that record, whichever door flips it (the
// card archive button, the selection/card menu, the Todo bulk archive, the
// `pending-change-actions` direct `setArchived`), so the record IS the
// converged input those doors share.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import { act, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useLinkHighlight, DATA_ARCHIVED_ANCHOR_STYLE } from "@/links/_shared/useLinkHighlight";
import {
  archiveHeldAnchorIds,
  archivedAnchorIds,
  archivedCardIds,
  holdsArchivedCard,
} from "@/links/_shared/archived-anchor-chrome";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import {
  isRequestCard,
  requestWashTargets,
  useRequestWash,
  REQUEST_WASH_CHANNEL,
  type RequestWashCardLike,
} from "@/links/_shared/request-wash";
import {
  aliveLinkedAnchorIds,
  reapOrphanLinkedAnchors,
} from "@/links/_shared/useLinkedAnchorReconciler";
import { applyLinkedAnchorsImpl } from "@/links/_shared/apply-linked-anchors";
import { transientHighlightKeyFor } from "@/lib/tiptap/transient-highlight";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "@/links/_shared/types";
import type { LinkedAnchorKind } from "@/links/links";

const PARA_UUID = "pm1336";
const ANCHOR = "an1336";
const CARD = "card-1336";
const NO_KINDS: ReadonlySet<"note"> = new Set();

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set([PARA_UUID]) },
    host: null,
  };
}

/** One kind of the matrix: the mark kind it stamps, the slot its card lives
 *  in, and the ref kind the card store names it by. */
interface KindCase {
  label: string;
  markKind: LinkedAnchorKind;
  refKind: "note" | "todo" | "report" | "revision-comment";
  slot: "notes" | "todoItems" | "reportCards" | "comments";
  recordKind?: string;
}
const KINDS: KindCase[] = [
  { label: "note", markKind: "note", refKind: "note", slot: "notes" },
  { label: "todo", markKind: "todo", refKind: "todo", slot: "todoItems" },
  { label: "report", markKind: "report", refKind: "report", slot: "reportCards", recordKind: "report" },
  {
    label: "comment",
    markKind: "revision",
    refKind: "revision-comment",
    slot: "comments",
    recordKind: "revision-comment",
  },
];

type State = "idle" | "hovered" | "selected" | "request";
const STATES: State[] = ["idle", "hovered", "selected", "request"];

type Then = "bold" | "italic" | "undo" | "reload-restamp";
const THENS: Then[] = ["bold", "italic", "undo", "reload-restamp"];

function makeLink(k: KindCase): Link {
  return {
    id: `lnk-${ANCHOR}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [PARA_UUID],
      textRange: { anchorId: ANCHOR, textSnapshot: "alpha" },
    },
    target: { type: "card", ref: { kind: k.refKind, id: CARD } },
    createdAt: "",
  };
}

interface CardRec extends RequestWashCardLike {
  id: string;
  archived?: boolean;
  links: Link[];
}

function cardFor(k: KindCase, state: State, archived: boolean): CardRec {
  return {
    id: CARD,
    ...(k.recordKind ? { kind: k.recordKind } : {}),
    ...(state === "request" ? { aiRequest: true } : {}),
    ...(archived ? { archived: true } : {}),
    links: [makeLink(k)],
  };
}

function slots(k: KindCase, cards: CardRec[]): EntityCollectionSlots {
  const empty: EntityCollectionSlots = {
    notes: [],
    highlights: [],
    cutterCards: [],
    comments: [],
    todoItems: [],
    archiveSnippets: [],
    reportCards: [],
    examples: [],
  };
  return { ...empty, [k.slot]: cards } as EntityCollectionSlots;
}

/** "alpha bravo" with a `linkedAnchor` of `kind` over "alpha" = [1, 6). The
 *  `linkCard` is EMPTY — the post-reload shape (`applyLinkedAnchors`). */
function mount(kind: LinkedAnchorKind): { editor: Editor; element: HTMLElement } {
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
          attrs: { uuid: PARA_UUID },
          content: [{ type: "text", text: "alpha bravo" }],
        },
      ],
    },
  });
  const type = editor.schema.marks.linkedAnchor!;
  editor.view.dispatch(
    editor.state.tr.addMark(
      1,
      6,
      type.create({ anchorId: ANCHOR, linkId: ANCHOR, kind, linkKind: "anchor", linkCard: `${kind}:` }),
    ),
  );
  return { editor, element };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

function spans(editor: Editor): HTMLElement[] {
  return Array.from(
    editor.view.dom.querySelectorAll(`.linked-anchor[data-link-id="${ANCHOR}"]`),
  ) as HTMLElement[];
}

function archivedSelectors(): string[] {
  const out: string[] = [];
  for (const el of document.querySelectorAll(`style[${DATA_ARCHIVED_ANCHOR_STYLE}]`)) {
    const sheet = (el as HTMLStyleElement).sheet;
    if (!sheet) continue;
    for (const rule of Array.from(sheet.cssRules)) {
      if ("selectorText" in rule) out.push((rule as CSSStyleRule).selectorText);
    }
  }
  return out;
}

/** The passage's chrome, every painter at once. */
function chrome(editor: Editor): {
  sheet: "all" | "none" | "partial";
  hovered: boolean;
  selected: boolean;
  requestBands: number;
} {
  const ss = spans(editor);
  if (ss.length === 0) throw new Error("passage has no .linked-anchor span");
  const sels = archivedSelectors();
  const covered = ss.filter((s) => sels.some((sel) => s.matches(sel))).length;
  const set = transientHighlightKeyFor(REQUEST_WASH_CHANNEL).getState(editor.state);
  return {
    sheet: covered === ss.length ? "all" : covered === 0 ? "none" : "partial",
    hovered: ss.some((s) => s.getAttribute("data-card-hovered") === "true"),
    selected: ss.some((s) => s.getAttribute("data-card-selected") === "true"),
    requestBands: set ? set.find().length : 0,
  };
}

/** Every painter, mounted the way `EditorPane` mounts them, from ONE record. */
function mountPainters(editor: Editor, k: KindCase, state: State) {
  return renderHook(
    ({ archived }: { archived: boolean }) => {
      const cards = [cardFor(k, state, archived)];
      useLinkHighlight({
        editor,
        visibleHighlightKinds: NO_KINDS,
        archivedAnchorIds: archivedAnchorIds([cards]),
      });
      useAnchorHighlightReconciler({
        editor,
        collections: slots(k, cards),
        store: cardStore,
        panelSides: {},
        archivedCardIds: archivedCardIds([cards]),
      });
      useRequestWash(editor, cards.filter(isRequestCard), true);
    },
    { initialProps: { archived: false } },
  );
}

async function applyThen(editor: Editor, k: KindCase, then: Then): Promise<void> {
  act(() => {
    switch (then) {
      case "bold":
      case "italic":
        // "lp" = [2, 4): splits the passage into three spans — fresh DOM.
        editor.view.dispatch(
          editor.state.tr.addMark(2, 4, editor.schema.marks[then]!.create()),
        );
        break;
      case "undo":
        editor.view.dispatch(editor.state.tr.delete(1, 6));
        break;
      case "reload-restamp":
        // The load-order re-stamp with a DISAGREEING kind: the mark is
        // re-minted with the record's attrs (`applyLinkedAnchorsImpl`).
        applyLinkedAnchorsImpl(editor, [
          {
            anchorId: ANCHOR,
            kind: k.markKind === "note" ? "todo" : "note",
            text: "alpha",
            cardId: CARD,
            paragraphId: PARA_UUID,
          },
        ]);
        break;
    }
  });
  if (then === "undo") {
    await settle();
    act(() => {
      editor.commands.undo();
    });
  }
  await settle();
}

afterEach(() => {
  act(() => {
    cardStore.setHover(null);
    cardStore.clearSelection();
  });
  for (const el of document.querySelectorAll(`style[${DATA_ARCHIVED_ANCHOR_STYLE}]`)) {
    el.remove();
  }
});

// ── The matrix ──────────────────────────────────────────────────────────────

describe("archive matrix — kinds × states at archive time × a later redraw", () => {
  for (const k of KINDS) {
    for (const state of STATES) {
      for (const then of THENS) {
        it(`${k.label} · ${state} · then ${then}: no chrome while archived, chrome back on unarchive`, async () => {
          const { editor, element } = mount(k.markKind);
          const painters = mountPainters(editor, k, state);
          await settle();
          const ref = { kind: k.refKind, id: CARD };
          act(() => {
            if (state === "hovered") cardStore.setHover(ref);
            if (state === "selected") cardStore.select(ref);
          });
          await settle();

          // Premise: the state paints before the archive.
          const before = chrome(editor);
          expect(before.sheet).toBe("none");
          if (state === "hovered") expect(before.hovered).toBe(true);
          if (state === "selected") expect(before.selected).toBe(true);
          if (state === "request") expect(before.requestBands).toBe(1);

          // Archive.
          painters.rerender({ archived: true });
          await settle();
          expect(chrome(editor)).toEqual({
            sheet: "all",
            hovered: false,
            selected: false,
            requestBands: 0,
          });

          // A redraw while archived must not bring anything back.
          await applyThen(editor, k, then);
          expect(chrome(editor)).toEqual({
            sheet: "all",
            hovered: false,
            selected: false,
            requestBands: 0,
          });

          // Unarchive: the wash returns; a hover/selection the card held at
          // archive time does NOT (the pointer is long gone — no phantom).
          painters.rerender({ archived: false });
          await settle();
          expect(chrome(editor)).toEqual({
            sheet: "none",
            hovered: false,
            selected: false,
            requestBands: state === "request" ? 1 : 0,
          });

          painters.unmount();
          editor.destroy();
          element.remove();
        });
      }
    }
  }
});

// ── The stale store ref, at the store ───────────────────────────────────────

describe("archiving a hovered/selected card releases its store ref", () => {
  it("clears hover AND selection on the active→archived transition", async () => {
    const k = KINDS[0]!;
    const { editor, element } = mount(k.markKind);
    const painters = mountPainters(editor, k, "idle");
    await settle();
    act(() => {
      cardStore.select({ kind: "note", id: CARD });
      cardStore.setHover({ kind: "note", id: CARD });
    });
    painters.rerender({ archived: true });
    await settle();
    expect(cardStore.getState().selected).toBeNull();
    expect(cardStore.getState().hover).toBeNull();
    painters.unmount();
    editor.destroy();
    element.remove();
  });

  it("CONTROL — hovering an ALREADY-archived card (the Archives view) keeps its ref", async () => {
    const k = KINDS[0]!;
    const { editor, element } = mount(k.markKind);
    const painters = mountPainters(editor, k, "idle");
    painters.rerender({ archived: true });
    await settle();
    act(() => {
      cardStore.setHover({ kind: "note", id: CARD });
    });
    painters.rerender({ archived: true });
    await settle();
    expect(cardStore.getState().hover).toEqual({ kind: "note", id: CARD });
    // …and it still paints nothing in the document.
    expect(chrome(editor).hovered).toBe(false);
    painters.unmount();
    editor.destroy();
    element.remove();
  });
});

// ── The AI-request wash ─────────────────────────────────────────────────────

describe("the request wash reads the archived input", () => {
  it("an archived card with aiRequest: true wants no wash and resolves no band", () => {
    const { editor, element } = mount("note");
    const card = { ...cardFor(KINDS[0]!, "request", true) };
    expect(isRequestCard(card)).toBe(false);
    expect(requestWashTargets(editor, [card])).toEqual([]);
    // CONTROL: the same record, unarchived, washes.
    expect(requestWashTargets(editor, [cardFor(KINDS[0]!, "request", false)])).toHaveLength(1);
    editor.destroy();
    element.remove();
  });
});

// ── The AGENT archive (`/editor/archive-card`) ──────────────────────────────

/** What `cmd_archive` writes into `archive.json`: the card leaves `notes.json`
 *  and arrives as a snippet carrying its origin record. */
function agentSnippet(k: KindCase) {
  const original = cardFor(k, "idle", false);
  return {
    id: CARD,
    title: "",
    content: { type: "doc", content: [] },
    createdAt: "",
    links: original.links,
    originalPanel: "notes",
    originalCard: original as unknown as Record<string, unknown>,
    archivedAt: "",
  };
}

describe("an agent-archived card is archived AND owned", () => {
  it("holdsArchivedCard reads the origin record; an excerpt holds nothing", () => {
    expect(holdsArchivedCard(agentSnippet(KINDS[0]!))).toBe(true);
    expect(holdsArchivedCard({ id: "x", links: [makeLink(KINDS[0]!)] })).toBe(false);
    // Present-but-unusable origin is still a card, never an excerpt.
    expect(holdsArchivedCard({ id: "y", originalPanel: "nowhere" })).toBe(true);
  });

  it("tolerates an originalCard whose links are malformed", () => {
    const snip = {
      id: "z",
      originalPanel: "notes",
      originalCard: { id: "z", links: [null, {}, { anchor: null }] },
    };
    expect(() => archiveHeldAnchorIds([snip])).not.toThrow();
    expect(archiveHeldAnchorIds([snip]).size).toBe(0);
  });

  it("the passage goes un-washed as soon as archive.json is read — before notes.json drops the card", async () => {
    const k = KINDS[0]!;
    const { editor, element } = mount(k.markKind);
    // The EditorPane collection list: the live note AND the archive snippets.
    const hook = renderHook(
      ({ snippets }: { snippets: ReturnType<typeof agentSnippet>[] }) =>
        useLinkHighlight({
          editor,
          visibleHighlightKinds: NO_KINDS,
          archivedAnchorIds: archivedAnchorIds([[cardFor(k, "idle", false)], snippets]),
        }),
      { initialProps: { snippets: [] as ReturnType<typeof agentSnippet>[] } },
    );
    await settle();
    expect(chrome(editor).sheet).toBe("none");
    hook.rerender({ snippets: [agentSnippet(k)] });
    expect(chrome(editor).sheet).toBe("all");
    hook.unmount();
    editor.destroy();
    element.remove();
  });

  it("the reaper keeps the held card's mark, so /editor/restore-card can re-anchor", () => {
    const k = KINDS[0]!;
    const { editor, element } = mount(k.markKind);
    const emptyBag = {
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reportCards: [],
      highlights: [],
    };
    // notes.json no longer has the card; archive.json does.
    reapOrphanLinkedAnchors(
      editor,
      aliveLinkedAnchorIds(emptyBag, archiveHeldAnchorIds([agentSnippet(k)])),
    );
    expect(spans(editor).length).toBeGreaterThan(0);
    // CONTROL: without the held set the same sweep reaps it (the pre-1336 loss).
    reapOrphanLinkedAnchors(editor, aliveLinkedAnchorIds(emptyBag));
    expect(spans(editor)).toHaveLength(0);
    editor.destroy();
    element.remove();
  });
});

// ── Census ──────────────────────────────────────────────────────────────────

describe("census — the archived input reaches every passage painter", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("the 1331 sheet is applied in a LAYOUT effect (same paint as the archive commit)", () => {
    const src = read("src/links/_shared/useLinkHighlight.ts");
    const at = src.indexOf("archivedAnchorCss(nextArchivedScope(root)");
    expect(at).toBeGreaterThan(0);
    const effectOpen = src.lastIndexOf("Effect(() => {", at);
    expect(src.slice(effectOpen - 6, effectOpen)).toBe("Layout");
  });

  it("the request wash's ONE anchor answer consults cardIsArchived", () => {
    const src = read("src/links/_shared/request-wash.ts");
    const fn = src.slice(src.indexOf("export function requestWashAnchor"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/cardIsArchived\(card\)/);
  });

  it("both orphan sweeps in EditorPane read the agent-held anchors", () => {
    const src = read("src/components/EditorPane.tsx");
    expect(src).toMatch(/aliveLinkedAnchorIds\(\s*modeBCardsRef\.current,\s*archiveHeldAnchorIdsRef\.current,?\s*\)/);
    expect(src).toMatch(/heldAnchorIds:\s*archiveHeldAnchorIdSet/);
  });
});
