/**
 * THE BibTeX SOURCE scanner — "where in the file is this block, and where in
 * the block is this field" (task 688).
 *
 * ## Why this module exists
 *
 * `references.bib` is the user's only copy of their bibliography, and Virgil's
 * `BibEntry` is a **projection** of it, not a reconstruction of it. Until task
 * 688 the app pretended otherwise: every panel write did
 * `read → parse → mutate the list → re-emit the WHOLE file from the list`, so
 * anything the parse could not represent did not exist at write time and was
 * gone — a `@string` macro, a header comment, a sibling block citation-js
 * could not read, and every field outside a 16-name whitelist (`isbn`,
 * `keywords`, `abstract`, `annote`, `month`, `booktitle`, …). Editing ONE
 * field of ONE entry destroyed all of it, silently, in the file the `.tex`
 * cites.
 *
 * The Library's Python silo settled this in task 168 with one sentence —
 * *upsert, don't re-emit* (`library/scripts/_bib_parse.py::upsert_entry_text`)
 * — and the TypeScript side never got it. This module is that rule, ported and
 * generalized:
 *
 * > **A bib write is a SPLICE, never a rebuild — at BOTH levels.** An entry's
 * > new block replaces exactly its own source span in the original file text;
 * > a field's new value replaces exactly its own span in the original block.
 * > Bytes nobody edited are never re-emitted, so they cannot be lost.
 *
 * It is the same discipline the `.tex` write path already keeps ("the
 * RENDERING never compiles — the round trip preserves the source"), applied to
 * the one content file that did not.
 *
 * ## The scanner
 *
 * {@link scanBibSource} replaces the old comma-terminated head regex
 * (`/@\w+\s*\{([^,]+),/g`), whose `[^,]+` crossed braces and newlines: on a
 * file carrying `@string{jphil = {Journal of Philosophy}}` it ran THROUGH the
 * macro and into the next entry's head, so the following `@article` was never
 * extracted and its `raw` was paired with the macro's text. This scanner is
 * linear, quote- and brace-aware, and recognises `@string` / `@preamble` /
 * `@comment` as their own block kind.
 *
 * ## The refusals
 *
 * The Python door's three refusals are ported verbatim in spirit, because the
 * same two directions of wrongness exist here: an UNBALANCED block's extent is
 * a guess, and a block that balances LATE (a `{` surplus in one value paired
 * with a `}` surplus in a later one) has a span that runs straight THROUGH a
 * real intervening entry. Splicing either one deletes a neighbour. So a splice
 * that cannot be guaranteed is REFUSED (`null`) and said on the refusal
 * channel — never written and hoped for.
 *
 * bib-display-exempt-file: non-display. This module never renders — its
 * `fields` is a list of {@link BibFieldSpan}, OFFSETS into source text rather
 * than a field map, and the one place a field VALUE is handled is the splice
 * itself, which writes the caller's bytes into the user's file. A display
 * projection applied here would put the projection on disk.
 */

/** What a scanned `@…{…}` block is. */
export type BibBlockKind =
  /** `@article{key, …}` — a reference with a citekey and fields. */
  | "entry"
  /** `@string{…}` / `@preamble{…}` / `@comment{…}` — no citekey, no fields. */
  | "macro";

/** A `@…{…}` block located in a `.bib` source string. */
export interface BibSourceBlock {
  kind: BibBlockKind;
  /** Lower-cased `@type` token, without the `@`. */
  type: string;
  /** Citekey, trimmed. `""` for a macro block. */
  key: string;
  /** Offset of the `@`. `text.slice(start, end)` is the block. */
  start: number;
  /** Offset of the block's opening delimiter — `{`, or `(` in the parenthesised form. */
  open: number;
  end: number;
  /**
   * Did the brace walk return to depth 0 inside this block? `false` means the
   * extent is a GUESS (capped at the next line-anchored opener) — a writer must
   * refuse to splice it (Python refusal 1).
   */
  balanced: boolean;
  /** Offset just after the head comma (entry), or after the `{` (macro). */
  bodyStart: number;
}

