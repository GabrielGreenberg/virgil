// @vitest-environment jsdom
//
// task 067 facet 2 — the docked/omni/float todo trash (TodoRow) must confirm-
// on-content like every sibling anchored-body panel, routing through the
// `cardHasContent` SSOT. Historically TodoRow's trash + panel Delete/Backspace
// wired straight to a bare `deleteItem` (no confirm) — todo was the lone
// anchored-body panel whose trash skipped the content gate, one click from
// silent loss. These tests pin the confirm gate at the render seam.

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
    text: "",
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-07-06T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

function renderRow(item: TodoItem, onDelete = vi.fn()) {
  // The trash button renders only on the expanded (non-compressed) body.
  cardStore.expand(REF);
  const utils = render(
    <TodoRow
      item={item}
      selected={false}
      onToggle={vi.fn()}
      onUpdate={vi.fn()}
      onUpdateNotes={vi.fn()}
      onSetAiRequest={vi.fn()}
      onDelete={onDelete}
      onSelect={vi.fn()}
      isAnchored={false}
    />,
  );
  return { onDelete, ...utils };
}

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

describe("TodoRow delete-confirm (task 067 facet 2)", () => {
  it("a title-bearing todo trash opens the confirm (does NOT delete immediately)", () => {
    const { onDelete } = renderRow(makeTodo({ text: "buy milk" }));
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText("This item has text. Delete it?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("a NOTES-ONLY todo (title cleared) trash opens the confirm — the facet-1+2 combined win", () => {
    const { onDelete } = renderRow(makeTodo({ text: "", notes: "keep this" }));
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.getByText("This item has text. Delete it?")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("confirming the dialog then calls onDelete", () => {
    const { onDelete } = renderRow(makeTodo({ text: "buy milk" }));
    fireEvent.click(screen.getByLabelText("Delete"));
    fireEvent.click(screen.getByText("Delete", { selector: "button" }));
    expect(onDelete).toHaveBeenCalledWith("t1");
  });

  it("a pristine (blank text + notes) todo trash deletes immediately — no confirm", () => {
    const { onDelete } = renderRow(makeTodo({ text: "", notes: "" }));
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(screen.queryByText("This item has text. Delete it?")).toBeNull();
    expect(onDelete).toHaveBeenCalledWith("t1");
  });
});

// task 096 — the card-level Delete/Backspace handler must NOT fire while a
// field inside the card is focused (Todo is the lone editable card wiring a
// bare `!selected` card handler around a plain <input>/<textarea>; the keydown
// bubbles up). Focusing a field selects the card (onFocusCapture), so `selected`
// is true — the ONLY thing that must stop the card-delete is the event-origin
// guard. These pin that a keydown from the title input / notes textarea edits
// the character and never triggers card deletion or the confirm.
describe("TodoRow delete-key focus guard (task 096)", () => {
  // The guard only matters when the card is SELECTED (else the handler bails at
  // `!selected`). In real use, focusing a field selects the card via
  // onFocusCapture; here we render selected so the keydown reaches the guard.
  function renderSelectedRow(item: TodoItem, onDelete = vi.fn()) {
    cardStore.expand(REF);
    render(
      <TodoRow
        item={item}
        selected
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateNotes={vi.fn()}
        onSetAiRequest={vi.fn()}
        onDelete={onDelete}
        onSelect={vi.fn()}
        isAnchored={false}
      />,
    );
    return onDelete;
  }

  it("Backspace from the TITLE input does NOT delete the card or open the confirm", () => {
    const onDelete = renderSelectedRow(makeTodo({ text: "buy milk" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Task"), { key: "Backspace" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("This item has text. Delete it?")).toBeNull();
  });

  it("Delete from the TITLE input does NOT delete the card or open the confirm", () => {
    const onDelete = renderSelectedRow(makeTodo({ text: "buy milk" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Task"), { key: "Delete" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("This item has text. Delete it?")).toBeNull();
  });

  it("Backspace from the NOTES textarea does NOT delete the card or open the confirm", () => {
    const onDelete = renderSelectedRow(makeTodo({ text: "buy milk", notes: "a" }));
    fireEvent.keyDown(screen.getByPlaceholderText("Notes..."), { key: "Backspace" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText("This item has text. Delete it?")).toBeNull();
  });

  it("Backspace on the card SHELL (not a field) still routes to the card delete", () => {
    // A pristine (blank) card deletes immediately; a Backspace whose target IS
    // the card shell must reach tryDelete — proving the guard only suppresses
    // field-origin keydowns, not the shell convention. onKeyDown lives on the
    // card root (which also carries data-todo-entry), so dispatching there makes
    // the shell both target and currentTarget.
    const onDelete = renderSelectedRow(makeTodo({ text: "", notes: "" }));
    const shell = document.querySelector<HTMLElement>('[data-todo-entry="t1"]');
    expect(shell).not.toBeNull();
    fireEvent.keyDown(shell!, { key: "Backspace" });
    expect(onDelete).toHaveBeenCalledWith("t1");
  });
});
