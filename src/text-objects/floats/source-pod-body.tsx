"use client";

/**
 * THE source-pod float body — a CodeMirror pod over ONE string attr, for every
 * text-object kind whose model IS its bytes.
 *
 * Two wearers today (task 383): `texBlock` (its `code` attr) and `forestBlock`
 * (its `source` attr — the whole `\begin{forest}…\end{forest}` env). They
 * differ in the kind name, the attr name and two strings; everything else — the
 * hand-rolled sync, the title field, the pod framing, the source-missing banner
 * — is identical, and was identical by COPY the moment a second wearer existed.
 * The in-place twin of this split is `SourcePodNodeView`.
 *
 * Migrated from the deleted `src/components/TexBlockFloat.tsx`. The outer
 * FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Content sync is hand-rolled because a source pod's content is a plain string
 * attr, not TipTap JSON — `useFloatMainSync`'s
 * TipTap-on-TipTap `setContent` half doesn't apply here:
 *   - main → float: `useMainTransactionSync` (the shared gated
 *     subscription from float-sync — own-write filter + docChanged gate)
 *     drives `syncFromMain`, which re-reads the target node's source /
 *     `parTitle` attrs into local state, refreshing CodeMirror.
 *   - float → main: CodeMirror's onChange dispatches setNodeMarkup with
 *     the new source attr.
 *
 * Title editing piggybacks on the same FLOAT_WRITE_META gating.
 */

import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
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
  findSourceNodeByUuid,
  type SourceRange,
} from "@/lib/float-source-range";
import {
  FLOAT_WRITE_META,
  SourceMissingBanner,
  useMainTransactionSync,
} from "@/lib/float-sync";
import type { TextObjectFloatBodyProps, TextObjectKind } from "../types";
import type { FloatSourceKind } from "@/lib/float-sync";
import { FloatTitleField } from "./float-title-field";
import type { SourcePodDerive } from "@/components/source-pod-derive";

/** What one source-pod kind contributes over the shared body. */
export interface SourcePodFloatConfig {
  /** The text-object kind — the `findSourceNodeByUuid` filter AND the float-id
   *  half of the own-write meta, so both halves can never disagree. */
  kind: TextObjectKind & FloatSourceKind;
  /** Which string attr on that node holds the source. */
  sourceAttr: string;
  /** Corner chip inside the pod's top-right. */
  chipLabel: string;
  /**
   * Optional derived VIEW over the source (task 384). The float is deliberately
   * SOURCE-ONLY — a popout is where you go to edit the bytes — so only the
   * derivation's `banner` is read here: a refusal badge must follow the block
   * into its float, or lifting the block would silently lose the diagnosis the
   * badge exists to give. MUST be module-scope stable (memo key).
   */
  derive?: SourcePodDerive;
}

