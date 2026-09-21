/**
 * Task 2026-09-20-681 — the Todo panel's "clear done" control discharges every
 * removed card's `ai-requests.json` row, end to end.
 *
 * WHAT WAS BROKEN. Task 219 wired the unbridge obligation into each panel
 * hook's `deleteItem`/`deleteCard`/`deleteNote` at the EditorPane seam. The Todo
 * panel has a SECOND destructive door — the footer's clear-done button — and it
 * reached `useTodos.archiveDone`, a raw `prev.items.filter(...)` that no seam
 * wrapped. Ticking a todo's AI box opens a row; completing the todo and clearing
 * it deleted the card and left the row open forever. A deleted card can never
 * toggle again, so the bridge's "self-heals on the next toggle" escape hatch
 * does not apply: the row is stranded, inflating the inbox count and re-serving
 * a card that no longer exists to every `/editor/review` drain.
 *
 * WHY THE BRIDGE IS REAL HERE. `lifecycle-unbridge.test.ts` proves the executor
 * fires its dep; that was never the broken part. The bug lived in the gap
 * between "a delete discharges the row" and "this particular removal is a
 * delete" — so this file wires the REAL `bridgeCardAiRequestFlag` in as the
 * forwarder, exactly as EditorPane does, and asserts against the on-disk
 * payload. Same storage interception as `lifecycle-unbridge-mode-e2e.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AiRequest, AiRequestsState } from "@/lib/types";
import type { CardKind } from "../types";

const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const written: { file: string; data: AiRequestsState }[] = [];
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async (_h: unknown, file: string, data: unknown) => {
    written.push({ file, data: data as AiRequestsState });
  }),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      file: string,
      _d: unknown,
      mutate: (cur: AiRequestsState) => AiRequestsState | null,
    ) => {
      const next = mutate(seeded.state);
      if (next === null) return null;
      seeded.state = next;
      written.push({ file, data: next });
      return next;
    },
  ),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import {
  makeUnbridgingDelete,
  makeUnbridgingBulkDelete,
} from "../lifecycle/unbridging-delete";

const DOC = "doc-681";

interface Todo {
  id: string;
  text: string;
  done: boolean;
  archived?: boolean;
  aiRequest?: boolean;
}

function pendingRow(cardId: string): AiRequest {
  return {
    id: `req-${cardId}`,
    kind: "todo",
    text: "look this up for me",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "todos", cardId },
  };
}

/** An ANSWERED-L3 row — `in-progress` with a `resultId`, which `isRequestOpen`
 *  reports as CLOSED. A reversible untick deliberately preserves it (task 043);
 *  a removal must not, because the card is gone (task 093 / 219). */
function answeredL3Row(cardId: string): AiRequest {
  return { ...pendingRow(cardId), id: `req-l3-${cardId}`, status: "in-progress", resultId: "card-proposal-1" };
}

/**
 * The pane's composition, rebuilt over a local collection: the wired single
 * delete, then the bulk door over it. Mirrors `EditorPane`'s
 * `deleteTodoItem` → `clearDoneTodos` exactly; the source-level test at the
 * bottom pins that the mirror still matches.
 */
function buildDoor(items: Todo[]) {
  const deleteOne = makeUnbridgingDelete({
    resolveKind: (id) => (items.some((t) => t.id === id) ? "todo" : null),
    rawDelete: (id) => {
      const at = items.findIndex((t) => t.id === id);
      if (at !== -1) items.splice(at, 1);
    },
    unbridge: (kind: CardKind, id: string, mode) =>
      bridgeCardAiRequestFlag(DOC, kind, id, false, { text: "" }, mode),
  });
  const bulk = makeUnbridgingBulkDelete(deleteOne);
  return async (ids?: readonly string[]) => {
    const idSet = ids ? new Set(ids) : null;
    const targets = items
      .filter((t) => t.done && (!idSet || idSet.has(t.id)))
      .map((t) => t.id);
    if (targets.length === 0) return;
    await bulk(targets);
  };
}

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});