/** A `name = value` field located inside an entry block. */
export interface BibFieldSpan {
  /** Lower-cased field name. */
  name: string;
  /** Offset of the first character of the name, relative to the block. */
  start: number;
  /** Offset just past the value's closing delimiter, relative to the block. */
  end: number;
  /** Offset of the first character of the value's CONTENT. */
  valueStart: number;
  /** Offset just past the last character of the value's content. */
  valueEnd: number;
  /**
   * How the value is delimited — a bare value is a macro reference or number.
   * `"concat"` is a `#`-joined expression of several terms (`"A" # vol`); its
   * `valueStart`/`valueEnd` cover the WHOLE expression, delimiters included,
   * because no one term is "the value" (task 1519).
   */
  delimiter: "brace" | "quote" | "bare" | "concat";
}

/** `@type` tokens that are BibTeX declarations rather than references. */
const MACRO_TYPES = new Set(["string", "preamble", "comment"]);

/**
 * Field names that mean the same thing under different spellings. When a
 * splice is asked to set a modelled name the block does not carry, it writes
 * into whichever ALIAS the block already has, under the source's own spelling
 * — so an `@incollection`'s `booktitle` is not silently renamed to `journal`
 * just because the CSL projection calls both `container-title`.
 *
 * One list per meaning; membership is symmetric.
 */
const FIELD_ALIASES: readonly (readonly string[])[] = [
  ["journal", "journaltitle", "booktitle", "container-title"],
  ["number", "issue"],
  ["pages", "page"],
  ["address", "location"],
  ["year", "date"],
];

/** Every spelling that means the same thing as `name` (including `name`). */
export function fieldAliasesOf(name: string): string[] {
  const lc = name.toLowerCase();
  const group = FIELD_ALIASES.find((g) => g.includes(lc));
  return group ? [...group] : [lc];
}

/**
 * THE comment model of a `.bib` source (task 1519): MASK every line whose first
 * non-blank character is `%`, replacing it with the same number of spaces.
 *
 * Length-preserving is load-bearing (task 688): every scan in this module runs
 * on the masked text while every `raw` slice and every splice offset is taken
 * against the ORIGINAL, so the two share one coordinate system and the `%`
 * note itself survives every write byte-for-byte.
 *
 * It is ONE model because there used to be two. The parser masked before it
 * located blocks (task 1156), but the field scanner, the splice's own re-scan,
 * the balance check and the `\vbid` binder all read the text raw — so a
 * `% note, the title below is wrong` line hid the field after it (a set
 * appended a duplicate, a remove did nothing), a `% checked {against print`
 * made the block "unbalanced" and refused every edit to it, and a commented-out
 * `% @article{old2019,` was read as an entry head that stole the next entry's
 * `\vbid`. Every scanner now masks through here, idempotently.
 *
 * Only LINE-anchored comments: a `%` mid-line inside a value (`{100% sure}`)
 * is text — the same rule the parser hands citation-js.
 */
export function maskBibComments(text: string): string {
  if (!text.includes("%")) return text;
  return text
    .split("\n")
    .map((line) => (line.trimStart().startsWith("%") ? " ".repeat(line.length) : line))
    .join("\n");
}

/** Is `ch` a BibTeX name character (a field name / `@type` token)? */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_+:.\-]/.test(ch);
}

