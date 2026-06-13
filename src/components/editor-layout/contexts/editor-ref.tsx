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
