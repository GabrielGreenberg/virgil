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
// one side: `orphan-events-door.test.ts` refuses a raw `"virgil-*-orphaned"`
// literal anywhere else in production code.

import { useEffect, useRef } from "react";

export const ANCHOR_ORPHANED_EVENT = "virgil-anchor-orphaned";
export const TEXTOBJECT_ORPHANED_EVENT = "virgil-textobject-orphaned";

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
