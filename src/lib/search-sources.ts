/**
 * Collection-search helpers for the unified SearchPanel.
 *
 * Main-editor text search lives in SearchPanel itself (its PM-position
 * mapping is load-bearing); this module handles every other scope and
 * returns partial hits that the panel enriches with breadcrumbs + UI.
 */

import type { Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { richJsonToPlainText } from "./footnote-content";
import { resolveAnchorRange, getLinkedTextObjectIds, getTextAnchor } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import type {
  ArchivedSnippet,
  CitationRef,
  RevisionCard,
  CutterCard,
  OrphanedFootnote,
  QuotationGroup,
  TodoItem,
  UserNote,
  BibEntry,
} from "./types";

export type SearchScope =
  | "mainText"
  | "footnotes"
  | "notes"
  | "citations"
  | "todos"
  | "archive"
  | "cuts"
  | "quotations"
  | "revisions"
  | "bibliography";

export interface SearchHit {
  scope: SearchScope;
  itemId?: string;
  /** Doc position for ordering + editor highlight. MAX_SAFE for unanchored. */
  from: number;
  to: number;
  before: string;
  match: string;
  after: string;
  /** Which field of the item was matched. */
  field?: "title" | "body" | "text" | "notes" | "key" | "author";
  unanchored?: boolean;
}

/** Editor-position panel used by FootnoteInfo objects. */
export interface FootnoteSearchItem {
  footnoteId: string;
  content: unknown;
  pos: number;
  title?: string;
}

/** Subset of CitationInfo we use here — just anchored citations w/ positions. */
export interface EditorCitationItem {
  citationId: string;
  command: string;
  keys: string[];
  pos: number;
}

/** Context chars on each side of a match. */
const CTX = 40;
const UNANCHORED = Number.MAX_SAFE_INTEGER;

/** Human-readable label shown next to chips / in result labels. */
export const SCOPE_LABEL: Record<SearchScope, string> = {
  mainText: "Main text",
  footnotes: "Footnotes",
  notes: "Notes",
  citations: "Citations",
  todos: "Todos",
  archive: "Archive",
  cuts: "Cuts",
  quotations: "Quotations",
  revisions: "Revisions",
  bibliography: "Bibliography",
};

/** Native panel a result of this scope lives in. Headings/mainText have none. */
export const SCOPE_PANEL: Partial<Record<SearchScope, string>> = {
  footnotes: "footnotes",
  notes: "notes",
  citations: "citations",
  todos: "todo",
  archive: "archive",
  cuts: "cutter",
  quotations: "quotations",
  revisions: "revisions",
  bibliography: "bibliography",
};

/** Light theme color for chip dot + card left-border (matches CARD_THEMES). */
export const SCOPE_COLOR: Record<SearchScope, string> = {
  mainText: "transparent",
  footnotes: "#b45757",
  notes: "#15803d",
  citations: "#d4a843",
  todos: "#a8a29e",
  archive: "#7191b0",
  cuts: "#b45757",
  quotations: "#6b6245",
  revisions: "#78716c",
  bibliography: "#6b6245",
};

/** Default order of scope chips in the panel. */
export const SCOPE_ORDER: SearchScope[] = [
  "mainText",
  "footnotes",
  "notes",
  "citations",
  "todos",
  "archive",
  "cuts",
  "quotations",
  "revisions",
  "bibliography",
];

/** Compile the user query into a RegExp or return null on bad patterns. */
export function compileQuery(
  query: string,
  opts: { caseSensitive: boolean; wholeWord: boolean },
): RegExp | null {
  if (!query) return null;
  let pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) pattern = `\\b${pattern}\\b`;
  const flags = opts.caseSensitive ? "g" : "gi";
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** Iterate regex matches and return per-match context snippets. */
function scanText(
  text: string,
  re: RegExp,
): Array<{
  start: number;
  end: number;
  match: string;
  before: string;
  after: string;
}> {
  const out: Array<{
    start: number;
    end: number;
    match: string;
    before: string;
    after: string;
  }> = [];
  if (!text) return out;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      start,
      end,
      match: m[0],
      before: text.slice(Math.max(0, start - CTX), start),
      after: text.slice(end, end + CTX),
    });
    // Avoid zero-width infinite loops (shouldn't happen with escaped input).
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Build a map from paragraph/heading UUID → first doc position it appears at. */
export function buildUuidPosMap(editor: Editor): Map<string, number> {
  const map = new Map<string, number>();
  editor.state.doc.descendants((node, pos) => {
    const uuid = node.attrs?.uuid as string | undefined;
    if (uuid && !map.has(uuid)) map.set(uuid, pos);
    return true;
  });
  return map;
}

