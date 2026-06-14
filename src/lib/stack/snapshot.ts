/**
 * Snapshot helpers for the Stack — pure functions that turn a live
 * editor / card record into a serialized `StackItem` payload, ready to
 * persist in localStorage.
 *
 * Every snapshot is a deep copy with no live binding to its source.
 * Cross-doc-bound decorations (linkedAnchor marks, citation-id refs)
 * are stripped at snapshot time so a Stack item dropped into a
 * different doc doesn't carry orphaned references.
 */

import type { Editor, JSONContent } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { getSectionRangeByUuid } from "@/lib/section-range";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  ExampleRef,
  FootnoteRef,
  HighlightCard,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";
import type {
  StackCardKind,
  StackCardSnapshot,
  StackItem,
  StackPayload,
} from "./types";

// ── Mark stripping ────────────────────────────────────────────────────
/** Marks that bind a node to data outside the snapshot — must not
 *  follow the snapshot to a different doc (or even back into the same
 *  doc via paste-as-new, since the new id will collide). */
const CROSS_DOC_MARK_TYPES = new Set<string>([
  "linkedAnchor",
  "footnoteRef",
  "citationRef",
]);

function stripCrossDocMarks(json: JSONContent): JSONContent {
  if (!json || typeof json !== "object") return json;
  const cleaned: JSONContent = { ...json };
  if (Array.isArray(json.marks)) {
    cleaned.marks = json.marks.filter(
      (m) => !CROSS_DOC_MARK_TYPES.has(m.type),
    );
    if (cleaned.marks.length === 0) delete cleaned.marks;
  }
  if (Array.isArray(json.content)) {
    cleaned.content = json.content.map(stripCrossDocMarks);
  }
  return cleaned;
}

/** Drop the `uuid` attr (and any other anchor-only attrs) from a node
 *  recursively. Pull regenerates a fresh uuid so the new copy doesn't
 *  collide with the source. */
function stripUuids(json: JSONContent): JSONContent {
  if (!json || typeof json !== "object") return json;
  const next: JSONContent = { ...json };
  if (next.attrs && typeof next.attrs === "object") {
    const attrs = { ...(next.attrs as Record<string, unknown>) };
    if ("uuid" in attrs) delete attrs.uuid;
    next.attrs = attrs;
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(stripUuids);
  }
  return next;
}

