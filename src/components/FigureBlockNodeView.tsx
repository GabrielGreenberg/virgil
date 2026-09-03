"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  canEditWidthInOptions,
  type FigureSource,
  withReplacedFigurePath,
  withUpdatedFigureWidth,
} from "@/lib/figures/parse-attrs";
import { buildFigureEnvBody, figureNodeEmitsCaption } from "@/lib/figures/env-body";
import {
  applyFigureExtrasEdit,
  applyGraphicsCommandEdit,
} from "@/lib/figures/apply-env-body";
import { useResolvedFigureUrl } from "@/hooks/useResolvedFigureUrl";
// Route through the storage facade, not directly at the FSA backend — the
// dev backend has its own `importFigureFile` that PUTs to the dev API.
// `pickFigureFile` encapsulates the FSA-picker vs hidden-`<input>` dispatch.
import { getDocWriteHandle, importFigureFile } from "@/lib/storage";
import { pickFigureFile } from "@/lib/figures/pick-file";
import type { FigureBlockOptions } from "@/lib/tiptap/figure-block";
import { useFieldEditSession } from "@/lib/field-edit-session";
import { resolveBlockFrame } from "@/text-objects/block-frame";
import FigureAnnotation from "./FigureAnnotation";
import { chromeOnly } from "@/lib/view-only-chrome";

const MIN_PERCENT = 10;
const MAX_PERCENT = 100;
const STEP_PERCENT = 10;
/** The width the STEPPERS seed from when the source carries no width at all
 *  (a bare `\includegraphics{a.png}` renders at its natural size). This is a
 *  fact about the chrome's first press — `−` gives 40, `+` gives 60 — and
 *  NEVER a value the width box displays: a figure with no width shows an
 *  empty box, because printing a number the document does not contain is how
 *  the box came to display the one value it could not commit (task 537). */
const DEFAULT_SCALE_PERCENT = 50;

// Gap (px) between a hugged block's right edge and the chrome row when the row
// sits beside the image. MUST match `.figure-chrome-beside { left: calc(100% +
// 8px) }` in globals.css — the fit test below subtracts this same gap, so the
// row only goes beside when it provably clears the text-column right edge.
const CHROME_BESIDE_GAP = 8;

// Stable no-op refresh registrar for the read-only card-preview figure panels
// (Issue-4): they reuse FigurePanel for faithful image resolution but never
// expose the chrome refresh button, so they register nothing. Module-level so
// the identity is stable across renders (FigurePanel's effect depends on it).
const noopRegisterRefresh = (): (() => void) => () => {};

// The tex-mode popover seed for a figure/graphics node — the faithful env body
// (figureBlock: `extras` + the live caption text + `\label`) or the verbatim
// `\includegraphics` command (graphicsBlock). Shared by BOTH click surfaces
// (the page `FigureFullView` and the float `FigureFloatView`) so they open the
// popover on identical raw and can never drift (the Issue-4/9/10 lesson).
function figurePopoverRaw(node: NodeViewProps["node"]): string {
  if (node.type.name !== "figureBlock") {
    return (node.attrs.command as string | undefined) || "";
  }
  const captionChild = node.firstChild;
  // Tasks 318/319: built by the SAME builder the serializer uses, so what the
  // popover shows is what the file holds. Two consequences the retired local
  // synthesizer got wrong: the `[short]` LoF bracket now appears (it emitted
  // none, so the user was shown a body missing a byte their file had — and any
  // save that changed something ELSE re-extracted from that body and DELETED
  // task 263's bracket; a literally untouched save was safe, since
  // `NodeEditPopover.commit` dispatches only when the text differs), and a
  // caption-less figure shows no `\caption` line, which the user can now add or
  // remove here as a first-class edit.
  return buildFigureEnvBody({
    extras: (node.attrs.extras as string | undefined) || "",
    trailingExtras: (node.attrs.trailingExtras as string | undefined) || "",
    captionTex:
      captionChild?.type.name === "figureCaption" ? captionChild.textContent : "",
    hasCaption: node.attrs.hasCaption !== false,
    shortCaption: (node.attrs.shortCaption as string | null | undefined) ?? null,
    numbered: node.attrs.numbered !== false,
    label: (node.attrs.label as string | undefined) || "",
  });
}

