"use client";

import { useCallback, useMemo } from "react";
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
 * **Flag OFF preserves the legacy behavior exactly**: a flat citekey-keyed
 * record, no resolver needed. This keeps the existing suite green; the new
 * uid path is exercised only with the flag set in-test.
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

  // Migrate-on-load: legacy flat record → v2 uid-keyed (orphan-bucket the
  // unresolvable keys). When the flag is OFF we keep the raw legacy shape
  // untouched so the on-disk file and behavior are byte-identical to today.
  const migrate = useCallback(
    (raw: unknown): AnnotationsState | AnnotationsStateV2 => {
      if (cascadeOn) return migrateAnnotationsToV2(raw, keyToUid);
      return raw && typeof raw === "object" ? (raw as AnnotationsState) : EMPTY_LEGACY;
    },
    [cascadeOn, keyToUid],
  );

  const { state, update } = usePersistentState<
    AnnotationsState | AnnotationsStateV2
  >(docId, "annotations.json", cascadeOn ? EMPTY_V2 : EMPTY_LEGACY, {
    migrate,
    errorLabel: "annotations",
  });

  const getAnnotation = useCallback(
    (key: string): string => {
      if (cascadeOn && isAnnotationsV2(state)) {
        const uid = getBibEntry?.(key)?.uid;
        if (uid && state.byUid[uid] != null) return state.byUid[uid];
        // Fall back to an orphan bucketed under this exact key (renamed-before-
        // upgrade annotation that hasn't been re-homed yet).
        return state.orphanByKey[key] ?? "";
      }
      // Legacy flat path (flag OFF, or a v1 file the migrator left flat).
      return (state as AnnotationsState)[key] || "";
    },
    [state, cascadeOn, getBibEntry],
  );

  const setAnnotation = useCallback(
    (key: string, text: string) => {
      if (cascadeOn) {
        const uid = getBibEntry?.(key)?.uid;
        update((prev) => {
          const v2: AnnotationsStateV2 = isAnnotationsV2(prev)
            ? { v: 2, byUid: { ...prev.byUid }, orphanByKey: { ...prev.orphanByKey } }
            : { v: 2, byUid: {}, orphanByKey: {} };
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
        });
        return;
      }
      // Legacy flat path.
      update((prev) => {
        const next = { ...(prev as AnnotationsState), [key]: text };
        if (!text) delete next[key];
        return next;
      });
    },
    [update, cascadeOn, getBibEntry],
  );

  return { annotations: state, getAnnotation, setAnnotation };
}