function deepClone<T>(v: T): T {
  // structuredClone exists in all modern browsers + Node 17+.
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

function makeStackId(): string {
  return generateEntityId();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Selection / text snapshot ─────────────────────────────────────────
/**
 * Capture the current text selection as a snapshot. Uses
 * `editor.state.doc.slice(from, to)` so we get a real ProseMirror Slice
 * with open depths preserved — `tr.replace` on the destination side
 * does the merging math.
 */
export function snapshotSelection(
  editor: Editor,
  source: { docId: string | null; docTitle?: string },
): StackItem | null {
  const { from, to } = editor.state.selection;
  if (to <= from) return null;
  const slice = editor.state.doc.slice(from, to);
  if (slice.size === 0) return null;
  const sliceJson = slice.toJSON();
  // sliceJson can be undefined for an empty slice; guard belt-and-suspenders.
  if (!sliceJson) return null;
  // Strip cross-doc marks recursively. Slice JSON shape is
  // { content: [...], openStart, openEnd } — content nodes are JSON.
  const cleanedSlice: Record<string, unknown> = {
    ...(sliceJson as Record<string, unknown>),
  };
  if (Array.isArray((cleanedSlice as { content?: JSONContent[] }).content)) {
    cleanedSlice.content = (
      (cleanedSlice as { content: JSONContent[] }).content
    ).map(stripCrossDocMarks);
  }
  // `plain` is a DISPLAY LABEL only. An atom-only selection (a citation pill /
  // `$\lambda$` / `\ref` captured alone) has no `textContent` → `plain === ""`,
  // but it carries real content (the slice already passed the authoritative
  // emptiness guard at `slice.size === 0` above). Don't discard it on an empty
  // label — allow a blank label rather than dropping the whole capture.
  const plain = editor.state.doc.textBetween(from, to, " ", " ").trim();
  return {
    id: makeStackId(),
    capturedAt: nowIso(),
    source,
    payload: { kind: "text", slice: cleanedSlice, plain },
  };
}

// ── Paragraph snapshot ────────────────────────────────────────────────
/** Snapshot a single anchorable block (identified by its uuid attr) from
 *  the editor's main doc. Strips uuids + cross-doc marks so the snapshot
 *  is self-contained. */
export function snapshotParagraph(
  editor: Editor,
  uuid: string,
  source: { docId: string | null; docTitle?: string },
): StackItem | null {
  let nodeJson: JSONContent | null = null;
  editor.state.doc.descendants((node) => {
    if (nodeJson) return false;
    if (node.attrs?.uuid === uuid) {
      nodeJson = node.toJSON() as JSONContent;
      return false;
    }
    return true;
  });
  if (!nodeJson) return null;
  const cleaned = stripCrossDocMarks(stripUuids(nodeJson));
  return {
    id: makeStackId(),
    capturedAt: nowIso(),
    source,
    payload: { kind: "paragraph", node: cleaned },
  };
}

// ── Heading-section snapshot ──────────────────────────────────────────
/** Snapshot a heading + its dominated body range using
 *  `getSectionRangeByUuid`. Each node is stripped of uuids + cross-doc
 *  marks. */
export function snapshotHeadingSection(
  editor: Editor,
  uuid: string,
  source: { docId: string | null; docTitle?: string },
): StackItem | null {
  const range = getSectionRangeByUuid(editor.state.doc, uuid);
  if (!range) return null;
  const nodes = range.nodes.map(
    (n) => stripCrossDocMarks(stripUuids(n.toJSON() as JSONContent)),
  );
  if (nodes.length === 0) return null;
  return {
    id: makeStackId(),
    capturedAt: nowIso(),
    source,
    payload: { kind: "heading", nodes },
  };
}

// ── Card snapshot ─────────────────────────────────────────────────────
/** Side-channel data the snapshot helper needs to attach citation
 *  bib sidecars. Optional — when absent, citation snapshots
 *  carry only the citation ref itself. */
export interface CardSnapshotCtx {
  /** Resolve a bib citekey to its full entry (for citations). */
  getBibEntry?: (key: string) => BibEntry | undefined;
}

/** Build a card snapshot for a given kind. The card record is deep-
 *  cloned and any per-doc references (links, paragraphs) are kept on
 *  the snapshot — the pull spec strips them when materializing a fresh
 *  card. */
export function snapshotCard(
  cardKind: StackCardKind,
  data: unknown,
  source: { docId: string | null; docTitle?: string },
  ctx?: CardSnapshotCtx,
): StackItem | null {
  if (!data || typeof data !== "object") return null;
  const cloned = deepClone(data) as Record<string, unknown>;

  let card: StackCardSnapshot;
  switch (cardKind) {
    case "note":
      card = { cardKind, data: cloned as unknown as UserNote };
      break;
    case "highlight":
      card = { cardKind, data: cloned as unknown as HighlightCard };
      break;
    case "footnote":
      card = { cardKind, data: cloned as unknown as FootnoteRef };
      break;
    case "citation": {
      const cit = cloned as unknown as CitationRef;
      const bibEntries: BibEntry[] = [];
      if (ctx?.getBibEntry && Array.isArray(cit.keys)) {
        for (const k of cit.keys) {
          const e = ctx.getBibEntry(k);
          if (e) bibEntries.push(deepClone(e));
        }
      }
      card = {
        cardKind,
        data: cit,
        ...(bibEntries.length > 0 ? { bibEntries } : {}),
      };
      break;
    }
    case "bibliography":
      card = { cardKind, data: cloned as unknown as BibEntry };
      break;
    case "example":
      card = { cardKind, data: cloned as unknown as ExampleRef };
      break;
    case "todo":
      card = { cardKind, data: cloned as unknown as TodoItem };
      break;
    case "archive":
      card = { cardKind, data: cloned as unknown as ArchivedSnippet };
      break;
    case "revision-comment":
      card = {
        cardKind,
        data: cloned as unknown as Extract<RevisionCard, { kind: "comment" }>,
      };
      break;
    case "revision-suggestion":
      card = {
        cardKind,
        data: cloned as unknown as Extract<
          RevisionCard,
          { kind: "suggestion" }
        >,
      };
      break;
    case "cutter-comment":
      card = {
        cardKind,
        data: cloned as unknown as Extract<CutterCard, { kind: "comment" }>,
      };
      break;
    case "cutter-suggestion":
      card = {
        cardKind,
        data: cloned as unknown as Extract<CutterCard, { kind: "suggestion" }>,
      };
      break;
    default:
      return null;
  }

  return {
    id: makeStackId(),
    capturedAt: nowIso(),
    source,
    payload: { kind: "card", card },
  };
}

// ── Helpers used by thumbnails ────────────────────────────────────────
/** Best-effort plain-text summary for a stack item — used by thumbnails
 *  to render a one-shot preview without mounting Tiptap. */
export function summarizeStackItem(item: StackItem, maxChars = 220): string {
  const p = item.payload;
  let text = "";
  if (p.kind === "text") {
    text = p.plain;
  } else if (p.kind === "paragraph") {
    text = richJsonToPlainText(p.node);
  } else if (p.kind === "heading") {
    text = p.nodes.map((n) => richJsonToPlainText(n)).join(" — ");
  } else if (p.kind === "card") {
    const c = p.card;
    switch (c.cardKind) {
      case "note":
        text = c.data.title || richJsonToPlainText(c.data.content);
        break;
      case "highlight":
        text = "(highlight)";
        break;
      case "footnote":
        text = richJsonToPlainText(c.data.content);
        break;
      case "citation":
        text = (c.data.keys || []).join(", ") || c.data.command;
        break;
      case "bibliography":
        text = `${c.data.key}${c.data.fields?.title ? ": " + c.data.fields.title : ""}`;
        break;
      case "example":
        text = c.data.title || c.data.label || c.data.tag || "(example)";
        break;
      case "todo":
        text = c.data.text;
        break;
      case "archive":
        text = c.data.title || richJsonToPlainText(c.data.content);
        break;
      case "revision-comment":
      case "cutter-comment":
        text = c.data.text || richJsonToPlainText(c.data.content);
        break;
      case "revision-suggestion":
      case "cutter-suggestion":
        text =
          c.data.user_text ||
          c.data.suggested_text ||
          c.data.original_text ||
          c.data.explanation;
        break;
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > maxChars) text = text.slice(0, maxChars - 1) + "…";
  return text;
}

/** Short relative-time label (e.g. "just now", "5m", "2h", "3d"). */
export function shortRelativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Math.max(0, now - t);
  const sec = Math.round(diffMs / 1000);
  if (sec < 30) return "now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo`;
  const yr = Math.round(mo / 12);
  return `${yr}y`;
}
