/**
 * Bidirectional sync between TipTap (canonical, in-memory) and a
 * CodeMirror view showing the same document as `.tex` source.
 *
 * Source of truth: TipTap. The bridge does NOT write to disk — that is
 * left to TipTap's existing autosave (`useDocument.ts` → `writeDocBundle`,
 * which serializes JSONContent to `.tex` *and* updates the UUID-hint
 * sidecar in one shot).
 *
 * Direction (a) — code → tiptap:
 *   1. CodeMirror updateListener fires on user keystroke.
 *   2. After a `debounceMs` lull, we re-extract preamble/postamble (the
 *      user may have edited them) and call `parseLatex(text)` on the body.
 *   3. On parse success, set the syncing flag, push parsed JSON into
 *      TipTap via `editor.commands.setContent`, clear the flag. TipTap's
 *      autosaver fires on the resulting update and writes disk.
 *   4. On parse failure, do NOT touch TipTap (preserves last-good state).
 *      Surface the error via `onParseError`. Disk is not separately
 *      written; the failed code text lives in CodeMirror only until the
 *      user fixes it (or toggles code view off, which destroys CM state).
 *
 * Direction (b) — tiptap → code:
 *   1. TipTap fires a transaction. We check it's not one of ours
 *      (transaction meta), schedule a `reverseDebounceMs` push.
 *   2. On fire, serialize TipTap JSON with the bridge's tracked
 *      preamble/postamble and replace CM's full document. Cursor is
 *      captured before the replace via paragraph UUID + char offset and
 *      restored after.
 *
 * Echo prevention works at two layers:
 *   - A `syncing` flag (set during the bridge's own dispatches) — read
 *     by both listeners and skipped synchronously.
 *   - A CM annotation (SYNC_ANNOTATION) attached to our programmatic
 *     dispatches — defensive belt-and-suspenders since CM updates are
 *     coalesced through React, and the syncing flag may have cleared
 *     by the time the updateListener runs.
 *
 * Keystroke sanctity: TipTap → code subscribes via `editor.on('transaction')`,
 * which is allowed (it's an O(1) timer reset). The actual serialization
 * happens at debounce-fire time, not per keystroke.
 */
import type { Editor as TipTapEditor, JSONContent } from "@tiptap/react";
import type { Transaction as PmTransaction } from "prosemirror-state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import {
  parseLatex,
  extractPreambleAndPostamble,
} from "@/lib/latex-parser";
import { serializeToLatex } from "@/lib/latex-serializer";
import { getDocProducts } from "@/lib/doc-products/pipeline";
import {
  getRanges,
  getLineRangeForUuid,
  getActiveParagraphUuid,
  getCharRangeForUuid,
} from "@/lib/code-position-map";
import { setCodeBand } from "@/lib/code-band";

export const SYNC_ANNOTATION = Annotation.define<true>();

interface CursorAnchor {
  paragraphUuid: string | null;
  offsetInPara: number;
}

export interface CodePaneBridge {
  /** Dispose of all listeners and pending timers. Idempotent. */
  dispose(): void;
  /** Last parse error message, or null if the most recent parse succeeded. */
  getLastParseError(): string | null;
  /** Fire any pending pushes synchronously. Useful before unmount. */
  flush(): void;
  /**
   * Called by the CodeMirror updateListener for *user* doc changes. The
   * listener filter (`!tr.annotation(SYNC_ANNOTATION)`) keeps our own
   * programmatic dispatches from re-entering.
   */
  onCodeMirrorUpdate(u: ViewUpdate): void;
  /** Read-only view of the current preamble (for callers that care). */
  getPreamble(): string | undefined;
  /**
   * Manual align: move the CODE pane to match the TEXT (TipTap) cursor —
   * selects + scrolls CodeMirror to the active paragraph's source. Invoked
   * by the divider arrow; runs synchronously (not RAF-deferred).
   */
  moveCodeToTextCursor(): void;
  /**
   * Manual align: move the TEXT (TipTap) pane to match the CODE cursor —
   * selects + scrolls TipTap to the source paragraph under the CodeMirror
   * cursor. Invoked by the divider arrow; runs synchronously.
   */
  moveTextToCodeCursor(): void;
  /**
   * Replace the tracked preamble/postamble with fresh authoritative values
   * (re-read from disk after a style switch or external-change reload) and
   * force a reverse sync so the CM text reflects them. Clears any pending
   * `persistDelimiters` — the incoming values ARE the disk state.
   */
  setDelimiters(d: { preamble: string; postamble: string }): void;
}

