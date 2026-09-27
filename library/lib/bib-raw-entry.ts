// The DISK half of a single master.bib entry — where it sits and what its
// bytes say — with no CSL round trip anywhere (task 795).
//
// `bib-parser.ts` reads entries through citation-js and `cslItemToEntry`: the
// right tool for DISPLAY (formatted bibliography, browse), and the wrong base
// for an EDIT. Its `type` is a CSL projection (`@inbook` → `incollection`,
// `@mastersthesis` → `phdthesis`, anything outside eight CSL types → `misc`),
// its `fields` are de-LaTeXed and re-keyed (`booktitle` → `journal`). An edit
// diffed against that projection holds a type change as "changed on disk",
// strips the markup of any field the user touches, and writes a field under
// the wrong key. So the edit surface reads the entry from here instead:
//
//   - `locateMasterEntryBlock` — the TS twin of the Python pipeline's ONE
//     locator, `_tools.locate_master_entry` (task 620): line-anchored openers,
//     an opener inside a prior balanced entry skipped (Hazard 5(b)), the LAST
//     match wins, extent by `bib_entry_extent`'s two-pass rule. The edit's
//     `baseRaw` is therefore the very copy the apply shim checks against.
//     Parity is held by `bib-raw-entry-parity.test.ts`.
//   - `parseBibEntryBlock` — a faithful single-entry parser: the type as
//     written (lower-cased), every field value VERBATIM (braces, LaTeX, and
//     all), every field under its own key.
//   - `bibEditBase` — the entry the Edit modal opens on and diffs against.

import type { BibEntry } from "./types";

/** An entry opener at the start of a line: `@type{key,`. The Python twin is
 *  `_BIB_ENTRY_START_RE` = `(?m)^@(\w+)[ \t]*\{[ \t]*([^,\s]+)[ \t]*,`; this
 *  one also admits leading indentation and a newline before the comma (an
 *  earlier production "bib edit does nothing" bug — see `bib-entry-full.ts`),
 *  so it is a SUPERSET: every opener the Python locator sees, this sees. */
const ENTRY_OPENER_RE = /^[ \t]*@(\w+)\s*\{\s*([^,\s]+)\s*,/gm;

/** `bib_entry_extent`: end offset (exclusive) of the entry opening at
 *  `openerStart`, plus whether its braces balanced. Pass 1 matches braces
 *  with no cap (a value may hold a column-0 `@type{…}`); only if that never
 *  balances, pass 2 caps at the next opener so one bad entry cannot swallow
 *  the rest of the file. */
function entryExtent(text: string, openerStart: number): { end: number; balanced: boolean } {
  const brace = text.indexOf("{", openerStart);
  if (brace === -1) return { end: text.length, balanced: false };
  let depth = 1;
  let j = brace + 1;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    j++;
  }
  if (depth === 0) return { end: j, balanced: true };
  ENTRY_OPENER_RE.lastIndex = brace + 1;
  const next = ENTRY_OPENER_RE.exec(text);
  return { end: next ? next.index : text.length, balanced: false };
}

/** The raw block `@type{key, … }` for `citekey` in `text` (master.bib), or
 *  null when the file has no entry for it. The LAST real entry wins — the
 *  copy every Python reader and writer acts on. An unbalanced entry is
 *  returned capped at the next opener (the modal can still show and parse
 *  it; the apply shim refuses to rewrite it). */
export function locateMasterEntryBlock(text: string, citekey: string): string | null {
  const want = [citekey.normalize("NFC"), citekey.normalize("NFD")];
  type Span = { start: number; end: number; key: string };
  const spans: Span[] = [];
  let consumedUntil = 0;
  ENTRY_OPENER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTRY_OPENER_RE.exec(text)) !== null) {
    // The opener proper starts at its `@` (the match may begin with indentation).
    const start = m.index + m[0].indexOf("@");
    const resumeAt = ENTRY_OPENER_RE.lastIndex;
    if (start < consumedUntil) continue;
    const { end, balanced } = entryExtent(text, start);
    ENTRY_OPENER_RE.lastIndex = resumeAt;
    if (balanced) consumedUntil = end;
    spans.push({ start, end, key: m[2].trim() });
  }
  // NFC tried before NFD, LAST match within the first form that hits.
  for (const form of want) {
    const hits = spans.filter((s) => s.key === form);
    if (hits.length > 0) {
      const s = hits[hits.length - 1];
      return text.slice(s.start, s.end);
    }
  }
  return null;
}

