import { describe, it, expect } from "vitest";
import { CARD_REGISTRY } from "../card-registry";
import type { CardKind, MorphDropField } from "../types";
// Importing the morphs barrel registers every converter onto CARD_REGISTRY.
import { applyCardMorph } from "../morphs";
import type {
  RevisionRequestCard,
  RevisionSuggestionCard,
  CutterCommentCard,
  CutterSuggestionCard,
  ReportCard,
  ReportRequestCard,
  UserNote,
  HighlightCard,
} from "@/lib/types";
import type { Link } from "@/links/_shared/types";

/**
 * MORPH FIELD-ACCOUNTABILITY CENSUS (task 1472).
 *
 * A morph converter is a hand-enumerated literal, so a field the FROM shape
 * holds can vanish simply by not being named — `instructions` (the user's own
 * request a suggestion answered) did exactly that, under a confirm that said
 * only the byline drops. The per-pair hand pins (`morph-drops-confirm.test.ts`)
 * could not see it: their suggestion fixtures set `instructions: ""`.
 *
 * So the census is DERIVED on both axes:
 *  - the PAIRS — every `CARD_REGISTRY` kind that declares a `morph` must have a
 *    fixture here (and nothing else may);
 *  - the FIELDS — each fixture is `Required<RecordType>`, so tsc refuses it
 *    until EVERY field of the shape, optional ones included, holds a non-empty
 *    value. A field added to a card type is therefore a compile error here
 *    until someone decides its morph fate.
 *
 * Every non-`kind` field of the FROM fixture must then be ACCOUNTED FOR:
 *  - CARRIED   — the TO card holds the identical value under the same key;
 *  - SALVAGED  — its (unique sentinel) string appears in the TO card (e.g. a
 *                suggestion's explanation folded into the comment body);
 *  - DECLARED  — it belongs to a token in the row's `morph.drops`, so the
 *                generated confirm names it;
 *  - RE-DERIVABLE — the kind's content model calls it an `aiPrefilledFields`
 *                capture (recoverable from the document, never content);
 *  - or EXEMPT  — listed in `NOT_CONTENT` below with the reason it is not the
 *                user's to lose. Adding a row there is a reviewed decision.
 */

const LINK: Link = {
  id: "link-sentinel",
  kind: "anchor",
  anchor: {
    type: "textObject",
    targetKind: "linkedRange",
    textObjectIds: ["p-sentinel"],
    textRange: { anchorId: "a-sentinel", textSnapshot: "snapshot-sentinel" },
  },
  target: { type: "card", ref: { kind: "note", id: "card-sentinel" } },
  createdAt: "2026-01-01T00:00:00.000Z",
};

const richDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] }],
});

const ORIGINAL_ANCHOR = { paragraphId: "orig-pid-sentinel" } as unknown as NonNullable<
  UserNote["originalAnchor"]
>;

const envelope = {
  id: "id-sentinel",
  createdAt: "createdAt-sentinel",
  archived: true,
  archivedWith: "snippet-sentinel",
  links: [LINK],
};

const capture = {
  selectedText: "selectedText-sentinel",
  selectedContent: richDoc("selectedContent-sentinel"),
  selectedLatex: "selectedLatex-sentinel",
};

function comment<K extends "comment">(kind: K) {
  return {
    kind,
    ...envelope,
    ...capture,
    text: "comment-text-sentinel",
    content: richDoc("comment-text-sentinel"),
    aiRequest: true,
  };
}

function suggestion<K extends "suggestion">(kind: K) {
  return {
    kind,
    ...envelope,
    ...capture,
    author: "ai" as const,
    original_text: "original_text-sentinel",
    suggested_text: "suggested_text-sentinel",
    explanation: "explanation-sentinel",
    user_text: "user_text-sentinel",
    instructions: "instructions-sentinel",
    status: "pending" as const,
    aiOriginRequestId: "aiOriginRequestId-sentinel",
    appliedChange: {
      anchorId: "applied-anchor-sentinel",
      anchorUuid: "applied-uuid-sentinel",
      originalText: "applied-original-sentinel",
      replacement: "applied-replacement-sentinel",
      mode: "replace" as const,
      appliedAt: "applied-at-sentinel",
    },
  };
}

const revisionComment = comment("comment") satisfies Required<RevisionRequestCard>;
const cutterComment = comment("comment") satisfies Required<CutterCommentCard>;
const revisionSuggestion = suggestion("suggestion") satisfies Required<RevisionSuggestionCard>;
const cutterSuggestion = suggestion("suggestion") satisfies Required<CutterSuggestionCard>;

const report = {
  kind: "report",
  ...envelope,
  author: "ai",
  title: "title-sentinel",
  titleAuto: false,
  text: "report-text-sentinel",
  content: richDoc("report-text-sentinel"),
  selectedText: "selectedText-sentinel",
} satisfies Required<ReportCard>;

const reportRequest = {
  kind: "report-request",
  ...envelope,
  text: "request-text-sentinel",
  content: richDoc("request-text-sentinel"),
  aiRequest: true,
  selectedText: "selectedText-sentinel",
} satisfies Required<ReportRequestCard>;

const note = {
  kind: "note",
  ...envelope,
  title: "title-sentinel",
  titleAuto: false,
  content: richDoc("note-body-sentinel"),
  aiRequest: true,
  originalAnchor: ORIGINAL_ANCHOR,
} satisfies Required<UserNote>;

