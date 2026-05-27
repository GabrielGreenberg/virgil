"use client";

import { createContext, useContext } from "react";

/**
 * Context the SplitWithCode primitive publishes to its descendants
 * (EditorPane in particular) so they can auto-compress their internal
 * chrome when the code pane is eating into their layout.
 *
 * `active` distinguishes "the user is using split-mode" from
 * "EditorPane is in a no-split context." `compressed` is the action
 * trigger — true when the editor pane is sized below its natural width
 * and should drop gutters (and disable margin-edit) to keep the prose
 * column usable. `clippedPx` is informational (downstream chrome may
 * want to fade the right edge once clipping starts).
 *
 * Default value (no provider) is `{ active: false, … }` so EditorPane
 * usage outside SplitWithCode is a no-op.
 */
export interface CodePaneSplitState {
  active: boolean;
  /** Editor pane should suppress wide gutters / margin-edit chrome. */
  compressed: boolean;
  /** Distance (px) past the editor's compressed min-width that the
   *  clip wrapper is currently obscuring. 0 means no clipping. */
  clippedPx: number;
}

const DEFAULT_STATE: CodePaneSplitState = {
  active: false,
  compressed: false,
  clippedPx: 0,
};

const CodePaneSplitContext = createContext<CodePaneSplitState>(DEFAULT_STATE);

export function useCodePaneSplit(): CodePaneSplitState {
  return useContext(CodePaneSplitContext);
}

export const CodePaneSplitProvider = CodePaneSplitContext.Provider;