/**
 * THE delimiting rule — the one walk every scan in this module goes through,
 * so the block walk, the citekey head, the field values and the macro-term
 * reader cannot disagree about where something ends (task 1156).
 *
 * It is BibTeX's own rule (and citation-js's), which task 614 settled for the
 * Python silo (`bib_resolve.find_entry_span`):
 *
 * - **Brace depth is the only structure.** `{` / `}` nest everywhere.
 * - **A `"` is a delimiter only where a VALUE starts** — at the block's own
 *   level, after an entry's citekey head (a `"` in `@misc{a"b, …}` is part of
 *   the key, as citation-js reads it). Inside a braced value it is a literal
 *   character, so a babel
 *   shorthand `title = {"Uber …}` or `{The 7" single}` no longer opens a quote
 *   that nothing can close (which made the whole entry "unbalanced": every
 *   edit refused, its later fields lost, the export dropping it).
 * - Inside a quoted value braces still nest, and a stray `}` there is LITERAL —
 *   it can never close the block, so `note = "a } b"` does not truncate it.
 * - **A block may be `@type{…}` or `@type(…)`.** In the parenthesised form the
 *   `)` closes only at brace depth 0 outside a quote; braces nest inside it.
 * - `\{` / `\}` / `\"` are literal characters.
 *
 * `open` is the offset of the opening delimiter. In `"entry"` / `"macro"` mode
 * it is a block's `{` or `(` and quotes delimit at its top level — for an
 * entry, only once its head comma has passed. In `"value"` mode it is a braced
 * value's `{` and nothing but braces counts. With `stopAtComma`, the walk also
 * stops at the first top-level `,` (the citekey head's end).
 *
 * Returns the offset OF the stop character (the closer, or the comma), or `-1`
 * if the walk reached `limit` without one.
 */
type WalkMode = "entry" | "macro" | "value";

function walkDelimited(
  text: string,
  open: number,
  limit: number,
  mode: WalkMode,
  stopAtComma = false,
): number {
  const closer = text[open] === "(" ? ")" : "}";
  let depth = 0; // brace depth INSIDE the outer delimiter
  let inQuote = false;
  let inHead = mode === "entry"; // an entry's citekey runs to its first comma
  for (let i = open + 1; i < limit; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++; // escaped character — never a delimiter
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth--;
      continue;
    }
    if (depth > 0) continue; // inside a braced value: `"` , `)` and `,` are text
    if (inQuote) {
      if (ch === '"') inQuote = false;
      continue; // a stray `}` / `)` / `,` inside a quoted value is literal
    }
    if (ch === closer) return i;
    if (mode === "value") continue;
    if (ch === ",") {
      if (stopAtComma) return i;
      inHead = false;
    } else if (ch === '"' && !inHead) inQuote = true;
  }
  return -1;
}

/**
 * Walk from a block's (or a braced value's) opening delimiter to its matching
 * close via {@link walkDelimited}. Returns the offset just past the closer, or
 * `-1` if it never closed.
 */
function walkBlockBody(text: string, open: number, limit: number, mode: WalkMode): number {
  const close = walkDelimited(text, open, limit, mode);
  return close === -1 ? -1 : close + 1;
}

/**
 * From the opening `"` of a quoted value, the offset of its closing `"` (the
 * first unescaped one at brace depth 0 — braces nest inside), or `-1`.
 */
function walkQuotedValue(text: string, openQuote: number, limit: number): number {
  let depth = 0;
  for (let j = openQuote + 1; j < limit; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      if (depth > 0) depth--;
    } else if (ch === '"' && depth === 0) return j;
  }
  return -1;
}

/**
 * Offsets of every line-anchored `@type{` opener in `text`.
 *
 * The RAW form, deliberately — not {@link scanBibSource}'s blocks. A writer
 * asking "does this span contain an opener other than its own?" must count
 * what a naive reader would see, because the late-balance case it is guarding
 * against is precisely the one where the scanner's own containment has already
 * swallowed the intervening entry.
 */
