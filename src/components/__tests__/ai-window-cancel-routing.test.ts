/**
 * AIWindow cancel routing (task 222) — the queue→card twin of the delete-leg
 * leak (task 219).
 *
 * A card's `aiRequest: true` flag and its OPEN row in `ai-requests.json` are one
 * coupling. Canceling a request from the AIWindow must respect BOTH faces:
 *
 *   - A **card-linked** row (`linkedTo` set — bridged from a note/todo/footnote/
 *     etc. with `aiRequest:true`) cancels through the card-flag-clearing path
 *     (`clearLinkedAiRequest(kind, cardId)`), which withdraws the queue row AND
 *     lowers the owning card's flag together (the inverse of checking the box).
 *     It must NOT hit the by-id `withdrawPanelAiRequest` — that ends the row
 *     and leaves the card's checkbox lit over a request the drain never serves.
 *   - An **unlinked** composer-created row (no `linkedTo`) keeps the by-id
 *     `withdrawPanelAiRequest(id)` path unchanged.
 *
 * Both legs now END the row the same way — CLOSED (`complete`/`"withdrawn"`),
 * never filtered out of the file (task 720). This suite pins the ROUTING; the
 * ending each door writes is pinned by `ai-request-bridge-idempotency.test.ts`
 * and `ai-requests-authority.test.ts`.
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
    withdrawPanelAiRequest?: (id: string) => void;
    clearLinkedAiRequest?: (kind: CardKind, cardId: string) => void;
    cardLinkResolves?: (kind: CardKind, cardId: string) => boolean;
  },
) {
  const vms = buildRequests({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests: [r],
    cancelBibReview: () => {},
    removeEntryRequest: () => {},
    withdrawPanelAiRequest: spies.withdrawPanelAiRequest ?? (() => {}),
    clearLinkedAiRequest: spies.clearLinkedAiRequest ?? (() => {}),
    // task 697 — default: the link resolves (today's behaviour).
    cardLinkResolves: spies.cardLinkResolves ?? (() => true),
  });
  return vms.find((v) => v.id === `panel:${r.id}`)!;
}

describe("AIWindow cancel routes card-linked requests through the both-faces clear (task 222)", () => {
  it("linked request → onCancel calls clearLinkedAiRequest(kind, cardId), NOT the raw delete", () => {
    const clearLinkedAiRequest = vi.fn();
    const withdrawPanelAiRequest = vi.fn();
    const vm = build(
      req({ kind: "todo", linkedTo: { panel: "todos", cardId: "card-1" } }),
      { clearLinkedAiRequest, withdrawPanelAiRequest },
    );
    expect(vm.onCancel).toBeTypeOf("function");
    vm.onCancel!();
    expect(clearLinkedAiRequest).toHaveBeenCalledExactlyOnceWith("todo", "card-1");
    expect(withdrawPanelAiRequest).not.toHaveBeenCalled();
  });

  // ── task 697: "is there a link?" was the wrong question ──────────────────
  it("a link that resolves to NO CARD falls back to the raw delete — the row still closes", () => {
    // The row is linked, so this took the card-linked path and died there: the
    // owning setter looked the card up in a render-time snapshot and gated the
    // whole bridge call on finding it, so Cancel removed no row, changed no
    // flag, raised no error — inoperative in exactly the state it exists for.
    // There is no card flag to lower here, so the honest retraction is the row
    // delete the UNLINKED branch already used.
    const clearLinkedAiRequest = vi.fn();
    const withdrawPanelAiRequest = vi.fn();
    const vm = build(
      req({ id: "stranded-1", kind: "todo", linkedTo: { panel: "todos", cardId: "gone" } }),
      { clearLinkedAiRequest, withdrawPanelAiRequest, cardLinkResolves: () => false },
    );
    expect(vm.onCancel).toBeTypeOf("function");
    vm.onCancel!();
    expect(withdrawPanelAiRequest).toHaveBeenCalledExactlyOnceWith("stranded-1");
    expect(clearLinkedAiRequest).not.toHaveBeenCalled();
  });

  it("the resolve probe is asked with the RESOLVED CardKind, not the wire kind", () => {
    // `cutter-comment` and `revision-comment` both ride the wire kind
    // "suggestion"; the probe has to be handed the pair-resolved kind or it
    // would ask the wrong panel whether the card is there.
    const cardLinkResolves = vi.fn(() => true);
    build(
      req({ kind: "suggestion", linkedTo: { panel: "cutter", cardId: "cx" } }),
      { cardLinkResolves },
    ).onCancel!();
    expect(cardLinkResolves).toHaveBeenCalledWith("cutter-comment", "cx");
  });

  it("unlinked composer request → onCancel keeps the raw withdrawPanelAiRequest(id) path", () => {
    const clearLinkedAiRequest = vi.fn();
    const withdrawPanelAiRequest = vi.fn();
    const vm = build(
      req({ id: "composer-1", kind: "note", linkedTo: undefined }),
      { clearLinkedAiRequest, withdrawPanelAiRequest },
    );
    expect(vm.onCancel).toBeTypeOf("function");
    vm.onCancel!();
    expect(withdrawPanelAiRequest).toHaveBeenCalledExactlyOnceWith("composer-1");
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
    const withdrawPanelAiRequest = vi.fn();
    // citation has no aiRequest routing → no (citation, notes) pair exists.
    const vm = build(
      req({ id: "weird-1", kind: "citation", linkedTo: { panel: "notes", cardId: "c9" } }),
      { clearLinkedAiRequest, withdrawPanelAiRequest },
    );
    vm.onCancel!();
    expect(withdrawPanelAiRequest).toHaveBeenCalledExactlyOnceWith("weird-1");
    expect(clearLinkedAiRequest).not.toHaveBeenCalled();
    expect(linkedCardKindFrom("citation", "notes")).toBeNull();
  });
});
