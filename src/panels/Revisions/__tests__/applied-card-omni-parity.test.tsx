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

// Minimal no-op prop bag. NOTE: onKeep/onRevert are intentionally OMITTED — the
// omni/float condition. onApply is also omitted (not a pending card).
function renderApplied(
  card: RevisionSuggestionCardData,
  controller: { isOn: boolean; keep: (f: string, id: string) => void; revert: (f: string, id: string) => void },
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
  it("renders Keep + Revert WITHOUT onKeep/onRevert callbacks", () => {
    renderApplied(makeApplied(), { isOn: true, keep: vi.fn(), revert: vi.fn() });
    expect(screen.getByText("Keep")).toBeTruthy();
    expect(screen.getByText("Revert")).toBeTruthy();
  });

  it("routes Keep/Revert through the controller with the family + id", () => {
    const keep = vi.fn();
    const revert = vi.fn();
    renderApplied(makeApplied(), { isOn: true, keep, revert });

    fireEvent.click(screen.getByText("Keep"));
    expect(keep).toHaveBeenCalledWith("revision-suggestion", "rs1");
    expect(revert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Revert"));
    expect(revert).toHaveBeenCalledWith("revision-suggestion", "rs1");
  });

  it("hides the original until the 'Original' chevron is clicked", () => {
    renderApplied(makeApplied(), { isOn: true, keep: vi.fn(), revert: vi.fn() });
    // Collapsed by default: no rendered original (the stubbed BorrowedMainText).
    expect(screen.queryByTestId("borrowed")).toBeNull();
    // Click the Original disclosure to expand.
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(screen.getByTestId("borrowed")).toBeTruthy();
  });

  it("disables Keep/Revert when the controller is off (defensive)", () => {
    renderApplied(makeApplied(), { isOn: false, keep: vi.fn(), revert: vi.fn() });
    expect((screen.getByText("Keep") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Revert") as HTMLButtonElement).disabled).toBe(true);
  });
});
