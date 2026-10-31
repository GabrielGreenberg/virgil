// @vitest-environment jsdom
//
// Task 1379 — the Library row's request dot is the app's ONE StatusDot.
//
// It used to be a private chromatic `Dot` that painted "Request pending —
// waiting for Claude" in the pill family's RED, so a waiting AI request read
// as an error in the Library while every editor-side surface paints the same
// state as the amber `pending` dot (task 951). The row now hands the hook's
// semantic tone straight to `<StatusDot>`, which owns the tone→token map and
// announces the hint through `iconHint` (aria-label + data-hint).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CatalogEntry } from "@library/lib/catalog";
import { COL_TEMPLATE_REF } from "@library/lib/list-columns";
import { TONE_TOKEN } from "@/components/StatusDot";
import type { RowDotTone } from "@library/hooks/useRowDotState";
import LeftListRow, { type RowActions } from "../LeftListRow";

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
  onDocReview: vi.fn(),
  onImportBib: vi.fn(),
  deleteLabel: "Delete…",
};

function renderRow(dotTone: RowDotTone) {
  return render(
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
      dotTone={dotTone}
    />,
  );
}

afterEach(cleanup);

describe("LeftListRow request dot (task 1379)", () => {
  it("paints a pending request with the shared amber pending token, not red", () => {
    const { getByLabelText } = renderRow("pending");
    const dot = getByLabelText("Request pending — waiting for Claude");
    // jsdom resolves no CSS vars, so assert the SPECIFIED inline value.
    expect(dot.style.backgroundColor).toBe(TONE_TOKEN.pending);
    expect(dot.getAttribute("data-hint")).toBe("Request pending — waiting for Claude");
    expect(dot.getAttribute("aria-hidden")).toBeNull();
  });

  it("paints a new result with the ok token", () => {
    const { getByLabelText } = renderRow("ok");
    const dot = getByLabelText("New result — click to mark as seen");
    expect(dot.style.backgroundColor).toBe(TONE_TOKEN.ok);
  });

  it("renders no dot when nothing is outstanding", () => {
    const { queryByLabelText } = renderRow(null);
    expect(queryByLabelText(/Request pending|New result/)).toBeNull();
  });
});
