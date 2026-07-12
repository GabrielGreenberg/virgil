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
 * column usable.
 *
 * This state carries EDGES only (open/close, compressed threshold
 * crossings) — never per-frame drag geometry. A context identity that
 * changed per pointer frame would pierce consumers' element-identity
 * bailouts and re-render EditorPane per frame; frame-granular values
 * (the clip-fade depth) live locally in SplitWithCode.
 *
 * Default value (no provider) is `{ active: false, … }` so EditorPane
 * usage outside SplitWithCode is a no-op.
 */
export interface CodePaneSplitState {
  active: boolean;
  /** Editor pane should suppress wide gutters / margin-edit chrome. */
  compressed: boolean;
}

const DEFAULT_STATE: CodePaneSplitState = {
  active: false,
  compressed: false,
};

const CodePaneSplitContext = createContext<CodePaneSplitState>(DEFAULT_STATE);

export function useCodePaneSplit(): CodePaneSplitState {
  return useContext(CodePaneSplitContext);
}

export const CodePaneSplitProvider = CodePaneSplitContext.Provider;
