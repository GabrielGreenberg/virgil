/**
 * Card morph-transform registry entry point (A9 §D). Importing this module
 * registers every morphing kind's PURE data-salvage transform onto
 * `CARD_REGISTRY` via `registerCardMorph`, then runs the dev coverage
 * assertions. Mirrors `src/cards/floats/index.tsx`'s boot-registration pattern;
 * imported once at boot (EditorPane) so the converters are installed before any
 * kind-chevron fires.
 *
 * A transform is `(card) => convertedCard`: it flips the on-disk `kind`
 * discriminator and salvages the fields the target shape can hold, preserving
 * `id` / `createdAt` / `links` (anchors) so a popped-then-morphed card survives
 * (the float-key remap in `convertCardWithRemap` keeps its window). The per-doc
 * hook (`useRevisions.convertCard`, `useCutter.convertCard`,
 * `useReports.convertCard`, `useNotes.convertCard`) calls the registered
 * transform inside its own `update` so the right sidecar mutates.
 *
 * Kept OUT of `card-registry.tsx` (the card-data-free runtime leaf) — this
 * module imports `@/lib/types` + content helpers, which the registry must not.
 */
import { emptyRichContent, normalizeRichContent } from "@/lib/footnote-content";
import type { JSONContent } from "@tiptap/react";
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
import {
  registerCardMorph,
  assertMorphCoverage,
  assertPanelTypographyCoverage,
  assertContentCoverage,
} from "../card-registry";
import { assertMarkerCoverage } from "../marker-meta";
import { getTextAnchor } from "@/links/links";

/** Build a rich doc with one paragraph per non-empty part (or empty doc). Used
 *  by the suggestion → comment salvage so a suggestion's user_text AND its
 *  explanation both land in the free-form comment body — nothing dropped, the
 *  `lossy: false` declaration stays honest (task 199, the inbound twin of 074). */
function richFromParagraphs(parts: string[]): JSONContent {
  const nonEmpty = parts.filter(Boolean);
  return nonEmpty.length
    ? {
        type: "doc",
        content: nonEmpty.map((text) => ({
          type: "paragraph",
          content: [{ type: "text", text }],
        })),
      }
    : emptyRichContent();
}

/* ── Revisions: comment ⇄ suggestion ──────────────────────────────────
 * Extracted verbatim from the old inline `useRevisions.convertCard` salvage
 * (the revisions seed). Non-destructive both ways (lossy: false). */

function revisionRequestToSuggestion(c: RevisionRequestCard): RevisionSuggestionCard {
  return {
    kind: "suggestion",
    id: c.id,
    createdAt: c.createdAt,
    author: "human",
    original_text: c.selectedText ?? "",
    suggested_text: "",
    explanation: "",
    user_text: c.text,
    instructions: "",
    status: "pending",
    selectedText: c.selectedText,
    links: c.links,
  };
}

function revisionSuggestionToRequest(s: RevisionSuggestionCard): RevisionRequestCard {
  // Salvage BOTH the user's revision text and their Explanation into the
  // free-form comment body — a comment has no `explanation` field, so dropping
  // it silently was the 074 data-loss class one direction over (task 199). Each
  // non-empty part becomes its own paragraph; nothing is lost, so lossy stays
  // false. One-way like 074's flatten: morphing back won't re-split it.
  const parts = [s.user_text || s.suggested_text || "", s.explanation || ""];
  const bodyText = parts.filter(Boolean).join("\n\n");
  return {
    kind: "comment",
    id: s.id,
    createdAt: s.createdAt,
    text: bodyText,
    content: richFromParagraphs(parts),
    aiRequest: false,
    selectedText: s.selectedText ?? s.original_text ?? undefined,
    links: s.links,
  };
}

registerCardMorph("revision-comment", (card) =>
  revisionRequestToSuggestion(card as RevisionRequestCard),
);
registerCardMorph("revision-suggestion", (card) =>
  revisionSuggestionToRequest(card as RevisionSuggestionCard),
);

/* ── Cutter: comment ⇄ suggestion ─────────────────────────────────────
 * Symmetric with revisions (the cutter comment/suggestion shapes mirror the
 * revision ones). Non-destructive both ways (lossy: false). */

function cutterCommentToSuggestion(c: CutterCommentCard): CutterSuggestionCard {
  return {
    kind: "suggestion",
    id: c.id,
    createdAt: c.createdAt,
    author: "human",
    original_text: c.selectedText ?? "",
    suggested_text: "",
    explanation: "",
    user_text: c.text,
    instructions: "",
    status: "pending",
    selectedText: c.selectedText,
    links: c.links,
  };
}

