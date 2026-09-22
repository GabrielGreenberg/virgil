/**
 * Task 701 — a note ⇄ highlight morph CARRIES the aiRequest flag (both kinds
 * are routed), so the open inbox row rides across. It used to ride across
 * STALE: `kind` still named the old kind and `text` was built from content the
 * morph discarded (the note's title/body), so the responder answered a request
 * about a card the user could no longer see. A morph is now a RE-DERIVE of the
 * row (`rederiveAiRequestForMorph`), sharing one row-refresh with the re-tick
 * branch of `bridgeCardAiRequestFlag` — which now refreshes `kind` too, so a
 * row already left stale on disk self-heals on the next tick.
 *
 * Also pins the converters' title provenance: a morph INTO a titled kind with a
 * blank machine-default title stamps `titleAuto: true`, as the "+" door does.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AiRequest, AiRequestsState } from "@/lib/types";

const seeded: { state: AiRequestsState } = { state: { requests: [] } };
const written: AiRequestsState[] = [];
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => seeded.state),
  writeSidecar: vi.fn(async () => {}),
  mutateSidecar: vi.fn(
    async (
      _h: unknown,
      _file: string,
      _d: unknown,
      mutate: (current: AiRequestsState) => AiRequestsState | null,
    ) => {
      const next = mutate(seeded.state);
      if (next === null) return null;
      seeded.state = next;
      written.push(next);
      return next;
    },
  ),
}));
vi.mock("@/lib/multi-window/doc-pipeline", () => ({
  getActiveHandle: vi.fn(() => ({})),
  isStalePipelineError: vi.fn(() => false),
}));

import {
  bridgeCardAiRequestFlag,
  rederiveAiRequestForMorph,
} from "@/lib/ai-request-bridge";
import { CARD_REGISTRY, morphCarriesAiRequest } from "@/cards/card-registry";
import { applyCardMorph } from "@/cards/morphs";
import type { CardKind } from "@/cards/types";

function row(overrides: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "req-1",
    kind: "note",
    text: "My note title",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "notes", cardId: "c1" },
    paragraphIds: ["p-old"],
    selectedText: "old selection",
    ...overrides,
  };
}

beforeEach(() => {
  seeded.state = { requests: [] };
  written.length = 0;
});

describe("rederiveAiRequestForMorph (task 701)", () => {
  it("note → highlight: the open row now names the highlight and its passage", async () => {
    seeded.state = { requests: [row()] };
    await rederiveAiRequestForMorph("doc", "note", "highlight", "c1", {
      text: "the tinted passage",
      paragraphIds: ["p-1"],
      selectedText: "the tinted passage",
    });
    const [r] = seeded.state.requests;
    expect(r).toMatchObject({
      id: "req-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      status: "pending",
      kind: "highlight",
      linkedTo: { panel: "notes", cardId: "c1" },
      text: "the tinted passage",
      paragraphIds: ["p-1"],
      selectedText: "the tinted passage",
    });
    expect(seeded.state.requests).toHaveLength(1);
  });

  it("highlight → note: the open row now names the note", async () => {
    seeded.state = {
      requests: [row({ kind: "highlight", text: "the tinted passage" })],
    };
    await rederiveAiRequestForMorph("doc", "highlight", "note", "c1", {
      text: "<note>",
      paragraphIds: ["p-1"],
      selectedText: "the tinted passage",
    });
    expect(seeded.state.requests[0]).toMatchObject({
      kind: "note",
      text: "<note>",
      paragraphIds: ["p-1"],
    });
  });

  it("leaves answered / terminal rows as filed, and other cards' rows alone", async () => {
    const answered = row({ id: "ans", status: "in-progress", resultId: "r-9" });
    const done = row({ id: "done", status: "complete" });
    const other = row({ id: "other", linkedTo: { panel: "notes", cardId: "c2" } });
    seeded.state = { requests: [answered, done, other] };
    await rederiveAiRequestForMorph("doc", "note", "highlight", "c1", {
      text: "x",
    });
    expect(written).toHaveLength(0);
    expect(seeded.state.requests).toEqual([answered, done, other]);
  });

  it("re-tick refreshes the row's kind too — a stale row self-heals", async () => {
    seeded.state = { requests: [row({ kind: "note" })] };
    await bridgeCardAiRequestFlag(
      "doc",
      "highlight",
      "c1",
      true,
      { text: "passage", selectedText: "passage" },
      "toggle",
    );
    expect(seeded.state.requests).toHaveLength(1);
    expect(seeded.state.requests[0]).toMatchObject({
      id: "req-1",
      kind: "highlight",
      text: "passage",
    });
  });
});

describe("morphCarriesAiRequest — the carry/drop split is registry-derived", () => {
  it("is true exactly for morphs between two routed kinds (today note ⇄ highlight)", () => {
    const carriers = (Object.keys(CARD_REGISTRY) as CardKind[]).filter(
      morphCarriesAiRequest,
    );
    expect(carriers.sort()).toEqual(["highlight", "note"]);
    // A carrier never also declares the drop (the executor would unbridge it).
    for (const k of carriers) {
      expect(CARD_REGISTRY[k].morph!.drops).not.toContain("aiRequest");
    }
  });
});

describe("morph converters stamp machine-default title provenance", () => {
  it("highlight → note carries titleAuto: true with its blank title", () => {
    const note = applyCardMorph("highlight", {
      kind: "highlight",
      id: "h1",
      createdAt: "2026-01-01T00:00:00.000Z",
      highlightColor: null,
      aiRequest: true,
      links: [],
    }) as unknown as { kind: string; title: string; titleAuto?: boolean; aiRequest: boolean };
    expect(note).toMatchObject({ kind: "note", title: "", titleAuto: true, aiRequest: true });
  });

  it("report-request → report carries titleAuto: true with its blank title", () => {
    const report = applyCardMorph("report-request", {
      kind: "report-request",
      id: "q1",
      createdAt: "2026-01-01T00:00:00.000Z",
      text: "look into this",
      content: null,
      aiRequest: false,
      links: [],
    }) as unknown as { kind: string; title: string; titleAuto?: boolean };
    expect(report).toMatchObject({ kind: "report", title: "", titleAuto: true });
  });
});
