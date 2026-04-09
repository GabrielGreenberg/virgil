/**
 * BibTeX parsing and natbib citation formatting.
 *
 * Uses citation-js for .bib parsing and bibliography rendering.
 * Implements natbib command semantics for WYSIWYG display text.
 */

import type { BibEntry } from "./types";
import { MULTI_CITE_NAMES } from "./cite-commands";

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
// Citation command parsing (natbib + biblatex)
// ---------------------------------------------------------------------------

export interface ParsedCiteKey {
  key: string;
  prenote?: string;
  postnote?: string;
}

export interface ParsedCiteCommand {
  type: string; // normalized: "cite", "citet"/"textcite", "citep"/"parencite", "citealt", "citealp", "citeauthor", "citeyear", "citeyearpar", "autocite", "footcite", "cites", "textcites", "parencites"
  starred: boolean;
  capitalized: boolean;
  keys: string[];
  entries: ParsedCiteKey[]; // per-key with individual pre/post notes
  prenote?: string;
  postnote?: string;
}

// Natbib commands: \cite, \citet, \citep, \citealt, \citealp, \citeauthor,
// \citeyear, \citeyearpar, \citetext, \citenum, plus capitalized variants.
// Longest names listed first to avoid partial-match shadowing.
const NATBIB_HEAD_RE = /^\\(citeyearpar|citeauthor|citeyear|citealp|citealt|citetext|citenum|citep|citet|cite|Citeyearpar|Citeauthor|Citeyear|Citealp|Citealt|Citetext|Citenum|Citep|Citet|Cite)(\*?)(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]+)\}$/;

// Biblatex command head: matches the leading `\cmd*` (no arguments).
// Longer names listed first so e.g. `\footfullcite` is preferred over
// `\footcite`, and `\textcites` over `\textcite` over `\cite`.
const BIBLATEX_HEAD_RE = /^\\(footfullcite|footfullcites|fullcite|fullcites|textcites|parencites|autocites|footcites|smartcites|textcite|parencite|autocite|footcite|smartcite|citetitle|citedate|citeurl|citeauthor|citeyear|nocite|cites|cite|Footfullcite|Footfullcites|Fullcite|Fullcites|Textcites|Parencites|Autocites|Footcites|Smartcites|Textcite|Parencite|Autocite|Footcite|Smartcite|Citetitle|Citedate|Citeurl|Citeauthor|Citeyear|Nocite|Cites|Cite)(\*?)/;

/**
 * Parse a citation command string (natbib or biblatex) into its components.
 */
export function parseCiteCommand(command: string): ParsedCiteCommand | null {
  // Try natbib first
  const natbib = parseNatbibCommand(command);
  if (natbib) return natbib;

  // Try biblatex
  return parseBiblatexCommand(command);
}

/** Parse a natbib command string */
export function parseNatbibCommand(command: string): ParsedCiteCommand | null {
  const m = command.match(NATBIB_HEAD_RE);
  if (!m) return null;

  let cmdName = m[1];
  const starred = m[2] === "*";
  const capitalized = cmdName[0] === "C";
  if (capitalized) cmdName = cmdName[0].toLowerCase() + cmdName.slice(1);

  let prenote: string | undefined;
  let postnote: string | undefined;
  if (m[4] !== undefined) {
    prenote = m[3];
    postnote = m[4];
  } else if (m[3] !== undefined) {
    postnote = m[3];
  }

  const keys = m[5].split(",").map((k) => k.trim());
  // Natbib: pre/post applies to the *whole* citation (rendered once at the
  // edges). Don't put them on individual entries — the formatter reads the
  // top-level fields for natbib commands.
  const entries: ParsedCiteKey[] = keys.map((k) => ({ key: k }));
  return { type: cmdName, starred, capitalized, keys, entries, prenote, postnote };
}

/**
 * Parse a biblatex command string. Supports:
 *   - single-key:   \textcite[pre][post]{key}
 *   - multi-key in single braces: \parencite{a,b,c}  (treated like natbib)
 *   - multi-cite plural form with per-key brackets:
 *       \cites[pre1][post1]{key1}[pre2][post2]{key2}
 */
export function parseBiblatexCommand(command: string): ParsedCiteCommand | null {
  const head = command.match(BIBLATEX_HEAD_RE);
  if (!head) return null;

  let cmdName = head[1];
  const starred = head[2] === "*";
  const capitalized = cmdName[0] >= "A" && cmdName[0] <= "Z";
  if (capitalized) cmdName = cmdName[0].toLowerCase() + cmdName.slice(1);

  const isMultiCite = MULTI_CITE_NAMES.has(cmdName);

  // Walk the rest of the string consuming `[pre][post]{key}` groups.
  let rest = command.slice(head[0].length);
  const entries: ParsedCiteKey[] = [];
  const groupRe = /^(?:\[([^\]]*)\])?(?:\[([^\]]*)\])?\{([^}]*)\}/;
  while (rest.length > 0) {
    const m = rest.match(groupRe);
    if (!m) break;
    let kPre: string | undefined;
    let kPost: string | undefined;
    if (m[2] !== undefined) { kPre = m[1]; kPost = m[2]; }
    else if (m[1] !== undefined) { kPost = m[1]; }

    const keyContent = m[3].trim();
    if (!isMultiCite && keyContent.includes(",")) {
      // Singular biblatex command with comma-separated keys: split into
      // multiple entries that share the same pre/post.
      for (const k of keyContent.split(",")) {
        const trimmed = k.trim();
        if (trimmed) entries.push({ key: trimmed, prenote: kPre, postnote: kPost });
      }
    } else {
      entries.push({ key: keyContent, prenote: kPre, postnote: kPost });
    }
    rest = rest.slice(m[0].length);
  }

  if (entries.length === 0) return null;
  if (rest.trim().length > 0) return null;

  const keys = entries.map((e) => e.key);
  return {
    type: cmdName,
    starred,
    capitalized,
    keys,
    entries,
    prenote: entries[0]?.prenote,
    postnote: entries[0]?.postnote,
  };
}

