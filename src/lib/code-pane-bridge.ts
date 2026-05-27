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
import { findParagraphUuids } from "@/lib/latex-paragraph-map";

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
}

export function createCodePaneBridge(
  opts: CreateCodePaneBridgeOptions,
): CodePaneBridge {
  const { editor, view } = opts;
  const debounceMs = opts.debounceMs ?? 600;
  const reverseDebounceMs = opts.reverseDebounceMs ?? 150;

  let preamble = opts.initialPreamble;
  let postamble = opts.initialPostamble;
  let syncing: "code" | "tiptap" | null = null;
  let lastParseError: string | null = null;
  let codeTimer: ReturnType<typeof setTimeout> | null = null;
  let tipTapTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function captureCursorAnchor(): CursorAnchor {
    try {
      const text = view.state.doc.toString();
      const paras = findParagraphUuids(text);
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
      const text = view.state.doc.toString();
      const paras = findParagraphUuids(text);
      const para = paras.find((p) => p.uuid === anchor.paragraphUuid);
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
    // `\begin{document}`).
    const extracted = extractPreambleAndPostamble(text);
    if (extracted) {
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
      const json = editor.getJSON();
      latex = serializeToLatex(json, { preamble, postamble });
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
  }

  function scheduleTipTapToCode() {
    if (tipTapTimer) clearTimeout(tipTapTimer);
    tipTapTimer = setTimeout(flushTipTapToCode, reverseDebounceMs);
  }

  // ── Selection sync (paragraph UUID, bidirectional) ──────────────
  // Both sides emit selection events only on user action — TipTap's
  // `selectionUpdate` fires on cursor moves (not keystrokes), and CM's
  // updateListener exposes `tr.selection` separately from `docChanged`.
  // We coalesce to one push per animation frame so click-and-drag
  // selections don't fire a flurry. Within keystroke sanctity rules.
  //
  // `selectionSyncing` is separate from the doc-sync flag so a
  // selection echo can't suppress a doc edit in flight.
  let selectionSyncing: "code" | "tiptap" | null = null;
  let tipTapToCodeSelRaf: number | null = null;
  let codeToTipTapSelRaf: number | null = null;

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

  function getCmActiveParagraphUuid(): string | null {
    try {
      const text = view.state.doc.toString();
      const paras = findParagraphUuids(text);
      if (paras.length === 0) return null;
      const cursorLine = view.state.doc.lineAt(view.state.selection.main.head)
        .number;
      const direct = paras.find(
        (p) => cursorLine >= p.startLine && cursorLine <= p.endLine,
      );
      if (direct) return direct.uuid;
      // Cursor lies between paragraphs — pick the closest by mid-line.
      let best = paras[0];
      let bestDist = Infinity;
      for (const p of paras) {
        const mid = (p.startLine + p.endLine) / 2;
        const d = Math.abs(mid - cursorLine);
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return best.uuid;
    } catch {
      return null;
    }
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

  function pushTipTapSelectionToCode() {
    tipTapToCodeSelRaf = null;
    if (disposed) return;
    if (selectionSyncing) return;
    const uuid = getTipTapActiveUuid();
    if (!uuid) return;
    try {
      const text = view.state.doc.toString();
      const paras = findParagraphUuids(text);
      const found = paras.find((p) => p.uuid === uuid);
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
    codeToTipTapSelRaf = null;
    if (disposed) return;
    if (selectionSyncing) return;
    const uuid = getCmActiveParagraphUuid();
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
    } finally {
      selectionSyncing = null;
    }
  }

  function scheduleTipTapSelectionToCode() {
    if (tipTapToCodeSelRaf !== null) return;
    tipTapToCodeSelRaf = requestAnimationFrame(pushTipTapSelectionToCode);
  }
  function scheduleCodeSelectionToTipTap() {
    if (codeToTipTapSelRaf !== null) return;
    codeToTipTapSelRaf = requestAnimationFrame(pushCodeSelectionToTipTap);
  }

  const tipTapSelectionHandler = () => {
    if (disposed) return;
    if (selectionSyncing) return;
    scheduleTipTapSelectionToCode();
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
      if (tipTapToCodeSelRaf !== null) {
        cancelAnimationFrame(tipTapToCodeSelRaf);
        tipTapToCodeSelRaf = null;
      }
      if (codeToTipTapSelRaf !== null) {
        cancelAnimationFrame(codeToTipTapSelRaf);
        codeToTipTapSelRaf = null;
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
      // Selection-only updates also drive the paragraph cursor sync.
      if (u.selectionSet && !selectionSyncing) {
        scheduleCodeSelectionToTipTap();
      }
    },
    getPreamble() {
      return preamble;
    },
  };
}