export function lineAnchoredOpeners(text: string): number[] {
  const re = /^\ufeff?[ \t]*@\w+[ \t]*[{(]/gm; // a leading BOM is not text before the opener
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m.index + m[0].indexOf("@"));
  return out;
}

/**
 * Scan a `.bib` source string into its `@…{…}` blocks, IN SOURCE ORDER.
 *
 * Linear, so containment is structural rather than a guard: the scan resumes
 * at the END of each block, which means a `@article{fake,` sitting inside a
 * `note = {…}` value is never mistaken for a sibling (the Python silo's Hazard
 * 5(b), for free). An unbalanced block is CAPPED at the next line-anchored
 * opener and marked `balanced: false`, so one malformed entry can never
 * swallow the rest of the file.
 *
 * Everything OUTSIDE the returned spans — the header comment block, `%` notes,
 * `\vbid{}` markers, blank lines — is free text this module never touches.
 * The scan runs on {@link maskBibComments}' view, so offsets are the source's.
 */
export function scanBibSource(source: string): BibSourceBlock[] {
  // Comment lines are blank to the scan (task 1519) — a `% @article{old,` is
  // not a block, and a brace inside a `%` note does not unbalance one.
  const text = maskBibComments(source);
  const blocks: BibSourceBlock[] = [];
  const openers = lineAnchoredOpeners(text);
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@", i);
    if (at === -1) break;
    let j = at + 1;
    while (j < text.length && isWordChar(text[j])) j++;
    const type = text.slice(at + 1, j);
    if (!type) {
      i = at + 1;
      continue;
    }
    while (j < text.length && /\s/.test(text[j])) j++;
    if (text[j] !== "{" && text[j] !== "(") {
      i = at + 1;
      continue;
    }
    // `{` or BibTeX's parenthesised `(` — the delimiting rule handles both, so
    // the scan agrees with citation-js about which blocks exist (task 1156).
    const openBrace = j;
    const lcType = type.toLowerCase();
    const isMacro = MACRO_TYPES.has(lcType);
    let end = walkBlockBody(text, openBrace, text.length, isMacro ? "macro" : "entry");
    const balanced = end !== -1;
    if (!balanced) {
      const nextOpener = openers.find((o) => o > at);
      end = nextOpener ?? text.length;
    }
    if (isMacro) {
      blocks.push({ kind: "macro", type: lcType, key: "", start: at, open: openBrace, end, balanced, bodyStart: openBrace + 1 });
    } else {
      // The citekey runs to the first `,` at the head's own depth. A block with
      // no comma at all (`@misc{key}`) is still an entry: its key is the body.
      const comma = walkDelimited(text, openBrace, end, "entry", true);
      // (A stop at the closer, not a comma, means "no comma".)
      const isComma = comma !== -1 && text[comma] === ",";
      const keyEnd = !isComma ? Math.max(openBrace + 1, end - 1) : comma;
      const key = text.slice(openBrace + 1, keyEnd).trim();
      blocks.push({
        kind: "entry",
        type: lcType,
        key,
        start: at,
        open: openBrace,
        end,
        balanced,
        bodyStart: !isComma ? keyEnd : comma + 1,
      });
    }
    i = Math.max(end, at + 1);
  }
  return blocks;
}

/** One value TERM — `{…}`, `"…"`, or a bare macro name / number. */
interface ValueTerm {
  /** Offset of the term's first character (its delimiter, if any). */
  start: number;
  /** Offset just past the term. */
  end: number;
  delimiter: "brace" | "quote" | "bare";
}

/**
 * Read ONE term starting at `i`, or `null` if none can be read there (an
 * unclosed delimiter, or a character no term starts with).
 */
function readValueTerm(text: string, i: number, bodyEnd: number): ValueTerm | null {
  if (text[i] === "{") {
    const close = walkBlockBody(text, i, bodyEnd + 1, "value");
    return close === -1 ? null : { start: i, end: close, delimiter: "brace" };
  }
  if (text[i] === '"') {
    const j = walkQuotedValue(text, i, bodyEnd);
    return j === -1 ? null : { start: i, end: j + 1, delimiter: "quote" };
  }
  let j = i;
  while (j < bodyEnd && isWordChar(text[j])) j++;
  return j > i ? { start: i, end: j, delimiter: "bare" } : null;
}

/** The first non-whitespace offset at or after `i` (or `bodyEnd`). */
function skipSpace(text: string, i: number, bodyEnd: number): number {
  while (i < bodyEnd && /\s/.test(text[i])) i++;
  return i;
}

