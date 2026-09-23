"use client";

/**
 * THE source pod's CodeMirror mount — one configuration, one theme, one
 * change handler shape, for every wearer of the pod (task 729).
 *
 * ## Why this module exists at all
 *
 * `@uiw/react-codemirror` reconfigures the live editor whenever any of
 * `[theme, extensions, height…, editable, readOnly, basicSetup, onChange,
 * onUpdate]` changes IDENTITY — it dispatches
 * `StateEffect.reconfigure.of(getExtensions)` from an effect keyed on exactly
 * that list (`useCodeMirror.js`). Both pod wearers used to hand it three
 * values that change identity on every single render:
 *
 *   - `extensions={[ latex(…), theme, … ]}` — an ARRAY LITERAL in the render
 *     body, with `latex()` minting a fresh `LanguageSupport` each call;
 *   - `basicSetup={{ … }}` — an OBJECT LITERAL, same;
 *   - `onChange={handler}` — a `useCallback` whose deps include the source
 *     string it compares against, so it changes by construction per keystroke.
 *
 * And a pod DOES re-render per keystroke: the keystroke writes the source back
 * through `updateAttributes` / `setNodeMarkup`. React Compiler is not enabled,
 * so nothing memoized those literals for us. Every character therefore cost a
 * full reconfigure.
 *
 * The expensive half is not the reconfigure itself but what it MOUNTS. `@uiw`
 * builds `defaultThemeOption = EditorView.theme({height, minHeight, …})`
 * inside its hook body, so each reconfigure installs a BRAND-NEW `StyleModule`
 * — and `style-mod`'s `mount` never prunes: its module list only grows, and in
 * the `<style>`-tag path it rebuilds the tag's entire `textContent` from every
 * accumulated module each time. So typing N characters left N orphan theme
 * modules behind and re-serialized all of them on the way, which is why a pod
 * got slower the longer you typed, slowed the WHOLE page (the stylesheet is
 * document-wide), and did not recover until reload.
 *
 * ## The shape the fix takes
 *
 * Everything the reconfigure effect watches is hoisted to MODULE SCOPE, and
 * the one thing that genuinely varies per render — the caller's change handler
 * — is read through a latest-ref behind a permanently stable callback. The
 * caller keeps writing its handler however it likes; identity stability is
 * this module's job, not every wearer's.
 *
 * Both wearers mount THIS component rather than `CodeMirror` directly
 * (`SourcePodNodeView` docked, `SourcePodFloatBody` popped), so a third wearer
 * inherits the stability instead of re-deriving it — and the pod's theme stops
 * being two hand-synced copies of one look.
 *
 * CI: `source-pod-codemirror-stability.test.tsx`.
 */

import { useCallback, useEffect, useRef } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import { NEVER_SPELLCHECK_ATTRS } from "@/lib/spellcheck-policy";

/**
 * The pod's look — a slimmed-down `CodeEditor.tsx` `virgilTheme`, sized for
 * inline embedding inside a doc paragraph rather than a full code-view pane.
 * Border tone matches the heading-annotation lozenge so the pod reads as
 * Virgil-native chrome rather than a generic input, and the 44px right inset
 * on the content clears the kind chip.
 *
 * ONE theme: the docked pod and the released float must frame identically (no
 * framing jump on release), and until task 729 that was two literal copies
 * kept in step by hand. Module-local on purpose — it reaches a pod only inside
 * `SOURCE_POD_EXTENSIONS`, so there is no second way to mount it.
 */
const sourcePodTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono), 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "var(--code-block-bg, rgba(124, 94, 60, 0.04))",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--heading-annotation-border, #a8c4de)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-content": {
    padding: "10px 12px",
    paddingRight: "44px",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.15) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.2) !important",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(124, 94, 60, 0.2)",
    outline: "1px solid rgba(124, 94, 60, 0.4)",
  },
});

/**
 * The pod's extension set. Module scope is the point — this array's IDENTITY
 * is what the reconfigure effect watches, so it must be minted exactly once
 * for the lifetime of the app. A CodeMirror extension value is a description,
 * not a live object, so one array is safely shared by every mounted pod.
 */
export const SOURCE_POD_EXTENSIONS = [
  // `enableLinting` defaults to TRUE in codemirror-lang-latex despite what the
  // .d.ts suggests — the linter checks for `\begin{document}` and unmatched
  // environments, both of which fire on any raw LaTeX fragment. We never want
  // those diagnostics here.
  latex({ enableLinting: false }),
  sourcePodTheme,
  EditorView.lineWrapping,
  // Defense-in-depth: also suppress browser spell-check so plain words inside
  // `{…}` arguments don't get wavy underlines.
  EditorView.contentAttributes.of(NEVER_SPELLCHECK_ATTRS),
  EditorState.tabSize.of(2),
];

/** The pod's `basicSetup` overrides — module scope for the same reason. */
export const SOURCE_POD_BASIC_SETUP = {
  lineNumbers: false,
  highlightActiveLineGutter: false,
  highlightActiveLine: false,
  bracketMatching: true,
  foldGutter: false,
  indentOnInput: true,
  closeBrackets: true,
  autocompletion: false,
};

export interface SourcePodCodeMirrorProps {
  /** The bytes the pod is holding. */
  value: string;
  /**
   * Called with the new bytes on every edit. Its identity may change freely —
   * the component reads it through a ref, so what CodeMirror receives is a
   * permanently stable function and no handler churn can reconfigure the
   * editor.
   */
  onChange: (value: string) => void;
  /**
   * The pod's editability, resolved by the wearer from the main editor's
   * `data-editable` signal (task 728). Read-only the surface still SELECTS but
   * takes no caret and no keystroke.
   */
  editable: boolean;
}

export function SourcePodCodeMirror({
  value,
  onChange,
  editable,
}: SourcePodCodeMirrorProps) {
  // The latest-ref, written from an EFFECT rather than the render body: a
  // render-phase ref write is a side effect in render, which the React
  // Compiler lint correctly refuses. CodeMirror's `onChange` only ever fires
  // out of a committed DOM interaction, so the ref is always current by then.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Empty deps ON PURPOSE — this identity must never change. The handler it
  // forwards to is read at CALL time, so "stable" here does not mean "frozen
  // to the first render's handler".
  const handleChange = useCallback((next: string) => {
    onChangeRef.current(next);
  }, []);

  return (
    <CodeMirror
      value={value}
      onChange={handleChange}
      editable={editable}
      extensions={SOURCE_POD_EXTENSIONS}
      basicSetup={SOURCE_POD_BASIC_SETUP}
    />
  );
}

export default SourcePodCodeMirror;
