"use client";

import { useMemo, useRef, useState } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { FigureSource } from "@/lib/figures/parse-attrs";
import { useResolvedFigureUrl } from "@/hooks/useResolvedFigureUrl";
import type { FigureBlockOptions } from "@/lib/tiptap/figure-block";

// Shared node view for both `figureBlock` and `graphicsBlock`. The node
// type drives whether caption/label chrome is shown.
export default function FigureBlockNodeView({ node, getPos, extension }: NodeViewProps) {
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

  const caption = (node.attrs.caption as string | undefined) || "";
  const label = (node.attrs.label as string | undefined) || "";
  const raw = isFigure
    ? (node.attrs.raw as string | undefined) || ""
    : (node.attrs.command as string | undefined) || "";

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const handleBodyClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".figure-reload")) return;
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

  if (sources.length === 0) {
    return (
      <NodeViewWrapper
        ref={wrapperRef as React.Ref<HTMLDivElement>}
        className="figure-block figure-block-empty"
        onClick={handleBodyClick}
        contentEditable={false}
      >
        <pre className="figure-raw">{raw}</pre>
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
          <FigurePanel key={`${src.path}:${i}`} docId={docId} source={src} />
        ))}
      </div>
      {isFigure && caption && (
        <div className="figure-caption">
          <CaptionRender caption={caption} />
        </div>
      )}
    </NodeViewWrapper>
  );
}

interface FigurePanelProps {
  docId: string | null;
  source: FigureSource;
}

function FigurePanel({ docId, source }: FigurePanelProps) {
  const { url, status, error, refresh } = useResolvedFigureUrl(docId, source.path);
  const [reloading, setReloading] = useState(false);
  const widthStyle = source.widthPercent
    ? { maxWidth: `${source.widthPercent}%` }
    : undefined;

  const handleReload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setReloading(true);
    refresh();
    setTimeout(() => setReloading(false), 250);
  };

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
      <button
        type="button"
        className="figure-reload"
        title="Re-render from source"
        onClick={handleReload}
      >
        {reloading ? "…" : "↻"}
      </button>
    </div>
  );
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
