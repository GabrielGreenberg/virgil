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
 *
 * ## And every write door REPORTS (task 685)
 *
 * The door was right; only its failure report was missing. A write that threw
 * was `console.error`'d and answered with the same `null` as "no doc", "no
 * handle" and "a library paper" — so no caller could tell the user's content
 * failing to land apart from three kinds of "not applicable", and the
 * optimistic in-memory list stood as truth for the rest of the session over a
 * file that had never changed. Since task 685 every door here resolves a
 * {@link BibWriteResult}, and the one kind that means the user's own content
 * did not reach disk is published on the ONE refusal channel
 * ([sidecar-refusal.ts](sidecar-refusal.ts)) that task 637 gave the sidecars —
 * `references.bib` being the last CONTENT file still swallowing it.
 */

import { mutateBib } from "@/lib/storage";
import { parseBibFile, serializeBibFileAgainst } from "@/lib/bib-parser";
import { recordSidecarRefusal } from "@/lib/sidecar-refusal";
import { bibUidsOf, mintBibUid } from "@/lib/bib-uid";
import {
  BIB_NO_MATCH,
  citekeyIdentity,
  resolveBibEntryIndex,
  type BibEntryAddress,
  type BibNoMatch,
} from "@/lib/bib-address";
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
export type BibMutator = (entries: BibEntry[]) => BibEntry[] | null | BibNoMatch;

export interface BibMutationResult {
  entries: BibEntry[];
  bibText: string;
}

/**
 * What a bib mutation DID (task 685) — a discriminated result, not a sentinel.
 *
 * The door used to resolve `BibMutationResult | null`, and that one `null`
 * collapsed five outcomes that call for three different behaviours:
 *
 *   - `declined` — the mutator itself said "nothing to change" (the key is
 *     already on disk). The optimistic apply above returned the same list, so
 *     there is nothing to undo and nothing to say.
 *   - `not-found` — the mutator ADDRESSED an entry the file does not hold
 *     (task 691). This was `declined` too, and it is the opposite case: the
 *     optimistic apply DID change the view, so the card reads saved over a
 *     file that never held the edit. Reported and reconciled like a refusal.
 *   - `stale` — the doc switched under the write and the NEW owner is
 *     authoritative. Silent, and not reconciled: this window's state is about
 *     to be replaced wholesale.
 *   - `no-handle` / `read-only` / `failed` — nothing reached disk and nothing
 *     will. The in-memory list is then a PHANTOM: the card reads saved, the
 *     file never changed, and for the rest of the session every later read,
 *     every citation display and the user's own eyes agree on a bibliography
 *     that does not exist on disk.
 *
 * `failed` is the write-path law's own case and it was the last one open.
 * `references.bib` is CONTENT — the user's bibliography, cited by the `.tex` —
 * and task 637 had already given every `virgil/` sidecar exactly this
 * treatment ([sidecar-refusal.ts](sidecar-refusal.ts)); the bib was the one
 * content file still ending at a `console.error`.
 *
 * The vocabulary is the sidecar authority's, deliberately verbatim
 * (`AiRequestsWriteResult` in [ai-requests-store.ts](ai-requests-store.ts)),
 * down to the `ran` technique below for telling a DECLINED mutator apart from
 * a door that refused the file before the mutator was ever called. Two
 * serialized authorities reporting the same six facts should not need two
 * words for each of them, and a third has one shape to copy.
 */
export type BibWriteResult =
  | ({ kind: "written" } & BibMutationResult)
  | { kind: "declined" }
  | { kind: "not-found" }
  | { kind: "stale" }
  | { kind: "no-handle" }
  | { kind: "read-only" }
  | { kind: "failed"; error: unknown };

/**
 * Is the file now what the caller's mutation asked for? ONE positive question
 * (task 1142), so a caller that acts on the write — a rename's `\cite{}`
 * fan-out, an optimistic view standing as truth — asks "did it land" rather
 * than blacklisting the refusals it happened to know about. `written` landed;
 * `declined` means the mutator found nothing to change, i.e. the disk already
 * says it. Every other kind — the refusals below AND `stale` (the pipeline was
 * superseded mid-write) — leaves the file without the change.
 */
