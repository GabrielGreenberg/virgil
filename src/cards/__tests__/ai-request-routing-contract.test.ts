/**
 * R29 pin tests — registry-declared AI-request routing.
 *
 * `CARD_REGISTRY[kind].aiRequest` now routes the card-flag → `ai-requests.json`
 * bridge: `kind` is the `AiRequest.kind` a subskill dispatches on, `linkPanel`
 * is the `AiRequestLink.panel` wire token. Both halves are the FROZEN external
 * skill contract — the Python side (`editor/scripts/list_requests.py`,
 * `PANEL_FILES` + the request inbox) matches these strings byte-for-byte
 * against on-disk sidecars. These tables freeze the vocabulary so a registry
 * edit that would corrupt the contract trips a test instead of shipping.
 */
import { describe, it, expect, vi } from "vitest";

// The bridge imports `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha) — and the
// test must intercept sidecar I/O anyway to observe the written request.
const written: { file: string; data: unknown }[] = [];
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({ requests: [] })),
  writeSidecar: vi.fn(async (_handle: unknown, file: string, data: unknown) => {
    written.push({ file, data });
  }),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KINDS } from "@/cards/predicates";
import { bridgeCardAiRequestFlag } from "@/lib/ai-request-bridge";
import type { CardKind } from "@/cards/types";
import type { AiRequest, AiRequestsState } from "@/lib/types";

/** The 6 flag-bearing kinds and their FROZEN wire routing. `linkPanel` is the
 *  `AiRequestLink.panel` vocabulary ({notes,todos,cutter,revisions,reports} —
 *  `list_requests.py` PANEL_FILES + the reports bridge); `kind` is the
 *  `AiRequest.kind` each panel's row maps to there (notes→note/highlight,
 *  todos→todo, cutter/revisions→suggestion, reports→report). */
const FROZEN_ROUTING_TABLE: Record<
  string,
  { kind: string; linkPanel: string }
> = {
  note: { kind: "note", linkPanel: "notes" },
  highlight: { kind: "highlight", linkPanel: "notes" },
  todo: { kind: "todo", linkPanel: "todos" },
  "cutter-comment": { kind: "suggestion", linkPanel: "cutter" },
  "revision-comment": { kind: "suggestion", linkPanel: "revisions" },
  "report-request": { kind: "report", linkPanel: "reports" },
};

describe("AI-request routing contract (R29)", () => {
  it("the registry declares the frozen routing on exactly the 6 flag-bearing kinds", () => {
    const declared = CARD_KINDS.filter((k) => CARD_REGISTRY[k].aiRequest != null);
    expect(declared.sort()).toEqual(Object.keys(FROZEN_ROUTING_TABLE).sort());
    for (const [kind, frozen] of Object.entries(FROZEN_ROUTING_TABLE)) {
      expect(CARD_REGISTRY[kind as CardKind].aiRequest).toEqual(frozen);
    }
  });

  it("the other 10 kinds declare NO aiRequest routing", () => {
    const without = CARD_KINDS.filter((k) => CARD_REGISTRY[k].aiRequest == null);
    expect(without.length).toBe(10);
    // The suggestion siblings + atom/system kinds must stay out — a routing
    // declaration here would invent a wire token no skill reads.
    for (const k of [
      "footnote", "citation", "example", "archive", "report", "bib", "ai",
      "error", "revision-suggestion", "cutter-suggestion",
    ] as CardKind[]) {
      expect(CARD_REGISTRY[k].aiRequest).toBeUndefined();
    }
  });

  it("the real bridge writes registry-routed requests (byte-frozen wire fields)", async () => {
    for (const [kind, frozen] of Object.entries(FROZEN_ROUTING_TABLE)) {
      written.length = 0;
      await bridgeCardAiRequestFlag(
        "doc-test",
        kind as CardKind,
        "card-123",
        true,
        { text: "hello", paragraphIds: ["p1"] },
      );
      expect(written.length).toBe(1);
      expect(written[0].file).toBe("ai-requests.json");
      const state = written[0].data as AiRequestsState;
      expect(state.requests.length).toBe(1);
      const req: AiRequest = state.requests[0];
      expect(req.kind).toBe(frozen.kind);
      expect(req.linkedTo).toEqual({ panel: frozen.linkPanel, cardId: "card-123" });
      expect(req.status).toBe("pending");
    }
  });

  it("the bridge no-ops (no write) for a kind with no declared routing", async () => {
    written.length = 0;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await bridgeCardAiRequestFlag("doc-test", "footnote", "card-123", true, {
      text: "hello",
    });
    expect(written.length).toBe(0);
    errSpy.mockRestore();
  });
});
