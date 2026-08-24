"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PanelId, Side, Half, ViewPrefs } from "@/hooks/useViewPrefs";

/**
 * EditorLayout state + actions contexts.
 *
 * The EditorLayout shell hoists ~40 useState/useRef slots and ~20
 * useXxx(docId) hook outputs. Extracted submodules (drag-drop,
 * render-panel, floating-cards, card-actions, event-bridges, etc.)
 * read what they need from these two contexts rather than receiving
 * every value as a prop.
 *
 * Two contexts, not one, so that values that change on every keystroke
 * (state) don't force re-renders of subscribers that only need the
 * never-changing identities (actions / setters / refs). Pair a
 * state subscription with `useEditorLayoutState()` and an actions
 * subscription with `useEditorLayoutActions()`.
 *
 * This context is intentionally grown incrementally — each extraction
 * slice adds only the fields that the slice's consumers need. Avoid
 * dumping the whole EditorLayout surface in here preemptively; unused
 * fields add noise for agent edits.
 */

// ---------------------------------------------------------------------------
// State — values that change during normal editor use. Add fields here
// when an extracted submodule needs to *read* them.
// ---------------------------------------------------------------------------
export interface EditorLayoutState {
  /** Panel placement preferences: the per-side dock stack, widths, band
   *  heights, float positions. */
  prefs: ViewPrefs;
}

// ---------------------------------------------------------------------------
// Actions — stable function identities (setters, mutators, refs). Adding
// an entry here does NOT force re-renders of subscribers on state change.
// ---------------------------------------------------------------------------
export interface EditorLayoutActions {
  /** Toggle a panel open/closed on its current side. */
  togglePanel: (id: PanelId) => void;
  /** Move a panel to a side, landing it IN FRONT OF `before` (an identity, not
   *  an index — task 440); `null`/omitted appends to that side. */
  movePanel: (id: PanelId, side: Side, before?: PanelId | null) => void;
}

const EditorLayoutStateCtx = createContext<EditorLayoutState | null>(null);
const EditorLayoutActionsCtx = createContext<EditorLayoutActions | null>(null);

export function EditorLayoutProvider({
  state,
  actions,
  children,
}: {
  state: EditorLayoutState;
  actions: EditorLayoutActions;
  children: ReactNode;
}) {
  return (
    <EditorLayoutActionsCtx.Provider value={actions}>
      <EditorLayoutStateCtx.Provider value={state}>
        {children}
      </EditorLayoutStateCtx.Provider>
    </EditorLayoutActionsCtx.Provider>
  );
}

export function useEditorLayoutState(): EditorLayoutState {
  const v = useContext(EditorLayoutStateCtx);
  if (!v) throw new Error("useEditorLayoutState must be used inside EditorLayoutProvider");
  return v;
}

export function useEditorLayoutActions(): EditorLayoutActions {
  const v = useContext(EditorLayoutActionsCtx);
  if (!v) throw new Error("useEditorLayoutActions must be used inside EditorLayoutProvider");
  return v;
}