/**
 * A field VALUE as BibTeX reads it (task 1519): a `#`-joined sequence of
 * terms — `title = "Essays" # vol`, `month = jan # ", 1"`. The field's span
 * runs to the end of the LAST term, so the removal separator logic finds the
 * real `,` (reading only the first term made a remove take the comma BEFORE
 * the field and splice `# vol` into the citekey head), and a set can see that
 * the value is an expression rather than overwrite one term of it.
 *
 * A bare value that is neither followed by `#` nor ends at a `,` / the body's
 * end is not a macro reference at all (`url = http://x.org/a`, unquoted): it
 * keeps the legacy reading — to the next `,` or newline — so this walk never
 * makes a sloppy value shorter than it was.
 */
function readValueExpression(
  text: string,
  i: number,
  bodyEnd: number,
): { end: number; valueStart: number; valueEnd: number; delimiter: BibFieldSpan["delimiter"] } | null {
  const terms: ValueTerm[] = [];
  let at = i;
  for (;;) {
    const term = readValueTerm(text, at, bodyEnd);
    if (!term) break;
    terms.push(term);
    const next = skipSpace(text, term.end, bodyEnd);
    if (text[next] !== "#") break;
    at = skipSpace(text, next + 1, bodyEnd);
  }
  const first = terms[0];
  const last = terms[terms.length - 1];
  const after = last ? skipSpace(text, last.end, bodyEnd) : i;
  const clean = after >= bodyEnd || text[after] === ",";
  if (!first || (!clean && last.delimiter === "bare")) {
    // Legacy bare reading — no term here, or a bare token run on into text.
    if (!first && (text[i] === "{" || text[i] === '"')) return null; // unclosed
    let j = i;
    while (j < bodyEnd && text[j] !== "," && text[j] !== "\n") j++;
    let valueEnd = j;
    while (valueEnd > i && /\s/.test(text[valueEnd - 1])) valueEnd--;
    return { end: j, valueStart: i, valueEnd, delimiter: terms.length > 1 ? "concat" : "bare" };
  }
  if (terms.length > 1) {
    return { end: last.end, valueStart: first.start, valueEnd: last.end, delimiter: "concat" };
  }
  const inner = first.delimiter === "bare" ? 0 : 1;
  return {
    end: first.end,
    valueStart: first.start + inner,
    valueEnd: first.end - inner,
    delimiter: first.delimiter,
  };
}

/**
 * Locate every `name = value` field inside ONE entry block, with its span.
 *
 * Offsets are relative to `block`. The value walk is the same delimiting rule
 * as {@link walkDelimited} (a `"` inside a braced value is text), so a
 * `"`-quoted value carrying a brace (or a braced value carrying a quote) does
 * not truncate the field — which
 * used to corrupt the NAME of everything after it and drop the entry's later
 * fields.
 */
export function scanBibFields(source: string): BibFieldSpan[] {
  // The comment-masked view (task 1519): a `%` line between fields is blank
  // here, so its commas and braces cannot hide or truncate the next field.
  const block = maskBibComments(source);
  const blocks = scanBibSource(block);
  const head = blocks.find((b) => b.start === 0 && b.kind === "entry");
  if (!head) return [];
  const bodyEnd = head.balanced ? head.end - 1 : head.end;
  const fields: BibFieldSpan[] = [];
  let i = head.bodyStart;
  while (i < bodyEnd) {
    while (i < bodyEnd && /[\s,]/.test(block[i])) i++;
    if (i >= bodyEnd) break;
    const nameStart = i;
    while (i < bodyEnd && isWordChar(block[i])) i++;
    const name = block.slice(nameStart, i).toLowerCase();
    while (i < bodyEnd && /\s/.test(block[i])) i++;
    if (!name || block[i] !== "=") {
      // Not a field — skip to the next comma at this level so one oddity does
      // not swallow the entry's remaining fields. A braced group is stepped
      // over whole, so a comma inside it is not "the next comma".
      while (i < bodyEnd && block[i] !== ",") {
        const close = block[i] === "{" ? walkBlockBody(block, i, bodyEnd + 1, "value") : -1;
        i = close === -1 ? i + 1 : close;
      }
      continue;
    }
    i++; // past '='
    while (i < bodyEnd && /\s/.test(block[i])) i++;
    const value = readValueExpression(block, i, bodyEnd);
    if (!value) break;
    i = value.end;
    fields.push({
      name,
      start: nameStart,
      end: i,
      valueStart: value.valueStart,
      valueEnd: value.valueEnd,
      delimiter: value.delimiter,
    });
    // An empty bare value (`title = ,`) leaves the cursor where the name
    // started, and the loop would spin on it forever. Progress is a property
    // of the scanner, not of the input.
    if (i <= nameStart) i = nameStart + 1;
  }
  return fields;
}

