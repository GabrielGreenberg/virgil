/**
 * Inbox open-derivation parity (task 093 GAP 1) — the Virgil-bar AI-inbox
 * surface (`buildRequests` → the AI-window list, `aiRequestDotStatus` → the
 * notification dot) must derive a panel request's openness from the
 * `isRequestOpen` SSOT, NOT a binary `status === "complete"` check.
 *
 * The regression this pins: an answered-L3 proposal row
 * (`status: "in-progress"` + `resultId`) is CLOSED per `isRequestOpen` (the user
 * owns accept/reject now), but the old binary check painted it "open" / lit the
 * yellow dot. After archive terminates such a row to `complete` (GAP 2), the
 * surface must also agree it is resolved. Both are enumerated over the
 * `status × resultId` matrix here.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AIWindow transitively pulls in `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha) — the exports
// under test (`buildRequests` / `aiRequestDotStatus`) are pure and never touch
// it, so a stub keeps the module graph loadable.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { buildRequests, aiRequestDotStatus } from "@/components/AIWindow";
import type { AiRequest } from "@/lib/types";

function req(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "r1",
    kind: "todo",
    text: "do the thing",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "todos", cardId: "card-1" },
    ...overrides,
  };
}

const NOOPS = {
  cancelBibReview: () => {},
  removeEntryRequest: () => {},
  deletePanelAiRequest: () => {},
};

function listOne(r: AiRequest) {
  const vms = buildRequests({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests: [r],
    ...NOOPS,
  });
  return vms.find((v) => v.id === `panel:${r.id}`)!;
}

function dotOne(r: AiRequest) {
  return aiRequestDotStatus({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests: [r],
  });
}

describe("AI-inbox surface honors isRequestOpen (task 093 GAP 1)", () => {
  it("pending → list 'open' + cancel affordance + yellow dot", () => {
    const vm = listOne(req({ status: "pending" }));
    expect(vm.status).toBe("open");
    expect(vm.onCancel).toBeTypeOf("function");
    expect(dotOne(req({ status: "pending" }))).toBe("yellow");
  });

  it("in-progress WITHOUT resultId (skill mid-flight) still OPEN → yellow dot", () => {
    // Negative control: only the resultId stamp closes an in-progress row.
    const vm = listOne(req({ status: "in-progress" }));
    expect(vm.status).toBe("open");
    expect(dotOne(req({ status: "in-progress" }))).toBe("yellow");
  });

  it("answered-L3 (in-progress + resultId) → list 'resolved', NO cancel, NO dot", () => {
    const answered = req({ status: "in-progress", resultId: "proposal-card-1" });
    const vm = listOne(answered);
    expect(vm.status).toBe("resolved");
    expect(vm.onCancel).toBeUndefined();
    expect(dotOne(answered)).toBeNull();
  });

  it("complete → list 'resolved', NO cancel, NO dot", () => {
    const done = req({ status: "complete", result: "auto-applied" });
    const vm = listOne(done);
    expect(vm.status).toBe("resolved");
    expect(vm.onCancel).toBeUndefined();
    expect(dotOne(done)).toBeNull();
  });
});
