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
