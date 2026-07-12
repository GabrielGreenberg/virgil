import { useRef } from "react";
import { Editor } from "@tiptap/react";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import { type SectionPathEntry } from "@/panels/Outline";
import EditorMirror from "../EditorMirror";
import { SectionLozenge } from "./section-lozenge";

/**
 * Two-pane editor split: canonical TipTap view on the left, EditorMirror
 * on the right (sharing the same ProseMirror state). Vertical drag
 * divider sets the ratio — live geometry is an imperative flex write on
 * both panes per frame (RAF-coalesced by the pane-resize engine);
 * `onRatioChange` commits ONCE on release. Each pane has its own X close
 * button that collapses the split.
 */
export function SplitEditorPanes({
  editorInstance,
  canonical,
  ratio,
  onRatioChange,
  onClose,
  onMirrorFocus,
  onMirrorViewReady,
  sectionPath,
  mirrorSectionPath,
}: {
  editorInstance: Editor | null;
  canonical: React.ReactNode;
  ratio: number;
  onRatioChange: (r: number) => void;
  onClose: () => void;
  onMirrorFocus?: () => void;
  onMirrorViewReady?: (view: import("prosemirror-view").EditorView | null) => void;
  sectionPath: SectionPathEntry[];
  mirrorSectionPath: SectionPathEntry[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Per-gesture snapshot (container height + start px), taken in
  // getValue() — the engine's single start-edge read point.
  const startRef = useRef({ h: 0, startPx: 0 });

  // Cancel / zero-move re-sync from the source of truth (the ratio prop):
  // React rendered these exact flex strings, so writing them re-converges
  // DOM and props.
  const restoreFlex = () => {
    if (topRef.current) topRef.current.style.flex = `${ratio} 1 0`;
    if (bottomRef.current) bottomRef.current.style.flex = `${1 - ratio} 1 0`;
  };

  const handle = usePaneResizeHandle({
    id: "editor-split",
    axis: "y",
    getValue: () => {
      const h = containerRef.current?.getBoundingClientRect().height ?? 0;
      const startPx = ratio * h;
      startRef.current = { h, startPx };
      return startPx;
    },
    clamp: (px) => {
      const h = startRef.current.h;
      if (h <= 0) return px;
      return Math.max(0.15 * h, Math.min(0.85 * h, px));
    },
    // Live geometry is an imperative flex write on both panes — one
    // RAF-coalesced pass per frame, zero React state until release.
    apply: (px) => {
      const h = startRef.current.h;
      if (h <= 0) return;
      const r = px / h;
      if (topRef.current) topRef.current.style.flex = `${r} 1 0`;
      if (bottomRef.current) bottomRef.current.style.flex = `${1 - r} 1 0`;
    },
    commit: (px) => {
      const h = startRef.current.h;
      if (h <= 0) return;
      // Zero-move end (plain click): keep the old no-write behavior and
      // re-sync the DOM from the prop in case applies happened. Exact px
      // compare against the getValue() snapshot — a ratio round-trip
      // ((r·h)/h) is not IEEE-exact for ~10% of stored (ratio, height)
      // pairs and would fire a spurious pref write per plain click.
      if (px === startRef.current.startPx) {
        restoreFlex();
        return;
      }
      onRatioChange(px / h);
    },
    restore: restoreFlex,
  });

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Top pane — own white pod */}
      <div
        ref={topRef}
        data-editor-pane="top"
        className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${ratio} 1 0`, background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}
      >
        {canonical}
        <SectionLozenge sectionPath={sectionPath} />
      </div>
      {/* Drag gap — canvas shows between the two editor pods */}
      <div className="relative shrink-0 z-10" style={{ height: 'var(--pod-gap)' }}>
        <div className="drag-gap drag-gap-h band-grip w-full h-full" {...handle}>
          {/* Wider invisible hit target — a CHILD of the handle so a grab
              here bubbles to the captured element and the `.dragging` grip
              chrome lands on the visible gap. */}
          <div
            className="absolute inset-x-0 cursor-row-resize"
            style={{ top: -4, bottom: -4, background: "transparent" }}
          />
        </div>
      </div>
      {/* Bottom pane — own white pod */}
      <div
        ref={bottomRef}
        data-editor-pane="bottom"
        className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${1 - ratio} 1 0`, background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}
      >
        <EditorMirror
          editor={editorInstance}
          onClose={onClose}
          onFocus={onMirrorFocus}
          onViewReady={onMirrorViewReady}
        />
        <SectionLozenge sectionPath={mirrorSectionPath} />
      </div>
    </div>
  );
}
