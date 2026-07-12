// @vitest-environment jsdom
//
// Row drag ghost — the clone must stay laid out OUTSIDE the list root.
//
// The row's inner grid uses `grid-template-columns: var(--lib-col-template)`,
// a custom property defined on the LeftList root (the imperative per-frame
// write target of the column-resize engine). LeftListRow's onDragStart clones
// the whole row and `attachClampedDragGhost` appends that clone to
// document.body — outside the var's inheritance scope, where the reference is
// invalid-at-computed-value and the grid would collapse to `none` (cells
// stacking vertically). The fix stamps the RESOLVED template onto the clone
// at build time; this test pins that the body-appended ghost carries the var
// inline, so the regression (ghost renders with collapsed columns) can't
// silently return.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { CatalogEntry } from "@library/lib/catalog";
import { COL_TEMPLATE_REF, COL_TEMPLATE_VAR } from "@library/lib/list-columns";
import LeftListRow, { type RowActions } from "../LeftListRow";

const TEMPLATE = "56px 4px 130px 4px 1fr 4px 208px 4px 140px";

const entry: CatalogEntry = {
  citekey: "smith2020",
  title: "A Paper",
  authors: ["Smith, Jane"],
  year: 2020,
  addedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  pdf: { present: true },
  indexed: { state: "indexed" },
  bib: { state: "authenticated" },
};

const actions: RowActions = {
  onDelete: vi.fn(),
  onBibReview: vi.fn(),
  onTextReview: vi.fn(),
  onImportBib: vi.fn(),
  deleteLabel: "Delete…",
};

function makeDataTransfer() {
  return {
    setData: vi.fn(),
    getData: vi.fn(() => ""),
    setDragImage: vi.fn(),
    effectAllowed: "none",
  };
}

afterEach(() => {
  // attachClampedDragGhost cleans up (removes the ghost + its document
  // listeners + safety timer) on dragend.
  fireEvent(document, new Event("dragend", { bubbles: true }));
  cleanup();
  document.body.innerHTML = "";
});

describe("LeftListRow drag ghost", () => {
  it("stamps the resolved --lib-col-template onto the body-appended clone (the var is undefined outside the list root)", () => {
    // Mirror production: the row receives the var REFERENCE while the
    // concrete template lives on an ancestor (the list root).
    const { container } = render(
      <div style={{ [COL_TEMPLATE_VAR]: TEMPLATE } as React.CSSProperties}>
        <LeftListRow
          entry={entry}
          bib={undefined}
          selected={false}
          gridTemplate={COL_TEMPLATE_REF}
          colOrder={["year", "author", "title", "status", "citekey"]}
          entryKey="smith2020"
          onActivate={vi.fn()}
          resolveDragKeys={(k) => [k]}
          actions={actions}
          dotTone={null}
        />
      </div>,
    );
    const rowEl = container.querySelector<HTMLElement>('[draggable="true"]');
    expect(rowEl).not.toBeNull();

    fireEvent.dragStart(rowEl!, { dataTransfer: makeDataTransfer() });

    const ghost = document.querySelector<HTMLElement>(
      "[data-virgil-drag-ghost]",
    );
    expect(ghost).not.toBeNull();
    // The ghost lives on <body>, outside the wrapper that defines the var…
    expect(ghost!.parentElement).toBe(document.body);
    expect(ghost!.closest(`[style*="${COL_TEMPLATE_VAR}"]`)).toBe(ghost);
    // …so it must carry the RESOLVED template itself for its inner grid's
    // `grid-template-columns: var(--lib-col-template)` to keep the row layout.
    expect(ghost!.style.getPropertyValue(COL_TEMPLATE_VAR)).toBe(TEMPLATE);
  });
});
