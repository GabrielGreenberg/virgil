/**
 * BibTeX parsing and natbib citation formatting.
 *
 * Uses citation-js for .bib parsing and bibliography rendering.
 * Implements natbib command semantics for WYSIWYG display text.
 */

import type { BibEntry } from "./types";
import { mintBibUid, orderedVbidBindings, serializeVbidMarker } from "./bib-uid";
import { latexToDisplayText } from "./latex-typography";
import { parseCiteCommand, resolveCiteNoteRows } from "./cite-command-model";

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

/**
 * Try to parse a single CSL-JSON item into a BibEntry.
 *
 * `raw` and `uid` are supplied by the caller (paired to the source block by
 * position, not by citekey) so that two entries sharing a citekey get their
 * own `raw` block and their own durable `uid` instead of both collapsing onto
 * the last-write-wins keyed lookup.
 */
function cslItemToEntry(
  item: Record<string, unknown>,
  raw: string,
  uid: string,
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

  return { uid, key, type, fields, raw };
}

/**
 * A raw BibTeX block in source order, with its citekey, its source-byte start
 * (so a `\vbid` marker can be associated by position) and any `\vbid` uid that
 * immediately precedes it.
 */
interface OrderedRawBlock {
  key: string;
  raw: string;
  start: number;
  /** uid recovered from a preceding `\vbid{}` marker, or undefined → mint. */
  vbidUid?: string;
}

/**
 * Extract raw BibTeX blocks from source text IN SOURCE ORDER (not keyed by
 * citekey), each paired with any `\vbid{}` uid that precedes it. Two blocks
 * that share a citekey produce two ordered entries — the parser pairs them
 * positionally with citation-js's per-block items, so neither the `raw` nor
 * the `uid` collapses.
 */
function extractOrderedRawBlocks(bibText: string): OrderedRawBlock[] {
  const bindings = orderedVbidBindings(bibText);
  const result: OrderedRawBlock[] = [];
  const re = /@\w+\s*\{([^,]+),/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(bibText)) !== null) {
    const key = match[1].trim();
    const start = match.index;
    // Find matching closing brace from the first `{` after the `@type` token.
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
    // A `\vbid` marker binds to this block iff its bound entry-head start
    // matches this block's start (orderedVbidBindings binds positionally).
    const binding = bindings.find((b) => b.entryStart === start);
    result.push({ key, raw: bibText.slice(start, end), start, vbidUid: binding?.uid });
  }
  return result;
}

// Module-level memo: parsing a large .bib via citation-js is slow,
// especially when one malformed entry forces the per-entry fallback
// path. Multiple call sites (useCitations mounted per-doc, library
// hooks) ask for the same text repeatedly — cache by content so the
// cost is paid once per unique file. Insertion-order Map = simple LRU;
// the cap matches the realistic working set (master.bib + 1–2 project
// bibs + the occasional variant). Returning the same array reference
// on hit also keeps downstream `useMemo`s that key on identity stable.
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
  // Source-ordered raw blocks (with any preceding `\vbid` uid). Two blocks
  // that share a citekey appear as two ordered entries — the basis for
  // distinct-uid-per-block.
  const blocks = extractOrderedRawBlocks(cleaned);
  // Mint into a live collision set so a markerless file gets unique uids and
  // any pre-existing `\vbid` uid is reserved against fresh mints.
  const usedUids = new Set<string>();
  for (const b of blocks) if (b.vbidUid) usedUids.add(b.vbidUid);

  // Positional cursor over `blocks`: pair each parsed item with the next
  // unconsumed block whose citekey matches (case-insensitive), falling back to
  // strict source order if citation-js dropped/reordered an item. Each block
  // is consumed at most once so duplicate citekeys keep their own raw + uid.
  const consumed = new Array<boolean>(blocks.length).fill(false);
  const takeBlock = (key: string): OrderedRawBlock | undefined => {
    const lc = key.toLowerCase();
    let idx = blocks.findIndex((b, i) => !consumed[i] && b.key.toLowerCase() === lc);
    if (idx === -1) idx = consumed.findIndex((c) => !c); // positional fallback
    if (idx === -1) return undefined;
    consumed[idx] = true;
    return blocks[idx];
  };
  const uidForBlock = (block: OrderedRawBlock | undefined): string => {
    if (block?.vbidUid) return block.vbidUid;
    const fresh = mintBibUid(usedUids);
    usedUids.add(fresh);
    return fresh;
  };

  // Try parsing the whole file at once
  try {
    const cite = new CiteClass(cleaned);
    for (const item of cite.data) {
      const key = (item["citation-key"] || item.id || "") as string;
      const block = takeBlock(key);
      entries.push(cslItemToEntry(item, block?.raw ?? "", uidForBlock(block)));
    }
    return rememberParse(bibText, entries);
  } catch {
    // Whole-file parse failed — try each entry individually
  }

  // Fallback: parse entries one by one (in source order), skipping broken
  // ones. Each block carries its own raw + uid, so duplicate citekeys survive.
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const cite = new CiteClass(block.raw);
      for (const item of cite.data) {
        consumed[i] = true;
        entries.push(cslItemToEntry(item, block.raw, uidForBlock(block)));
      }
    } catch {
      if (!WARNED_KEYS.has(block.key)) {
        WARNED_KEYS.add(block.key);
        console.warn(`Skipping unparseable bib entry: ${block.key}`);
      }
    }
  }

  return rememberParse(bibText, entries);
}

