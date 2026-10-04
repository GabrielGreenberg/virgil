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

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  EMPTY_VIEW_PREF_PROJECTION,
  attrsFromKey,
  FULL_CHROME,
  type EditorChromeConfig,
  type ViewPrefRootProjection,
} from "./chrome-config";

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

/**
 * The owning view-prefs instance's CSS projection (task 927), for surfaces
 * that leave the pane's DOM subtree. `EditorPane` provides it (memoised on the
 * projection's string key) and applies it to `.editor-pane-root`;
 * `FloatingPanel` reads it here and applies it to its own portaled root, so a
 * float popout carries the classes/attributes of the pane that owns it — the
 * editor's or the Reader's — instead of whatever `<body>` says. Outside a
 * provider (a dialog that reuses the shell) it is empty: no projection.
 */
const ViewPrefProjectionContext = createContext<ViewPrefRootProjection>(
  EMPTY_VIEW_PREF_PROJECTION,
);

export function ViewPrefProjectionProvider({
  value,
  children,
}: {
  value: ViewPrefRootProjection;
  children: ReactNode;
}) {
  return (
    <ViewPrefProjectionContext.Provider value={value}>
      {children}
    </ViewPrefProjectionContext.Provider>
  );
}

export function useViewPrefProjection(): ViewPrefRootProjection {
  return useContext(ViewPrefProjectionContext);
}

/** Memoise a projection on its two primitive halves, so the provided value
 *  (and every `FloatingPanel` reading it) changes only when what it paints
 *  does — not on every render of the pane that computes it. */
export function useStableViewPrefProjection(
  next: ViewPrefRootProjection,
): ViewPrefRootProjection {
  const { className, attrKey } = next;
  return useMemo(() => ({ className, attrKey }), [className, attrKey]);
}

/** HTML attribute → React prop name, for the attributes a registry row may
 *  project (React warns on the lowercase DOM spelling). */
const REACT_PROP_FOR_ATTR: Readonly<Record<string, string>> = {
  spellcheck: "spellCheck",
};

/** The spreadable React props for a projection's attributes. */
export function useViewPrefProjectionAttrs(
  projection: ViewPrefRootProjection,
): Record<string, string> {
  const { attrKey } = projection;
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrsFromKey(attrKey))) {
      out[REACT_PROP_FOR_ATTR[k] ?? k] = v;
    }
    return out;
  }, [attrKey]);
}
