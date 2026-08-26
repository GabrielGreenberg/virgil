// @vitest-environment jsdom
//
// task 2026-07-12-103 — the Todo header badge and completed-footer must respect
// the panel's done/archive-view semantics, not derive from the unfiltered list.
// Historically:
//   (1) the badge counted done (unarchived) todos — `count={pending.length}` was
//       dead, overridden by CardListPanel's `visibleItems.length`;
//   (2) the footer "N completed" + Archive button counted (and Archive PURGED)
//       archived, hidden, deliberately-set-aside done todos in the Active view.
// These render tests pin: badge excludes done in Active view; footer excludes
// archived+done in Active view; the badge follows the shown set in Archives
// view; and Archive fires with only the VISIBLE done ids (never a hidden one).

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
import TodoPanel from "@/panels/Todo";
import {
  CardArchiveViewProvider,
  type CardArchiveViewApi,
  type CardArchiveView,
} from "@/panels/_shared/card-archive-view";
import type { TodoItem } from "@/lib/types";

afterEach(cleanup);

let idCounter = 0;
function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  idCounter += 1;
  return {
    id: `t${idCounter}`,
    text: `task ${idCounter}`,
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-07-06T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

function provider(view: CardArchiveView): CardArchiveViewApi {
  return {
    getView: () => view,
    setView: () => {},
  };
}

function renderPanel(
  items: TodoItem[],
  view: CardArchiveView = "active",
  onArchiveDone = vi.fn(),
) {
  const utils = render(
    <CardArchiveViewProvider value={provider(view)}>
      <TodoPanel
        items={items}
        onAdd={() => makeTodo()}
        onToggle={vi.fn()}
        onUpdate={vi.fn()}
        onUpdateNotes={vi.fn()}
        onSetAiRequest={vi.fn()}
        onDelete={vi.fn()}
        onArchiveDone={onArchiveDone}
        selectedTodoId={null}
        onSelectTodo={vi.fn()}
      />
    </CardArchiveViewProvider>,
  );
  return { onArchiveDone, ...utils };
}

function badge(container: HTMLElement): string | null {
  return container.querySelector(".panel-header-count")?.textContent ?? null;
}

beforeEach(() => {
  idCounter = 0;
});

describe("Todo badge/footer count semantics (task 2026-07-12-103)", () => {
  it("Active view: header badge excludes done (unarchived) todos", () => {
    const { container } = renderPanel([
      makeTodo({ done: false }),
      makeTodo({ done: false }),
      makeTodo({ done: false }),
      makeTodo({ done: true }),
      makeTodo({ done: true }),
    ]);
    // 3 pending, 2 done, all unarchived → badge counts pending only.
    expect(badge(container)).toBe("3");
    expect(screen.getByText("2 completed")).toBeTruthy();
  });

  it("Active view: all done → badge is absent (0), not the full list length", () => {
    const { container } = renderPanel([
      makeTodo({ done: true }),
      makeTodo({ done: true }),
      makeTodo({ done: true }),
    ]);
    // Badge span renders only when count > 0; a 0 pending count must not show 3.
    expect(badge(container)).toBeNull();
    expect(screen.getByText("3 completed")).toBeTruthy();
  });

  it("Active view: an archived+done todo does NOT inflate the footer count", () => {
    const { container } = renderPanel([
      makeTodo({ done: false }),
      makeTodo({ done: true }),
      makeTodo({ done: true, archived: true }), // hidden by Active view
    ]);
    // Visible = the 2 unarchived; footer counts the 1 visible done, not 2.
    expect(badge(container)).toBe("1");
    expect(screen.getByText("1 completed")).toBeTruthy();
  });

  it("Active view: Archive fires with only the VISIBLE done ids — never a hidden set-aside one", () => {
    const hiddenDone = makeTodo({ done: true, archived: true });
    const visibleDone = makeTodo({ done: true });
    const { onArchiveDone } = renderPanel(
      [makeTodo({ done: false }), visibleDone, hiddenDone],
      "active",
    );
    fireEvent.click(screen.getByText("Archive"));
    expect(onArchiveDone).toHaveBeenCalledTimes(1);
    const ids = onArchiveDone.mock.calls[0][0] as string[];
    expect(ids).toEqual([visibleDone.id]);
    expect(ids).not.toContain(hiddenDone.id);
  });

  it("Archives view: badge and footer follow the shown (archived) set", () => {
    const { container } = renderPanel(
      [
        makeTodo({ done: false }), // unarchived pending — hidden in Archives
        makeTodo({ done: true }), // unarchived done — hidden in Archives
        makeTodo({ done: true, archived: true }),
        makeTodo({ done: false, archived: true }),
      ],
      "archived",
    );
    // Visible = the 2 archived; badge = archived-and-pending (1); footer = archived done (1).
    expect(badge(container)).toBe("1");
    expect(screen.getByText("1 completed")).toBeTruthy();
  });
});
