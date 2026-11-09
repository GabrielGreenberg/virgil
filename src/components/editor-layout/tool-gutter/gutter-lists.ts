/**
 * The gutter's READING LISTS (Gabriel, 2026-11-08) — footnotes, bibliography
 * and numbered examples as lists a person reads, not one-line indexes.
 *
 * Every list is groups of rows. A row is sans and shows its item rendered
 * (citations, `\ref`, math — never raw commands); it opens in place into the
 * kind's own card (`GutterList`). This module is the PURE half: what the
 * groups are, what each row says and where it points. The component owns the
 * clicks, the open card and the keyboard, so this is testable without a DOM.
 *
 * Groups follow the paper: footnotes and "as cited" sit under the top-level
 * section their anchor falls in, numbered the way the paper numbers them.
 */

import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, FootnoteRef, OrphanedFootnote } from "@/lib/types";
import type { HeadingEntry } from "@/lib/tiptap/doc-structure";
import { bibFieldDisplay } from "@/lib/bib-parser";
import { bibShortLabel, rowEntityId, type GutterJump, type GutterRow } from "./gutter-rows";

/** What an open row mounts — the kind's own card. */
export type GutterCardRef =
  | { kind: "footnote"; id: string }
  | { kind: "orphan"; id: string }
  | { kind: "footnote-ref"; id: string }
  /** `section`: one part of the bib card inline (the compact view's foot). */
  | { kind: "bib"; key: string; section?: "fields" | "notes" | "review" }
  | { kind: "example"; id: string }
  /** Any other kind: the card OmniHost built for this entity id. */
  | { kind: "omni"; id: string };

/** What a row's snippet shows: a rich body (rendered through the static
 *  borrowed renderer), a bibliography reference, or plain words. */
export type GutterSnippet =
  | { kind: "rich"; value: unknown; fallback: string }
  | { kind: "reference"; entry: BibEntry }
  | { kind: "short"; entry: BibEntry | undefined; key: string }
  | { kind: "text"; text: string }
  | { kind: "example"; example: ExampleInfo };

export interface GutterListRow {
  key: string;
  /** The entity this row stands for — the selection store's id. */
  entityId: string;
  marker: string;
  snippet: GutterSnippet;
  /** A muted line under the snippet (an example's label and ref count). */
  sub?: string;
  /** Where the row's anchor is in the paper, when it has one. */
  pos: number | null;
  /** What ↗ lands on; null when the item has no place in the text. */
  jump: GutterJump | null;
  /** What ⌄ opens; null when there is no card for it. */
  card: GutterCardRef | null;
  /** "N×" — how often a bibliography entry is cited. */
  count?: number;
  /** A repeat citation in the as-cited view (↺, dimmed). */
  repeat?: boolean;
  muted?: boolean;
  /** Red: a citekey with no .bib entry. */
  missing?: boolean;
  /** The citekey a bibliography row steps through with ‹ ›. */
  bibKey?: string;
  /** A to-do's checkbox, in the marker column. */
  todo?: { id: string; done: boolean };
}

export interface GutterListGroup {
  key: string;
  /** "" for an untitled run (before the first heading). */
  label: string;
  number?: string;
  style?: "section" | "attention";
  rows: GutterListRow[];
}

// ── Sections ──────────────────────────────────────────────────────────────

export interface GutterSectionHead {
  pos: number;
  text: string;
  /** The paper's own number, "" for an unnumbered heading. */
  number: string;
}

/** The paper's TOP-LEVEL sections — the shallowest heading level present —
 *  numbered the way LaTeX counts them (unnumbered headings take no number and
 *  leave the count alone). */
export function topSections(headings: readonly HeadingEntry[]): GutterSectionHead[] {
  if (headings.length === 0) return [];
  const top = Math.min(...headings.map((h) => h.level));
  let n = 0;
  return headings
    .filter((h) => h.level === top)
    .map((h) => ({
      pos: h.pos,
      text: h.text.trim() || "Untitled section",
      number: h.numbered ? String(++n) : "",
    }));
}

/** The index of the section a position falls in (-1 = before the first). */
export function sectionIndexAt(sections: readonly GutterSectionHead[], pos: number): number {
  let lo = 0;
  let hi = sections.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sections[mid].pos <= pos) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Bucket rows by section, in section order; rows keep their own order. */
