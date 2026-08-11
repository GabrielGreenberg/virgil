/**
 * EditorGeometry registry — editor-attached service lookup (the `getBus` /
 * `getDocProducts` precedent).
 *
 * `getOrCreateGeometry(editor)` is idempotent and RENDER-SAFE: it only
 * attaches the service object (pure state + methods) to the editor instance;
 * no observers are created and nothing effectful runs, so an adapter hook may
 * call it during render to hand out a working `getMetrics`/`subscribe`
 * surface from the first frame. The effectful engine (IO/RO/bus/window
 * wiring) starts on the first `service.retain()` and stops on the last
 * release — that part belongs in effects.
 */

import type { Editor } from "@tiptap/react";
import {
  createEditorGeometryService,
  type EditorGeometryService,
} from "./service";

const GEOMETRY_KEY = Symbol.for("virgil.editorGeometry");

interface EditorWithGeometry {
  [GEOMETRY_KEY]?: EditorGeometryService;
}

/** Attach-or-return the editor's geometry service. Render-safe (no side
 *  effects beyond the idempotent attach). */
export function getOrCreateGeometry(editor: Editor): EditorGeometryService {
  const ed = editor as unknown as EditorWithGeometry;
  if (ed[GEOMETRY_KEY]) return ed[GEOMETRY_KEY];
  const service = createEditorGeometryService(editor);
  ed[GEOMETRY_KEY] = service;
  return service;
}

/** Peek without creating — for probes / non-owning readers. */
export function getGeometry(
  editor: Editor | null | undefined,
): EditorGeometryService | null {
  if (!editor) return null;
  return (editor as unknown as EditorWithGeometry)[GEOMETRY_KEY] ?? null;
}

/**
 * `view.coordsAtPos(pos)` through the editor's geometry service memo when
 * one is attached (per-frame + per-doc dedup — see the service JSDoc),
 * falling back to a direct read for service-less editors (harnesses). Never
 * throws: a failed resolve returns null, which callers treat as their
 * existing `coordsAtPos` catch path.
 */
export function coordsAtPosCached(
  editor: Editor,
  pos: number,
): { left: number; right: number; top: number; bottom: number } | null {
  const service = getGeometry(editor);
  if (service) return service.coordsAtPosCached(pos);
  try {
    const c = editor.view.coordsAtPos(pos);
    return { left: c.left, right: c.right, top: c.top, bottom: c.bottom };
  } catch {
    return null;
  }
}
