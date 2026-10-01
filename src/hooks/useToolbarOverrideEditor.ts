"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";

/**
 * The pane's toolbar-override editor: when a card mini-editor (e.g. a footnote
 * RichTextField) is focused, the pane's toolbars route commands to it
 * (`overrideEditor ?? editor`).
 *
 * The WHOLE lifecycle is owned here, per pane (task 870). It is SET by
 * mini-editor focus (through `EditorRefProvider`'s `setOverrideEditor`) and
 * RELEASED when
 *   - this pane's main editor regains focus, or
 *   - the override editor is destroyed (its card was deleted or collapsed),
 * so the toolbar never stays bound to a card editor — or to a dead one. The
 * focus reset used to live in EditorLayout and cleared a shell copy of this
 * state that no toolbar read.
 *
 * Cost: two edge-event subscriptions (`focus`, `destroy`); neither fires per
 * keystroke.
 */
export function useToolbarOverrideEditor(
  mainEditor: Editor | null,
): [Editor | null, Dispatch<SetStateAction<Editor | null>>] {
  const [overrideEditor, setOverrideEditor] = useState<Editor | null>(null);

  useEffect(() => {
    if (!mainEditor) return;
    const clearOverride = () => setOverrideEditor(null);
    mainEditor.on("focus", clearOverride);
    return () => { mainEditor.off("focus", clearOverride); };
  }, [mainEditor]);

  useEffect(() => {
    if (!overrideEditor) return;
    const release = () =>
      setOverrideEditor((cur) => (cur === overrideEditor ? null : cur));
    if (overrideEditor.isDestroyed) {
      release();
      return;
    }
    overrideEditor.on("destroy", release);
    return () => { overrideEditor.off("destroy", release); };
  }, [overrideEditor]);

  return [overrideEditor, setOverrideEditor];
}
