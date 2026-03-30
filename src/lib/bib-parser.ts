/**
 * BibTeX parsing and natbib citation formatting.
 *
 * Uses citation-js for .bib parsing and bibliography rendering.
 * Implements natbib command semantics for WYSIWYG display text.
 */

import type { BibEntry } from "./types";

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

/** Parse a .bib file string into BibEntry objects */
export function parseBibFile(bibText: string): BibEntry[] {
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
    return entries;
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
      // Skip this entry but log it
      console.warn(`Skipping unparseable bib entry: ${key}`);
    }
  }

  return entries;
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
// Natbib command parsing
// ---------------------------------------------------------------------------

export interface ParsedCiteCommand {
  type: string; // "cite", "citet", "citep", "citealt", "citealp", "citeauthor", "citeyear", "citeyearpar"
  starred: boolean;
  capitalized: boolean;
  keys: string[];
  prenote?: string;
  postnote?: string;
}

/**
 * Parse a natbib command string into its components.
 * E.g. "\\citep*[see][ch.2]{jones1990,smith2001}"
 */
export function parseNatbibCommand(command: string): ParsedCiteCommand | null {
  const m = command.match(
    /^\\(Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citep|Citet|Cite|citeyearpar|citeauthor|citeyear|citealp|citealt|citep|citet|cite)(\*?)(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]+)\}$/
  );
  if (!m) return null;

  let cmdName = m[1];
  const starred = m[2] === "*";
  const capitalized = cmdName[0] === "C";
  if (capitalized) cmdName = cmdName[0].toLowerCase() + cmdName.slice(1);

  // With two optional args: first is prenote, second is postnote
  // With one optional arg: it's postnote
  let prenote: string | undefined;
  let postnote: string | undefined;
  if (m[4] !== undefined) {
    prenote = m[3];
    postnote = m[4];
  } else if (m[3] !== undefined) {
    postnote = m[3];
  }

  const keys = m[5].split(",").map((k) => k.trim());

  return { type: cmdName, starred, capitalized, keys, prenote, postnote };
}

// ---------------------------------------------------------------------------
// WYSIWYG display text
// ---------------------------------------------------------------------------

/**
 * Generate the WYSIWYG inline display text for a natbib command.
 * This is what appears in the editor body.
 */
export function formatInlineCitation(
  command: string,
  bibEntries: BibEntry[]
): string {
  const parsed = parseNatbibCommand(command);
  if (!parsed) return command; // fallback: show raw command

  const entryMap = new Map(bibEntries.map((e) => [e.key, e]));

  const formatAuthor = (entry: BibEntry | undefined, star: boolean, cap: boolean): string => {
    if (!entry) return "??";
    const authorStr = entry.fields.author || "";
    const authors = authorStr.split(" and ").map((a) => a.trim());
    let result: string;
    if (star || authors.length <= 2) {
      // Full list
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
    if (cap && result.length > 0) {
      result = result[0].toUpperCase() + result.slice(1);
    }
    return result;
  };

  const getYear = (entry: BibEntry | undefined): string => {
    return entry?.fields.year || "n.d.";
  };

  const { type, starred, capitalized, keys, prenote, postnote } = parsed;

  // Build parts for each key
  const entries = keys.map((k) => entryMap.get(k));

  switch (type) {
    case "citet": {
      // Jones et al. (1990); Smith (2001)
      const parts = entries.map((e, i) => {
        const a = formatAuthor(e, starred, capitalized && i === 0);
        const y = getYear(e);
        const yPart = postnote ? `${y}, ${postnote}` : y;
        return `${a} (${i === 0 && prenote ? prenote + " " : ""}${yPart})`;
      });
      return parts.join("; ");
    }

    case "citep": {
      // (Jones et al., 1990; Smith, 2001)
      const parts = entries.map((e, i) => {
        const a = formatAuthor(e, starred, capitalized && i === 0);
        const y = getYear(e);
        return `${a}, ${y}`;
      });
      const inner = parts.join("; ");
      const pre = prenote ? prenote + " " : "";
      const post = postnote ? ", " + postnote : "";
      return `(${pre}${inner}${post})`;
    }

    case "citealt": {
      // Jones et al. 1990
      const parts = entries.map((e, i) => {
        const a = formatAuthor(e, starred, capitalized && i === 0);
        return `${a} ${getYear(e)}`;
      });
      return parts.join("; ");
    }

    case "citealp": {
      // Jones et al., 1990
      const parts = entries.map((e, i) => {
        const a = formatAuthor(e, starred, capitalized && i === 0);
        return `${a}, ${getYear(e)}`;
      });
      const inner = parts.join("; ");
      const pre = prenote ? prenote + " " : "";
      const post = postnote ? ", " + postnote : "";
      return `${pre}${inner}${post}`;
    }

    case "citeauthor": {
      const parts = entries.map((e, i) =>
        formatAuthor(e, starred, capitalized && i === 0)
      );
      return parts.join("; ");
    }

    case "citeyear": {
      return entries.map(getYear).join("; ");
    }

    case "citeyearpar": {
      return "(" + entries.map(getYear).join("; ") + ")";
    }

    case "cite": {
      // \cite behaves like \citet in author-year mode
      const parts = entries.map((e, i) => {
        const a = formatAuthor(e, starred, capitalized && i === 0);
        const y = getYear(e);
        return `${a} (${y})`;
      });
      return parts.join("; ");
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
