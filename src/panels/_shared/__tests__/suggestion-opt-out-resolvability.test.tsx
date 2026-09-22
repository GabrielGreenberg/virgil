// @vitest-environment jsdom
//
// TASK 716 — THE FLAG GATES PRODUCTION, THE STATUS GATES PRESENTATION.
//
// `virgil:pending-changes` defaults ON and its localStorage key is the
// documented OPT-OUT back to the legacy accept-immediately path. A card's
// `status`, by contrast, is persisted document state: `revisions.json` /
// `cutter.json` hold `applied` / `stale` records written while the flag was on,
// and they outlive the flip — along with a live blue `pending-ai-change` range
// in the manuscript.
//
// The card used to gate the STATUS branches on the FLAG
// (`isPendingChangesOn() && card.status === "applied"`), which meant opting out
// unmounted the only surface carrying Keep / Revert and left that blue range
// unresolvable; and an AI pending card's sole verb (Insert below) read the flag
// through the controller, so it went permanently disabled while Accept / Reject
// lived in the branch an AI card never takes — zero working buttons under
// exactly the opt-out the legacy path exists for.
//
// Both families are pinned, because both render the ONE shared `SuggestionCard`
// (task 714) — and the flag-ON path is pinned too, so the default stays put.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/StaticBorrowedText", () => ({
  StaticBorrowedText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SuggestionCard } from "@/panels/_shared/SuggestionCard";
import { PendingChangeControllerProvider } from "@/links/pending-change-controller";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";
import type { PendingChangeFamily } from "@/links/apply-suggestion";
import type { SuggestionCardData } from "@/panels/_shared/SuggestionCard";

const FAMILIES: PendingChangeFamily[] = [
  "revision-suggestion",
  "cutter-suggestion",
];

const CARD_ID = "s1";
const refFor = (family: PendingChangeFamily) => ({ kind: family, id: CARD_ID });

beforeEach(() => {
  for (const f of FAMILIES) cardStore.expand(refFor(f));
});
afterEach(() => {
  cleanup();
  setPendingChangesFlag(undefined);
  for (const f of FAMILIES) cardStore.collapse(refFor(f));
});

function makeCard(
  family: PendingChangeFamily,
  over: Partial<SuggestionCardData> = {},
): SuggestionCardData {
  return {
    kind: "suggestion",
    id: CARD_ID,
    createdAt: "2026-09-22T00:00:00.000Z",
    author: "ai",
    original_text: "The original sentence.",
    suggested_text: "The revised sentence.",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
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
        target: {
          panel: family === "revision-suggestion" ? "revisions" : "cutter",
          cardId: CARD_ID,
        },
      },
    ],
    ...over,
  } as SuggestionCardData;
}

/** A controller whose RESOLVE capability is live (an editor is mounted) while
 *  PRODUCE follows the flag — exactly what `EditorPane` assembles. */
function makeController(canProduce: boolean) {
  return {
    canProduce,
    canResolve: true,
    apply: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
    insertBelow: vi.fn(),
  };
}