// Theme matches the in-place `sourcePodTheme` so the
// released popout reads as the same `.source-pod` as the lifted ghost:
// same blue pod border + radius, same content padding (the 44px right
// inset clears the ".tex" chip). The border color is the shared
// --heading-annotation-border var, so the pod tone stays single-source.
const sourcePodFloatTheme = EditorView.theme({
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

export function SourcePodFloatBody({
  cardKey,
  id: uuid,
  editorRef,
  config,
}: TextObjectFloatBodyProps & { config: SourcePodFloatConfig }) {
  const { kind, sourceAttr, chipLabel, derive } = config;
  const ref = editorRef as RefObject<EditorHandle | null>;
  const popped = usePoppedCards();
  const chrome = useEditorChrome();
  const mainEditor = ref.current?.getEditor() ?? null;

  const initial = useMemo(() => {
    let code = "";
    let title: string | null = null;
    if (mainEditor) {
      const src = findSourceNodeByUuid(mainEditor.state.doc, uuid, kind);
      if (src) {
        code = (src.node.attrs?.[sourceAttr] as string) ?? "";
        title = (src.node.attrs?.parTitle as string | null) ?? null;
      }
    }
    return { code, title };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid, kind, sourceAttr]);

  // This body owns its range ref because it drives the LOW-LEVEL
  // `useMainTransactionSync` (its source is a string attr, not a TipTap doc, so
  // the `useFloatMainSync` layer that would otherwise own the ref doesn't
  // apply). Same contract: `syncFromMain` re-arms it, the hook maps it through
  // every transaction and gates on it, and the write-back reads it as a hint.
  const sourceRangeRef = useRef<SourceRange | null>(null);

  const [code, setCode] = useState(initial.code);
  const [title, setTitle] = useState<string | null>(initial.title);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  // ONE derivation per (kind, source) — the float reads only its `banner` half
  // (see `SourcePodFloatConfig.derive`), so a refusal travels with the block.
  const banner = useMemo(() => (derive ? derive(code).banner : null), [derive, code]);

  const writeBackToMain = useCallback(
    (next: string) => {
      const ed = ref.current?.getEditor();
      if (!ed) return;
      const src = findSourceNodeByUuid(
        ed.state.doc,
        uuid,
        kind,
        sourceRangeRef.current,
      );
      if (!src) {
        setSourceMissing(true);
        return;
      }
      const node: PMNode = src.node;
      if ((node.attrs?.[sourceAttr] as string) === next) return;
      const tr = ed.state.tr.setNodeMarkup(src.start, undefined, {
        ...node.attrs,
        [sourceAttr]: next,
      });
      tr.setMeta("addToHistory", false);
      tr.setMeta(FLOAT_WRITE_META, `${kind}:${uuid}`);
      ed.view.dispatch(tr);
    },
    [ref, uuid, kind, sourceAttr],
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
      const src = findSourceNodeByUuid(
        ed.state.doc,
        uuid,
        kind,
        sourceRangeRef.current,
      );
      if (!src) return;
      const node: PMNode = src.node;
      const tr = ed.state.tr.setNodeMarkup(src.start, undefined, {
        ...node.attrs,
        parTitle: next,
      });
      tr.setMeta(FLOAT_WRITE_META, `${kind}:${uuid}`);
      ed.view.dispatch(tr);
    },
    [ref, uuid, kind, sourceAttr],
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
  // doc change didn't touch our block.
  const syncFromMain = useCallback(() => {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    const src = findSourceNodeByUuid(
      ed.state.doc,
      uuid,
      kind,
      sourceRangeRef.current,
    );
    // A null range re-opens the gate, so a disconnected float keeps looking
    // for its source and notices an undo that restores it.
    sourceRangeRef.current = src ? { from: src.start, to: src.end } : null;
    if (!src) {
      setSourceMissing(true);
      return;
    }
    setSourceMissing(false);
    const node: PMNode = src.node;
    setTitle((node.attrs?.parTitle as string | null) ?? null);
    setCode((node.attrs?.[sourceAttr] as string) ?? "");
  }, [ref, uuid, kind, sourceAttr]);

  useMainTransactionSync({
    mainEditor,
    floatId: `${kind}:${uuid}`,
    onMainDocChanged: syncFromMain,
    sourceRangeRef,
  });

  return (
    <>
      {sourceMissing && (
        <SourceMissingBanner
          kind={kind}
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
            {/* Pod framing reused from the in-place SourcePodNodeView
                (.source-pod → .source-pod-editor) so the released popout
                wears the same blue border + kind chip as the lifted ghost —
                no framing jump on release. The float omits the source's
                chevron / row-sensor / in-place delete (it has its own header
                close/jump chrome); only the visual frame is replicated.
                CodeMirror is left at its default content `height:auto` (like
                the source pod — no `height`/`style` prop) so the pod grows to
                the full code height and the released float shows EVERY line.
                `height:100%` clamped the `.cm-scroller` ~10px and clipped the
                last line (L3e.2). */}
            <div className="source-pod">
              {banner && <div className="source-pod-banner">{banner}</div>}
              <div className="source-pod-editor relative">
                <CodeMirror
                  value={code}
                  onChange={handleChange}
                  extensions={[
                    latex({ enableLinting: false }),
                    sourcePodFloatTheme,
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
                {/* Kind chip — the SHARED `.source-pod-corner` / `.source-pod-chip`
                    the in-place pod wears, so the released float frames identically
                    rather than by two copies of one utility string. */}
                <div className="source-pod-corner">
                  <span className="source-pod-chip">{chipLabel}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
