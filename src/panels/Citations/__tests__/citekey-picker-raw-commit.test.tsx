// @vitest-environment jsdom
//
// The citation picker's raw commit reads the citekey rule (task 945). Enter on
// a query that matches nothing used to commit the TEXT AS TYPED into
// `\cite{…}` — a search phrase became an undefined key, a `}` or `%` corrupted
// the user's `.tex`. Now a query that is not a key (or comma list of keys)
// offers no commit: the reason renders in the empty state and Enter stays put.
// Drives the REAL CitekeyPicker → BibEntryPickerMenu.
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { BibEntry } from "@/lib/types";
import { CitekeyPicker } from "@/panels/Citations/CitekeyPicker";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

vi.mock("@/hooks/useLibrary", () => ({
  useLibraryItems: () => ({ items: [], loading: false }),
  useLibraryMasterBib: () => ({ entries: [], loading: false }),
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

const ENTRIES: BibEntry[] = [
  {
    uid: "uid-lewis1986",
    key: "lewis1986",
    type: "book",
    fields: { author: "Lewis, David", title: "On the Plurality of Worlds", year: "1986" },
    raw: "",
  },
];

const ANCHOR = {
  top: 100, bottom: 120, left: 40, right: 140, width: 100, height: 20,
  x: 40, y: 100, toJSON: () => ({}),
} as DOMRect;

function setup(extra: Partial<React.ComponentProps<typeof CitekeyPicker>> = {}) {
  const onSelectKeys = vi.fn();
  const onClose = vi.fn();
  const onEnterCommit = vi.fn();
  render(
    <CitekeyPicker
      onAddBibEntry={null}
      open
      anchorRect={ANCHOR}
      onClose={onClose}
      paperBibEntries={ENTRIES}
      onSelectKeys={onSelectKeys}
      {...extra}
    />,
  );
  const input = screen.getByPlaceholderText("Search references or library…");
  const typeAndEnter = (text: string) => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };
  return { onSelectKeys, onClose, onEnterCommit, input, typeAndEnter };
}

describe("citation picker — raw citekey commit", () => {
  it("commits a legal unknown key as before", () => {
    const { onSelectKeys, onClose, typeAndEnter } = setup();
    typeAndEnter("kripke1980");
    expect(onSelectKeys).toHaveBeenCalledWith(["kripke1980"]);
    expect(onClose).toHaveBeenCalled();
  });

  it("commits a typed comma list as its KEYS, never the joined text (task 1144)", () => {
    const { onSelectKeys, typeAndEnter } = setup();
    typeAndEnter("kripke1980, quine1960");
    expect(onSelectKeys).toHaveBeenCalledWith(["kripke1980", "quine1960"]);
  });

  it("in the deferred create popover, Return hands the same split keys to the commit", () => {
    const onEnterCommit = vi.fn();
    const { onSelectKeys, typeAndEnter } = setup({ keepOpenOnPick: true, onEnterCommit });
    typeAndEnter("kripke1980,quine1960");
    expect(onSelectKeys).toHaveBeenCalledWith(["kripke1980", "quine1960"]);
    expect(onEnterCommit).toHaveBeenCalledWith(["kripke1980", "quine1960"]);
  });

  it("refuses a search phrase, says why, and stays open", () => {
    const { onSelectKeys, onClose, typeAndEnter } = setup();
    typeAndEnter("Kripke naming");
    expect(onSelectKeys).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot contain a space/)).toBeTruthy();
    expect(screen.queryByText(/as a raw/)).toBeNull();
  });

  it.each([["a}b"], ["a%b"]])("refuses %s — bytes that would corrupt the .tex", (q) => {
    const { onSelectKeys, typeAndEnter } = setup();
    typeAndEnter(q);
    expect(onSelectKeys).not.toHaveBeenCalled();
  });

  it("in the deferred create popover, a refused key neither stages nor commits", () => {
    const { onSelectKeys, onEnterCommit, onClose, typeAndEnter } = (() => {
      const onEnterCommit = vi.fn();
      const s = setup({ keepOpenOnPick: true, onEnterCommit });
      return { ...s, onEnterCommit };
    })();
    typeAndEnter("a}b");
    expect(onSelectKeys).not.toHaveBeenCalled();
    expect(onEnterCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
