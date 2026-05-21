"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  canEditWidthInOptions,
  extractFigureAttrs,
  extractGraphicsAttrs,
  type FigureSource,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import { useResolvedFigureUrl } from "@/hooks/useResolvedFigureUrl";
import { getDocWriteHandle, importFigureFile } from "@/lib/storage-fsa";
import type { FigureBlockOptions } from "@/lib/tiptap/figure-block";

const MIN_PERCENT = 10;
const MAX_PERCENT = 100;
const STEP_PERCENT = 10;

// Shared node view for both `figureBlock` and `graphicsBlock`. The node
// type drives whether caption/label chrome is shown and whether the source
// of truth is `raw` (figureBlock env body) or `command` (single command).
export default function FigureBlockNodeView({
  node,
  getPos,
  editor,
  extension,
}: NodeViewProps) {
  const opts = extension.options as FigureBlockOptions;
  const docId = opts.docIdRef?.current ?? null;
  const isFigure = node.type.name === "figureBlock";
  const cardContext = opts.cardContext === true;

  // Card-context preview: rendered inside a RichTextField or
  // HeadingFloat. Show a compact "Figure: …" / "Graphic: …" pill
  // instead of resolving the image — that keeps the node round-tripping
  // through cards without needing `docIdRef` forwarded into every
  // subordinate surface.
  if (cardContext) {
    const captionText = (node.attrs.caption as string | undefined) || "";
    const singleSource =
      (node.attrs.source as string | null | undefined) ||
      (((node.attrs.sources as FigureSource[] | undefined) || [])[0]?.path ?? "");
    const labelText = isFigure
      ? captionText || singleSource || "[figure]"
      : singleSource || "[graphic]";
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

  const caption = (node.attrs.caption as string | undefined) || "";
  const label = (node.attrs.label as string | undefined) || "";
  const raw = isFigure
    ? (node.attrs.raw as string | undefined) || ""
    : (node.attrs.command as string | undefined) || "";

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
  // `updateFromText` runs the appropriate extractor on the new text and
  // dispatches a setNodeMarkup transaction. Mirrors EditorLayout's
  // handleFigureSave so the popover and visual chrome stay in sync.
  const updateFromText = (newText: string) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    if (isFigure) {
      const attrs = extractFigureAttrs(newText);
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          raw: newText,
          source: attrs.source,
          widthPercent: attrs.widthPercent,
          sources: attrs.sources,
          caption: attrs.caption,
          label: attrs.label,
        }),
      );
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
    const next = withUpdatedFigureWidth(raw, clamped);
    if (next == null) return;
    updateFromText(next);
  };

  const applyPath = (newPath: string) => {
    const next = withReplacedFigurePath(raw, newPath);
    if (next == null) return;
    updateFromText(next);
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
    if (typeof window === "undefined" || typeof window.showOpenFilePicker !== "function") {
      console.warn("[figure] showOpenFilePicker is not available in this environment");
      return;
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
    let fileHandle: FileSystemFileHandle | null = null;
    try {
      const [picked] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "Image",
            accept: {
              "image/png": [".png"],
              "image/jpeg": [".jpg", ".jpeg"],
              "image/webp": [".webp"],
              "application/pdf": [".pdf"],
            },
          },
        ],
      });
      fileHandle = picked ?? null;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[figure] file picker failed:", err);
      return;
    }
    if (!fileHandle) return;
    try {
      const relPath = await importFigureFile(handle, fileHandle);
      applyPath(relPath);
    } catch (err) {
      console.error("[figure] failed to import picked file:", err);
    }
  };

  const handleBodyClick = (e: React.MouseEvent) => {
    // Chrome controls and their children manage their own behavior. Clicking
    // anywhere else opens the tex-mode popover (existing behavior).
    if (
      (e.target as HTMLElement).closest(
        ".figure-chrome, .figure-empty-cta",
      )
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    window.dispatchEvent(
      new CustomEvent("virgil-figure-click", {
        detail: { kind: node.type.name, raw, pos, rect },
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
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      className={`figure-block ${isFigure ? "figure-block-wrapped" : "figure-block-bare"}`}
      onClick={handleBodyClick}
      contentEditable={false}
      data-label={label || undefined}
    >
      <div className="figure-row">
        {sources.map((src, i) => (
          <FigurePanel
            key={`${src.path}:${i}`}
            docId={docId}
            source={src}
            registerRefresh={registerRefresh}
          />
        ))}
      </div>
      {isFigure && caption && (
        <div className="figure-caption">
          <CaptionRender caption={caption} />
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
    <div className="figure-chrome">
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

function CaptionRender({ caption }: { caption: string }) {
  const html = useMemo(() => latexCaptionToHtml(caption), [caption]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

function latexCaptionToHtml(input: string): string {
  const esc = input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .replace(/\\textbf\{([^}]*)\}/g, "<strong>$1</strong>")
    .replace(/\\(emph|textit)\{([^}]*)\}/g, "<em>$2</em>")
    .replace(/\\\\/g, "<br>");
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
