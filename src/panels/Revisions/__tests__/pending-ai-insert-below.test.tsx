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
//   4. empty suggested_text (a delete/empty cut) → no Insert-below button; a
//      quiet "No replacement text to insert." notice instead.
//   5. the explanation renders always-on; the Original text stays behind a chevron.
//   6. controller off → the button is disabled (defensive).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

// The read-only original renders through BorrowedMainText, which mounts a real
// TipTap editor. Stub it: its presence/absence is the "original shown vs hidden
// behind the chevron" signal.
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
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
    links: [],
    ...over,
  };
}

function makeController(isOn = true) {
  return {
    isOn,
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
    insertBelow: vi.fn(),
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
        onAccept={() => {}}
        onReject={() => {}}
        onApply={() => {}}
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
    fireEvent.click(screen.getByRole("button", { name: "Show original text" }));
    expect(screen.getByTestId("borrowed")).toBeTruthy();
  });

  it("hides Insert below for an empty suggested_text (a delete/empty cut) — shows a notice", () => {
    renderCard(makePending({ suggested_text: "" }), makeController());
    expect(screen.queryByRole("button", { name: "Insert below" })).toBeNull();
    expect(screen.getByText("No replacement text to insert.")).toBeTruthy();
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