/**
 * The `@string` macro names ONE block's values depend on (task 949), lower-cased.
 *
 * A BibTeX value is a `#`-joined expression of TERMS — `{…}`, `"…"`, a number,
 * or a bare macro name — and only the bare, non-numeric terms name a macro:
 * `journal = jphil`, `title = "Essays" # vol`, `@string{full = jphil # " (NY)"}`.
 * {@link scanBibFields} reads one delimited value per field and so cannot see
 * a term after a `#`; this walk reads the whole expression at the block's own
 * depth, so every term is seen. Works on entry, `@string` and `@preamble`
 * blocks alike (offset 0 of `block` is its `@`).
 */
export function bibMacroReferences(block: string): string[] {
  const head = scanBibSource(block).find((b) => b.start === 0);
  if (!head) return [];
  const bodyEnd = head.balanced ? head.end - 1 : head.end;
  const out = new Set<string>();
  // A term starts right after a `=` (a field / `@string` value) or a `#`, and
  // — in a `@preamble`, which has no `=` — at the very start of the body.
  let expectTerm = head.type === "preamble";
  let i = head.bodyStart;
  while (i < bodyEnd) {
    const ch = block[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "{") {
      const close = walkBlockBody(block, i, bodyEnd + 1, "value");
      i = close === -1 ? bodyEnd : close;
      expectTerm = false;
      continue;
    }
    if (ch === '"') {
      const j = walkQuotedValue(block, i, bodyEnd);
      i = j === -1 ? bodyEnd : j + 1;
      expectTerm = false;
      continue;
    }
    if (ch === "=" || ch === "#") {
      expectTerm = true;
      i++;
      continue;
    }
    if (isWordChar(ch)) {
      let j = i;
      while (j < bodyEnd && isWordChar(block[j])) j++;
      const word = block.slice(i, j);
      if (expectTerm && !/^\d+$/.test(word)) out.add(word.toLowerCase());
      expectTerm = false;
      i = j;
      continue;
    }
    expectTerm = false;
    i++;
  }
  return [...out];
}

