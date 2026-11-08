/**
 * Tool-gutter rows (task 1440) — every card kind as ONE LINE OF TEXT.
 *
 * In the cards-right / tools-left layout the left gutter lists the paper's
 * apparatus (footnotes, numbered examples, to-dos, and whatever the user adds
 * through "More") as plain text written on the manila — no card chrome. Each
 * builder here is a PURE projection of a store the pane already holds into
 * `GutterRow`s: a short marker (number / checkbox state), the text, and a
 * `jump` saying what a click should land on. The component owns the clicks;
 * this module owns "what does the row say?", so it is testable without a DOM.
 *
 * Archived cards are left out (the `archivedIds` cross-panel SSOT — the same
 * set the margin markers and the omni gutter read).
 */

import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  NoteCardItem,
  ReportItem,
  RevisionCard,
  TodoItem,
} from "@/lib/types";
import type { LatexError } from "@/lib/latex-errors";
import type { CardWithLinks } from "@/links/links";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { bibFieldDisplay } from "@/lib/bib-parser";
import { suggestionReplacement } from "@/panels/_shared/suggestion-field-vocabulary";

/** Which selection slot a paragraph-anchored card selects into. */
export type GutterCardSlot =
  | "note"
  | "todo"
  | "archive"
  | "revision"
  | "cutter"
  | "report";

export type GutterJump =
  | { kind: "footnote"; id: string }
  | { kind: "example"; id: string }
  | { kind: "citation"; id: string }
  | { kind: "card"; slot: GutterCardSlot; card: CardWithLinks }
  | { kind: "error"; error: LatexError }
  | { kind: "bib"; key: string; citationId: string | null };

export interface GutterRow {
  key: string;
  /** Leading marker: a footnote/example number, "☐"/"☑" for a to-do, a
   *  short kind tag for polymorphic lists. Empty when there is none. */
  marker: string;
  text: string;
  /** To-do rows: the id the checkbox toggles, and its state. */
  todo?: { id: string; done: boolean };
  /** Dim the row (a done to-do, an applied change). */
  muted?: boolean;
  jump: GutterJump;
}

/** The entity id a row stands for — what the selection store names when
 *  this row's card is the selected one. */
export function rowEntityId(row: GutterRow): string {
  const j = row.jump;
  switch (j.kind) {
    case "card":
      return j.card.id;
    case "error":
      return j.error.id;
    case "bib":
      return j.key;
    default:
      return j.id;
  }
}

const UNTITLED = "(empty)";

/** Collapse whitespace; empty → a visible placeholder so a row is never blank. */
export function oneLine(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t || UNTITLED;
}

function plain(content: unknown): string {
  try {
    return richJsonToPlainText(content);
  } catch {
    return "";
  }
}

const live = <T extends { id: string; archived?: boolean }>(
  items: readonly T[],
  archivedIds: ReadonlySet<string>,
): T[] => items.filter((c) => !c.archived && !archivedIds.has(c.id));

/** `\citet{jackson2001}` → "Jackson 2001" — a citation written into a card's
 *  plain text as its raw command reads as noise in a one-line list. */
const CITE_CMD = /\\[A-Za-z]*cite[A-Za-z]*\*?(?:\[[^\]]*\]){0,2}\{([^}]*)\}/g;

export function readableInline(text: string, bibEntries: readonly BibEntry[] = []): string {
  if (!text.includes("\\")) return text;
  const byKey = new Map(bibEntries.map((e) => [e.key, e]));
  return text.replace(CITE_CMD, (_m, keys: string) =>
    keys
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => bibShortLabel(byKey.get(k), k))
      .join("; "),
  );
}

export function footnoteRows(
  footnotes: readonly FootnoteInfo[],
  bibEntries: readonly BibEntry[] = [],
): GutterRow[] {
  return [...footnotes]
    .sort((a, b) => a.number - b.number)
    .map((f) => ({
      key: `fn:${f.footnoteId}`,
      marker: f.numberOverride ? String(f.numberOverride) : f.thanks ? "*" : String(f.number),
      text: oneLine(readableInline(f.title || plain(f.content), bibEntries)),
      jump: { kind: "footnote", id: f.footnoteId },
    }));
}

/** An example body as one line. A glossed example (`\\begingl`) is a grid of
 *  cells the generic projection runs together; its first aligned tier — the
 *  source line — read cell by cell is what the example IS. The gloss may sit
 *  inside a wrapper block, so it is found wherever it is in the body. */