export interface CreateCodePaneBridgeOptions {
  editor: TipTapEditor;
  view: EditorView;
  /**
   * Initial preamble extracted from the source `.tex`. The bridge will
   * update this whenever a code edit changes the preamble region.
   */
  initialPreamble?: string;
  initialPostamble?: string;
  /** Code → TipTap debounce (parse cost). Default 600 ms. */
  debounceMs?: number;
  /** TipTap → code debounce (serialize is cheap). Default 150 ms. */
  reverseDebounceMs?: number;
  /** Fired whenever the parse-error state changes (success clears it to null). */
  onParseError?: (err: Error | null) => void;
  /**
   * Fired from `flushCodeToTipTap` when a code edit CHANGED the
   * preamble/postamble (body-only edits never fire it), after the parsed
   * body has been pushed into TipTap. The autosaver's `writeDocBundle`
   * re-reads delimiters from the on-disk .tex, so a preamble edit that
   * lives only in this bridge's closure would silently die on close —
   * the callback's job is to commit the new delimiters to disk NOW
   * (writeDocBundle with the `delimiters` override).
   */
  persistDelimiters?: (d: { preamble: string; postamble: string }) => void;
  /**
   * A getter for the authoritative per-doc bib family, threaded into the
   * TipTap→code serialize so the code-view mirror reconciles the family the
   * same way the disk-save path does (P4). A getter (not a value) so the
   * bridge — constructed once per view/editor pair — always reads the CURRENT
   * family without rebuilding when the user changes it. Optional; unset →
   * body-derived family (today's behavior).
   */
  getBibFamily?: () => import("@/lib/bib-family").BibFamily | null;
  /**
   * Called when the family the body needs conflicts with the family the
   * code-view preamble hard-loads. Reuses the save-time soft-notice surface.
   */
  onBibFamilyConflict?: (
    conflict: import("@/lib/bib-family").BibFamilyConflict,
  ) => void;
}