// Shared node view for both `figureBlock` and `graphicsBlock`. The node
// type drives whether caption/label chrome is shown. For figureBlock the
// caption is a `figureCaption` child sub-node (`content: "inline*"`) so
// citations, marks, and footnotes work inside; `extras` carries the
// non-caption non-label parts of the env body for the width-scaler / file-
// picker mutators. For graphicsBlock the source-of-truth is the `command`
// attr (a single `\includegraphics[...]{...}` string).
//
// The outer component is a thin dispatcher across three modes:
//   1. `figureFloat` (L3n) — the figure's OWN lifted-overlay float: the shared
//      FigureVisual with an EDITABLE caption (decision B) but a read-only image
//      and NO chrome. Click-to-edit DOES fire here (EX-F4-02): the
//      `virgil-figure-click` carries THIS float's editor, so the save routes
//      back into the float (not MAIN by absolute pos) and round-trips via
//      figure-body's write-back. Checked FIRST.
//   2. `cardContext` (popped-out section/list/example floats) — a READ-ONLY
//      image preview (Issue-4: a popped section should SHOW its nested figures,
//      not a `Figure: …` pill). UNCHANGED by L3n.
//   3. otherwise — the full editable page view (chrome, caption sub-node,
//      editable label lozenge, click-to-edit popover). UNCHANGED by L3n.
export default function FigureBlockNodeView(props: NodeViewProps) {
  const opts = props.extension.options as FigureBlockOptions;
  if (opts.figureFloat === true) {
    return <FigureFloatView {...props} />;
  }
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
  // The doc-wide numberer doesn't run in the float, but `figureNumber` /
  // `numbered` ride in via node.toJSON() sync, so mirror FigureFullView's
  // "Figure N:" label (read-only) instead of recomputing the number.
  const numbered = node.attrs.numbered !== false;
  const figureNumber = node.attrs.figureNumber as string | number | null;
  // The `\label{fig:…}` chip rides in via node.toJSON() sync (a declared attr,
  // like figureNumber). Render it read-only through the SAME FigureAnnotation
  // the page uses, so the lozenge can't drift out of the float again (Issue-10).
  const label = (node.attrs.label as string | undefined) || "";

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

  // Real image, read-only. Renders through the SHARED `FigureVisual` (the same
  // row/caption/lozenge structure the page uses), so a future figure affordance
  // ports here automatically — closing the Issue-4/9/10 accretion. This surface
  // passes: the `noopRegisterRefresh` (no chrome refresh button to wire), no
  // `rowContentEditable` (the wrapper's `contentEditable={false}` covers the
  // row), a STATIC caption span (only when there's text — vs the page's editable
  // NodeViewContent), no chrome slot, and the lozenge in `readOnly` mode, gated
  // on a present label: an unlabeled figure has no `\label` source to mirror (its
  // number is already shown by the caption), so it stays chrome-free.
  return (
    <NodeViewWrapper
      className={`figure-block figure-block-card-image ${
        isFigure ? "figure-block-wrapped" : "figure-block-bare"
      }`}
      contentEditable={false}
    >
      <FigureVisual
        isFigure={isFigure}
        sources={sources}
        docId={docId}
        registerRefresh={noopRegisterRefresh}
        numbered={numbered}
        figureNumber={figureNumber}
        captionSlot={
          captionText && (
            <span className="figure-caption-text">{captionText}</span>
          )
        }
        lozenge={
          isFigure && label ? (
            <FigureAnnotation readOnly label={label} numbered={numbered} />
          ) : null
        }
      />
    </NodeViewWrapper>
  );
}

