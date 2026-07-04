"use client";

/**
 * TeX block float body — CodeMirror instance for raw LaTeX editing.
 *
 * Migrated from the deleted `src/components/TexBlockFloat.tsx`. The outer
 * FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Content sync is hand-rolled because texBlock content is a plain string
 * (the `code` attr), not TipTap JSON — `useFloatMainSync`'s
 * TipTap-on-TipTap `setContent` half doesn't apply here:
 *   - main → float: `useMainTransactionSync` (the shared gated
 *     subscription from float-sync — own-write filter + docChanged gate)
 *     drives `syncFromMain`, which re-reads the target node's `code` /
 *     `parTitle` attrs into local state, refreshing CodeMirror.
 *   - float → main: CodeMirror's onChange dispatches setNodeMarkup with
 *     the new `code` attr.
 *
 * Title editing piggybacks on the same FLOAT_WRITE_META gating.
 */

import { type RefObject, useCallback, useMemo, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { useEditorChrome } from "@/components/editor-layout/chrome-context";
import { viewToggleClasses } from "@/components/editor-layout/chrome-config";
import { TEXT_FLOAT_BODY_PAD_CLASS } from "@/floats/float-policy";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useMainTransactionSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";
import { FloatTitleField } from "./float-title-field";

// Theme matches the in-place TexBlockNodeView's `texBlockTheme` so the
// released popout reads as the same `.tex-block-pod` as the lifted ghost:
// same blue pod border + radius, same content padding (the 44px right
// inset clears the ".tex" chip). The border color is the shared
// --heading-annotation-border var, so the pod tone stays single-source.
const texBlockFloatTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono), 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "var(--code-block-bg, rgba(124, 94, 60, 0.04))",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--heading-annotation-border, #a8c4de)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": {
    padding: "10px 12px",
    paddingRight: "44px",
    caretColor: "var(--accent)",
  },
  ".cm-line": { padding: "0" },
  ".cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.15) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(124, 94, 60, 0.2) !important",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(124, 94, 60, 0.2)",
    outline: "1px solid rgba(124, 94, 60, 0.4)",
  },
});