export function createCodePaneBridge(
  opts: CreateCodePaneBridgeOptions,
): CodePaneBridge {
  const { editor, view } = opts;
  const debounceMs = opts.debounceMs ?? 600;
  const reverseDebounceMs = opts.reverseDebounceMs ?? 150;

  let preamble = opts.initialPreamble;
  let postamble = opts.initialPostamble;
  // Delimiters extracted from a code edit that still need committing to
  // disk via `persistDelimiters`. Held (not fired) across a parse failure
  // so a preamble edit made while the body is broken isn't lost — the
  // next successful flush persists it. Cleared by `setDelimiters` (the
  // incoming values are already the disk state).
  let pendingPersist: { preamble: string; postamble: string } | null = null;
  let syncing: "code" | "tiptap" | null = null;
  let lastParseError: string | null = null;
  let codeTimer: ReturnType<typeof setTimeout> | null = null;
  let tipTapTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function captureCursorAnchor(): CursorAnchor {
    try {
      const paras = getRanges(view);
      if (paras.length === 0) return { paragraphUuid: null, offsetInPara: 0 };
      const cursor = view.state.selection.main.head;
      const cursorLine = view.state.doc.lineAt(cursor).number;
      const para =
        paras.find((p) => cursorLine >= p.startLine && cursorLine <= p.endLine) ??
        null;
      if (!para) return { paragraphUuid: null, offsetInPara: 0 };
      const paraStartPos = view.state.doc.line(para.startLine).from;
      return {
        paragraphUuid: para.uuid,
        offsetInPara: Math.max(0, cursor - paraStartPos),
      };
    } catch {
      return { paragraphUuid: null, offsetInPara: 0 };
    }
  }

  function restoreCursorAnchor(anchor: CursorAnchor) {
    if (!anchor.paragraphUuid) return;
    try {
      const para = getLineRangeForUuid(view, anchor.paragraphUuid);
      if (!para) return;
      const paraStartPos = view.state.doc.line(para.startLine).from;
      const target = Math.min(
        paraStartPos + anchor.offsetInPara,
        view.state.doc.length,
      );
      view.dispatch({
        selection: { anchor: target },
        annotations: SYNC_ANNOTATION.of(true),
      });
    } catch {
      /* ignore — cursor restoration is best-effort */
    }
  }

  function flushCodeToTipTap() {
    if (disposed) return;
    if (codeTimer) {
      clearTimeout(codeTimer);
      codeTimer = null;
    }
    const text = view.state.doc.toString();
    // Re-extract preamble/postamble in case the user edited them. We
    // keep the previous values if extraction fails (e.g. mid-edit of
    // `\begin{document}` — nothing is persisted in that case either).
    const extracted = extractPreambleAndPostamble(text);
    if (extracted) {
      if (
        extracted.preamble !== preamble ||
        extracted.postamble !== postamble
      ) {
        // A genuine delimiter edit — mark it for the disk commit below.
        // Body-only edits re-extract byte-identical values and skip this.
        pendingPersist = extracted;
      }
      preamble = extracted.preamble;
      postamble = extracted.postamble;
    }
    let parsed: JSONContent;
    try {
      parsed = parseLatex(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (lastParseError !== message) {
        lastParseError = message;
        opts.onParseError?.(err instanceof Error ? err : new Error(message));
      }
      return;
    }
    if (lastParseError !== null) {
      lastParseError = null;
      opts.onParseError?.(null);
    }
    syncing = "code";
    try {
      // Replace TipTap content. `emitUpdate: true` (the default) so the
      // autosaver fires and persists the parsed JSON to disk via
      // writeDocBundle (which serializes back to .tex with preamble
      // preservation).
      editor.commands.setContent(parsed, {
        emitUpdate: true,
        parseOptions: { preserveWhitespace: "full" },
      });
    } finally {
      syncing = null;
    }
    // Commit a delimiter edit to disk AFTER the body push, so the
    // callback's `editor.getJSON()` snapshot carries the just-parsed
    // body alongside the new preamble (one write, fully fresh).
    if (pendingPersist) {
      const d = pendingPersist;
      pendingPersist = null;
      opts.persistDelimiters?.(d);
    }
  }

  function scheduleCodeToTipTap() {
    if (codeTimer) clearTimeout(codeTimer);
    codeTimer = setTimeout(flushCodeToTipTap, debounceMs);
  }

  function flushTipTapToCode() {
    if (disposed) return;
    if (tipTapTimer) {
      clearTimeout(tipTapTimer);
      tipTapTimer = null;
    }
    let latex: string;
    try {
      // Perf Wave 1 (S3): route through the DocProducts per-block caches
      // when the pipeline is mounted — O(changed blocks) instead of a full
      // getJSON + serialize on the 150 ms code-view clock. The bridge keeps
      // its OWN delimiters (it may hold an unsaved preamble edit; the
      // pipeline's disk-derived ones would resurrect the stale preamble).
      const assembleOpts = {
        preamble,
        postamble,
        bibFamily: opts.getBibFamily?.() ?? null,
        onRequirementConflict: opts.onBibFamilyConflict,
      };
      latex =
        getDocProducts(editor)?.assembleSourceWith(assembleOpts) ??
        serializeToLatex(editor.getJSON(), assembleOpts);
    } catch (err) {
      // Serialization should never fail under normal use; log and bail.
      console.error("[code-pane-bridge] serialize failed:", err);
      return;
    }
    const currentText = view.state.doc.toString();
    if (currentText === latex) return; // no-op; avoid cursor churn
    const anchor = captureCursorAnchor();
    syncing = "tiptap";
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: latex },
        annotations: SYNC_ANNOTATION.of(true),
      });
      restoreCursorAnchor(anchor);
    } finally {
      syncing = null;
    }
    // The content replace shifted line positions (and may have dropped
    // the mapped band decoration), so force a recompute against the
    // fresh doc — bypassing the equality bail.
    updateCodeBand(true);
  }

  function scheduleTipTapToCode() {
    if (tipTapTimer) clearTimeout(tipTapTimer);
    tipTapTimer = setTimeout(flushTipTapToCode, reverseDebounceMs);
  }

  // ── Cursor align (paragraph UUID) ───────────────────────────────
  // The two panes do NOT auto-follow each other's cursor. A TipTap
  // cursor move drives only the passive code-side band (no scroll);
  // explicit alignment is offered via the divider arrows, which call
  // `moveCodeToTextCursor` / `moveTextToCodeCursor` → the
  // `pushTipTapSelectionToCode` / `pushCodeSelectionToTipTap` bodies
  // below (each selects + scrolls the target pane).
  //
  // `selectionSyncing` is separate from the doc-sync flag so a
  // selection echo can't suppress a doc edit in flight. It guards the
  // manual align dispatches from re-entering.
  let selectionSyncing: "code" | "tiptap" | null = null;
  let codeBandRaf: number | null = null;

  function findTipTapPosByUuid(uuid: string): number {
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos >= 0) return false;
      if (node.attrs?.uuid === uuid) {
        // +1 lands inside the node, matching the convention used by
        // Editor.tsx's `scrollToParagraphId`.
        pos = p + 1;
        return false;
      }
      return true;
    });
    return pos;
  }

  function getTipTapActiveUuid(): string | null {
    try {
      const sel = editor.state.selection;
      const $anchor = sel.$from;
      for (let depth = $anchor.depth; depth >= 0; depth--) {
        const node = $anchor.node(depth);
        const uuid = node.attrs?.uuid;
        if (typeof uuid === "string" && uuid) return uuid;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  // ── Code-side cursor band (passive, no scroll) ──────────────────
  // Highlights the source lines of the text-object under the TipTap
  // cursor. Replaces the old auto-scroll align. Dispatched with
  // SYNC_ANNOTATION so the band update doesn't re-enter code→tiptap
  // sync. RAF-coalesced via `codeBandRaf` so a click-drag selection
  // fires at most one band update per frame.
  //
  // Equality bail: typing inside the same paragraph yields the same
  // {from,to} every frame — skip the redundant CM dispatch so the band
  // costs nothing per plain keystroke (keystroke sanctity). `force`
  // bypasses the bail after a TipTap→code content sync, where the line
  // positions shifted (and the mapped DecorationSet may have dropped)
  // even though the active UUID — hence the cached numbers — can collide.
  let lastBandFrom = -1;
  let lastBandTo = -1;
  function updateCodeBand(force = false) {
    codeBandRaf = null;
    if (disposed) return;
    try {
      const uuid = getTipTapActiveUuid();
      const range = uuid ? getCharRangeForUuid(view, uuid) : null;
      const from = range ? range.from : -1;
      const to = range ? range.to : -1;
      if (!force && from === lastBandFrom && to === lastBandTo) return;
      lastBandFrom = from;
      lastBandTo = to;
      view.dispatch({
        effects: setCodeBand.of(range),
        annotations: SYNC_ANNOTATION.of(true),
      });
    } catch {
      /* ignore */
    }
  }

  function scheduleCodeBand() {
    if (codeBandRaf !== null) return;
    // Wrap so requestAnimationFrame's timestamp arg isn't passed as `force`.
    codeBandRaf = requestAnimationFrame(() => updateCodeBand());
  }

  function pushTipTapSelectionToCode() {
    if (disposed) return;
    if (selectionSyncing) return;
    const uuid = getTipTapActiveUuid();
    if (!uuid) return;
    try {
      const found = getLineRangeForUuid(view, uuid);
      if (!found) return;
      const line = Math.min(found.startLine, view.state.doc.lines);
      const pos = view.state.doc.line(Math.max(1, line)).from;
      selectionSyncing = "tiptap";
      try {
        view.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, {
            y: "nearest",
            yMargin: 60,
          }),
          annotations: SYNC_ANNOTATION.of(true),
        });
      } finally {
        selectionSyncing = null;
      }
    } catch {
      /* ignore */
    }
  }

  function pushCodeSelectionToTipTap() {
    if (disposed) return;
    if (selectionSyncing) return;
    const uuid = getActiveParagraphUuid(view);
    if (!uuid) return;
    const pos = findTipTapPosByUuid(uuid);
    if (pos < 0) return;
    selectionSyncing = "code";
    try {
      editor.commands.setTextSelection(pos);
      try {
        const coords = editor.view.coordsAtPos(pos);
        if (coords) {
          // Find a scroll ancestor for the TipTap view and align it.
          let scrollEl: HTMLElement | null = editor.view.dom.parentElement;
          while (
            scrollEl &&
            scrollEl !== document.body &&
            getComputedStyle(scrollEl).overflowY === "visible"
          ) {
            scrollEl = scrollEl.parentElement;
          }
          if (scrollEl && scrollEl !== document.body) {
            const scrollRect = scrollEl.getBoundingClientRect();
            const targetY =
              coords.top - scrollRect.top + scrollEl.scrollTop - 100;
            scrollEl.scrollTop = Math.max(0, targetY);
          }
        }
      } catch {
        /* scroll best-effort */
      }
    } catch {
      /* setTextSelection best-effort — a manual align must never throw
         out to the divider-arrow click handler. */
    } finally {
      selectionSyncing = null;
    }
  }

  // TipTap cursor moves drive the passive code-side band only — NO
  // auto-scroll. The old `scheduleTipTapSelectionToCode()` (which
  // selected + scrolled CodeMirror) is now reachable only via the
  // manual `moveCodeToTextCursor()` align action.
  const tipTapSelectionHandler = () => {
    if (disposed) return;
    scheduleCodeBand();
  };
  editor.on("selectionUpdate", tipTapSelectionHandler);

  // TipTap-side listener. `transaction` (not `update`) so we see every
  // doc-mutating transaction, including non-user ones that don't bump
  // selection. The autosaver listens to `update` separately and is
  // unaffected.
  const tipTapHandler = ({ transaction }: { transaction: PmTransaction }) => {
    if (disposed) return;
    if (!transaction.docChanged) return;
    // Skip transactions we dispatched ourselves. The flag is set
    // synchronously around `setContent` and the resulting transactions
    // dispatch synchronously, so this check is reliable.
    if (syncing) return;
    scheduleTipTapToCode();
  };
  editor.on("transaction", tipTapHandler);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (codeTimer) {
        clearTimeout(codeTimer);
        codeTimer = null;
      }
      if (tipTapTimer) {
        clearTimeout(tipTapTimer);
        tipTapTimer = null;
      }
      if (codeBandRaf !== null) {
        cancelAnimationFrame(codeBandRaf);
        codeBandRaf = null;
      }
      editor.off("transaction", tipTapHandler);
      editor.off("selectionUpdate", tipTapSelectionHandler);
    },
    getLastParseError() {
      return lastParseError;
    },
    flush() {
      if (codeTimer) flushCodeToTipTap();
      if (tipTapTimer) flushTipTapToCode();
    },
    onCodeMirrorUpdate(u: ViewUpdate) {
      if (disposed) return;
      // Skip our own programmatic dispatches (both doc and selection
      // edits we make ourselves carry SYNC_ANNOTATION).
      if (u.transactions.some((tr) => tr.annotation(SYNC_ANNOTATION))) return;
      if (u.docChanged && !syncing) scheduleCodeToTipTap();
      // NOTE: selection-only updates no longer auto-align TipTap. The
      // panes don't auto-follow each other's cursor; alignment is
      // explicit via the divider arrows (`moveTextToCodeCursor`).
    },
    getPreamble() {
      return preamble;
    },
    moveCodeToTextCursor() {
      pushTipTapSelectionToCode();
    },
    moveTextToCodeCursor() {
      pushCodeSelectionToTipTap();
    },
    setDelimiters(d) {
      preamble = d.preamble;
      postamble = d.postamble;
      // These came FROM disk — nothing left to persist back.
      pendingPersist = null;
      flushTipTapToCode();
    },
  };
}
