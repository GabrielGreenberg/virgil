/**
 * Task 2026-09-21-697 — **the context degrades, the call does not.**
 *
 * The AI window's Cancel on a card-linked row is the recovery affordance for a
 * row whose card is gone. It was inoperative in exactly that state: each panel
 * hook's `setXAiRequest` looked its card up in a render-time snapshot to build
 * the ADD context and then gated the WHOLE bridge call on finding it
 * (`if (card) bridge(...)`), so an absent card meant no row removed, no flag
 * changed, no error, and `/editor/review` draining the row forever.
 *
 * The lookup serves one branch — `text` / `paragraphIds` / `selectedText` are
 * read only when `value === true`. `bridgeFlagForCard` separates the two once,
 * and this suite pins the separation:
 *
 *   - card PRESENT → the caller's rich context reaches the bridge byte-for-byte
 *     (so the refactor cannot quietly thin it);
 *   - card ABSENT + `value=false` → the call STILL fires, the row closes, and
 *     the placeholder context is what degrades;
 *   - card ABSENT + `value=true` → REFUSED and loud, because a row linked to a
 *     card that does not exist is the stranded state this door exists to clear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AiRequest, AiRequestsState } from "@/lib/types";

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

import {
  bridgeFlagForCard,
  ABSENT_CARD_CONTEXT,
  type BridgeContext,
} from "@/lib/ai-request-bridge";

interface FakeCard {
  id: string;
  text: string;
}
const RICH = (c: FakeCard): BridgeContext => ({
  text: c.text,
  paragraphIds: ["p-1"],
  selectedText: "the selected words",
});

function linkedRow(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "req-existing",
    kind: "todo",
    text: "original text",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "todos", cardId: "card-1" },
    ...overrides,
  };
}

/** The bridge is fire-and-forget from the hooks' point of view (`void`), so a
 *  leg that asserts on the write has to let the promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("bridgeFlagForCard — the card is needed for the CONTEXT, not the CALL", () => {
  it("card ABSENT + value=false STILL closes the row (the whole bug)", async () => {
    seeded.state = { requests: [linkedRow()] };
    const context = vi.fn(RICH);

    bridgeFlagForCard("doc", "todo", "card-1", false, "toggle", null, context);
    await settle();

    // The row is CLOSED — withdrawal is a state, not an erasure (task 720)…
    expect(written).toHaveLength(1);
    expect(written[0].data.requests).toHaveLength(1);
    expect(written[0].data.requests[0]).toMatchObject({
      status: "complete",
      result: "withdrawn",
    });
    // …and the context builder was never asked for something it could not build.
    expect(context).not.toHaveBeenCalled();
  });

  it("card ABSENT + terminate closes the row too (archive of a lost card)", async () => {
    seeded.state = { requests: [linkedRow({ status: "in-progress", resultId: "r-1" })] };

    bridgeFlagForCard("doc", "todo", "card-1", false, "terminate", undefined, RICH);
    await settle();

    expect(written).toHaveLength(1);
    const [row] = written[0].data.requests;
    // An answered-L3 row a reversible toggle deliberately preserves (task 043)
    // still terminates when the card is gone (task 093) — and now does so even
    // when the snapshot has already lost the card.
    expect(row.status).toBe("complete");
    expect(row.result).toBe("auto-applied");
  });

  it("card PRESENT passes the caller's RICH context through unthinned", async () => {
    bridgeFlagForCard(
      "doc",
      "todo",
      "card-1",
      true,
      "toggle",
      { id: "card-1", text: "buy milk" },
      RICH,
    );
    await settle();

    expect(written).toHaveLength(1);
    const [row] = written[0].data.requests;
    expect(row.text).toBe("buy milk");
    expect(row.paragraphIds).toEqual(["p-1"]);
    expect(row.selectedText).toBe("the selected words");
    expect(row.linkedTo).toEqual({ panel: "todos", cardId: "card-1" });
    // NOT the placeholder — the degrade path must not reach a present card.
    expect(row.text).not.toBe(ABSENT_CARD_CONTEXT.text);
  });

  it("card ABSENT + value=true is REFUSED and LOUD — never a row stranded at birth", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    bridgeFlagForCard("doc", "todo", "card-1", true, "toggle", null, RICH);
    await settle();

    expect(written).toHaveLength(0);
    expect(err).toHaveBeenCalledOnce();
    expect(String(err.mock.calls[0][0])).toContain("card-1");
  });

  it("the placeholder is the ONE named absent-card context", () => {
    // Pinned because EditorPane's lifecycle forwarder and this door must agree
    // on it: both are closing a row with no card in hand.
    expect(ABSENT_CARD_CONTEXT).toEqual({ text: "" });
  });
});
