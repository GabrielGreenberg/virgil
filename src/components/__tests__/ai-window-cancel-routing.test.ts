/**
 * AIWindow cancel routing (task 222) — the queue→card twin of the delete-leg
 * leak (task 219).
 *
 * A card's `aiRequest: true` flag and its OPEN row in `ai-requests.json` are one
 * coupling. Canceling a request from the AIWindow must respect BOTH faces:
 *
 *   - A **card-linked** row (`linkedTo` set — bridged from a note/todo/footnote/
 *     etc. with `aiRequest:true`) cancels through the card-flag-clearing path
 *     (`clearLinkedAiRequest(kind, cardId)`), which drops the queue row AND
 *     lowers the owning card's flag together (the inverse of checking the box).
 *     It must NOT hit the raw `deletePanelAiRequest` filter — that drops the row
 *     and leaves the card's checkbox lit over a request the drain never serves.
 *   - An **unlinked** composer-created row (no `linkedTo`) keeps the raw
 *     `deletePanelAiRequest(id)` path unchanged.
 *
 * The owning `CardKind` is resolved from the request's `(kind, linkPanel)` PAIR
 * — `linkPanel` alone is ambiguous (note/highlight both `notes`; cutter- vs
 * revision-comment both request-kind `suggestion`).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AIWindow transitively pulls in `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha). `buildRequests`
// is pure and never touches it, so a stub keeps the module graph loadable.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { buildRequests } from "@/components/AIWindow";
import { linkedCardKindFrom } from "@/cards/predicates";
import type { AiRequest, AiRequestLink } from "@/lib/types";
import type { CardKind } from "@/cards/types";

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

function build(
  r: AiRequest,
  spies: {
    deletePanelAiRequest?: (id: string) => void;
    clearLinkedAiRequest?: (kind: CardKind, cardId: string) => void;
  },
) {
  const vms = buildRequests({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests: [r],
    cancelBibReview: () => {},
    removeEntryRequest: () => {},
    deletePanelAiRequest: spies.deletePanelAiRequest ?? (() => {}),
    clearLinkedAiRequest: spies.clearLinkedAiRequest ?? (() => {}),
  });
  return vms.find((v) => v.id === `panel:${r.id}`)!;
}

describe("AIWindow cancel routes card-linked requests through the both-faces clear (task 222)", () => {
  it("linked request → onCancel calls clearLinkedAiRequest(kind, cardId), NOT the raw delete", () => {
    const clearLinkedAiRequest = vi.fn();
    const deletePanelAiRequest = vi.fn();
    const vm = build(
      req({ kind: "todo", linkedTo: { panel: "todos", cardId: "card-1" } }),
      { clearLinkedAiRequest, deletePanelAiRequest },
    );
    expect(vm.onCancel).toBeTypeOf("function");
    vm.onCancel!();
    expect(clearLinkedAiRequest).toHaveBeenCalledExactlyOnceWith("todo", "card-1");
    expect(deletePanelAiRequest).not.toHaveBeenCalled();
  });

  it("unlinked composer request → onCancel keeps the raw deletePanelAiRequest(id) path", () => {
    const clearLinkedAiRequest = vi.fn();
    const deletePanelAiRequest = vi.fn();
    const vm = build(
      req({ id: "composer-1", kind: "note", linkedTo: undefined }),
      { clearLinkedAiRequest, deletePanelAiRequest },
    );
    expect(vm.onCancel).toBeTypeOf("function");
    vm.onCancel!();
    expect(deletePanelAiRequest).toHaveBeenCalledExactlyOnceWith("composer-1");
    expect(clearLinkedAiRequest).not.toHaveBeenCalled();
  });

  it("resolves the owning CardKind from the (kind, linkPanel) PAIR, disambiguating the shared panels/kinds", () => {
    // note vs highlight share linkPanel "notes"; cutter- vs revision-comment
    // share request kind "suggestion". Both must resolve to the RIGHT setter.
    const cases: Array<{
      reqKind: AiRequest["kind"];
      panel: AiRequestLink["panel"];
      expected: CardKind;
    }> = [
      { reqKind: "note", panel: "notes", expected: "note" },
      { reqKind: "highlight", panel: "notes", expected: "highlight" },
      { reqKind: "suggestion", panel: "cutter", expected: "cutter-comment" },
      { reqKind: "suggestion", panel: "revisions", expected: "revision-comment" },
      { reqKind: "todo", panel: "todos", expected: "todo" },
      { reqKind: "report", panel: "reports", expected: "report-request" },
      { reqKind: "footnote", panel: "footnotes", expected: "footnote" },
    ];
    for (const c of cases) {
      const clearLinkedAiRequest = vi.fn();
      const vm = build(
        req({ kind: c.reqKind, linkedTo: { panel: c.panel, cardId: "cx" } }),
        { clearLinkedAiRequest },
      );
      vm.onCancel!();
      expect(clearLinkedAiRequest).toHaveBeenCalledExactlyOnceWith(c.expected, "cx");
      // The pure helper agrees with the routing baked into buildRequests.
      expect(linkedCardKindFrom(c.reqKind, c.panel)).toBe(c.expected);
    }
  });

  it("a linked row whose (kind, panel) pair resolves to nothing (corrupt link) falls back to the raw delete", () => {
    const clearLinkedAiRequest = vi.fn();
    const deletePanelAiRequest = vi.fn();
    // citation has no aiRequest routing → no (citation, notes) pair exists.
    const vm = build(
      req({ id: "weird-1", kind: "citation", linkedTo: { panel: "notes", cardId: "c9" } }),
      { clearLinkedAiRequest, deletePanelAiRequest },
    );
    vm.onCancel!();
    expect(deletePanelAiRequest).toHaveBeenCalledExactlyOnceWith("weird-1");
    expect(clearLinkedAiRequest).not.toHaveBeenCalled();
    expect(linkedCardKindFrom("citation", "notes")).toBeNull();
  });
});
