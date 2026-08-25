import { useRef } from "react";
import { Editor } from "@tiptap/react";
import { usePaneResizeHandle } from "@/lib/pane-resize";
import { type SectionPathEntry } from "@/panels/Outline";
import EditorMirror from "../EditorMirror";
import { SectionLozenge } from "./section-lozenge";

/**
 * PARKED — deliberately unmounted since task 115. Nothing in `src/` renders
 * this, and that is now the intended state, not an accident.
 *
 * History: the split's render site was dropped in a refactor, and for months
 * afterwards the MenuBar still showed a "Split editor" toggle that flipped a
 * PERSISTED pref no pane read. Everything downstream believed that pref: the
 * Outline gated its green "mirror pane position" edge bar on it, and with no
 * mirror the mirror section path resolved to Document-start, so a single
 * click painted a permanent phantom bar on the Outline's title row that
 * survived reloads. Task 115 retired the whole live surface — the toggle, the
 * `editorSplit`/`editorSplitRatio` prefs (scrubbed from saved blobs by
 * `RETIRED_PREF_KEYS` in `useViewPrefs`), the Outline indicator, EditorLayout's
 * mirror section-path recompute + `activeSplitPane` state, and `editor-ops`'
 * mirror scroll routing.
 *
 * These two components (this file + `EditorMirror`) are kept because they are
 * self-contained and complete, so a future rebuild starts from working parts.
 * Re-mounting one is therefore a DECISION, not a wiring detail: the surface it
 * needs no longer exists, so restoring it means re-deciding the toggle, the
 * pref and the Outline indicator together. `editor-split-retirement.test.ts`
 * fails if this file gains a production importer without that list being
 * revisited. (It is not untested rot: `pane-resize-adoption.test.tsx` mounts
 * it and drives a real divider gesture, so the parts stay honest.)
 *
 * What it does when mounted: two-pane editor split — canonical TipTap view on
 * top, EditorMirror below (sharing the same ProseMirror state). Vertical drag
 * divider sets the ratio — live geometry is an imperative flex write on both
 * panes per frame (RAF-coalesced by the pane-resize engine); `onRatioChange`
 * commits ONCE on release. Each pane has its own X close button that collapses
 * the split.
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
    // A zero-move end never reaches here — the engine calls restore()
    // instead (task 470). That the engine compares EXACT px against the
    // getValue() snapshot is what makes this safe for a ratio-valued
    // divider: a ratio round-trip ((r·h)/h) is not IEEE-exact for ~10% of
    // stored (ratio, height) pairs, so a ratio-equality guard would fire a
    // spurious pref write per plain click.
    commit: (px) => {
      const h = startRef.current.h;
      if (h <= 0) return;
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
