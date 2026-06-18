"use client";

import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { usePersistentState } from "./usePersistentState";
import { normalizeRichContent } from "@/lib/footnote-content";
import type { OrphanedFootnote, OrphanedFootnotesState } from "@/lib/types";

/**
 * `useOrphanedFootnotes` — the durable, per-doc home for orphaned footnotes
 * (T2 §3c, FN-A2-01 DATA-LOSS / FN-A2-03 cross-doc bleed).
 *
 * An orphaned footnote is one whose in-text marker is gone but whose body/
 * title the user might still want to recover or re-drop. Pre-fix this state
 * lived ONLY in volatile `EditorLayout` shell `useState`, ABOVE the
 * `<DocPipeline key={currentDocId}>` per-doc remount boundary — so it was
 * lost on reload (no sidecar) and bled across documents (no docId reset).
 *
 * This hook moves ownership to a per-doc sidecar (`orphaned-footnotes.json`),
 * built on the canonical `usePersistentState` primitive so it inherits, for
 * free, every lifecycle contract the audit demands:
 *
 *  - **load on docId** — reads the sidecar on mount / doc switch;
 *  - **debounced persist** — coalesces edits into one write (300ms idle),
 *    flushed synchronously on doc switch / unmount;
 *  - **docId reset** — `docId === null` (or a switch) resets to the empty
 *    default WITHOUT writing, so orphans never bleed across docs (FN-A2-03);
 *  - **read-only no-op** — the Library Reader has no active write handle, so
 *    `persist` silently no-ops (stale-pipeline guard);
 *  - **absent-file migrate** — no sidecar on disk ⇒ start empty; a legacy
 *    bare-array / version-less shape upgrades to `{ version: 1, orphans }`.
 *
 * Because it is keyed on `docId` and lives UNDER the `<DocPipeline>` boundary,
 * reload-loss (FN-A2-01) and cross-doc bleed (FN-A2-03) both vanish, and
 * orphan body/title edits persist (FN-F5-02).
 *
 * Gated behind `virgil:inline-atom-lifecycle`: the wiring that swaps the
 * shell `useState` for this hook (and re-targets the `useOrphanActions` /
 * `useFootnoteSyncBridges` setters onto it) lands in W2b behind that flag.
 * This hook itself is behavior-correct in isolation; the flag governs the
 * cutover, not the hook's internals.
 */

const EMPTY: OrphanedFootnotesState = { version: 1, orphans: [] };

/**
 * Normalize any on-disk shape to the current `{ version: 1, orphans }` form.
 *
 *  - the current versioned object → pass through (normalizing each body);
 *  - a legacy bare array of orphans → wrap;
 *  - a legacy `{ orphans: [...] }` without `version` → stamp version 1;
 *  - anything else → empty.
 *
 * `normalizeRichContent` is applied to each `content` so a legacy HTML-string
 * body upgrades to TipTap JSON, matching `useFootnotes`'s footnote migrate.
 */
function migrateOrphans(raw: unknown): OrphanedFootnotesState {
  const list: unknown = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { orphans?: unknown }).orphans)
      ? (raw as { orphans: unknown[] }).orphans
      : null;
  if (!list) return EMPTY;
  const orphans: OrphanedFootnote[] = (list as unknown[])
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .filter((o) => typeof o.footnoteId === "string")
    .map((o) => ({
      footnoteId: o.footnoteId as string,
      content: normalizeRichContent(o.content),
      title: typeof o.title === "string" ? o.title : undefined,
      thanks: typeof o.thanks === "boolean" ? o.thanks : undefined,
      orphanedAt: typeof o.orphanedAt === "string" ? o.orphanedAt : new Date().toISOString(),
    }));
  return { version: 1, orphans };
}

