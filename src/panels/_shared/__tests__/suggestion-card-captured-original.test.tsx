// @vitest-environment jsdom
//
// TASK 714 — the suggestion card's "Original" renders the RICH capture, on
// every branch, in BOTH families.
//
// Task 488 shipped a rich capture of the quoted passage (`selectedContent`)
// beside the plain string, because `doc.textBetween` drops every mark AND every
// inline ATOM — so no render-time parse can recover a citation the user
// selected. Tasks 694 and 696 then built the machinery that carries that capture
// through load, morph and clone, and `capture-pair-census` guards that the two
// halves travel together.
//
// And the Revisions card never asked for it. `RevisionSuggestionCard.tsx` had
// never contained the string `selectedContent` on any of its four branches, so
// every quoted passage in that panel rendered from bytes — `\citep{foo}`,
// `\emph{…}` — on the docked card, in omni, in the float and popped out alike,
// while the byte-similar Cutter card one directory over rendered the same
// passage as prose.
//
// NO EXISTING SUITE COULD SEE IT. `captured-passage.test.tsx` pins the DOOR
// (given a rich capture, it renders it); the panel suites `vi.mock` the
// rendering surface away and assert the foldout's presence. What was never asked
// is whether the card HANDS the door the capture it is carrying. That is what
// this suite asks — against the real static borrowed surface — and it asks it
// of both families off ONE fixture, so the answer cannot differ by panel again.
//
// The falsifiable tooth is the CITATION's `displayText`. `richLatexToJson` (the
// door's byte rung) has no bibliography and cannot invent "(Foo 2020)" from
// `\citep{foo}`; only the rich capture carries it. Every leg therefore has a
// CONTROL twin — the same card with `selectedContent` stripped — which must NOT
// show it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// The EDITABLE fields mount a real TipTap editor — stub that one. The captured
// passage deliberately does NOT get stubbed: it is the surface under test.
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));

// jsdom has no ResizeObserver; the unified header measures itself with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { CutterSuggestionCard } from "@/panels/Cutter/CutterSuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import type {
  CutterSuggestionCard as CutterSuggestionCardData,
  RevisionSuggestionCard as RevisionSuggestionCardData,
} from "@/lib/types";

/** The bytes a pre-488 / skill-authored card carries — real inline `.tex`. */
const LATEX = "a \\emph{stressed} claim \\citep{foo}";

/** The rich capture of the SAME passage: an emphasis mark and an inline atom
 *  whose resolved display text the byte rung cannot possibly produce. */
const RICH = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "a " },
        { type: "text", marks: [{ type: "italic" }], text: "stressed" },
        { type: "text", text: " claim " },
        {
          type: "citation",
          attrs: { command: "\\citep{foo}", displayText: "(Foo 2020)" },
        },
      ],
    },
  ],
};

/** The atom's resolved text — present iff the RICH capture reached the door. */
const RICH_ONLY = "(Foo 2020)";

const FAMILIES = [
  {
    family: "revision-suggestion" as const,
    id: "rs1",
    panel: "revisions" as const,
    Card: RevisionSuggestionCard as unknown as React.ComponentType<
      Record<string, unknown>
    >,
  },
  {
    family: "cutter-suggestion" as const,
    id: "cs1",
    panel: "cutter" as const,
    Card: CutterSuggestionCard as unknown as React.ComponentType<
      Record<string, unknown>
    >,
  },
];

type SuggestionFixture =
  | RevisionSuggestionCardData
  | CutterSuggestionCardData;

function makeCard(
  id: string,
  panel: "revisions" | "cutter",
  over: Partial<SuggestionFixture> = {},
): SuggestionFixture {
  return {
    kind: "suggestion",
    id,
    createdAt: "2026-09-22T00:00:00.000Z",
    author: "human",
    original_text: LATEX,
    suggested_text: "a plain claim",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    selectedText: "a stressed claim ",
    selectedContent: RICH,
    links: [
      {
        id: "l1",
        kind: "anchor",
        createdAt: "2026-09-22T00:00:00.000Z",
        anchor: {
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds: ["P1"],
        },
        target: { panel, cardId: id },
      },
    ],
    ...over,
  } as SuggestionFixture;
}

function makeController() {
  return {
    canProduce: true,
    canResolve: true,
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
    insertBelow: vi.fn(),
    apply: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
  };
}

