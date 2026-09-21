/**
 * The AI window's ONE request-state derivation (task 628).
 *
 * `buildRequests` folds four request families into one list, and "what state is
 * this request in?" is ONE question about all four. Three families derived their
 * answer from the underlying record; the **comment** branch stated it as the
 * literal `status: "open"`, alongside `turnCount: 0` — and every consequence
 * below followed from those two literals:
 *
 *   1. an answered comment thread never left the Open bucket;
 *   2. `"responded"` was emitted by NOTHING, so the bucket the type admits, the
 *      palette defines, the section renders and the header counts was
 *      structurally unreachable — `… · 0 responded · …`, forever;
 *   3. the turn badge (`turnCount > 1`) was unreachable from all four sites;
 *   4. a comment row carried no cancel affordance in any state;
 *   5. the dot's comment branch skipped the open-gate its siblings honour, so a
 *      pristine comment — `aiRequest: true` by default, discarded on click-away,
 *      never bridged — lit the Virgil-bar AI dot.
 *
 * And, found while fixing it and worse than any of the five: a revision comment
 * with `aiRequest: true` bridges an `ai-requests.json` row under
 * `(suggestion, revisions)`, which the PANEL branch also renders. So ONE
 * completed comment request appeared as TWO rows in the same window,
 * contradicting each other — "Open" from the comment branch's literal and
 * "Resolved" from the panel branch's derivation — and lit the dot.
 *
 * Every `it` below fails on the pre-fix shape unless marked as a control.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// AIWindow transitively pulls in `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha). The exports
// under test are pure and never touch it, so a stub keeps the graph loadable.
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import { buildRequests, aiRequestDotStatus } from "@/components/AIWindow";
import { requestState, isRequestOpen, isTerminalStatus } from "@/lib/ai-request-open";
import type {
  AiRequest,
  AiRequestStatus,
  BibEntryRequest,
  BibReviewRequest,
  RevisionCard,
  RevisionRequestCard,
} from "@/lib/types";
import type { CardKind } from "@/cards/types";

function comment(o: Partial<RevisionRequestCard> = {}): RevisionRequestCard {
  return {
    kind: "comment",
    id: "c1",
    createdAt: "2026-01-01T00:00:00.000Z",
    text: "please tighten this paragraph",
    content: {},
    aiRequest: true,
    links: [],
    ...o,
  };
}

/** The row `bridgeCardAiRequestFlag` writes for a flag-on revision comment:
 *  request kind `suggestion`, link panel `revisions` (the frozen R29 wire
 *  contract in `CARD_REGISTRY["revision-comment"].aiRequest`). */
function bridged(cardId: string, o: Partial<AiRequest> = {}): AiRequest {
  return {
    id: `req-${cardId}`,
    kind: "suggestion",
    text: "please tighten this paragraph",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "revisions", cardId },
    ...o,
  };
}

function panelReq(o: Partial<AiRequest> = {}): AiRequest {
  return {
    id: "p1",
    kind: "todo",
    text: "do the thing",
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "pending",
    linkedTo: { panel: "todos", cardId: "todo-card-1" },
    ...o,
  };
}

interface Spies {
  cancelBibReview?: (bibKey: string, type: "fields" | "notes") => void;
  removeEntryRequest?: (id: string) => void;
  deletePanelAiRequest?: (id: string) => void;
  clearLinkedAiRequest?: (kind: CardKind, cardId: string) => void;
  cardLinkResolves?: (kind: CardKind, cardId: string) => boolean;
}

function build(
  args: {
    bibReviewRequests?: BibReviewRequest[];
    bibEntryRequests?: BibEntryRequest[];
    comments?: RevisionCard[];
    panelAiRequests?: AiRequest[];
  },
  spies: Spies = {},
) {
  return buildRequests({
    bibReviewRequests: args.bibReviewRequests ?? [],
    bibEntryRequests: args.bibEntryRequests ?? [],
    comments: args.comments ?? [],
    panelAiRequests: args.panelAiRequests ?? [],
    cancelBibReview: spies.cancelBibReview ?? (() => {}),
    removeEntryRequest: spies.removeEntryRequest ?? (() => {}),
    deletePanelAiRequest: spies.deletePanelAiRequest ?? (() => {}),
    clearLinkedAiRequest: spies.clearLinkedAiRequest ?? (() => {}),
    // task 697 — default: the link resolves (today's behaviour). The suites
    // that exercise a STRANDED row pass `() => false` explicitly.
    cardLinkResolves: spies.cardLinkResolves ?? (() => true),
  });
}

