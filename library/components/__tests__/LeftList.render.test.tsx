// @vitest-environment jsdom
//
// RENDER-COUNT probe for the catalog list's keystroke-sanctity adoption
// (Ask #3 / chip C5). The list must re-render only the rows whose props
// actually change:
//   - selection change   → only the 2 affected rows
//   - request-dot flip    → only the row whose tone changed
//   - typing a filter     → surviving rows DON'T re-render (they bail); the
//                           filtered-out rows just unmount
//
// `LeftListRow` is the REAL contract: `memo(LeftListRow)` with the default
// shallow comparison. We mock it with the SAME `memo(...)` boundary plus a
// per-`entryKey` render counter, so this test proves the property under our
// control — that `LeftList` feeds STABLE + primitive props (no per-row
// closure, no selection-Set prop, no churning tone fn) such that a default
// memo row bails. If a future edit re-introduces a per-render closure or the
// Set prop, the counters jump and this fails.

import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";

// Shared counter, declared via vi.hoisted so the (hoisted) mock factory can
// close over it without a temporal-dead-zone error.
const { renderCounts } = vi.hoisted(() => ({
  renderCounts: new Map<string, number>(),
}));

vi.mock("../LeftListRow", async () => {
  const { memo, createElement } = await import("react");
  function MockRow(props: { entryKey: string; selected: boolean; dotTone: string | null }) {
    renderCounts.set(props.entryKey, (renderCounts.get(props.entryKey) ?? 0) + 1);
    return createElement("div", {
      "data-testid": `row-${props.entryKey}`,
      "data-selected": props.selected ? "1" : "0",
      "data-tone": props.dotTone ?? "none",
    });
  }
  return {
    __esModule: true,
    default: memo(MockRow),
    ACTION_COL_WIDTH: 32,
    STATUS_DOT_COL_WIDTH: 16,
  };
});

import LeftList from "../LeftList";
import type { RowActions } from "../LeftListRow";
import {
  __resetViewSessionForTests,
  setSelection,
  usePanelSelection,
} from "@library/lib/view-session-store";

// jsdom here doesn't ship a full localStorage; install the same in-memory
// shim the sibling view-session render test uses.
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

beforeEach(() => {
  memStore.clear();
  __resetViewSessionForTests();
  renderCounts.clear();
});

afterEach(() => {
  cleanup();
});

// ── fixtures ──────────────────────────────────────────────────────────────

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
  entry("grice1975", "Logic and Conversation", "Paul Grice", 1975),
];

const BIB_BY_KEY = new Map<string, BibEntry>();
const ROW_ACTIONS: RowActions = {
  onDelete: () => {},
  onBibReview: () => {},
  onTextReview: () => {},
  onImportBib: () => {},
  deleteLabel: "Delete…",
};
const NO_TONE = () => null;
const noop = () => {};

function Harness({
  dotToneFor = NO_TONE,
  entries = ENTRIES,
}: {
  dotToneFor?: (c: string | null | undefined) => "red" | "green" | null;
  entries?: CatalogEntry[];
}) {
  const sel = usePanelSelection("", "left");
  return (
    <LeftList
      entries={entries}
      bibByKey={BIB_BY_KEY}
      scope=""
      panel="left"
      libId="central"
      selectedKeys={sel.selectedKeys}
      anchorKey={sel.anchorKey}
      onSelectKeys={sel.setSelection}
      onOpenPaper={noop}
      rowActions={ROW_ACTIONS}
      dotToneFor={dotToneFor}
      onRowViewed={noop}
    />
  );
}

const countOf = (k: string) => renderCounts.get(k) ?? 0;

describe("LeftList — render-count / keystroke-sanctity", () => {
  it("a selection change re-renders only the 2 affected rows", () => {
    render(<Harness />);
    // Seed a selection so the next change is a clean A→B transition.
    act(() => {
      setSelection("", "left", { selectedKeys: ["lewis1979"], anchorKey: "lewis1979" });
    });
    const before = {
      lewis1979: countOf("lewis1979"),
      kant1781: countOf("kant1781"),
      frege1892: countOf("frege1892"),
      grice1975: countOf("grice1975"),
    };
    // Move the selection lewis1979 → kant1781. EXACTLY those two rows flip
    // their `selected` boolean; the others are untouched.
    act(() => {
      setSelection("", "left", { selectedKeys: ["kant1781"], anchorKey: "kant1781" });
    });
    expect(countOf("lewis1979") - before.lewis1979).toBe(1);
    expect(countOf("kant1781") - before.kant1781).toBe(1);
    expect(countOf("frege1892") - before.frege1892).toBe(0);
    expect(countOf("grice1975") - before.grice1975).toBe(0);
  });

  it("a request-dot flip re-renders only the row whose tone changed", () => {
    const { rerender } = render(<Harness dotToneFor={NO_TONE} />);
    const before = {
      lewis1979: countOf("lewis1979"),
      kant1781: countOf("kant1781"),
      frege1892: countOf("frege1892"),
      grice1975: countOf("grice1975"),
    };
    // New tone fn identity (mimics the 6 s poll's churn) where ONLY lewis1979
    // flips to green. The parent re-renders, but only the one row whose
    // primitive `dotTone` actually changed should re-render.
    const tone2 = (c: string | null | undefined) => (c === "lewis1979" ? "green" : null);
    rerender(<Harness dotToneFor={tone2} />);
    expect(countOf("lewis1979") - before.lewis1979).toBe(1);
    expect(countOf("kant1781") - before.kant1781).toBe(0);
    expect(countOf("frege1892") - before.frege1892).toBe(0);
    expect(countOf("grice1975") - before.grice1975).toBe(0);
  });

  it("typing a filter unmounts non-matches and leaves survivors un-re-rendered", async () => {
    const { getByPlaceholderText, queryByTestId } = render(<Harness />);
    const before = { kant1781: countOf("kant1781") };
    const input = getByPlaceholderText(/Search title, author, citekey/i);
    // "critique" matches only Kant's title.
    fireEvent.change(input, { target: { value: "critique" } });
    // Wait for the deferred filter to apply (the non-matches unmount).
    await waitFor(() => expect(queryByTestId("row-lewis1979")).toBeNull());
    expect(queryByTestId("row-frege1892")).toBeNull();
    expect(queryByTestId("row-grice1975")).toBeNull();
    // The surviving row is still present and did NOT re-render — its props
    // (entry ref, selected, dotTone, gridTemplate, stable callbacks) never
    // changed, so the memo held.
    expect(queryByTestId("row-kant1781")).not.toBeNull();
    expect(countOf("kant1781") - before.kant1781).toBe(0);
  });

  it("virtualizes — only ~viewport rows hit the DOM, not all N (C7)", () => {
    const many: CatalogEntry[] = Array.from({ length: 300 }, (_, i) =>
      entry(`k${String(i).padStart(3, "0")}`, `Title ${i}`, `Author ${i}`, 2000),
    );
    const { container } = render(<Harness entries={many} />);
    const rendered = container.querySelectorAll('[data-testid^="row-"]');
    // The fallback viewport (1200px / ~29px row) windows to ~50 rows + overscan,
    // never the full 300. The exact number depends on overscan; assert it is a
    // small fraction of N.
    expect(rendered.length).toBeGreaterThan(20);
    expect(rendered.length).toBeLessThan(80);
    expect(rendered.length).toBeLessThan(many.length);
  });
});
