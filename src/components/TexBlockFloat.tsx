"use client";

/**
 * Floating texBlock editor.
 *
 * Mirrors ParagraphFloat for the texBlock atom: pops out of the main
 * editor as a draggable card and hosts its own CodeMirror instance so
 * the user can edit the raw LaTeX in isolation. Sync is much simpler
 * than ParagraphFloat because texBlock's content is a plain string
 * (the `code` attr), so we hand-roll the sync rather than using
 * useFloatMainSync (which is TipTap-on-TipTap).
 *
 *  - main → float: subscribe to the main editor's transactions; when
 *    the target node's `code` changes from elsewhere (undo, source
 *    edit), refresh the float's CodeMirror via a programmatic dispatch.
 *  - float → main: CodeMirror's onChange dispatches setNodeMarkup on
 *    the main editor with the new code.
 *
 * The `parTitle` is read once for the header label; live title edits
 * happen in the docked annotation, not in the float, so we don't need
 * a 2-way sync for it.
 */

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { FloatCard } from "./FloatingCards";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { PopoutButton } from "./panel-primitives";
import type { EditorHandle } from "./Editor";
import { FLOAT_WRITE_META } from "@/lib/float-sync";

// Same theme as TexBlockNodeView so the float reads as a chunk of the
// same pod. Border is intentionally heavier (var bordered) so the
// floated card pod doesn't disappear against the float's surface bg.
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

export function TexBlockFloat({
  cardKey,
  uuid,
  editorRef,
}: {
  cardKey: string;
  uuid: string;
  editorRef: RefObject<EditorHandle | null>;
}) {
  const popped = usePoppedCards();
  const mainEditor = editorRef.current?.getEditor() ?? null;

  // Seed code + title from the main doc once on mount; afterwards both
  // come through the transaction subscription below.
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
    // Intentionally keyed on uuid only — we re-seed only when the
    // float is mounted for a different block, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uuid]);

  const [code, setCode] = useState(initial.code);
  const [title, setTitle] = useState<string | null>(initial.title);
  const [sourceMissing, setSourceMissing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  // Track whether the latest setCode came from the main editor (don't
  // echo back) vs from CodeMirror (do propagate). Without this, the
  // round trip would dispatch a tx on main for every external update.
  const lastFromMainRef = useRef<string>(initial.code);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  // float → main: dispatch a setNodeMarkup on the main editor with the
  // new code. Tagged with FLOAT_WRITE_META so the subscription below
  // can ignore the echo.
  const writeBackToMain = useCallback(
    (next: string) => {
      const ed = editorRef.current?.getEditor();
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
    [editorRef, uuid],
  );

  const handleChange = useCallback(
    (val: string) => {
      if (val === code) return;
      setCode(val);
      writeBackToMain(val);
    },
    [code, writeBackToMain],
  );

  // Write a new title back to the main editor's texBlock node attrs.
  // Same FLOAT_WRITE_META gating as the code write-back so the float's
  // own subscription doesn't re-apply its own change.
  const writeTitleBackToMain = useCallback(
    (next: string | null) => {
      const ed = editorRef.current?.getEditor();
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
    [editorRef, uuid],
  );

  const commitTitle = useCallback(() => {
    if (!editingTitle) return;
    const raw = titleInputRef.current?.value ?? "";
    const next = raw.trim() || null;
    setEditingTitle(false);
    setTitle(next);
    writeTitleBackToMain(next);
  }, [editingTitle, writeTitleBackToMain]);

  // main → float: subscribe to the main editor's transactions. When
  // the target node's `code` differs from our local state AND the tx
  // didn't originate from this float, re-seed CodeMirror.
  useEffect(() => {
    const ed = editorRef.current?.getEditor();
    if (!ed) return;
    const myFloatId = `texBlock:${uuid}`;
    const unsubscribe = () => {
      ed.off("transaction", onTx);
    };
    const onTx = ({ transaction }: { transaction: { getMeta: (k: string) => unknown } }) => {
      // Skip our own echo.
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
    return unsubscribe;
  }, [editorRef, uuid, code, title]);

  return (
    <FloatCard cardKey={cardKey} surface="card">
      <div className="flex-1 min-h-0 flex flex-col bg-surface overflow-hidden">
        <div className="flex items-center gap-1 px-2 h-6 border-b border-edge-subtle bg-[var(--surface-muted-strong)]">
          <span className="text-[10px] text-[var(--ink-muted)] uppercase tracking-wider font-medium truncate">
            TEX
          </span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => editorRef.current?.scrollToParagraphId(uuid)}
            className="w-4 h-4 flex items-center justify-center rounded text-ink-muted hover:text-ink-body hover-on-light"
            title="Jump to LaTeX block"
            aria-label="Jump to LaTeX block"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
          <PopoutButton
            isPoppedOut
            variant="x"
            labelNoun="LaTeX block"
            className="iconbtn-xs"
            onClick={() => popped?.close(cardKey)}
          />
        </div>
        {sourceMissing && (
          <div
            role="status"
            className="flex items-center gap-2 px-2 h-6 text-[11px] bg-[var(--surface-warning,#fdf3d1)] border-b border-[var(--edge-warning,#e7d49a)] text-[var(--ink-warning,#7a5a16)]"
          >
            <span className="flex-1 truncate">LaTeX block — float is disconnected.</span>
            <button
              type="button"
              onClick={() => popped?.close(cardKey)}
              className="text-[11px] underline underline-offset-2 hover:opacity-80"
            >
              Close
            </button>
          </div>
        )}
        {/* In-panel title affordance — mirrors the docked NodeView's title
            chrome using the same par-title-* classes. Editable from
            inside the float; changes write back to the main editor's
            node attrs. */}
        <div className="tex-block-float-title-host px-3 pt-2 relative">
          <div
            className="par-title-annotation"
            style={{ display: "block" }}
          >
            {editingTitle ? (
              <input
                ref={titleInputRef}
                type="text"
                className="par-title-input"
                defaultValue={title ?? ""}
                placeholder="Block title…"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingTitle(false);
                  }
                }}
                onBlur={() => {
                  setTimeout(() => {
                    if (editingTitle) commitTitle();
                  }, 100);
                }}
              />
            ) : title ? (
              <>
                <span
                  className="par-title-text"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingTitle(true);
                  }}
                >
                  {title}
                </span>
                <button
                  type="button"
                  className="par-title-delete"
                  title="Remove title"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTitle(null);
                    writeTitleBackToMain(null);
                  }}
                >
                  ×
                </button>
              </>
            ) : (
              <span
                className="par-title-add"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTitle(true);
                }}
              >
                +T
              </span>
            )}
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
      </div>
    </FloatCard>
  );
}
