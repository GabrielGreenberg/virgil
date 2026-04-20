/**
 * Linked anchors — pure helpers for creating, resolving, and removing the
 * invisible `linkedAnchor` ProseMirror mark that binds a side-panel card
 * (Note / Revision / Cut) to a specific text range.
 *
 * Truth lives in two places:
 *   1. The ProseMirror doc — the mark itself (source of truth for range).
 *   2. Each feature's sidecar JSON — `{ anchorId, anchorText }` on the card.
 *
 * On load: feature hooks pass their `{anchorId, kind, text}` snapshots to
 * `EditorHandle.applyLinkedAnchors`, which re-applies the mark via text
 * search. On edit: `LinkedAnchorGuard` dispatches `virgil-anchor-orphaned`
 * when a mark vanishes; feature hooks listen and clear their dead ids.
 */

import type { Editor } from "@tiptap/react";
import { generateEntityId } from "@/lib/uuid";

export type LinkedAnchorKind = "note" | "revision" | "cut";

/** Legacy `LinkedAnchorKind` → `CardKind` used in `data-link-card`. */
function legacyKindToCardKind(kind: LinkedAnchorKind): string {
  switch (kind) {
    case "note":
      return "note";
    case "cut":
      return "cut";
    case "revision":
      return "comment";
  }
}

export interface LinkedAnchorRecord {
  anchorId: string;
  paragraphId: string;
  text: string;
  createdAt: string;
}

/** Resolve a ProseMirror position to the containing anchorable node's uuid (if any). */
function paragraphUuidAt(editor: Editor, pos: number): string | null {
  try {
    const $pos = editor.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth >= 0; depth--) {
      const node = $pos.node(depth);
      if (node.attrs?.uuid) return node.attrs.uuid as string;
    }
  } catch {
    // pos out of range
  }
  return null;
}

/**
 * Apply a `linkedAnchor` mark to the current selection (or the given range),
 * returning the new record. Caller is responsible for also calling
 * `ensureParagraphUuid` on the range start *before* calling this, so that
 * the containing paragraph has a uuid to record.
 *
 * When `cardId` is provided, the mark carries `linkCard="<cardKind>:<cardId>"`
 * so the marker is self-describing for Cowork and the LinkConnector
 * selectors. Callers that don't know their card id yet can omit it; the
 * mark will have an empty `linkCard` and be upgraded later via migration.
 */
export function createLinkedAnchor(
  editor: Editor,
  kind: LinkedAnchorKind,
  range?: { from: number; to: number },
  cardId?: string,
): LinkedAnchorRecord | null {
  const sel = range ?? {
    from: editor.state.selection.from,
    to: editor.state.selection.to,
  };
  if (sel.to <= sel.from) return null;
  const anchorId = generateEntityId();
  const text = editor.state.doc.textBetween(sel.from, sel.to, " ");
  const paragraphId = paragraphUuidAt(editor, sel.from) ?? "";
  const cardKind = legacyKindToCardKind(kind);
  const linkCard = cardId ? `${cardKind}:${cardId}` : "";
  const ok = editor
    .chain()
    .setTextSelection(sel)
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard,
    })
    .setTextSelection(sel.from)
    .run();
  if (!ok) return null;
  return {
    anchorId,
    paragraphId,
    text,
    createdAt: new Date().toISOString(),
  };
}

/** Locate the contiguous run carrying `anchorId`. Returns null if missing. */
export function resolveAnchorRange(
  editor: Editor,
  anchorId: string,
): { from: number; to: number } | null {
  let from: number | null = null;
  let to: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (to !== null) return false;
    if (!node.isText) return true;
    const has = node.marks.some(
      (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
    );
    const end = pos + node.nodeSize;
    if (has) {
      if (from === null) from = pos;
      to = end;
    } else if (from !== null && to === null) {
      to = pos;
    }
    return true;
  });
  if (from === null || to === null) return null;
  return { from, to };
}

/** Remove the mark for `anchorId` wherever it appears. */
export function removeLinkedAnchor(editor: Editor, anchorId: string): void {
  const range = resolveAnchorRange(editor, anchorId);
  if (!range) return;
  editor
    .chain()
    .setTextSelection(range)
    .unsetMark("linkedAnchor")
    .setTextSelection(range.from)
    .run();
}

/**
 * Best-effort re-anchor by searching for `snapshot` text in the doc. If
 * found, applies a fresh mark and returns the new record. Used on load
 * for items whose `anchorId` is missing (legacy revisions) or whose mark
 * was lost (e.g. across a re-parse).
 */
export function reanchorByText(
  editor: Editor,
  kind: LinkedAnchorKind,
  snapshot: string,
  preferredAnchorId?: string,
  cardId?: string,
): LinkedAnchorRecord | null {
  const text = editor.getText();
  const index = text.indexOf(snapshot);
  if (index === -1) return null;
  let charCount = 0;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from !== -1 && to !== -1) return false;
    if (node.isText && node.text) {
      const nodeStart = charCount;
      const nodeEnd = charCount + node.text.length;
      if (from === -1 && index >= nodeStart && index < nodeEnd) {
        from = pos + (index - nodeStart);
      }
      if (from !== -1 && to === -1) {
        const endIndex = index + snapshot.length;
        if (endIndex <= nodeEnd) to = pos + (endIndex - nodeStart);
      }
      charCount = nodeEnd;
    }
    return true;
  });
  if (from === -1 || to === -1) return null;
  const anchorId = preferredAnchorId ?? generateEntityId();
  const paragraphId = paragraphUuidAt(editor, from) ?? "";
  const cardKind = legacyKindToCardKind(kind);
  const linkCard = cardId ? `${cardKind}:${cardId}` : "";
  const ok = editor
    .chain()
    .setTextSelection({ from, to })
    .setMark("linkedAnchor", {
      anchorId,
      kind,
      linkId: anchorId,
      linkKind: "anchor",
      linkCard,
    })
    .setTextSelection(from)
    .run();
  if (!ok) return null;
  return {
    anchorId,
    paragraphId,
    text: snapshot,
    createdAt: new Date().toISOString(),
  };
}

/** Set of all anchor ids currently present in the doc. */
export function collectAnchorIds(editor: Editor): Set<string> {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId) {
        ids.add(m.attrs.anchorId as string);
      }
    }
    return true;
  });
  return ids;
}
