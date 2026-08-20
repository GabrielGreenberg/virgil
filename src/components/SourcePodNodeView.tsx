"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import ConfirmDialog from "./ConfirmDialog";
import { iconHint } from "@/components/Hint";
import type { SourcePodDerive } from "./source-pod-derive";

/**
 * THE source pod — one implementation of the "raw bytes in a framed, foldable,
 * titleable pod" chrome, worn by every block whose MODEL IS ITS BYTES.
 *
 * Two wearers today: `texBlock` (raw LaTeX between `%!vtex:` sentinels) and
 * `forestBlock` (a whole `\begin{forest}…\end{forest}` env). They differ in a
 * handful of STRINGS and in which attr holds the source — everything else (the
 * `+T` title affordance, the fold chevron, the collapsed preview, the row-wide
 * hover sensor, the delete confirm, the CodeMirror configuration, the
 * card-context static preview) is identical, and was identical by COPY until
 * the second wearer arrived (task 383).
 *
 * The CSS is the matching half: the pod-internal classes are `.source-pod*`
 * (neutral), and only the HOST class names a node — see the "source-pod chrome"
 * block in globals.css, whose wrapper rules take `:is(.tex-block, .forest-block)`.
 */
export interface SourcePodConfig {
  /** Host class on the NodeViewWrapper — names the NODE, not the pod. */
  hostClass: string;
  /** Which attr holds the verbatim source this pod reads and writes. */
  sourceAttr: string;
  /** Corner chip inside the pod's top-right. */
  chipLabel: string;
  /** Human name used in hints and the delete confirm ("LaTeX block"). */
  kindLabel: string;
  /** Placeholder shown by the card-context preview for an empty source. */
  emptyLabel: string;
  /** Confirm-dialog body for the pod's own delete button. */
  confirmMessage: string;
  /** Whether the block's popout float is open — dims the docked pod. */
  isPopped?: boolean;
  /**
   * Optional derived VIEW over the source (task 384). A kind that can render
   * its bytes contributes this; the pod then shows the derived preview by
   * default and the code surface on demand, with the derivation's `banner`
   * (a refusal badge) above the body in BOTH modes.
   *
   * MUST be module-scope stable — the pod memoizes on `(derive, source)`, so a
   * closure minted per render re-derives (and, for a tree, re-measures and
   * re-lays-out) on every unrelated re-render of the block.
   */
  derive?: SourcePodDerive;
}

// Slimmed-down version of CodeEditor.tsx's virgilTheme, sized for inline
// embedding inside a doc paragraph rather than a full code-view pane.
// Border tone matches the heading-annotation lozenge so the pod reads as
// Virgil-native chrome rather than a generic input.
export const sourcePodTheme = EditorView.theme({
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
 * The pod's top-right corner: the kind chip (which names the BYTES — the
 * STYLE_GUIDE rule that tells a reader which language the pod is holding) and,
 * for a kind that can render its bytes, the mode toggle beside it.
 *
 * The toggle is a SEPARATE control rather than a click on the chip because the
 * chip's job is to be read, not pressed: overloading it would make the one
 * piece of chrome that answers "what is this?" also answer "what happens if I
 * click?", and a pod with no preview has no second answer to give.
 */
function PodCorner({
  chipLabel,
  kindLabel,
  hasPreview,
  showingSource,
  onToggle,
}: {
  chipLabel: string;
  kindLabel: string;
  hasPreview: boolean;
  showingSource: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="source-pod-corner" contentEditable={false}>
      {hasPreview && (
        <button
          type="button"
          className="source-pod-mode-toggle focus-ring"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }}
          {...iconHint({
            label: showingSource ? `Show ${kindLabel}` : `Edit ${kindLabel} source`,
          })}
        >
          {showingSource ? (
            /* Back to the rendered view — a two-level tree glyph. */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M6 2v2M6 4L3 6.5M6 4l3 2.5" />
              <circle cx="6" cy="1.8" r="1" />
              <circle cx="3" cy="8" r="1" />
              <circle cx="9" cy="8" r="1" />
            </svg>
          ) : (
            /* To the source — the `</>` glyph. */
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 3L2 6l2.5 3M7.5 3L10 6l-2.5 3" />
            </svg>
          )}
        </button>
      )}
      <span className="source-pod-chip">{chipLabel}</span>
    </div>
  );
}