function cutterSuggestionToComment(s: CutterSuggestionCard): CutterCommentCard {
  // Symmetric with the revision twin (task 199): fold the cut's Explanation
  // into the free-form comment body alongside the user text so neither is lost
  // and the morph's `lossy: false` stays honest.
  const parts = [s.user_text || s.suggested_text || "", s.explanation || ""];
  const bodyText = parts.filter(Boolean).join("\n\n");
  return {
    kind: "comment",
    id: s.id,
    createdAt: s.createdAt,
    text: bodyText,
    content: richFromParagraphs(parts),
    aiRequest: false,
    selectedText: s.selectedText ?? s.original_text ?? undefined,
    links: s.links,
  };
}

registerCardMorph("cutter-comment", (card) =>
  cutterCommentToSuggestion(card as CutterCommentCard),
);
registerCardMorph("cutter-suggestion", (card) =>
  cutterSuggestionToComment(card as CutterSuggestionCard),
);

/* ── Reports: report ⇄ report-request ─────────────────────────────────
 * The rich body (`content`/`text`) carries across; a report's title + author
 * byline drop (a request has no home for them) and a request's aiRequest flag
 * drops (a report has none) → lossy both ways. */

function reportToRequest(r: ReportCard): ReportRequestCard {
  return {
    kind: "report-request",
    id: r.id,
    createdAt: r.createdAt,
    text: r.text,
    content: normalizeRichContent(r.content),
    aiRequest: false,
    selectedText: r.selectedText,
    links: r.links,
  };
}

function requestToReport(q: ReportRequestCard): ReportCard {
  return {
    kind: "report",
    id: q.id,
    createdAt: q.createdAt,
    author: "human",
    title: "",
    text: q.text,
    content: normalizeRichContent(q.content),
    selectedText: q.selectedText,
    links: q.links,
  };
}

registerCardMorph("report", (card) => reportToRequest(card as ReportCard));
registerCardMorph("report-request", (card) =>
  requestToReport(card as ReportRequestCard),
);

/* ── Notes: note ⇄ highlight ──────────────────────────────────────────
 * note → highlight DISCARDS the rich note body + title (a highlight has no
 * body) → lossy; the text-range anchor in `links` rides across so the tint
 * survives. highlight → note starts the note with an EMPTY body — the
 * highlight's excerpt is a snapshot string, not editable rich body, so it is
 * NOT carried into the note body; the text-range anchor still rides across.
 * Only note → highlight is `lossy` (it drops the body + title); the confirm
 * fires on that flip alone (generated from `morph.drops`). highlight → note is
 * `lossy: false` / `drops: []` — nothing user-authored is lost — so it flips
 * silently, like comment⇄suggestion. (Symmetric `drops` on the highlight side
 * used to lie in the confirm — the REP-F6-03 direction-blind class.) */

function noteToHighlight(n: UserNote): HighlightCard {
  return {
    kind: "highlight",
    id: n.id,
    createdAt: n.createdAt,
    highlightColor: null,
    aiRequest: n.aiRequest,
    links: n.links,
    ...(n.originalAnchor ? { originalAnchor: n.originalAnchor } : {}),
  };
}

function highlightToNote(h: HighlightCard): UserNote {
  return {
    kind: "note",
    id: h.id,
    title: "",
    content: emptyRichContent(),
    createdAt: h.createdAt,
    aiRequest: h.aiRequest,
    links: h.links,
    ...(h.originalAnchor ? { originalAnchor: h.originalAnchor } : {}),
  };
}

registerCardMorph("note", (card) => noteToHighlight(card as UserNote));
registerCardMorph("highlight", (card) => highlightToNote(card as HighlightCard));

/** WS7 gate (A6): note → highlight is only offered for notes that carry a
 *  Mode-B text-range anchor. A highlight IS its text range — a
 *  paragraph-only Mode-A note (and an orphaned note, `links: []`) has no
 *  range to tint, so the morph would produce an invisible highlight.
 *  Consumer-owned predicate: the registry `morph` field stays static (the
 *  note⇄highlight pair is still declared and the converter registered);
 *  the chevron call sites gate on this — NoteCard's `kindOptions` (covers
 *  docked + omni, which render the same component) and the note float
 *  builder's `chromeSlots.title` CardKindHeader. The reverse direction
 *  (highlight → note) needs NO gate — every highlight has a range, and a
 *  note can always hold one. */
export function canMorphNoteToHighlight(note: UserNote): boolean {
  return getTextAnchor(note) != null;
}

// Boot-time coverage assertions (dev-only no-ops in production).
assertMorphCoverage();
assertPanelTypographyCoverage();
assertMarkerCoverage();
assertContentCoverage();

// The per-doc hooks import the morph-application helper from here.
export { applyCardMorph } from "./apply";