/** The lower-cased name a `@string{name = …}` block defines, or `null`. */
export function bibStringName(block: string): string | null {
  const head = scanBibSource(block).find((b) => b.start === 0);
  if (!head || head.type !== "string") return null;
  const m = /^\s*([^\s=#{}",]+)\s*=/.exec(block.slice(head.bodyStart));
  return m ? m[1].toLowerCase() : null;
}

/** What a caller wants changed inside ONE entry block. */
export interface BibBlockEdit {
  /** New citekey. Omitted ⇒ unchanged. */
  key?: string;
  /** New `@type`. Omitted ⇒ unchanged. */
  type?: string;
  /**
   * Fields to SET, by modelled name. Only fields the caller knows actually
   * CHANGED belong here: a field passed with its current value is a no-op, but
   * a field passed that the caller never touched would overwrite the source's
   * own spelling of it (a `@string` macro reference, say) with the projection's
   * expansion of it.
   */
  set?: Record<string, string>;
  /** Fields to DELETE, by modelled name. */
  remove?: readonly string[];
}

/** One `[start, end)` replacement inside a string. `end === start` is an insert. */
export interface Patch {
  start: number;
  end: number;
  text: string;
}

/**
 * Apply `patches` to `source`, right-to-left so earlier offsets stay valid.
 *
 * Ties are broken by the WIDER patch first, so a pure insert at the same offset
 * as a replacement lands BEFORE it in the result (that is how an entry gets its
 * `\vbid` marker stamped in the same pass that rewrites its block).
 */
export function applyPatches(source: string, patches: Patch[]): string {
  const ordered = [...patches].sort((a, b) => b.start - a.start || b.end - a.end);
  let out = source;
  for (const p of ordered) out = out.slice(0, p.start) + p.text + out.slice(p.end);
  return out;
}

/**
 * Does every brace in `text` balance (treating `\{` / `\}` as literal)?
 * `%` comment lines are masked first (task 1519), the same model the scanner
 * reads with — a `% checked {against print` note is not a brace of the block.
 */
export function bracesBalance(source: string): boolean {
  const text = maskBibComments(source);
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/** What {@link spliceBibBlockResult} answers: the new block, or WHY not. */
export type BibSpliceResult = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Splice `edit` into ONE entry block, returning the new block text — or `null`
 * when it cannot be done safely. {@link spliceBibBlockResult} says why.
 */
export function spliceBibBlock(block: string, edit: BibBlockEdit): string | null {
  const r = spliceBibBlockResult(block, edit);
  return r.ok ? r.text : null;
}

/**
 * Splice `edit` into ONE entry block.
 *
 * **Every byte the edit does not name survives** — field order, spacing,
 * hand-formatting, `%` notes, and above all the fields Virgil's model does not
 * carry (`isbn`, `keywords`, `abstract`, `annote`, `month`, `booktitle`, any
 * custom field). That is the whole point: the model is a projection, so a
 * rebuild FROM the projection deletes whatever the projection omits.
 *
 * REFUSES (with a reason a person can read) when the block cannot be spliced
 * safely — it has no entry head at offset 0, its braces do not balance so its
 * extent is a guess, or the edit SETS a field whose value is a `#`-joined
 * expression (task 1519: the user's macro reference is meaningful, and there
 * is no one term to put the new text in). The caller must then refuse too —
 * never fall back to a rebuild from the projection, which is the loss this
 * function exists to prevent.
 */
export function spliceBibBlockResult(block: string, edit: BibBlockEdit): BibSpliceResult {
  const refuse = (reason: string): BibSpliceResult => ({ ok: false, reason });
  const masked = maskBibComments(block);
  const blocks = scanBibSource(masked);
  const head = blocks.find((b) => b.start === 0 && b.kind === "entry");
  if (!head) return refuse("its block in references.bib has no readable @type{key, … head");
  if (!head.balanced || head.end !== block.length) {
    return refuse("its block in references.bib has unbalanced braces, so its extent is a guess");
  }
  const fields = scanBibFields(masked);
  const patches: Patch[] = [];

  // The scanner lower-cases `head.type`; a type that differs only in CASE is
  // the same type, so `@Article` is not rewritten to `@article` (task 1518).
  if (edit.type && edit.type.toLowerCase() !== head.type) {
    patches.push({ start: 1, end: 1 + head.type.length, text: edit.type });
  }
  if (edit.key !== undefined && edit.key !== head.key) {
    const keyStart = masked.indexOf(head.key, head.open + 1);
    if (keyStart === -1) return refuse("its citekey could not be located in its block");
    patches.push({ start: keyStart, end: keyStart + head.key.length, text: edit.key });
  }

  const findField = (name: string): BibFieldSpan | undefined => {
    const aliases = fieldAliasesOf(name);
    for (const alias of aliases) {
      const hit = fields.find((f) => f.name === alias);
      if (hit) return hit;
    }
    return undefined;
  };

  const removed = new Set<BibFieldSpan>();
  for (const name of edit.remove ?? []) {
    const hit = findField(name);
    if (hit) removed.add(hit);
  }

  const additions: string[] = [];
  for (const [name, value] of Object.entries(edit.set ?? {})) {
    const hit = findField(name);
    if (!hit || removed.has(hit)) {
      additions.push(`${name} = {${value}}`);
      continue;
    }
    if (block.slice(hit.valueStart, hit.valueEnd) === value) continue; // byte-identical
    if (hit.delimiter === "concat") {
      return refuse(
        `its "${hit.name}" field is several parts joined with # (a @string macro reference), ` +
          "which an edit here would flatten — change it in references.bib directly",
      );
    }
    if (hit.delimiter === "bare") {
      // A bare value is a `@string` macro reference or a number. Replacing its
      // TOKEN with a literal is the only representable move, so wrap it.
      patches.push({ start: hit.valueStart, end: hit.valueEnd, text: `{${value}}` });
    } else {
      patches.push({ start: hit.valueStart, end: hit.valueEnd, text: value });
    }
  }

  // Deletions take the field's own span plus the separator that joined it to
  // its neighbour, so the block does not end up with a dangling comma. The
  // separator is looked for in the MASKED text, so a `%` line between two
  // fields is whitespace to it rather than a wall.
  for (const hit of removed) {
    let start = hit.start;
    let end = hit.end;
    let k = end;
    while (k < masked.length && /[ \t]/.test(masked[k])) k++;
    // The field's own line, when it stands alone on one: taking the line's
    // indentation with it keeps the next line's indentation from doubling.
    const lineStart = masked.lastIndexOf("\n", start - 1) + 1;
    const ownLine = lineStart > 0 && /^[ \t]*$/.test(masked.slice(lineStart, start));
    if (masked[k] === ",") {
      end = k + 1;
      while (end < masked.length && /[ \t]/.test(masked[end])) end++;
      if (masked[end] === "\n") {
        end++;
        if (ownLine) start = lineStart;
      }
    } else {
      // Last field: take the comma BEFORE it instead.
      let p = start - 1;
      while (p >= 0 && /\s/.test(masked[p])) p--;
      if (masked[p] === ",") {
        if (/^\s*$/.test(block.slice(p + 1, start))) {
          start = p;
        } else {
          // A `%` line sits between the comma and the field: remove the comma
          // and the field's own line, and leave the user's note where it was.
          patches.push({ start: p, end: p + 1, text: "" });
          if (ownLine) start = lineStart - 1;
        }
      }
    }
    patches.push({ start, end, text: "" });
  }

  let out = applyPatches(block, patches);

  if (additions.length > 0) {
    const close = out.lastIndexOf(block[head.open] === "(" ? ")" : "}");
    if (close === -1) return refuse("its block lost its closing brace");
    // Match the indentation the block's own fields use, so an inserted field
    // looks like the ones around it rather than like a different writer. Read
    // it from the ORIGINAL block's last field (the spliced copy may have just
    // lost that field to a removal).
    const last = fields[fields.length - 1];
    const lineStart = last ? block.lastIndexOf("\n", last.start) + 1 : -1;
    const lead = lineStart > 0 ? block.slice(lineStart, last!.start) : "";
    const indent = /^[ \t]+$/.test(lead) ? lead : "  ";
    // The insertion point is just past the last real CONTENT, read in the
    // masked view: a trailing `% note` line must not receive the separator
    // comma (it would be commented out, joining two fields with none). Any
    // such trailing note is kept, after the new fields.
    const maskedOut = maskBibComments(out);
    let at = close;
    while (at > 0 && /\s/.test(maskedOut[at - 1])) at--;
    const sep = maskedOut[at - 1] === "," ? "" : ",";
    const trailing = out.slice(at, close);
    const note = /\S/.test(trailing) ? trailing.replace(/\s+$/, "") : "";
    out =
      out.slice(0, at) +
      sep +
      "\n" +
      additions.map((a) => `${indent}${a}`).join(",\n") +
      note +
      "\n" +
      out.slice(close);
  }

  // Refusal 3 (ported): never hand back a block whose braces do not balance —
  // it would corrupt the file and make the NEXT splice refuse under refusal 1.
  return bracesBalance(out)
    ? { ok: true, text: out }
    : refuse("the edited value would leave its block with unbalanced braces");
}
