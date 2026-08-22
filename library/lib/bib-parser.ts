/**
 * BibTeX parsing and natbib citation formatting.
 *
 * Uses citation-js for .bib parsing and bibliography rendering.
 * Implements natbib command semantics for WYSIWYG display text.
 */

import type { BibEntry } from "./types";
import { latexToDisplayText } from "@/lib/latex-typography";

// citation-js is CJS-only; we lazy-load it to avoid SSR issues
let Cite: any = null;
function getCite() {
  if (!Cite) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Cite = require("citation-js");
  }
  return Cite;
}

// ---------------------------------------------------------------------------
// .bib file parsing
// ---------------------------------------------------------------------------

/** Strip BibTeX comment lines (lines starting with %) */
function stripBibComments(bibText: string): string {
  return bibText
    .split("\n")
    .map((line) => (line.trimStart().startsWith("%") ? "" : line))
    .join("\n");
}

/** Try to parse a single CSL-JSON item into a BibEntry */
function cslItemToEntry(
  item: Record<string, unknown>,
  rawEntries: Record<string, string>
): BibEntry {
  const key = (item["citation-key"] || item.id || "") as string;
  const type = cslTypeToBib((item.type as string) || "misc");
  const fields: Record<string, string> = {};

  if (item.author) fields.author = formatCslAuthors(item.author as Array<{ given?: string; family?: string }>);
  if (item.title) fields.title = item.title as string;
  if (item["container-title"]) fields.journal = item["container-title"] as string;
  const issued = item.issued as { "date-parts"?: number[][] } | undefined;
  if (issued?.["date-parts"]?.[0]?.[0]) {
    fields.year = String(issued["date-parts"][0][0]);
  }
  if (item.volume) fields.volume = String(item.volume);
  if (item.issue) fields.number = String(item.issue);
  if (item.page) fields.pages = item.page as string;
  if (item.publisher) fields.publisher = item.publisher as string;
  if (item["publisher-place"]) fields.address = item["publisher-place"] as string;
  if (item.DOI) fields.doi = item.DOI as string;
  if (item.URL) fields.url = item.URL as string;
  if (item.editor) fields.editor = formatCslAuthors(item.editor as Array<{ given?: string; family?: string }>);
  if (item["collection-title"]) fields.series = item["collection-title"] as string;
  if (item.edition) fields.edition = String(item.edition);
  if (item.note) fields.note = item.note as string;

  return { key, type, fields, raw: rawEntries[key.toLowerCase()] || "" };
}

// Module-level memo: parsing a large .bib via citation-js is slow,
// especially when one malformed entry forces the per-entry fallback
// path. Multiple call sites (useMasterBib, useUnsortedBibEntries,
// LibraryView's bib-picker) ask for the same text repeatedly — cache
// by content so the cost is paid once per unique file. Returning the
// same array reference on hit also keeps downstream `useMemo`s that
// key on identity stable.
const PARSE_CACHE = new Map<string, BibEntry[]>();
const PARSE_CACHE_MAX = 4;

// Warn-once-per-citekey across the session. A single broken entry
// would otherwise log on every cache miss (e.g. after the user edits
// the file and the text key changes).
const WARNED_KEYS = new Set<string>();

function rememberParse(bibText: string, entries: BibEntry[]): BibEntry[] {
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) {
    const oldest = PARSE_CACHE.keys().next().value;
    if (oldest !== undefined) PARSE_CACHE.delete(oldest);
  }
  PARSE_CACHE.set(bibText, entries);
  return entries;
}

/** Parse a .bib file string into BibEntry objects */
export function parseBibFile(bibText: string): BibEntry[] {
  const cached = PARSE_CACHE.get(bibText);
  if (cached) return cached;

  const CiteClass = getCite();
  const entries: BibEntry[] = [];
  const cleaned = stripBibComments(bibText);
  const rawEntries = extractRawEntries(cleaned);

  // Try parsing the whole file at once
  try {
    const cite = new CiteClass(cleaned);
    for (const item of cite.data) {
      entries.push(cslItemToEntry(item, rawEntries));
    }
    return rememberParse(bibText, entries);
  } catch {
    // Whole-file parse failed — try each entry individually
  }

  // Fallback: parse entries one by one, skipping broken ones
  for (const [key, raw] of Object.entries(rawEntries)) {
    try {
      const cite = new CiteClass(raw);
      for (const item of cite.data) {
        entries.push(cslItemToEntry(item, rawEntries));
      }
    } catch {
      if (!WARNED_KEYS.has(key)) {
        WARNED_KEYS.add(key);
        console.warn(`Skipping unparseable bib entry: ${key}`);
      }
    }
  }

  return rememberParse(bibText, entries);
}

