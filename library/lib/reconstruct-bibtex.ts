// Shared BibTeX reconstruction from a parsed `BibEntry`.
//
// Used wherever a non-empty `raw` block is needed but the resolved entry may
// only carry parsed fields. The canonical case is the slim browse projection
// (bib-index.json records carry `raw=""` and browse-only fields): the detail
// surface — PaperHeader's formatted entry, the BibEdit modal, copy-BibTeX —
// needs a populated `raw`, so we synthesize one from `type` + `key` + `fields`
// when the on-demand full-entry fetch hasn't landed (or can't, e.g. a slow /
// failing 10 MB master.bib read in production). The real full entry stays the
// preferred source; this is the fallback that keeps edit from ever being
// blocked by an empty `raw`.
//
// Empty/whitespace-only field values are dropped so a sparse slim record
// doesn't emit `field = {}` noise.

import type { BibEntry } from "./types";

export function reconstructBibtex(entry: BibEntry): string {
  const lines = Object.entries(entry.fields)
    .filter(([, v]) => v && v.trim().length > 0)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@${entry.type}{${entry.key},\n${lines}\n}\n`;
}

/** Internal, non-enumerable marker stamped on entries whose `raw` was
 *  SYNTHESIZED from a slim browse record (vs. a real full master.bib block).
 *  EDIT/SAVE must be gated OFF on synthesized entries — see `isSynthesizedRaw`
 *  and RightDetail's `canEdit` (a slim record is always `type:"misc"` + browse
 *  fields only, so saving it would overwrite the real entry with a lossy
 *  `@misc` block). It is non-enumerable so it never leaks into `{...entry}`
 *  spreads, JSON serialization, or field iteration. */
const SYNTHESIZED_RAW = Symbol.for("virgil.library.rawSynthesized");

/**
 * Return `entry` unchanged when it already has a non-empty `raw`; otherwise a
 * shallow clone with `raw` synthesized from its fields, TAGGED as synthesized
 * (so callers can refuse to edit/save it). Returns the input (possibly
 * `null`/`undefined`) untouched when there is nothing to back the synthesis
 * (no entry, or no `key`/`type` to build a block from).
 *
 * DISPLAY-ONLY: a synthesized `raw` keeps the bib card / formatted-entry /
 * copy-BibTeX paths working while the on-demand full entry is pending or has
 * failed, but it must NOT enable edit (the slim source carries only ~12 browse
 * fields and a fabricated `type:"misc"`). Use `isSynthesizedRaw(entry)` to tell
 * a synthesized fallback from a real full entry.
 */
export function withSynthesizedRaw<T extends BibEntry | null | undefined>(
  entry: T,
): T {
  if (!entry) return entry;
  if (entry.raw && entry.raw.trim().length > 0) return entry;
  if (!entry.key || !entry.type) return entry;
  const clone = { ...entry, raw: reconstructBibtex(entry) } as BibEntry;
  Object.defineProperty(clone, SYNTHESIZED_RAW, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return clone as T;
}

/** True when `entry`'s `raw` was synthesized by `withSynthesizedRaw` from a
 *  slim browse record (so it's DISPLAY-safe but NOT edit-safe — saving it would
 *  overwrite the real master.bib entry with a lossy `@misc` block). A real full
 *  entry (or any entry that arrived with its own non-empty `raw`) returns false. */
export function isSynthesizedRaw(
  entry: BibEntry | null | undefined,
): boolean {
  return (
    !!entry &&
    (entry as unknown as Record<symbol, unknown>)[SYNTHESIZED_RAW] === true
  );
}
