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
  /** How the value is delimited — a bare value is a macro reference or number. */
  delimiter: "brace" | "quote" | "bare";
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

/** Is `ch` a BibTeX name character (a field name / `@type` token)? */
function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_+:.\-]/.test(ch);
}

/**
 * Walk from the opening brace of a block to its matching close.
 *
 * Quote- and brace-aware (task 614's rule, ported): a `"` opens a quoted value
 * and the `}` inside it is LITERAL, so `note = "a } b"` no longer closes the
 * block early and truncates everything after it. Braces still nest inside a
 * quoted value (that is BibTeX's own rule), and the closing `"` is the one at
 * the depth the quote opened at. `\{` / `\}` / `\"` are literal characters.
 *
 * Returns the offset just past the closing brace, or `-1` if it never closed.
 */
function walkBlockBody(text: string, openBrace: number, limit: number): number {
  let depth = 0;
  let quoteDepth: number | null = null;
  for (let i = openBrace; i < limit; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++; // escaped character — never a delimiter
      continue;
    }
    if (ch === '"') {
      if (quoteDepth === null) quoteDepth = depth;
      else if (quoteDepth === depth) quoteDepth = null;
      continue;
    }
    if (quoteDepth !== null) {
      // Inside a quoted value braces still nest, but a `}` can never close the
      // BLOCK — that is the parity rule the old walk was missing.
      if (ch === "{") depth++;
      else if (ch === "}" && depth > quoteDepth) depth--;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
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
  const re = /^[ \t]*@\w+[ \t]*[{(]/gm;
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
 */
export function scanBibSource(text: string): BibSourceBlock[] {
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
    // BibTeX's parenthesised form: `@type(key, …)`. Rare, and the walk below is
    // brace-shaped, so treat it as free text rather than guess at its extent.
    if (text[j] === "(") {
      i = at + 1;
      continue;
    }
    const openBrace = j;
    let end = walkBlockBody(text, openBrace, text.length);
    const balanced = end !== -1;
    if (!balanced) {
      const nextOpener = openers.find((o) => o > at);
      end = nextOpener ?? text.length;
    }
    const lcType = type.toLowerCase();
    if (MACRO_TYPES.has(lcType)) {
      blocks.push({ kind: "macro", type: lcType, key: "", start: at, end, balanced, bodyStart: openBrace + 1 });
    } else {
      // The citekey runs to the first `,` at the head's own depth. A block with
      // no comma at all (`@misc{key}`) is still an entry: its key is the body.
      let k = openBrace + 1;
      let depth = 1;
      let quoteDepth: number | null = null;
      let comma = -1;
      for (; k < end; k++) {
        const ch = text[k];
        if (ch === "\\") {
          k++;
          continue;
        }
        if (ch === '"') {
          if (quoteDepth === null) quoteDepth = depth;
          else if (quoteDepth === depth) quoteDepth = null;
          continue;
        }
        if (quoteDepth !== null) continue;
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) break;
        } else if (ch === "," && depth === 1) {
          comma = k;
          break;
        }
      }
      const keyEnd = comma === -1 ? Math.max(openBrace + 1, end - 1) : comma;
      const key = text.slice(openBrace + 1, keyEnd).trim();
      blocks.push({
        kind: "entry",
        type: lcType,
        key,
        start: at,
        end,
        balanced,
        bodyStart: comma === -1 ? keyEnd : comma + 1,
      });
    }
    i = Math.max(end, at + 1);
  }
  return blocks;
}

/**
 * Locate every `name = value` field inside ONE entry block, with its span.
 *
 * Offsets are relative to `block`. The value walk is the same quote/brace
 * parity rule as {@link walkBlockBody}, so a `"`-quoted value carrying a brace
 * (or a braced value carrying a quote) does not truncate the field — which
 * used to corrupt the NAME of everything after it and drop the entry's later
 * fields.
 */
export function scanBibFields(block: string): BibFieldSpan[] {
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
      // not swallow the entry's remaining fields.
      while (i < bodyEnd && block[i] !== ",") i++;
      continue;
    }
    i++; // past '='
    while (i < bodyEnd && /\s/.test(block[i])) i++;
    let delimiter: BibFieldSpan["delimiter"];
    let valueStart: number;
    let valueEnd: number;
    if (block[i] === "{") {
      const close = walkBlockBody(block, i, bodyEnd + 1);
      if (close === -1) break;
      delimiter = "brace";
      valueStart = i + 1;
      valueEnd = close - 1;
      i = close;
    } else if (block[i] === '"') {
      let j = i + 1;
      let qdepth = 0;
      while (j < bodyEnd) {
        const ch = block[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === "{") qdepth++;
        else if (ch === "}") {
          if (qdepth > 0) qdepth--;
        } else if (ch === '"' && qdepth === 0) break;
        j++;
      }
      if (j >= bodyEnd) break;
      delimiter = "quote";
      valueStart = i + 1;
      valueEnd = j;
      i = j + 1;
    } else {
      let j = i;
      while (j < bodyEnd && block[j] !== "," && block[j] !== "\n") j++;
      delimiter = "bare";
      valueStart = i;
      valueEnd = j;
      while (valueEnd > valueStart && /\s/.test(block[valueEnd - 1])) valueEnd--;
      i = j;
    }
    fields.push({ name, start: nameStart, end: i, valueStart, valueEnd, delimiter });
    // An empty bare value (`title = ,`) leaves the cursor where the name
    // started, and the loop would spin on it forever. Progress is a property
    // of the scanner, not of the input.
    if (i <= nameStart) i = nameStart + 1;
  }
  return fields;
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

