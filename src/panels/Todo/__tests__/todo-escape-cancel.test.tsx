// @vitest-environment jsdom
//
// task 1094 — Escape in a todo card CANCELS. Both of the card's fields commit
// on blur, and before this fix Escape SAVED in both:
//   - the notes textarea took its keydown from `useTabIndent()`, whose Escape
//     blurs — and the blur ran `commitNotes`, writing the draft to todos.json;
//   - the title (`CardTitleInput`) had no Escape at all, so the draft the user
//     meant to drop was written by the next click-away.
// Every leg drives the REAL TodoRow and asserts the WRITE, not the rendered
// value: a broken cancel still shows the reverted text (task 529's mechanism).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

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
    text: "stored title",
    titleAuto: false,
    notes: "stored notes",
    done: false,
    aiRequest: false,
    createdAt: "2026-07-06T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

function renderRow() {
  cardStore.expand(REF);
  const onUpdate = vi.fn();
  const onUpdateNotes = vi.fn();
  render(
    <TodoRow
      item={makeTodo()}
      selected={false}
      onToggle={vi.fn()}
      onUpdate={onUpdate}
      onUpdateNotes={onUpdateNotes}
      onSetAiRequest={vi.fn()}
      onDelete={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  return { onUpdate, onUpdateNotes };
}

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

describe("todo notes — Escape cancels (task 1094)", () => {
  it("typing then Escape writes NOTHING and restores the stored notes", () => {
    const { onUpdateNotes } = renderRow();
    const ta = screen.getByDisplayValue("stored notes") as HTMLTextAreaElement;
    ta.focus();
    fireEvent.change(ta, { target: { value: "discard me" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(onUpdateNotes).not.toHaveBeenCalled();
    expect(ta.value).toBe("stored notes");
    // …and the field ended: focus left it, so no later click-away is owed a
    // commit either.
    expect(document.activeElement).not.toBe(ta);
    fireEvent.blur(ta);
    expect(onUpdateNotes).not.toHaveBeenCalled();
  });

  it("a blur after a real edit still commits — the cancel did not disarm the field", () => {
    const { onUpdateNotes } = renderRow();
    const ta = screen.getByDisplayValue("stored notes") as HTMLTextAreaElement;
    ta.focus();
    fireEvent.change(ta, { target: { value: "first" } });
    fireEvent.keyDown(ta, { key: "Escape" });
    ta.focus();
    fireEvent.change(ta, { target: { value: "kept edit" } });
    fireEvent.blur(ta);
    expect(onUpdateNotes).toHaveBeenCalledTimes(1);
    expect(onUpdateNotes).toHaveBeenCalledWith("t1", "kept edit");
  });

  it("Tab still inserts a tab rather than leaving the field", () => {
    renderRow();
    const ta = screen.getByDisplayValue("stored notes") as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 0);
    fireEvent.keyDown(ta, { key: "Tab" });
    expect(ta.value).toBe("\tstored notes");
  });
});

describe("todo title — Escape cancels (task 1094)", () => {
  it("typing then Escape writes NOTHING, and neither does the next click-away", () => {
    const { onUpdate } = renderRow();
    const box = screen.getByDisplayValue("stored title") as HTMLInputElement;
    box.focus();
    fireEvent.change(box, { target: { value: "discard me" } });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(box.value).toBe("stored title");
    fireEvent.blur(box);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a blur after a real edit still commits", () => {
    const { onUpdate } = renderRow();
    const box = screen.getByDisplayValue("stored title") as HTMLInputElement;
    box.focus();
    fireEvent.change(box, { target: { value: "new title" } });
    fireEvent.blur(box);
    expect(onUpdate).toHaveBeenCalledWith("t1", "new title");
  });
});
