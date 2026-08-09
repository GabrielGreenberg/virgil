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
