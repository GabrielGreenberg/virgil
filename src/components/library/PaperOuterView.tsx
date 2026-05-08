"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDragGap } from "@/hooks/useDragGap";
import { useLibraryHandle } from "@library/hooks/useLibraryHandle";
import { useCatalog } from "@library/hooks/useCatalog";
import { useMasterBib } from "@library/hooks/useMasterBib";
import LibraryFolderPicker from "@library/components/LibraryFolderPicker";
import LibraryPermissionGate from "@library/components/LibraryPermissionGate";
import PaperFileBody from "@library/components/PaperFileBody";
import type { BibEntry } from "@library/lib/types";

interface Props {
  /** Citekey backing this outer tab. Used as both the lookup into the
   *  catalog/master.bib and the localStorage key for the per-paper
   *  centered-column width. */
  citekey: string;
}

const WIDTH_PREFIX = "virgil-paper-page-width/";
const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 320;
const MIN_MARGIN = 40;

/**
 * Outer Virgil-bar paper viewer. Renders the paper centered with
 * symmetric margins; left and right grabs adjust the column width
 * (margins rebalance automatically because they're `flex: 1`).
 * Width is persisted per citekey to localStorage so the paper opens
 * at the same size on reload.
 */
export default function PaperOuterView({ citekey }: Props) {
  const lib = useLibraryHandle();

  if (lib.state.kind === "loading") {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        style={{ color: "var(--muted)" }}
      >
        Loading…
      </div>
    );
  }
  if (lib.state.kind === "none") {
    return <LibraryFolderPicker onPick={lib.pick} />;
  }
  if (lib.state.kind === "needs-permission") {
    return (
      <LibraryPermissionGate onGrant={lib.grant} onReset={lib.reset} />
    );
  }
  return <ReadyView handle={lib.state.handle} citekey={citekey} />;
}

function ReadyView({
  handle,
  citekey,
}: {
  handle: FileSystemDirectoryHandle;
  citekey: string;
}) {
  const { catalog, reload: reloadCatalog } = useCatalog(handle);
  const { entries: bibEntries, reload: reloadBib } = useMasterBib(handle);

  const bibByKey = useMemo(() => {
    const m = new Map<string, BibEntry>();
    for (const e of bibEntries) m.set(e.key, e);
    return m;
  }, [bibEntries]);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Clamp a requested width against the viewport's available room
  // (container width minus 2*MIN_MARGIN). Falls back to the request when
  // the container hasn't measured yet.
  const clampToViewport = useCallback((requested: number) => {
    const cw = containerRef.current?.getBoundingClientRect().width ?? 0;
    const max = cw > 0 ? Math.max(MIN_WIDTH, cw - 2 * MIN_MARGIN) : requested;
    return Math.max(MIN_WIDTH, Math.min(max, requested));
  }, []);
  // Hydrate from localStorage on mount + whenever citekey changes. The
  // hydration clamp matches the live drag clamp so a paper saved at a
  // wide width on a big monitor doesn't overflow on a smaller one.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(WIDTH_PREFIX + citekey);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      const requested =
        Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WIDTH;
      // Defer one frame so containerRef is measured before clamping.
      requestAnimationFrame(() => setWidth(clampToViewport(requested)));
    } catch {
      setWidth(DEFAULT_WIDTH);
    }
  }, [citekey, clampToViewport]);

  const widthRef = useRef(width);
  widthRef.current = width;

  const startWidth = useRef(0);
  const startX = useRef(0);

  const persist = useCallback(
    (w: number) => {
      try {
        localStorage.setItem(WIDTH_PREFIX + citekey, String(Math.round(w)));
      } catch {
        // ignore
      }
    },
    [citekey],
  );

  // Left grab: dragging right NARROWS the centered column by 2x the
  // delta (each margin grows by the delta). Dragging left widens.
  const onLeftMove = useCallback((e: MouseEvent) => {
    const delta = e.clientX - startX.current;
    const containerW =
      containerRef.current?.getBoundingClientRect().width ?? Infinity;
    const maxWidth = Math.max(MIN_WIDTH, containerW - 2 * MIN_MARGIN);
    const next = Math.max(
      MIN_WIDTH,
      Math.min(maxWidth, startWidth.current - 2 * delta),
    );
    setWidth(next);
  }, []);

  // Right grab: mirror — dragging right widens the column.
  const onRightMove = useCallback((e: MouseEvent) => {
    const delta = e.clientX - startX.current;
    const containerW =
      containerRef.current?.getBoundingClientRect().width ?? Infinity;
    const maxWidth = Math.max(MIN_WIDTH, containerW - 2 * MIN_MARGIN);
    const next = Math.max(
      MIN_WIDTH,
      Math.min(maxWidth, startWidth.current + 2 * delta),
    );
    setWidth(next);
  }, []);

  const left = useDragGap({ cursor: "col-resize", onMove: onLeftMove });
  const right = useDragGap({ cursor: "col-resize", onMove: onRightMove });

  // Wrap the gap's onMouseDown to capture pointer-down state and persist
  // on pointer-up. useDragGap's mouseup unbinds itself; ours fires once
  // and writes the final width.
  const wrapMouseDown = useCallback(
    (gapMouseDown: (e: React.MouseEvent) => void) =>
      (e: React.MouseEvent) => {
        startX.current = e.clientX;
        startWidth.current = widthRef.current;
        const onUp = () => {
          persist(widthRef.current);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mouseup", onUp);
        gapMouseDown(e);
      },
    [persist],
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-1 min-h-0 overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <div className="flex-1 min-w-0" />
      <div
        ref={left.gapRef}
        className="drag-gap drag-gap-v shrink-0 drag-gap-toward-editor-right"
        style={{ width: "var(--pod-gap)" }}
        onMouseDown={wrapMouseDown(left.onMouseDown)}
      />
      <div
        className="flex flex-col min-h-0 overflow-hidden"
        style={{
          flex: `0 0 ${width}px`,
          // No border / radius for the popped-out paper view: the active
          // outer tab fills the warm Virgil canvas, and the paper file's
          // own header + scroll strip + editor pod sit directly on it
          // with no extra frame.
          background: "var(--background)",
          margin: "var(--pod-gap) 0",
        }}
      >
        <PaperFileBody
          handle={handle}
          citekey={citekey}
          entries={catalog?.entries ?? []}
          bibByKey={bibByKey}
          onBibChanged={() => {
            void reloadBib();
            void reloadCatalog();
          }}
        />
      </div>
      <div
        ref={right.gapRef}
        className="drag-gap drag-gap-v shrink-0 drag-gap-toward-editor-left"
        style={{ width: "var(--pod-gap)" }}
        onMouseDown={wrapMouseDown(right.onMouseDown)}
      />
      <div className="flex-1 min-w-0" />
    </div>
  );
}