function lowestPos(
  uuidPos: Map<string, number>,
  ids: string[] | undefined,
): number | null {
  if (!ids || ids.length === 0) return null;
  let best: number | null = null;
  for (const id of ids) {
    const p = uuidPos.get(id);
    if (p == null) continue;
    if (best == null || p < best) best = p;
  }
  return best;
}

function resolveItemPos(
  editor: Editor,
  uuidPos: Map<string, number>,
  item: { id: string; links?: Link[] },
): number | null {
  const anchor = getTextAnchor(item);
  if (anchor) {
    const r = resolveAnchorRange(editor, anchor.anchorId);
    if (r) return r.from;
  }
  return lowestPos(uuidPos, getLinkedTextObjectIds(item));
}

/** Turn a matched string + context into a SearchHit. */
function hitFromMatch(
  scope: SearchScope,
  itemId: string | undefined,
  pos: number | null,
  field: SearchHit["field"],
  m: { start: number; end: number; match: string; before: string; after: string },
): SearchHit {
  const anchored = pos != null;
  return {
    scope,
    itemId,
    from: anchored ? pos! : UNANCHORED,
    to: anchored ? pos! : UNANCHORED,
    before: m.before,
    match: m.match,
    after: m.after,
    field,
    unanchored: !anchored,
  };
}

/* ── Footnotes ───────────────────────────────────────────────────────── */

export function searchFootnotes(
  footnotes: FootnoteSearchItem[],
  orphans: OrphanedFootnote[],
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const f of footnotes) {
    if (f.title) {
      for (const m of scanText(f.title, re)) {
        out.push(hitFromMatch("footnotes", f.footnoteId, f.pos, "title", m));
      }
    }
    const body = richJsonToPlainText(f.content);
    for (const m of scanText(body, re)) {
      out.push(hitFromMatch("footnotes", f.footnoteId, f.pos, "body", m));
    }
  }
  for (const o of orphans) {
    if (o.title) {
      for (const m of scanText(o.title, re)) {
        out.push(hitFromMatch("footnotes", o.footnoteId, null, "title", m));
      }
    }
    const body = richJsonToPlainText(o.content);
    for (const m of scanText(body, re)) {
      out.push(hitFromMatch("footnotes", o.footnoteId, null, "body", m));
    }
  }
  return out;
}

/* ── Notes ───────────────────────────────────────────────────────────── */

export function searchNotes(
  notes: UserNote[],
  editor: Editor,
  uuidPos: Map<string, number>,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const n of notes) {
    const pos = resolveItemPos(editor, uuidPos, n);
    if (n.title) {
      for (const m of scanText(n.title, re)) {
        out.push(hitFromMatch("notes", n.id, pos, "title", m));
      }
    }
    const body = richJsonToPlainText(n.content);
    for (const m of scanText(body, re)) {
      out.push(hitFromMatch("notes", n.id, pos, "body", m));
    }
  }
  return out;
}

/* ── Citations ───────────────────────────────────────────────────────── */

export function searchCitations(
  persisted: CitationRef[],
  editorCitations: EditorCitationItem[],
  getDisplayText: (command: string) => string,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  const posById = new Map(editorCitations.map((c) => [c.citationId, c.pos]));

  for (const c of persisted) {
    const pos = posById.get(c.id) ?? null;
    for (const m of scanText(c.command, re)) {
      out.push(hitFromMatch("citations", c.id, pos, "body", m));
    }
    const display = getDisplayText(c.command);
    if (display && display !== c.command) {
      for (const m of scanText(display, re)) {
        out.push(hitFromMatch("citations", c.id, pos, "text", m));
      }
    }
  }

  // Anchored-only citations that haven't been synced into `persisted` yet:
  const persistedIds = new Set(persisted.map((c) => c.id));
  for (const ec of editorCitations) {
    if (persistedIds.has(ec.citationId)) continue;
    for (const m of scanText(ec.command, re)) {
      out.push(hitFromMatch("citations", ec.citationId, ec.pos, "body", m));
    }
    const display = getDisplayText(ec.command);
    if (display && display !== ec.command) {
      for (const m of scanText(display, re)) {
        out.push(hitFromMatch("citations", ec.citationId, ec.pos, "text", m));
      }
    }
  }

  return out;
}

/* ── Todos ───────────────────────────────────────────────────────────── */

export function searchTodos(
  todos: TodoItem[],
  uuidPos: Map<string, number>,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const t of todos) {
    const pos = lowestPos(uuidPos, getLinkedTextObjectIds(t));
    for (const m of scanText(t.text, re)) {
      out.push(hitFromMatch("todos", t.id, pos, "text", m));
    }
    if (t.notes) {
      for (const m of scanText(t.notes, re)) {
        out.push(hitFromMatch("todos", t.id, pos, "notes", m));
      }
    }
  }
  return out;
}

