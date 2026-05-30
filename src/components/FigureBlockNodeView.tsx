"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  canEditWidthInOptions,
  extractFigureAttrs,
  extractGraphicsAttrs,
  type FigureSource,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import { useResolvedFigureUrl } from "@/hooks/useResolvedFigureUrl";
// Route through the storage facade, not directly at the FSA backend — the
// dev backend has its own `importFigureFile` that PUTs to the dev API.
// `pickFigureFile` encapsulates the FSA-picker vs hidden-`<input>` dispatch.
import { getDocWriteHandle, importFigureFile } from "@/lib/storage";
import { pickFigureFile } from "@/lib/figures/pick-file";
import { parseInlineContent } from "@/lib/latex-parser";
import type { FigureBlockOptions } from "@/lib/tiptap/figure-block";
import { synthesizeFigureRaw } from "@/lib/tiptap/figure-block";
import FigureAnnotation from "./FigureAnnotation";

const MIN_PERCENT = 10;
const MAX_PERCENT = 100;
const STEP_PERCENT = 10;

// Stable no-op refresh registrar for the read-only card-preview figure panels
// (Issue-4): they reuse FigurePanel for faithful image resolution but never
// expose the chrome refresh button, so they register nothing. Module-level so
// the identity is stable across renders (FigurePanel's effect depends on it).
const noopRegisterRefresh = (): (() => void) => () => {};

// Shared node view for both `figureBlock` and `graphicsBlock`. The node
// type drives whether caption/label chrome is shown. For figureBlock the
// caption is a `figureCaption` child sub-node (`content: "inline*"`) so
// citations, marks, and footnotes work inside; `extras` carries the
// non-caption non-label parts of the env body for the width-scaler / file-
// picker mutators. For graphicsBlock the source-of-truth is the `command`
// attr (a single `\includegraphics[...]{...}` string).
//
// The outer component is a thin dispatcher: in `cardContext` (popped-out
// floats) we render a READ-ONLY image preview — Issue-4: a popped section
// should SHOW its figures, not a `Figure: …` pill; otherwise the full view
// with chrome, caption sub-node, and label lozenge.
export default function FigureBlockNodeView(props: NodeViewProps) {
  const opts = props.extension.options as FigureBlockOptions;
  if (opts.cardContext === true) {
    return (
      <FigureCardPreview
        node={props.node}
        docId={opts.docIdRef?.current ?? null}
      />
    );
  }
  return <FigureFullView {...props} />;
}

