"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { CatalogEntry } from "@library/lib/catalog";
import type { BibEntry } from "@library/lib/types";
import { queueBibEdit } from "@library/lib/bib-edit";
import { isSynthesizedRaw } from "@library/lib/reconstruct-bibtex";
import {
  resetPaperViewModeOnOpen,
  usePaperViewMode,
} from "@library/lib/view-session-store";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { usePgmarkPages, type PgmarkPages } from "@library/hooks/usePgmarkPages";
import {
  pdfPagesToPgmark,
  type PdfPageState,
} from "@library/lib/pdf-pgmark-adapter";
import BibEditModal from "./BibEditModal";
import PaperHeader from "./PaperHeader";
import PaperRender from "./PaperRender";
import PdfView from "./PdfView";
// Drag-time followers of the app-wide pane-resize bus (sanctioned cross-silo
// bridge, see library/CLAUDE.md "Don't"): PaneFreeze width-locks the reader
// subtree for the length of a gutter gesture; parkDuringLayoutGesture stashes the
// two per-frame feedback paths below as defense-in-depth behind that freeze.
import {
  PaneFreeze,
  parkDuringLayoutGesture,
  type LayoutGesturePark,
} from "@/lib/pane-resize";
// Shared framed-viewer surface (inset + pod border/radius/shadow), the same
// component the docs-side compiled-PDF pane renders through — sanctioned
// cross-silo bridge (see library/CLAUDE.md "Don't"). Backdrop-parameterized:
// the Library PDF pane uses the warm "manila" backdrop.
import FramedViewerSurface from "@/components/FramedViewerSurface";

interface Props {
  handle: FileSystemDirectoryHandle | null;
  entry: CatalogEntry | null;
  bib: BibEntry | undefined;
  /** Reload master.bib after a save lands. */
  onBibChanged?: () => void;
  /** The on-demand FULL-entry fetch hasn't settled yet (a slim/synthesized
   *  `bib` is showing meanwhile). Drives a visible-but-disabled "Loading
   *  bibliography…" edit affordance; once settled, edit is shown iff a real
   *  full entry resolved (see `canEdit`), else hidden. */
  editPending?: boolean;
  /** View-session scope + panel — threaded into PaperRender so the reader
   *  scroll persists under (scope, panel, paper:<citekey>). */
  scope: string;
  panel: PanelKey;
}

/** Whether a PDF source is on disk for this entry (canonical or kept as
 *  an alternate after a .docx superseded the original .pdf). */
function hasPdfSource(entry: CatalogEntry): boolean {
  if (!entry.pdf.present) return false;
  const fmt = entry.pdf.format ?? "pdf";
  if (fmt === "pdf") return true;
  return !!entry.pdf.alternates?.some((f) => f.toLowerCase().endsWith(".pdf"));
}

