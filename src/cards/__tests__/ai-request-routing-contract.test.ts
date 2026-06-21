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

/** The 7 flag-bearing kinds and their FROZEN wire routing. `linkPanel` is the
 *  `AiRequestLink.panel` vocabulary ({notes,todos,cutter,revisions,reports,
 *  footnotes} — `list_requests.py` PANEL_FILES + the reports bridge); `kind` is
 *  the `AiRequest.kind` each panel's row maps to there (notes→note/highlight,
 *  todos→todo, cutter/revisions→suggestion, reports→report, footnotes→footnote).
 *  BUG #55 added `footnote`: its flag lives in footnotes.json (not a panel card
 *  list), so its bridged entry is consumed via the unified `ai-requests.json`
 *  path (kind: "footnote" → /editor/draft-footnote), NOT a PANEL_FILES fallback
 *  row — hence "footnotes" is a valid `linkPanel` token but is intentionally
 *  absent from list_requests.py's PANEL_FILES (the unbridged-flag fallback). */
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
  footnote: { kind: "footnote", linkPanel: "footnotes" },
};

describe("AI-request routing contract (R29)", () => {
  it("the registry declares the frozen routing on exactly the 7 flag-bearing kinds", () => {
    const declared = CARD_KINDS.filter((k) => CARD_REGISTRY[k].aiRequest != null);
    expect(declared.sort()).toEqual(Object.keys(FROZEN_ROUTING_TABLE).sort());
    for (const [kind, frozen] of Object.entries(FROZEN_ROUTING_TABLE)) {
      expect(CARD_REGISTRY[kind as CardKind].aiRequest).toEqual(frozen);
    }
  });

  it("the other 9 kinds declare NO aiRequest routing", () => {
    const without = CARD_KINDS.filter((k) => CARD_REGISTRY[k].aiRequest == null);
    expect(without.length).toBe(9);
    // The suggestion siblings + atom/system kinds must stay out — a routing
    // declaration here would invent a wire token no skill reads. (footnote moved
    // INTO the routing table in BUG #55; citation deliberately stays out — its
    // "request" surface is find-citation via the AIWindow composer, not a
    // per-card flag.)
    for (const k of [
      "citation", "example", "archive", "report", "bib", "ai",
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
    // `citation` carries no aiRequest routing (find-citation runs via the
    // AIWindow composer, not a per-card flag) — the bridge must not write.
    await bridgeCardAiRequestFlag("doc-test", "citation", "card-123", true, {
      text: "hello",
    });
    expect(written.length).toBe(0);
    errSpy.mockRestore();
  });
});