/** Read one value starting at `body[i]` — `{…}` (brace-balanced), `"…"`
 *  (brace-aware: a `"` inside braces does not end it), or a bare token — and
 *  any `#` concatenation after it. Returns the value and the index after it.
 *  A single delimited value is returned without its outer delimiters, byte
 *  for byte; a concatenation or bare token is returned as written. */
function readValue(body: string, i: number): { value: string; next: number } {
  const start = i;
  const pieces: string[] = [];
  for (;;) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] === "{") {
      let d = 0;
      const s = i;
      for (; i < body.length; i++) {
        if (body[i] === "{") d++;
        else if (body[i] === "}") {
          d--;
          if (d === 0) {
            i++;
            break;
          }
        }
      }
      pieces.push(body.slice(s + 1, i - 1));
    } else if (body[i] === '"') {
      const s = ++i;
      let d = 0;
      while (i < body.length && !(body[i] === '"' && d === 0)) {
        if (body[i] === "{") d++;
        else if (body[i] === "}") d--;
        i++;
      }
      pieces.push(body.slice(s, i));
      if (body[i] === '"') i++;
    } else {
      const s = i;
      while (i < body.length && !/[\s,#]/.test(body[i])) i++;
      pieces.push(body.slice(s, i));
    }
    let k = i;
    while (k < body.length && /\s/.test(body[k])) k++;
    if (body[k] === "#") {
      i = k + 1;
      continue;
    }
    break;
  }
  if (pieces.length === 1) return { value: pieces[0], next: i };
  return { value: body.slice(start, i).trim(), next: i };
}

/** Parse ONE BibTeX entry block (`@type{key, k = v, …}`) faithfully: the type
 *  lower-cased, field names lower-cased (BibTeX's are case-insensitive), every
 *  value VERBATIM. Returns null when the block is malformed. The block's own
 *  citekey is ignored — callers carry the canonical key separately. */
export function parseBibEntryBlock(
  raw: string,
): { type: string; fields: Record<string, string> } | null {
  const text = raw.trim();
  const head = text.match(/^@(\w+)\s*\{\s*([^,]+),/);
  if (!head) return null;
  const type = head[1].toLowerCase();
  const openIdx = text.indexOf("{", head.index! + 1);
  if (openIdx === -1) return null;
  let depth = 0;
  let endIdx = -1;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }
  if (endIdx === -1) return null;
  const afterKey = text.indexOf(",", openIdx);
  if (afterKey === -1 || afterKey > endIdx) return null;
  const body = text.slice(afterKey + 1, endIdx);

  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,]/.test(body[i])) i++;
    if (i >= body.length) break;
    const nameStart = i;
    while (i < body.length && /[A-Za-z0-9_:.+-]/.test(body[i])) i++;
    const name = body.slice(nameStart, i).toLowerCase();
    if (!name) return null;
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== "=") return null;
    i++;
    const { value, next } = readValue(body, i);
    i = next;
    fields[name] = value;
  }
  return { type, fields };
}

/** The entry the Edit modal opens on and diffs against: `entry` with its type
 *  and fields re-read from its own `raw` block, never from the CSL projection
 *  the full-entry fetch carries for display. An entry with no parseable raw is
 *  returned as-is, except that a readable `@type` in its raw still wins over
 *  the projected type — a mis-projected base type is exactly what fabricates a
 *  "type changed on disk" hold at apply time. */
export function bibEditBase(entry: BibEntry): BibEntry {
  if (!entry.raw) return entry;
  const parsed = parseBibEntryBlock(entry.raw);
  if (parsed) return { ...entry, type: parsed.type, fields: parsed.fields };
  const head = entry.raw.trim().match(/^@(\w+)\s*\{/);
  return head ? { ...entry, type: head[1].toLowerCase() } : entry;
}
