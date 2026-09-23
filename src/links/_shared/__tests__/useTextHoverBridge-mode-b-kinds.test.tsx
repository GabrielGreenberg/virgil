// @vitest-environment jsdom
//
// TASK 666 — the in-text hover bridge is generic over the FULL Mode-B kind set.
//
// Until this task "which collections carry a Mode-B (`linkedRange`) text
// anchor?" was four hand-kept lists across four consumers, and they disagreed:
// the hover bridge knew FOUR of six (notes / cutter / revisions / reports).
// A `highlight`'s tinted span, and a `todo`'s span when the todo was created
// from a selection, were therefore PAINTED BUT INERT — nothing on hover,
// nothing on click — while the panel→text direction worked, so the span looked
// live. The generic atom fallback could not cover for them either (it accepts
// only footnote + citation). **No test mounted this hook**, which is how it
// shipped.
//
// These legs FAIL against the pre-fix tree for `highlight` and `todo` (the hook
// literally had no `highlights` / `todos` argument) and pass for `note`, which
// is the control proving the harness is not vacuous.
//
// Storage stub guards the extension-barrel/@/lib/storage gotcha.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { useTextHoverBridge } from "../useTextHoverBridge";
import { DATA_LINK_ID } from "@/links/link-dom-contract";
import type { ModeBBag, ModeBRecord } from "@/cards/mode-b-collections";
import type { CardKind } from "@/cards/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

/** One paragraph carrying one `linkedAnchor`-marked run. */
function mountDoc(
  runs: Array<{ text: string; anchorId?: string; markKind?: string }>,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: runs.map((r) => ({
            type: "text",
            text: r.text,
            ...(r.anchorId
              ? {
                  marks: [
                    {
                      type: "linkedAnchor",
                      attrs: {
                        anchorId: r.anchorId,
                        kind: r.markKind ?? "note",
                        linkId: r.anchorId,
                        linkKind: "anchor",
                      },
                    },
                  ],
                }
              : {}),
          })),
        },
      ],
    },
  });
}

/** A card with one Mode-B (`linkedRange`) link over `anchorId`. */
function modeBCard(id: string, anchorId: string, kind?: string): ModeBRecord {
  return {
    id,
    ...(kind ? { kind } : {}),
    links: [
      {
        id: anchorId,
        kind: "anchor",
        anchor: {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds: ["para-A"],
          textRange: { anchorId, textSnapshot: "anchored" },
        },
        target: { type: "card", ref: { kind: kind ?? "note", id } },
        createdAt: "",
      },
    ],
  } as ModeBRecord;
}

function emptyBag(): ModeBBag {
  return {
    notes: [],
    todoItems: [],
    comments: [],
    cutterCards: [],
    reportCards: [],
    highlights: [],
  };
}

function spanFor(editor: Editor, anchorId: string): HTMLElement {
  const el = editor.view.dom.querySelector<HTMLElement>(
    `.linked-anchor[${DATA_LINK_ID}="${anchorId}"]`,
  );
  if (!el) throw new Error(`no .linked-anchor span for ${anchorId}`);
  return el;
}

describe("useTextHoverBridge — every Mode-B kind is hoverable AND clickable", () => {
  let editor: Editor | null = null;
  const clicks: Array<{ entityId: string; kind: string }> = [];
  const onClick = (e: Event) => {
    const d = (e as CustomEvent).detail as { entityId: string; kind: string };
    clicks.push({ entityId: d.entityId, kind: d.kind });
  };

  beforeEach(() => {
    clicks.length = 0;
    window.addEventListener("virgil-linked-anchor-click", onClick);
  });
  afterEach(() => {
    window.removeEventListener("virgil-linked-anchor-click", onClick);
    editor?.destroy();
    editor = null;
  });

  /** Mount the bridge over one marked span owned by one card in one slot, then
   *  hover it and click it. */
  function driveOne(args: {
    markKind: string;
    anchorId: string;
    bag: ModeBBag;
    cardId: string;
  }) {
    editor = mountDoc([
      { text: "lead " },
      { text: "anchored", anchorId: args.anchorId, markKind: args.markKind },
      { text: " tail" },
    ]);
    const setHoveredEntity = vi.fn();
    renderHook(() =>
      useTextHoverBridge({ editor, cards: args.bag, setHoveredEntity }),
    );
    const span = spanFor(editor, args.anchorId);
    span.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { setHoveredEntity };
  }

  const cases: Array<{
    label: string;
    markKind: string;
    entityKind: CardKind;
    bag: () => ModeBBag;
  }> = [
    {
      // CONTROL — the hook always knew notes. Proves the harness is real.
      label: "note (control — already worked)",
      markKind: "note",
      entityKind: "note",
      bag: () => ({ ...emptyBag(), notes: [modeBCard("card-1", "anc-1")] }),
    },
    {
      // THE BUG: a highlight IS a Mode-B card (its tint rides the mark) and is
      // `anchored` in CARD_REGISTRY with a `findEntity` arm — it was simply not
      // in the hook's four-collection list.
      label: "highlight (was painted but INERT)",
      markKind: "highlight",
      entityKind: "highlight",
      bag: () => ({
        ...emptyBag(),
        highlights: [modeBCard("card-1", "anc-1", "highlight")],
      }),
    },
    {
      // THE BUG, second member: a todo carries a Mode-B anchor when it was
      // created FROM A SELECTION (symmetric with note/cutter/revision).
      label: "todo created from a selection (was painted but INERT)",
      markKind: "todo",
      entityKind: "todo",
      bag: () => ({ ...emptyBag(), todoItems: [modeBCard("card-1", "anc-1")] }),
    },
    {
      label: "revision-comment",
      markKind: "revision",
      entityKind: "revision-comment",
      bag: () => ({ ...emptyBag(), comments: [modeBCard("card-1", "anc-1")] }),
    },
    {
      label: "cutter-suggestion (polymorphic slot, split by cardKindFromRecord)",
      markKind: "cutter-suggestion",
      entityKind: "cutter-suggestion",
      bag: () => ({
        ...emptyBag(),
        cutterCards: [modeBCard("card-1", "anc-1", "suggestion")],
      }),
    },
    {
      label: "report-request (polymorphic slot, split by cardKindFromRecord)",
      markKind: "report-request",
      entityKind: "report-request",
      bag: () => ({
        ...emptyBag(),
        reportCards: [modeBCard("card-1", "anc-1", "report-request")],
      }),
    },
  ];

  for (const c of cases) {
    it(`lights and opens the owning card for ${c.label}`, () => {
      const { setHoveredEntity } = driveOne({
        markKind: c.markKind,
        anchorId: "anc-1",
        bag: c.bag(),
        cardId: "card-1",
      });
      expect(setHoveredEntity).toHaveBeenCalledWith("card-1", c.entityKind);
      expect(clicks).toEqual([{ entityId: "card-1", kind: c.entityKind }]);
    });
  }

  it("an anchor with NO owning card in any slot stays inert (no false positives)", () => {
    editor = mountDoc([
      { text: "lead " },
      { text: "anchored", anchorId: "anc-orphan", markKind: "highlight" },
    ]);
    const setHoveredEntity = vi.fn();
    renderHook(() =>
      useTextHoverBridge({ editor, cards: emptyBag(), setHoveredEntity }),
    );
    const span = spanFor(editor, "anc-orphan");
    span.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    span.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(setHoveredEntity).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
  });
});