/** Rebuild a .bib file string from BibEntry objects */
export function serializeBibFile(entries: BibEntry[]): string {
  return entries
    .map((e) => {
      if (e.raw) return e.raw;
      // Fallback: reconstruct from fields
      const lines = Object.entries(e.fields)
        .map(([k, v]) => `  ${k} = {${v}}`)
        .join(",\n");
      return `@${e.type}{${e.key},\n${lines}\n}`;
    })
    .join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Citation command parsing (natbib + biblatex)
// ---------------------------------------------------------------------------
//
// This file is a whole-file COPY of `src/lib/bib-parser.ts` (the fork task 341
// records), and its cite-command half had already diverged from the original
// (the empty-key filter and the `matchedGroup` guard never landed here). The
// MODEL — where a citation's `[prenote][postnote]` annotations live and how
// they are placed per key — is now `@/lib/cite-command-model`, a leaf BOTH
// silos read, so the ANSWER cannot fork again even while the RENDERING below
// stays a copy (task 403 #4).
//
// The parse/serialize half is not re-exported: nothing in `library/` consumed
// it, and a re-export with no caller is the dead-SSOT shape task 202 outlaws.

import {
  parseCiteCommand,
  resolveCiteNoteRows,
} from "@/lib/cite-command-model";

// ---------------------------------------------------------------------------
// WYSIWYG display text
// ---------------------------------------------------------------------------

/**
 * Generate the WYSIWYG inline display text for a citation command.
 * This is what appears in the editor body.
 */
/** Format author last names with et al. truncation. */
function formatAuthorLastNames(entry: BibEntry | undefined, starred: boolean, capitalized: boolean): string {
  if (!entry) return "??";
  const authorStr = entry.fields.author || "";
  const authors = authorStr.split(" and ").map((a) => a.trim());
  let result: string;
  if (starred || authors.length <= 2) {
    if (authors.length === 1) {
      result = lastNameOf(authors[0]);
    } else if (authors.length === 2) {
      result = lastNameOf(authors[0]) + " and " + lastNameOf(authors[1]);
    } else {
      result =
        authors.slice(0, -1).map(lastNameOf).join(", ") +
        ", and " +
        lastNameOf(authors[authors.length - 1]);
    }
  } else {
    result = lastNameOf(authors[0]) + " et al.";
  }
  if (capitalized && result.length > 0) {
    result = result[0].toUpperCase() + result.slice(1);
  }
  return result;
}

/** Extract year from a BibEntry, falling back to "n.d." */
function getEntryYear(entry: BibEntry | undefined): string {
  return entry?.fields.year || "n.d.";
}

/** Always returns "Author (Year)" format for a single bib key, regardless of citation command. */
export function formatMinimalCitation(key: string, bibEntries: BibEntry[]): string {
  const entry = bibEntries.find((e) => e.key === key);
  if (!entry) return key;
  const author = formatAuthorLastNames(entry, false, false);
  const year = getEntryYear(entry);
  return latexToDisplayText(`${author} (${year})`);
}

/** Returns author / year / title parts for a single bib key. Missing fields come back as empty strings. */
export function formatMediumCitationParts(
  key: string,
  bibEntries: BibEntry[],
): { author: string; year: string; title: string } {
  const entry = bibEntries.find((e) => e.key === key);
  if (!entry) return { author: key, year: "", title: "" };
  return {
    author: latexToDisplayText(formatAuthorLastNames(entry, false, false)),
    year: latexToDisplayText(getEntryYear(entry)),
    title: latexToDisplayText(entry.fields.title || ""),
  };
}

/**
 * Decode the small set of HTML entities that citation-js's bibliography
 * formatter emits (mostly numeric refs for ampersand and en-dash). The
 * inline citation slot is plain text, so we strip tags and decode entities.
 */
function htmlToInlineText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Render a single bib entry as a full bibliographic string for \fullcite /
 * \footfullcite. Falls back to a simple Author + Title (Year) sketch if
 * citation-js fails or the entry is missing from the .bib file.
 */
function renderFullEntry(
  bib: BibEntry | undefined,
  key: string,
  formatAuthor: (e: BibEntry | undefined, star: boolean, cap: boolean) => string,
  getYear: (e: BibEntry | undefined) => string,
  getTitle: (e: BibEntry | undefined) => string,
): string {
  if (!bib) return key;
  const fallback = () => `${formatAuthor(bib, true, false)}, ${getTitle(bib)} (${getYear(bib)})`;
  try {
    const html = formatBibliography(bib, "apa");
    const text = htmlToInlineText(html);
    return text || fallback();
  } catch {
    return fallback();
  }
}

/**
 * The rendered text of an inline citation. The task-368 display projection is
 * applied over the finished string — the same shape, and for the same reason,
 * as its `src/lib/bib-parser.ts` twin: this file is a whole-file COPY of that
 * one (the fork task 341 records), so a projection landed on one side only is a
 * Library app that still shows `\textasciitilde{}` to the reader.
 */
export function formatInlineCitation(
  command: string,
  bibEntries: BibEntry[],
  bibPackage: string = "natbib"
): string {
  return latexToDisplayText(
    formatInlineCitationRaw(command, bibEntries, bibPackage),
  );
}

/** Module-PRIVATE: an exported raw formatter is a second display door. */
function formatInlineCitationRaw(
  command: string,
  bibEntries: BibEntry[],
  bibPackage: string = "natbib"
): string {
  const parsed = parseCiteCommand(command);
  if (!parsed) return command; // fallback: show raw command

  const entryMap = new Map(bibEntries.map((e) => [e.key, e]));
  const formatAuthor = (entry: BibEntry | undefined, star: boolean, cap: boolean) =>
    formatAuthorLastNames(entry, star, cap);
  const getYear = (entry: BibEntry | undefined) => getEntryYear(entry);
  const getTitle = (entry: BibEntry | undefined): string =>
    entry?.fields.title || (entry ? "??" : "??");

  const { type, starred, capitalized } = parsed;

  // WHERE a note goes is the MODEL's answer, read from the same leaf the `src/`
  // twin reads (task 403). It used to be re-derived here from the command NAME
  // plus the document's package — a third convention beside the parser's and
  // the panel's.
  const resolved = resolveCiteNoteRows(parsed).map((r) => ({
    bib: entryMap.get(r.key),
    prenote: r.prenote,
    postnote: r.postnote,
    key: r.key,
  }));

  // Render helpers — each embeds a per-entry prenote (before the author) and
  // postnote (after the year) inline. This works uniformly for both natbib
  // (where pre/post is synthesized onto the first/last entry above) and for
  // biblatex multi-cite (where each entry has its own bracket annotations).

  // "pre Author, Year, post" — for parenthetical / no-paren comma styles.
  const authorComma = (r: typeof resolved[number], i: number): string => {
    const a = formatAuthor(r.bib, starred, capitalized && i === 0);
    const y = getYear(r.bib);
    const pre = r.prenote ? `${r.prenote} ` : "";
    const post = r.postnote ? `, ${r.postnote}` : "";
    return `${pre}${a}, ${y}${post}`;
  };

  // "Author (pre Year, post)" — for textual styles (citet/textcite). The
  // prenote and postnote both appear inside the year-parens.
  const authorParenYear = (r: typeof resolved[number], i: number): string => {
    const a = formatAuthor(r.bib, starred, capitalized && i === 0);
    const y = getYear(r.bib);
    const insidePre = r.prenote ? `${r.prenote} ` : "";
    const yPart = r.postnote ? `${y}, ${r.postnote}` : y;
    return `${a} (${insidePre}${yPart})`;
  };

  // "pre Author Year, post" — for citealt and biblatex \cite (no comma
  // between author and year).
  const authorSpaceYear = (r: typeof resolved[number], i: number): string => {
    const a = formatAuthor(r.bib, starred, capitalized && i === 0);
    const y = getYear(r.bib);
    const pre = r.prenote ? `${r.prenote} ` : "";
    const post = r.postnote ? `, ${r.postnote}` : "";
    return `${pre}${a} ${y}${post}`;
  };

  switch (type) {
    case "cite": {
      if (bibPackage === "biblatex") {
        // biblatex authoryear: \cite = "Author Year", \cite* = "Year"
        const parts = resolved.map((r, i) => {
          if (starred) {
            const y = getYear(r.bib);
            const pre = r.prenote ? `${r.prenote} ` : "";
            const post = r.postnote ? `, ${r.postnote}` : "";
            return `${pre}${y}${post}`;
          }
          return authorSpaceYear(r, i);
        });
        return parts.join("; ");
      }
      // natbib: \cite = \citet (Author (Year))
      const parts = resolved.map((r, i) => authorParenYear(r, i));
      return parts.join("; ");
    }

    case "citet": {
      // natbib: Author (Year)
      const parts = resolved.map((r, i) => authorParenYear(r, i));
      return parts.join("; ");
    }

    case "citep": {
      // natbib: (Author, Year)
      const parts = resolved.map((r, i) => authorComma(r, i));
      return `(${parts.join("; ")})`;
    }

    case "citealt": {
      // natbib: Author Year (no parens)
      const parts = resolved.map((r, i) => authorSpaceYear(r, i));
      return parts.join("; ");
    }

    case "citealp": {
      // natbib: Author, Year (no parens)
      const parts = resolved.map((r, i) => authorComma(r, i));
      return parts.join("; ");
    }

    case "citeauthor": {
      // Author only — starred form gives full author list
      const parts = resolved.map((r, i) =>
        formatAuthor(r.bib, starred, capitalized && i === 0)
      );
      return parts.join("; ");
    }

    case "citeyear": {
      return resolved.map((r) => getYear(r.bib)).join("; ");
    }

    case "citeyearpar": {
      return "(" + resolved.map((r) => getYear(r.bib)).join("; ") + ")";
    }

    case "citetext": {
      // Arbitrary parenthesized text — keys are the text content
      return `(${resolved.map((r) => r.key).join(", ")})`;
    }

    case "citenum": {
      // Numeric reference — we don't number entries, so show key as fallback
      return resolved.map((r) => `[${r.key}]`).join(", ");
    }

    // ── Biblatex commands ───────────────────────────────────────────────

    case "textcite":
    case "textcites": {
      // Author (Year), supporting per-entry brackets
      const parts = resolved.map((r, i) => authorParenYear(r, i));
      return parts.join("; ");
    }

    case "parencite":
    case "parencites": {
      // (Author, Year)
      const parts = resolved.map((r, i) => authorComma(r, i));
      return `(${parts.join("; ")})`;
    }

    case "cites": {
      // biblatex \cites = multiple \cite: Author Year, with per-entry brackets
      const parts = resolved.map((r, i) => {
        if (starred) {
          const y = getYear(r.bib);
          const pre = r.prenote ? `${r.prenote} ` : "";
          const post = r.postnote ? `, ${r.postnote}` : "";
          return `${pre}${y}${post}`;
        }
        return authorSpaceYear(r, i);
      });
      return parts.join("; ");
    }

    case "autocite":
    case "autocites": {
      // In authoryear style, \autocite = \parencite
      const parts = resolved.map((r, i) => authorComma(r, i));
      return `(${parts.join("; ")})`;
    }

    case "smartcite":
    case "smartcites": {
      // \smartcite is context-dependent (in footnote → footcite, otherwise
      // → parencite). We don't track surrounding context in the WYSIWYG
      // editor, so render like \parencite (the more common case).
      const parts = resolved.map((r, i) => authorComma(r, i));
      return `(${parts.join("; ")})`;
    }

    case "footcite":
    case "footcites": {
      // Footnote citation — show with explicit "fn:" prefix so the user can
      // see at a glance that this won't render inline in the printed PDF.
      const parts = resolved.map((r, i) => authorComma(r, i));
      return `[fn: ${parts.join("; ")}]`;
    }

    case "fullcite": {
      // Full bibliographic entry rendered inline. Use citation-js bibliography
      // formatting for each entry, falling back to a simple "Author, Title (Year)"
      // sketch if formatting fails or the entry is missing.
      const parts = resolved.map((r) => renderFullEntry(r.bib, r.key, formatAuthor, getYear, getTitle));
      return parts.join("; ");
    }

    case "footfullcite": {
      // Full bibliographic entry inside a footnote indicator.
      const parts = resolved.map((r) => renderFullEntry(r.bib, r.key, formatAuthor, getYear, getTitle));
      return `[fn: ${parts.join("; ")}]`;
    }

    case "citetitle": {
      // Title only. \citetitle* prints the full title; without star, biblatex
      // uses the shorttitle field if available.
      // Typographic convention: quote marks for shorter works (articles,
      // chapters, conference papers); italics for standalone works (books,
      // collections, theses).
      const QUOTED_TYPES = new Set([
        "article", "inproceedings", "incollection", "inbook", "unpublished",
      ]);
      const parts = resolved.map((r) => {
        if (!r.bib) return r.key;
        const raw = !starred && r.bib.fields.shorttitle
          ? r.bib.fields.shorttitle
          : getTitle(r.bib);
        if (QUOTED_TYPES.has(r.bib.type.toLowerCase())) {
          return `\u201C${raw}\u201D`;
        }
        return `<i>${raw}</i>`;
      });
      return parts.join("; ");
    }

    case "citedate": {
      // Date — same as citeyear for our purposes (we only store year).
      return resolved.map((r) => getYear(r.bib)).join("; ");
    }

    case "citeurl": {
      return resolved
        .map((r) => r.bib?.fields.url || r.key)
        .join("; ");
    }

    case "nocite": {
      // \nocite produces no inline output in print, but we want a visible
      // marker in the editor so the citation can be edited / removed.
      return `[nocite: ${resolved.map((r) => r.key).join(", ")}]`;
    }

    default:
      return command;
  }
}

// ---------------------------------------------------------------------------
// Bibliography formatting (via citation-js)
// ---------------------------------------------------------------------------

/**
 * Format a BibEntry as a bibliography string in the given CSL style.
 * Returns HTML string.
 */
export function formatBibliography(
  entry: BibEntry,
  style: string = "apa"
): string {
  try {
    const CiteClass = getCite();
    const cite = new CiteClass(entry.raw || reconstructBibtex(entry));
    return cite.format("bibliography", {
      format: "html",
      template: style,
      lang: "en-US",
    });
  } catch {
    // Fallback plain text
    const f = entry.fields;
    return `${f.author || "?"} (${f.year || "?"}). ${f.title || "?"}. <i>${f.journal || f.publisher || ""}</i>.`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastNameOf(author: string): string {
  // Handle "Last, First" and "First Last" formats
  const parts = author.split(",");
  if (parts.length >= 2) return parts[0].trim();
  const words = author.trim().split(/\s+/);
  return words[words.length - 1];
}

function formatCslAuthors(authors: Array<{ given?: string; family?: string }>): string {
  return authors
    .map((a) => {
      if (a.family && a.given) return `${a.family}, ${a.given}`;
      return a.family || a.given || "";
    })
    .join(" and ");
}

function cslTypeToBib(cslType: string): string {
  const map: Record<string, string> = {
    "article-journal": "article",
    "article-magazine": "article",
    book: "book",
    chapter: "incollection",
    "paper-conference": "inproceedings",
    thesis: "phdthesis",
    report: "techreport",
    manuscript: "unpublished",
  };
  return map[cslType] || "misc";
}

function reconstructBibtex(entry: BibEntry): string {
  const lines = Object.entries(entry.fields)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${entry.type}{${entry.key},\n${lines}\n}`;
}

/** Extract raw BibTeX entries from source text, keyed by lowercase cite key */
function extractRawEntries(bibText: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /@\w+\s*\{([^,]+),/g;
  let match;
  while ((match = re.exec(bibText)) !== null) {
    const key = match[1].trim();
    const start = match.index;
    // Find matching closing brace
    let depth = 0;
    let end = start;
    for (let i = bibText.indexOf("{", start); i < bibText.length; i++) {
      if (bibText[i] === "{") depth++;
      else if (bibText[i] === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    result[key.toLowerCase()] = bibText.slice(start, end);
  }
  return result;
}