/**
 * Rebuild a .bib file string from BibEntry objects.
 *
 * Each entry is preceded by its durable `\vbid{<uid>}` marker (a no-op LaTeX
 * macro declared in the `.tex` preamble) so the surrogate id round-trips: the
 * marker is excluded from the entry's `raw` slice on the next parse and is
 * tolerated by citation-js as ignorable inter-entry text. An entry with no uid
 * (legacy in-memory literal that predates Stage 0) emits no marker.
 */
export function serializeBibFile(entries: BibEntry[]): string {
  return entries
    .map((e) => {
      const marker = e.uid ? `${serializeVbidMarker(e.uid)}\n` : "";
      if (e.raw) return marker + e.raw;
      // Fallback: reconstruct from fields
      const lines = Object.entries(e.fields)
        .map(([k, v]) => `  ${k} = {${v}}`)
        .join(",\n");
      return `${marker}@${e.type}{${e.key},\n${lines}\n}`;
    })
    .join("\n\n") + "\n";
}

/**
 * Serialize a set of entries to a standalone `.bib` file for EXPORT (the
 * "Export cited.bib" action) — never the raw-passthrough that drops entries.
 *
 * Why this exists (BIB-F7-01, DATA-LOSS): the export site used to do
 * `entries.map(e => e.raw).filter(Boolean)`, which SILENTLY DROPS any entry
 * whose `raw` is empty — exactly the case for an entry assembled in memory
 * ("Save under new citekey", a library add, `/editor/find-citation`) that was
 * never round-tripped through a parse. The user exports a cited.bib that's
 * missing a cited reference and never knows. The fix is to reconstruct EVERY
 * entry through the serializer (which already rebuilds from `fields` when
 * `raw === ""`), so no entry can vanish on the way out.
 *
 * The export deliberately OMITS the `\vbid{...}` durable-id markers
 * `serializeBibFile` emits: those are Virgil's internal surrogate-id round-trip
 * and have no meaning in a `.bib` handed to an external bibliography manager (a
 * fresh `uid` is minted on the next import anyway). An entry with a non-empty
 * `raw` keeps its byte-exact source block (preserving the user's field order /
 * formatting); an entry with empty `raw` is reconstructed from `fields`.
 */
export function serializeBibForExport(entries: BibEntry[]): string {
  return (
    entries
      .map((e) => (e.raw ? e.raw : reconstructBibtex(e)))
      .join("\n\n") + "\n"
  );
}

// ---------------------------------------------------------------------------
// Citation command parsing (natbib + biblatex)
// ---------------------------------------------------------------------------
//
// The MODEL — where a citation's `[prenote][postnote]` annotations live, how
// they are placed per key, and how the two directions are held to each other —
// is `@/lib/cite-command-model`. It is a LEAF so that BOTH this file and the
// Library silo's whole-file copy read the same answer instead of each keeping
// its own (task 403: "one datum, two homes, the reader picks by convention").
// Re-exported here so every existing importer of `@/lib/bib-parser` is
// unchanged.

export type {
  ParsedCiteKey,
  ParsedCiteCommand,
  WholeNoteCiteCommand,
  PerKeyNoteCiteCommand,
  CiteNoteScope,
  CiteSerializeInput,
} from "./cite-command-model";
export {
  parseCiteCommand,
  parseNatbibCommand,
  parseBiblatexCommand,
  resolveCiteNoteRows,
  serializeCiteCommand,
  singularBaseOf,
  hasPluralForm,
  derivePlural,
  citeNotesDroppedByPackage,
} from "./cite-command-model";

/**
 * The single keyless-citation predicate, shared by the THREE sites that must
 * agree on the "is this citation command anchorable?" invariant
 * (button-disabled ⇔ spec-declines):
 *   1. `CitationCard.dropDisabled` — the upstream disabled drop button,
 *   2. `useCitations.commandFor` — the create-branch command source,
 *   3. `citationDropSpec.createAtom` — the downstream decline guard.
 *
 * Returns the command UNCHANGED when it parses to at least one real citekey
 * (anchorable → would plant a serializable `\cite{…}`), and `null` for an
 * empty / keyless draft (`''`, `\cite{}`, a command with no keys) — where
 * anchoring would plant a `\cite{}` atom that can never serialize. Keeping one
 * predicate means the button can never enable a drop the spec would silently
 * decline, and vice-versa.
 */
