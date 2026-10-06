// @vitest-environment jsdom
//
// TASK 976 — a selected citation answers the Delete key, through the shell.
//
// Fixture plumbing (storage / library / body-surface mocks) mirrors
// `citation-last-key-remove-confirm.test.tsx`.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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

import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CitationCard } from "@/panels/Citations/CitationCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { BibEntry, CitationRef } from "@/lib/types";

afterEach(cleanup);

// A citation offered the trash and no Delete key: its PanelCard got
// the trash thunk but no keydown arm, while every other anchored card deleted
// by key. The shell now arms the key from the trash thunk itself, so a card
// cannot have one without the other.

const ENTRIES: BibEntry[] = [
  {
    uid: "uid-xen",
    key: "xenakis2020",
    type: "book",
    fields: { author: "Xenakis, Iannis", year: "2020", title: "Formalized Music" },
    raw: "@book{xenakis2020,...}",
  },
];
const REF = { kind: "citation" as const, id: "cit1" };
const CONFIRM = "This citation is referenced in the document. Delete it?";

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

function renderSelected(citation: CitationRef) {
  const onDelete = vi.fn<(id: string) => void>();
  cardStore.select(REF);
  render(
    <CitationCard
      citation={citation}
      isSelected={false}
      bibEntries={ENTRIES}
      bibPackage="natbib"
      getDisplayText={() => "Xenakis 2020"}
      isAnchored
      onSelect={() => {}}
      onJump={() => {}}
      onUpdateCitation={() => {}}
      onDelete={onDelete}
    />,
  );
  const shell = document.querySelector<HTMLElement>('[data-card]')!;
  return { onDelete, shell };
}

describe("a selected citation answers the Delete key (task 976)", () => {
  it("is keyboard-reachable while selected", () => {
    const { shell } = renderSelected({
      id: "cit1", command: "\\citep{xenakis2020}", keys: ["xenakis2020"],
      createdAt: "2026-10-06T00:00:00.000Z",
    } as CitationRef);
    expect(shell.tabIndex).toBe(0);
  });

  it("Delete on a keyed citation opens the confirm beside the card, and confirming deletes", async () => {
    const { onDelete, shell } = renderSelected({
      id: "cit1", command: "\\citep{xenakis2020}", keys: ["xenakis2020"],
      createdAt: "2026-10-06T00:00:00.000Z",
    } as CitationRef);
    fireEvent.keyDown(shell, { key: "Delete" });
    expect(onDelete).not.toHaveBeenCalled();
    const message = screen.getByText(CONFIRM);
    expect(message.closest<HTMLElement>("[tabindex='-1']")!.style.position).toBe("fixed");
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("cit1"));
  });

  it("Backspace on a keyless citation deletes straight through", () => {
    const { onDelete, shell } = renderSelected({
      id: "cit1", command: "", keys: [], createdAt: "2026-10-06T00:00:00.000Z",
    } as CitationRef);
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalledWith("cit1");
  });
});