const highlight = {
  kind: "highlight",
  ...envelope,
  highlightColor: "highlightColor-sentinel",
  aiRequest: true,
  originalAnchor: ORIGINAL_ANCHOR,
} satisfies Required<HighlightCard>;

const FIXTURES: Partial<Record<CardKind, Record<string, unknown>>> = {
  "revision-comment": revisionComment,
  "cutter-comment": cutterComment,
  "revision-suggestion": revisionSuggestion,
  "cutter-suggestion": cutterSuggestion,
  report,
  "report-request": reportRequest,
  note,
  highlight,
};

/** Which record keys each drop token covers. Exhaustive on the union, so a new
 *  token is a compile error here until it states what it drops. `body` and
 *  `formatting` are the kind's declared rich `bodyField`. */
const DROP_FIELD_KEYS: Record<MorphDropField, (bodyField: string | null) => string[]> = {
  title: () => ["title", "titleAuto"],
  byline: () => ["author"],
  aiRequest: () => ["aiRequest"],
  body: (b) => (b ? [b] : []),
  formatting: (b) => (b ? [b] : []),
  keys: () => ["keys"],
};

/** Fields a morph may let go WITHOUT a confirm, each with the reason it is not
 *  the user's to lose. Keyed `fromKind.field`. */
const NOT_CONTENT: Record<string, string> = {
  // A suggestion's lifecycle machinery. The morph GATE (`canMorphSuggestion`)
  // admits only an OPEN suggestion, and an `applied` one is SETTLED by the
  // executor first (task 238), so neither the state nor the splice record
  // survives into a comment by design.
  "revision-suggestion.status": "lifecycle state; gated to open suggestions",
  "cutter-suggestion.status": "lifecycle state; gated to open suggestions",
  "revision-suggestion.appliedChange": "settled by the executor before the flip (task 238)",
  "cutter-suggestion.appliedChange": "settled by the executor before the flip (task 238)",
  // Provenance pointer to the AI request this card answered; that Task is
  // finalized when the suggestion is settled, and a comment answers nothing.
  "revision-suggestion.aiOriginRequestId": "provenance of an answered request, not content",
  "cutter-suggestion.aiOriginRequestId": "provenance of an answered request, not content",
  // v1 highlights are always tinted `null`; the tint is a view preference.
  "highlight.highlightColor": "view tint (v1 always null), not authored content",
};

function accountFor(fromKind: CardKind, from: Record<string, unknown>): string[] {
  const row = CARD_REGISTRY[fromKind];
  const out = applyCardMorph(fromKind, from) as Record<string, unknown>;
  const outJson = JSON.stringify(out);
  const bodyField = row.content?.bodyField ?? null;
  const declared = new Set(row.morph!.drops.flatMap((d) => DROP_FIELD_KEYS[d](bodyField)));
  const rederivable = new Set(row.content?.aiPrefilledFields ?? []);
  const unaccounted: string[] = [];
  for (const [key, value] of Object.entries(from)) {
    if (key === "kind") continue;
    if (key in out && JSON.stringify(out[key]) === JSON.stringify(value)) continue;
    if (typeof value === "string" && outJson.includes(value)) continue;
    if (declared.has(key)) continue;
    if (rederivable.has(key)) continue;
    if (`${fromKind}.${key}` in NOT_CONTENT) continue;
    unaccounted.push(key);
  }
  return unaccounted;
}

describe("morph field-accountability CENSUS (task 1472)", () => {
  it("every morphing kind has a fixture, and only morphing kinds do", () => {
    const morphing = (Object.keys(CARD_REGISTRY) as CardKind[])
      .filter((k) => CARD_REGISTRY[k].morph)
      .sort();
    expect(Object.keys(FIXTURES).sort()).toEqual(morphing);
  });

  for (const [kind, fixture] of Object.entries(FIXTURES)) {
    it(`${kind} → ${CARD_REGISTRY[kind as CardKind].morph!.to}: every field is carried, salvaged, or declared`, () => {
      expect(accountFor(kind as CardKind, fixture!)).toEqual([]);
    });
  }

  it("every NOT_CONTENT exemption names a real field of a morphing fixture", () => {
    for (const entry of Object.keys(NOT_CONTENT)) {
      const [kind, field] = entry.split(".");
      expect(FIXTURES[kind as CardKind], entry).toBeDefined();
      expect(field in FIXTURES[kind as CardKind]!, entry).toBe(true);
    }
  });

  it("a suggestion's instructions land in the comment body as their own labelled paragraph", () => {
    for (const kind of ["revision-suggestion", "cutter-suggestion"] as const) {
      const out = applyCardMorph(kind, FIXTURES[kind]!) as unknown as RevisionRequestCard;
      expect(out.text.split("\n\n")).toContain("Instructions: instructions-sentinel");
      const paras = (out.content as { content: { content: { text: string }[] }[] }).content.map(
        (p) => p.content[0].text,
      );
      expect(paras).toContain("Instructions: instructions-sentinel");
    }
  });

  it("a card archived WITH its text stays so across a morph", () => {
    for (const [kind, fixture] of Object.entries(FIXTURES)) {
      const out = applyCardMorph(kind as CardKind, fixture!) as { archivedWith?: string };
      expect(out.archivedWith, kind).toBe("snippet-sentinel");
    }
  });
});
