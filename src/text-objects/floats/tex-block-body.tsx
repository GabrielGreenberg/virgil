"use client";

/**
 * TeX block float body — CodeMirror instance for raw LaTeX editing.
 *
 * Migrated from the deleted `src/components/TexBlockFloat.tsx`. The outer
 * FloatCard wrapper and header chrome now live in the unified
 * `TextObjectFloat`; this module is body-only.
 *
 * Sync is hand-rolled because texBlock content is a plain string (the
 * `code` attr), not TipTap JSON — `useFloatMainSync` (TipTap-on-TipTap)
 * doesn't apply here. This is the load-bearing exception that justifies
 * keeping body sync per-kind:
 *   - main → float: subscribe to main editor transactions; when the
 *     target node's `code` differs from local state, refresh CodeMirror.
 *   - float → main: CodeMirror's onChange dispatches setNodeMarkup with
 *     the new `code` attr.
 *
 * Title editing piggybacks on the same FLOAT_WRITE_META gating.
 */

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorHandle } from "@/components/Editor";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FLOAT_WRITE_META } from "@/lib/float-sync";
import type { TextObjectFloatBodyProps } from "../types";
import { FloatTitleField } from "./float-title-field";

// Theme matches the in-place TexBlockNodeView so the float reads as a
// chunk of the same pod.
const texBlockFloatTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono), 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "var(--code-block-bg, rgba(124, 94, 60, 0.04))",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-content": { padding: "12px 14px", caretColor: "var(--accent)" },
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
  const lastFromMainRef = useRef<string>(initial.code);

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

  // main → float subscription
  useEffect(() => {
    const ed = ref.current?.getEditor();
    if (!ed) return;
    const myFloatId = `texBlock:${uuid}`;
    const onTx = ({
      transaction,
    }: {
      transaction: { getMeta: (k: string) => unknown };
    }) => {
      if (transaction.getMeta(FLOAT_WRITE_META) === myFloatId) return;
      const view = ed.view;
      let found: PMNode | null = null;
      view.state.doc.descendants((n) => {
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
      const nextCode = (node.attrs?.code as string) ?? "";
      const nextTitle = (node.attrs?.parTitle as string | null) ?? null;
      if (nextTitle !== title) setTitle(nextTitle);
      if (nextCode !== code) {
        lastFromMainRef.current = nextCode;
        setCode(nextCode);
      }
    };
    ed.on("transaction", onTx);
    return () => {
      ed.off("transaction", onTx);
    };
  }, [ref, uuid, code, title]);

  return (
    <>
      {sourceMissing && (
        <div
          role="status"
          className="flex items-center gap-2 px-2 h-6 text-[11px] bg-[var(--surface-warning,#fdf3d1)] border-b border-[var(--edge-warning,#e7d49a)] text-[var(--ink-warning,#7a5a16)]"
        >
          <span className="flex-1 truncate">
            LaTeX block — float is disconnected.
          </span>
          <button
            type="button"
            onClick={() => popped?.close(cardKey)}
            className="text-[11px] underline underline-offset-2 hover:opacity-80"
          >
            Close
          </button>
        </div>
      )}
      <div className="tex-block-float-title-host px-3 pt-2 relative">
        <div className="par-title-annotation" style={{ display: "block" }}>
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
        </div>
      </div>
      <div className="flex-1 overflow-auto">
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
          height="100%"
        />
      </div>
    </>
  );
}
