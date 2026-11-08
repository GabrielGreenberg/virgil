// @vitest-environment jsdom
/**
 * The reading lists' one row model (Gabriel, 2026-11-08): a row selects on
 * click, shows ↗ jump and ⌄ open on hover or focus, opens in place into the
 * kind's own card (one at a time), closes on ⌃ or Escape, and ↑/↓ move
 * between rows. Its snippet is RENDERED: citations as their display text,
 * `\ref` as its number, math through KaTeX — never the raw command.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { act, fireEvent, render, screen } from "@testing-library/react";
import { CitationDisplayProvider } from "../../contexts/citation-display";
import { GutterList } from "../GutterList";
import type { GutterListGroup, GutterListRow } from "../gutter-lists";

const para = (...content: object[]) => ({ type: "doc", content: [{ type: "paragraph", content }] });
const text = (t: string) => ({ type: "text", text: t });

const row = (id: string, value: unknown): GutterListRow => ({
  key: `fn:${id}`,
  entityId: id,
  marker: id,
  snippet: { kind: "rich", value, fallback: "" },
  pos: 1,
  jump: { kind: "footnote", id },
  card: { kind: "footnote", id },
});

const GROUPS: GutterListGroup[] = [
  {
    key: "g",
    label: "Introduction",
    number: "1",
    rows: [
      row(
        "1",
        para(
          text("See "),
          { type: "citation", attrs: { citationId: "c1", command: "\\citet{jackson2001}", displayText: "" } },
          text(" and "),
          { type: "labelRef", attrs: { label: "ex:one", displayText: "??", refCommand: "ref" } },
          text(" where "),
          { type: "inlineMath", attrs: { latex: "\\alpha" } },
          text(" rises."),
        ),
      ),
      row("2", para(text("Second note"))),
    ],
  },
];

function mount(over: Partial<Parameters<typeof GutterList>[0]> = {}) {
  const onSelect = vi.fn();
  const onJump = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <CitationDisplayProvider
      value={{
        getCitationDisplayText: (cmd) => (cmd.includes("jackson2001") ? "Jackson (2001)" : ""),
        onCitationCreated: () => ({ id: "x", displayText: "" }),
        getRefDisplayText: (label) => (label === "ex:one" ? "3" : null),
      }}
    >
      <GutterList
        list="footnotes"
        groups={GROUPS}
        selectedIds={new Set()}
        onSelect={onSelect}
        onJump={onJump}
        onOpenChange={onOpenChange}
        renderCard={(card) => <div data-testid="card">card {card.kind === "bib" ? card.key : card.id}</div>}
        {...over}
      />
    </CitationDisplayProvider>,
  );
  return { ...utils, onSelect, onJump, onOpenChange };
}

const rowEl = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-gutter-list-row="fn:${id}"]`)!;

describe("GutterList — the row model", () => {
  it("renders the snippet, never the raw commands", () => {
    const { container } = mount();
    const r = rowEl(container, "1");
    expect(r.textContent).toContain("Jackson (2001)");
    expect(r.textContent).toContain("3");
    expect(r.textContent).not.toContain("\\citet");
    expect(r.textContent).not.toContain("??");
    expect(r.querySelector(".katex")).not.toBeNull();
    expect(r.textContent).not.toContain("$\\alpha$");
  });

  it("selects on a click of the row, without jumping", () => {
    const { container, onSelect, onJump } = mount();
    fireEvent.click(rowEl(container, "2").querySelector(".gutter-list-body")!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ entityId: "2" }));
    expect(onJump).not.toHaveBeenCalled();
  });

  it("offers ↗ jump and ⌄ open on each row", () => {
    const { container, onJump } = mount();
    const r = rowEl(container, "2");
    expect(r.querySelector('[data-gutter-act="open"]')).not.toBeNull();
    fireEvent.click(r.querySelector('[data-gutter-act="jump"]')!);
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ entityId: "2" }), expect.anything());
  });

  it("opens one card at a time, in place, and closes on ⌃ or Escape", () => {
    const { container, onOpenChange } = mount();
    fireEvent.click(rowEl(container, "1").querySelector('[data-gutter-act="open"]')!);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
    expect(screen.getByTestId("card").textContent).toBe("card 1");
    expect(onOpenChange).toHaveBeenLastCalledWith({ kind: "footnote", id: "1" }, true);

    // Opening another closes the first.
    fireEvent.click(rowEl(container, "2").querySelector('[data-gutter-act="open"]')!);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
    expect(screen.getByTestId("card").textContent).toBe("card 2");
    expect(onOpenChange).toHaveBeenCalledWith({ kind: "footnote", id: "1" }, false);

    fireEvent.keyDown(screen.getByTestId("card"), { key: "Escape" });
    expect(screen.queryByTestId("card")).toBeNull();

    fireEvent.click(rowEl(container, "1").querySelector('[data-gutter-act="open"]')!);
    fireEvent.click(container.querySelector("[data-gutter-list-close]")!);
    expect(screen.queryByTestId("card")).toBeNull();
  });

  it("an Escape a card's own field already handled does not close it", () => {
    const { container } = mount({
      renderCard: () => (
        <input
          data-testid="card"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        />
      ),
    });
    fireEvent.click(rowEl(container, "1").querySelector('[data-gutter-act="open"]')!);
    fireEvent.keyDown(screen.getByTestId("card"), { key: "Escape" });
    expect(screen.queryByTestId("card")).not.toBeNull();
  });

  it("↑/↓ move between rows", () => {
    const { container } = mount();
    const first = rowEl(container, "1").querySelector<HTMLElement>(".gutter-list-body")!;
    const second = rowEl(container, "2").querySelector<HTMLElement>(".gutter-list-body")!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("a row that can be dragged is draggable and hands its drag to the list", () => {
    const onRowDragStart = vi.fn();
    const { container } = mount({ canDrag: (r) => r.entityId === "2", onRowDragStart });
    expect(rowEl(container, "1").getAttribute("draggable")).toBeNull();
    const r2 = rowEl(container, "2");
    expect(r2.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(r2);
    expect(onRowDragStart).toHaveBeenCalledWith(expect.objectContaining({ entityId: "2" }), expect.anything());
  });

  it("marks the rows whose anchor is on screen", () => {
    const { container } = mount({ hereIds: new Set(["2"]) });
    expect(rowEl(container, "2").hasAttribute("data-here")).toBe(true);
    expect(rowEl(container, "1").hasAttribute("data-here")).toBe(false);
  });
});
