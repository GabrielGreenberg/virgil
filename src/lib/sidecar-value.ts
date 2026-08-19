/**
 * **The sidecar VALUE SSOT** — what each `virgil/*.json` file is WORTH, declared
 * once, and the two behaviours derived from it (task 363).
 *
 * ## Why this exists
 *
 * Task 220 established that a file with more than one writer has ONE authority
 * and that every mutation is computed inside a serialized critical section. That
 * covers the writers Virgil can serialize with: its own hooks, its own windows,
 * and (through the merge, not the lock) the out-of-process `/editor/*` skills.
 *
 * A paper folder inside Dropbox / iCloud / OneDrive / Google Drive / Syncthing
 * has one more writer, and it is the one the model does not contemplate: **a
 * sync daemon Virgil cannot lock against, cannot detect, and cannot merge
 * with.** It uploads whatever bytes it finds, and when it lands a remote version
 * while the local file has moved on it does not merge — it FORKS, minting a
 * `notes (Gabriel's conflicted copy 2026-08-18).json` sibling and walking away.
 *
 * > **Against a writer you cannot serialize with there are exactly two moves:
 * > shrink the race window, and notice the fork.** Both are derived from what
 * > the file is worth. A VIEW-state sidecar coalesces hard, because losing the
 * > last few seconds of it costs nothing. A CONTENT sidecar keeps its prompt
 * > cadence, because losing it costs the user's writing — and a conflicted
 * > sibling of a content file is unmerged user data, which is the half that
 * > must never be silent.
 *
 * The measured evidence (Gabriel's `Coherence Intro/virgil/`, 2026-08-18): 197
 * conflicted copies, **134 of them on the three files nothing declared as view
 * state** — `editor-state.json` 102, `virgil.json` 27, `collab.json` 5 — against
 * `notes` 36, `revisions` 20, `citations` 4, `archive` 2, `todos` 1. The loudest
 * file in the folder is the one whose entire contents are a scroll offset, a
 * caret paragraph id and a fold list, and it was written on every 400 ms scroll
 * pause and every caret-paragraph change: a hundred-odd full-file rewrites per
 * reading session, each one a `createWritable()` swap-file + rename that a sync
 * daemon watches. Nothing anywhere said that file was disposable.
 *
 * ## The three columns, and the reader each one earns
 *
 * - `tier` — read by {@link sidecarWriteDebounceMs} (the write cadence) and by
 *   [sync-conflict.ts](sync-conflict.ts) (a fork of a content file is reported;
 *   a fork of a view file is debris).
 * - `mount` — whether the doc-mount sidecar bundle pre-reads this file.
 *   `ALL_SIDECAR_FILENAMES` is DERIVED from it, so the "which files does a mount
 *   read" list can no longer drift from the "which files does Virgil write" list
 *   — they were two hand-kept arrays before this, and the three files the storm
 *   was made of were in neither.
 *
 * This module imports NOTHING. It is a leaf on purpose: the storage backends,
 * the React hooks and the conflict scanner all read it, and a facet the layer
 * that needs it cannot import will be re-copied (the placement rule
 * `latex-markers.ts` and `node-attr-sets.ts` earned).
 */

/**
 * What a sidecar is worth.
 *
 * - `"view"` — UI state that is RECOMPUTABLE or trivially re-established by the
 *   user's next gesture: a scroll offset, which sections are folded, who holds
 *   the collab pen right now. Losing the last few seconds of it costs nothing,
 *   so it may be coalesced hard.
 * - `"content"` — the user's writing, or a record only they can reproduce: a
 *   note body, an archived excerpt, a citation, a paragraph title. Its cadence
 *   stays prompt, and a conflicted sibling of it is unmerged user data.
 */
export type SidecarTier = "view" | "content";

interface SidecarValueEntry {
  tier: SidecarTier;
  /** Pre-read by the doc-mount sidecar bundle (one directory acquire + a
   *  parallel batch). True for exactly the files a `usePersistentState` hook
   *  owns; the three files with their own readers (`virgil.json` rides the doc
   *  bundle, `editor-state.json` has `useEditorUIState`, `collab.json` has
   *  `useCollab`) are false. */
  mount: boolean;
}

/**
 * Every file Virgil writes into a paper's `virgil/` directory.
 *
 * A filename missing from here still WORKS — {@link sidecarTier} fails closed to
 * `"content"`, which is the safe cadence — but it is invisible to the conflict
 * scanner and to the mount bundle, so CI requires the table to be total over
 * what production actually spells
 * ([sidecar-value.test.ts](__tests__/sidecar-value.test.ts)).
 */
