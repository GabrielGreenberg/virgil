// @vitest-environment jsdom
//
// Task 687 — Escape on the citation CREATE popover ABANDONS the staged keys.
//
// The sibling suite (`citation-create-popover.test.tsx`) mocks `CitekeyPicker`
// so it can drive the staging/commit logic in isolation; that mock is exactly
// where this defect could hide, because the bug was never in the popover's
// arithmetic — it was in which of the picker's exits the popover had bound the
// commit chokepoint to. Escape does not even reach the picker's own keydown
// handler in practice: `useMenuDismiss` owns a capture-phase window listener
// and stops the event there. So the claim "Escape abandons" is only testable
// through the REAL chain:
//
//   CitationCreatePopover → CitekeyPicker → BibEntryPickerMenu
//     → MenuProvider → useMenuDismiss's window-capture Escape
//
// which is what this file drives, with a real `KeyboardEvent` on `window`.
//
// Deliberately NOT asserted: that a library-only entry staged before the Escape
// is removed from `references.bib`. Staging calls `onAddBibEntry` at pick time,
// and a cancel leaves that row in place — an uncited BibTeX entry is inert,
// whereas removing one on an abandon path is a bib mutation that could delete a
// key cited elsewhere. The leg below pins that decision rather than leaving it
// implicit.

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { BibEntry } from "@/lib/types";
import { CitationCreatePopover } from "@/panels/Citations/CitationCreatePopover";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// The picker reaches the Library catalog store, which opens indexedDB on mount
// — absent in jsdom. Stub the hook layer only; everything below it is real.
// One LIBRARY-ONLY entry, so the "staging writes to references.bib before the
// user has committed anything" path is live in this harness.
const LIBRARY_ONLY: BibEntry = {
  uid: "uid-quine1960",
  key: "quine1960",
  type: "book",
  fields: { author: "Quine, W. V. O.", title: "Word and Object", year: "1960" },
  raw: "",
};

vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [LIBRARY_ONLY], loading: false }),
  useLibraryMemberships: () => ({ membershipMap: new Map(), loading: false }),
  useLibraryEntryLookup: () => () => undefined,
}));

beforeAll(() => {
  (HTMLElement.prototype as { scrollIntoView?: () => void }).scrollIntoView =
    () => undefined;
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

function entry(key: string, author: string, title: string): BibEntry {
  return {
    uid: `uid-${key}`,
    key,
    type: "article",
    fields: { author, title, year: "1980" },
    raw: "",
  };
}

const ENTRIES: BibEntry[] = [
  entry("kripke1980", "Kripke, Saul", "Naming and Necessity"),
  entry("lewis1986", "Lewis, David", "On the Plurality of Worlds"),
];

const ANCHOR = {
  top: 100,
  bottom: 120,
  left: 40,
  right: 140,
  width: 100,
  height: 20,
  x: 40,
  y: 100,
  toJSON: () => ({}),
} as DOMRect;

function setup() {
  const onCommit = vi.fn();
  const onClose = vi.fn();
  const onAddBibEntry = vi.fn();
  render(
    <CitationCreatePopover
      anchorRect={ANCHOR}
      paperBibEntries={ENTRIES}
      onAddBibEntry={onAddBibEntry}
      onCommit={onCommit}
      onClose={onClose}
    />,
  );
  return { onCommit, onClose, onAddBibEntry };
}

/** Click a result row by citekey — the option ids carry it. */
function stage(key: string) {
  const row = document.querySelector(
    `[id="bib-entry-picker-item-opt:${key}"]`,
  ) as HTMLElement | null;
  expect(row).toBeTruthy();
  fireEvent.click(row!);
}

function pressEscape() {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function stagedChips(): string[] {
  return Array.from(document.querySelectorAll('[aria-label^="Remove "]')).map(
    (b) => (b.getAttribute("aria-label") ?? "").replace("Remove ", ""),
  );
}

describe("citation create popover — Escape abandons the staged keys", () => {
  it("stages two keys, then a real Escape commits NOTHING and closes", () => {
    const { onCommit, onClose } = setup();
    stage("kripke1980");
    stage("lewis1986");
    // Precondition: the popover really is holding two staged keys, so the
    // assertion below is about the ABANDON and not about an empty popover.
    expect(stagedChips()).toEqual(["kripke1980", "lewis1986"]);

    pressEscape();

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape with nothing staged closes exactly once", () => {
    const { onCommit, onClose } = setup();
    pressEscape();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click-away still COMMITS the staged keys — the dismissal model is unchanged", () => {
    vi.useFakeTimers();
    const { onCommit, onClose } = setup();
    stage("kripke1980");
    act(() => {
      vi.runAllTimers();
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["kripke1980"]);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("the OK button still commits", () => {
    const { onCommit } = setup();
    stage("lewis1986");
    fireEvent.click(screen.getByText("OK"));
    expect(onCommit).toHaveBeenCalledWith(["lewis1986"]);
  });

  it("the header × abandons too — its own label names Escape", () => {
    const { onCommit, onClose } = setup();
    stage("kripke1980");
    fireEvent.click(screen.getByLabelText("Close (Esc)"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a cancel leaves a staged library entry IN references.bib (stated decision)", () => {
    // Staging a library-only key calls `onAddBibEntry` at PICK time, so by the
    // time the user presses Escape the entry may already be on disk. The cancel
    // does not undo it, and that is deliberate: an uncited BibTeX entry is
    // inert, whereas removing one on an abandon path is a bib mutation that
    // could delete a key cited elsewhere. The citation itself is still
    // abandoned — that is the pair this leg pins.
    const { onAddBibEntry, onCommit } = setup();
    stage("quine1960");
    expect(onAddBibEntry).toHaveBeenCalledTimes(1);
    expect(onAddBibEntry).toHaveBeenCalledWith(
      expect.objectContaining({ key: "quine1960" }),
    );

    pressEscape();

    expect(onCommit).not.toHaveBeenCalled();
    // No compensating removal: the add stands at exactly one call.
    expect(onAddBibEntry).toHaveBeenCalledTimes(1);
  });
});
