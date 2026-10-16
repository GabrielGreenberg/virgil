// @vitest-environment jsdom
//
// Task 1141 at the CARD: a citation whose note holds a braced `]`
// (`\citep[p.~3 {[}n.~2{]}]{k}`) is one the scanner builds an atom from. Before
// 1141 the model could not read it, so the card held one EMPTY row and the next
// `persist()` (here: the star toggle) had nothing to write. The model now reads
// it through the scanner's own reader, so the toggle writes the note intact.
// A plural group's comma list survives the same persist, re-joined.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// CitekeyPicker (always mounted by CitationCard, open=false) reaches the
// Library catalog store, which opens indexedDB on mount — absent in jsdom.
vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
  useLibraryMemberships: () => ({ memberships: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));

vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import { parseCiteCommand } from "@/lib/bib-parser";
import type { CitationRef } from "@/lib/types";

afterEach(cleanup);

/** `useFloatingMenuPosition` renders the menu `visibility: hidden` until its
 *  first measurement lands, and Testing Library's `getByRole` skips elements
 *  hidden from the accessibility tree — so a menu asserted on synchronously is
 *  a menu that is open, correct, and unqueryable. Flush the measurement (and
 *  the dismiss controller's `setTimeout(…, 0)`) before asking about rows. */
async function settleMenu() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

function renderCard(command: string, bibPackage: string) {
  const emitted: string[] = [];
  const citation: CitationRef = {
    id: "cit1",
    command,
    keys: parseCiteCommand(command)?.keys ?? [],
    createdAt: "2026-10-16T00:00:00.000Z",
  };
  cardStore.collapse({ kind: "citation", id: citation.id });
  cardStore.clearSelection();
  render(
    <CitationCard
      citation={citation}
      isSelected={false}
      isAnchored
      bibEntries={[]}
      bibPackage={bibPackage}
      getDisplayText={() => ""}
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={(_id, cmd) => {
        emitted.push(cmd);
      }}
    />,
  );
  return emitted;
}

async function toggleStar() {
  fireEvent.click(screen.getByLabelText("Expand card"));
  fireEvent.click(screen.getByLabelText("More options"));
  await settleMenu();
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Full author list/i }));
}

beforeEach(() => cardStore.clearSelection());

describe("CitationCard — a braced `]` note survives a persist (task 1141)", () => {
  it("star toggle writes the command with the note intact", async () => {
    const emitted = renderCard("\\citep[p.~3 {[}n.~2{]}]{smith}", "natbib");
    await toggleStar();
    expect(emitted.at(-1)).toBe("\\citep*[p.~3 {[}n.~2{]}]{smith}");
  });

  it("a plural group's comma list stays one group through a star toggle", async () => {
    const emitted = renderCard("\\cites[p. 1]{a,b}[p. 2]{c}", "biblatex");
    await toggleStar();
    expect(emitted.at(-1)).toBe("\\cites*[p. 1]{a,b}[p. 2]{c}");
  });
});
