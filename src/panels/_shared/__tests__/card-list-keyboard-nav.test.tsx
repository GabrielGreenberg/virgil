// @vitest-environment jsdom
//
// TASK 964 — keyboard list navigation is the SHELL's, not each panel's.
//
// `CardListPanel` used to say cycling "varies too much per panel and stays
// inline". Measured, it did not vary: six panels hand-copied the same
// `useCycle` + selection re-sync effect + `useListNavKeys` lines, and the five
// that never copied them — Reports, Todo, Revisions, Cutter, Archive — had no
// arrow navigation at all (their list was not even focusable). The shell now
// owns it: the cursor is DERIVED from `selectedId` against the rendered,
// archive-filtered set, and a panel adds only what activation does beyond
// selecting (`onActivateItem`).
//
// Legs: (1) a formerly-dead panel (Reports) navigates through the real panel;
// (2) the shell's own contract — archived cards skipped, editable targets
// ignored, Enter on the list re-activates, `onActivateItem` runs after select;
// (3) a census: no file that renders `<CardListPanel` wires `useCycle` /
// `useListNavKeys` itself, so the shell stays the one owner.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/panels/Reports/ReportCard", () => ({
  ReportCard: ({ report: card }: { report: { id: string } }) => (
    <div data-testid="report-card" data-id={card.id}>
      <input data-testid={`input-${card.id}`} defaultValue="" />
    </div>
  ),
}));
vi.mock("@/panels/Reports/ReportRequestCard", () => ({
  ReportRequestCard: ({ request: card }: { request: { id: string } }) => (
    <div data-testid="report-card" data-id={card.id} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { CardListPanel } from "../CardListPanel";
import ReportsPanel from "@/panels/Reports/ReportsPanel";
import type { ReportCard as ReportCardData } from "@/lib/types";
import { NO_JUMP, PASS_JUMP } from "@/links/card-anchor-rows";
import { walkFiles } from "../../../lib/__tests__/_source-scan";

afterEach(cleanup);

function listBody(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("list body (tabindex=0) not found");
  return el;
}

// ── (1) A formerly-dead panel navigates ──────────────────────────────────────

const report = (id: string, createdAt: string): ReportCardData =>
  ({
    kind: "report",
    id,
    title: "",
    content: { type: "doc", content: [] },
    createdAt,
    links: [],
  }) as unknown as ReportCardData;

type ReportsProps = ComponentProps<typeof ReportsPanel>;

function ControlledReports(props: Omit<ReportsProps, "selectedId">) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <ReportsPanel
      {...props}
      selectedId={selectedId}
      onSelect={(id) => {
        props.onSelect(id);
        setSelectedId(id);
      }}
    />
  );
}

describe("task 964 — Reports (a panel that never wired nav) is arrow-navigable", () => {
  function setup(extra: Partial<ReportsProps> = {}) {
    const onSelect = vi.fn();
    const props: Omit<ReportsProps, "selectedId"> = {
      cards: [report("a", "2026-01-01"), report("b", "2026-01-02"), report("c", "2026-01-03")],
      onAddReport: vi.fn(),
      onAddReportRequest: vi.fn(),
      onUpdateReportContent: vi.fn(),
      onUpdateReportTitle: vi.fn(),
      onUpdateRequestContent: vi.fn(),
      onSetRequestAiRequest: vi.fn(),
      onConvertCard: vi.fn(),
      onDelete: vi.fn(),
      onSelect,
      jumpGate: () => ({ anchored: true, withJump: PASS_JUMP }),
      getCitationDisplayText: () => "",
      onCitationCreated: () => null,
      onEditorFocus: vi.fn(),
      ...extra,
    } as unknown as Omit<ReportsProps, "selectedId">;
    const utils = render(<ControlledReports {...props} />);
    return { ...utils, onSelect };
  }

  it("the list is focusable and ArrowDown ×2 selects the 2nd card", () => {
    const { container, onSelect } = setup();
    const body = listBody(container);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("b");
    fireEvent.keyDown(body, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("a");
  });

  it("a keyboard step jumps through the card's own gate (the Jump button's twin)", () => {
    const onJumpToCard = vi.fn();
    const { container } = setup({
      onJumpToCard,
      jumpGate: (card) =>
        card.id === "b"
          ? { anchored: false, withJump: NO_JUMP }
          : { anchored: true, withJump: PASS_JUMP },
    });
    const body = listBody(container);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(onJumpToCard).toHaveBeenCalledTimes(1);
    expect((onJumpToCard.mock.calls[0][0] as { id: string }).id).toBe("a");
    // "b" has a dead anchor: selected, not jumped.
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(onJumpToCard).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown inside a card's input edits text, it does not cycle", () => {
    const { getByTestId, onSelect } = setup();
    fireEvent.keyDown(getByTestId("input-a"), { key: "ArrowDown" });
    expect(onSelect).not.toHaveBeenCalled();
  });
});

// ── (2) The shell's contract ────────────────────────────────────────────────

type Row = { id: string; archived?: boolean };

function Shell({
  items,
  onSelectSpy,
  onActivateItem,
}: {
  items: Row[];
  onSelectSpy: (id: string | null) => void;
  onActivateItem?: (item: Row, index: number) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <CardListPanel<Row>
      kind="todo"
      items={items}
      getId={(r) => r.id}
      getArchived={(r) => !!r.archived}
      selectedId={selectedId}
      onSelect={(id) => {
        onSelectSpy(id);
        setSelectedId(id);
      }}
      onActivateItem={onActivateItem}
      renderCard={(r) => <div data-testid="card">{r.id}</div>}
    />
  );
}

describe("task 964 — CardListPanel owns list navigation", () => {
  it("skips archived cards in the Active view and wraps", () => {
    const spy = vi.fn();
    const { container } = render(
      <Shell
        items={[{ id: "a" }, { id: "x", archived: true }, { id: "b" }]}
        onSelectSpy={spy}
      />,
    );
    const body = listBody(container);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    fireEvent.keyDown(body, { key: "ArrowDown" });
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["a", "b", "a"]);
  });

  it("ArrowUp from no selection lands on the last visible card", () => {
    const spy = vi.fn();
    const { container } = render(
      <Shell items={[{ id: "a" }, { id: "b" }, { id: "x", archived: true }]} onSelectSpy={spy} />,
    );
    fireEvent.keyDown(listBody(container), { key: "ArrowUp" });
    expect(spy).toHaveBeenLastCalledWith("b");
  });

  it("onActivateItem runs after the shell selects, with the visible index", () => {
    const order: string[] = [];
    const { container } = render(
      <Shell
        items={[{ id: "x", archived: true }, { id: "a" }, { id: "b" }]}
        onSelectSpy={(id) => order.push(`select:${id}`)}
        onActivateItem={(r, i) => order.push(`activate:${r.id}@${i}`)}
      />,
    );
    const body = listBody(container);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    fireEvent.keyDown(body, { key: "ArrowDown" });
    expect(order).toEqual(["select:a", "activate:a@0", "select:b", "activate:b@1"]);
  });

  it("Enter on the list re-activates the selected card; Enter inside a card does not", () => {
    const activate = vi.fn();
    const { container, getAllByTestId } = render(
      <Shell items={[{ id: "a" }, { id: "b" }]} onSelectSpy={vi.fn()} onActivateItem={activate} />,
    );
    const body = listBody(container);
    fireEvent.keyDown(body, { key: "ArrowDown" });
    fireEvent.keyDown(body, { key: "ArrowDown" });
    activate.mockClear();
    fireEvent.keyDown(body, { key: "Enter" });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate.mock.calls[0][0]).toEqual({ id: "b" });
    fireEvent.keyDown(getAllByTestId("card")[0], { key: "Enter" });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("an empty list ignores the keys", () => {
    const spy = vi.fn();
    const { container } = render(<Shell items={[]} onSelectSpy={spy} />);
    fireEvent.keyDown(listBody(container), { key: "ArrowDown" });
    fireEvent.keyDown(listBody(container), { key: "Enter" });
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── (3) Census: the shell is the one owner ──────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANELS_DIR = path.resolve(HERE, "../.."); // src/panels/

describe("task 964 — no CardListPanel panel hand-wires list navigation", () => {
  const panels = walkFiles(PANELS_DIR, { skipDirs: ["__tests__", "_shared"] })
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ f, src: readFileSync(f, "utf8") }))
    .filter(({ src }) => /<CardListPanel\b/.test(src));

  it("finds the card panels (a census that finds nothing proves nothing)", () => {
    expect(panels.length).toBeGreaterThanOrEqual(11);
  });

  it("none of them imports useCycle or useListNavKeys (the shell has no onKeyDown prop)", () => {
    const offenders = panels
      .filter(({ src }) => /\buseCycle\b|\buseListNavKeys\b/.test(src))
      .map(({ f }) => path.relative(PANELS_DIR, f));
    expect(offenders).toEqual([]);
  });
});
