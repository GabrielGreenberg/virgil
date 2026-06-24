import { useCallback, useRef } from "react";
import { Editor } from "@tiptap/react";
import { useDragGap } from "@/hooks/useDragGap";
import { type SectionPathEntry } from "@/panels/Outline";
import EditorMirror from "../EditorMirror";
import { SectionLozenge } from "./section-lozenge";

/**
 * Two-pane editor split: canonical TipTap view on the left, EditorMirror
 * on the right (sharing the same ProseMirror state). Vertical drag
 * divider sets the ratio. Each pane has its own X close button that
 * collapses the split.
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

  const onMove = useCallback(
    (ev: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) return;
      const r = (ev.clientY - rect.top) / rect.height;
      onRatioChange(Math.max(0.15, Math.min(0.85, r)));
    },
    [onRatioChange],
  );

  const { gapRef: editorGapRef, onMouseDown } = useDragGap({ cursor: "row-resize", onMove });

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-w-0 min-h-0">
      {/* Top pane — own white pod */}
      <div
        data-editor-pane="top"
        className="relative flex flex-col min-w-0 min-h-0 overflow-hidden"
        style={{ flex: `${ratio} 1 0`, background: 'var(--pod-editor)', borderRadius: 'var(--pod-radius)', border: 'var(--pod-border)', boxShadow: 'var(--pod-shadow)' }}
      >
        {canonical}
        <SectionLozenge sectionPath={sectionPath} />
      </div>
      {/* Drag gap — canvas shows between the two editor pods */}
      <div className="relative shrink-0 z-10" style={{ height: 'var(--pod-gap)' }}>
        <div
          className="absolute inset-x-0 cursor-row-resize"
          style={{ top: -4, bottom: -4, background: "transparent" }}
          onMouseDown={onMouseDown}
        />
        <div
          ref={editorGapRef}
          className="drag-gap drag-gap-h w-full h-full"
          onMouseDown={onMouseDown}
        />
      </div>
      {/* Bottom pane — own white pod */}
      <div
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