/** Does every brace in `text` balance (treating `\{` / `\}` as literal)? */
export function bracesBalance(text: string): boolean {
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

/**
 * Splice `edit` into ONE entry block, returning the new block text.
 *
 * **Every byte the edit does not name survives** — field order, spacing,
 * hand-formatting, `%` notes, and above all the fields Virgil's model does not
 * carry (`isbn`, `keywords`, `abstract`, `annote`, `month`, `booktitle`, any
 * custom field). That is the whole point: the model is a projection, so a
 * rebuild FROM the projection deletes whatever the projection omits.
 *
 * Returns `null` when the block cannot be spliced safely — it has no entry
 * head at offset 0, or its braces do not balance so its extent is a guess.
 * The caller then falls back to its own emit, or refuses.
 */
export function spliceBibBlock(block: string, edit: BibBlockEdit): string | null {
  const blocks = scanBibSource(block);
  const head = blocks.find((b) => b.start === 0 && b.kind === "entry");
  if (!head || !head.balanced || head.end !== block.length) return null;
  const fields = scanBibFields(block);
  const patches: Patch[] = [];

  if (edit.type && edit.type !== head.type) {
    patches.push({ start: 1, end: 1 + head.type.length, text: edit.type });
  }
  if (edit.key !== undefined && edit.key !== head.key) {
    const openBrace = block.indexOf("{");
    const keyStart = block.indexOf(head.key, openBrace + 1);
    if (keyStart === -1) return null;
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
    if (hit.delimiter === "bare") {
      // A bare value is a `@string` macro reference or a number. Replacing its
      // TOKEN with a literal is the only representable move, so wrap it.
      patches.push({ start: hit.valueStart, end: hit.valueEnd, text: `{${value}}` });
    } else {
      patches.push({ start: hit.valueStart, end: hit.valueEnd, text: value });
    }
  }

  // Deletions take the field's own span plus the separator that joined it to
  // its neighbour, so the block does not end up with a dangling comma.
  for (const hit of removed) {
    let start = hit.start;
    let end = hit.end;
    let k = end;
    while (k < block.length && /[ \t]/.test(block[k])) k++;
    if (block[k] === ",") {
      end = k + 1;
      while (end < block.length && /[ \t]/.test(block[end])) end++;
      if (block[end] === "\n") end++;
    } else {
      // Last field: take the comma BEFORE it instead.
      let p = start - 1;
      while (p >= 0 && /\s/.test(block[p])) p--;
      if (block[p] === ",") start = p;
    }
    patches.push({ start, end, text: "" });
  }

  let out = applyPatches(block, patches);

  if (additions.length > 0) {
    const close = out.lastIndexOf("}");
    if (close === -1) return null;
    // Match the indentation the block's own fields use, so an inserted field
    // looks like the ones around it rather than like a different writer. Read
    // it from the ORIGINAL block's last field (the spliced copy may have just
    // lost that field to a removal).
    const last = fields[fields.length - 1];
    const lineStart = last ? block.lastIndexOf("\n", last.start) + 1 : -1;
    const lead = lineStart > 0 ? block.slice(lineStart, last!.start) : "";
    const indent = /^[ \t]+$/.test(lead) ? lead : "  ";
    const before = out.slice(0, close);
    const trimmedEnd = before.replace(/\s+$/, "");
    const sep = trimmedEnd.endsWith(",") ? "" : ",";
    out =
      trimmedEnd +
      sep +
      "\n" +
      additions.map((a) => `${indent}${a}`).join(",\n") +
      "\n" +
      out.slice(close);
  }

  // Refusal 3 (ported): never hand back a block whose braces do not balance —
  // it would corrupt the file and make the NEXT splice refuse under refusal 1.
  return bracesBalance(out) ? out : null;
}
