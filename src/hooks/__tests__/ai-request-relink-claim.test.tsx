// @vitest-environment jsdom
//
// **The card migration's relink is a CLAIM, not a row swap** — task 1642.
//
// `relinkRequests` used to replace each disk row with the object the migration
// built from the hook's IN-MEMORY list, inside the CAS door — defeating the
// re-read for exactly the fields that mattered. It reopened a row a skill had
// completed meanwhile, re-pointed a row another window had already linked, and
// wrote normalised objects over raw bytes; and the cards were appended BEFORE
// the relink, unconditionally, so a lost or failed relink left an orphan card.
//
// The legs (driven through the real `useAiRequests` over a fake disk):
//   1. disk row already `complete` → the relink leaves it complete, no card;
//   2. disk row already linked to a peer's card → link kept, no card;
//   3. a clean claim patches ONLY `linkedTo` (+ the legacy status) onto the RAW
//      row — an unmodelled field survives — and appends exactly one card;
//   4. a refused write appends nothing and RELEASES the doc's one-per-session
//      claim so a later good read retries.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { AiRequest, AiRequestsState } from "@/lib/types";

const DISK: { requests: AiRequest[] } = { requests: [] };
const writeShouldThrow: { value: boolean } = { value: false };

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async (_docId: string, file: string, dflt: unknown) =>
    file === "ai-requests.json" ? { requests: [...DISK.requests] } : dflt,
  ),
  writeSidecar: vi.fn(async () => {}),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      _file: string,
      _dflt: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
    ) => {
      if (writeShouldThrow.value) throw new Error("disk full");
      const next = mutate({ requests: [...DISK.requests] });
      if (next === null) return null;
      DISK.requests = next.requests;
      return next;
    },
  ),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({ docId: "doc-1642" })),
  isStalePipelineError: vi.fn(() => false),
}));

import { useAiRequests } from "@/hooks/useAiRequests";
import {
  useAiRequestCardMigration,
  __resetAiRequestCardMigrationForTests,
} from "@/hooks/useAiRequestCardMigration";
import { resetSidecarRefusals } from "@/lib/sidecar-refusal";

const DOC = "doc-1642";

/** The request as THIS window read it: unlinked, open. */
const STALE: AiRequest = {
  id: "req-1",
  kind: "note",
  text: "please expand this",
  createdAt: "2026-09-20T00:00:00.000Z",
  status: "draft",
};

/** Mount the real inbox hook, then the migration over a given in-memory view. */
async function runMigration(memory: AiRequest[]) {
  const { result } = renderHook(() => useAiRequests(DOC));
  await waitFor(() => expect(result.current.loaded).toBe(true));
  const appendNotes = vi.fn();
  const appendTodos = vi.fn();
  const relink = vi.fn(result.current.relinkRequests);
  renderHook(() =>
    useAiRequestCardMigration({
      docId: DOC,
      sourcesAuthoritative: true,
      aiRequests: memory,
      appendNotes,
      appendTodos,
      relinkRequests: relink,
    }),
  );
  await waitFor(() => expect(relink).toHaveBeenCalledTimes(1));
  // Let the claim's write + its `.then` settle.
  await relink.mock.results[0].value;
  await new Promise((r) => setTimeout(r, 0));
  return { appendNotes, appendTodos };
}

beforeEach(() => {
  DISK.requests = [];
  writeShouldThrow.value = false;
  resetSidecarRefusals();
  __resetAiRequestCardMigrationForTests();
});

describe("relinkRequests is a conditional field patch over the RAW disk row", () => {
  it("a row a skill COMPLETED meanwhile stays complete, and no card is minted", async () => {
    DISK.requests = [{ ...STALE, status: "complete", result: "done" } as AiRequest];
    const { appendNotes } = await runMigration([STALE]);
    expect(DISK.requests[0].status).toBe("complete");
    expect(DISK.requests[0].linkedTo).toBeUndefined();
    expect(appendNotes).not.toHaveBeenCalled();
  });

  it("a row a peer window already LINKED keeps its link, and no second card is minted", async () => {
    const peer = { panel: "notes" as const, cardId: "peer-card" };
    DISK.requests = [{ ...STALE, status: "pending", linkedTo: peer }];
    const { appendNotes } = await runMigration([STALE]);
    expect(DISK.requests[0].linkedTo).toEqual(peer);
    expect(appendNotes).not.toHaveBeenCalled();
  });

  it("a clean claim patches only linkedTo (+ legacy status) onto the raw row and appends one card", async () => {
    // An unmodelled field a newer writer added — the raw row is the merge base.
    DISK.requests = [{ ...STALE, futureField: 7 } as unknown as AiRequest];
    const { appendNotes } = await runMigration([STALE]);
    const row = DISK.requests[0] as AiRequest & { futureField?: number };
    expect(row.futureField).toBe(7);
    expect(row.status).toBe("pending");
    expect(appendNotes).toHaveBeenCalledTimes(1);
    const [cards] = appendNotes.mock.calls[0];
    expect(cards).toHaveLength(1);
    expect(row.linkedTo).toEqual({ panel: "notes", cardId: cards[0].id });
  });

  it("a REFUSED write appends nothing and releases the doc's claim so a later read retries", async () => {
    DISK.requests = [STALE];
    writeShouldThrow.value = true;
    const first = await runMigration([STALE]);
    expect(first.appendNotes).not.toHaveBeenCalled();
    expect(DISK.requests[0].linkedTo).toBeUndefined();

    writeShouldThrow.value = false;
    const second = await runMigration([STALE]);
    expect(second.appendNotes).toHaveBeenCalledTimes(1);
    expect(DISK.requests[0].linkedTo?.panel).toBe("notes");
  });
});
