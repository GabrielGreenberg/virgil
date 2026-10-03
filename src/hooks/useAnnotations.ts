"use client";

import { useCallback, useEffect, useMemo } from "react";
import type {
  AnnotationsState,
  AnnotationsStateV2,
  BibEntry,
} from "@/lib/types";
import { usePersistentState } from "./usePersistentState";
import { isIdentityCascadeOn } from "@/lib/identity/identity-flag";
import {
  buildKeyToUid,
  isAnnotationsV2,
  migrateAnnotationsToV2,
} from "@/lib/identity/sidecar-uid-migrate";

/**
 * Annotations sidecar — per-bib-entry rich-text notes.
 *
 * Identity model (T1 Stage 1): when the `virgil:identity-cascade` flag is ON,
 * annotations key on the durable {@link BibEntry.uid} (v2 shape), so a citekey
 * rename strands nothing — fixing the DATA-LOSS bug BIB-A2-01. The public API
 * is UNCHANGED — callers still pass `entry.key` (a citekey) — and the hook
 * resolves citekey → uid internally via the passed `getBibEntry` resolver.
 *
 * **The flag gates the FORMAT a legacy file is upgraded to, never what the hook
 * can READ** (task 912; task 689's "a rollout flag may gate a FORMAT, never a
 * BEHAVIOUR"). Flag ON: a flat citekey-keyed file migrates to v2. Flag OFF: a
 * flat file stays flat, byte-identical to before — but a file that is ALREADY
 * v2 (written by an ON session, then the flag rolled back) is read and written
 * as v2. The shape on disk, not the flag, picks the read/write path, so a
 * rollback neither hides the uid-keyed annotations nor mixes a flat write into
 * the v2 object (which the ON reader used to drop on its next persist).
 *
 * `getBibEntry` is optional so an old call site (`useAnnotations(docId)`) keeps
 * compiling; when absent, the hook always uses the legacy flat path (the uid
 * re-key needs the entry list to resolve keys).
 */
type GetBibEntry = (key: string) => BibEntry | undefined;

const EMPTY_LEGACY: AnnotationsState = {};
const EMPTY_V2: AnnotationsStateV2 = { v: 2, byUid: {}, orphanByKey: {} };