// ---------------------------------------------------------------------------
// Serialize structured citation back to LaTeX command
// ---------------------------------------------------------------------------

// Biblatex commands that have a `\xxxs` plural form for multi-cite. Anything
// not in this set must use comma-separated keys in a single brace group.
const HAS_PLURAL_FORM = new Set<string>([
  "cite",
  "cites",
  "textcite",
  "textcites",
  "parencite",
  "parencites",
  "autocite",
  "autocites",
  "footcite",
  "footcites",
  "smartcite",
  "smartcites",
]);

function bracketsFor(pre: string | undefined, post: string | undefined): string {
  if (pre !== undefined && pre !== "") return `[${pre}][${post || ""}]`;
  if (post) return `[${post}]`;
  return "";
}

/** Reconstruct a LaTeX citation command from parsed components. */
export function serializeCiteCommand(
  parsed: { type: string; starred: boolean; capitalized: boolean; entries: ParsedCiteKey[] },
  bibPackage: string = "natbib"
): string {
  const { type, starred, capitalized, entries } = parsed;
  if (entries.length === 0) return "";

  const cmdBase = capitalized ? type[0].toUpperCase() + type.slice(1) : type;
  const star = starred ? "*" : "";

  if (bibPackage === "natbib") {
    // Natbib: \citep[pre][post]{key1,key2} — shared pre/post from first entry
    const brackets = bracketsFor(entries[0]?.prenote, entries[0]?.postnote);
    const keys = entries.map((e) => e.key).join(",");
    return `\\${cmdBase}${star}${brackets}{${keys}}`;
  }

  // ── Biblatex ────────────────────────────────────────────────────────
  // Single entry → singular form regardless of plural availability
  if (entries.length === 1) {
    const { key, prenote: pre, postnote: post } = entries[0];
    return `\\${cmdBase}${star}${bracketsFor(pre, post)}{${key}}`;
  }

  // Multiple entries: use plural `\xxxs` if available, otherwise fall back
  // to comma-separated keys (with shared pre/post from the first entry).
  const baseLower = cmdBase.toLowerCase();
  const hasPlural = HAS_PLURAL_FORM.has(baseLower);

  if (!hasPlural) {
    const brackets = bracketsFor(entries[0]?.prenote, entries[0]?.postnote);
    const keys = entries.map((e) => e.key).join(",");
    return `\\${cmdBase}${star}${brackets}{${keys}}`;
  }

  const pluralType = type.endsWith("s") ? type : type + "s";
  const pluralBase = capitalized ? pluralType[0].toUpperCase() + pluralType.slice(1) : pluralType;
  const parts = entries.map((e) => `${bracketsFor(e.prenote, e.postnote)}{${e.key}}`);
  return `\\${pluralBase}${star}${parts.join("")}`;
}

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
  return `${author} (${year})`;
}

// Natbib commands always read pre/post from the top-level command (it's a
// single shared annotation). Biblatex multi-cite forms read per-entry. The
// biblatex singular forms also use top-level (since there's only one entry).
const NATBIB_COMMANDS = new Set<string>([
  "cite", "citet", "citep", "citealt", "citealp",
  "citeauthor", "citeyear", "citeyearpar", "citetext", "citenum",
]);

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

export function formatInlineCitation(
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

  const { type, starred, capitalized, entries: parsedEntries, prenote, postnote } = parsed;

  // For natbib commands and biblatex single forms, the top-level prenote
  // applies before the first entry and the top-level postnote after the
  // last entry. Synthesize per-entry brackets so the rendering helpers
  // below stay simple.
  //
  // For biblatex multi-cite, brackets are already on individual entries.
  const isNatbib = NATBIB_COMMANDS.has(type) || (bibPackage === "natbib" && type === "cite");
  const useTopLevelBrackets =
    isNatbib || (parsedEntries.length === 1 && !MULTI_CITE_NAMES.has(type));

  const resolved = parsedEntries.map((pe, i) => ({
    bib: entryMap.get(pe.key),
    prenote: useTopLevelBrackets
      ? (i === 0 ? prenote : undefined)
      : pe.prenote,
    postnote: useTopLevelBrackets
      ? (i === parsedEntries.length - 1 ? postnote : undefined)
      : pe.postnote,
    key: pe.key,
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
