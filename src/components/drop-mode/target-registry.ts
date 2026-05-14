/**
 * Drop-target registry. Each TipTap editor (the main editor + every
 * RichTextField card body) registers itself on mount so the drop-mode
 * hit-test can look up which editor is under the cursor.
 *
 * Uses `document.elementsFromPoint` + the editor's `.ProseMirror` root
 * DOM as the lookup key — that DOM element is stable across renders.
 * Stored in a `Map` (not WeakMap) so we can iterate it for debugging,
 * but cleanup on unmount is explicit via the returned dispose fn so
 * stale entries don't accumulate.
 *
 * Notes on identity: when the editor itself ends up wrapped in a node
 * view that nests `.ProseMirror` elements (table cells, for instance),
 * `elementsFromPoint` may surface a child `.ProseMirror` first. The
 * lookup walks the elements list in order and returns the first match.
 */

import type { Editor } from "@tiptap/react";

const editorByDom = new Map<HTMLElement, Editor>();

/**
 * Register an editor with the target registry. Returns a dispose
 * function — callers should run it on unmount. Safe to call with a
 * null editor (no-op).
 */
export function registerDropTarget(editor: Editor | null): () => void {
  if (!editor) return () => {};
  const dom = editor.view.dom as HTMLElement;
  editorByDom.set(dom, editor);
  return () => {
    if (editorByDom.get(dom) === editor) {
      editorByDom.delete(dom);
    }
  };
}

/**
 * Find the editor under a viewport point, or null. Walks
 * `elementsFromPoint` top-to-bottom; the first ancestor with a
 * registered `.ProseMirror` wins. Returns null if no editor is under
 * the point, or if the only ProseMirror elements there aren't
 * registered (e.g. defensive against a stray mount).
 */
export function findEditorAtPoint(x: number, y: number): Editor | null {
  if (typeof document === "undefined") return null;
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    const pm = el.classList.contains("ProseMirror")
      ? el
      : el.closest<HTMLElement>(".ProseMirror");
    if (pm) {
      const ed = editorByDom.get(pm);
      if (ed) return ed;
    }
  }
  return null;
}

/** Test helper / debug. */
export function getRegisteredEditors(): Editor[] {
  return Array.from(editorByDom.values());
}