export interface OrphanedFootnotesApi {
  /** Live orphan list (the panel/omni/search data source). */
  orphans: OrphanedFootnote[];
  /**
   * `Dispatch`-shaped setter over the orphan ARRAY, so the existing
   * `useOrphanActions` / `useFootnoteSyncBridges` consumers (which take a
   * `Dispatch<SetStateAction<OrphanedFootnote[]>>`) re-target onto this hook
   * with a one-line swap — no call-site rewrite. Persists on every change.
   */
  setOrphanedFootnotes: Dispatch<SetStateAction<OrphanedFootnote[]>>;
  /**
   * Insert-or-replace an orphan by `footnoteId`. The semantic upsert the
   * reconciler (W2b) calls when a footnote-with-content's marker is removed.
   * Idempotent: re-upserting the same id replaces in place (no duplicate).
   */
  upsertOrphan: (orphan: OrphanedFootnote) => void;
  /** Drop the orphan record for `id` (re-anchor / re-drop / deliberate delete). */
  clearOrphan: (id: string) => void;
  /** Edit an orphan's rich body (persists). */
  editOrphanContent: (id: string, content: unknown) => void;
  /** Edit an orphan's title (persists). */
  editOrphanTitle: (id: string, title: string) => void;
  /** True once the initial sidecar read for the current docId has resolved. */
  loaded: boolean;
}

export function useOrphanedFootnotes(docId: string | null): OrphanedFootnotesApi {
  const { state, setState, update, loaded } = usePersistentState<OrphanedFootnotesState>(
    docId,
    "orphaned-footnotes.json",
    EMPTY,
    {
      migrate: migrateOrphans,
      // Stamp the version on a legacy/absent shape the first time it loads so
      // the on-disk form converges to v1 (D4 forward-only migration).
      persistMigrationOnLoad: true,
      errorLabel: "orphaned footnotes",
    },
  );

  // Cross-doc bleed guard (FN-A2-03). `usePersistentState` only resets to the
  // default when `docId === null`; on a switch to a doc whose sidecar is ABSENT
  // it leaves the prior doc's state in place (its `readSidecarIfExists` returns
  // null → it skips `setState`, deliberately, so editor-derived hooks like
  // citations aren't clobbered during the load gap). Orphans have NO editor
  // source — an absent sidecar genuinely means "no orphans" — so we reset to
  // EMPTY synchronously on every `docId` change. The async load then overlays
  // the persisted value IFF a sidecar exists (it does not set `hasMutatedRef`,
  // so the load is still allowed to populate). Skip the very first mount (the
  // initial load handles it) to avoid a redundant render.
  const prevDocIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevDocIdRef.current !== undefined && prevDocIdRef.current !== docId) {
      setState(EMPTY);
    }
    prevDocIdRef.current = docId;
  }, [docId, setState]);

  const updateOrphanList = useCallback(
    (fn: (prev: OrphanedFootnote[]) => OrphanedFootnote[]) => {
      update((prev) => ({ version: 1, orphans: fn(prev.orphans) }));
    },
    [update],
  );

  // Array-shaped setter so the existing consumers swap onto it directly.
  const setOrphanedFootnotes = useCallback<Dispatch<SetStateAction<OrphanedFootnote[]>>>(
    (action) => {
      updateOrphanList((prev) =>
        typeof action === "function"
          ? (action as (p: OrphanedFootnote[]) => OrphanedFootnote[])(prev)
          : action,
      );
    },
    [updateOrphanList],
  );

  const upsertOrphan = useCallback(
    (orphan: OrphanedFootnote) => {
      updateOrphanList((prev) => {
        const idx = prev.findIndex((o) => o.footnoteId === orphan.footnoteId);
        if (idx === -1) return [...prev, orphan];
        const next = prev.slice();
        next[idx] = orphan;
        return next;
      });
    },
    [updateOrphanList],
  );

  const clearOrphan = useCallback(
    (id: string) => {
      updateOrphanList((prev) => prev.filter((o) => o.footnoteId !== id));
    },
    [updateOrphanList],
  );

  const editOrphanContent = useCallback(
    (id: string, content: unknown) => {
      updateOrphanList((prev) =>
        prev.map((o) => (o.footnoteId === id ? { ...o, content } : o)),
      );
    },
    [updateOrphanList],
  );

  const editOrphanTitle = useCallback(
    (id: string, title: string) => {
      updateOrphanList((prev) =>
        prev.map((o) => (o.footnoteId === id ? { ...o, title } : o)),
      );
    },
    [updateOrphanList],
  );

  return useMemo(
    () => ({
      orphans: state.orphans,
      setOrphanedFootnotes,
      upsertOrphan,
      clearOrphan,
      editOrphanContent,
      editOrphanTitle,
      loaded,
    }),
    [state.orphans, setOrphanedFootnotes, upsertOrphan, clearOrphan, editOrphanContent, editOrphanTitle, loaded],
  );
}
