// @vitest-environment jsdom
//
// Task 706 — the Todo footer's "Archive" button ARCHIVES. It used to call the
// pane's clear-done door: a one-click, unconfirmed, permanent hard delete of
// every completed todo (notes included) under the one label that everywhere
// else in Virgil means the reversible set-aside. These tests drive the real
// panel over a stateful archive door (the same `useCardArchiveActions`
// contract EditorPane provides) and pin: done todos end up `archived: true`
// and still exist, the pending one is untouched, nothing is deleted, the
// control never un-archives, and it is absent where there is nothing to
// archive or no archive door is wired.

import { NO_JUMP } from "@/links/card-anchor-rows";
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TodoPanel from "@/panels/Todo";
import {
  CardArchiveViewProvider,
  type CardArchiveView,
} from "@/panels/_shared/card-archive-view";
import { CardArchiveActionsProvider } from "@/panels/_shared/card-archive-actions";
import type { CardKind } from "@/cards/types";
import type { TodoItem } from "@/lib/types";

afterEach(cleanup);

function todo(id: string, overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id,
    text: `task ${id}`,
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-09-22T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

function Harness({
  initial,
  view = "active",
  onDelete,
  archiveCalls,
  enabled = true,
  onState,
}: {
  initial: TodoItem[];
  view?: CardArchiveView;
  onDelete: (id: string) => void;
  archiveCalls: Array<[CardKind, string]>;
  enabled?: boolean;
  onState: (items: TodoItem[]) => void;
}) {
  const [items, setItems] = useState(initial);
  onState(items);
  return (
    <CardArchiveActionsProvider
      value={{
        enabled,
        isArchived: (id) => !!items.find((i) => i.id === id)?.archived,
        // A TOGGLE, exactly like EditorPane's `archiveCard`.
        archive: (kind, id) => {
          archiveCalls.push([kind, id]);
          setItems((prev) =>
            prev.map((i) => (i.id === id ? { ...i, archived: !i.archived } : i)),
          );
        },
      }}
    >
      <CardArchiveViewProvider value={{ getView: () => view, setView: () => {} }}>
        <TodoPanel
          items={items}
          onAdd={() => todo("new")}
          onToggle={vi.fn()}
          onUpdate={vi.fn()}
          onUpdateNotes={vi.fn()}
          onSetAiRequest={vi.fn()}
          jumpGate={() => ({ anchored: false, withJump: NO_JUMP })}
          onDelete={onDelete}
          selectedTodoId={null}
          onSelectTodo={vi.fn()}
        />
      </CardArchiveViewProvider>
    </CardArchiveActionsProvider>
  );
}

function setup(
  initial: TodoItem[],
  opts: { view?: CardArchiveView; enabled?: boolean } = {},
) {
  const onDelete = vi.fn();
  const archiveCalls: Array<[CardKind, string]> = [];
  let latest: TodoItem[] = initial;
  render(
    <Harness
      initial={initial}
      view={opts.view}
      enabled={opts.enabled}
      onDelete={onDelete}
      archiveCalls={archiveCalls}
      onState={(s) => (latest = s)}
    />,
  );
  return { onDelete, archiveCalls, items: () => latest };
}

describe("Todo footer Archive archives — it never deletes (task 706)", () => {
  it("archives both done todos (one with notes), keeps them, leaves the pending one alone", () => {
    const { onDelete, items, archiveCalls } = setup([
      todo("a", { done: true, notes: "my careful notes" }),
      todo("b", { done: true }),
      todo("c"),
    ]);
    fireEvent.click(screen.getByText("Archive"));
    const after = items();
    expect(after.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(after.find((t) => t.id === "a")).toMatchObject({
      archived: true,
      notes: "my careful notes",
    });
    expect(after.find((t) => t.id === "b")?.archived).toBe(true);
    expect(after.find((t) => t.id === "c")?.archived).toBeFalsy();
    expect(archiveCalls).toEqual([
      ["todo", "a"],
      ["todo", "b"],
    ]);
    expect(onDelete).not.toHaveBeenCalled();
    // In the Active view the archived done todos have left the list, so the
    // footer (and its button) disappears.
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("All view: never un-archives an already-archived done todo", () => {
    const { archiveCalls, items } = setup(
      [todo("a", { done: true, archived: true }), todo("b", { done: true })],
      { view: "all" },
    );
    fireEvent.click(screen.getByText("Archive"));
    expect(archiveCalls).toEqual([["todo", "b"]]);
    expect(items().every((t) => t.archived)).toBe(true);
    // Everything done is archived now — nothing left for the button to do.
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.getByText("2 completed")).toBeTruthy();
  });

  it("no archive door wired (tests / Reader) → no button, count still shows", () => {
    setup([todo("a", { done: true })], { enabled: false });
    expect(screen.getByText("1 completed")).toBeTruthy();
    expect(screen.queryByText("Archive")).toBeNull();
  });
});

// Census (deep angle): a control whose visible label is "Archive" must never
// resolve to a removal door. Scans panel/component sources for a <button>
// whose text is exactly "Archive" and fails if its onClick names a
// delete/clear/remove/purge handler.
describe("census: a control labelled Archive never reaches a delete door", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === "__tests__" || name === "node_modules") continue;
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith(".tsx")) out.push(p);
    }
    return out;
  }

  it("finds no Archive-labelled button wired to delete/clear/remove/purge", () => {
    const offenders: string[] = [];
    let archiveButtons = 0;
    for (const file of [...walk(join("src", "panels")), ...walk(join("src", "components"))]) {
      const src = readFileSync(file, "utf8");
      // Chunk = `<button …` up to its `</button>`; the label is the text
      // immediately before the close tag; the handler is the brace-balanced
      // `onClick={…}` expression (arrow bodies contain `>`, so no attr regex).
      for (const m of src.matchAll(/<button\b[\s\S]*?<\/button>/g)) {
        const chunk = m[0];
        if (!/>\s*Archive\s*<\/button>$/.test(chunk)) continue;
        archiveButtons += 1;
        const at = chunk.indexOf("onClick={");
        let onClick = "";
        if (at >= 0) {
          let depth = 0;
          for (let i = at + "onClick=".length; i < chunk.length; i++) {
            const ch = chunk[i];
            if (ch === "{") depth += 1;
            else if (ch === "}" && --depth === 0) {
              onClick = chunk.slice(at, i + 1);
              break;
            }
          }
        }
        if (/delete|clear|remove|purge/i.test(onClick)) {
          offenders.push(`${file}: ${onClick}`);
        }
      }
    }
    // Non-vacuous: the Todo footer's own button is among those scanned.
    expect(archiveButtons).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
