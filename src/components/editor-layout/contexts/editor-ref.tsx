"use client";

import { createContext, useContext, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
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