export const SIDECAR_VALUE: Readonly<Record<string, SidecarValueEntry>> =
  Object.freeze({
    // ── VIEW ───────────────────────────────────────────────────────────────
    // The scroll offset, the caret's paragraph and the fold set. Reconstructed
    // by the user in one scroll; written ~100×/session before task 363.
    "editor-state.json": { tier: "view", mount: false },
    // Focus-mode band — which region the user narrowed to. A UI mode.
    "focus.json": { tier: "view", mount: true },
    // Presence + pen heartbeats. Ephemeral by construction: every field is a
    // timestamp that goes stale on a clock, and the sweeps discard it.
    "collab.json": { tier: "view", mount: false },

    // ── CONTENT ────────────────────────────────────────────────────────────
    "ai-requests.json": { tier: "content", mount: true },
    "annotations.json": { tier: "content", mount: true },
    "archive.json": { tier: "content", mount: true },
    "bib-review-requests.json": { tier: "content", mount: true },
    "bib-settings.json": { tier: "content", mount: true },
    "citations.json": { tier: "content", mount: true },
    "cutter.json": { tier: "content", mount: true },
    "document-settings.json": { tier: "content", mount: true },
    "examples.json": { tier: "content", mount: true },
    "footnotes.json": { tier: "content", mount: true },
    "notes.json": { tier: "content", mount: true },
    "orphaned-footnotes.json": { tier: "content", mount: true },
    "reports.json": { tier: "content", mount: true },
    "revisions.json": { tier: "content", mount: true },
    "suggestions.json": { tier: "content", mount: true },
    "todos.json": { tier: "content", mount: true },
    // Paragraph titles + collapsed state. Content (a `parTitle` is the user's
    // prose), but its cadence is NOT ours to set here: it rides the `.tex`
    // autosave inside `writeDocBundle`, one write per bundle write. Declared so
    // the conflict scanner and the mount derivation can both see it.
    "virgil.json": { tier: "content", mount: false },
  });

/** Every filename the value table declares. Stable order (declaration order). */
export const ALL_VIRGIL_SIDECAR_FILENAMES: readonly string[] = Object.freeze(
  Object.keys(SIDECAR_VALUE),
);

/**
 * The files the doc-mount sidecar bundle pre-reads — DERIVED, so it cannot
 * drift from the write vocabulary. Re-exported by `sidecar-files.ts` under its
 * historical name so no consumer changed.
 */
export const MOUNT_SIDECAR_FILENAMES: readonly string[] = Object.freeze(
  ALL_VIRGIL_SIDECAR_FILENAMES.filter((f) => SIDECAR_VALUE[f]!.mount),
);

/**
 * What this file is worth. **Fails closed to `"content"`**: an undeclared file
 * gets the prompt cadence and the loud conflict report, never the lossy ones.
 * A wrongly-content file costs some extra writes; a wrongly-view file costs the
 * user's writing, so the asymmetry is the whole of the default.
 */
export function sidecarTier(filename: string): SidecarTier {
  return SIDECAR_VALUE[filename]?.tier ?? "content";
}

/**
 * Idle window before a change to a CONTENT sidecar is written to disk. This is
 * the pre-363 `usePersistentState` default, unchanged: a card edit is the
 * user's writing and must reach disk promptly.
 */
export const CONTENT_WRITE_DEBOUNCE_MS = 300;

/**
 * Idle window before a change to a VIEW sidecar is written to disk.
 *
 * Chosen for the race window rather than for responsiveness: nothing READS
 * these files while the document is open (they are consumed once, at load), so
 * the only cost of waiting is what an abrupt kill would lose — a scroll offset.
 * 2.5 s collapses a reading session's scroll-pause writes from ~100 to a
 * handful while leaving the restore exact, because every writer also flushes on
 * the boundaries that matter: doc switch, unmount, and the tab going hidden.
 */
export const VIEW_WRITE_DEBOUNCE_MS = 2500;

/** The write cadence for this file, derived from its tier. The ONE place a
 *  sidecar debounce number comes from — CI forbids a hand-picked literal at a
 *  write site. */
export function sidecarWriteDebounceMs(filename: string): number {
  return sidecarTier(filename) === "view"
    ? VIEW_WRITE_DEBOUNCE_MS
    : CONTENT_WRITE_DEBOUNCE_MS;
}
