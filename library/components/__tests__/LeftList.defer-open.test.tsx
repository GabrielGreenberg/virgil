// @vitest-environment jsdom
//
// C6 — "keep single-click-open, but DEFER the mount". A plain click commits
// the highlight synchronously, but the heavy open (which mounts a full
// read-only <EditorPane>) is coalesced behind an idle callback: rapidly
// clicking through rows schedules-then-cancels, so only the row the user
// settles on actually opens. Uses the REAL LeftList + LeftListRow and a
// controllable requestIdleCallback stub so the deferral is deterministic.

import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";

import LeftList from "../LeftList";
import type { RowActions } from "../LeftListRow";
import {
  __resetViewSessionForTests,
  usePanelSelection,
} from "@library/lib/view-session-store";

const memStore = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
      setItem: (k: string, v: string) => void memStore.set(k, v),
      removeItem: (k: string) => void memStore.delete(k),
      clear: () => memStore.clear(),
    },
  });
});

// Controllable idle queue. LeftList's scheduleOpen prefers
// window.requestIdleCallback (with a setTimeout fallback); install a stub so
// we can assert "not opened yet" then flush exactly the surviving callback.
let idleCbs: Array<{ id: number; cb: () => void }> = [];
let idleSeq = 1;
function flushIdle() {
  const pending = idleCbs;
  idleCbs = [];
  act(() => {
    for (const { cb } of pending) cb();
  });
}

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
  idleCbs = [];
  idleSeq = 1;
  (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (
    cb: () => void,
  ) => {
    const id = idleSeq++;
    idleCbs.push({ id, cb });
    return id;
  };
  (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = (
    id: number,
  ) => {
    idleCbs = idleCbs.filter((e) => e.id !== id);
  };
});

afterEach(() => {
  cleanup();
});

function entry(
  citekey: string,
  title: string,
  author: string,
  year: number,
): CatalogEntry {
  return {
    citekey,
    title,
    authors: [author],
    year,
    addedAt: "",
    updatedAt: "",
    pdf: { present: true },
    indexed: { state: "indexed" },
    bib: { state: "authenticated" },
  };
}

const ENTRIES: CatalogEntry[] = [
  entry("lewis1979", "Scorekeeping in a Language Game", "David Lewis", 1979),
  entry("kant1781", "Critique of Pure Reason", "Immanuel Kant", 1781),
  entry("frege1892", "On Sense and Reference", "Gottlob Frege", 1892),
];

const BIB_BY_KEY = new Map<string, BibEntry>();
const ROW_ACTIONS: RowActions = {
  onDelete: () => {},
  onBibReview: () => {},
  onTextReview: () => {},
  onImportBib: () => {},
  deleteLabel: "Delete…",
};

function Harness({ onOpenPaper }: { onOpenPaper: (c: string) => void }) {
  const sel = usePanelSelection("", "left");
  return (
    <LeftList
      entries={ENTRIES}
      bibByKey={BIB_BY_KEY}
      scope=""
      panel="left"
      libId="central"
      selectedKeys={sel.selectedKeys}
      anchorKey={sel.anchorKey}
      onSelectKeys={sel.setSelection}
      onOpenPaper={onOpenPaper}
      rowActions={ROW_ACTIONS}
      dotToneFor={() => null}
      onRowViewed={() => {}}
    />
  );
}

describe("LeftList — C6 deferred single-click open", () => {
  it("a lone click opens exactly once, only after idle flush", () => {
    const onOpenPaper = vi.fn();
    const { getByTitle } = render(<Harness onOpenPaper={onOpenPaper} />);
    fireEvent.click(getByTitle(/Scorekeeping/i));
    // Highlight is synchronous; the open is deferred.
    expect(onOpenPaper).not.toHaveBeenCalled();
    flushIdle();
    expect(onOpenPaper).toHaveBeenCalledTimes(1);
    expect(onOpenPaper).toHaveBeenCalledWith("lewis1979");
  });

  it("a burst of clicks coalesces to a single open of the LAST row", () => {
    const onOpenPaper = vi.fn();
    const { getByTitle } = render(<Harness onOpenPaper={onOpenPaper} />);
    fireEvent.click(getByTitle(/Scorekeeping/i)); // lewis
    fireEvent.click(getByTitle(/Critique/i)); // kant
    fireEvent.click(getByTitle(/Sense and Reference/i)); // frege
    expect(onOpenPaper).not.toHaveBeenCalled();
    flushIdle();
    expect(onOpenPaper).toHaveBeenCalledTimes(1);
    expect(onOpenPaper).toHaveBeenCalledWith("frege1892");
  });

  it("cancels a pending open on unmount (never fires into a torn-down tree)", () => {
    const onOpenPaper = vi.fn();
    const { getByTitle, unmount } = render(<Harness onOpenPaper={onOpenPaper} />);
    fireEvent.click(getByTitle(/Scorekeeping/i)); // schedules a deferred open
    unmount(); // cleanup must cancel the pending idle callback
    flushIdle(); // a surviving callback would fire here
    expect(onOpenPaper).not.toHaveBeenCalled();
  });
});