function dot(args: {
  bibReviewRequests?: BibReviewRequest[];
  bibEntryRequests?: BibEntryRequest[];
  comments?: RevisionCard[];
  panelAiRequests?: AiRequest[];
}) {
  return aiRequestDotStatus({
    bibReviewRequests: args.bibReviewRequests ?? [],
    bibEntryRequests: args.bibEntryRequests ?? [],
    comments: args.comments ?? [],
    panelAiRequests: args.panelAiRequests ?? [],
  });
}

/* ── (a) the comment branch derives its state ──────────────────────── */

describe("a comment's state is its BRIDGED row's state, not a literal", () => {
  it("pending bridged row → Open", () => {
    const rows = build({ comments: [comment()], panelAiRequests: [bridged("c1")] });
    expect(rows.map((r) => r.status)).toEqual(["open"]);
  });

  it("complete bridged row → Resolved (an answered thread LEAVES Open)", () => {
    const rows = build({
      comments: [comment()],
      panelAiRequests: [bridged("c1", { status: "complete" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("resolved");
  });

  it("failed bridged row → Resolved (the other terminal status)", () => {
    const rows = build({
      comments: [comment()],
      panelAiRequests: [bridged("c1", { status: "failed" })],
    });
    expect(rows[0].status).toBe("resolved");
  });

  it("answered-L3 bridged row (in-progress + resultId) → RESPONDED", () => {
    // The state the whole Responded bucket exists for: Claude's proposal card is
    // on the page and the USER owes accept/reject. The comment branch could not
    // reach it, and neither could the panel branch, which folded it onto
    // "resolved".
    const rows = build({
      comments: [comment()],
      panelAiRequests: [bridged("c1", { status: "in-progress", resultId: "sug-1" })],
    });
    expect(rows[0].status).toBe("responded");
  });

  it("in-progress WITHOUT resultId (skill mid-flight) is still Open", () => {
    const rows = build({
      comments: [comment()],
      panelAiRequests: [bridged("c1", { status: "in-progress" })],
    });
    expect(rows[0].status).toBe("open");
  });

  it("a legacy flag-on comment with NO bridged row is Open (unserved), not silently dropped", () => {
    const rows = build({ comments: [comment()] });
    expect(rows.map((r) => r.status)).toEqual(["open"]);
  });

  it("prefers the OPEN row when a card carries two non-terminal rows (task 043)", () => {
    // An answered-L3 row plus a fresh re-toggled `pending` row can coexist on one
    // card. The live request is the open one, in either array order.
    const answered = bridged("c1", { id: "old", status: "in-progress", resultId: "sug-1" });
    const fresh = bridged("c1", { id: "new", status: "pending" });
    expect(build({ comments: [comment()], panelAiRequests: [answered, fresh] })[0].status)
      .toBe("open");
    expect(build({ comments: [comment()], panelAiRequests: [fresh, answered] })[0].status)
      .toBe("open");
  });
});

/* ── (b) "responded" is EMITTED, so the bucket can fill ─────────────── */

describe('"responded" is reachable — the bucket is no longer a lie in the chrome', () => {
  it("a panel request reaches it too (not a comment-only state)", () => {
    const rows = build({
      panelAiRequests: [panelReq({ status: "in-progress", resultId: "proposal-1" })],
    });
    expect(rows[0].status).toBe("responded");
  });

  it("all three buckets are simultaneously non-empty over one realistic queue", () => {
    const rows = build({
      comments: [comment({ id: "c1" }), comment({ id: "c2" }), comment({ id: "c3" })],
      panelAiRequests: [
        bridged("c1", { status: "pending" }),
        bridged("c2", { status: "in-progress", resultId: "sug-2" }),
        bridged("c3", { status: "complete" }),
      ],
    });
    expect(rows.map((r) => r.status).sort()).toEqual(["open", "resolved", "responded"]);
  });

  it("the two bib families are two-state, so they never claim 'responded'", () => {
    // Stated, not smuggled: `BibReviewRequest.status` / `BibEntryRequest.status`
    // are `"pending" | "complete"`, so the middle state is genuinely unreachable
    // there. (Control — true before the fix as well.)
    for (const status of ["pending", "complete"] as const) {
      const rows = build({
        bibReviewRequests: [
          { bibKey: "smith2020", type: "fields", requestedAt: "2026-01-01T00:00:00.000Z", status },
        ],
        bibEntryRequests: [
          { id: "e1", description: "a paper on X", status, createdAt: "2026-01-01T00:00:00.000Z" },
        ],
      });
      expect(rows.map((r) => r.status)).toEqual(
        status === "complete" ? ["resolved", "resolved"] : ["open", "open"],
      );
    }
  });
});

/* ── (c) no duplicate row for one request ───────────────────────────── */

describe("one request is ONE row (the bridged comment is not rendered twice)", () => {
  it("a bridged comment yields exactly one row, from the comment branch", () => {
    const rows = build({ comments: [comment()], panelAiRequests: [bridged("c1")] });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("genrev:c1");
    // The comment branch wins because it knows the card: revision chip, not the
    // panel branch's coarse "suggestion".
    expect(rows[0].kind).toBe("revision-general");
  });

  it("the two branches can no longer contradict each other", () => {
    // The pre-fix shape returned [{genrev:c1, open}, {panel:…, resolved}] — one
    // request, two rows, two different answers, side by side.
    const rows = build({
      comments: [comment()],
      panelAiRequests: [bridged("c1", { status: "complete" })],
    });
    expect(new Set(rows.map((r) => r.status)).size).toBe(1);
  });

  it("an anchored comment keeps its own id/kind and its snippet", () => {
    const rows = build({
      comments: [comment({ selectedText: "the passage in question" })],
      panelAiRequests: [bridged("c1")],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("txtrev:c1");
    expect(rows[0].kind).toBe("revision-text");
    expect(rows[0].snippet).toContain("the passage in question");
  });

  it("a CUTTER comment's row is NOT deduped away (different family, same request kind)", () => {
    // `(suggestion, cutter)` resolves to `cutter-comment`, whose cards never
    // reach `args.comments` — so its panel row is the only view of it and must
    // survive. Guards the dedup against keying on the request kind alone.
    const rows = build({
      comments: [comment()],
      panelAiRequests: [
        bridged("c1"),
        { ...bridged("cut-1"), id: "cutreq", linkedTo: { panel: "cutter", cardId: "cut-1" } },
      ],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["genrev:c1", "panel:cutreq"]);
  });

  it("a comment the branch DECLINES keeps its panel row (nothing goes missing)", () => {
    // An emptied-out body over a live bridged row: the comment branch declines it
    // (no question to serve), so the row stays visible via the panel branch —
    // the dedup keys on what the comment branch actually EMITTED.
    const rows = build({
      comments: [comment({ text: "   " })],
      panelAiRequests: [bridged("c1")],
    });
    expect(rows.map((r) => r.id)).toEqual(["panel:req-c1"]);
  });
});

/* ── (d) the comment row can be retracted ──────────────────────────── */

describe("a comment row carries a cancel affordance, routed like its siblings", () => {
  it("open → onCancel clears BOTH faces via clearLinkedAiRequest('revision-comment', cardId)", () => {
    // task 222's coupling: a comment IS a card-linked request, so retracting it
    // must lower the card's `aiRequest` flag too, not just drop the queue row.
    const clearLinkedAiRequest = vi.fn();
    const deletePanelAiRequest = vi.fn();
    const rows = build(
      { comments: [comment()], panelAiRequests: [bridged("c1")] },
      { clearLinkedAiRequest, deletePanelAiRequest },
    );
    expect(rows[0].onCancel).toBeTypeOf("function");
    rows[0].onCancel!();
    expect(clearLinkedAiRequest).toHaveBeenCalledExactlyOnceWith("revision-comment", "c1");
    expect(deletePanelAiRequest).not.toHaveBeenCalled();
  });

  it("responded and resolved rows expose NO cancel — the ONE rule, every family", () => {
    const cases: Array<{ row: AiRequest | null; expect: "open" | "responded" | "resolved" }> = [
      { row: bridged("c1", { status: "pending" }), expect: "open" },
      { row: bridged("c1", { status: "in-progress", resultId: "s" }), expect: "responded" },
      { row: bridged("c1", { status: "complete" }), expect: "resolved" },
    ];
    for (const c of cases) {
      const rows = build({ comments: [comment()], panelAiRequests: c.row ? [c.row] : [] });
      expect(rows[0].status).toBe(c.expect);
      expect(typeof rows[0].onCancel).toBe(c.expect === "open" ? "function" : "undefined");
    }
  });

  it("every family agrees: cancel exists iff the row is open", () => {
    const openRows = build({
      bibReviewRequests: [
        { bibKey: "k", type: "notes", requestedAt: "2026-01-01T00:00:00.000Z", status: "pending" },
      ],
      bibEntryRequests: [
        { id: "e1", description: "d", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      comments: [comment()],
      panelAiRequests: [bridged("c1"), panelReq()],
    });
    expect(openRows).toHaveLength(4);
    for (const r of openRows) {
      expect(r.status).toBe("open");
      expect(r.onCancel).toBeTypeOf("function");
    }
    const closedRows = build({
      bibReviewRequests: [
        { bibKey: "k", type: "notes", requestedAt: "2026-01-01T00:00:00.000Z", status: "complete" },
      ],
      bibEntryRequests: [
        { id: "e1", description: "d", status: "complete", createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      comments: [comment()],
      panelAiRequests: [
        bridged("c1", { status: "complete" }),
        panelReq({ status: "in-progress", resultId: "s" }),
      ],
    });
    expect(closedRows).toHaveLength(4);
    for (const r of closedRows) {
      expect(r.status).not.toBe("open");
      expect(r.onCancel).toBeUndefined();
    }
  });
});

/* ── (e) the dot honours the same predicate ────────────────────────── */

describe("the dot and the buckets are two readers of ONE derivation", () => {
  it("a PRISTINE comment (aiRequest by default, empty, never bridged) does NOT light it", () => {
    // Clicking "add comment" in the Revisions panel and clicking away used to
    // light the Virgil-bar dot for a card about to be discarded.
    expect(dot({ comments: [comment({ text: "" })] })).toBeNull();
    expect(dot({ comments: [comment({ text: "   \n " })] })).toBeNull();
    // …and it is not in the window either, so the two agree.
    expect(build({ comments: [comment({ text: "" })] })).toEqual([]);
  });

  it("a comment whose thread is ANSWERED does not light it", () => {
    for (const status of ["complete", "failed"] as const) {
      expect(dot({ comments: [comment()], panelAiRequests: [bridged("c1", { status })] }))
        .toBeNull();
    }
    expect(
      dot({
        comments: [comment()],
        panelAiRequests: [bridged("c1", { status: "in-progress", resultId: "s" })],
      }),
    ).toBeNull();
  });

  it("a real open comment request still lights it", () => {
    expect(dot({ comments: [comment()], panelAiRequests: [bridged("c1")] })).toBe("warn");
    expect(dot({ comments: [comment()] })).toBe("warn");
  });

  it("a comment with aiRequest: false never lights it (control)", () => {
    expect(dot({ comments: [comment({ aiRequest: false })] })).toBeNull();
  });

  it("a pending style-merge RENDERS, and lights the dot with it (task 682)", () => {
    // The 628 contract was "the dot must not say something is waiting over a
    // window with nothing in it", and it was satisfied the cheap way: both
    // surfaces skipped `style-merge`. But the row was real — a status, a
    // payload, and a user who filed it from the Style dropdown — so the skip
    // made it invisible AND uncancellable, a request with no surface anywhere.
    // 682 satisfies the same contract from the other side: the window renders
    // it (with its own chip and a working cancel), so the dot says so.
    const sm = panelReq({ id: "sm1", kind: "style-merge", linkedTo: undefined });
    const rows = build({ panelAiRequests: [sm] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("panel-style-merge");
    expect(rows[0].status).toBe("open");
    expect(rows[0].onCancel).toBeTypeOf("function");
    expect(dot({ panelAiRequests: [sm] })).toBe("warn");
  });

  it("a COMPLETE style-merge resolves like any other row and lights nothing", () => {
    const sm = panelReq({
      id: "sm2",
      kind: "style-merge",
      status: "complete",
      linkedTo: undefined,
    });
    expect(build({ panelAiRequests: [sm] })[0].status).toBe("resolved");
    expect(dot({ panelAiRequests: [sm] })).toBeNull();
  });

  it("the dot lights iff SOME row in the window is open — over a mixed queue", () => {
    const mixed = {
      bibReviewRequests: [
        { bibKey: "k", type: "fields" as const, requestedAt: "2026-01-01T00:00:00.000Z", status: "complete" as const },
      ],
      bibEntryRequests: [
        { id: "e1", description: "d", status: "complete" as const, createdAt: "2026-01-01T00:00:00.000Z" },
      ],
      comments: [comment(), comment({ id: "c2", text: "" })],
      panelAiRequests: [
        bridged("c1", { status: "complete" }),
        panelReq({ status: "in-progress", resultId: "s" }),
      ],
    };
    const rows = build(mixed);
    expect(rows.some((r) => r.status === "open")).toBe(false);
    expect(dot(mixed)).toBeNull();
    // Flip exactly one row open and both surfaces move together.
    const opened = { ...mixed, panelAiRequests: [bridged("c1", { status: "pending" }), mixed.panelAiRequests[1]] };
    expect(build(opened).some((r) => r.status === "open")).toBe(true);
    expect(dot(opened)).toBe("warn");
  });
});

/* ── (f) the anti-literal teeth: no arm may be a constant ──────────── */

describe("requestState splits the closed side without adding a rule of its own", () => {
  const STATUSES: AiRequestStatus[] = ["draft", "submitted", "pending", "in-progress", "complete", "failed"];

  it("is exactly isRequestOpen + isTerminalStatus, over the whole matrix", () => {
    for (const status of STATUSES) {
      for (const resultId of [undefined, "", "card-x"]) {
        const r = { status, resultId };
        const state = requestState(r);
        expect(state === "open").toBe(isRequestOpen(r));
        if (state !== "open") {
          expect(state).toBe(isTerminalStatus(status) ? "resolved" : "responded");
        }
      }
    }
  });

  it("every one of the three states is reachable (no dead arm)", () => {
    expect(new Set(STATUSES.flatMap((status) =>
      [undefined, "card-x"].map((resultId) => requestState({ status, resultId })),
    ))).toEqual(new Set(["open", "responded", "resolved"]));
  });
});

describe("no family answers with a literal (the bug class)", () => {
  it("each family's state moves when its record's state moves", () => {
    // The teeth: a literal arm answers the same for two records that differ in
    // state. Pre-fix, the comment arm did exactly that.
    const legs: Array<{
      family: string;
      open: Parameters<typeof build>[0];
      closed: Parameters<typeof build>[0];
    }> = [
      {
        family: "bib-review",
        open: { bibReviewRequests: [{ bibKey: "k", type: "fields", requestedAt: "2026-01-01T00:00:00.000Z", status: "pending" }] },
        closed: { bibReviewRequests: [{ bibKey: "k", type: "fields", requestedAt: "2026-01-01T00:00:00.000Z", status: "complete" }] },
      },
      {
        family: "bib-entry",
        open: { bibEntryRequests: [{ id: "e", description: "d", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }] },
        closed: { bibEntryRequests: [{ id: "e", description: "d", status: "complete", createdAt: "2026-01-01T00:00:00.000Z" }] },
      },
      {
        family: "revision-comment",
        open: { comments: [comment()], panelAiRequests: [bridged("c1", { status: "pending" })] },
        closed: { comments: [comment()], panelAiRequests: [bridged("c1", { status: "complete" })] },
      },
      {
        family: "panel",
        open: { panelAiRequests: [panelReq({ status: "pending" })] },
        closed: { panelAiRequests: [panelReq({ status: "complete" })] },
      },
    ];
    for (const leg of legs) {
      const openRows = build(leg.open);
      const closedRows = build(leg.closed);
      expect(openRows, leg.family).toHaveLength(1);
      expect(closedRows, leg.family).toHaveLength(1);
      expect(openRows[0].status, leg.family).toBe("open");
      expect(closedRows[0].status, leg.family).not.toBe("open");
    }
  });

  it("the retired turn badge is gone from the view model, not set to a literal", () => {
    // `turnCount` was `0` at all four push sites under a `> 1` badge. The
    // per-card `turns[]` model it was written for is retired —
    // `migrateRequestRecord` drops the legacy array on read — so the field is
    // DELETED rather than left as chrome nothing can fill.
    const rows = build({
      comments: [comment()],
      panelAiRequests: [panelReq()],
      bibEntryRequests: [{ id: "e", description: "d", status: "pending", createdAt: "2026-01-01T00:00:00.000Z" }],
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).not.toHaveProperty("turnCount");
  });
});
