"use client";

// The ORPHAN events — one door for both directions (task 598).
//
// `LinkedAnchorGuard` (Mode B: a `linkedAnchor` mark vanished) and
// `TextObjectOrphanGuard` (Mode A: an anchorable block vanished) announce a
// departure on `window`, and the per-doc card hooks (useNotes / useTodos /
// useCutter / useReports / useRevisions / useArchive) strip the dead link.
//
// The channel is window-level and the hooks are mounted once PER PANE — N
// `EditorPane`s are alive at once under multi-doc keep-alive, and the Library
// Reader mounts the same component again. Membership (anchorId / uuid) is a
// fine discriminator WITHIN a document and is not one ACROSS documents: the
// same paper open as an authored doc and in the Reader, or a duplicated paper
// folder, shares every id. So the event carries the `docId` of the editor
// whose transaction removed the anchor, and a listener answers only its own —
// the rule every other window family in this vocabulary already follows
// (`usePersistentState`, `useAiRequests`, footnote-sync, TEX_DELIMITERS…).
//
// STRICT on `docId: null`: an editor surface that knows no document (a card
// body with no `docIdRef`) edits content that is not the paper's, so its
// departures are nobody's orphans. Floats thread the host doc's `docIdRef`
// and are heard as the main editor.
//
// Dispatch and subscription both live here so the field cannot be dropped on
// one side: `pane-scoped-listener-census.test.ts` refuses a raw `"virgil-*-orphaned"`
// literal anywhere else in production code.

import { useEffect, useRef } from "react";

export const ANCHOR_ORPHANED_EVENT = "virgil-anchor-orphaned";
export const TEXTOBJECT_ORPHANED_EVENT = "virgil-textobject-orphaned";
/** The RETURN direction (task 1193): an anchor came back. Announced for every
 *  inserted block uuid / `linkedAnchor` mark, so the card hooks can revive a
 *  DORMANT link (`@/links/dormant`) whose archived text is in the doc again —
 *  a Restore, a doc Undo of an archive, any re-insertion alike. */
export const ANCHORS_REVIVED_EVENT = "virgil-anchors-revived";
/** The DEPARTURE into an archive (task 1269): ids that left the document
 *  while an un-retired archive snippet holds them (`archive-holdings.ts`) — a
 *  HISTORY REPLAY of an archive (Redo), which carries no lifecycle meta. The
 *  card hooks answer by making the links dormant in that snippet. Dispatched
 *  BEFORE the orphan events for the same ids, so the strip that follows sees
 *  dormant links and skips them (`removeTextObjectLink` / `getTextAnchor`). */
export const ANCHORS_ARCHIVED_EVENT = "virgil-anchors-archived";

export interface AnchorOrphanedDetail {
  /** The document whose editor removed the mark; `null` = no document. */
  docId: string | null;
  anchorId: string;
  kind: string;
}

export interface TextObjectOrphanedDetail {
  /** The document whose editor removed the block; `null` = no document. */
  docId: string | null;
  uuid: string;
  typeName: string;
}

export interface AnchorsRevivedDetail {
  /** The document whose editor inserted the anchors; `null` = no document. */
  docId: string | null;
  /** Block uuids the transaction inserted (live on the settled doc). */
  uuids: string[];
  /** `linkedAnchor` mark ids the transaction inserted (live on the settled doc). */
  anchorIds: string[];
}

export interface AnchorsArchivedDetail {
  /** The document whose editor removed the anchors; `null` = no document. */
  docId: string | null;
  /** The un-retired snippet that holds them. */
  snippetId: string;
  /** Departed block uuids the snippet holds. */
  uuids: string[];
  /** Departed `linkedAnchor` ids the snippet's carried marks name. */
  anchorIds: string[];
}

export function dispatchAnchorsArchived(detail: AnchorsArchivedDetail): void {
  if (detail.uuids.length === 0 && detail.anchorIds.length === 0) return;
  window.dispatchEvent(new CustomEvent(ANCHORS_ARCHIVED_EVENT, { detail }));
}

export function dispatchAnchorsRevived(detail: AnchorsRevivedDetail): void {
  if (detail.uuids.length === 0 && detail.anchorIds.length === 0) return;
  window.dispatchEvent(new CustomEvent(ANCHORS_REVIVED_EVENT, { detail }));
}

export function dispatchAnchorOrphaned(detail: AnchorOrphanedDetail): void {
  window.dispatchEvent(new CustomEvent(ANCHOR_ORPHANED_EVENT, { detail }));
}

export function dispatchTextObjectOrphaned(detail: TextObjectOrphanedDetail): void {
  window.dispatchEvent(new CustomEvent(TEXTOBJECT_ORPHANED_EVENT, { detail }));
}

/** True when an orphan event belongs to `docId` — the ONE gate. */
export function isOrphanForDoc(
  detail: { docId?: string | null } | null | undefined,
  docId: string | null,
): boolean {
  return !!docId && !!detail && detail.docId === docId;
}

function useOrphanEvent<D extends { docId: string | null }>(
  type: string,
  docId: string | null,
  handler: (detail: D) => void,
): void {
  // Latest handler through a ref, so a caller's non-memoized callback does not
  // re-register the listener every render.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (!docId) return;
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<D>).detail;
      if (!isOrphanForDoc(detail, docId)) return;
      handlerRef.current(detail);
    };
    window.addEventListener(type, onEvent);
    return () => window.removeEventListener(type, onEvent);
  }, [type, docId]);
}

/** Subscribe to Mode-B departures (a `linkedAnchor` mark) in `docId` only. */
export function useAnchorOrphaned(
  docId: string | null,
  handler: (detail: AnchorOrphanedDetail) => void,
): void {
  useOrphanEvent(ANCHOR_ORPHANED_EVENT, docId, handler);
}

/** Subscribe to Mode-A departures (an anchorable block) in `docId` only. */
export function useTextObjectOrphaned(
  docId: string | null,
  handler: (detail: TextObjectOrphanedDetail) => void,
): void {
  useOrphanEvent(TEXTOBJECT_ORPHANED_EVENT, docId, handler);
}

/** Subscribe to anchor RETURNS (blocks / marks re-inserted) in `docId` only. */
export function useAnchorsRevived(
  docId: string | null,
  handler: (detail: AnchorsRevivedDetail) => void,
): void {
  useOrphanEvent(ANCHORS_REVIVED_EVENT, docId, handler);
}

/** Subscribe to departures INTO an archive (task 1269) in `docId` only. */
export function useAnchorsArchived(
  docId: string | null,
  handler: (detail: AnchorsArchivedDetail) => void,
): void {
  useOrphanEvent(ANCHORS_ARCHIVED_EVENT, docId, handler);
}