function bySection(
  rows: readonly GutterListRow[],
  sections: readonly GutterSectionHead[],
  keyPrefix: string,
): GutterListGroup[] {
  const buckets = new Map<number, GutterListRow[]>();
  for (const r of rows) {
    const i = r.pos == null ? -1 : sectionIndexAt(sections, r.pos);
    const list = buckets.get(i) ?? [];
    list.push(r);
    buckets.set(i, list);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((i) => ({
      key: `${keyPrefix}:sec:${i}`,
      label: i < 0 ? "" : sections[i].text,
      number: i < 0 ? undefined : sections[i].number || undefined,
      style: "section" as const,
      rows: buckets.get(i)!,
    }));
}

// ── Footnotes ─────────────────────────────────────────────────────────────

/** The marker the paper prints: the `\footnote[n]` override, `*` for
 *  `\thanks`, else the running number. */
export function footnoteMarker(f: FootnoteInfo): string {
  return f.numberOverride ? String(f.numberOverride) : f.thanks ? "*" : String(f.number);
}

/**
 * Footnotes grouped under their sections, in the paper's order, then the ones
 * with no place in the text (orphaned bodies whose marker was deleted, and
 * unanchored refs) in a group of their own at the end. `view` picks which
 * set-aside refs show: active ones, archived ones, or both.
 */
export function footnoteGroups(
  footnotes: readonly FootnoteInfo[],
  orphans: readonly OrphanedFootnote[],
  refs: readonly FootnoteRef[],
  sections: readonly GutterSectionHead[],
  view: "active" | "archived" | "all" = "active",
): GutterListGroup[] {
  const live: GutterListRow[] =
    view === "archived"
      ? []
      : [...footnotes]
          .sort((a, b) => a.pos - b.pos)
          .map((f) => ({
            key: `fn:${f.footnoteId}`,
            entityId: f.footnoteId,
            marker: footnoteMarker(f),
            snippet: { kind: "rich", value: f.content, fallback: f.title ?? "" },
            pos: f.pos,
            jump: { kind: "footnote", id: f.footnoteId },
            card: { kind: "footnote", id: f.footnoteId },
          }));
  const groups = bySection(live, sections, "fn");

  const placeless: GutterListRow[] = [];
  if (view !== "archived") {
    for (const o of orphans) {
      placeless.push({
        key: `fn-orphan:${o.footnoteId}`,
        entityId: o.footnoteId,
        marker: "–",
        snippet: { kind: "rich", value: o.content, fallback: o.title ?? "" },
        sub: "Its marker was deleted",
        pos: null,
        jump: null,
        card: { kind: "orphan", id: o.footnoteId },
      });
    }
  }
  for (const r of refs) {
    const archived = !!r.archived;
    if (view === "active" && archived) continue;
    if (view === "archived" && !archived) continue;
    placeless.push({
      key: `fn-ref:${r.id}`,
      entityId: r.id,
      marker: "–",
      snippet: { kind: "rich", value: r.content, fallback: r.title ?? "" },
      sub: archived ? "Archived" : "Not placed in the text",
      pos: null,
      jump: null,
      card: { kind: "footnote-ref", id: r.id },
      muted: archived,
    });
  }
  if (placeless.length > 0) {
    groups.push({
      key: "fn:placeless",
      label: view === "archived" ? "Archived" : "No place in the text",
      style: "attention",
      rows: placeless,
    });
  }
  return groups;
}

// ── Bibliography ──────────────────────────────────────────────────────────

/** One citation in the paper, as the pane already lists them. */
export interface GutterCitation {
  citationId: string;
  keys: string[];
  pos: number;
}

// A field value is typed as a string, but a .bib or library record can carry
// a bare number (`year = 2001`) or another non-string, so it is coerced first.
const clean = (s: unknown) =>
  (s == null ? "" : String(s)).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
const fieldOf = (e: BibEntry, name: string) => clean(bibFieldDisplay(e, name));

/** Each citekey's citation ids in document order. */
export function citationsByKey(cites: readonly GutterCitation[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of [...cites].sort((a, b) => a.pos - b.pos)) {
    for (const k of c.keys) {
      const list = out.get(k) ?? [];
      list.push(c.citationId);
      out.set(k, list);
    }
  }
  return out;
}

/** The surname an entry files under: the first author's (or editor's). */
export function filingName(e: BibEntry): string {
  const who = fieldOf(e, "author") || fieldOf(e, "editor");
  if (!who) return e.key;
  const first = who.split(/\s+and\s+/i)[0].trim();
  if (first.includes(",")) return first.split(",")[0].trim();
  return first.split(/\s+/).pop() ?? first;
}

/** The reference as it will print, as parts the row can style: surname (bold),
 *  the rest of the names as initials, year, title (italic for a book, quoted
 *  for an article or chapter), then the venue. */
export interface ReferenceParts {
  surname: string;
  rest: string;
  year: string;
  title: string;
  titleStyle: "italic" | "quoted";
  venue: string;
  /** In <venue>, italic (a journal or the book a chapter is in). */
  venueItalic: boolean;
}

const BOOKISH = new Set(["book", "mvbook", "collection", "proceedings", "phdthesis", "mastersthesis", "thesis", "manual", "report", "techreport"]);

function initials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((g) => (g.includes("-") ? g.split("-").map((p) => `${p[0]}.`).join("-") : `${g[0]}.`))
    .join(" ");
}