export function useAnnotations(
  docId: string | null,
  getBibEntry?: GetBibEntry,
  bibEntries?: readonly BibEntry[],
) {
  const cascadeOn = isIdentityCascadeOn() && !!getBibEntry;

  // citekey → uid resolver, rebuilt only when the entry list identity changes
  // (a parse / add / rename), never on a keystroke.
  const keyToUid = useMemo(
    () => buildKeyToUid(bibEntries ?? []),
    [bibEntries],
  );

  // citekey → uid for one lookup. Prefers the live resolver; falls back to the
  // entry-list map so a flag-OFF reader of a v2 file resolves the same way.
  const resolveUid = useCallback(
    (key: string): string | undefined => getBibEntry?.(key)?.uid ?? keyToUid.get(key),
    [getBibEntry, keyToUid],
  );

  // Migrate-on-load: legacy flat record → v2 uid-keyed (orphan-bucket the
  // unresolvable keys) when the flag is ON. When it is OFF a legacy file keeps
  // its raw shape untouched (byte-identical to before), but a v2 file still
  // goes through the v2 migrator — which also folds back any stray flat key a
  // pre-912 OFF reader wrote onto it (task 912).
  const migrate = useCallback(
    (raw: unknown): AnnotationsState | AnnotationsStateV2 => {
      if (cascadeOn || isAnnotationsV2(raw)) return migrateAnnotationsToV2(raw, keyToUid);
      return raw && typeof raw === "object" ? (raw as AnnotationsState) : EMPTY_LEGACY;
    },
    [cascadeOn, keyToUid],
  );

  const { state, update, stateRef } = usePersistentState<
    AnnotationsState | AnnotationsStateV2
  >(docId, "annotations.json", cascadeOn ? EMPTY_V2 : EMPTY_LEGACY, {
    migrate,
    errorLabel: "annotations",
  });

  // Re-home orphaned annotations once the bib entries arrive AFTER the sidecar
  // load (the read can resolve before the `.bib` parse — the load/parse race).
  // The `migrate`-on-load pass runs ONCE per docId inside usePersistentState
  // with whatever `keyToUid` existed then; if it was empty, every legacy
  // annotation bucketed into `orphanByKey` and would never auto-recover. This
  // effect re-runs the same migrator whenever the resolver changes (a parse /
  // add / rename), so an orphan re-homes onto `byUid` the moment its entry
  // appears — closing the DATA-LOSS-adjacent gap where a later citekey rename
  // would otherwise strand the still-orphaned annotation. Mirrors
  // useBibReview.ts's re-stamp effect.
  //
  // Safe from a render loop + spurious write: migrateAnnotationsToV2 returns the
  // SAME reference when nothing re-homes, so we identity-check against the live
  // state (via `stateRef`) and only call `update` (which schedules a persist)
  // when an orphan actually recovered. On every other keystroke-adjacent bib
  // change this is a pure compare and bails. Pure sidecar state, no editor walk,
  // gated on the entry-list identity (`keyToUid`) — never a per-keystroke
  // counter — so it does no doc-size work.
  useEffect(() => {
    const prev = stateRef.current;
    if (!cascadeOn && !isAnnotationsV2(prev)) return;
    const next = migrateAnnotationsToV2(prev, keyToUid);
    if (next !== prev) update(() => next);
  }, [cascadeOn, keyToUid, update, stateRef]);

  const getAnnotation = useCallback(
    (key: string): string => {
      if (isAnnotationsV2(state)) {
        const uid = resolveUid(key);
        if (uid && state.byUid[uid] != null) return state.byUid[uid];
        // Fall back to an orphan bucketed under this exact key (renamed-before-
        // upgrade annotation that hasn't been re-homed yet).
        return state.orphanByKey[key] ?? "";
      }
      // Legacy flat path (a flat file under flag OFF).
      return (state as AnnotationsState)[key] || "";
    },
    [state, resolveUid],
  );

  const setAnnotation = useCallback(
    (key: string, text: string) => {
      const uid = resolveUid(key);
      update((prev) => {
        // The v2 write path serves the flag ON (upgrading as it writes) AND a
        // file already in v2 under the flag OFF — never a flat key onto v2.
        if (cascadeOn || isAnnotationsV2(prev)) {
          // A still-flat `prev` (a write that beats the load's migrate) is
          // upgraded through the migrator, never replaced by an empty v2.
          const base = isAnnotationsV2(prev) ? prev : migrateAnnotationsToV2(prev, keyToUid);
          const v2: AnnotationsStateV2 = {
            v: 2,
            byUid: { ...base.byUid },
            orphanByKey: { ...base.orphanByKey },
          };
          if (uid) {
            // Writing by uid also clears any stale same-key orphan bucket.
            if (!text) delete v2.byUid[uid];
            else v2.byUid[uid] = text;
            if (key in v2.orphanByKey) delete v2.orphanByKey[key];
          } else {
            // No uid resolvable (entry not loaded) — bucket by key so the write
            // is never lost; it re-homes onto byUid once the entry parses.
            if (!text) delete v2.orphanByKey[key];
            else v2.orphanByKey[key] = text;
          }
          return v2;
        }
        // Legacy flat path (a flat file under flag OFF).
        const next = { ...(prev as AnnotationsState), [key]: text };
        if (!text) delete next[key];
        return next;
      });
    },
    [update, cascadeOn, resolveUid, keyToUid],
  );

  /**
   * Re-key this sidecar for a citekey rename — the IdentityCascade migrator
   * EditorPane registers for `bibEntry` (task 689).
   *
   * Why it exists on BOTH shapes. The annotation is the DATA-LOSS half of the
   * rename (BIB-A2-01): with the flag off, annotations are a flat citekey → html
   * record, so a rename left the user's note under a key that no longer names
   * an entry and it disappeared from the panel. The uid shape was built to make
   * that structurally impossible — and it does, for `byUid`. But `orphanByKey`
   * is citekey-keyed by construction (it is where a write lands when the entry
   * has not parsed yet, or its key doesn't resolve), so the v2 shape has the
   * same hole for exactly those annotations, flag or no flag. One migrator
   * covers both: move the flat entry on v1, move the orphan bucket on v2.
   *
   * NON-DESTRUCTIVE when the destination is occupied: a rename onto an existing
   * citekey is itself a defect (the `.bib` entries fuse — a separate finding),
   * and this door must not turn it into a silently overwritten annotation. We
   * leave both in place rather than delete one we could not restore.
   */
  const renameAnnotationKey = useCallback(
    (oldKey: string, newKey: string) => {
      if (!oldKey || !newKey || oldKey === newKey) return;
      // Read-then-write against the live state so a rename that moves nothing
      // schedules NO persist (`update` always does) — the same identity-check
      // shape as the orphan re-home effect above.
      const prev = stateRef.current;
      let next: AnnotationsState | AnnotationsStateV2 = prev;
      if (isAnnotationsV2(prev)) {
        const text = prev.orphanByKey[oldKey];
        // Absent → the annotation is uid-keyed and already rename-proof.
        // Destination occupied → keep both (see the doc-comment).
        if (text != null && prev.orphanByKey[newKey] == null) {
          const orphanByKey = { ...prev.orphanByKey, [newKey]: text };
          delete orphanByKey[oldKey];
          next = { ...prev, orphanByKey };
        }
      } else {
        const legacy = prev as AnnotationsState;
        const text = legacy[oldKey];
        if (text != null && legacy[newKey] == null) {
          const moved = { ...legacy, [newKey]: text };
          delete moved[oldKey];
          next = moved;
        }
      }
      if (next !== prev) update(() => next);
    },
    [update, stateRef],
  );

  return useMemo(
    () => ({ annotations: state, getAnnotation, setAnnotation, renameAnnotationKey }),
    [state, getAnnotation, setAnnotation, renameAnnotationKey],
  );
}
