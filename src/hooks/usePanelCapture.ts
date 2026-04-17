"use client";

/**
 * Generalized "capture drop" plumbing — lets any side panel accept drops
 * from the editor that carry either a whole paragraph (via its drag handle)
 * or a text selection. The panel registers `onCapture`, receives rich
 * content + the source paragraph's UUID, and decides what to do with it
 * (archive it, file it as a note, etc.). The editor content is extracted
 * on drop; for paragraph drops an empty shell is left behind (so margin
 * markers anchored by UUID remain in place).
 *
 * Other panels can reuse this by importing `usePanelCapture` and passing a
 * handler that persists the captured content in their own store, then
 * anchors a marker via paragraph UUID.
 */

import { useCallback, useState } from "react";
import type { Editor } from "@tiptap/react";
import { isAnchorableNode } from "@/lib/marginalia";

/** Payload: `{ uuid }` — identifies a whole-paragraph drag originating from the grip. */
export const MIME_PAR_CAPTURE = "application/x-virgil-par-capture";
/** Payload: `{ from, to, paragraphId }` — identifies a text-selection drag. */
export const MIME_TEXT_CAPTURE = "application/x-virgil-text-capture";

export interface CapturedContent {
  /** Rich content (Tiptap doc JSON) extracted from the editor. */
  content: unknown;
  /** UUID of the paragraph the content came from, or null if unresolvable. */
  paragraphId: string | null;
  /** "paragraph" = whole paragraph shell left behind; "range" = inline text removed. */
  kind: "paragraph" | "range";
}

/** Extract a paragraph by UUID, leaving an empty shell (preserving attrs). */
export function extractParagraphByUuid(
  editor: Editor,
  uuid: string,
): CapturedContent | null {
  let nodePos: number | null = null;
  let foundNode: import("@tiptap/pm/model").Node | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (nodePos !== null) return false;
    if (node.attrs?.uuid === uuid) {
      nodePos = pos;
      foundNode = node;
      return false;
    }
    return true;
  });
  if (nodePos === null || !foundNode) return null;
  const node = foundNode as import("@tiptap/pm/model").Node;
  const paragraphJson = node.toJSON();
  const content = { type: "doc", content: [paragraphJson] };
  const start = nodePos + 1;
  const end = nodePos + node.nodeSize - 1;
  if (start < end) {
    const tr = editor.state.tr.delete(start, end);
    editor.view.dispatch(tr);
  }
  return { content, paragraphId: uuid, kind: "paragraph" };
}

/** Extract a range as rich content, deleting it from the doc. */
export function extractRange(
  editor: Editor,
  from: number,
  to: number,
): CapturedContent | null {
  if (from === to) return null;
  const docSize = editor.state.doc.content.size;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(0, Math.min(to, docSize));
  if (safeFrom >= safeTo) return null;
  const text = editor.state.doc.textBetween(safeFrom, safeTo, " ");
  if (!text.trim()) return null;
  const $pos = editor.state.doc.resolve(safeFrom);
  let paragraphId: string | null = null;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (isAnchorableNode(node.type)) {
      paragraphId = (node.attrs?.uuid as string | null) ?? null;
      break;
    }
  }
  const slice = editor.state.doc.slice(safeFrom, safeTo);
  const content = { type: "doc", content: slice.content.toJSON() };
  const tr = editor.state.tr.delete(safeFrom, safeTo);
  editor.view.dispatch(tr);
  return { content, paragraphId, kind: "range" };
}

/** Returns true if the DataTransfer carries a capture payload. */
export function hasCaptureData(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return dt.types.includes(MIME_PAR_CAPTURE) || dt.types.includes(MIME_TEXT_CAPTURE);
}

interface UsePanelCaptureOptions {
  editor: Editor | null;
  onCapture: (captured: CapturedContent) => void;
  enabled?: boolean;
}

/**
 * Hook returning drop handlers + hover state for a panel that wants to
 * capture paragraph/selection drops from the editor. Spread `dropProps`
 * onto the panel's outermost element; use `isDragOver` to drive styling.
 */
export function usePanelCapture({
  editor,
  onCapture,
  enabled = true,
}: UsePanelCaptureOptions) {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !editor) return;
      if (!hasCaptureData(e.dataTransfer)) return;
      e.preventDefault();
      setIsDragOver(true);
    },
    [enabled, editor],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !editor) return;
      if (!hasCaptureData(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!isDragOver) setIsDragOver(true);
    },
    [enabled, editor, isDragOver],
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when the pointer actually leaves the panel (not when it
    // moves onto a child element).
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setIsDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      if (!enabled || !editor) return;
      const parData = e.dataTransfer.getData(MIME_PAR_CAPTURE);
      if (parData) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const { uuid } = JSON.parse(parData) as { uuid: string };
          const result = extractParagraphByUuid(editor, uuid);
          if (result) onCapture(result);
        } catch {
          /* ignore bad payload */
        }
        return;
      }
      const textData = e.dataTransfer.getData(MIME_TEXT_CAPTURE);
      if (textData) {
        e.preventDefault();
        e.stopPropagation();
        try {
          const { from, to } = JSON.parse(textData) as { from: number; to: number };
          const result = extractRange(editor, from, to);
          if (result) onCapture(result);
        } catch {
          /* ignore bad payload */
        }
      }
    },
    [enabled, editor, onCapture],
  );

  return {
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragOver,
  };
}
