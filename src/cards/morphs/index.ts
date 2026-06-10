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
  RevisionCommentCard,
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
} from "../card-registry";
import { assertMarkerCoverage } from "../marker-meta";
import { getTextAnchor } from "@/links/links";

/** Wrap a plain string into a single-paragraph rich doc (or empty doc). */
function richFromText(text: string): JSONContent {
  return text
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
    : emptyRichContent();
}

/* ── Revisions: comment ⇄ suggestion ──────────────────────────────────
 * Extracted verbatim from the old inline `useRevisions.convertCard` salvage
 * (the revisions seed). Non-destructive both ways (lossy: false). */

function revisionCommentToSuggestion(c: RevisionCommentCard): RevisionSuggestionCard {
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

function revisionSuggestionToComment(s: RevisionSuggestionCard): RevisionCommentCard {
  const bodyText = s.user_text || s.suggested_text || "";
  return {
    kind: "comment",
    id: s.id,
    createdAt: s.createdAt,
    text: bodyText,
    content: richFromText(bodyText),
    aiRequest: false,
    selectedText: s.selectedText ?? s.original_text ?? undefined,
    links: s.links,
  };
}

registerCardMorph("revision-comment", (card) =>
  revisionCommentToSuggestion(card as RevisionCommentCard),
);
registerCardMorph("revision-suggestion", (card) =>
  revisionSuggestionToComment(card as RevisionSuggestionCard),
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
  const bodyText = s.user_text || s.suggested_text || "";
  return {
    kind: "comment",
    id: s.id,
    createdAt: s.createdAt,
    text: bodyText,
    content: richFromText(bodyText),
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
 * Both directions are marked `lossy` in the registry, so the confirm fires
 * on either flip (driven by `morph.lossy` at the call site). */

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

// The per-doc hooks import the morph-application helper from here.
export { applyCardMorph } from "./apply";