// Card-context render (popped-out floats). Issue-4: show the figure/graphic's
// REAL image, read-only, so a popped section mirrors the source instead of a
// `Figure: …` pill. Read-only by design — no width/picker/delete chrome and no
// click-to-edit; atom editing stays in the main editor (the float is editable
// for prose but figures are atoms whose source lives in main, and the float
// never sets `data-editable`, so FigureFullView's chrome would NOT self-hide
// here — hence we render a chrome-less preview rather than flipping cardContext).
// The float must forward `docIdRef` (the *-body.tsx float builders) for the
// same resolver the main editor uses (FigurePanel) to find the image. Falls
// back to a compact pill when the figure has no image yet (stub) or no docId to
// resolve against, so the float never shows a broken-image / "not found" box.
function FigureCardPreview({
  node,
  docId,
}: {
  node: NodeViewProps["node"];
  docId: string | null;
}) {
  const isFigure = node.type.name === "figureBlock";
  const captionText = isFigure ? (node.firstChild?.textContent ?? "") : "";

  // Same source derivation as FigureFullView, so the preview is faithful.
  const sources = useMemo<FigureSource[]>(() => {
    const raw = node.attrs.sources as FigureSource[] | undefined;
    if (raw && raw.length > 0) return raw;
    const single = node.attrs.source as string | null;
    return single
      ? [
          {
            path: single,
            options: "",
            widthPercent: node.attrs.widthPercent as number | null,
          },
        ]
      : [];
  }, [node.attrs.sources, node.attrs.source, node.attrs.widthPercent]);

  const firstSource = sources[0];

  // No resolvable image (un-filled stub, or no docId) → compact pill, matching
  // the pre-Issue-4 behaviour so the float never shows a broken-image box.
  if (!firstSource?.path || !docId) {
    const labelText = isFigure
      ? captionText || firstSource?.path || "[figure]"
      : firstSource?.path || "[graphic]";
    return (
      <NodeViewWrapper className="figure-block-card-preview my-2" contentEditable={false}>
        <div
          className="inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-mono"
          style={{
            backgroundColor: "var(--surface-muted, rgba(124, 94, 60, 0.04))",
            borderColor: "var(--edge-subtle)",
            color: "var(--ink-strong)",
          }}
        >
          <span className="text-[var(--ink-muted)]">
            {isFigure ? "Figure" : "Graphic"}:
          </span>
          <span className="truncate max-w-[28ch]">{labelText}</span>
        </div>
      </NodeViewWrapper>
    );
  }

  // Real image, read-only. Reuses FigurePanel (the same resolver / loading /
  // error rendering as the main editor) under the same container classes, minus
  // the interactive chrome, click-to-edit, and annotation lozenge.
  return (
    <NodeViewWrapper
      className={`figure-block figure-block-card-image ${
        isFigure ? "figure-block-wrapped" : "figure-block-bare"
      }`}
      contentEditable={false}
    >
      <div className="figure-row">
        {sources.map((src, i) => (
          <FigurePanel
            key={`${src.path}:${i}`}
            docId={docId}
            source={src}
            registerRefresh={noopRegisterRefresh}
          />
        ))}
      </div>
      {isFigure && captionText ? (
        <div className="figure-caption">
          <span className="figure-caption-text">{captionText}</span>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

function FigureFullView({ node, getPos, editor, extension }: NodeViewProps) {
  const opts = extension.options as FigureBlockOptions;
  const docId = opts.docIdRef?.current ?? null;
  const isFigure = node.type.name === "figureBlock";

  const sources = useMemo<FigureSource[]>(() => {
    if (isFigure) {
      const raw = node.attrs.sources as FigureSource[] | undefined;
      if (raw && raw.length > 0) return raw;
      const single = node.attrs.source as string | null;
      if (single)
        return [
          { path: single, options: "", widthPercent: node.attrs.widthPercent as number | null },
        ];
      return [];
    }
    const single = node.attrs.source as string;
    return single
      ? [{ path: single, options: "", widthPercent: node.attrs.widthPercent as number | null }]
      : [];
  }, [isFigure, node.attrs.sources, node.attrs.source, node.attrs.widthPercent]);

  const label = (node.attrs.label as string | undefined) || "";
  const numbered = node.attrs.numbered !== false;
  const figureNumber = node.attrs.figureNumber as string | number | null;
  const extras = (node.attrs.extras as string | undefined) || "";

  // The source-of-truth string for width/path mutators. For figureBlock this
  // is `extras` (env body minus \caption{} and \label{}, both of which we
  // own structurally now); for graphicsBlock it's the verbatim `command`.
  // The mutators (`withUpdatedFigureWidth`, `withReplacedFigurePath`) only
  // edit the `\includegraphics` line, so they're indifferent to whether
  // \caption is present.
  const mutableSource = isFigure
    ? extras
    : (node.attrs.command as string | undefined) || "";

  // The popover seed: a faithful view of the env body for the "edit raw"
  // surface, synthesized from extras + caption text + label.
  const captionChild = node.firstChild;
  const captionTextContent =
    isFigure && captionChild?.type.name === "figureCaption"
      ? captionChild.textContent
      : "";
  const popoverRaw = useMemo(() => {
    if (!isFigure) {
      return (node.attrs.command as string | undefined) || "";
    }
    return synthesizeFigureRaw(extras, captionTextContent, label);
  }, [isFigure, extras, captionTextContent, label, node.attrs.command]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // FigurePanel children register their refresh() callbacks here so the
  // single chrome-row refresh button can re-rasterize all panels at once
  // (matters mostly for subfigure blocks). Each panel deregisters on
  // unmount via the returned cleanup.
  const refreshCallbacksRef = useRef<Set<() => void>>(new Set());
  const registerRefresh = useCallback((fn: () => void) => {
    refreshCallbacksRef.current.add(fn);
    return () => {
      refreshCallbacksRef.current.delete(fn);
    };
  }, []);
  const handleRefreshAll = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    refreshCallbacksRef.current.forEach((fn) => fn());
  };

  // An "empty" figure has either no `\includegraphics` at all (graphicsBlock
  // with empty source) or one with an empty path argument (the figureBlock
  // stub from `freshFigureBlockAttrs`). Both go to the picker CTA.
  const firstSource = sources[0];
  const isEmpty = sources.length === 0 || !firstSource?.path;

  // The width-edit chrome reads the first source's options string to decide
  // whether the existing width is in absolute units (which we never overwrite).
  const firstOptions = firstSource?.options ?? "";
  const canScale = canEditWidthInOptions(firstOptions);
  const currentPercent = clampPercent(firstSource?.widthPercent ?? 50);

  // ---- mutation helpers (close over editor + node + getPos) ----

  const getFigurePos = useCallback((): number | null => {
    const p = typeof getPos === "function" ? getPos() : null;
    return p ?? null;
  }, [getPos]);

  // `updateFromText` runs the appropriate extractor on the new text and
  // dispatches a setNodeMarkup transaction. Mirrors EditorLayout's
  // handleFigureSave so the popover and visual chrome stay in sync.
  //
  // For figureBlock: `newText` is a synthesised env body (caption + label
  // included). We re-extract the structured attrs (extras, label, sources,
  // …) and replace the figureCaption child with freshly-tokenized inline
  // content. The chrome's width/path mutators feed in env-body strings with
  // the caption intact, so re-tokenizing on every call is safe — it's a
  // no-op in the common case.
  const updateFromText = (newText: string) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    if (isFigure) {
      const attrs = extractFigureAttrs(newText);
      const captionInline = parseInlineContent(attrs.caption);
      let captionNode: ReturnType<
        typeof editor.state.schema.nodeFromJSON
      > | null = null;
      try {
        captionNode = editor.state.schema.nodeFromJSON({
          type: "figureCaption",
          content: captionInline,
        });
      } catch {
        // Schema rejection (e.g. unknown inline node) — fall back to plain
        // text so the user's caption isn't lost on a malformed edit.
        captionNode = editor.state.schema.nodeFromJSON({
          type: "figureCaption",
          content: attrs.caption
            ? [{ type: "text", text: attrs.caption }]
            : [],
        });
      }
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        extras: attrs.extras,
        source: attrs.source,
        widthPercent: attrs.widthPercent,
        sources: attrs.sources,
        label: attrs.label,
      });
      if (captionNode) {
        // Replace the existing figureCaption child (if any) with the new
        // one. The first child's start position is pos + 1 inside the
        // figureBlock node.
        const refreshed = tr.doc.nodeAt(pos);
        if (refreshed) {
          const inside = pos + 1;
          if (refreshed.firstChild?.type.name === "figureCaption") {
            const captionEnd = inside + refreshed.firstChild.nodeSize;
            tr.replaceWith(inside, captionEnd, captionNode);
          } else {
            tr.insert(inside, captionNode);
          }
        }
      }
      editor.view.dispatch(tr);
    } else {
      const attrs = extractGraphicsAttrs(newText.trim());
      if (!attrs) return;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          command: attrs.command,
          source: attrs.source,
          widthPercent: attrs.widthPercent,
        }),
      );
    }
  };

  const applyScale = (newPercent: number) => {
    const clamped = clampPercent(newPercent);
    if (clamped === currentPercent) return;
    const next = withUpdatedFigureWidth(mutableSource, clamped);
    if (next == null) return;
    // The mutator only touched `\includegraphics`; for figureBlock the
    // synthesized env body needs the current caption + label re-attached
    // so updateFromText's extractor sees a complete env and rebuilds the
    // figureCaption child faithfully (a no-op in this case since caption
    // text didn't change).
    if (isFigure) {
      updateFromText(synthesizeFigureRaw(next, captionTextContent, label));
    } else {
      updateFromText(next);
    }
  };

  const applyPath = (newPath: string) => {
    const next = withReplacedFigurePath(mutableSource, newPath);
    if (next == null) return;
    if (isFigure) {
      updateFromText(synthesizeFigureRaw(next, captionTextContent, label));
    } else {
      updateFromText(next);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
  };

  const handlePickFile = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!docId) {
      console.warn("[figure] no docId — cannot resolve picked file against paper folder");
      return;
    }
    const handle = getDocWriteHandle(docId);
    if (!handle) {
      console.warn("[figure] no active write pipeline — cannot import file");
      return;
    }
    let picked;
    try {
      picked = await pickFigureFile();
    } catch (err) {
      console.error("[figure] file picker failed:", err);
      return;
    }
    if (!picked) return;
    try {
      const relPath = await importFigureFile(handle, picked);
      applyPath(relPath);
    } catch (err) {
      console.error("[figure] failed to import picked file:", err);
    }
  };

  const handleBodyClick = (e: React.MouseEvent) => {
    // Chrome controls, the empty-state CTA, the editable caption, and the
    // label lozenge all manage their own behaviour. Clicking anywhere else
    // opens the tex-mode popover (existing behaviour).
    if (
      (e.target as HTMLElement).closest(
        ".figure-chrome, .figure-empty-cta, .figure-caption, .figure-annotation",
      )
    )
      return;
    // Read-only bail: the popover's save would dispatch a doc-changing
    // transaction that the readOnlyEnforcer plugin silently rejects. Skip
    // the popover entirely rather than open it for a guaranteed-fail save.
    // The CSS rules under `.ProseMirror[data-editable="false"]` also hide
    // the chrome / empty-CTA so they can't even reach this branch.
    const editorRoot = wrapperRef.current?.closest(".ProseMirror");
    if (editorRoot?.getAttribute("data-editable") === "false") return;
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    window.dispatchEvent(
      new CustomEvent("virgil-figure-click", {
        detail: { kind: node.type.name, raw: popoverRaw, pos, rect },
      }),
    );
  };

  // ---- render ----

  if (isEmpty) {
    return (
      <NodeViewWrapper
        ref={wrapperRef as React.Ref<HTMLDivElement>}
        className="figure-block figure-block-empty"
        onClick={handleBodyClick}
        contentEditable={false}
      >
        <div className="figure-empty-stack">
          <button
            type="button"
            className="figure-empty-cta"
            onClick={handlePickFile}
          >
            <span className="figure-empty-cta-icon" aria-hidden="true">
              <FolderIcon />
            </span>
            <span className="figure-empty-cta-label">Choose image…</span>
          </button>
          <div className="figure-empty-hint">or click anywhere to edit code</div>
        </div>
        <div className="figure-chrome figure-chrome-empty">
          <ChromeIconButton
            title="Remove figure"
            onClick={handleDelete}
            kind="danger"
          >
            <CloseIcon />
          </ChromeIconButton>
        </div>
        {/* Empty figureBlock still has an editable caption sub-node and a
         *  lozenge — rendered inside the NodeViewWrapper so PM keeps track
         *  of the child. Hidden visually via CSS when the figure body is
         *  empty (the user is mid-insert; show the caption once they pick a
         *  source). The NodeViewContent must remain in the tree so PM
         *  doesn't strip the child node. */}
        {isFigure && (
          <span
            className="figure-caption-text figure-caption-text-hidden"
            data-figure-caption-empty=""
          >
            <NodeViewContent<"span"> as="span" />
          </span>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      className={`figure-block ${isFigure ? "figure-block-wrapped" : "figure-block-bare"}`}
      onClick={handleBodyClick}
      data-label={label || undefined}
    >
      <div className="figure-row" contentEditable={false}>
        {sources.map((src, i) => (
          <FigurePanel
            key={`${src.path}:${i}`}
            docId={docId}
            source={src}
            registerRefresh={registerRefresh}
          />
        ))}
      </div>
      {isFigure && (
        <div className="figure-caption">
          {numbered && figureNumber != null && (
            <span className="figure-caption-label" contentEditable={false}>
              Figure {figureNumber}:{" "}
            </span>
          )}
          <NodeViewContent<"span"> as="span" className="figure-caption-text" />
        </div>
      )}
      <FigureChrome
        currentPercent={currentPercent}
        canScale={canScale}
        onScale={applyScale}
        onPickFile={handlePickFile}
        onRefresh={handleRefreshAll}
        onDelete={handleDelete}
      />
      {isFigure && (
        <FigureAnnotation
          editor={editor}
          label={label}
          numbered={numbered}
          getFigurePos={getFigurePos}
          onConfirmRename={opts.onConfirmLabelRenameRef?.current ?? null}
          onConfirmDelete={opts.onConfirmFigureDeleteRef?.current ?? null}
        />
      )}
    </NodeViewWrapper>
  );
}

interface FigurePanelProps {
  docId: string | null;
  source: FigureSource;
  registerRefresh: (fn: () => void) => () => void;
}

function FigurePanel({ docId, source, registerRefresh }: FigurePanelProps) {
  const { url, status, error, refresh } = useResolvedFigureUrl(docId, source.path);
  const widthStyle = source.widthPercent
    ? { maxWidth: `${source.widthPercent}%` }
    : undefined;

  useEffect(() => registerRefresh(refresh), [refresh, registerRefresh]);

  let content: React.ReactNode;
  if (status === "loading") {
    content = <div className="figure-placeholder">Loading {source.path}…</div>;
  } else if (status === "not-found") {
    content = <div className="figure-error">Figure not found: {source.path}</div>;
  } else if (status === "error") {
    content = <div className="figure-error">{error || `Failed to render ${source.path}`}</div>;
  } else if (url) {
    content = <img src={url} alt={source.path} className="figure-image" />;
  } else {
    content = null;
  }

  return (
    <div className="figure-panel" style={widthStyle}>
      {content}
    </div>
  );
}

interface FigureChromeProps {
  currentPercent: number;
  canScale: boolean;
  onScale: (percent: number) => void;
  onPickFile: (e: React.MouseEvent) => void;
  onRefresh: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

function FigureChrome({
  currentPercent,
  canScale,
  onScale,
  onPickFile,
  onRefresh,
  onDelete,
}: FigureChromeProps) {
  const [draft, setDraft] = useState<string>(String(currentPercent));
  useEffect(() => {
    setDraft(String(currentPercent));
  }, [currentPercent]);

  const commitDraft = () => {
    const num = parseInt(draft, 10);
    if (Number.isNaN(num)) {
      setDraft(String(currentPercent));
      return;
    }
    const clamped = clampPercent(num);
    if (clamped !== currentPercent) {
      onScale(clamped);
    }
    setDraft(String(clamped));
  };

  const stepBy = (delta: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onScale(currentPercent + delta * STEP_PERCENT);
  };

  const stopProp = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const minusDisabled = !canScale || currentPercent <= MIN_PERCENT;
  const plusDisabled = !canScale || currentPercent >= MAX_PERCENT;

  return (
    <div className="figure-chrome" contentEditable={false}>
      <ChromeIconButton title="Pick image file" onClick={onPickFile}>
        <FolderIcon />
      </ChromeIconButton>
      <div
        className="figure-scale"
        data-disabled={canScale ? undefined : "true"}
        title={canScale ? undefined : "Width uses absolute units — edit in code to adjust"}
      >
        <button
          type="button"
          className="figure-scale-btn"
          aria-label="Decrease width"
          onMouseDown={stopProp}
          onClick={(e) => stepBy(-1, e)}
          disabled={minusDisabled}
        >
          −
        </button>
        <input
          type="number"
          className="figure-scale-input"
          value={draft}
          inputMode="numeric"
          min={MIN_PERCENT}
          max={MAX_PERCENT}
          step={1}
          disabled={!canScale}
          aria-label="Width percentage"
          onMouseDown={stopProp}
          onClick={stopProp}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setDraft(String(currentPercent));
              (e.target as HTMLInputElement).blur();
            }
          }}
          onBlur={commitDraft}
        />
        <button
          type="button"
          className="figure-scale-btn"
          aria-label="Increase width"
          onMouseDown={stopProp}
          onClick={(e) => stepBy(1, e)}
          disabled={plusDisabled}
        >
          +
        </button>
      </div>
      <ChromeIconButton title="Re-render from source" onClick={onRefresh}>
        <RefreshIcon />
      </ChromeIconButton>
      <ChromeIconButton title="Remove figure" onClick={onDelete} kind="danger">
        <CloseIcon />
      </ChromeIconButton>
    </div>
  );
}

function ChromeIconButton({
  title,
  onClick,
  children,
  kind,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
  kind?: "danger";
}) {
  return (
    <button
      type="button"
      className={`figure-chrome-btn${kind === "danger" ? " figure-chrome-btn-danger" : ""}`}
      title={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 50;
  const i = Math.round(n);
  if (i < MIN_PERCENT) return MIN_PERCENT;
  if (i > MAX_PERCENT) return MAX_PERCENT;
  return i;
}

// ---- icons (inline SVG for crisp scaling, no extra deps) ----

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.379a1.5 1.5 0 0 1 1.06.44L9 4.5h3.5A1.5 1.5 0 0 1 14 6v6.5A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M13.5 2.5V5h-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 3.5 12.5 12.5 M12.5 3.5 3.5 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