/* ── Archive ─────────────────────────────────────────────────────────── */

export function searchArchive(
  snippets: ArchivedSnippet[],
  uuidPos: Map<string, number>,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const s of snippets) {
    const pos = lowestPos(uuidPos, getLinkedTextObjectIds(s));
    if (s.title) {
      for (const m of scanText(s.title, re)) {
        out.push(hitFromMatch("archive", s.id, pos, "title", m));
      }
    }
    const body = richJsonToPlainText(s.content);
    for (const m of scanText(body, re)) {
      out.push(hitFromMatch("archive", s.id, pos, "body", m));
    }
  }
  return out;
}

/* ── Cutter (comments + suggestions) ────────────────────────────────── */

export function searchCutter(
  cards: CutterCard[],
  editor: Editor,
  uuidPos: Map<string, number>,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const c of cards) {
    const pos = resolveItemPos(editor, uuidPos, c);
    if (c.kind === "comment") {
      const body = c.text || richJsonToPlainText(c.content);
      for (const m of scanText(body, re)) {
        out.push(hitFromMatch("cuts", c.id, pos, "body", m));
      }
    } else {
      for (const m of scanText(c.original_text, re)) {
        out.push(hitFromMatch("cuts", c.id, pos, "title", m));
      }
      for (const m of scanText(c.suggested_text, re)) {
        out.push(hitFromMatch("cuts", c.id, pos, "body", m));
      }
      for (const m of scanText(c.explanation, re)) {
        out.push(hitFromMatch("cuts", c.id, pos, "body", m));
      }
    }
  }
  return out;
}

/* ── Quotations ──────────────────────────────────────────────────────── */

export function searchQuotations(
  groups: QuotationGroup[],
  uuidPos: Map<string, number>,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const g of groups) {
    const pos = lowestPos(uuidPos, getLinkedTextObjectIds(g));
    if (g.title) {
      for (const m of scanText(g.title, re)) {
        out.push(hitFromMatch("quotations", g.id, pos, "title", m));
      }
    }
    if (g.notes) {
      for (const m of scanText(g.notes, re)) {
        out.push(hitFromMatch("quotations", g.id, pos, "notes", m));
      }
    }
    for (const ref of g.references) {
      for (const m of scanText(ref.citeKey, re)) {
        out.push(hitFromMatch("quotations", g.id, pos, "key", m));
      }
      for (const q of ref.quotes) {
        for (const m of scanText(q.text, re)) {
          out.push(hitFromMatch("quotations", g.id, pos, "text", m));
        }
      }
    }
  }
  return out;
}

/* ── Comments ────────────────────────────────────────────────────────── */

export function searchComments(
  cards: RevisionCard[],
  editor: Editor,
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const c of cards) {
    const ta = getTextAnchor(c);
    const range = ta ? resolveAnchorRange(editor, ta.anchorId) : null;
    const pos = range?.from ?? null;
    if (c.kind === "comment") {
      for (const m of scanText(c.text, re)) {
        out.push(hitFromMatch("revisions", c.id, pos, "body", m));
      }
    } else {
      const fields: Array<keyof RevisionCard & string> = [];
      const checks: Array<{ value: string }> = [
        { value: c.original_text },
        { value: c.suggested_text },
        { value: c.explanation },
        { value: c.user_text },
        { value: c.instructions },
      ];
      for (const { value } of checks) {
        for (const m of scanText(value || "", re)) {
          out.push(hitFromMatch("revisions", c.id, pos, "body", m));
        }
      }
      void fields;
    }
  }
  return out;
}

/* ── Bibliography ────────────────────────────────────────────────────── */

export function searchBibliography(
  entries: BibEntry[],
  re: RegExp,
): SearchHit[] {
  const out: SearchHit[] = [];
  for (const e of entries) {
    for (const m of scanText(e.key, re)) {
      out.push({
        scope: "bibliography",
        itemId: e.key,
        from: UNANCHORED,
        to: UNANCHORED,
        before: m.before,
        match: m.match,
        after: m.after,
        field: "key",
        unanchored: true,
      });
    }
    for (const [fieldName, value] of Object.entries(e.fields)) {
      if (!value) continue;
      for (const m of scanText(value, re)) {
        out.push({
          scope: "bibliography",
          itemId: e.key,
          from: UNANCHORED,
          to: UNANCHORED,
          before: m.before,
          match: m.match,
          after: m.after,
          field: fieldName === "author" ? "author" : "body",
          unanchored: true,
        });
      }
    }
  }
  return out;
}

// Keep unused-import silence; we re-export this for panel code to ignore.
export type _unused = JSONContent;