export function referenceParts(e: BibEntry): ReferenceParts {
  const who = fieldOf(e, "author") || fieldOf(e, "editor");
  const people = who ? who.split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean) : [];
  const nameOf = (p: string) => {
    if (p.includes(",")) {
      const [last, given = ""] = p.split(",");
      return { last: last.trim(), given: given.trim() };
    }
    const words = p.split(/\s+/);
    return { last: words.pop() ?? p, given: words.join(" ") };
  };
  const first = people[0] ? nameOf(people[0]) : { last: e.key, given: "" };
  // "Bolter, J. D." — then the co-authors given-name first: "…, R. Smith and
  // T. Jones".
  const others = people.slice(1).map((p) => {
    const n = nameOf(p);
    return `${initials(n.given)} ${n.last}`.trim();
  });
  const coauthors =
    others.length === 0
      ? ""
      : others.length === 1
        ? ` and ${others[0]}`
        : `, ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  const rest = `${initials(first.given)}${coauthors}`.trim();
  const type = e.type.toLowerCase();
  const bookish = BOOKISH.has(type);
  const journal = fieldOf(e, "journal") || fieldOf(e, "journaltitle");
  const booktitle = fieldOf(e, "booktitle");
  const publisher = fieldOf(e, "publisher") || fieldOf(e, "school") || fieldOf(e, "institution");
  let venue = "";
  let venueItalic = false;
  if (journal) {
    venue = journal;
    venueItalic = true;
  } else if (booktitle) {
    venue = `In ${booktitle}`;
    venueItalic = true;
  } else if (publisher) {
    venue = publisher;
  }
  if (!bookish && publisher && booktitle) venue = `${venue}. ${publisher}`;
  return {
    surname: first.last,
    rest,
    year: (fieldOf(e, "year") || fieldOf(e, "date")).slice(0, 4),
    title: fieldOf(e, "title"),
    titleStyle: bookish || (!journal && !booktitle) ? "italic" : "quoted",
    venue,
    venueItalic,
  };
}

function bibRow(e: BibEntry, ids: readonly string[]): GutterListRow {
  return {
    key: `bib:${e.uid || e.key}`,
    entityId: e.key,
    marker: "",
    snippet: { kind: "reference", entry: e },
    pos: null,
    jump: ids.length ? { kind: "bib", key: e.key, citationId: ids[0] } : null,
    card: { kind: "bib", key: e.key },
    count: ids.length > 1 ? ids.length : undefined,
    bibKey: e.key,
  };
}

/** The standing "Needs attention" group: cited keys with no .bib entry, then
 *  entries nothing cites. */
function attentionGroup(
  entries: readonly BibEntry[],
  byKey: Map<string, string[]>,
  firstPos: Map<string, number>,
  citedOnly: boolean,
): GutterListGroup | null {
  const known = new Set(entries.map((e) => e.key));
  const rows: GutterListRow[] = [];
  for (const [key, ids] of byKey) {
    if (known.has(key)) continue;
    rows.push({
      key: `bib-missing:${key}`,
      entityId: key,
      marker: "●",
      snippet: { kind: "text", text: key },
      sub: "Cited, not in the .bib",
      pos: firstPos.get(key) ?? null,
      jump: { kind: "bib", key, citationId: ids[0] },
      card: null,
      missing: true,
      bibKey: key,
    });
  }
  for (const e of citedOnly ? [] : [...entries].sort(byFiling)) {
    if (byKey.has(e.key)) continue;
    rows.push({ ...bibRow(e, []), key: `bib-uncited:${e.uid || e.key}`, muted: true, sub: "Not cited" });
  }
  return rows.length ? { key: "bib:attention", label: "Needs attention", style: "attention", rows } : null;
}

function filingKey(e: BibEntry): string {
  try {
    return `${filingName(e)} ${fieldOf(e, "year")}`.toLowerCase();
  } catch {
    return e.key.toLowerCase();
  }
}

function byFiling(a: BibEntry, b: BibEntry): number {
  return filingKey(a).localeCompare(filingKey(b));
}

/**
 * The bibliography two ways. `az`: the reference list as it will print, one
 * continuous run in author order. `cited`: each section's sources in first-citation order,
 * a later use of an entry dimmed with ↺. Both end with "Needs attention".
 * `citedOnly` leaves the uncited entries out of "Needs attention" (a cited
 * key missing from the .bib still shows).
 */
export function bibliographyGroups(
  entries: readonly BibEntry[],
  cites: readonly GutterCitation[],
  sections: readonly GutterSectionHead[],
  mode: "az" | "cited",
  citedOnly = false,
): GutterListGroup[] {
  const byKey = citationsByKey(cites);
  const firstPos = new Map<string, number>();
  for (const c of [...cites].sort((a, b) => a.pos - b.pos)) {
    for (const k of c.keys) if (!firstPos.has(k)) firstPos.set(k, c.pos);
  }
  // One row per citekey: a duplicate block in the .bib is the first one's.
  const seen = new Set<string>();
  const unique = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const groups: GutterListGroup[] = [];

  if (mode === "az") {
    // One continuous list, as it will print — no letter dividers (Gabriel,
    // 2026-11-09). Uncited entries read under "Needs attention".
    const rows = unique
      .filter((e) => byKey.has(e.key))
      .sort(byFiling)
      .map((e) => bibRow(e, byKey.get(e.key) ?? []));
    if (rows.length) groups.push({ key: "bib:az", label: "", rows });
  } else {
    // One row per entry per section, at its first citation there, with "N×"
    // when the section cites it more than once; ↺ only when an EARLIER
    // section already cited it.
    const entryOf = new Map(unique.map((e) => [e.key, e]));
    const seenInEarlier = new Set<string>();
    const cited: GutterListRow[] = [];
    let section = Number.NaN;
    let inSection = new Map<string, GutterListRow>();
    for (const c of [...cites].sort((a, b) => a.pos - b.pos)) {
      const sec = sectionIndexAt(sections, c.pos);
      if (sec !== section) {
        for (const k of inSection.keys()) seenInEarlier.add(k);
        inSection = new Map();
        section = sec;
      }
      for (const k of c.keys) {
        const e = entryOf.get(k);
        if (!e) continue;
        const here = inSection.get(k);
        if (here) {
          here.count = (here.count ?? 1) + 1;
          continue;
        }
        const repeat = seenInEarlier.has(k);
        const row: GutterListRow = {
          ...bibRow(e, byKey.get(k) ?? []),
          key: `bib-cite:${c.citationId}:${k}`,
          snippet: { kind: "short", entry: e, key: k },
          pos: c.pos,
          jump: { kind: "bib", key: k, citationId: c.citationId },
          repeat,
          muted: repeat,
          marker: repeat ? "↺" : "",
          count: undefined,
        };
        inSection.set(k, row);
        cited.push(row);
      }
    }
    groups.push(...bySection(cited, sections, "bib"));
  }
  const attention = attentionGroup(unique, byKey, firstPos, citedOnly);
  if (attention) groups.push(attention);
  return groups;
}

/** "Jackson 2001" for a citekey, as a row's short label. */
export const shortLabel = (entry: BibEntry | undefined, key: string) => bibShortLabel(entry, key);

// ── Every other list ──────────────────────────────────────────────────────

/** A one-line row (`gutter-rows.ts`) as a reading-list row that opens into
 *  its kind's card. A card with a rich body shows it rendered. */
export function cardListGroups(section: string, rows: readonly GutterRow[]): GutterListGroup[] {
  const out: GutterListRow[] = rows.map((r) => {
    const id = rowEntityId(r);
    const body = r.jump.kind === "card" ? (r.jump.card as { content?: unknown; title?: string }) : null;
    const rich = body && body.content && !body.title && typeof body.content === "object";
    return {
      key: r.key,
      entityId: id,
      marker: r.todo ? "" : r.marker,
      snippet: rich ? { kind: "rich", value: body!.content, fallback: r.text } : { kind: "text", text: r.text },
      pos: null,
      jump: r.jump,
      card: { kind: "omni", id },
      muted: r.muted,
      todo: r.todo,
    };
  });
  return out.length ? [{ key: `${section}:all`, label: "", rows: out }] : [];
}

// ── Numbered examples ─────────────────────────────────────────────────────

/** Examples in the paper's order, each with its label and how often the paper
 *  refers to it (`refCount(label)`, read from the live doc by the caller). */
export function exampleGroups(
  examples: readonly ExampleInfo[],
  refCount: (label: string) => number,
): GutterListGroup[] {
  const rows: GutterListRow[] = [...examples]
    .sort((a, b) => a.number - b.number)
    .map((e) => {
      const label = e.label || "";
      const n = label ? refCount(label) : 0;
      const sub = label
        ? `${label} · ${n === 0 ? "not referred to" : `referred to ${n}×`}`
        : undefined;
      return {
        key: `ex:${e.exampleId}`,
        entityId: e.exampleId,
        marker: `(${e.number})`,
        snippet: { kind: "example", example: e },
        sub,
        pos: e.pos,
        jump: { kind: "example", id: e.exampleId },
        card: { kind: "example", id: e.exampleId },
      };
    });
  return rows.length ? [{ key: "ex:all", label: "", rows }] : [];
}