export function exampleBodyText(content: unknown): string {
  const gloss = findGloss(content);
  if (gloss) return glossFirstTier(gloss);
  const doc = content as { content?: Array<Record<string, unknown>> } | null;
  const blocks = doc?.content ?? [];
  return blocks
    .map((block) => plain({ type: "doc", content: [block] }))
    .filter(Boolean)
    .join(" ");
}

type JsonNode = { type?: string; content?: JsonNode[] };

function findGloss(node: unknown): JsonNode | null {
  const n = node as JsonNode | null;
  if (!n || typeof n !== "object") return null;
  if (n.type === "exampleGloss") return n;
  for (const c of n.content ?? []) {
    const hit = findGloss(c);
    if (hit) return hit;
  }
  return null;
}

/** The gloss's first tier: the first aligned row read cell by cell, else the
 *  first row as prose. */
function glossFirstTier(gloss: JsonNode): string {
  const rows = gloss.content ?? [];
  const first = rows.find((r) => r.type === "alignedGlossRow") ?? rows[0];
  if (!first) return "";
  if (first.type === "alignedGlossRow") {
    return (first.content ?? [])
      .map((cell) => plain({ type: "doc", content: [{ type: "paragraph", content: cell.content ?? [] }] }))
      .filter(Boolean)
      .join(" ");
  }
  return plain({ type: "doc", content: [{ type: "paragraph", content: first.content ?? [] }] });
}

export function exampleRows(examples: readonly ExampleInfo[]): GutterRow[] {
  return [...examples]
    .sort((a, b) => a.number - b.number)
    .map((e) => {
      // The rich body first: its projection keeps block boundaries (a gloss's
      // tiers) as breaks, where the flattened `bodyText` runs them together.
      const firstItem = e.items[0];
      const text =
        exampleBodyText(e.bodyContent) ||
        e.bodyText ||
        plain(firstItem?.content) ||
        firstItem?.text ||
        e.preview;
      return {
        key: `ex:${e.exampleId}`,
        marker: `(${e.number})`,
        text: oneLine(text),
        jump: { kind: "example", id: e.exampleId },
      };
    });
}

export function todoRows(
  items: readonly TodoItem[],
  archivedIds: ReadonlySet<string>,
): GutterRow[] {
  const rows = live(items, archivedIds).map((t) => ({
    key: `todo:${t.id}`,
    marker: "",
    text: oneLine(t.text),
    todo: { id: t.id, done: t.done },
    muted: t.done,
    jump: { kind: "card", slot: "todo", card: t } as GutterJump,
  }));
  // Open tasks first, then done ones — stable within each group.
  return [...rows.filter((r) => !r.todo.done), ...rows.filter((r) => r.todo.done)];
}

export function noteRows(
  cards: readonly NoteCardItem[],
  archivedIds: ReadonlySet<string>,
): GutterRow[] {
  return live(cards, archivedIds).map((c) => {
    if (c.kind === "highlight") {
      const snap = c.links
        .map((l) => (l as { textRange?: { textSnapshot?: string } }).textRange?.textSnapshot)
        .find(Boolean);
      return {
        key: `hl:${c.id}`,
        marker: "≡",
        text: oneLine(snap ? `“${snap}”` : "Highlight"),
        jump: { kind: "card", slot: "note", card: c },
      };
    }
    return {
      key: `note:${c.id}`,
      marker: "",
      text: oneLine(c.title || plain(c.content)),
      jump: { kind: "card", slot: "note", card: c },
    };
  });
}

/** A field as DISPLAY text (`bibFieldDisplay`, the one door — task 409),
 *  with BibTeX's grouping braces dropped for a one-line label. */
function field(entry: BibEntry, name: string): string {
  return (bibFieldDisplay(entry, name) ?? "").replace(/[{}]/g, "").trim();
}

/** "Derrida 1967" from a bib entry, falling back to the citekey. */
export function bibShortLabel(entry: BibEntry | undefined, key: string): string {
  if (!entry) return key;
  const author = field(entry, "author") || field(entry, "editor");
  const surname = author ? author.split(/\s+and\s+/i)[0].split(",")[0].trim().split(/\s+/).pop() ?? "" : "";
  const year = (field(entry, "year") || field(entry, "date")).slice(0, 4);
  const label = [surname, year].filter(Boolean).join(" ");
  return label || key;
}

