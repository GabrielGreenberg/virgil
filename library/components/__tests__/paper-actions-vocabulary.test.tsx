// @vitest-environment jsdom
//
// Task 1382 — one label per paper action, and a copy that SAYS when it failed.
//
// The catalog row's ⋮ menu and the paper header's AI-requests menu offer the
// same three queued actions; they had drifted into two vocabularies ("AI text
// review" vs "Doc review" read as two different operations). The row menu now
// reads `PAPER_REQUESTS_BY_KIND`. And the row's citekey copy swallowed a failed
// clipboard write — it now reports `copy failed: <reason>`, the same spelling
// the header and BibCard flash.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CatalogEntry } from "@library/lib/catalog";
import { COL_TEMPLATE_REF } from "@library/lib/list-columns";
import { PAPER_REQUESTS_BY_KIND } from "@library/lib/paper-ai-requests";
import {
  OPEN_IN_TAB_HINT,
  copyOutcomeMessage,
  copyText,
} from "@library/lib/paper-actions";
import RowActionMenu from "../RowActionMenu";
import LeftListRow, { type RowActions } from "../LeftListRow";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe("paper action labels (task 1382)", () => {
  it("the row ⋮ menu shows exactly the header's labels for the shared actions", async () => {
    const { container } = render(
      <RowActionMenu
        deleteLabel="Delete…"
        onDelete={() => {}}
        onBibReview={() => {}}
        onDocReview={() => {}}
        onImportBib={() => {}}
      />,
    );
    fireEvent.click(container.querySelector('[aria-haspopup="menu"]')!);
    await settle();
    const labels = screen
      .getAllByRole("menuitem")
      .map((el) => (el.textContent ?? "").trim());
    expect(labels).toEqual([
      PAPER_REQUESTS_BY_KIND.bib.label,
      PAPER_REQUESTS_BY_KIND.doc.label,
      PAPER_REQUESTS_BY_KIND.importbib.label,
      "Delete…",
    ]);
  });
});

describe("copyText (task 1382)", () => {
  it("reports success", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const outcome = await copyText("x");
    expect(outcome).toEqual({ ok: true });
    expect(copyOutcomeMessage(outcome, "copied ✓")).toBe("copied ✓");
  });

  it("reports a rejected write WITH its reason", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Document is not focused.")) },
    });
    const outcome = await copyText("x");
    expect(copyOutcomeMessage(outcome, "copied ✓")).toBe(
      "copy failed: Document is not focused.",
    );
  });

  it("reports a missing clipboard (insecure context) instead of throwing", async () => {
    vi.stubGlobal("navigator", {});
    expect(copyOutcomeMessage(await copyText("x"), "ok")).toBe(
      "copy failed: clipboard unavailable",
    );
  });
});

describe("LeftListRow copy + open-in-tab (task 1382)", () => {
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
  const renderRow = () =>
    render(
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
      />,
    );

  it("a failed citekey copy surfaces its reason in the button's hint", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Write permission denied.")) },
    });
    renderRow();
    const btn = screen.getByLabelText("Copy citekey");
    fireEvent.click(btn);
    await settle();
    expect(btn.getAttribute("data-hint")).toBe("copy failed: Write permission denied.");
  });

  it("the open-in-tab control carries the shared hint", () => {
    renderRow();
    expect(screen.getByLabelText(OPEN_IN_TAB_HINT)).toBeTruthy();
  });
});
