// @vitest-environment jsdom
//
// Applied-card surface parity (pending-ai-changes). An APPLIED revision
// suggestion must render its minimal Keep / Revert card on EVERY surface —
// including omni/float, where the host does NOT thread `onKeep`/`onRevert`
// callbacks. The applied card now routes Keep/Revert through the
// `PendingChangeController` context, so this suite renders the card WITHOUT the
// per-mount callbacks (the omni/float condition) and pins that:
//   1. Keep + Revert render (no `onKeep`/`onRevert` needed).
//   2. Clicking them calls the controller with ("revision-suggestion", id).
//   3. The original paragraph is hidden until the "Original" chevron is clicked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
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

// The read-only original renders through EditableCard → RichTextField, which
// mounts a real TipTap editor. Stub it: its presence/absence is the signal we
// assert (original shown vs hidden behind the chevron).
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

beforeEach(() => {
  // Force the pending-changes flag ON so status:"applied" reaches the applied
  // branch (independent of jsdom localStorage).
  setPendingChangesFlag(true);
});

afterEach(() => {
  cleanup();
  setPendingChangesFlag(undefined);
  cardStore.collapse({ kind: "revision-suggestion", id: "rs1" });
});

function makeApplied(
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
    status: "applied",
    appliedChange: {
      anchorId: "a1",
      anchorUuid: "u1",
      originalText: "The pre-splice original.",
      replacement: "The revised sentence.",
      mode: "replace",
      appliedAt: "2026-07-01T00:00:00.000Z",
    },
    links: [],
    ...over,
  };
}

// A controller stub with all four verbs (keep/dismiss/previewOriginal/
// previewSuggested), each a spy. `isOn` toggles the defensive disable.
function makeController(isOn = true) {
  return {
    isOn,
    keep: vi.fn(),
    dismiss: vi.fn(),
    previewOriginal: vi.fn(),
    previewSuggested: vi.fn(),
  };
}

// Minimal no-op prop bag. NOTE: onKeep/onRevert are intentionally OMITTED — the
// omni/float condition. onApply is also omitted (not a pending card).
function renderApplied(
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
        onConvert={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />
    </PendingChangeControllerProvider>,
  );
}

describe("Applied revision-suggestion card — surface parity (omni/float condition)", () => {
  it("renders the Original/Suggested toggle + Keep/Dismiss commit icons WITHOUT per-mount callbacks", () => {
    renderApplied(makeApplied(), makeController());
    expect(screen.getByRole("button", { name: "Preview original" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview suggested" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss change" })).toBeTruthy();
  });

  it("routes Check (keep) / Cross (dismiss) through the controller with the family + id", () => {
    const controller = makeController();
    renderApplied(makeApplied(), controller);

    fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
    expect(controller.keep).toHaveBeenCalledWith("revision-suggestion", "rs1");
    expect(controller.dismiss).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss change" }));
    expect(controller.dismiss).toHaveBeenCalledWith("revision-suggestion", "rs1");
  });

  it("routes the preview toggle through the controller (non-committing)", () => {
    const controller = makeController();
    renderApplied(makeApplied(), controller);

    fireEvent.click(screen.getByRole("button", { name: "Preview original" }));
    expect(controller.previewOriginal).toHaveBeenCalledWith("revision-suggestion", "rs1");

    fireEvent.click(screen.getByRole("button", { name: "Preview suggested" }));
    expect(controller.previewSuggested).toHaveBeenCalledWith("revision-suggestion", "rs1");
    // The toggle NEVER commits.
    expect(controller.keep).not.toHaveBeenCalled();
    expect(controller.dismiss).not.toHaveBeenCalled();
  });

  it("renders the explanation always-on when present, omits it when empty", () => {
    const { unmount } = renderApplied(
      makeApplied({ explanation: "Tightened the clause for concision." }),
      makeController(),
    );
    expect(screen.getByText("Tightened the clause for concision.")).toBeTruthy();
    unmount();

    // Empty explanation → the field is omitted entirely.
    renderApplied(makeApplied({ explanation: "" }), makeController());
    expect(document.querySelector("[data-applied-explanation]")).toBeNull();
  });

  it("hides the original text until the 'Original text' chevron is clicked", () => {
    renderApplied(makeApplied(), makeController());
    // Collapsed by default: no rendered original (the stubbed BorrowedMainText).
    expect(screen.queryByTestId("borrowed")).toBeNull();
    // Click the Original-text disclosure to expand.
    fireEvent.click(screen.getByRole("button", { name: "Show original text" }));
    expect(screen.getByTestId("borrowed")).toBeTruthy();
  });

  it("disables every control when the controller is off (defensive)", () => {
    renderApplied(makeApplied(), makeController(false));
    expect((screen.getByRole("button", { name: "Keep change" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Dismiss change" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Preview original" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
