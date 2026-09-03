"use client";

/**
 * React read of THE document-interruption view (task 545) — one hook, every
 * surface. Composes the four channels (`cowork-pen`, the `DiskWatcher` store,
 * `preservation-notice`, the save-state ladder) into
 * `deriveDocumentInterruption` and records each new presentation on the
 * provenance log.
 *
 * KEYSTROKE SANCTITY: every input is a `useSyncExternalStore` read over an
 * edge-driven store (plus `useSaveState`'s boundary-scheduled ticker); no
 * editor subscription anywhere. A typing burst costs one bailed render.
 *
 * The external-change store belongs to the ACTIVE document's watcher. Under
 * multi-doc keep-alive a warm pane asking for its own docId must not read the
 * active doc's conflict as its own, so the external input is the clean
 * snapshot for any docId that is not the provider's active one.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  getCoworkPen,
  getCoworkPenLastRelease,
  subscribeCoworkPen,
} from "@/lib/cowork-pen";
import {
  deriveDocumentInterruption,
  type DocumentInterruption,
} from "@/lib/document-interruption";
import { recordInterruptionEvent } from "@/lib/interruption-log";
import type { ExternalChangeState } from "@/lib/disk-watcher";
import { useExternalChangesOrNull } from "@/hooks/useExternalChanges";
import { useDiskWatcherOrNull } from "@/components/editor-layout/contexts/disk-watcher";
import { usePreservationNotice } from "@/hooks/usePreservationNotice";
import { useSaveState } from "@/hooks/useSaveState";

const CLEAN_EXTERNAL: ExternalChangeState = Object.freeze({
  changes: Object.freeze([]),
  severity: null,
  detectedAt: null,
  paused: false,
});

export function useDocumentInterruption(
  docId: string | null | undefined,
): DocumentInterruption | null {
  const pen = useSyncExternalStore(
    subscribeCoworkPen,
    () => getCoworkPen(docId),
    () => null,
  );
  const penLastReleasedAt = useSyncExternalStore(
    subscribeCoworkPen,
    () => getCoworkPenLastRelease(docId),
    () => null,
  );
  const { state: liveExternal } = useExternalChangesOrNull();
  const diskCtx = useDiskWatcherOrNull();
  const external =
    docId && diskCtx && diskCtx.activeDocId === docId ? liveExternal : CLEAN_EXTERNAL;
  const preservation = usePreservationNotice(docId ?? null);
  const save = useSaveState(docId);

  const view = useMemo(
    () =>
      deriveDocumentInterruption({
        docId,
        pen,
        penLastReleasedAt,
        external,
        preservation,
        save,
      }),
    // `save` is re-derived per render; its fields are what the view reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, pen, penLastReleasedAt, external, preservation, save.tier, save.ageMs, save.reason],
  );

  // Provenance, member 1: one entry per presentation. The log dedupes on
  // (docId, kind, detectedAt), so a per-minute age re-render records nothing.
  const kind = view?.kind ?? null;
  const detectedAt = view?.detectedAt ?? null;
  useEffect(() => {
    if (!view || !docId) return;
    recordInterruptionEvent({
      docId,
      kind: view.kind,
      at: Date.now(),
      detectedAt: view.detectedAt,
      writer: view.writer,
      penHeld: pen !== null,
      penLastReleasedAt,
      unsavedAgeMs: save.ageMs,
    });
    // Only a NEW presentation records — never the age ticking under one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, kind, detectedAt]);

  return view;
}