export default function RightDetail({
  handle,
  entry,
  bib,
  onBibChanged,
  editPending = false,
  scope,
  panel,
}: Props) {
  // View mode lives in the per-paper `paper:<citekey>` slice (the same slice the
  // reader scroll uses), so the live Text/PDF toggle re-renders the detail pane.
  // It is SESSION-ONLY in effect though: per the user decision ("always reset to
  // PDF on open"), every paper open snaps the stored posture back to PDF (or to
  // Text for a DOCX-only source). `entry` can be null (empty-selection
  // placeholder below); use a stable sentinel libId so the hook order stays
  // constant — it's read only when a real paper is selected.
  const viewModeLibId = `paper:${entry?.citekey ?? "__none__"}`;
  // Whether a PDF source is on disk for THIS paper. Computed from `entry`
  // directly (a null entry has no PDF). Hoisted above the view-mode read so the
  // hook's default is OPEN-AWARE — render 1 paints Text for a DOCX-only source
  // instead of flashing the PDF branch (and its doomed FSA readFile) for one
  // frame before the post-paint reset corrects it.
  const pdfOnDisk = !!entry && hasPdfSource(entry);
  const { viewMode, setViewMode } = usePaperViewMode(
    scope,
    panel,
    viewModeLibId,
    pdfOnDisk,
  );
  const [editOpen, setEditOpen] = useState(false);

  // F#9: the "open in a new tab" link is redundant inside the OUTER Virgil-bar
  // tab (you're already in a tab). PaperOuterView passes `scope="outer:..."`;
  // the in-library Reader passes a non-"outer:" panel scope. Derive once and
  // thread to PaperHeader as `showOpenInTab` (pure prop threading — no
  // Reader-specific EditorPane render path; READER_INHERITANCE preserved).
  const isOuterTab = scope.startsWith("outer:");

  // Live Reader refs lifted up from PaperRender (a sibling BELOW the header) so
  // this component can run the SINGLE `usePgmarkPages` derivation (F#11) and
  // feed it to both consumers. Null in PDF mode (no PaperRender mounted).
  const [readerEditor, setReaderEditor] = useState<Editor | null>(null);
  const [readerScrollEl, setReaderScrollEl] = useState<HTMLElement | null>(null);
  const onReaderRefs = useCallback(
    (refs: { editor: Editor | null; scrollEl: HTMLElement | null }) => {
      setReaderEditor(refs.editor);
      setReaderScrollEl(refs.scrollEl);
    },
    [],
  );

  // ── Header ↔ text-pod width pinning ──────────────────────────────────
  // The PaperHeader pod is a sibling ABOVE the reader; left to its own devices
  // it centres in the FULL detail width, but the reader's editor card is pushed
  // right by the left panel rail (footnote/citation cards), so the two don't
  // line up. Measure the live text pod (`[data-pod-frame]` inside the reader)
  // in viewport coords and hand it to PaperHeader, which pins its own pod to
  // match (same width, same left edge). Text mode only — PDF mode has no editor
  // card, so the header falls back to its centred default. Panel dock/undock and
  // window resize both change the card's geometry, so we observe the scroll
  // container + the frame; RAF-coalesced, and the setState is equality-gated so
  // it never churns RightDetail on a no-op measure.
  const [textPodRect, setTextPodRect] = useState<{
    left: number;
    width: number;
  } | null>(null);
  useEffect(() => {
    if (viewMode !== "text" || !readerScrollEl) {
      setTextPodRect(null);
      return;
    }
    let raf = 0;
    let cancelled = false;
    // Parked during any continuous layout gesture — a pane-divider drag or an
    // OS window resize. Mid-drag the whole detail subtree is width-frozen (the
    // PaneFreeze mount below) so this RO shouldn't fire at all; the park is
    // defense-in-depth — a mid-gesture fire (font swap, image load) stashes
    // dirty and the end edge reconciles ONCE instead of riding a pointer frame
    // into the setTextPodRect → PaperHeader podAlign cascade.
    //
    // BOTH triggers go through it. This effect was the signature of the bug
    // task 317 fixed: the RO parked while the window `resize` listener 38
    // lines below fed the SAME scheduler raw — and since PaneFreeze does not
    // (and cannot) freeze an OS window resize, that raw path was the live one
    // for the whole gesture. A second subscription is exactly the one that
    // gets forgotten, which is why there is now one bus and one park.
    const park = parkDuringLayoutGesture(() => schedule());
    const onGeometry = () => park.fire();
    const ro = new ResizeObserver(onGeometry);
    const measure = () => {
      if (cancelled) return;
      const frame = readerScrollEl.querySelector<HTMLElement>("[data-pod-frame]");
      if (!frame) return;
      const r = frame.getBoundingClientRect();
      if (r.width <= 0) return;
      setTextPodRect((prev) =>
        prev &&
        Math.abs(prev.left - r.left) < 0.5 &&
        Math.abs(prev.width - r.width) < 0.5
          ? prev
          : { left: r.left, width: r.width },
      );
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    ro.observe(readerScrollEl);
    // The frame streams in after the EditorPane mounts — poll a bounded window
    // of frames until it exists, then observe it directly and stop polling.
    let polls = 0;
    const poll = () => {
      if (cancelled) return;
      const frame = readerScrollEl.querySelector<HTMLElement>("[data-pod-frame]");
      if (frame) {
        ro.observe(frame);
        measure();
        return;
      }
      if (polls++ < 180) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
    window.addEventListener("resize", onGeometry);
    measure();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      park.dispose();
      window.removeEventListener("resize", onGeometry);
    };
  }, [viewMode, readerScrollEl]);

  // F#11 — ONE printed-page derivation, owned here. RightDetail is the single
  // ancestor that renders BOTH consumers (PaperHeader's PagePicker directly,
  // and PageScrollLozenge via PaperRender), and it already holds the live
  // reader refs. Calling the hook here ONCE (instead of one instance per
  // consumer) means a single ResizeObserver + scroll listener + transaction
  // listener + doc-scan, with the resulting PgmarkPages threaded down as a
  // prop to both. Gated on text mode (refs are null in PDF mode anyway).
  const pgmarkPages: PgmarkPages = usePgmarkPages(
    viewMode === "text" ? readerEditor : null,
    viewMode === "text" ? readerScrollEl : null,
  );

  // F#11(a) — PDF-mode page picker. PdfView lifts the live pdf.js viewer page
  // state (pagesCount + current page) UP here, along with a `navigate(page)`
  // callback bound to the viewer's `PDFViewerApplication.page` setter. We hold
  // it and synthesize a `PgmarkPages`-shaped object via the pure adapter, then
  // thread it to the SAME PaperHeader PagePicker the text-mode picker uses —
  // RightDetail stays the single owner; PaperHeader never reaches into PdfView
  // or the iframe. pagesCount is 0 until `pagesinit` fires; the adapter yields
  // an empty picker (renders nothing) until then.
  const [pdfPageState, setPdfPageState] = useState<PdfPageState>({
    pagesCount: 0,
    currentPage: 1,
  });
  const pdfNavigateRef = useRef<(page: number) => void>(() => {});
  const applyPdfPageState = useCallback(
    (state: PdfPageState, navigate: (page: number) => void) => {
      pdfNavigateRef.current = navigate;
      setPdfPageState(state);
    },
    [],
  );
  // pdf.js eventBus → React feedback, parked during any pane-resize gesture:
  // mid-drag the iframe is width-frozen (the PaneFreeze mount below) so the
  // viewer sees no resize and shouldn't emit page-state churn at all; the park
  // is defense-in-depth for events that arrive anyway (an async rasterize
  // completing, a pagechanging settling) — latest-args-win, applied ONCE on
  // the end edge instead of re-rendering RightDetail per pointer frame. The
  // park's bus subscription is owned by the effect; outside its lifetime the
  // callback applies directly (never drops a viewer event).
  const pdfParkRef = useRef<LayoutGesturePark<
    [PdfPageState, (page: number) => void]
  > | null>(null);
  useEffect(() => {
    const park = parkDuringLayoutGesture(applyPdfPageState);
    pdfParkRef.current = park;
    return () => {
      pdfParkRef.current = null;
      park.dispose();
    };
  }, [applyPdfPageState]);
  const onPdfPageStateChange = useCallback(
    (state: PdfPageState, navigate: (page: number) => void) => {
      (pdfParkRef.current?.fire ?? applyPdfPageState)(state, navigate);
    },
    [applyPdfPageState],
  );
  // Re-derive only when the scalar page state changes; the scrollToPage closure
  // reads the latest navigate via the ref, so its identity needn't churn.
  const pdfPgmarkPages: PgmarkPages = useMemo(
    () =>
      pdfPagesToPgmark(
        pdfPageState.pagesCount,
        pdfPageState.currentPage,
        (page) => pdfNavigateRef.current(page),
      ),
    [pdfPageState.pagesCount, pdfPageState.currentPage],
  );

  // On every paper (re)open: close any stale edit modal AND reset the view mode
  // to the fresh-open default — PDF when a PDF exists, else Text. This makes the
  // Text toggle session-only: it works while the paper is open, but reopening
  // the paper goes back to PDF, ignoring any prior persisted Text choice. The
  // reset also subsumes the old "coerce pdf→text when no PDF on disk" guard
  // (DOCX-only sources reset straight to Text). Applies to ALL entry paths —
  // catalogue row click, the `virgil-open-library` event, and the outer tab —
  // since they all funnel through this component. Keyed on citekey (the open
  // identity) + pdfOnDisk so a late-resolving catalog entry that flips PDF
  // availability re-snaps correctly.
  useEffect(() => {
    setEditOpen(false);
    if (entry) resetPaperViewModeOnOpen(scope, panel, viewModeLibId, pdfOnDisk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.citekey, pdfOnDisk, scope, panel]);

  // Edit must be gated on a REAL FULL bib entry, never on a slim-synthesized one
  // (DATA-LOSS regression). PaperFileBody always hands us a populated `bib.raw`
  // for DISPLAY: it prefers the on-demand FULL entry but, while that fetch is
  // pending or has failed on a real 10 MB master.bib, it falls back to a `raw`
  // synthesized from the slim browse record (type:"misc" + ~12 browse fields).
  // BibEditModal seeds its form from `entry.type`+`entry.fields` (NOT `raw`) and
  // onSave REPLACES the whole master.bib block — so editing a synthesized entry
  // would overwrite the real entry with a lossy `@misc` block, silently dropping
  // the real type + all non-browse fields. So `canEdit` requires a non-empty raw
  // that is NOT synthesized; while the full entry is pending/failed, edit stays
  // disabled. (Display still uses the synthesized `bib`, so the card always
  // renders formatted text.) A `bib.raw` arriving from a real full entry — or any
  // entry that carried its own raw — passes through untouched.
  const hasRealFullEntry = !!(bib && bib.raw && !isSynthesizedRaw(bib));
  const canEdit = !!(handle && hasRealFullEntry && entry?.citekey);

  if (!entry) {
    return (
      <div
        style={{
          height: "100%",
          // Fill the pane on either flex axis so the placeholder centers over
          // the full detail width, not a content-shrunk left-pinned strip
          // (task 054 — same flex-row mount caveat as the branches below).
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontStyle: "italic",
          background: "var(--background)",
        }}
      >
        Select a paper from the list.
      </div>
    );
  }

  // `entry` is non-null past the early return, so this equals `pdfOnDisk`.
  const pdfAvailable = pdfOnDisk;

  // PaneFreeze anchor = this pane's STATIONARY edge, derived from the mount
  // (hard-coding "right" would glue a LEFT-panel reader to its MOVING edge —
  // the frozen content would translate with every pointer frame, the exact
  // failure the anchor doc calls worse than no freeze). Papers routinely
  // mount in the LEFT panel: openPaper routes to the panel OPPOSITE the
  // click, and tabs drag across panels. Geometry per PanelKey
  // (library-grid-template.ts): the RIGHT panel is the minmax(…,1fr) READER
  // track — both library gutters move its LEFT edge, its right edge is
  // container-fixed → "right". The LEFT panel is the fixed-width LIST track —
  // the list|reader gutter moves its RIGHT edge while its left edge stays
  // put → "left" (a nav|list drag translates the track rigidly, where either
  // anchor is a no-op). The outer-tab mount (PaperOuterView: panel="left",
  // scope="outer:*") sees no bus gesture today, so "left" is inert there.
  const freezeAnchor: "left" | "right" = panel === "left" ? "left" : "right";

  if (viewMode === "pdf") {
    // PDF mode: full-width layout, no drag handles. PaneFreeze is the branch
    // root: its outer node carries the task-054 pane-fill contract (flex:1 +
    // minWidth:0 + height:100% — grow to fill the pane in BOTH the flex-ROW
    // in-library mount (ReaderLRU → KeepAliveSlot) and the flex-COLUMN
    // outer-tab mount (PaperOuterView); without the grow, PDF mode collapsed
    // to the ~620px header width, left-pinned), and it width-freezes the
    // whole subtree — header + pdf.js iframe — for the length of any pane
    // gutter gesture, so the viewer re-scales/re-rasterizes exactly ONCE per
    // drag instead of per pointer frame. The anchor is the pane's stationary
    // edge, derived per PanelKey above. The pane background rides the freeze
    // wrapper so the sliver revealed while the pane grows mid-drag paints as
    // reader background, not the grid behind.
    return (
      <PaneFreeze anchor={freezeAnchor} style={{ background: "var(--background)" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <PaperHeader
            handle={handle}
            entry={entry}
            bib={bib}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            pdfAvailable={pdfAvailable}
            indexedState={entry.indexed.state}
            onEdit={canEdit ? () => setEditOpen(true) : undefined}
            editPending={!canEdit && editPending}
            showOpenInTab={!isOuterTab}
            pgmarkPages={pdfPgmarkPages}
            textPodRect={textPodRect}
          />
          <FramedViewerSurface backdrop="manila">
            <PdfView
              handle={handle}
              citekey={entry.citekey}
              onPdfPageStateChange={onPdfPageStateChange}
            />
          </FramedViewerSurface>
          {editOpen && canEdit && bib && handle && entry.citekey && (
            <BibEditModal
              entry={bib}
              onClose={() => setEditOpen(false)}
              onSave={async (type, fields) => {
                await queueBibEdit(handle, entry.citekey!, { type, fields });
                onBibChanged?.();
              }}
            />
          )}
        </div>
      </PaneFreeze>
    );
  }

  // Text mode: header above the editor area; the panel/editor
  // boundary uses the canonical `PanelColumn` drag-gap inside
  // `EditorPane` — Reader inherits the same affordance as the main
  // editor. Same PaneFreeze branch root as the PDF branch above: the
  // task-054 fill contract lives on the freeze wrapper's outer node, and a
  // pane gutter drag reflows the O(doc) ProseMirror doc exactly ONCE (on the
  // end edge) instead of per pointer frame. Anchor derived per PanelKey above.
  return (
    <PaneFreeze anchor={freezeAnchor} style={{ background: "var(--background)" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <PaperHeader
          handle={handle}
          entry={entry}
          bib={bib}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          pdfAvailable={pdfAvailable}
          indexedState={entry.indexed.state}
          onEdit={canEdit ? () => setEditOpen(true) : undefined}
          editPending={!canEdit && editPending}
          showOpenInTab={!isOuterTab}
          pgmarkPages={pgmarkPages}
          textPodRect={textPodRect}
        />
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <PaperRender
            handle={handle}
            citekey={entry.citekey}
            indexedState={entry.indexed.state}
            scope={scope}
            panel={panel}
            onReaderRefs={onReaderRefs}
            pgmarkPages={pgmarkPages}
          />
        </div>
        {editOpen && canEdit && bib && handle && entry.citekey && (
          <BibEditModal
            entry={bib}
            onClose={() => setEditOpen(false)}
            onSave={async (type, fields) => {
              await queueBibEdit(handle, entry.citekey!, { type, fields });
              onBibChanged?.();
            }}
          />
        )}
      </div>
    </PaneFreeze>
  );
}
