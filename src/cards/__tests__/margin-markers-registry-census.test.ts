// @vitest-environment node
//
// Task 939 — the margin's card markers come from ONE registry-derived builder.
//
// They used to be six hand-written loops in EditorPane, each restating the
// marker `type` beside its `entityKind` while `CARD_REGISTRY[kind].markerType`
// already declared the mapping, and each free to forget `entityKind` (which the
// re-pin grab needs) or the `linkedAnchor` id the delete door strips. These pin:
//   A — the source table covers EXACTLY the card kinds the registry puts in the
//       margin, each kind in one source, and each source's `kinds` is honest;
//   B — every built marker's `type` IS its kind's registry `markerType`, it
//       carries `entityKind`/`entityId`, and its Delete reaches the door keyed
//       by that same registry value;
//   C — the delete door strips a card's Mode-B mark whatever its kind (a todo
//       made from a selection included), reading it off the card itself.

import { describe, it, expect, vi } from "vitest";

const removeLinkedAnchor = vi.fn<(editor: unknown, anchorId: unknown) => void>();

vi.mock("@/links/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/links/links")>()),
  removeLinkedAnchor: (...a: unknown[]) => removeLinkedAnchor(a[0], a[1]),
}));

import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
import {
  MARGIN_MARKER_SOURCES,
  buildCardMarkers,
  marginMarkerTypeForKind,
  type CardMarkerCtx,
  type MarginMarkerSource,
} from "@/cards/margin-markers";
import { deleteMarginItem, type MarginItemHandlers } from "@/cards/delete-margin-item";
import type { CardWithLinks } from "@/links/links";
import type { Editor } from "@tiptap/react";

const SOURCES = Object.entries(MARGIN_MARKER_SOURCES) as [string, MarginMarkerSource][];

/** The on-disk discriminators each collection's records carry. Keyed by the
 *  source table, so a new source cannot join without declaring its domain. */
const RAW_KINDS: Record<keyof typeof MARGIN_MARKER_SOURCES, (string | undefined)[]> = {
  notes: [undefined],
  archive: [undefined],
  todos: [undefined],
  revisions: ["comment", "suggestion"],
  cutter: ["comment", "suggestion"],
  reports: ["report", "report-request"],
};
const rawKindsOf = (name: string) => RAW_KINDS[name as keyof typeof RAW_KINDS];

function fakeCard(rawKind: string | undefined): CardWithLinks {
  return {
    id: "c1",
    ...(rawKind ? { kind: rawKind } : {}),
    status: "pending",
    links: [{ anchor: { type: "textObject", textObjectIds: ["P1"] } }],
  } as unknown as CardWithLinks;
}

function ctx() {
  const onDelete = vi.fn<CardMarkerCtx["onDelete"]>();
  const c: CardMarkerCtx = {
    resolve: () => ({ rows: [{ pid: "P1" } as never], anchored: true }),
    onClick: vi.fn(),
    onDelete,
  };
  return Object.assign(c, { onDelete });
}

describe("margin markers derive from CARD_REGISTRY.markerType (task 939)", () => {
  it("A — the sources cover exactly the registry's margin-bearing card kinds, once each", () => {
    const registryKinds = (Object.keys(CARD_REGISTRY) as CardKind[])
      .filter((k) => marginMarkerTypeForKind(k) != null)
      .sort();
    const declared = SOURCES.flatMap(([, s]) => s.kinds);
    expect([...declared].sort()).toEqual(registryKinds);
    expect(new Set(declared).size, "a kind claimed by two sources").toBe(declared.length);
  });

  it("A — each source's `kinds` is exactly what its `kindOf` can produce", () => {
    for (const [name, s] of SOURCES) {
      const produced = new Set(rawKindsOf(name).map((r) => s.kindOf(fakeCard(r))));
      expect([...produced].sort(), name).toEqual([...s.kinds].sort());
    }
  });

  it("B — every built marker's type is its kind's registry markerType, with entityKind set", () => {
    for (const [name, s] of SOURCES) {
      for (const raw of rawKindsOf(name)) {
        const card = fakeCard(raw);
        const kind = s.kindOf(card);
        const c = ctx();
        const markers = buildCardMarkers(card, s, c);
        expect(markers, `${name}/${raw}`).toHaveLength(1);
        const m = markers[0];
        expect(m.type, `${name}/${kind}`).toBe(CARD_REGISTRY[kind].markerType);
        expect(m.entityKind).toBe(kind);
        expect(m.entityId).toBe("c1");
        expect(m.title, "a marker always names its item").toBeTruthy();
        expect("anchorId" in m, "the dead marker field stays gone").toBe(false);
        m.onDelete?.();
        expect(c.onDelete).toHaveBeenCalledWith(m.type, "c1", "P1", ["P1"]);
      }
    }
  });

  it("B — a resolved suggestion paints no marker; a pending/applied one does", () => {
    const s = MARGIN_MARKER_SOURCES.revisions as MarginMarkerSource;
    for (const status of ["accepted", "rejected"]) {
      const card = { ...fakeCard("suggestion"), status } as CardWithLinks;
      expect(buildCardMarkers(card, s, ctx())).toEqual([]);
    }
    for (const status of ["pending", "applied", "stale"]) {
      const card = { ...fakeCard("suggestion"), status } as CardWithLinks;
      expect(buildCardMarkers(card, s, ctx())).toHaveLength(1);
    }
  });

  it("C — the delete door strips a todo's Mode-B mark (read off the card, not a caller arg)", async () => {
    removeLinkedAnchor.mockClear();
    const editor = {} as Editor;
    const todo = {
      id: "t1",
      text: "",
      links: [
        {
          anchor: {
            type: "textObject",
            targetKind: "linkedRange",
            textObjectIds: ["P1"],
            textRange: { anchorId: "anc-t", textSnapshot: "span" },
          },
        },
      ],
    } as unknown as CardWithLinks;
    const del = vi.fn();
    const handlers: MarginItemHandlers = {
      findCard: () => todo,
      cards: [todo],
      contentKind: "todo",
      unanchor: vi.fn(),
      reanchor: vi.fn(),
      delete: del,
    };
    await deleteMarginItem({
      kind: "todo",
      cardId: "t1",
      paragraphId: "P1",
      anchorPids: ["P1"],
      handlers,
      confirm: async () => true,
      editor,
    });
    expect(del).toHaveBeenCalledWith("t1");
    expect(removeLinkedAnchor).toHaveBeenCalledWith(editor, "anc-t");
  });
});
