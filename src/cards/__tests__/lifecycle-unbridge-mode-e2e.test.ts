/**
 * Task 313 — the morph leg discharges an ANSWERED-L3 row, end to end.
 *
 * The sibling `lifecycle-unbridge.test.ts` proves the executor hands the right
 * MODE to its dep. That is necessary and not sufficient: the whole bug lived in
 * the gap between "the executor fires the unbridge" (which it always did, since
 * task 198) and "the row actually closes" — and the gap was one defaulted
 * argument three files away. So this file wires the REAL
 * `bridgeCardAiRequestFlag` in as the `unbridgeAiRequest` dep, exactly as
 * `EditorPane`'s forwarder does, and asserts against the on-disk payload.
 *
 * THE FIXTURE IS THE POINT. An "answered-L3" row is `status: "in-progress"` with
 * a non-empty `resultId` — what an L3 *propose* responder leaves behind the
 * moment its proposal card lands (`apply_response.cmd_write`). `isRequestOpen`
 * calls that row CLOSED (the drain must not re-nag a question already answered),
 * so `"toggle"` mode — which matches only open rows — finds nothing and writes
 * nothing. Under the old wiring that was the entire failure: the user flipped a
 * revision-comment to a suggestion, the row stayed `in-progress` forever on a
 * routing-less kind with no next toggle, and nothing anywhere reported a
 * problem.
 *
 * The `"toggle"` counter-case at the bottom is deliberately kept: it pins that
 * the mode is what does the work here, so this file fails for the right reason
 * if someone re-defaults the argument.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AiRequest,
  AiRequestKind,
  AiRequestLink,
  AiRequestsState,
} from "@/lib/types";
import type { CardKind } from "../types";

// Same storage interception as `ai-request-bridge-idempotency.test.ts` — the
// bridge's `@/lib/storage` barrel does a `require("@/lib/storage-fsa")` that
// vitest's resolver can't alias, and the sidecar I/O has to be captured anyway.
const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const written: { file: string; data: AiRequestsState }[] = [];
// Since task 220 the bridge writes through the serialized `mutateSidecar` door
// (the read runs INSIDE the write critical section), so the mock reproduces
// that door: apply the mutator to the seeded on-disk list, record what it
// persists, honor `null` = nothing-to-change (no write).
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    written.push({ file, data: data as AiRequestsState });
  }),
  mutateSidecar: vi.fn(
    async (
      _handle: unknown,
      file: string,
      _defaultValue: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
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
import { isRequestOpen } from "@/lib/ai-request-open";
import { runCardLifecycleEvent } from "../lifecycle/run-event";
import { CARD_REGISTRY } from "../card-registry";
// Side-effect: register the morph converters so the registry is complete.
import "../morphs";

const DOC = "doc-313";

/** The three flag-dropping morphs — DERIVED from the registry, not listed, so a
 *  fourth pair joins this test automatically (and a pair that stops dropping
 *  aiRequest drops out of it rather than failing mysteriously). */
const FLAG_DROPPING_MORPHS = (Object.keys(CARD_REGISTRY) as CardKind[])
  .filter((k) => CARD_REGISTRY[k].morph?.drops.includes("aiRequest"))
  .map((k) => ({
    from: k,
    to: CARD_REGISTRY[k].morph!.to,
    panel: CARD_REGISTRY[k].aiRequest!.linkPanel,
    kind: CARD_REGISTRY[k].aiRequest!.kind,
  }));

/** An answered-L3 row: the L3 propose responder stamped `resultId` when its
 *  proposal card landed but left the Task `in-progress`. */
function answeredL3(
  panel: AiRequestLink["panel"],
  cardId: string,
  kind: AiRequestKind,
): AiRequest {
  return {
    id: `req-${cardId}`,
    kind,
    text: "please tighten this paragraph",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "in-progress",
    resultId: "card-proposal-1",
    linkedTo: { panel, cardId },
  };
}

/** The forwarder EditorPane wires: mode in, mode straight through. */
const forwardToBridge = (
  kind: CardKind,
  id: string,
  mode: "toggle" | "terminate",
) => bridgeCardAiRequestFlag(DOC, kind, id, false, { text: "" }, mode);

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});