export function didBibWriteLand(
  r: BibWriteResult,
): r is ({ kind: "written" } & BibMutationResult) | { kind: "declined" } {
  return r.kind === "written" || r.kind === "declined";
}

/**
 * What a USER-GESTURE save answers (task 1158): the door's own verdict, or
 * `invalid` — the head the user typed failed the validation door
 * (`validateBibEntryHeadChange`) before any write was attempted.
 *
 * A composer (the bib card's "Edit entry") holds the user's typed fields until
 * it reads this, and closes only on {@link didBibSaveLand}. It used to close on
 * the CLICK, so every verdict below that is not "landed" — a library paper's
 * `read-only` `.bib`, the unbalanced-span refusal, a vanished entry — rolled
 * the optimistic view back AND destroyed the draft that was the only copy of
 * what the user had typed.
 */
export type BibSaveResult =
  | BibWriteResult
  | { kind: "invalid"; reason: string }
  /** The editor's delta could not be rebased onto the live entry: a part the
   *  user changed was ALSO changed, to something else, by another writer
   *  while the editor was open (task 1359, `rebaseBibEdit`). Nothing landed. */
  | { kind: "conflict"; reason: string };

/** Did a user-gesture save land? The ONE question a composer closes on. */
export function didBibSaveLand(r: BibSaveResult): boolean {
  return r.kind !== "invalid" && r.kind !== "conflict" && didBibWriteLand(r);
}

/**
 * The reason a save that did NOT land gives the person who pressed Save — said
 * at the composer that still holds their draft. This is the voice the
 * `read-only` / `no-handle` kinds deliberately lack on the refusal CHANNEL
 * (see {@link refusedWrite}: window-event writers stay quiet); a composer is
 * always the user's own gesture in the paper they are looking at, so here it
 * is owed. `null` for a save that landed.
 */
export function bibSaveRefusalReason(r: BibSaveResult): string | null {
  switch (r.kind) {
    case "written":
    case "declined":
      return null;
    case "invalid":
    case "conflict":
      return r.reason;
    case "read-only":
      return "This bibliography is read-only here — a library paper's references are managed by the library. Nothing was changed.";
    case "no-handle":
      return "This paper is not open for writing, so references.bib was not changed.";
    case "stale":
      return "The paper changed while saving, so the edit was not applied. Your changes are still here — try Save again.";
    case "not-found":
    case "failed": {
      const err = "error" in r ? r.error : undefined;
      return err instanceof Error && err.message
        ? err.message
        : "references.bib could not be updated. Nothing was changed.";
    }
  }
}

/** Did this result mean the user's change is NOT on disk and never will be? */
export function isBibWriteRefused(
  r: BibWriteResult,
): r is
  | { kind: "no-handle" }
  | { kind: "read-only" }
  | { kind: "not-found" }
  | { kind: "failed"; error: unknown } {
  return (
    r.kind === "no-handle" ||
    r.kind === "read-only" ||
    r.kind === "not-found" ||
    r.kind === "failed"
  );
}

/**
 * The bib's noun on the refusal channel. ONE noun for the file, not one per
 * writer: the channel carries what the user was doing, and "the bibliography"
 * is what a panel edit, a Library drop and a remove-menu all were.
 */
const BIB_REFUSAL_NOUN = "bibliography";

/**
 * Build the `failed` result and VOICE it, in one expression — so this module
 * cannot produce a failed write without publishing it.
 *
 * ## Which refusals are voiced, and why only these
 *
 * Only `failed` and `not-found` — the two that mean a write was attempted on
 * the user's own content in the doc they are looking at, and did not land. `no-handle` and `read-only` are not the same fact here that
 * they are for a sidecar, because the bib's writers are not all the user's own
 * gesture in the paper they are looking at: the Library drop and the Library
 * remove-menu arrive as WINDOW EVENTS that every mounted `LibraryTabView`
 * handles — one per scoped library tab, for a `docId` that need not be this
 * pane's — and a library paper's `.bib` is the library's own artifact, which
 * the Reader is right to refuse. A danger band on those would be noise about a
 * paper the user is not editing.
 *
 * A THROW is different in kind: a handle was there, the write was attempted on
 * the user's own content, and it did not land. The kinds stay distinguishable
 * at the door either way, so this policy is one function rather than a shape —
 * the sentinel that made it unstatable is what this task removed.
 */
