"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { latex } from "codemirror-lang-latex";
import { EditorState } from "@codemirror/state";
import ConfirmDialog from "./ConfirmDialog";
import { useFieldDraft } from "./field-draft";
import { iconHint } from "@/components/Hint";
import type { SourcePodDerive } from "./source-pod-derive";
import { NEVER_SPELLCHECK_ATTRS } from "@/lib/spellcheck-policy";
import { chromeOnly } from "@/lib/view-only-chrome";
import {
  commitLiveValue,
  useFieldEditSession,
} from "@/lib/field-edit-session";
import { useMainEditable } from "@/components/editor-layout/contexts/use-main-editable";

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
    <div className={chromeOnly("source-pod-corner")} contentEditable={false}>
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
  editor,
  config,
  cardContext,
}: Pick<NodeViewProps, "node" | "updateAttributes" | "deleteNode"> & {
  /**
   * The editor this pod is mounted in — the ONE thing a wearer has to hand
   * over for the read-only gate below (task 728). Optional so a bare unit
   * mount (no PM around it) degrades to "editable", which is what
   * `useMainEditable` answers for a missing editor anyway.
   *
   * Read from the node's OWN editor rather than from the EditorRef context:
   * N panes are mounted at once under multi-doc keep-alive, so "the current
   * doc" is not a module-level fact and the pod's authority on its own
   * document is the view it lives in.
   */
  editor?: NodeViewProps["editor"] | null;
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

  /**
   * THE pod's editability — resolved ONCE here, for every wearer (task 728).
   *
   * `view.editable` is pinned `true` always (Editor.tsx); read-only /
   * partner-claimed is enforced downstream by `readOnlyEnforcer`'s
   * `filterTransaction`, which drops any `docChanged` transaction without the
   * `ignoreReadOnly` meta — and EVERY write this pod makes is a
   * `setNodeMarkup` through `updateAttributes`, so every one of them is
   * dropped. Ungated, the pod therefore accepted a whole tikz picture or
   * forest tree, showed it as if saved, and lost it at the next re-render.
   *
   * So the pod reads the declarative signal the main editor publishes,
   * `data-editable` — the same gate the sibling embedded editors take
   * (`ExampleCard`, `example-block-body`, `example-item-body`) and the same
   * one `FigureBlockNodeView` takes positionally. It drives ALL of it: the
   * CodeMirror surface, the title field's edit session, the fold chevron and
   * the delete confirm — so a third wearer inherits the gate instead of
   * re-deriving it, and no affordance is left running a dialog that resolves
   * to a no-op. The CSS half is the `.source-pod` arm of the
   * `.ProseMirror[data-editable="false"]` block in globals.css.
   */
  const editable = useMainEditable(editor ?? null);

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

  // The title INPUT is mounted only where its commit could land — so the
  // read-only flip takes the field out of edit mode in the same breath as it
  // takes away the `+T` that opens it.
  const titleEditing = editingTitle && !collapsed && editable;

  const setSource = useCallback(
    (val: string) => {
      // Belt to the CodeMirror `editable={editable}` braces below: a
      // read-only pod must not dispatch a write the enforcer would drop.
      if (!editable) return;
      if (val !== source) updateAttributes({ [config.sourceAttr]: val });
    },
    [editable, source, updateAttributes, config.sourceAttr],
  );

  const setTitle = useCallback(
    (next: string | null) => {
      if (!editable) return;
      const trimmed = next && next.trim() ? next.trim() : null;
      // Equality-bail, like `setSource` above: a commit of an unchanged title
      // must not dispatch a transaction (an undo step and an autosave arm for
      // an edit that changed nothing).
      if (trimmed === title) return;
      updateAttributes({ parTitle: trimmed });
    },
    [editable, title, updateAttributes],
  );

  const toggleCollapsed = useCallback(() => {
    // `collapsed` is a node ATTR, so folding is a doc change like any other
    // and is dropped read-only. The chevron and the collapsed preview hide
    // themselves below rather than offer a fold that silently fails.
    if (!editable) return;
    updateAttributes({ collapsed: !collapsed });
  }, [editable, collapsed, updateAttributes]);

  // Auto-focus + select on enter-edit-mode.
  useEffect(() => {
    if (editingTitle && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingTitle]);

  // The title's edit session. Pre-529 both halves of this were wrong and in the
  // same way: the CANCEL was recorded where the COMMIT could not read it.
  //
  //   onBlur={() => { setTimeout(() => { if (editingTitle) commitTitle(); }, 100); }}
  //
  // That `if (editingTitle)` was the author's own attempt at this very law —
  // "Escape ended the edit, so don't commit" — implemented with a value read
  // from the render closure in which the input still existed. It is therefore
  // permanently `true` and dead, in the timeout AND again inside `commitTitle`.
  // Two failures fell out: the fold chevron `preventDefault`s its mousedown so
  // the input never blurs at all and the edit was silently DISCARDED; and where
  // a blur did land, the deferred commit woke at +100 ms with the input already
  // unmounted, computed `inputRef.current?.value ?? ""` and wrote that empty
  // string over an EXISTING title. `@/lib/field-edit-session`.
  const session = useFieldEditSession();

  // The DOM node is this field's draft, and `defaultValue` seeds it when the
  // session OPENS — after which `title` can still move under it (an undo, a
  // re-parse, a second window writing the same attr). Reconciling while the
  // draft is clean is what stops the box showing a title the document no
  // longer has, and stops the next blur writing it back: `setTitle`'s own
  // equality bail compares the LIVE attr, so a stale draft is not an unchanged
  // value and DOES dispatch. (task 532; the guard half `setTitle` already had.)
  const titleDraft = useFieldDraft<string>({
    source: title ?? "",
    readDraft: () => inputRef.current?.value,
    writeDraft: (next) => {
      const el = inputRef.current;
      if (el) el.value = next;
    },
  });

  /** Commit the title from a LIVE element, or refuse. Never `?? ""` — for this
   *  field the empty string is a DELETE (`setTitle` maps it to `parTitle: null`),
   *  so a commit that cannot read its value must not run at all.
   *
   *  NORMALIZE BEFORE YOU COMMIT: the draft's guard compares what is about to
   *  be stored against the live attr, so a draft of `"A "` must arrive as `"A"`
   *  or it reads as a change that `setTitle` then bails on anyway. */
  const commitTitleFrom = useCallback(
    (el: HTMLInputElement | null) =>
      commitLiveValue(el, (val) => {
        setEditingTitle(false);
        titleDraft.commit(val.trim(), setTitle);
      }),
    [setTitle, titleDraft],
  );

  // A pod can be collapsed while its title is being edited — by the chevron
  // below, and also from outside (an undo of a collapse toggle, a re-parse).
  // The input renders only under `editingTitle && !collapsed`, so leaving the
  // flag set means re-expanding drops the user straight back into edit mode on
  // a pod they never asked to edit. Clearing it here makes that true by
  // construction, whichever path did the collapsing.
  //
  // Same for a mid-session read-only flip (a collab pen handoff): the input
  // would otherwise stay mounted over a field whose commit is now refused.
  useEffect(() => {
    if (collapsed || !editable) setEditingTitle(false);
  }, [collapsed, editable]);

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
      className={`${config.hostClass} group relative${config.isPopped ? " is-popped" : ""}${title && !titleEditing ? " has-par-title" : ""}`}
    >
      {/* +T title affordance — hidden when collapsed and there's no title, and
          read-only when the doc is: an untitled pod then shows nothing at all
          (the `+T` writes `parTitle`, which is refused), while a titled one
          still shows its title as plain text. */}
      {(title || (!collapsed && editable)) && (
        <div
          className="par-title-annotation"
          contentEditable={false}
          style={{ display: title || (!collapsed && !editingTitle) ? undefined : "block" }}
        >
          {titleEditing ? (
            <input
              ref={inputRef}
              type="text"
              className={chromeOnly("par-title-input")}
              defaultValue={title ?? ""}
              placeholder="Block title…"
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  const el = e.currentTarget;
                  session.commitAndBlur(el, () => commitTitleFrom(el));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  session.cancel(e.currentTarget, () => {
                    titleDraft.revert();
                    setEditingTitle(false);
                  });
                }
              }}
              // Read the value SYNCHRONOUSLY, off the event's own element,
              // while it is provably alive. The retired 100 ms deferral bought
              // nothing but the window in which the element could vanish.
              onBlur={(e) => {
                const el = e.currentTarget;
                session.commit(() => commitTitleFrom(el));
              }}
            />
          ) : title ? (
            <>
              <span
                className="par-title-text"
                onClick={(e) => {
                  if (collapsed || !editable) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingTitle(true);
                }}
              >
                {title}
              </span>
              {!collapsed && editable && (
                <button
                  type="button"
                  className={chromeOnly("par-title-delete focus-ring")}
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
              className={chromeOnly("par-title-add")}
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
        <div className={chromeOnly("source-pod-row-sensor")} aria-hidden contentEditable={false} />

        {/* Fold chevron — anchored to the pod's top via .source-pod's
            position:relative, so it lines up with the blue outline. Absent
            read-only: `collapsed` is a node attr, so the fold is a refused
            write, and a chevron that does nothing is the UX trap task 728
            exists to close (the same call `.figure-chrome` already makes). */}
        {editable && (
        <button
          type="button"
          className={chromeOnly(`source-pod-fold-chevron${collapsed ? " is-folded" : ""} focus-ring`)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          // This `preventDefault` keeps the ProseMirror selection still, and it
          // also means a focused title input never blurs — so pre-529 clicking
          // the chevron mid-edit unmounted the input and DISCARDED everything
          // typed, with nothing to notice. Commit here instead, at mousedown,
          // while the input is still mounted and its value still readable.
          // Clicking away from a field commits it everywhere else in this pod;
          // the chevron is not an exception, it was just unreachable.
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (editingTitle) commitTitleFrom(inputRef.current);
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
        )}

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
        <>
        {/* PAPER body of a collapsed pod (task 408, decision 2). Rendered
            UNCONDITIONALLY and hidden by the `.print-only` idiom, so the pod
            carries no React dependency on print state — which is the whole
            requirement: `html[data-printing]` is a stamp (src/lib/print.ts,
            made by both print doors since task 608), and a posture the law
            mandates may not depend on every door remembering it. Its screen
            twin `.source-pod-preview` below is the one dropped in print media.

            The SOURCE, not the derived picture: a tree mounted while the pod is
            collapsed measures 0x0 and lays out from canvas ESTIMATES, whose
            ResizeObserver recovery cannot land inside a synchronous print
            snapshot. See the matching rules in globals.css. */}
        <pre
          className="print-only source-pod-print-source"
          contentEditable={false}
          aria-hidden="true"
        >
          {source}
        </pre>
        {/* Compact preview: title (rendered above) + first 2 lines + … */}
        <div
          // The collapsed pod's SCREEN body. On paper the pod prints its whole
          // source instead (the `.print-only` twin above, task 408), so this is
          // chrome-only there — the affordance ("there is more here"), not the
          // bytes (task 535 folded the by-name print rule onto the marker).
          className={chromeOnly("source-pod-preview")}
          contentEditable={false}
          onClick={(e) => {
            if (!editable) return;
            e.preventDefault();
            e.stopPropagation();
            toggleCollapsed();
          }}
          {...(editable
            ? { "data-hint": "Click to expand", "aria-description": "Click to expand" }
            : {})}
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
        </>
      ) : sourceMode ? (
        <div contentEditable={false} className="source-pod-editor relative">
          <CodeMirror
            value={source}
            onChange={setSource}
            // The gate's visible half: read-only the surface still SELECTS
            // (a reader can copy the LaTeX out) but takes no caret and no
            // keystroke, so nothing can be typed that the enforcer will drop.
            editable={editable}
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
              EditorView.contentAttributes.of(NEVER_SPELLCHECK_ATTRS),
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
          className="source-pod-derived"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSource(true);
          }}
          data-hint={`Click to edit ${config.kindLabel} source`}
          aria-description={`Click to edit ${config.kindLabel} source`}
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
      {/* Delete — absent read-only rather than opening a confirm dialog whose
          "Delete" resolves to nothing. */}
      {!collapsed && editable && (
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
          className={chromeOnly("source-pod-delete absolute bottom-1.5 right-1.5 p-1 rounded text-[var(--ink-muted)] hover:text-[var(--danger)] hover-on-light focus:text-[var(--danger)] opacity-0 group-hover:opacity-60 hover:!opacity-100 focus:opacity-100 focus-ring")}
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