describe("clearing done todos discharges every removed card's row (task 681)", () => {
  it("a flagged done todo's pending row is TERMINATED, not left open", async () => {
    const items: Todo[] = [{ id: "t1", text: "check the quote", done: true, aiRequest: true }];
    seeded.state = { requests: [pendingRow("t1")] };

    await buildDoor(items)(["t1"]);

    expect(items).toHaveLength(0);
    const rows = seeded.state.requests;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("complete");
    expect(rows[0].result).toBe("auto-applied");
  });

  it("closes EVERY removed todo's row, not just the first", async () => {
    const items: Todo[] = [
      { id: "t1", text: "a", done: true, aiRequest: true },
      { id: "t2", text: "b", done: true, aiRequest: true },
      { id: "t3", text: "c", done: false, aiRequest: true },
    ];
    seeded.state = { requests: [pendingRow("t1"), pendingRow("t2"), pendingRow("t3")] };

    await buildDoor(items)(["t1", "t2"]);

    expect(items.map((t) => t.id)).toEqual(["t3"]);
    const byCard = Object.fromEntries(
      seeded.state.requests.map((r) => [r.linkedTo!.cardId, r.status]),
    );
    // The two removed cards' rows close; the surviving todo's row stays open.
    expect(byCard).toEqual({ t1: "complete", t2: "complete", t3: "pending" });
  });

  it("closes an ANSWERED-L3 row too — the card is gone, so terminate mode applies", async () => {
    const items: Todo[] = [{ id: "t1", text: "a", done: true, aiRequest: true }];
    seeded.state = { requests: [answeredL3Row("t1")] };

    await buildDoor(items)(["t1"]);

    const row = seeded.state.requests[0];
    expect(row.status).toBe("complete");
    // The proposal pointer survives the close — accept/reject resolves through
    // `resultId`, not through the row's openness.
    expect(row.resultId).toBe("card-proposal-1");
  });

  it("removes only the ids it was given — a done-but-set-aside todo is not swept", async () => {
    const items: Todo[] = [
      { id: "t1", text: "a", done: true },
      { id: "t2", text: "b", done: true, archived: true },
    ];
    // The panel passes only the done todos VISIBLE in the current view.
    await buildDoor(items)(["t1"]);
    expect(items.map((t) => t.id)).toEqual(["t2"]);
  });

  it("writes nothing for unflagged todos (no spurious rows)", async () => {
    const items: Todo[] = [{ id: "t1", text: "a", done: true }];
    await buildDoor(items)(["t1"]);
    expect(items).toHaveLength(0);
    expect(written).toEqual([]);
  });

  it("with no ids, clears every done todo", async () => {
    const items: Todo[] = [
      { id: "t1", text: "a", done: true },
      { id: "t2", text: "b", done: false },
      { id: "t3", text: "c", done: true },
    ];
    await buildDoor(items)();
    expect(items.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("the pane really is wired this way (the mirror above is not fiction)", () => {
  const pane = readFileSync(join("src", "components", "EditorPane.tsx"), "utf8");

  it("the clear-done door is the bulk factory over the WIRED single delete", () => {
    expect(pane).toContain("makeUnbridgingBulkDelete(deleteTodoItem)");
  });

  it("the Todo panel is handed that door and no other", () => {
    expect(pane).toContain("clearDoneTodos={todosHook.clearDone}");
  });

  it("`useTodos` exposes no raw bulk purge for a consumer to reach past it", () => {
    const hook = readFileSync(join("src", "hooks", "useTodos.ts"), "utf8");
    // The raw door this task removed. A `const archiveDone = useCallback` (or
    // any re-added bulk filter under a new name) is caught by the census guard
    // `card-removal-door-census.test.ts`; this pins the specific regression.
    expect(hook).not.toMatch(/\bconst\s+archiveDone\s*=/);
  });
});
