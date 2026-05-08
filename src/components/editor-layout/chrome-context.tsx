"use client";

/**
 * React context for the active EditorChromeConfig.
 *
 * Wrapped at the EditorLayout level so deep components (MenuBar,
 * ParagraphFloat, HeadingFloat, panel-strip rendering, etc.) can read
 * the chrome flags without prop-drilling through 30+ component layers.
 *
 * The default value is `FULL_CHROME` so any component that consumes the
 * context outside an `EditorChromeProvider` continues to behave as
 * before this refactor.
 */

import { createContext, useContext, type ReactNode } from "react";
import { FULL_CHROME, type EditorChromeConfig } from "./chrome-config";

const EditorChromeContext = createContext<EditorChromeConfig>(FULL_CHROME);

export function EditorChromeProvider({
  value,
  children,
}: {
  value: EditorChromeConfig;
  children: ReactNode;
}) {
  return (
    <EditorChromeContext.Provider value={value}>
      {children}
    </EditorChromeContext.Provider>
  );
}

export function useEditorChrome(): EditorChromeConfig {
  return useContext(EditorChromeContext);
}
