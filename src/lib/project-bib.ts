"use client";

/**
 * THE serialized authority for the doc's `references.bib` (task 558).
 *
 * The `.bib` has more writers than any sidecar: the Bibliography panel's
 * per-entry edits (`useCitations`'s five mutators), a Library drag-drop
 * (`addEntriesToProjectBib`), the Library tab's remove menu, the stack pull's
 * bib carry and the auto-add of a cited library entry (both through
 * `addBibEntry`) — plus a THIRD, out-of-process writer: the `/editor/*`
 * skills, which rewrite the file straight on disk while the paper is open.
 *
 * Before this module every in-app writer persisted a WHOLE-FILE snapshot
 * computed from a base it had read earlier, OUTSIDE the lock — the panel's
 * React state, seeded once per doc and refreshed only by an in-app window
 * event, or a `readBib` a few awaits before the write. `writeBib`'s queue
 * serialized the two WRITES, so the loser's snapshot landed last and won:
 * task 220's lost update, one file over. And because the panel's base learned
 * about a skill's write from nothing, the user's next bib edit wrote their
 * stale snapshot over the entry the skill had fetched — an entry with no other
 * local copy, whose every `\cite{key}` then compiled to an undefined reference.
 *
 * > **Every mutation of the `.bib` is a pure function of the entry list as it
 * > is ON DISK at the moment of the write, computed inside the serialized
 * > write critical section, and every writer PUBLISHES the authoritative
 * > post-write list.** Nothing persists a whole snapshot it computed earlier
 * > from state it merely hopes is current.
 *
 * The backend door (`storage.mutateBib`) is TEXT-shaped — the backends are
 * citation-js-free — so this module is where the parse/serialize pair lives,
 * and it is the ONE production caller of that door. The in-process publish
 * (`DOC_BIB_CHANGED_EVENT`) reaches this window's live readers (the hook
 * adopts the published list without a disk round-trip); a peer window's or a
 * skill's write is still MERGED OVER by the next local mutation, because there
 * is no base but the disk — the same argument task 220 makes for the skills,
 * whose writes no Web Lock reaches.
 *
 * Every write door is here. Nothing else in `src/` may call `mutateBib` or
 * serialize the whole bib — pinned by `bib-authority.test.ts`, the guard that
 * catches the shape this module exists to retire: not a broken writer, but a
 * call site that never asked the authority.
 */

import { mutateBib } from "@/lib/storage";
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

/**
 * Window-level event fired after a doc's references.bib changes through this
 * authority. `useCitations` listens and ADOPTS the published list when the
 * detail carries one; a detail with no payload (a re-hydrate request from a
 * disk-side signal) makes it re-read from disk.
 */
export const DOC_BIB_CHANGED_EVENT = "virgil-doc-bib-changed";

export interface DocBibChangedDetail {
  docId: string;
  /** The authoritative post-write text + entries. Absent ⇒ re-read from disk. */
  bibText?: string;
  entries?: BibEntry[];
}

/**
 * A mutation of the bib: a PURE function from the current entry list to the
 * next one, or `null` for "nothing to change" (no write, no publish).
 *
 * Purity is load-bearing rather than stylistic. The function runs while the
 * doc lock is held, and a caller that also applies it optimistically to React
 * state (the hook does) runs it a SECOND time against a different base — so it
 * must close over everything it needs (a pre-built entry, a pre-minted uid)
 * and must not read the clock or touch storage itself.
 */
export type BibMutator = (entries: BibEntry[]) => BibEntry[] | null;

export interface BibMutationResult {
  entries: BibEntry[];
  bibText: string;
}

/** Parse the on-disk text; an absent/empty file is an empty list. */
function entriesOf(bibText: string): BibEntry[] {
  return bibText.trim() ? parseBibFile(bibText) : [];
}

/**
 * Apply `mutate` to the doc's `.bib` through the serialized read-modify-write
 * door and announce the result.
 *
 * Resolves the authoritative post-write list, or `null` when nothing was
 * persisted — a declined mutation (`mutate` returned `null`), no doc, no active
 * write handle, a read-only library paper, or a failed write. Best-effort by
 * contract: this never throws (its callers are UI event handlers and
 * fire-and-forget listeners), and it publishes ONLY after a write that actually
 * landed, so the in-memory bib can never diverge from the on-disk one in the
 * direction that matters.
 */
export async function mutateProjectBib(
  docId: string | null,
  mutate: BibMutator,
): Promise<BibMutationResult | null> {
  if (!docId) return null;
  const handle = getActiveHandle(docId);
  if (!handle) return null;

  // The door calls its text mutator exactly ONCE per queued task, so the
  // entries it produced can be captured here rather than re-parsed out of the
  // serialized text (which would hand the hook citation-js-normalized copies of
  // entries it just edited in place).
  let produced: BibEntry[] | null = null;
  let bibText: string | null;
  try {
    bibText =
      (await mutateBib(handle, (current) => {
        const next = mutate(entriesOf(current));
        if (next === null) return null;
        produced = next;
        return serializeBibFile(next);
      })) ?? null;
  } catch (err) {
    if (isStalePipelineError(err)) return null;
    console.error("Failed to persist references.bib:", err);
    return null;
  }
  if (bibText === null || produced === null) return null;

  const result: BibMutationResult = { entries: produced, bibText };
  // Announce the authoritative post-write list so every live reader in THIS
  // window (the citations hook) adopts it without a disk round-trip. Only
  // after a successful persist — a failed write leaves the disk unchanged, so
  // the in-memory list must not diverge from it.
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<DocBibChangedDetail>(DOC_BIB_CHANGED_EVENT, {
        detail: { docId, ...result },
      }),
    );
  }
  return result;
}

/**
 * Append `entries` to the doc's references.bib, skipping any keys already
 * present ON DISK at the moment of the write. One mutation per call, so a
 * multi-row drop cannot race against itself — and, since task 558, cannot
 * race against a bib card's Save or a skill's write either: the merge is
 * computed over the freshly-read file inside the lock.
 *
 * Returns the count of entries actually appended (0 if nothing new, no active
 * pipeline, or the write failed). Publishes through the authority on success.
 */
export async function addEntriesToProjectBib(
  docId: string,
  entries: IncomingBibEntry[],
): Promise<number> {
  if (!docId) return 0;
  const incoming = entries.filter((e) => Boolean(e?.key));
  if (incoming.length === 0) return 0;
  let appended = 0;
  const result = await mutateProjectBib(docId, (existing) => {
    const seen = new Set(existing.map((e) => e.key));
    const used = new Set(existing.map((e) => e.uid).filter(Boolean));
    const additions: BibEntry[] = [];
    for (const e of incoming) {
      if (seen.has(e.key)) continue;
      seen.add(e.key); // de-dupe within `incoming` too
      // Mint against the uids on DISK, so a fresh id can never collide with
      // an entry a peer landed since this window last read the file.
      const uid = e.uid && !used.has(e.uid) ? e.uid : mintBibUid(used);
      used.add(uid);
      additions.push({ ...e, uid });
    }
    if (additions.length === 0) return null;
    appended = additions.length;
    return [...existing, ...additions];
  });
  return result === null ? 0 : appended;
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
 * Returns true on removal, false on miss / no-active-pipeline / failed
 * write. Publishes through the authority on success.
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
  const result = await mutateProjectBib(docId, (existing) => {
    const next = existing.filter((e) => e.key !== citekey);
    return next.length === existing.length ? null : next; // null = not present
  });
  return result !== null;
}
