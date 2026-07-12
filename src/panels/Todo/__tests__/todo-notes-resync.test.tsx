// @vitest-environment jsdom
//
// task 2026-07-12-102 — the notes textarea is a controlled local `useState`
// mirror of `item.notes`, committed to disk only on blur. Historically it was
// seeded once and never re-synced, so an out-of-band write to `todos.json` (an
// AI cowork skill editing a todo's notes while the panel is open — the live
// sidecar-reactivity path re-reads disk and updates `item.notes` with the SAME
// id, so the row never remounts) was invisible in the card AND got reverted on
// the next focus/blur (`commitNotes` wrote the stale buffer back). These tests
// pin the reconcile at the render seam: an external notes change flows into the
// displayed value, a focus/blur without editing does NOT revert it, and a
// mid-edit local buffer is preserved against a concurrent external write.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TodoRow } from "@/panels/Todo/TodoRow";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { TodoItem } from "@/lib/types";

afterEach(cleanup);

const REF = { kind: "todo" as const, id: "t1" };

function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "t1",
    text: "task",
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-07-06T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

function renderRow(item: TodoItem, onUpdateNotes = vi.fn()) {
  // The notes textarea renders only on the expanded (non-compressed) body.
  cardStore.expand(REF);
  const utils = render(
    <TodoRow
      item={item}
      selected={false}
      onToggle={vi.fn()}
      onUpdate={vi.fn()}
      onUpdateNotes={onUpdateNotes}
      onSetAiRequest={vi.fn()}
      onDelete={vi.fn()}
      onSelect={vi.fn()}
      isAnchored={false}
    />,
  );
  return { onUpdateNotes, ...utils };
}

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

describe("TodoRow notes external-resync (task 2026-07-12-102)", () => {
  it("an external item.notes change on a mounted, same-id row updates the displayed value", () => {
    const { rerender } = renderRow(makeTodo({ notes: "old note" }));
    const ta = screen.getByPlaceholderText("Notes...") as HTMLTextAreaElement;
    expect(ta.value).toBe("old note");

    rerender(
      <TodoRow
        item={makeTodo({ notes: "AI rewrote this" })}
        selected={false}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateNotes={vi.fn()}
        onSetAiRequest={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        isAnchored={false}
      />,
    );
    expect((screen.getByPlaceholderText("Notes...") as HTMLTextAreaElement).value).toBe(
      "AI rewrote this",
    );
  });

  it("blur after a purely-external change does NOT re-write the stale value back", () => {
    const onUpdateNotes = vi.fn();
    const { rerender } = renderRow(makeTodo({ notes: "old note" }), onUpdateNotes);

    rerender(
      <TodoRow
        item={makeTodo({ notes: "AI rewrote this" })}
        selected={false}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateNotes={onUpdateNotes}
        onSetAiRequest={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        isAnchored={false}
      />,
    );
    // Focus then blur with no typing — must not revert the external edit.
    fireEvent.blur(screen.getByPlaceholderText("Notes..."));
    expect(onUpdateNotes).not.toHaveBeenCalled();
  });

  it("a mid-edit local buffer is preserved against a concurrent external write, and wins on commit", () => {
    const onUpdateNotes = vi.fn();
    const { rerender } = renderRow(makeTodo({ notes: "old note" }), onUpdateNotes);
    const ta = screen.getByPlaceholderText("Notes...") as HTMLTextAreaElement;

    // User types an uncommitted edit.
    fireEvent.change(ta, { target: { value: "my in-progress edit" } });

    // A concurrent external write lands (same id, different notes).
    rerender(
      <TodoRow
        item={makeTodo({ notes: "AI rewrote this" })}
        selected={false}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateNotes={onUpdateNotes}
        onSetAiRequest={vi.fn()}
        onDelete={vi.fn()}
        onSelect={vi.fn()}
        isAnchored={false}
      />,
    );
    // The user's buffer is NOT clobbered.
    expect((screen.getByPlaceholderText("Notes...") as HTMLTextAreaElement).value).toBe(
      "my in-progress edit",
    );
    // On commit, the user's edit wins.
    fireEvent.blur(screen.getByPlaceholderText("Notes..."));
    expect(onUpdateNotes).toHaveBeenCalledWith("t1", "my in-progress edit");
  });
});