function refusedWrite(docId: string, error: unknown): BibWriteResult {
  recordSidecarRefusal({
    docId,
    what: BIB_REFUSAL_NOUN,
    reason: "failed",
    detail: error instanceof Error ? error.message : undefined,
  });
  return { kind: "failed", error };
}

/** Parse the on-disk text; an absent/empty file is an empty list. */
function entriesOf(bibText: string): BibEntry[] {
  return bibText.trim() ? parseBibFile(bibText) : [];
}

/**
 * Apply `mutate` to the doc's `.bib` through the serialized read-modify-write
 * door and announce the result.
 *
 * Resolves a {@link BibWriteResult}. Best-effort by contract: this never
 * throws (its callers are UI event handlers and fire-and-forget listeners),
 * and it publishes `DOC_BIB_CHANGED_EVENT` ONLY after a write that actually
 * landed, so the in-memory bib can never diverge from the on-disk one in the
 * direction that matters. When it does NOT land because the write threw, it
 * says so on the refusal channel and the caller's optimistic view is the
 * caller's to reconcile ({@link isBibWriteRefused}).
 *
 * ## Telling a DECLINED mutation from a REFUSED one
 *
 * `mutateBib` answers `null` both ways — the mutator returned `null`, or the
 * door short-circuited a library-paper write before the mutator ever ran. The
 * difference is observable from inside the mutator callback and nowhere else,
 * so that is where it is taken: `ran` is set the moment the mutator is
 * invoked. `null` with `ran` is the mutator's own "nothing to change"; `null`
 * WITHOUT it means the write never got that far.
 */
export async function mutateProjectBib(
  docId: string | null,
  mutate: BibMutator,
): Promise<BibWriteResult> {
  if (!docId) return { kind: "no-handle" };
  const handle = getActiveHandle(docId);
  if (!handle) return { kind: "no-handle" };

  // The door calls its text mutator exactly ONCE per queued task, so the
  // entries it produced can be captured here rather than re-parsed out of the
  // serialized text (which would hand the hook citation-js-normalized copies of
  // entries it just edited in place).
  let ran = false;
  let produced: BibEntry[] | null = null;
  let unspliceable = false;
  let noMatch = false;
  let bibText: string | null;
  try {
    bibText =
      (await mutateBib(handle, (current) => {
        ran = true;
        const next = mutate(entriesOf(current));
        // "The address names no entry in the file" — NOT the mutator's own
        // "nothing to change" (task 691). Reported below rather than swallowed
        // as `declined`, so the caller's optimistic view stops standing as
        // truth over a file that never held the edit.
        if (next === BIB_NO_MATCH) {
          noMatch = true;
          return null;
        }
        if (next === null) return null;
        // THE SPLICE (task 688). The next file is `current` with the changed
        // entries' own spans rewritten — not a whole-file re-emit from the
        // model, which deleted every byte the model cannot represent (a
        // `@string` macro, the header comment, an unparseable sibling, every
        // field outside the CSL whitelist) whenever the user edited an
        // unrelated entry. When the splice cannot be GUARANTEED, it answers
        // null and we refuse rather than write a guess.
        const spliced = serializeBibFileAgainst(current, next);
        if (spliced === null) {
          unspliceable = true;
          return null;
        }
        produced = next;
        return spliced;
      })) ?? null;
  } catch (err) {
    if (isStalePipelineError(err)) return { kind: "stale" };
    console.error("Failed to persist references.bib:", err);
    return refusedWrite(docId, err);
  }
  if (noMatch) {
    return refusedWrite(
      docId,
      new Error(
        "That bibliography entry is no longer in references.bib — it was removed " +
          "or renamed outside this window, so the edit could not be applied.",
      ),
    );
  }
  if (unspliceable) {
    return refusedWrite(
      docId,
      new Error(
        "references.bib could not be updated safely: an entry's block is malformed " +
          "(unbalanced braces), so rewriting it would corrupt a neighbouring entry. " +
          "The file was left unchanged.",
      ),
    );
  }
  if (bibText === null || produced === null) {
    return ran ? { kind: "declined" } : { kind: "read-only" };
  }

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
  return { kind: "written", ...result };
}

