"use client";

// Drop-from-anywhere onto a Project library tab → append the dragged
// bib entry to the doc's references.bib (idempotent). Lives outside
// `library/` because writing the doc's .bib is a Virgil-side concern
// and the library subsystem must not import `@/lib/storage`.

import { readBib, writeBib } from "@/lib/storage";
import { parseBibFile, serializeBibFile } from "@/lib/bib-parser";
import { mintBibUid } from "@/lib/bib-uid";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import type { BibEntry } from "@/lib/types";

/**
 * Incoming bib entries may originate from the library subsystem, whose
 * `BibEntry` predates the paper-side `uid` surrogate (T1 Stage 0). Accept a
 * uid-optional shape at this seam and mint one on the way in, so every entry
 * written to the doc's references.bib carries a durable id from the start.
 */
type IncomingBibEntry = Omit<BibEntry, "uid"> & { uid?: string };

function withUid(entry: IncomingBibEntry): BibEntry {
  return { ...entry, uid: entry.uid ?? mintBibUid() };
}

/** Window-level event fired after a doc's references.bib changes via
 *  `addEntryToProjectBib`. `useCitations` listens and re-reads when
 *  the docId matches. */
export const DOC_BIB_CHANGED_EVENT = "virgil-doc-bib-changed";

/**
 * Append `entries` to the doc's references.bib, skipping any keys
 * already present. Performs a single read-modify-write so multi-row
 * drops don't race: if the caller fired N parallel `addEntryToProjectBib`
 * calls instead of one batched call, each read would see the same
 * starting state and the last write would clobber the earlier ones —
 * the visual "overwrite" the user sees on multi-drop. Always batch.
 *
 * Returns the count of entries actually appended (0 if nothing new).
 * Dispatches DOC_BIB_CHANGED_EVENT once on success so listeners
 * (currently `useCitations`) re-read.
 *
 * The destination is pinned to the docId's currently-active pipeline.
 * If the pipeline ends mid-write (e.g. user closes the doc tab), the
 * storage layer rejects with StalePipelineError and we return 0 —
 * the .bib stays untouched.
 */
export async function addEntriesToProjectBib(
  docId: string,
  entries: IncomingBibEntry[],
): Promise<number> {
  if (!docId) return 0;
  const incoming = entries.filter((e) => Boolean(e?.key)).map(withUid);
  if (incoming.length === 0) return 0;
  const handle = getActiveHandle(docId);
  if (!handle) return 0;
  let existing: BibEntry[] = [];
  try {
    const data = await readBib(docId);
    if (data.bibText) existing = parseBibFile(data.bibText);
  } catch {
    // No bib yet (brand-new doc) — fall through with empty `existing`.
  }
  const seen = new Set(existing.map((e) => e.key));
  const additions: BibEntry[] = [];
  for (const e of incoming) {
    if (seen.has(e.key)) continue;
    seen.add(e.key); // de-dupe within `incoming` too
    additions.push(e);
  }
  if (additions.length === 0) return 0;
  const next = [...existing, ...additions];
  const text = serializeBibFile(next);
  try {
    await writeBib(handle, text);
  } catch (err) {
    if (isStalePipelineError(err)) return 0;
    throw err;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DOC_BIB_CHANGED_EVENT, {
        detail: { docId, keys: additions.map((e) => e.key) },
      }),
    );
  }
  return additions.length;
}

/**
 * Single-entry convenience wrapper around {@link addEntriesToProjectBib}.
 * Returns true when the entry was appended, false when it was a
 * duplicate or the write failed.
 */
export async function addEntryToProjectBib(
  docId: string,
  entry: IncomingBibEntry,
): Promise<boolean> {
  const added = await addEntriesToProjectBib(docId, [entry]);
  return added > 0;
}

/**
 * Remove the entry with the given citekey from the doc's references.bib.
 * Returns true on removal, false on miss / no-active-pipeline / read
 * error. Dispatches DOC_BIB_CHANGED_EVENT on success so any listener
 * (currently `useCitations`) re-reads.
 *
 * The central library and `master.bib` are left untouched — this only
 * mutates the per-doc references.bib. Any `\cite{citekey}` commands
 * still in the document text will reference a missing entry afterward;
 * the caller is expected to have warned the user.
 */
export async function removeEntryFromProjectBib(
  docId: string,
  citekey: string,
): Promise<boolean> {
  if (!docId || !citekey) return false;
  const handle = getActiveHandle(docId);
  if (!handle) return false;
  let existing: BibEntry[] = [];
  try {
    const data = await readBib(docId);
    if (data.bibText) existing = parseBibFile(data.bibText);
  } catch {
    return false;
  }
  const next = existing.filter((e) => e.key !== citekey);
  if (next.length === existing.length) return false; // not present
  const text = serializeBibFile(next);
  try {
    await writeBib(handle, text);
  } catch (err) {
    if (isStalePipelineError(err)) return false;
    throw err;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(DOC_BIB_CHANGED_EVENT, { detail: { docId, key: citekey } }),
    );
  }
  return true;
}
