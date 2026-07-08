import { describe, it, expect, vi, beforeEach } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import {
  morphConfirmMessage,
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import { subscribeCardLifecycle, type CardLifecycleSignal } from "../lifecycle/card-lifecycle-signal";
// Importing the morphs barrel registers every converter onto CARD_REGISTRY +
// runs the boot assertions — so the converter↔drops pin below sees real transforms.
import { applyCardMorph } from "../morphs";
import type { ReportCard, ReportRequestCard, UserNote, HighlightCard } from "@/lib/types";

/**
 * T4 §3.2 — the morph confirm copy is GENERATED from `morph.drops`, so it can
 * never be direction-blind (REP-F6-03) or lie. These tests pin the generated
 * copy per direction + that `runCardLifecycleEvent` fires its obligations
 * (confirm → unbridge → mutate → signal) in the right order and only when the
 * declared contract says so.
 */

function captureSignals(): { signals: CardLifecycleSignal[]; stop: () => void } {
  const signals: CardLifecycleSignal[] = [];
  const stop = subscribeCardLifecycle((s) => signals.push(s));
  return { signals, stop };
}

function deps(over: Partial<CardLifecycleDeps> = {}): {
  d: CardLifecycleDeps;
  confirm: ReturnType<typeof vi.fn>;
  unbridge: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
} {
  const confirm = vi.fn(async () => true);
  const unbridge = vi.fn(async () => {});
  const mutate = vi.fn(() => {});
  return {
    d: { confirm, unbridgeAiRequest: unbridge, mutate, ...over },
    confirm,
    unbridge,
    mutate,
  };
}

describe("morphConfirmMessage — generated from drops, direction-correct", () => {
  it("report → report-request mentions the title + byline (NOT the body)", () => {
    const copy = morphConfirmMessage("report");
    expect(copy).not.toBeNull();
    expect(copy!.message).toContain("the title");
    expect(copy!.message).toContain("the author byline");
    // The body CARRIES across for this morph — the copy must not claim it drops.
    expect(copy!.message).not.toContain("the body");
    expect(copy!.title).toBe("Change to Report Request?");
  });

  it("report-request → report mentions the AI-request flag (the dropped field)", () => {
    const copy = morphConfirmMessage("report-request");
    expect(copy).not.toBeNull();
    // REP-F6-03: the reverse direction is NOT "title and byline" — that copy was
    // direction-blind. report-request → report drops the aiRequest flag.
    expect(copy!.message).toContain("the AI-request flag");
    expect(copy!.message).not.toContain("the title");
    expect(copy!.title).toBe("Change to Report?");
  });

  it("note → highlight mentions the body + title (that direction really drops them)", () => {
    const copy = morphConfirmMessage("note");
    expect(copy!.message).toContain("the body");
    expect(copy!.message).toContain("the title");
  });

  it("highlight → note needs NO confirm copy (REP-F6-03: a highlight has no body/title to drop)", () => {
    // The reverse direction is NOT "the body and the title" — that copy was
    // direction-blind (a mirror-copy of note.morph.drops). A highlight carries
    // no user content, so the morph is lossless → no confirm dialog at all.
    expect(morphConfirmMessage("highlight")).toBeNull();
  });

  it("comment → suggestion warns it drops the rich formatting (both pairs — 074)", () => {
    // The comment shape holds a rich `content` (citations, math, marks, multi-
    // paragraph); the suggestion shape has no home for it, so the outbound morph
    // flattens it to plain text. The declaration used to lie (`drops: []`) and
    // flip silently; now it names `formatting` so the generated confirm fires.
    for (const from of ["revision-comment", "cutter-comment"] as const) {
      const copy = morphConfirmMessage(from);
      expect(copy).not.toBeNull();
      expect(copy!.message).toContain("the rich formatting");
    }
  });

  it("suggestion → comment needs NO confirm copy (the reverse direction is genuinely lossless)", () => {
    // Only the comment side has a rich body; a suggestion → comment morph seeds
    // the body from the plain-text mirror and loses nothing user-authored, so it
    // stays silent (asymmetric drops — REP-F6-03 direction-correctness).
    expect(morphConfirmMessage("revision-suggestion")).toBeNull();
    expect(morphConfirmMessage("cutter-suggestion")).toBeNull();
  });
});

describe("runCardLifecycleEvent — morph", () => {
  let cap: ReturnType<typeof captureSignals>;
  beforeEach(() => {
    cap = captureSignals();
  });

  it("a lossy morph confirms, then mutates + publishes card-morphed", async () => {
    const { d, confirm, mutate } = deps();
    const ok = await runCardLifecycleEvent({ type: "morph", fromKind: "report", id: "r1" }, d);
    cap.stop();
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    expect(cap.signals).toEqual([
      { type: "card-morphed", fromKind: "report", toKind: "report-request", id: "r1" },
    ]);
  });

  it("a cancelled confirm aborts BEFORE mutate / signal", async () => {
    const { d, mutate } = deps({ confirm: vi.fn(async () => false) });
    const ok = await runCardLifecycleEvent({ type: "morph", fromKind: "report", id: "r1" }, d);
    cap.stop();
    expect(ok).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(cap.signals).toHaveLength(0);
  });

  it("a comment→suggestion morph now confirms the rich-body flatten, then mutates + signals (074)", async () => {
    const { d, confirm, mutate } = deps();
    const ok = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-comment", id: "c1" },
      d,
    );
    cap.stop();
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(mutate).toHaveBeenCalledOnce();
    expect(cap.signals).toEqual([
      { type: "card-morphed", fromKind: "revision-comment", toKind: "revision-suggestion", id: "c1" },
    ]);
  });

  it("the reverse suggestion→comment morph skips the confirm but still mutates + signals", async () => {
    const { d, confirm, mutate } = deps();
    const ok = await runCardLifecycleEvent(
      { type: "morph", fromKind: "revision-suggestion", id: "s1" },
      d,
    );
    cap.stop();
    expect(ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledOnce();
    expect(cap.signals).toEqual([
      { type: "card-morphed", fromKind: "revision-suggestion", toKind: "revision-comment", id: "s1" },
    ]);
  });
});

describe("converter ↔ drops pin (the real salvage drops exactly what drops names)", () => {
  it("report → report-request drops title + byline (author), keeps the body", () => {
    const report: ReportCard = {
      kind: "report",
      id: "r1",
      createdAt: "t",
      author: "ai",
      title: "Methodology",
      text: "body text",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body text" }] }] },
      links: [],
    };
    const out = applyCardMorph("report", report) as unknown as ReportRequestCard;
    expect(out.kind).toBe("report-request");
    // dropped: the report shape's title + author byline have no home on a request
    expect("title" in out).toBe(false);
    expect("author" in out).toBe(false);
    // kept: the body + its text mirror carry across (NOT in drops)
    expect(out.text).toBe("body text");
    expect(out.content).toBeTruthy();
    // the dropped set names exactly title + byline
    expect([...CARD_REGISTRY.report.morph!.drops].sort()).toEqual(["byline", "title"]);
  });

  it("report-request → report drops the aiRequest flag (clears it), keeps the body", () => {
    const request: ReportRequestCard = {
      kind: "report-request",
      id: "q1",
      createdAt: "t",
      text: "ask text",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ask text" }] }] },
      aiRequest: true,
      links: [],
    };
    const out = applyCardMorph("report-request", request) as unknown as ReportCard;
    expect(out.kind).toBe("report");
    // dropped: the request's aiRequest flag has no home on a report
    expect("aiRequest" in out).toBe(false);
    // kept: the body carries across
    expect(out.text).toBe("ask text");
    expect(CARD_REGISTRY["report-request"].morph!.drops).toEqual(["aiRequest"]);
  });

  it("note → highlight drops the body (content) + title, keeps id/anchor/aiRequest", () => {
    const note: UserNote = {
      kind: "note",
      id: "n1",
      title: "My title",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }] },
      createdAt: "t",
      aiRequest: true,
      links: [],
    };
    const out = applyCardMorph("note", note) as unknown as HighlightCard;
    expect(out.kind).toBe("highlight");
    // dropped: a highlight shape has no title / rich body field
    expect("title" in out).toBe(false);
    expect("content" in out).toBe(false);
    // kept: id, anchor links, aiRequest carry across (NOT in drops)
    expect(out.id).toBe("n1");
    expect(out.aiRequest).toBe(true);
    // the dropped set names exactly body + title (direction-correct)
    expect([...CARD_REGISTRY.note.morph!.drops].sort()).toEqual(["body", "title"]);
  });

  it("highlight → note drops NOTHING user-authored (drops: [], lossless) — no confirm", () => {
    // REP-F6-03: the symmetric `drops:["body","title"]` this pair used to carry
    // was direction-blind — a highlight has no body/title, so the converter
    // discards no user content. The pin below fails if `highlight.morph.drops`
    // regains a phantom field that the converter doesn't actually drop.
    const highlight: HighlightCard = {
      kind: "highlight",
      id: "h1",
      createdAt: "t",
      highlightColor: null,
      aiRequest: true,
      links: [],
    };
    const out = applyCardMorph("highlight", highlight) as unknown as UserNote;
    expect(out.kind).toBe("note");
    // the note is seeded EMPTY — no user content is fabricated, none is lost
    expect(out.title).toBe("");
    // kept: id, anchor links, aiRequest carry across
    expect(out.id).toBe("h1");
    expect(out.aiRequest).toBe(true);
    // the only field a highlight has that a note lacks is `highlightColor` (a
    // v1-always-null tint, NOT user content) — correctly not named in drops.
    expect(CARD_REGISTRY.highlight.morph!.drops).toEqual([]);
    // and therefore the generated confirm copy is null (nothing to warn about).
    expect(morphConfirmMessage("highlight")).toBeNull();
  });
});