function renderCard(
  family: PendingChangeFamily,
  card: SuggestionCardData,
  controller: ReturnType<typeof makeController>,
) {
  return render(
    <PendingChangeControllerProvider value={controller}>
      <SuggestionCard
        card={card}
        family={family}
        selected={false}
        onUpdateField={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    </PendingChangeControllerProvider>,
  );
}

const APPLIED_CHANGE = {
  anchorId: "a1",
  anchorUuid: "P1",
  originalText: "The original sentence.",
  replacement: "The revised sentence.",
  mode: "replace" as const,
};

const enabled = (name: string | RegExp) =>
  !(screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

describe.each(FAMILIES)("%s — opting out never strands a landed change", (family) => {
  it("an APPLIED card still renders Keep / Revert with the flag OFF", () => {
    setPendingChangesFlag(false);
    renderCard(
      family,
      makeCard(family, { status: "applied", appliedChange: APPLIED_CHANGE } as Partial<SuggestionCardData>),
      makeController(false),
    );
    // The applied body: the preview toggle + the Keep / Dismiss commit pair.
    expect(screen.getByRole("group", { name: "Preview toggle" })).toBeTruthy();
    expect(enabled(/keep/i)).toBe(true);
    expect(enabled(/dismiss|revert/i)).toBe(true);
  });

  it("Keep on a flag-OFF applied card reaches the controller", () => {
    setPendingChangesFlag(false);
    const controller = makeController(false);
    renderCard(
      family,
      makeCard(family, { status: "applied", appliedChange: APPLIED_CHANGE } as Partial<SuggestionCardData>),
      controller,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));
    expect(controller.keep).toHaveBeenCalledWith(family, CARD_ID);
  });

  it("a STALE card still offers a working Dismiss with the flag OFF", () => {
    setPendingChangesFlag(false);
    const controller = makeController(false);
    renderCard(family, makeCard(family, { status: "stale" }), controller);
    const dismiss = screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement;
    expect(dismiss.disabled).toBe(false);
    fireEvent.click(dismiss);
    expect(controller.reject).toHaveBeenCalledWith(family, CARD_ID);
  });

  it("an AI pending card offers the legacy Accept / Reject pair with the flag OFF", () => {
    setPendingChangesFlag(false);
    const controller = makeController(false);
    renderCard(family, makeCard(family), controller);
    // The dead verb is GONE; the opt-out's own verbs are live.
    expect(screen.queryByRole("button", { name: "Insert below" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(controller.accept).toHaveBeenCalledWith(family, CARD_ID);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(controller.reject).toHaveBeenCalledWith(family, CARD_ID);
  });

  it("a HUMAN pending card keeps the legacy pair with the flag OFF (unchanged)", () => {
    setPendingChangesFlag(false);
    const controller = makeController(false);
    renderCard(family, makeCard(family, { author: "human" }), controller);
    expect(enabled("Accept")).toBe(true);
    expect(enabled("Reject")).toBe(true);
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });
});

describe.each(FAMILIES)("%s — the flag-ON default is unchanged", (family) => {
  it("AI pending → Insert below, no legacy pair", () => {
    setPendingChangesFlag(true);
    const controller = makeController(true);
    renderCard(family, makeCard(family), controller);
    fireEvent.click(screen.getByRole("button", { name: "Insert below" }));
    expect(controller.insertBelow).toHaveBeenCalledWith(family, CARD_ID);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("HUMAN pending → Apply, no legacy pair", () => {
    setPendingChangesFlag(true);
    const controller = makeController(true);
    renderCard(family, makeCard(family, { author: "human" }), controller);
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(controller.apply).toHaveBeenCalledWith(family, CARD_ID);
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("APPLIED → the applied body with Keep / Revert", () => {
    setPendingChangesFlag(true);
    renderCard(
      family,
      makeCard(family, { status: "applied", appliedChange: APPLIED_CHANGE } as Partial<SuggestionCardData>),
      makeController(true),
    );
    expect(screen.getByRole("group", { name: "Preview toggle" })).toBeTruthy();
    expect(enabled(/keep/i)).toBe(true);
  });

  it("STALE → the notice with a working Dismiss", () => {
    setPendingChangesFlag(true);
    renderCard(family, makeCard(family, { status: "stale" }), makeController(true));
    expect((screen.getByRole("button", { name: "Dismiss" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("the two capabilities are asked separately", () => {
  it("no editor (canResolve false) disables the applied card's commits, flag ON or OFF", () => {
    for (const flag of [true, false]) {
      setPendingChangesFlag(flag);
      const controller = { ...makeController(flag), canResolve: false };
      renderCard(
        "revision-suggestion",
        makeCard("revision-suggestion", {
          status: "applied",
          appliedChange: APPLIED_CHANGE,
        } as Partial<SuggestionCardData>),
        controller,
      );
      expect(enabled(/keep/i)).toBe(false);
      cleanup();
    }
  });

  it("canProduce false with the flag ON disables Apply but leaves the applied card live", () => {
    setPendingChangesFlag(true);
    renderCard(
      "revision-suggestion",
      makeCard("revision-suggestion", { author: "human" }),
      makeController(false),
    );
    expect(enabled("Apply")).toBe(false);
  });
});
