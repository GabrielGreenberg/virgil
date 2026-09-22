// @vitest-environment jsdom
//
// The retired 4-field AI fallback (task 034). A `pending` AI-authored suggestion
// card must NEVER render the editable 4-field grid (original / suggested /
// explanation / your-text). Instead it shows the minimal read-only body carrying
// the single "Insert below" verb. A `pending` HUMAN-drafted card keeps the grid
// (composition preserved). This suite pins:
//   1. pending AI + expanded → Insert-below body, NO textareas (no grid).
//   2. clicking Insert below → controller.insertBelow("revision-suggestion", id).
//   3. pending HUMAN + expanded → the 4-field grid (textareas present), no button.
//   4. empty replacement (a delete/empty cut) → the button stays, DISABLED,
//      with the refusal said beneath it (task 713 — it used to be hidden).
//   5. the explanation renders always-on; the Original text stays behind a chevron.
//   6. controller off → the button is disabled (defensive).
//   7. TASK 713 — an UNANCHORED card gets a disabled button + a stated reason,
//      not a live one whose press `insertSuggestionBelow` silently refuses; and
//      a human's `user_text` alone is replacement enough to enable the verb.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// The card body renders through EditableCard → RichTextField, which mounts a
// real TipTap editor. Stub it.
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
// RENEGOTIATED (task 488): the Original foldout no longer mounts a read-only
// TipTap editor. It renders through the shared `captured-passage` door, whose
// surface is the STATIC borrowed tier — nothing here is editable, so an editor
// bought nothing and cost a mount. Stub the static surface instead; its
// presence/absence is still the "original shown vs hidden behind the chevron"
// signal this leg is about. What the door actually RENDERS is pinned where the
// door lives (captured-passage.test.tsx), against the real surface.
vi.mock("@/components/StaticBorrowedText", () => ({
  StaticBorrowedText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

// jsdom has no ResizeObserver; the unified header measures itself with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RevisionSuggestionCard } from "@/panels/Revisions/RevisionSuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import type { RevisionSuggestionCard as RevisionSuggestionCardData } from "@/lib/types";

const CARD_REF = { kind: "revision-suggestion" as const, id: "rs1" };

beforeEach(() => {
  setPendingChangesFlag(true);
  // The minimal body only shows on the EXPANDED (non-compressed) card; expand it
  // in the shared default store the card reads.
  cardStore.expand(CARD_REF);
});

afterEach(() => {
  cleanup();
  setPendingChangesFlag(undefined);
  cardStore.collapse(CARD_REF);
});

function makePending(
  over: Partial<RevisionSuggestionCardData> = {},
): RevisionSuggestionCardData {
  return {
    kind: "suggestion",
    id: "rs1",
    createdAt: "2026-07-01T00:00:00.000Z",
    author: "ai",
    original_text: "The original sentence.",
    suggested_text: "The revised sentence.",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    // ANCHORED by default (task 713): `insertSuggestionBelow` bails without a
    // Mode-A paragraph link, so an unanchored fixture would pin a press that
    // does nothing. The unanchored case is now its own leg, below.
    links: [
      {
        id: "l1",
        kind: "anchor",
        createdAt: "2026-07-01T00:00:00.000Z",
        anchor: {
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds: ["P1"],
        },
        target: { panel: "revisions", cardId: "rs1" },
      },
    ],
    ...over,
  } as RevisionSuggestionCardData;
}

function makeController(canProduce = true) {
  return {
    canProduce,
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
  card: RevisionSuggestionCardData,
  controller: ReturnType<typeof makeController>,
) {
  return render(
    <PendingChangeControllerProvider value={controller}>
      <RevisionSuggestionCard
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

describe("pending AI suggestion — minimal Insert-below body (retires the 4-field grid)", () => {
  it("renders Insert below and NO editable 4-field grid", () => {
    renderCard(makePending(), makeController());
    expect(screen.getByRole("button", { name: "Insert below" })).toBeTruthy();
    // The 4-field grid renders <textarea>s; the minimal AI body has none.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("routes Insert below through the controller with the family + id", () => {
    const controller = makeController();
    renderCard(makePending(), controller);

    fireEvent.click(screen.getByRole("button", { name: "Insert below" }));
    expect(controller.insertBelow).toHaveBeenCalledWith("revision-suggestion", "rs1");
  });

  it("renders the explanation always-on, hides the original behind the chevron", () => {
    renderCard(
      makePending({ explanation: "Tightened the clause for concision." }),
      makeController(),
    );
    expect(screen.getByText("Tightened the clause for concision.")).toBeTruthy();
    // Original hidden until disclosed.
    expect(screen.queryByTestId("borrowed")).toBeNull();
    // The disclosure is named by its own VISIBLE text now (task 424): an
    // `aria-label` on a text-bearing control REPLACES that text in the
    // name computation, which is the defect this query used to depend on.
    fireEvent.click(screen.getByRole("button", { name: "Original text" }));
    expect(screen.getByTestId("borrowed")).toBeTruthy();
  });

  it("disables Insert below for an empty replacement (a delete/empty cut) and SAYS why", () => {
    renderCard(makePending({ suggested_text: "" }), makeController());
    const btn = screen.getByRole("button", { name: "Insert below" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("pending-insert-blocked").textContent).toMatch(
      /nothing to put in the paper/i,
    );
  });

  it("task 713 — an UNANCHORED card disables the verb with a reason, not a live no-op", () => {
    const controller = makeController();
    renderCard(makePending({ links: [] }), controller);
    const btn = screen.getByRole("button", { name: "Insert below" }) as HTMLButtonElement;
    // `insertSuggestionBelow` bails on a missing Mode-A anchor and returns
    // `false` with no status write and no notice — so a live button here was a
    // press that did nothing, forever.
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("pending-insert-blocked").textContent).toMatch(
      /not anchored/i,
    );
    fireEvent.click(btn);
    expect(controller.insertBelow).not.toHaveBeenCalled();
  });

  it("task 713 — the human's user_text alone is replacement enough", () => {
    renderCard(
      makePending({ suggested_text: "", user_text: "My own wording." }),
      makeController(),
    );
    const btn = screen.getByRole("button", { name: "Insert below" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.queryByTestId("pending-insert-blocked")).toBeNull();
  });

  it("disables Insert below when the controller is off (defensive)", () => {
    renderCard(makePending(), makeController(false));
    expect(
      (screen.getByRole("button", { name: "Insert below" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("pending HUMAN suggestion — the 4-field grid is preserved", () => {
  it("renders the editable grid (textareas) and NO Insert-below button", () => {
    renderCard(makePending({ author: "human" }), makeController());
    // Human composition surface: the grid's textareas are present …
    expect(document.querySelector("textarea")).not.toBeNull();
    // … and the AI-only Insert-below verb is absent.
    expect(screen.queryByRole("button", { name: "Insert below" })).toBeNull();
  });
});
