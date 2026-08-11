/**
 * AI-request inbox live-sync contract (drop D3).
 *
 * `bridgeCardAiRequestFlag` persists `ai-requests.json` directly, behind the
 * live inbox hook (`useAiRequests`). Before the `ai-request-events` bus, the
 * hook read the file once per doc and never re-synced, so a freshly-toggled
 * card request didn't surface in the AIWindow until a reload/remount — the
 * dominant "not smoothly culled into the inbox" symptom.
 *
 * These pins nail the fix at the source: on a SUCCESSFUL write the bridge must
 * publish its authoritative post-write request list on the doc channel (so the
 * hook adopts it), and on a FAILED write it must NOT publish (the on-disk queue
 * is unchanged, so the in-memory inbox must not diverge from it).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiRequest, AiRequestsState } from "@/lib/types";

// Same barrel/storage-mock gotcha as the routing + idempotency pins: intercept
// sidecar I/O so we can seed the read and fail the write on demand.
const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const writeShouldThrow: { value: boolean } = { value: false };
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async () => {
    if (writeShouldThrow.value) throw new Error("simulated write failure");
  }),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import { subscribeAiRequests } from "@/lib/ai-request-events";

const DOC = "doc-live-sync";

beforeEach(() => {
  seeded.state = { requests: [] };
  writeShouldThrow.value = false;
});

describe("ai-requests inbox live-sync (D3)", () => {
  it("publishes the post-write list on a successful ADD, on the right doc channel", async () => {
    const events: AiRequest[][] = [];
    const unsub = subscribeAiRequests(DOC, (reqs) => events.push(reqs));

    await bridgeCardAiRequestFlag(DOC, "todo", "card-1", true, {
      text: "do the thing",
      paragraphIds: ["p1"],
    }, "toggle");

    expect(events).toHaveLength(1);
    const published = events[0];
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe("todo");
    expect(published[0].text).toBe("do the thing");
    expect(published[0].linkedTo).toEqual({ panel: "todos", cardId: "card-1" });
    expect(published[0].status).toBe("pending");
    unsub();
  });

  it("publishes the reduced list on a successful REMOVE (value=false)", async () => {
    seeded.state = {
      requests: [
        {
          id: "req-1",
          kind: "todo",
          text: "existing",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          linkedTo: { panel: "todos", cardId: "card-1" },
        },
      ],
    };
    const events: AiRequest[][] = [];
    const unsub = subscribeAiRequests(DOC, (reqs) => events.push(reqs));

    await bridgeCardAiRequestFlag(DOC, "todo", "card-1", false, { text: "" }, "toggle");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([]); // the linked request was dropped
    unsub();
  });

  it("does NOT publish when the write fails — inbox must not diverge from disk", async () => {
    writeShouldThrow.value = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const events: AiRequest[][] = [];
    const unsub = subscribeAiRequests(DOC, (reqs) => events.push(reqs));

    await bridgeCardAiRequestFlag(DOC, "todo", "card-1", true, { text: "x" }, "toggle");

    expect(events).toHaveLength(0);
    errSpy.mockRestore();
    unsub();
  });

  it("does NOT publish on a value=false no-op (nothing to drop → no write)", async () => {
    // No open linked request → the bridge returns before writing, so there is
    // no state change to announce.
    const events: AiRequest[][] = [];
    const unsub = subscribeAiRequests(DOC, (reqs) => events.push(reqs));

    await bridgeCardAiRequestFlag(DOC, "todo", "card-1", false, { text: "" }, "toggle");

    expect(events).toHaveLength(0);
    unsub();
  });

  it("only notifies subscribers on the matching doc channel", async () => {
    const mine: AiRequest[][] = [];
    const other: AiRequest[][] = [];
    const unsubMine = subscribeAiRequests(DOC, (reqs) => mine.push(reqs));
    const unsubOther = subscribeAiRequests("some-other-doc", (reqs) => other.push(reqs));

    await bridgeCardAiRequestFlag(DOC, "note", "card-9", true, { text: "hi" }, "toggle");

    expect(mine).toHaveLength(1);
    expect(other).toHaveLength(0);
    unsubMine();
    unsubOther();
  });

  it("unsubscribe stops delivery", async () => {
    const events: AiRequest[][] = [];
    const unsub = subscribeAiRequests(DOC, (reqs) => events.push(reqs));
    unsub();

    await bridgeCardAiRequestFlag(DOC, "note", "card-2", true, { text: "y" }, "toggle");

    expect(events).toHaveLength(0);
  });
});