export default function SourcePodNodeView({
  node,
  updateAttributes,
  deleteNode,
  config,
  cardContext,
}: Pick<NodeViewProps, "node" | "updateAttributes" | "deleteNode"> & {
  config: SourcePodConfig;
  cardContext: boolean;
}) {
  const source = (node.attrs[config.sourceAttr] as string) || "";
  const title = (node.attrs.parTitle as string | null) || null;
  const collapsed = node.attrs.collapsed === true;
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The pod's mode. A kind with a derived preview opens SHOWING it; a kind
  // without one (texBlock) has nothing to show but source, and `sourceMode`
  // below folds that in so there is no second branch to keep in step.
  const [showSource, setShowSource] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // ONE derivation per (kind, source) — the tree and its badge are two halves
  // of a single verdict and must never come from two parses (pod-config.tsx).
  // Bound to a local first: React Compiler infers the dep as `config` when the
  // memo reads a PROPERTY of it, refuses to preserve the memoization, and skips
  // optimizing the whole component — so the local is what keeps the key on the
  // stable function rather than on the config object.
  const derive = config.derive;
  const derived = useMemo(
    // Skipped in card context: that branch returns a static `<pre>` of the
    // source and never reads the derivation, so parsing for it would be work
    // on every collapsed card of every panel (the card-tier population).
    () => (!cardContext && derive ? derive(source) : null),
    [cardContext, derive, source],
  );
  const preview = derived?.preview ?? null;
  const banner = derived?.banner ?? null;
  // A refused source has no preview, so the pod pins itself to the code
  // surface: the badge names a construct, and the bytes it names are right
  // there under it.
  const sourceMode = preview === null || showSource;

  const setSource = useCallback(
    (val: string) => {
      if (val !== source) updateAttributes({ [config.sourceAttr]: val });
    },
    [source, updateAttributes, config.sourceAttr],
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

  // Card-context preview: rendered inside a RichTextField (archive card, note,
  // …) or a HeadingFloat. Show a compact static `<pre>` instead of the full pod
  // with CodeMirror. The schema still recognizes the node, so JSON round-trips
  // and restoring the snippet brings the full pod back in the main editor.
  if (cardContext) {
    return (
      <NodeViewWrapper className="source-pod-card-preview my-2">
        {title && (
          <div className="text-[11px] text-[var(--ink-muted)] mb-1 font-medium">
            {title}
          </div>
        )}
        <pre
          contentEditable={false}
          className="font-mono text-[12px] leading-snug whitespace-pre-wrap break-words rounded border px-2.5 py-1.5"
          style={{
            backgroundColor: "var(--code-block-bg, rgba(124, 94, 60, 0.04))",
            borderColor: "var(--heading-annotation-border, #a8c4de)",
            color: "var(--ink-strong)",
          }}
        >
          {source || (
            <span className="text-[var(--ink-muted)] italic">{config.emptyLabel}</span>
          )}
        </pre>
      </NodeViewWrapper>
    );
  }

  const previewLines = collapsed
    ? source.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(0, 2)
    : [];

  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      // has-par-title replaces the CSS-side `:not(:has(.par-title-text))`
      // (style-invalidation cost — perf Wave 0, plan P5.1). Stamped exactly
      // when the .par-title-text span renders (title present and not
      // currently replaced by the edit input), so the annotation-overlay
      // rule fires for byte-identical states.
      className={`${config.hostClass} group relative${config.isPopped ? " is-popped" : ""}${title && !(editingTitle && !collapsed) ? " has-par-title" : ""}`}
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
                  className="par-title-delete focus-ring"
                  {...iconHint({ label: "Remove title" })}
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

      <div
        className={`source-pod${preview !== null ? " has-derived" : ""}`}
        data-glyph-anchor=""
      >
        {/* Row-wide hover sensor — invisible, extends horizontally
            beyond the pod so the host's :hover (and thus the grab
            handle reveal) fires anywhere in the pod's Y-band. */}
        <div className="source-pod-row-sensor" aria-hidden contentEditable={false} />

        {/* Fold chevron — anchored to the pod's top via .source-pod's
            position:relative, so it lines up with the blue outline. */}
        <button
          type="button"
          className={`source-pod-fold-chevron${collapsed ? " is-folded" : ""} focus-ring`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          {...iconHint({
            label: collapsed
              ? `Expand ${config.kindLabel}`
              : `Collapse ${config.kindLabel}`,
          })}
          contentEditable={false}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 2l4 4-4 4" />
          </svg>
        </button>

        {/* The 6-dot grab handle lives in the editor-mounted
            TextObjectGrabHandle (src/text-objects/TextObjectGrabHandle.tsx).
            This NodeView only emits `.is-popped` chrome when the
            corresponding popout is open. */}

      {/* Derived chrome — a refusal badge. Shown in EVERY mode, collapsed
          included: a badge nobody can see is not a loud refusal. The wrapper is
          the pod's, not the kind's: `.source-pod-row-sensor` is an absolutely
          positioned FIRST child that hit-tests above any in-flow sibling, which
          is why the preview and the editor beside this both carry an explicit
          `position: relative`. Owning the slot's stacking here means the next
          contributor inherits it instead of re-discovering the trap. */}
      {banner && <div className="source-pod-banner">{banner}</div>}

      {collapsed ? (
        /* Compact preview: title (rendered above) + first 2 lines + … */
        <div
          className="source-pod-preview"
          contentEditable={false}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          data-hint="Click to expand" aria-label="Click to expand"
        >
          {previewLines.length > 0 ? (
            previewLines.map((line, i) => (
              <div key={i} className="source-pod-preview-line">{line}</div>
            ))
          ) : (
            <div className="source-pod-preview-line source-pod-preview-empty">(empty)</div>
          )}
          <div className="source-pod-preview-more">…</div>
        </div>
      ) : sourceMode ? (
        <div contentEditable={false} className="source-pod-editor relative">
          <CodeMirror
            value={source}
            onChange={setSource}
            extensions={[
              // `enableLinting` defaults to TRUE in codemirror-lang-latex despite
              // what the .d.ts suggests — the linter checks for `\begin{document}`
              // and unmatched environments, both of which fire on any raw LaTeX
              // fragment. We never want those diagnostics here.
              latex({ enableLinting: false }),
              sourcePodTheme,
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
          <PodCorner
            chipLabel={config.chipLabel}
            kindLabel={config.kindLabel}
            hasPreview={preview !== null}
            showingSource
            onToggle={() => setShowSource(false)}
          />
        </div>
      ) : (
        /* The DERIVED body — a rendered view of the same bytes. Clicking it is
           the natural path back to the source, which is where an edit happens;
           the corner toggle is the discoverable one. */
        <div
          contentEditable={false}
          className="source-pod-derived relative"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSource(true);
          }}
          data-hint={`Click to edit ${config.kindLabel} source`}
          aria-label={`Click to edit ${config.kindLabel} source`}
        >
          {/* The tree scrolls INSIDE this; the corner does not. An absolutely
              positioned child of a scroll container is positioned against its
              CONTENT, so a corner inside the scroller slides out of reach the
              moment a tree is wider than the pod — the one control that gets to
              the source, unreachable exactly on the trees that need it most. */}
          <div className="source-pod-derived-scroll">{preview}</div>
          <PodCorner
            chipLabel={config.chipLabel}
            kindLabel={config.kindLabel}
            hasPreview
            showingSource={false}
            onToggle={() => setShowSource(true)}
          />
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
          {...iconHint({ label: `Delete ${config.kindLabel}` })}
          className="absolute bottom-1.5 right-1.5 p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] hover:bg-edge-subtle focus:text-[var(--danger)] opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 transition-opacity focus-ring"
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
        title={`Delete ${config.kindLabel}?`}
        message={config.confirmMessage}
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