// Figure-float render (L3n) — the figure's OWN lifted-overlay float, the third
// mode beside FigureCardPreview (read-only, for figures NESTED in other floats)
// and FigureFullView (the editable page). Renders the SAME shared `FigureVisual`
// as the page, combining slots no other surface does: an EDITABLE caption
// (decision B — `NodeViewContent`, round-tripping via figure-body's
// `writeBackToMain`) + a read-only image (`FigurePanel`, reusing the Issue-7b
// object-URL so the popped image is flicker-free) + a readOnly `\label` lozenge,
// but NO chrome.
//
// Click-to-edit DOES fire here (EX-F4-02, the figure twin of the math fix). The
// OLD design deliberately omitted the wrapper `onClick` because the page's
// `handleBodyClick` dispatched `virgil-figure-click` with the node's pos and
// `EditorLayout.handleFigureSave` applied it to MAIN by absolute pos — from a
// float that pos is meaningless (the L3h.1 math-click misfire class), so the
// edit was suppressed and the image's source/width were "edited on the page"
// only. The fix routes by the editor instance that OWNS the clicked node: we
// carry THIS float's `editor` in the event, and the save dispatches into it, so
// `pos` is read in the float's pos-space and the edit round-trips to MAIN via
// figure-body's write-back (`onUpdate` → `writeBackToMain`). graphicsBlock
// (atom, no caption) now opens the same popover on its `\includegraphics`
// command rather than being view-only.
function FigureFloatView({ node, getPos, editor, extension }: NodeViewProps) {
  const opts = extension.options as FigureBlockOptions;
  const docId = opts.docIdRef?.current ?? null;
  const isFigure = node.type.name === "figureBlock";
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Same source derivation as FigureCardPreview (serves both kinds): explicit
  // `sources` first, else the single `source` attr. graphicsBlock has no
  // `sources` attr, so it falls through to its `source` string.
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

  const label = (node.attrs.label as string | undefined) || "";
  const numbered = node.attrs.numbered !== false;
  const figureNumber = node.attrs.figureNumber as string | number | null;

  // An un-sourced figure in its own float is an edge case (the dev doc has
  // none): FigureVisual then renders an empty `.figure-row` (no FigurePanel)
  // plus the editable caption — NOT the page's picker CTA (the float never
  // mounts the chrome/picker; the source is set via the tex-mode popover the
  // click below opens). The caption `NodeViewContent` stays mounted regardless
  // so PM keeps the figureCaption child for write-back.
  //
  // EX-F4-02: clicking the read-only image opens the tex-mode popover, exactly
  // like the page view — but the save routes back into THIS float editor
  // (carried via `virgil-figure-click` → handleFigureSave), so `pos` is read in
  // the float's pos-space and the edit round-trips to MAIN via figure-body's
  // write-back. The editable caption + its label lozenge manage their own
  // clicks (a click there places the cursor), so guard those targets — the same
  // guard FigureFullView uses (its `.figure-chrome` / `.figure-empty-cta`
  // selectors simply never match in the chrome-free float).
  const handleBodyClick = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest(".figure-caption, .figure-annotation")
    )
      return;
    // The float editor is editable, but mirror the math gate: a read-only
    // surface (none today, the displayMath-D analog) stays inert.
    if (!editor.isEditable) return;
    e.preventDefault();
    e.stopPropagation();
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    window.dispatchEvent(
      new CustomEvent("virgil-figure-click", {
        detail: {
          kind: node.type.name,
          raw: figurePopoverRaw(node),
          pos,
          rect,
          // The owning editor — the save MUST target this float, not MAIN.
          editor,
        },
      }),
    );
  };

  // The wrapper inherits the float's editability (no `contentEditable` prop) so
  // the caption is editable; `rowContentEditable={false}` keeps the image row
  // read-only — exactly FigureFullView's slot wiring minus chrome, plus the
  // owning-editor-routed click, and with a readOnly (vs editable) lozenge.
  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      className={`figure-block figure-block-float ${
        isFigure ? "figure-block-wrapped" : "figure-block-bare"
      }`}
      onClick={handleBodyClick}
    >
      <FigureVisual
        isFigure={isFigure}
        sources={sources}
        docId={docId}
        registerRefresh={noopRegisterRefresh}
        rowContentEditable={false}
        numbered={numbered}
        figureNumber={figureNumber}
        captionSlot={
          isFigure ? (
            <NodeViewContent<"span"> as="span" className="figure-caption-text" />
          ) : null
        }
        lozenge={
          isFigure && label ? (
            <FigureAnnotation readOnly label={label} numbered={numbered} />
          ) : null
        }
      />
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
  // Whether LaTeX will give this float a number at all — read from the SAME
  // predicate the emitter and the numberers use, so the lozenge's `#` toggle
  // can't offer a switch with nothing behind it (tasks 318/319).
  const canNumber = isFigure && figureNodeEmitsCaption(node);

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
  // surface. Routed through the shared `figurePopoverRaw` so the page and the
  // float (FigureFloatView) can never drift on what raw the popover opens.
  const popoverRaw = useMemo(() => figurePopoverRaw(node), [node]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // `editor` is stable for a mounted NodeView; mirror it into a ref so the
  // chrome-placement effect (deps: []) can resolve the canonical block frame
  // (chip 4b) without taking `editor` as a dep — which would re-subscribe the
  // ResizeObserver — preserving the empty-deps layout-sanctity contract.
  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Chrome placement. When the control row fits in the space to the RIGHT of
  // the hugged (fit-content) block within the text column, it sits BESIDE the
  // image (`.figure-chrome-beside`) instead of overlaying its top-right corner.
  // false → the absolute top-right overlay (the fallback for a wide image with
  // no room). Computed by the ResizeObserver effect below.
  const [chromeBeside, setChromeBeside] = useState(false);

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
  // `null` when the source carries NO width — `parseWidthSpec("")` — which is
  // the commonest figure there is and renders at natural size (the hug layout
  // below applies no max-width for exactly this case). Pre-537 this read
  // `?? 50`, so the box PRINTED a width the document did not have, and the
  // zero-change bail in `applyScale` then refused the one value the box was
  // showing: typing 50 dispatched nothing while typing 60 worked. The chrome
  // and the renderer must agree about the same figure.
  const currentPercent: number | null =
    firstSource?.widthPercent != null ? clampPercent(firstSource.widthPercent) : null;

  // ---- mutation helpers (close over editor + node + getPos) ----

  const getFigurePos = useCallback((): number | null => {
    const p = typeof getPos === "function" ? getPos() : null;
    return p ?? null;
  }, [getPos]);

  // The width stepper and the file picker rewrite the `\includegraphics` line.
  // For a figureBlock that line lives entirely in `extras`, so they patch THAT
  // and nothing else; a graphicsBlock has no `extras` — its whole source IS the
  // `command` attr — so it re-extracts from the rewritten command.
  //
  // Both used to funnel through a shared `updateFromText` that synthesized a
  // WHOLE env body and re-extracted it, which meant projecting the caption down
  // to plain text and re-tokenizing it on every click: any citation / mark /
  // math in the caption was flattened, the `[short]` LoF bracket was dropped,
  // and `extras` gained two more spaces of indent each time. Note this is NOT
  // the popover's save path, despite the old name — a source-popover save for
  // EITHER kind routes `virgil-figure-click` → `EditorLayout.handleFigureSave`,
  // which shares the same writeback module (tasks 318/319).
  const applyToGraphicsSource = (next: string) => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (pos == null) return;
    if (isFigure) {
      applyFigureExtrasEdit(editor, pos, next);
    } else {
      applyGraphicsCommandEdit(editor, pos, next);
    }
  };

  const applyScale = (newPercent: number) => {
    const clamped = clampPercent(newPercent);
    // The task-470 zero-move rule: a gesture that produced no NET change
    // persists nothing (a redundant `setNodeMarkup` is an undo step and an
    // autosave arm). A source with NO width is never "unchanged" — every
    // first commit lands, including the seed the steppers start from.
    if (currentPercent !== null && clamped === currentPercent) return;
    const next = withUpdatedFigureWidth(mutableSource, clamped);
    if (next == null) return;
    applyToGraphicsSource(next);
  };

  const applyPath = (newPath: string) => {
    const next = withReplacedFigurePath(mutableSource, newPath);
    if (next == null) return;
    applyToGraphicsSource(next);
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
        // EX-F4-02: carry the owning editor so the save targets THIS editor
        // (the page = main). The float surface (FigureFloatView) carries its
        // own editor the same way; handleFigureSave routes by it, never to
        // MAIN by absolute pos.
        detail: { kind: node.type.name, raw: popoverRaw, pos, rect, editor },
      }),
    );
  };

  // Decide whether the hover chrome fits BESIDE the image (to its right) within
  // the text column, and toggle `.figure-chrome-beside` accordingly. Per-figure
  // and on-demand: observes only THIS block and its containing column, RAF-
  // coalesced — it never walks the doc, so keystroke-sanctity is not implicated.
  // Recomputes on mount, image load, and scale change (each resizes this block)
  // and on column/editor resize (the parent), via one ResizeObserver on both.
  // The chrome is laid out even while hover-hidden (opacity:0), so its width is
  // measurable any time; being position:absolute, toggling the class never
  // resizes the block or column, so there is no ResizeObserver feedback loop.
  // Chip 4b: the block's content-right edge (the chrome's beside anchor) is read
  // from the canonical `resolveBlockFrame`, so it shares ONE geometry source with
  // the grab handle (which hugs the same frame on the left); the column edge
  // stays a direct measure — it's the fit boundary, not a figure affordance.
  useEffect(() => {
    const block = wrapperRef.current;
    // The block's parent is the `.react-renderer` NodeView wrapper, a full-width
    // block in the doc flow — so its content-right edge IS the text-column right
    // (the same edge a sibling paragraph wraps at). That's our fit boundary.
    const column = block?.parentElement ?? null;
    if (!block || !column) return;

    let raf = 0;
    const recompute = () => {
      raf = 0;
      // Only a populated chrome can go beside; the empty-state row stays put.
      const chrome = block.querySelector<HTMLElement>(
        ".figure-chrome:not(.figure-chrome-empty)",
      );
      if (!chrome) {
        setChromeBeside(false);
        return;
      }
      const colStyle = getComputedStyle(column);
      const columnRight =
        column.getBoundingClientRect().right -
        (parseFloat(colStyle.paddingRight) || 0) -
        (parseFloat(colStyle.borderRightWidth) || 0);
      // The figure's content-right edge from the CANONICAL block frame, not an
      // independent box measure. `resolveBlockFrame(block)` resolves `block` (the
      // `.figure-block` hug box) to itself, so `contentRight` IS the rendered
      // image's right edge — the same number `.figure-chrome-beside`'s CSS anchor
      // (`left: calc(100% + 8px)`) lands on, and the mirror of the grab handle
      // hugging the marker on the LEFT: one frame on both sides. We pass the hug
      // box, NOT the full-width `.react-renderer` [data-uuid] host — the host
      // resolves to the column extent (which the drop indicator correctly wants),
      // so leaving `resolveFirstLineTarget` untouched keeps that bar intact.
      const blockRight = resolveBlockFrame(block).contentRight;
      const chromeWidth = chrome.getBoundingClientRect().width;
      const available = columnRight - blockRight - CHROME_BESIDE_GAP;
      setChromeBeside(chromeWidth > 0 && available >= chromeWidth);
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(recompute);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(block);
    ro.observe(column);
    schedule(); // initial measure (covers mount)

    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ---- render ----

  if (isEmpty) {
    return (
      <NodeViewWrapper
        ref={wrapperRef as React.Ref<HTMLDivElement>}
        className="figure-block figure-block-empty"
        onClick={handleBodyClick}
        contentEditable={false}
      >
        {/* PRINT (task 535): the picker CTA, its hint, the empty state's
            control row and the per-panel resolution states below are editor
            chrome — statements about Virgil's state, never about the paper —
            so each is stamped `chromeOnly()` and ONE `@media print` rule hides
            them all. The empty ROOT is the node (a `figure` env with nothing
            in it) and stays; its drop-zone paint is flattened on paper by a
            print rule on `.figure-block-empty` instead. */}
        <div className={chromeOnly("figure-empty-stack")}>
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
        <div className={chromeOnly("figure-chrome figure-chrome-empty")}>
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

  // A single picture/figure (the common case) hugs its content instead of
  // sitting in a text-column-wide box. The block shrinks to fit-content
  // (globals.css `.figure-block-hug`) and carries the scale itself as a
  // max-width — a percentage of the text column, its containing block — so
  // the image keeps the EXACT rendered size it had before. The per-panel
  // widthPercent is stripped (below) so the panel fills the block; otherwise
  // its `% of block` would re-shrink against the now-narrow block and the
  // empty box would reappear. Subfigures (multi-source) keep the column-width
  // layout — their per-panel widths can't collapse to one box-free measure
  // without column-relative units, so they're left unchanged.
  const hugSource = sources.length === 1 ? sources[0] : null;
  const hugStyle =
    hugSource?.widthPercent != null
      ? ({ maxWidth: `${hugSource.widthPercent}%` } as React.CSSProperties)
      : undefined;
  const visualSources = hugSource
    ? sources.map((s) => ({ ...s, widthPercent: null }))
    : sources;

  return (
    <NodeViewWrapper
      ref={wrapperRef as React.Ref<HTMLDivElement>}
      className={`figure-block ${hugSource ? "figure-block-hug " : ""}${isFigure ? "figure-block-wrapped" : "figure-block-bare"}`}
      onClick={handleBodyClick}
      data-label={label || undefined}
      style={hugStyle}
    >
      <FigureVisual
        isFigure={isFigure}
        sources={visualSources}
        docId={docId}
        registerRefresh={registerRefresh}
        rowContentEditable={false}
        numbered={numbered}
        figureNumber={figureNumber}
        captionSlot={
          isFigure ? (
            <NodeViewContent<"span"> as="span" className="figure-caption-text" />
          ) : null
        }
        chrome={
          <FigureChrome
            currentPercent={currentPercent}
            canScale={canScale}
            onScale={applyScale}
            onPickFile={handlePickFile}
            onRefresh={handleRefreshAll}
            beside={chromeBeside}
          />
        }
        lozenge={
          isFigure ? (
            <FigureAnnotation
              editor={editor}
              label={label}
              numbered={numbered}
              canNumber={canNumber}
              getFigurePos={getFigurePos}
              onConfirmRename={opts.onConfirmLabelRenameRef?.current ?? null}
              onConfirmDelete={opts.onConfirmFigureDeleteRef?.current ?? null}
            />
          ) : null
        }
      />
    </NodeViewWrapper>
  );
}

interface FigureVisualProps {
  isFigure: boolean;
  sources: FigureSource[];
  docId: string | null;
  registerRefresh: (fn: () => void) => () => void;
  // The page marks the source row `contentEditable={false}` (its NodeViewWrapper
  // stays editable so the caption's NodeViewContent works); the read-only
  // preview omits this and lets the row inherit `contentEditable=false` from its
  // wrapper. `undefined` → React drops the attribute, so the preview row stays
  // attribute-free (byte-identical to the hand-built render).
  rowContentEditable?: boolean;
  numbered: boolean;
  figureNumber: string | number | null;
  // The caption text element: editable `<NodeViewContent>` on the page, a static
  // `<span>` (only when there's text) in the preview. Passed as a slot so the
  // shared shell needn't know which surface it's on.
  captionSlot?: React.ReactNode;
  // Page-only interactive chrome (width scaler / picker / refresh / delete);
  // the read-only preview passes nothing.
  chrome?: React.ReactNode;
  // The `\label` lozenge — editable `<FigureAnnotation editor>` on the page, a
  // `readOnly` one in the preview; null when there's no lozenge to show.
  lozenge?: React.ReactNode;
}

// Shared presentational shell for a non-empty figure/graphic, rendered by BOTH
// the editable page view (`FigureFullView`) and the read-only card preview
// (`FigureCardPreview`). It owns the structure those two used to hand-build
// twice — the `.figure-row` of `FigurePanel`s, the `.figure-caption` ("Figure
// N:" prefix + a caption slot), and the chrome + lozenge slots — so a future
// figure affordance is added ONCE and ports to every surface, ending the
// Issue-4/9/10 accretion (each of which had to re-teach the read-only copy a
// piece the page already had). The DOM order each surface emits is preserved by
// what it passes: page → row, caption, chrome, lozenge; preview → row, caption,
// lozenge (no chrome slot). The empty states (page picker CTA, preview pill)
// genuinely differ and stay per-view — they return before this shell.
export function FigureVisual({
  isFigure,
  sources,
  docId,
  registerRefresh,
  rowContentEditable,
  numbered,
  figureNumber,
  captionSlot,
  chrome,
  lozenge,
}: FigureVisualProps) {
  // Render the caption block when this is a figure AND either a caption text
  // element was supplied OR the "Figure N:" prefix will show. Truthiness (not
  // `!= null`) is load-bearing for byte-identical parity: the preview's slot is
  // `captionText && <span/>`, i.e. "" (falsy) for an empty caption — matching
  // the old `{captionText && …}` gate — while the page always supplies a
  // (truthy) `NodeViewContent`, so its caption block always renders for a
  // figureBlock, exactly as `FigureFullView` did before.
  const showCaption =
    isFigure && (!!captionSlot || (numbered && figureNumber != null));
  return (
    <>
      <div className="figure-row" contentEditable={rowContentEditable}>
        {sources.map((src, i) => (
          <FigurePanel
            key={`${src.path}:${i}`}
            docId={docId}
            source={src}
            registerRefresh={registerRefresh}
          />
        ))}
      </div>
      {showCaption && (
        <div className="figure-caption">
          {numbered && figureNumber != null && (
            <span className="figure-caption-label" contentEditable={false}>
              Figure {figureNumber}:{" "}
            </span>
          )}
          {captionSlot}
        </div>
      )}
      {chrome}
      {lozenge}
    </>
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
    content = <div className={chromeOnly("figure-placeholder")}>Loading {source.path}…</div>;
  } else if (status === "not-found") {
    // DECIDED (task 535): a broken path does NOT print. A print is a
    // rendering of the paper; the path is in the `.tex`, and danger-red
    // editor text in the body of a manuscript reads as damage, not as
    // information. The image simply is not there, which is the truth.
    content = <div className={chromeOnly("figure-error")}>Figure not found: {source.path}</div>;
  } else if (status === "error") {
    content = <div className={chromeOnly("figure-error")}>{error || `Failed to render ${source.path}`}</div>;
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
  /** `null` = the source carries no width (natural size). The box then shows
   *  its `auto` placeholder rather than a number, and the steppers seed from
   *  `DEFAULT_SCALE_PERCENT` on their first press. */
  currentPercent: number | null;
  canScale: boolean;
  onScale: (percent: number) => void;
  onPickFile: (e: React.MouseEvent) => void;
  onRefresh: (e: React.MouseEvent) => void;
  // When true the row sits beside the image's right edge (`.figure-chrome-beside`)
  // instead of overlaying its top-right corner; decided by FigureFullView's fit
  // measurement. Kept as a prop (not an imperative class toggle) so React owns
  // the className and a scale-driven re-render can't clobber the placement.
  beside?: boolean;
}

/** Exported for `figure-scale-escape.test.tsx`: the cancel/commit contract is a
 *  fact about THIS component's keymap, and the enclosing NodeView cannot be
 *  mounted without a whole editor. Same precedent as `MarkerButton` /
 *  `MarginColumn` being exported for their own sweeps. */
export function FigureChrome({
  currentPercent,
  canScale,
  onScale,
  onPickFile,
  onRefresh,
  beside,
}: FigureChromeProps) {
  const [draft, setDraft] = useState<string>(draftFor(currentPercent));
  useEffect(() => {
    setDraft(draftFor(currentPercent));
  }, [currentPercent]);

  // The width box commits on blur and cancels on Escape, and `.blur()` inside a
  // keydown dispatches `focusout` SYNCHRONOUSLY — so the revert `setDraft` below
  // cannot be what stops the commit (it is batched, and `commitDraft` reads
  // `draft` from THIS render). Pre-529 that meant Escape resized the figure to
  // whatever had been typed and wrote a real `setNodeMarkup` transaction, while
  // the box rendered the reverted number. `@/lib/field-edit-session`.
  const session = useFieldEditSession();

  const commitDraft = () => {
    const num = parseInt(draft, 10);
    if (Number.isNaN(num)) {
      // An empty or unparseable draft commits NOTHING — for a width-less
      // figure that leaves it at natural size, which is what the box says.
      setDraft(draftFor(currentPercent));
      return;
    }
    const clamped = clampPercent(num);
    // `null !== 50`, so the first commit on a width-less figure LANDS — the
    // box can only display a value it can commit (task 537).
    if (clamped !== currentPercent) {
      onScale(clamped);
    }
    setDraft(String(clamped));
  };

  // Where the steppers start from: the source's width, or the stated seed
  // when it has none. The box itself never shows the seed.
  const stepOrigin = currentPercent ?? DEFAULT_SCALE_PERCENT;

  const stepBy = (delta: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onScale(stepOrigin + delta * STEP_PERCENT);
  };

  const stopProp = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const minusDisabled = !canScale || stepOrigin <= MIN_PERCENT;
  const plusDisabled = !canScale || stepOrigin >= MAX_PERCENT;
  const naturalSize = currentPercent === null;

  return (
    <div
      // Chrome-only on paper (task 535): hover-revealed on screen, and until
      // 535 invisible on paper only by the ACCIDENT of `opacity: 0` at rest.
      className={chromeOnly(`figure-chrome${beside ? " figure-chrome-beside" : ""}`)}
      contentEditable={false}
    >
      <ChromeIconButton title="Pick image file" onClick={onPickFile}>
        <FolderIcon />
      </ChromeIconButton>
      <div
        className="figure-scale"
        data-disabled={canScale ? undefined : "true"}
        data-hint={canScale ? undefined : "Width uses absolute units — edit in code to adjust"} aria-label={canScale ? undefined : "Width uses absolute units — edit in code to adjust"}
      >
        <button
          type="button"
          className="figure-scale-btn focus-ring"
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
          // The honest empty state: a figure with no `width=` renders at
          // natural size, and the box says so instead of printing a number
          // the document does not hold. Typing any number sets one.
          placeholder={naturalSize ? NATURAL_SIZE_PLACEHOLDER : undefined}
          data-natural-size={naturalSize ? "true" : undefined}
          aria-label={
            naturalSize
              ? "Width percentage — none set, the image is at its natural size"
              : "Width percentage"
          }
          onMouseDown={stopProp}
          onClick={stopProp}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              // Commit AND blur through the door: pre-529 the explicit call and
              // the blur's own `onBlur` both ran `commitDraft` from this same
              // stale closure — where `clamped !== currentPercent` still held —
              // so one Enter dispatched TWO byte-identical `setNodeMarkup`
              // transactions: two undo steps and two autosave arms per resize.
              session.commitAndBlur(e.currentTarget, commitDraft);
            } else if (e.key === "Escape") {
              e.preventDefault();
              session.cancel(e.currentTarget, () =>
                setDraft(draftFor(currentPercent)),
              );
            }
          }}
          onBlur={() => session.commit(commitDraft)}
        />
        <button
          type="button"
          className="figure-scale-btn focus-ring"
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
      // Stamped on the button ITSELF as well as on the row that hosts it: the
      // census resolves coverage by JSX subtree, and this component's JSX
      // sits outside every row that renders it.
      className={chromeOnly(`figure-chrome-btn${kind === "danger" ? " figure-chrome-btn-danger" : ""}`)}
      data-hint={title}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick} aria-label={title}
    >
      {children}
    </button>
  );
}

/** What the width box RENDERS for a given source width: the number, or the
 *  empty string (the placeholder shows through) for a width-less figure. */
function draftFor(percent: number | null): string {
  return percent === null ? "" : String(percent);
}

/** Shown in the empty box of a width-less figure. Deliberately NOT `50`:
 *  a muted "50" still reads as a width, and the whole defect was a number
 *  the document did not contain. */
const NATURAL_SIZE_PLACEHOLDER = "auto";

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCALE_PERCENT;
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