describe("a flag-dropping morph closes an ANSWERED-L3 row (313)", () => {
  it("guard the guard: the registry still has flag-dropping morphs to test", () => {
    expect(FLAG_DROPPING_MORPHS.map((m) => m.from).sort()).toEqual(
      ["cutter-comment", "report-request", "revision-comment"].sort(),
    );
  });

  it("the fixture really is a row `toggle` mode cannot see", () => {
    const row = answeredL3("revisions", "card-1", "suggestion");
    expect(isRequestOpen(row)).toBe(false);
  });

  for (const m of FLAG_DROPPING_MORPHS) {
    it(`${m.from} → ${m.to} terminates the linked answered-L3 row`, async () => {
      seeded.state = { requests: [answeredL3(m.panel, "card-1", m.kind)] };

      const committed = await runCardLifecycleEvent(
        { type: "morph", fromKind: m.from, id: "card-1" },
        {
          confirm: async () => true,
          unbridgeAiRequest: forwardToBridge,
          mutate: () => {},
        },
      );

      expect(committed).toBe(true);
      // ONE write, and the row is closed rather than dropped — terminate parks
      // it `complete` so the record of the exchange survives (the byte-mirror of
      // the Python `close_linked_request(force=True)` on `cmd_archive`).
      expect(written).toHaveLength(1);
      const reqs = written[0].data.requests;
      expect(reqs).toHaveLength(1);
      expect(reqs[0].status).toBe("complete");
      expect(reqs[0].result).toBe("auto-applied");
      // The proposal pointer SURVIVES the close — accept/reject of the surviving
      // suggestion card resolves through `resultId`, not through the row's
      // openness, which is why terminating here is safe (the same trade-off
      // delete and archive already make).
      expect(reqs[0].resultId).toBe("card-proposal-1");
    });
  }

  it("a card carrying BOTH an answered-L3 and a fresh pending row closes both (253's two-row case, on the morph leg)", async () => {
    const m = FLAG_DROPPING_MORPHS.find((x) => x.from === "revision-comment")!;
    seeded.state = {
      requests: [
        answeredL3(m.panel, "card-1", m.kind),
        {
          ...answeredL3(m.panel, "card-1", m.kind),
          id: "req-fresh",
          status: "pending",
          resultId: undefined,
        },
      ],
    };

    await runCardLifecycleEvent(
      { type: "morph", fromKind: m.from, id: "card-1" },
      {
        confirm: async () => true,
        unbridgeAiRequest: forwardToBridge,
        mutate: () => {},
      },
    );

    expect(written).toHaveLength(1);
    expect(written[0].data.requests.map((r) => r.status)).toEqual([
      "complete",
      "complete",
    ]);
  });

  // The behaviour change beyond the reported symptom, pinned so it is
  // DELIBERATE rather than incidental. The two modes differ for a plain OPEN
  // row too, not only the answered-L3 one 313 was reported for: toggle-off
  // FILTERS the row out of the file, terminate MAPS it to `complete`. So a
  // morph now leaves a resolved entry (visible in the AI window's Resolved
  // bucket) where it used to leave nothing at all. That is the intended
  // outcome — it is exactly what delete and archive already do, and this task
  // is about morph joining its terminal siblings — and it is the more honest
  // record: the user did ask, and the ask ended when the card changed kind.
  it("a plain OPEN row is PARKED complete, not deleted (morph now matches delete/archive)", async () => {
    const m = FLAG_DROPPING_MORPHS.find((x) => x.from === "revision-comment")!;
    seeded.state = {
      requests: [
        { ...answeredL3(m.panel, "card-1", m.kind), status: "pending", resultId: undefined },
      ],
    };

    await runCardLifecycleEvent(
      { type: "morph", fromKind: m.from, id: "card-1" },
      {
        confirm: async () => true,
        unbridgeAiRequest: forwardToBridge,
        mutate: () => {},
      },
    );

    const reqs = written[0].data.requests;
    expect(reqs).toHaveLength(1); // NOT dropped …
    expect(reqs[0].status).toBe("complete"); // … resolved
  });

  it("an UNRELATED card's row is untouched", async () => {
    const m = FLAG_DROPPING_MORPHS.find((x) => x.from === "revision-comment")!;
    seeded.state = { requests: [answeredL3(m.panel, "other-card", m.kind)] };

    await runCardLifecycleEvent(
      { type: "morph", fromKind: m.from, id: "card-1" },
      {
        confirm: async () => true,
        unbridgeAiRequest: forwardToBridge,
        mutate: () => {},
      },
    );

    // Terminate is idempotent: no match → no write at all.
    expect(written).toHaveLength(0);
  });

  // THE COUNTER-CASE. This is the pre-313 behaviour, spelled out so the file
  // fails loudly (and legibly) if the mode ever regresses: a forwarder that
  // substitutes `"toggle"` writes NOTHING and the row survives the morph.
  it("COUNTER-CASE — the same morph in 'toggle' mode strands the row (the bug)", async () => {
    const m = FLAG_DROPPING_MORPHS.find((x) => x.from === "revision-comment")!;
    seeded.state = { requests: [answeredL3(m.panel, "card-1", m.kind)] };

    await runCardLifecycleEvent(
      { type: "morph", fromKind: m.from, id: "card-1" },
      {
        confirm: async () => true,
        // deliberately NOT forwarding the executor's mode
        unbridgeAiRequest: (kind, id) =>
          bridgeCardAiRequestFlag(DOC, kind, id, false, { text: "" }, "toggle"),
        mutate: () => {},
      },
    );

    expect(written).toHaveLength(0);
    expect(seeded.state.requests[0].status).toBe("in-progress");
  });
});

describe("the DELETE leg keeps its terminate semantics through the same forwarder", () => {
  it("deleting a flagged revision-comment closes its answered-L3 row", async () => {
    seeded.state = { requests: [answeredL3("revisions", "card-1", "suggestion")] };

    await runCardLifecycleEvent(
      { type: "delete", kind: "revision-comment", id: "card-1", hasContent: false },
      {
        confirm: async () => true,
        unbridgeAiRequest: forwardToBridge,
        mutate: () => {},
      },
    );

    expect(written).toHaveLength(1);
    expect(written[0].data.requests[0].status).toBe("complete");
  });
});
