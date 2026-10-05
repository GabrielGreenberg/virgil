/**
 * Task 955 — a bridged AI-request row's `text` is a SNAPSHOT taken when the
 * bridge fired: the first committed fragment of a cutter / revision comment
 * or report request (whatever was typed before the first 250 ms pause), or a
 * note's title at the moment its AI box was ticked. No later edit rewrites it.
 *
 * The card is the SSOT for what the user asked, so the window's snippet reads
 * the RESOLVED card's current text — through the same per-kind context
 * function the bridge files with — and falls back to the row's stored text
 * only when the card is absent or unknowable.
 */
import { describe, expect, it, vi } from "vitest";

// The hook modules that own the per-kind context functions import the storage
// barrel; nothing here touches disk.
vi.mock("@/lib/storage", () => ({}));

import {
  buildRequests,
  LINKED_CARD_ABSENT,
  LINKED_CARD_UNKNOWN,
  type LinkedCardResolution,
} from "@/components/AIWindow";
import { cutterCommentContext } from "@/hooks/useCutter";
import { noteContext } from "@/hooks/useNotes";
import { reportRequestContext } from "@/hooks/useReports";
import type { CardKind } from "@/cards/types";
import type {
  AiRequest,
  CutterCommentCard,
  ReportRequestCard,
  UserNote,
} from "@/lib/types";

const FRAGMENT = "Is this";
const FULL = "Is this claim actually sourced?";

function row(overrides: Partial<AiRequest>): AiRequest {
  return {
    id: "r1",
    kind: "suggestion",
    text: FRAGMENT,
    createdAt: "2026-10-05T00:00:00.000Z",
    status: "pending",
    ...overrides,
  };
}

function snippetFor(
  r: AiRequest,
  resolveLinkedCard: (kind: CardKind, cardId: string) => LinkedCardResolution,
) {
  const vm = buildRequests({
    bibReviewRequests: [],
    bibEntryRequests: [],
    comments: [],
    panelAiRequests: [r],
    cancelBibReview: () => {},
    removeEntryRequest: () => {},
    withdrawPanelAiRequest: () => {},
    clearLinkedAiRequest: () => {},
    resolveLinkedCard,
  }).find((v) => v.id === `panel:${r.id}`)!;
  return { snippet: vm.snippet, hasUserText: vm.hasUserText };
}

describe("AIWindow: a bridged row shows the linked card's CURRENT text (task 955)", () => {
  it("cutter comment bridged on its first-commit fragment → the window reads the full current body", () => {
    const card = {
      kind: "comment",
      id: "c1",
      createdAt: "2026-10-05T00:00:00.000Z",
      text: FULL,
      links: [],
    } as unknown as CutterCommentCard;
    const asked: [CardKind, string][] = [];
    const { snippet } = snippetFor(
      row({ kind: "suggestion", linkedTo: { panel: "cutter", cardId: "c1" } }),
      (kind, cardId) => {
        asked.push([kind, cardId]);
        return { state: "present", text: cutterCommentContext(card).text };
      },
    );
    expect(asked).toContainEqual(["cutter-comment", "c1"]);
    expect(snippet).toBe(FULL);
  });

  it("report request edited after bridging → the window reads the edited text", () => {
    const card = {
      kind: "report-request",
      id: "rr1",
      createdAt: "2026-10-05T00:00:00.000Z",
      text: FULL,
      links: [],
    } as unknown as ReportRequestCard;
    const { snippet } = snippetFor(
      row({ kind: "report", linkedTo: { panel: "reports", cardId: "rr1" } }),
      () => ({ state: "present", text: reportRequestContext(card).text }),
    );
    expect(snippet).toBe(FULL);
  });

  it("note ticked for AI, then retitled → the window reads the new title", () => {
    const note = {
      id: "n1",
      title: "Check the dating of the Glossa Ordinaria",
      links: [],
    } as unknown as UserNote;
    const { snippet } = snippetFor(
      row({ kind: "note", text: "Check", linkedTo: { panel: "notes", cardId: "n1" } }),
      () => ({ state: "present", text: noteContext(note).text }),
    );
    expect(snippet).toBe("Check the dating of the Glossa Ordinaria");
  });

  it("card ABSENT (deleted) → falls back to the stored row text, no crash", () => {
    const { snippet, hasUserText } = snippetFor(
      row({ linkedTo: { panel: "cutter", cardId: "gone" } }),
      () => LINKED_CARD_ABSENT,
    );
    expect(snippet).toBe(FRAGMENT);
    expect(hasUserText).toBe(true);
  });

  it("card UNKNOWABLE (panel loading / read errored) → falls back to the stored row text", () => {
    const { snippet } = snippetFor(
      row({ linkedTo: { panel: "cutter", cardId: "c1" } }),
      () => LINKED_CARD_UNKNOWN,
    );
    expect(snippet).toBe(FRAGMENT);
  });

  it("card present but carrying no request text of its own (null) → the stored row text stands", () => {
    const { snippet } = snippetFor(
      row({ linkedTo: { panel: "cutter", cardId: "c1" } }),
      () => ({ state: "present", text: null }),
    );
    expect(snippet).toBe(FRAGMENT);
  });

  it("an UNLINKED composer row is not looked up — its own text is the request", () => {
    let asked = 0;
    const { snippet } = snippetFor(row({ kind: "note", text: "free-form ask" }), () => {
      asked++;
      return { state: "present", text: "WRONG" };
    });
    expect(asked).toBe(0);
    expect(snippet).toBe("free-form ask");
  });
});
