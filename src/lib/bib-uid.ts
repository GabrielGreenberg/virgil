/**
 * Durable surrogate identity for bibliography entries (T1 Stage 0).
 *
 * A `BibEntry` historically *was* its citekey — every sidecar (annotations,
 * bib-review, float, selection, occurrence cursor) keyed directly on the
 * renameable citekey string, so a rename stranded all of it, and two `.bib`
 * blocks that happened to share a citekey collapsed into one. The fix is a
 * stable internal id (`BibEntry.uid`) decoupled from the citekey.
 *
 * This module owns the `uid` round-trip ONLY (mint, parse, serialize). It is
 * the bibliography analogue of the `\vcid{}` / `\vfid{}` inline-atom markers:
 * a no-op `\vbid{<uid>}` line emitted immediately before each entry's BibTeX
 * block, declared in the `.tex` preamble via `\providecommand{\vbid}[1]{}`
 * (see `ensurePreambleRequirements` in latex-requirements.ts) so a paper opened in raw
 * LaTeX never breaks. A `.bib` without `\vbid` markers mints a fresh uid on
 * first parse; the first save anchors it — exactly the `\vcid` behaviour.
 *
 * The marker is a bare `\vbid{...}` line (NOT a `%`-comment): it survives the
 * parser's comment-strip pass, citation-js treats it as ignorable inter-entry
 * text, and it never lands inside an entry's `raw` slice (which begins at the
 * `@type{` token), so re-serialization never double-emits it.
 *
 * Stage 0 is pure plumbing: `uid` is minted and round-tripped but consumed by
 * no UI. Later T1 stages re-key the sidecars onto it and route renames through
 * the IdentityCascade.
 */

import { generateShortId } from "@/lib/uuid";
import { emitMarker, VIRGIL_MARKERS } from "@/lib/latex-markers";

const VBID = VIRGIL_MARKERS.bibEntry;

/** The marker's brace-argument pattern, built from the SSOT spelling so the
 *  `.bib` reader can never drift from the `.bib` writer below. */
const VBID_SOURCE = `\\\\${VBID.command}\\{([^}]+)\\}`;

/**
 * Matches a `\vbid{xxxx}` marker. Capture group 1 = the uid. The uid is a
 * 4-char hex short-id (same alphabet as `\vcid`/`\vfid`), but we accept any
 * non-`}` run so a hand-authored or future-format uid round-trips intact.
 */
export const VBID_RE = new RegExp(VBID_SOURCE);

/** Global form for scanning a whole `.bib` file for every marker. */
const VBID_RE_GLOBAL = new RegExp(VBID_SOURCE, "g");

/**
 * Matches the start of a BibTeX entry: `@type{citekey,`. Capture group 1 =
 * the citekey (trimmed by the caller). Mirrors `extractRawEntries`' regex so
 * marker-to-entry association lines up with the parser's block detection.
 */
const ENTRY_HEAD_RE = /@\w+\s*\{([^,\s}]+)\s*,/g;

/** Mint a fresh, durable bib-entry uid, avoiding collisions with `existing`. */
export function mintBibUid(existing?: Set<string>): string {
  return generateShortId(existing);
}

/** Serialize a uid as its no-op `\vbid{...}` marker line (no trailing newline). */
export function serializeVbidMarker(uid: string): string {
  return emitMarker(VBID, uid);
}

/**
 * Scan a `.bib` source string and associate each `\vbid{uid}` marker with the
 * citekey of the entry it immediately precedes.
 *
 * A marker binds to the FIRST `@type{citekey,` head that starts after it (and
 * before the next marker). This tolerates blank lines / whitespace between the
 * marker and its entry, and ignores a trailing marker with no following entry.
 *
 * Returns a `citekey -> uid` map. When two distinct entries share a citekey,
 * the map cannot represent both — that ambiguity is resolved by the parser,
 * which consumes markers positionally (see `consumeOrderedVbidUids`). This
 * keyed form is provided for tests and diagnostics.
 */
export function parseVbidMarkers(bibText: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const { citekey, uid } of orderedVbidBindings(bibText)) {
    // First binding wins for a given citekey (mirrors the parser's order).
    if (!result.has(citekey)) result.set(citekey, uid);
  }
  return result;
}

/** A `\vbid` marker bound to the entry head that follows it. */
export interface VbidBinding {
  citekey: string;
  uid: string;
  /** Byte offset of the `@` that begins the bound entry's block. */
  entryStart: number;
}

/**
 * The positional list of `\vbid` markers paired to the entry head each one
 * precedes, in source order. This is the canonical form the parser consumes:
 * it survives duplicate citekeys (two entries → two bindings) where a keyed
 * map cannot.
 */
export function orderedVbidBindings(bibText: string): VbidBinding[] {
  // Collect every marker with its source position.
  const markers: { uid: string; at: number; end: number }[] = [];
  VBID_RE_GLOBAL.lastIndex = 0;
  let mm: RegExpExecArray | null;
  while ((mm = VBID_RE_GLOBAL.exec(bibText)) !== null) {
    markers.push({ uid: mm[1].trim(), at: mm.index, end: VBID_RE_GLOBAL.lastIndex });
  }
  if (markers.length === 0) return [];

  // Collect every entry head with its source position.
  const heads: { citekey: string; at: number }[] = [];
  ENTRY_HEAD_RE.lastIndex = 0;
  let hm: RegExpExecArray | null;
  while ((hm = ENTRY_HEAD_RE.exec(bibText)) !== null) {
    heads.push({ citekey: hm[1].trim(), at: hm.index });
  }

  // Bind each marker to the nearest entry head that starts at-or-after the
  // marker's end and before the next marker. Each head is claimed at most once.
  const bindings: VbidBinding[] = [];
  let headIdx = 0;
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextMarkerAt = i + 1 < markers.length ? markers[i + 1].at : Infinity;
    // Advance past heads that precede this marker (shouldn't happen with
    // well-formed output, but stay robust to hand edits).
    while (headIdx < heads.length && heads[headIdx].at < marker.end) headIdx++;
    if (headIdx < heads.length && heads[headIdx].at < nextMarkerAt) {
      const head = heads[headIdx];
      bindings.push({ citekey: head.citekey, uid: marker.uid, entryStart: head.at });
      headIdx++;
    }
    // else: dangling marker with no following entry — skip it.
  }
  return bindings;
}