export function TexBlockBody({
  cardKey,
  id: uuid,
  editorRef,
}: TextObjectFloatBodyProps) {
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let code = "";
    let title: string | null = null;
    if (mainEditor) {
      mainEditor.state.doc.descendants((node) => {
        if (node.type.name === "texBlock" && node.attrs?.uuid === uuid) {
          code = (node.attrs?.code as string) ?? "";
          title = (node.attrs?.parTitle as string | null) ?? null;
          return false;
        }
        return true;
      });
    }
    return { code, title };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const [code, setCode] = useState(initial.code);
  const [title, setTitle] = useState<string | null>(initial.title);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const writeBackToMain = useCallback(
    (next: string) => {
      const ed = ref.current?.getEditor();
      if (!ed) return;
      let pos: number | null = null;
      let targetNode: PMNode | null = null;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === "texBlock" && n.attrs?.uuid === uuid) {
          pos = p;
          targetNode = n;
          return false;
        }
        return true;
      });
      if (pos == null || !targetNode) {
        setSourceMissing(true);
        return;
      }
      const node: PMNode = targetNode;
      if ((node.attrs?.code as string) === next) return;
      const tr = ed.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        code: next,
      });
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, `texBlock:${uuid}`);
      ed.view.dispatch(tr);
    },
    [ref, uuid],
  );

  const handleChange = useCallback(
    (val: string) => {
      if (val === code) return;
      setCode(val);
      writeBackToMain(val);
    },
    [code, writeBackToMain],
  );

  const writeTitleBackToMain = useCallback(
    (next: string | null) => {
      const ed = ref.current?.getEditor();
      if (!ed) return;
      let pos: number | null = null;
      let targetNode: PMNode | null = null;
      ed.state.doc.descendants((n, p) => {
        if (n.type.name === "texBlock" && n.attrs?.uuid === uuid) {
          pos = p;
          targetNode = n;
          return false;
        }
        return true;
      });
      if (pos == null || !targetNode) return;
      const node: PMNode = targetNode;
      const tr = ed.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        parTitle: next,
      });
      tr.setMeta(FLOAT_WRITE_META, `texBlock:${uuid}`);
      ed.view.dispatch(tr);
    },
    [ref, uuid],
  );

  const commitTitle = useCallback(
    (next: string | null) => {
      setTitle(next);
      setEditingTitle(false);
      writeTitleBackToMain(next);
    },
    [writeTitleBackToMain],
  );

  // main → float: re-read the node's attrs into local state. Same-value
  // setState calls bail out of re-rendering, so this is a no-op when the
  // doc change didn't touch our texBlock.
  const syncFromMain = useCallback(() => {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    let found: PMNode | null = null;
    ed.state.doc.descendants((n) => {
      if (n.type.name === "texBlock" && n.attrs?.uuid === uuid) {
        found = n;
        return false;
      }
      return true;
    });
    if (!found) {
      setSourceMissing(true);
      return;
    }
    setSourceMissing(false);
    const node: PMNode = found;
    setTitle((node.attrs?.parTitle as string | null) ?? null);
    setCode((node.attrs?.code as string) ?? "");
  }, [ref, uuid]);

  useMainTransactionSync({
    mainEditor,
    floatId: `texBlock:${uuid}`,
    onMainDocChanged: syncFromMain,
  });

  return (
    <>
      {sourceMissing && (
        <SourceMissingBanner
          kind="texBlock"
          onClose={() => popped?.close(cardKey)}
        />
      )}
      {/* Body mirrors paragraph-body.tsx's chrome contract so the float
          honors the lifted-overlay spawn geometry exactly (L3e.2):
          TEXT_FLOAT_BODY_PAD_CLASS == TEXT_FLOAT_BODY_PAD_X/Y (32 / 16,
          float-policy — one source for both), so the pod width
          resolves to sourceWidth (502) == the source pod → the CM text-area
          is 444 == source/ghost → the code does NOT re-wrap on release. (The
          old `px-3` (12) title host + pod wrapper made the float pod
          2·(32−12)=40px too wide → released code re-wrapped at a different
          column.) The `.par-title-wrapper` collapses the untitled title slot
          to `absolute bottom:100%` (globals.css), matching the source pod +
          the lifted ghost, so the pod sits at the body's top with no vertical
          jump on release. */}
      <div
        className={`par-float-body flex-1 overflow-auto ${TEXT_FLOAT_BODY_PAD_CLASS} ${viewToggleClasses(chrome.menuBar)}`}
      >
        <div
          className={`par-title-wrapper has-text${
            title ? " has-title" : " has-add-btn"
          }`}
        >
          <FloatTitleField
            title={title}
            editing={editingTitle}
            canEdit
            onStartEdit={() => setEditingTitle(true)}
            onCommit={commitTitle}
            onCancel={() => setEditingTitle(false)}
            onClear={() => commitTitle(null)}
            placeholder="Block title…"
          />
          <div className="par-body-container">
            {/* Pod framing reused from the in-place TexBlockNodeView
                (.tex-block-pod → .tex-block-editor) so the released popout
                wears the same blue border + ".tex" chip as the lifted ghost —
                no framing jump on release. The float omits the source's
                chevron / row-sensor / in-place delete (it has its own header
                close/jump chrome); only the visual frame is replicated.
                CodeMirror is left at its default content `height:auto` (like
                the source pod — no `height`/`style` prop) so the pod grows to
                the full code height and the released float shows EVERY line.
                `height:100%` clamped the `.cm-scroller` ~10px and clipped the
                last line (L3e.2). */}
            <div className="tex-block-pod">
              <div className="tex-block-editor relative">
                <CodeMirror
                  value={code}
                  onChange={handleChange}
                  extensions={[
                    latex({ enableLinting: false }),
                    texBlockFloatTheme,
                    EditorView.lineWrapping,
                    EditorView.contentAttributes.of({ spellcheck: "false" }),
                    EditorState.tabSize.of(2),
                  ]}
                  basicSetup={{
                    lineNumbers: false,
                    highlightActiveLineGutter: false,
                    highlightActiveLine: false,
                    bracketMatching: true,
                    foldGutter: false,
                    indentOnInput: true,
                    closeBrackets: true,
                    autocompletion: false,
                  }}
                />
                {/* `.tex` chip — inside the pod's top-right corner, identical
                    markup to TexBlockNodeView so the float reads as the same pod. */}
                <div className="absolute top-1 right-1.5 z-10 px-1 py-px text-[10px] rounded-sm bg-[var(--background)]/85 border border-[var(--heading-annotation-border,#a8c4de)] text-[var(--heading-annotation-color,#6b9ac4)] select-none pointer-events-none font-mono leading-tight">
                  .tex
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
