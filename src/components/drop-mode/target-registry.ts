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
 *
 * OWNERSHIP (task 1401, the "per-doc services under multi-pane keep-alive"
 * law). Under multi-doc keep-alive several `EditorPane`s are mounted at once,
 * the hidden ones `display:none`, and every one of their editors registers
 * here. So each entry records its OWNER — the `PaneRootContext` id of the pane
 * it mounted under (`null` outside any pane: a bare test harness, an app-level
 * host). A per-document question ("where is the atom with this id?") is asked
 * of ONE owner's editors through {@link getEditorsOwnedBy}; there is
 * deliberately no owner-blind enumeration, so no caller can reach a hidden
 * paper's document by default.
 */

import type { Editor } from "@tiptap/react";

/** The pane an editor belongs to: its `PaneRootContext` id, or `null`. */
export type DropTargetOwner = string | null;

interface TargetEntry {
  editor: Editor;
  owner: DropTargetOwner;
}

const entryByDom = new Map<HTMLElement, TargetEntry>();

/**
 * Register an editor with the target registry, under the pane that owns it
 * (`useContext(PaneRootContext)` at the registering component). Returns a
 * dispose function — callers should run it on unmount. Safe to call with a
 * null editor (no-op).
 */
export function registerDropTarget(
  editor: Editor | null,
  owner: DropTargetOwner = null,
): () => void {
  if (!editor) return () => {};
  const dom = editor.view.dom as HTMLElement;
  entryByDom.set(dom, { editor, owner });
  return () => {
    if (entryByDom.get(dom)?.editor === editor) {
      entryByDom.delete(dom);
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
      const entry = entryByDom.get(pm);
      if (entry) return entry.editor;
    }
  }
  return null;
}

/** The owner `editor` was registered under; `undefined` if it is not
 *  registered at all. */
export function dropTargetOwner(editor: Editor): DropTargetOwner | undefined {
  return entryByDom.get(editor.view.dom as HTMLElement)?.owner;
}

/** Every registered editor OWNED BY `owner` — one pane's main editor and card
 *  bodies, never a sibling pane's. A PRODUCTION enumeration:
 *  `util/inline-atom-move.ts`'s `locateAtom` walks it to find a by-id atom in
 *  the dragging pane's own document set. */
export function getEditorsOwnedBy(owner: DropTargetOwner): Editor[] {
  const out: Editor[] = [];
  for (const entry of entryByDom.values()) {
    if (entry.owner === owner) out.push(entry.editor);
  }
  return out;
}
