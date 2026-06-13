"use client";

import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorHandle } from "../../Editor";

/**
 * Shared editor handles used by ~every panel host.
 *
 * - `editorInstance` is the live Editor (null during initial mount).
 *   Panels read it for cursor-relative actions.
 * - `editorRef` is the imperative handle from `<VirgilEditor ref>` — use
 *   for scrollTo* / archive / footnote / etc. commands that are exposed
 *   as methods instead of editor commands.
 * - `setOverrideEditor` lets a panel's embedded mini-editor claim the
 *   main toolbar's command routing while it's focused.
 */
export interface EditorRefContextValue {
  editorInstance: Editor | null;
  editorRef: RefObject<EditorHandle | null>;
  setOverrideEditor: Dispatch<SetStateAction<Editor | null>>;
}

const EditorRefCtx = createContext<EditorRefContextValue | null>(null);

export function EditorRefProvider({
  value,
  children,
}: {
  value: EditorRefContextValue;
  children: ReactNode;
}) {
  return <EditorRefCtx.Provider value={value}>{children}</EditorRefCtx.Provider>;
}

export function useEditorRefContext(): EditorRefContextValue {
  const v = useContext(EditorRefCtx);
  if (!v) throw new Error("useEditorRefContext must be used inside EditorRefProvider");
  return v;
}

/**
 * Nullable variant — for components that mount BOTH inside the live app (where
 * the provider exists) and in bare test / preview contexts (where it doesn't),
 * and want to degrade gracefully rather than throw. ExampleCard's directly-
 * editable body uses this: it self-sources the main editor to seed + write back
 * its embedded expex editor when the provider is present, and falls back to a
 * read-only mount when it isn't.
 */
export function useEditorRefContextOrNull(): EditorRefContextValue | null {
  return useContext(EditorRefCtx);
}

/**
 * Reactive read of the MAIN editor's editability — the single read-only /
 * partner-claimed signal embedded-editor panels (the Examples card, the
 * in-editor floats) should gate their own `editable` on.
 *
 * The main editor keeps PM's `view.editable` at `true` ALWAYS (so the DOM
 * stays `contenteditable` and PM keeps syncing); read-only is enforced by the
 * `readOnlyEnforcer` plugin's `filterTransaction` and surfaced declaratively
 * as the `data-editable` attribute on the editor root (`Editor.tsx`). So an
 * embedded editor must read THAT attribute, not `mainEditor.isEditable`
 * (which is a constant `true`). We observe the single attribute so a mid-
 * session read-only toggle (collab pen handoff) flips the embed too. Defaults
 * to `true` (editable) when there's no main editor / attribute yet.
 */
export function useMainEditable(mainEditor: Editor | null | undefined): boolean {
  const [editable, setEditable] = useState(true);
  useEffect(() => {
    const dom = mainEditor?.view?.dom as HTMLElement | undefined;
    if (!dom) {
      setEditable(true);
      return;
    }
    const read = () => setEditable(dom.getAttribute("data-editable") !== "false");
    read();
    const obs = new MutationObserver(read);
    obs.observe(dom, { attributes: true, attributeFilter: ["data-editable"] });
    return () => obs.disconnect();
  }, [mainEditor]);
  return editable;
}