export function citationRows(
  citations: readonly CitationRef[],
  bibEntries: readonly BibEntry[],
  archivedIds: ReadonlySet<string>,
  positionOf?: (id: string) => number | undefined,
): GutterRow[] {
  const byKey = new Map(bibEntries.map((e) => [e.key, e]));
  const at = (id: string) => positionOf?.(id) ?? Number.MAX_SAFE_INTEGER;
  return [...live(citations, archivedIds)]
    .sort((a, b) => at(a.id) - at(b.id))
    .map((c) => ({
      key: `cite:${c.id}`,
      marker: "",
      text: oneLine(c.keys.map((k) => bibShortLabel(byKey.get(k), k)).join("; ")),
      muted: !!c.unanchored,
      jump: { kind: "citation", id: c.id },
    }));
}

export function bibliographyRows(
  bibEntries: readonly BibEntry[],
  citations: readonly CitationRef[],
): GutterRow[] {
  const firstCite = new Map<string, string>();
  for (const c of citations) {
    if (c.unanchored || c.archived) continue;
    for (const k of c.keys) if (!firstCite.has(k)) firstCite.set(k, c.id);
  }
  return [...bibEntries]
    .sort((a, b) => bibShortLabel(a, a.key).localeCompare(bibShortLabel(b, b.key)))
    .map((e) => {
      const title = field(e, "title");
      return {
        key: `bib:${e.uid || e.key}`,
        marker: "",
        text: oneLine(`${bibShortLabel(e, e.key)}${title ? ` · ${title}` : ""}`),
        muted: !firstCite.has(e.key),
        jump: { kind: "bib", key: e.key, citationId: firstCite.get(e.key) ?? null },
      };
    });
}

export function archiveRows(
  snippets: readonly ArchivedSnippet[],
  archivedIds: ReadonlySet<string>,
): GutterRow[] {
  return live(snippets, archivedIds).map((s) => ({
    key: `arc:${s.id}`,
    marker: "",
    text: oneLine(s.title || plain(s.content)),
    jump: { kind: "card", slot: "archive", card: s as unknown as CardWithLinks },
  }));
}

/** Revisions and Cuts share a shape: a comment, or a suggestion. */
function changeRows(
  cards: readonly (RevisionCard | CutterCard)[],
  archivedIds: ReadonlySet<string>,
  slot: "revision" | "cutter",
  prefix: string,
): GutterRow[] {
  return live(cards, archivedIds).map((c) => {
    if (c.kind === "comment") {
      return {
        key: `${prefix}:${c.id}`,
        marker: "",
        text: oneLine(c.text || plain(c.content)),
        jump: { kind: "card", slot, card: c },
      };
    }
    const done = c.status === "applied" || c.status === "accepted" || c.status === "rejected";
    // The replacement the APPLY path would use (the user's own text wins).
    const replacement = suggestionReplacement(c);
    const text = replacement
      ? `${c.original_text ? `${c.original_text} → ` : ""}${replacement}`
      : c.original_text
        ? `Cut: ${c.original_text}`
        : c.explanation || c.instructions;
    return {
      key: `${prefix}:${c.id}`,
      // A settled change says its state in a word; the row is also dimmed.
      marker: done ? c.status : "",
      text: oneLine(text),
      muted: done,
      jump: { kind: "card", slot, card: c },
    };
  });
}

export const revisionRows = (cards: readonly RevisionCard[], archivedIds: ReadonlySet<string>) =>
  changeRows(cards, archivedIds, "revision", "rev");

export const cutterRows = (cards: readonly CutterCard[], archivedIds: ReadonlySet<string>) =>
  changeRows(cards, archivedIds, "cutter", "cut");

export function reportRows(
  cards: readonly ReportItem[],
  archivedIds: ReadonlySet<string>,
): GutterRow[] {
  return live(cards, archivedIds).map((c) => ({
    key: `rep:${c.id}`,
    marker: c.kind === "report-request" ? "?" : "",
    text: oneLine(c.kind === "report" ? c.title || c.text : c.text || plain(c.content)),
    jump: { kind: "card", slot: "report", card: c },
  }));
}

export function errorRows(
  errors: readonly LatexError[],
  dismissedIds: ReadonlySet<string>,
): GutterRow[] {
  return errors
    .filter((e) => !dismissedIds.has(e.id))
    .map((e) => ({
      key: `err:${e.id}`,
      marker: e.line > 0 ? `l.${e.line}` : "",
      text: oneLine(e.message),
      muted: e.severity !== "error",
      jump: { kind: "error", error: e },
    }));
}
