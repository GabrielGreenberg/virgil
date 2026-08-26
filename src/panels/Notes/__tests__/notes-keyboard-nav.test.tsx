// @vitest-environment jsdom
//
// TASK 479 — the Notes panel's keyboard cycle was DECLARED and unreachable.
//
// `NotesPanel` called `useCycle(sortedCards, onActivateCard)` and destructured
// only `{ idx, setIdx }`: `next`/`prev` were never taken, so `onActivateCard`
// could never fire and `idx` was read by nothing except the effect that wrote
// it. Measured across all 15 panels this tick, Notes was the ONLY one with a
// `useCycle` and no `onKeyDown`/`scrollTabIndex` — vestigial rather than a
// half-built feature, and the guardrail that finds a dead *prop* is structurally
// blind to a dead *hook return*, which is why it needs its own legs.
//
// It is WIRED rather than deleted (three lines, matching the sibling panels),
// and the archive contract from task 082 comes with it: the cycle iterates
// `useArchiveVisibleItems`' output, NOT the raw sorted list, so an arrow step
// can never land on an archived, off-screen card. That is the one leg that
// distinguishes a correct wiring from a plausible one.
//
// panel-primitives transitively pulls `@/lib/storage` — stub it. The two card
// components mount real rich-text editors — stub them to light divs so this
// pins the panel's cycle/guard wiring, not card internals.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

vi.mock("@/panels/Notes/NoteCard", () => ({
  NoteCard: ({ note }: { note: { id: string } }) => (
    <div data-testid="note-card" data-id={note.id}>
      <input data-testid={`note-input-${note.id}`} defaultValue="" />
    </div>
  ),
}));
vi.mock("@/panels/Notes/HighlightCard", () => ({
  HighlightCard: ({ card }: { card: { id: string } }) => (
    <div data-testid="note-card" data-id={card.id} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent, cleanup } from "@testing-library/react";
import { type ComponentProps } from "react";
import NotesPanel from "@/panels/Notes/NotesPanel";
import type { UserNote } from "@/lib/types";

afterEach(cleanup);

/** `createdAt` drives the panel's own sort, so it is given explicitly. */
const note = (id: string, createdAt: string, archived = false): UserNote => ({
  kind: "note",
  id,
  title: "",
  content: { type: "doc", content: [] },
  createdAt,
  aiRequest: false,
  links: [],
  ...(archived ? { archived: true } : {}),
});

type PanelProps = ComponentProps<typeof NotesPanel>;

function baseProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    cards: [],
    onAddNote: vi.fn(() => note("new", "2026-01-09")),
    onConvertCard: vi.fn(),
    onUpdate: vi.fn(),
    onUpdateTitle: vi.fn(),
    onSetNoteAiRequest: vi.fn(),
    onSetHighlightAiRequest: vi.fn(),
    onDelete: vi.fn(),
    onSelectNote: vi.fn(),
    selectedNoteId: null,
    ...overrides,
  };
}

function keyTarget(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container (tabindex=0) not found");
  return el;
}

describe("task 479 — the Notes cycle is REACHABLE", () => {
  it("ArrowDown/ArrowUp select cards (the pre-479 panel never fired onSelect)", () => {
    const props = baseProps({
      cards: [note("a", "2026-01-01"), note("b", "2026-01-02")],
    });
    const { container } = render(<NotesPanel {...props} />);

    fireEvent.keyDown(keyTarget(container), { key: "ArrowDown" });
    expect(props.onSelectNote).toHaveBeenCalledWith("a");

    fireEvent.keyDown(keyTarget(container), { key: "ArrowDown" });
    expect(props.onSelectNote).toHaveBeenLastCalledWith("b");

    fireEvent.keyDown(keyTarget(container), { key: "ArrowUp" });
    expect(props.onSelectNote).toHaveBeenLastCalledWith("a");
  });

  it("jumps to the activated card when a jump handler is supplied", () => {
    const onJumpToCard = vi.fn();
    const props = baseProps({
      cards: [note("a", "2026-01-01"), note("b", "2026-01-02")],
      onJumpToCard,
    });
    const { container } = render(<NotesPanel {...props} />);

    fireEvent.keyDown(keyTarget(container), { key: "ArrowDown" });
    expect(onJumpToCard).toHaveBeenCalledTimes(1);
    expect((onJumpToCard.mock.calls[0][0] as UserNote).id).toBe("a");
  });
});

describe("task 479 — the cycle iterates the archive-VISIBLE set (task 082's contract)", () => {
  it("ArrowDown/Up never lands on an archived, off-screen note", () => {
    // The archived card sorts FIRST (oldest `createdAt`), so a cycle fed the raw
    // `sortedCards` would select it on the very first ArrowDown.
    const props = baseProps({
      cards: [
        note("arch", "2026-01-01", true),
        note("a", "2026-01-02"),
        note("b", "2026-01-03"),
      ],
    });
    const { container, getAllByTestId } = render(<NotesPanel {...props} />);

    // Only the two active cards render — the premise the cycle must match.
    expect(getAllByTestId("note-card").map((el) => el.dataset.id)).toEqual([
      "a",
      "b",
    ]);

    const target = keyTarget(container);
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → a
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → b
    fireEvent.keyDown(target, { key: "ArrowDown" }); // → wrap to a
    fireEvent.keyDown(target, { key: "ArrowUp" }); // → wrap to b

    const selected = (
      props.onSelectNote as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    expect(selected.length).toBe(4);
    expect(selected).not.toContain("arch");
    expect(new Set(selected)).toEqual(new Set(["a", "b"]));
  });
});

describe("task 479 — the shared editable-target guard comes with the wiring", () => {
  it("ArrowDown from an INPUT inside a card does not cycle", () => {
    const props = baseProps({
      cards: [note("a", "2026-01-01"), note("b", "2026-01-02")],
    });
    const { getByTestId } = render(<NotesPanel {...props} />);

    fireEvent.keyDown(getByTestId("note-input-a"), { key: "ArrowDown" });
    fireEvent.keyDown(getByTestId("note-input-a"), { key: "ArrowUp" });

    expect(props.onSelectNote).not.toHaveBeenCalled();
  });
});