/** What an append DID: how many entries reached the file, and the door's own
 *  verdict when that count is 0 — "every key was already there" (`declined`)
 *  and "the write threw" (`failed`) are never the same number. */
export interface BibAppendResult {
  appended: number;
  result: BibWriteResult;
}

/**
 * Append `entries` to the doc's references.bib, skipping any keys already
 * present ON DISK at the moment of the write. One mutation per call, so a
 * multi-row drop cannot race against itself — and, since task 558, cannot
 * race against a bib card's Save or a skill's write either: the merge is
 * computed over the freshly-read file inside the lock.
 *
 * Publishes through the authority on success; a failed write is voiced on the
 * refusal channel there, not here.
 */
export async function addEntriesToProjectBib(
  docId: string,
  entries: IncomingBibEntry[],
): Promise<BibAppendResult> {
  if (!docId) return { appended: 0, result: { kind: "no-handle" } };
  const incoming = entries.filter((e) => Boolean(e?.key));
  if (incoming.length === 0) return { appended: 0, result: { kind: "declined" } };
  let appended = 0;
  const result = await mutateProjectBib(docId, (existing) => {
    // Keyed by citekey IDENTITY (case-folded, task 1159): BibTeX reads
    // `Smith2020` and `smith2020` as one key, so appending the one beside the
    // other is a "Repeated entry", not a new reference.
    const seen = new Set(existing.map((e) => citekeyIdentity(e.key)));
    const used = bibUidsOf(existing);
    const additions: BibEntry[] = [];
    for (const e of incoming) {
      const id = citekeyIdentity(e.key);
      if (seen.has(id)) continue;
      seen.add(id); // de-dupe within `incoming` too
      // Mint against the uids on DISK, so a fresh id can never collide with
      // an entry a peer landed since this window last read the file.
      const uid = e.uid && !used.has(e.uid) ? e.uid : mintBibUid(used);
      used.add(uid);
      // Drop any `source` span the entry carried in from ANOTHER file (the
      // library's master.bib): a splice anchor is only meaningful against the
      // text it was parsed from, and this entry is being APPENDED to a
      // different one (task 688).
      const { source: _foreign, ...rest } = e as IncomingBibEntry & { source?: unknown };
      void _foreign;
      additions.push({ ...rest, uid });
    }
    if (additions.length === 0) return null;
    appended = additions.length;
    return [...existing, ...additions];
  });
  return { appended: result.kind === "written" ? appended : 0, result };
}

/**
 * Remove EXACTLY the entry `address` names from the doc's references.bib.
 * Resolves the door's own {@link BibWriteResult}: `written` on a removal,
 * `declined` when the address names nothing (the entry is already gone —
 * which is what a remove asked for), and a refusal kind when nothing reached
 * disk — a miss and a failed write are not the same answer.
 *
 * Addressed like every other mutator since task 690, not by citekey (task
 * 1159): a `references.bib` may hold two blocks under one key, and the old
 * `filter((e) => e.key !== citekey)` deleted every one of them — the block
 * the user could not see along with the one they chose.
 *
 * The central library and `master.bib` are left untouched — this only
 * mutates the per-doc references.bib. Any `\cite{citekey}` commands
 * still in the document text will reference a missing entry afterward;
 * the caller is expected to have warned the user.
 */
export async function removeEntryFromProjectBib(
  docId: string,
  address: BibEntryAddress,
): Promise<BibWriteResult> {
  if (!docId) return { kind: "no-handle" };
  if (!address?.key) return { kind: "declined" };
  return mutateProjectBib(docId, (existing) => {
    const i = resolveBibEntryIndex(existing, address);
    if (i === -1) return null; // not present
    return [...existing.slice(0, i), ...existing.slice(i + 1)];
  });
}
