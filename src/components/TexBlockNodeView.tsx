"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import ConfirmDialog from "./ConfirmDialog";
import { setCardLiftTarget, setCardLiftHandoff } from "./card-lift";
import type { TexBlockOptions } from "@/lib/tiptap/tex-block";

const LIFT_THRESHOLD = 5;
const FLOAT_W = 480;
const FLOAT_H = 280;

// Slimmed-down version of CodeEditor.tsx's virgilTheme, sized for inline
// embedding inside a doc paragraph rather than a full code-view pane.
// Border tone matches the heading-annotation lozenge so the pod reads as
// Virgil-native chrome rather than a generic input.
const texBlockTheme = EditorView.theme({
  "&": {
    fontSize: "13px",
    fontFamily: "var(--font-mono), 'SF Mono', 'Fira Code', monospace",
    backgroundColor: "var(--code-block-bg, rgba(124, 94, 60, 0.04))",
    borderRadius: "6px",
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

export default function TexBlockNodeView({ node, updateAttributes, deleteNode, extension }: NodeViewProps) {
  const code = (node.attrs.code as string) || "";
  const title = (node.attrs.parTitle as string | null) || null;
  const uuid = (node.attrs.uuid as string | null) || null;
  const collapsed = node.attrs.collapsed === true;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Pull lift refs out of the extension's configure options.
  const opts = extension.options as TexBlockOptions;
  const onLiftRef = opts.onLiftRef;
  const isPoppedRef = opts.isPoppedRef;
  const isPopped = !!(uuid && isPoppedRef?.current?.current?.(uuid));

  // Mousedown gesture handler on the grab handle: track distance, past
  // LIFT_THRESHOLD spawn the float via the global card-lift handoff +
  // the per-block-type lift callback. Matches paragraph behavior at
  // Editor.tsx:660-785.
  const handleGripMouseDown = useCallback((downEv: React.MouseEvent) => {
    if (downEv.button !== 0) return;
    if (!uuid) return;
    if (isPoppedRef?.current?.current?.(uuid)) return;
    downEv.preventDefault();
    const startX = downEv.clientX;
    const startY = downEv.clientY;
    let triggered = false;
    const onMove = (mv: MouseEvent) => {
      if (triggered) return;
      const dx = mv.clientX - startX;
      const dy = mv.clientY - startY;
      if (dx * dx + dy * dy < LIFT_THRESHOLD * LIFT_THRESHOLD) return;
      triggered = true;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const r = wrapper.getBoundingClientRect();
        setCardLiftTarget({
          cardKey: `texBlock:${uuid}`,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        });
        window.setTimeout(() => setCardLiftTarget(null), 150);
      }
      const spawn = {
        x: Math.round(mv.clientX - FLOAT_W / 2),
        y: Math.round(mv.clientY - 16),
        width: FLOAT_W,
        height: FLOAT_H,
      };
      setCardLiftHandoff({
        cardKey: `texBlock:${uuid}`,
        clientX: mv.clientX,
        clientY: mv.clientY,
        width: FLOAT_W,
        height: FLOAT_H,
      });
      onLiftRef?.current?.(uuid, spawn);
      cleanup();
    };
    const onUp = () => cleanup();
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [uuid, isPoppedRef, onLiftRef]);

  const handleCodeChange = useCallback(
    (val: string) => {
      if (val !== code) updateAttributes({ code: val });
    },
    [code, updateAttributes],
  );

  const setTitle = useCallback(
    (next: string | null) => {
      const trimmed = next && next.trim() ? next.trim() : null;
      updateAttributes({ parTitle: trimmed });
    },
    [updateAttributes],
  );

  const toggleCollapsed = useCallback(() => {
    updateAttributes({ collapsed: !collapsed });
  }, [collapsed, updateAttributes]);

  // Auto-focus + select on enter-edit-mode.
  useEffect(() => {
    if (editingTitle && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTitle]);

  const commitTitle = useCallback(() => {
    if (!editingTitle) return;
    const val = inputRef.current?.value ?? "";
    setEditingTitle(false);
    setTitle(val);
  }, [editingTitle, setTitle]);

  const previewLines = collapsed
    ? code.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 2)
    : [];

  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      className={`tex-block group relative my-3${isPopped ? " is-popped" : ""}`}
    >
      {/* +T title affordance — hidden when collapsed and there's no title. */}
      {(!collapsed || title) && (
        <div
          className="par-title-annotation"
          contentEditable={false}
          style={{ display: title || (!collapsed && !editingTitle) ? undefined : "block" }}
        >
          {editingTitle && !collapsed ? (
            <input
              ref={inputRef}
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
                  if (collapsed) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTitle(true);
                }}
              >
                {title}
              </span>
              {!collapsed && (
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
                  }}
                >
                  ×
                </button>
              )}
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
      )}

      <div className="tex-block-pod">
        {/* Row-wide hover sensor — invisible, extends horizontally
            beyond the pod so .tex-block:hover (and thus the grab
            handle reveal) fires anywhere in the pod's Y-band. */}
        <div className="tex-block-row-sensor" aria-hidden contentEditable={false} />

        {/* Fold chevron — anchored to the pod's top via .tex-block-pod's
            position:relative, so it lines up with the blue outline. */}
        <button
          type="button"
          className={`tex-block-fold-chevron${collapsed ? " is-folded" : ""}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          title={collapsed ? "Expand LaTeX block" : "Collapse LaTeX block"}
          aria-label={collapsed ? "Expand LaTeX block" : "Collapse LaTeX block"}
          contentEditable={false}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 2l4 4-4 4" />
          </svg>
        </button>

        {/* 6-dot grab handle — mousedown gesture lifts the block as a
            floating card past a 5px threshold. Matches paragraph behavior. */}
        <div
          className="tex-block-drag-handle"
          contentEditable={false}
          onMouseDown={handleGripMouseDown}
          title={isPopped ? "Block is open in a floating card" : "Drag to pop out"}
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="2" r="1.2" />
            <circle cx="7" cy="2" r="1.2" />
            <circle cx="3" cy="7" r="1.2" />
            <circle cx="7" cy="7" r="1.2" />
            <circle cx="3" cy="12" r="1.2" />
            <circle cx="7" cy="12" r="1.2" />
          </svg>
        </div>

      {collapsed ? (
        /* Compact preview: title (rendered above) + first 2 lines of code + … */
        <div
          className="tex-block-preview"
          contentEditable={false}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          title="Click to expand"
        >
          {previewLines.length > 0 ? (
            previewLines.map((line, i) => (
              <div key={i} className="tex-block-preview-line">{line}</div>
            ))
          ) : (
            <div className="tex-block-preview-line tex-block-preview-empty">(empty)</div>
          )}
          <div className="tex-block-preview-more">…</div>
        </div>
      ) : (
        <div contentEditable={false} className="tex-block-editor relative">
          <CodeMirror
            value={code}
            onChange={handleCodeChange}
            extensions={[
              // `enableLinting` defaults to TRUE in codemirror-lang-latex despite
              // what the .d.ts suggests — the linter checks for `\begin{document}`
              // and unmatched environments, both of which fire on any raw LaTeX
              // fragment. We never want those diagnostics here.
              latex({ enableLinting: false }),
              texBlockTheme,
              EditorView.lineWrapping,
              // Defense-in-depth: also suppress browser spell-check so plain
              // words inside `{…}` arguments don't get wavy underlines.
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
          {/* `.tex` chip — inside the pod's top-right corner. */}
          <div
            className="absolute top-1 right-1.5 z-10 px-1 py-px text-[10px] rounded-sm bg-[var(--background)]/85 border border-[var(--heading-annotation-border,#a8c4de)] text-[var(--heading-annotation-color,#6b9ac4)] select-none pointer-events-none font-mono leading-tight"
          >
            .tex
          </div>
        </div>
      )}
      {!collapsed && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmOpen(true);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          title="Delete LaTeX block"
          aria-label="Delete LaTeX block"
          className="absolute bottom-1.5 right-1.5 p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-edge-subtle focus:text-[var(--danger)] opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity"
          contentEditable={false}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete LaTeX block?"
        message="This will remove the LaTeX block and its contents. You can undo with Cmd+Z."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          setConfirmOpen(false);
          deleteNode();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </NodeViewWrapper>
  );
}