function renderCard(
  Card: React.ComponentType<Record<string, unknown>>,
  card: SuggestionFixture,
) {
  return render(
    <PendingChangeControllerProvider value={makeController()}>
      <Card
        card={card}
        selected={false}
        onUpdateField={() => {}}
        onConvert={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    </PendingChangeControllerProvider>,
  );
}

/** Reveal the "Original text" foldout the record bodies keep collapsed. */
function openOriginalFoldout(container: HTMLElement) {
  const btn = within(container).getByText("Original text");
  fireEvent.click(btn);
}

/** The whole assertion, in one place: the passage reads as PROSE. */
function expectRichPassage(container: HTMLElement) {
  const passage = container.querySelector(".captured-passage");
  expect(passage, "the captured-passage door must be mounted").toBeTruthy();
  const text = passage!.textContent ?? "";
  expect(text).toContain(RICH_ONLY);
  expect(passage!.querySelector("em")).toBeTruthy();
  expect(text).not.toContain("\\citep{");
  expect(text).not.toContain("\\emph{");
}

/** The control: the same branch with NO rich capture cannot show the atom's
 *  resolved text, which is what makes every leg above falsifiable. */
function expectByteFallback(container: HTMLElement) {
  const passage = container.querySelector(".captured-passage");
  expect(passage).toBeTruthy();
  expect(passage!.textContent ?? "").not.toContain(RICH_ONLY);
}

beforeEach(() => {
  setPendingChangesFlag(true);
});

afterEach(() => {
  cleanup();
  setPendingChangesFlag(undefined);
  for (const { family, id } of FAMILIES) cardStore.collapse({ kind: family, id });
});

describe.each(FAMILIES)(
  "$family — the Original renders the rich capture on every branch",
  ({ family, id, panel, Card }) => {
    const ref = { kind: family, id } as const;

    it("the HUMAN field grid hands `original_text` its capture", () => {
      cardStore.expand(ref);
      const rich = renderCard(Card, makeCard(id, panel));
      expectRichPassage(rich.container);
      cleanup();

      const bytes = renderCard(
        Card,
        makeCard(id, panel, { selectedContent: undefined }),
      );
      expectByteFallback(bytes.container);
    });

    it("the AI pending record body hands its foldout the capture", () => {
      cardStore.expand(ref);
      const rich = renderCard(Card, makeCard(id, panel, { author: "ai" }));
      openOriginalFoldout(rich.container);
      expectRichPassage(rich.container);
      cleanup();

      const bytes = renderCard(
        Card,
        makeCard(id, panel, { author: "ai", selectedContent: undefined }),
      );
      openOriginalFoldout(bytes.container);
      expectByteFallback(bytes.container);
    });

    it("the APPLIED record body hands its foldout the capture — until the splice lands", () => {
      cardStore.expand(ref);
      const rich = renderCard(
        Card,
        makeCard(id, panel, { author: "ai", status: "applied" }),
      );
      openOriginalFoldout(rich.container);
      expectRichPassage(rich.container);
      cleanup();

      // Once `appliedChange` exists, the original being shown is the PRE-SPLICE
      // paragraph — real `.tex` the door's parse rung reads — so the capture,
      // which describes `original_text`, is deliberately withheld. Pinning the
      // rule here stops a future "make it consistent" from reintroducing a
      // passage that quotes the wrong span.
      const spliced = renderCard(
        Card,
        makeCard(id, panel, {
          author: "ai",
          status: "applied",
          appliedChange: {
            anchorId: "a1",
            anchorUuid: "P1",
            originalText: LATEX,
            replacement: "a plain claim",
            mode: "replace",
            appliedAt: "2026-09-22T00:00:00.000Z",
          },
        }),
      );
      openOriginalFoldout(spliced.container);
      expectByteFallback(spliced.container);
    });

    it("the COMPRESSED cue reads the same door, not the raw bytes", () => {
      cardStore.collapse(ref);
      // The original cue only shows when there is no suggested text to show
      // instead (the green half of the diff legend wins).
      const rich = renderCard(
        Card,
        makeCard(id, panel, { suggested_text: "" }),
      );
      const text = rich.container.textContent ?? "";
      expect(text).toContain(RICH_ONLY);
      expect(text).not.toContain("\\citep{");
      expect(text).not.toContain("\\emph{");
      cleanup();

      const bytes = renderCard(
        Card,
        makeCard(id, panel, { suggested_text: "", selectedContent: undefined }),
      );
      expect(bytes.container.textContent ?? "").not.toContain(RICH_ONLY);
    });
  },
);

describe("the two families answer identically (task 714 — they are one component)", () => {
  it("renders the same passage markup for a revision and a cutter suggestion", () => {
    for (const { family, id } of FAMILIES) cardStore.expand({ kind: family, id });
    const rendered = FAMILIES.map(({ id, panel, Card }) => {
      const { container } = renderCard(Card, makeCard(id, panel));
      const html =
        container.querySelector(".captured-passage")?.innerHTML ?? "";
      cleanup();
      return html;
    });
    expect(rendered[0]).toBeTruthy();
    expect(rendered[0]).toBe(rendered[1]);
  });
});