export function citationCommandOrNull(
  command: string | null | undefined,
): string | null {
  if (!command) return null;
  const parsed = parseCiteCommand(command);
  if (!parsed || parsed.keys.length === 0) return null;
  return command;
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

/**
 * Format an author field as comma-joined last names, truncated to the
 * first `maxNames` then ", …". Used by the cross-library picker row
 * where a single line must read at a glance.
 *
 *   1 author:   "Smith"
 *   2 authors:  "Smith and Jones"
 *   3 authors:  "Smith, Jones, and Brown"
 *   N > max:    "Smith, Jones, Brown, …"
 */
export function formatAuthorsTruncated(authorStr: string, maxNames = 3): string {
  if (!authorStr) return "";
  const authors = authorStr.split(" and ").map((a) => a.trim()).filter(Boolean);
  if (authors.length === 0) return "";
  if (authors.length === 1) return latexToDisplayText(lastNameOf(authors[0]));
  if (authors.length === 2)
    return latexToDisplayText(
      lastNameOf(authors[0]) + " and " + lastNameOf(authors[1]),
    );
  if (authors.length <= maxNames) {
    return latexToDisplayText(
      authors.slice(0, -1).map(lastNameOf).join(", ") +
        ", and " +
        lastNameOf(authors[authors.length - 1]),
    );
  }
  return latexToDisplayText(
    authors.slice(0, maxNames).map(lastNameOf).join(", ") + ", …",
  );
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
 * SECURITY (backlog #28): `formatInlineCitation` interpolates raw `.bib`
 * field text (titles, authors) into its output, and the only intentional
 * markup it ever emits is `<i>…</i>` (a `\citetitle` of a standalone work).
 * The Citations panel preview is the sole consumer that renders this string
 * as HTML (`dangerouslySetInnerHTML`); every other consumer treats it as
 * plain text. A `.bib` entry carrying markup/script (fetched from an external
 * source by find-citation, or a shared paper's references.bib) would inject
 * live nodes there.
 *
 * Allowlist sanitizer for that one HTML sink: escape EVERY angle bracket and
 * ampersand first (so no field text can form a tag), then restore only the
 * known-safe italic/bold pairs the formatters emit. The result has at most
 * literal `<i>`, `</i>`, `<b>`, `</b>` tags; all field-derived text is
 * escaped. Do NOT apply this at the formatter source — the plain-text
 * consumers must not see escaped entities.
 */
export function sanitizeInlineCitationHtml(input: string): string {
  const escaped = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/&lt;(\/?)(i|b)&gt;/g, (_m, slash: string, tag: string) => `<${slash}${tag}>`);
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
 * The rendered text of an inline citation — what the chip, the panel rows, the
 * card meta and every float body show.
 *
 * The task-368 display projection is applied HERE, over the finished string,
 * rather than at the ten places raw bytes are interpolated into it. Two of
 * those ten are the `[prenote][postnote]` annotations Gabriel reported
 * (`\citep[ex.\textasciitilde{}38, p.\textasciitilde{}22]{k}` displayed the
 * four literal words "textasciitilde"); the other eight are `.bib` FIELD text
 * — `author`, `year`, `title`, and citation-js's whole `\fullcite` rendering —
 * which reach every one of those surfaces just as raw. Projecting the output
 * once covers every command branch, including the ones a future dispatch case
 * adds, and there is no per-branch decision for anyone to forget.
 *
 * DISPLAY ONLY. The stored `command` attr and the `.bib` bytes are untouched;
 * see {@link latexToDisplayText}.
 */
export function formatInlineCitation(
  command: string,
  bibEntries: BibEntry[],
  bibPackage: string = "natbib",
  entryMap?: Map<string, BibEntry>,
): string {
  return latexToDisplayText(
    formatInlineCitationRaw(command, bibEntries, bibPackage, entryMap),
  );
}

/**
 * The dispatch itself. Module-PRIVATE, and that is load-bearing rather than
 * tidy: an exported raw formatter is a second display door, and the one a
 * caller reaches for is the one that skips the projection.
 */
function formatInlineCitationRaw(
  command: string,
  bibEntries: BibEntry[],
  bibPackage: string = "natbib",
  entryMap?: Map<string, BibEntry>,
): string {
  const parsed = parseCiteCommand(command);
  if (!parsed) return command; // fallback: show raw command

  const map = entryMap ?? new Map(bibEntries.map((e) => [e.key, e]));
  const formatAuthor = (entry: BibEntry | undefined, star: boolean, cap: boolean) =>
    formatAuthorLastNames(entry, star, cap);
  const getYear = (entry: BibEntry | undefined) => getEntryYear(entry);
  const getTitle = (entry: BibEntry | undefined): string =>
    entry?.fields.title || (entry ? "??" : "??");

  const { type, starred, capitalized } = parsed;

  // WHERE a note goes is the MODEL's answer, not this renderer's guess. It used
  // to be re-derived here from the command NAME plus the document's package
  // (`NATBIB_COMMANDS.has(type) || …`) while the panel's rows re-derived it a
  // second, DIFFERENT way — the fork task 403 closed. `resolveCiteNoteRows`
  // places a whole-citation note where LaTeX renders it (prenote before the
  // first key, postnote after the last) and leaves a per-key note where the
  // author put it.
  const resolved = resolveCiteNoteRows(parsed).map((r) => ({
    bib: map.get(r.key),
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
