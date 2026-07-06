"use client";

/**
 * Per-doc diagnostics apparatus (P5 item 4).
 *
 * Owns the ENTIRE lint/error surface for one doc: the lint pass, the lint+compile
 * merge, error-card session state (selection / dismissal / expansion), the derived
 * `error.id → paragraph-uuid` and `error.id → snippet` maps, the highlight-range
 * computer, and the visual jump. Previously all of this lived in `EditorLayout` —
 * the shell that does NOT remount per doc — which caused (a) diagnostics to be
 * empty until the code view was opened once (their source was the code mirror),
 * (b) a cross-doc dismissal leak, and (c) stale lint after a doc switch. Hosting
 * it here (mounted once in the per-doc `EditorPane`) fixes all three by
 * construction: state resets on the `key={slotDocId}` remount, and the source is
 * the doc-agnostic `sourceText` (see `useLatexSource`).
 *
 * The lint+compile MERGE is now LOCAL: compile already lives in `EditorPane`, so
 * merging its errors with lint here kills the previous round-trip (compile up →
 * shell merge → back down). Likewise the `search ?? error` highlight merge becomes
 * fully local (search already originates in `EditorPane`).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { RefObject } from "react";
import type { Editor } from "@tiptap/react";
import { useLatexLint } from "@/hooks/useLatexLint";
import { mergeLatexErrors, type LatexError } from "@/lib/latex-errors";
import { findParagraphUuids, paragraphForLine } from "@/lib/latex-paragraph-map";
import { pruneExpanded } from "@/panels/Errors/expansion";
import { pruneDismissed } from "@/lib/diagnostics-store";

// Shared frozen empties so the derived maps + the merged-error array keep a
// STABLE identity whenever they're semantically empty. `sourceText` re-serializes
// on every typing pause (~300ms), so returning a fresh `new Map()`/`[]` from the
// zero-error path would re-identify these on a timer → re-fire the useDiagnostics
// return memo → re-fire EditorPane's paneState bubble → pulse a shell re-render
// while typing with nothing to show. The frozen singletons let all of that bail.
const EMPTY_STRING_MAP: Map<string, string> = new Map();
const EMPTY_ERRORS: LatexError[] = [];

/** Minimal structural view of the editor handle the diagnostics need. The
 *  `EditorPane` inner handle (`EditorHandle`) satisfies this. */
export interface DiagnosticsEditorHandle {
  getEditor(): Editor | null;
  scrollToParagraphId(paragraphId: string): void;
}

export interface Range {
  from: number;
  to: number;
}

export interface UseDiagnosticsOptions {
  /** Reactive editor instance — an effect dep so highlight recomputes once the
   *  editor mounts / remounts on doc switch. */
  editor: Editor | null;
  /** Ref to the imperative editor handle (getEditor / scrollToParagraphId). */
  editorHandleRef: RefObject<DiagnosticsEditorHandle | null>;
  /** Doc-agnostic serialized LaTeX (from `useLatexSource`). Null → lint inert. */
  sourceText: string | null;
  /** Compile errors from the local compile hook — merged with lint here. */
  compileErrors: readonly LatexError[];
  /** Bib keys known to the project (enables `\cite{}`→undefined-key flagging). */
  knownBibKeys: readonly string[];
}

export interface UseDiagnostics {
  allLatexErrors: LatexError[];
  selectedErrorId: string | null;
  setSelectedErrorId: (id: string | null) => void;
  dismissedErrorIds: Set<string>;
  dismissError: (id: string) => void;
  expandedErrorIds: Set<string>;
  expandError: (id: string) => void;
  toggleErrorExpanded: (id: string) => void;
  errorSnippets: Map<string, string>;
  paragraphByErrorId: Map<string, string>;
  computeErrorHighlightRange: (err: LatexError) => Range | null;
  /** The error-highlight range. `EditorPane` merges this with its local
   *  `searchHighlightRange` (search wins) at the editor-overlay render site. */
  errorHighlightRange: Range | null;
  /** Visual-editor jump: select + highlight + scroll (with a warm-mount retry so
   *  it also serves the pdf→visual escape when the shell flips out of PDF view). */
  jumpToErrorVisual: (err: LatexError) => void;
}

export function useDiagnostics({
  editor,
  editorHandleRef,
  sourceText,
  compileErrors,
  knownBibKeys,
}: UseDiagnosticsOptions): UseDiagnostics {
  const lintErrors = useLatexLint({ text: sourceText, knownBibKeys });

  const allLatexErrors = useMemo<LatexError[]>(() => {
    const merged = mergeLatexErrors(lintErrors, compileErrors as LatexError[]);
    // Stable identity when empty (EMPTY_ERRORS): the merge always returns a fresh
    // array, and lint re-runs on every sourceText change — without this, the
    // no-errors steady state would re-identify `allLatexErrors` on a timer.
    return merged.length === 0 ? EMPTY_ERRORS : merged;
  }, [lintErrors, compileErrors]);

  // ── Error-card session state ────────────────────────────────────────────
  const [selectedErrorId, setSelectedErrorId] = useState<string | null>(null);
  const [dismissedErrorIds, setDismissedErrorIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [errorHighlightRange, setErrorHighlightRange] = useState<Range | null>(
    null,
  );
  // Since the diagnostics unification this is the SINGLE expansion set for every
  // error surface (docked panel + omni mirror + margin + the shell's code-view
  // sidebar, which reads it via paneState). One owner, one list.
  const [expandedErrorIds, setExpandedErrorIds] = useState<Set<string>>(
    () => new Set(),
  );

  const expandError = useCallback((id: string) => {
    setExpandedErrorIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);
  const toggleErrorExpanded = useCallback((id: string) => {
    setExpandedErrorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const dismissError = useCallback((id: string) => {
    setDismissedErrorIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    setSelectedErrorId((cur) => (cur === id ? null : cur));
    // Prune the dismissed card's expansion alongside.
    setExpandedErrorIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Prune dead expansion ids when the error list changes. `pruneExpanded` is
  // identity-stable and no-ops on an empty list (a transient mid-compile empty
  // list must not wipe expansion).
  useEffect(() => {
    setExpandedErrorIds((prev) =>
      pruneExpanded(prev, allLatexErrors.map((e) => e.id)),
    );
  }, [allLatexErrors]);

  // Prune dead DISMISSAL ids when the error list changes (P5). Ids regenerate
  // across runs (per-run salt), so a stale dismissal would otherwise linger
  // forever and could hide a different card; pruning against the live set also
  // re-surfaces a genuinely recurring error. Empty-list guarded — `pruneDismissed`
  // has no built-in guard (unlike `pruneExpanded`), so a transient mid-compile
  // empty list must not wipe every session dismissal.
  useEffect(() => {
    const liveIds = allLatexErrors.map((e) => e.id);
    if (liveIds.length === 0) return;
    setDismissedErrorIds((prev) => pruneDismissed(prev, liveIds));
  }, [allLatexErrors]);

  // ── Derived maps (relocated verbatim; codeEditorText → sourceText) ───────
  const paragraphByErrorId = useMemo(() => {
    // Skip the O(doc) findParagraphUuids scan + return a stable empty when there
    // is nothing to map (the common no-errors steady state), so sourceText churn
    // doesn't re-identify this map on a timer.
    if (allLatexErrors.length === 0 || !sourceText) return EMPTY_STRING_MAP;
    const ranges = findParagraphUuids(sourceText);
    if (ranges.length === 0) return EMPTY_STRING_MAP;
    const m = new Map<string, string>();
    for (const err of allLatexErrors) {
      const uuid = paragraphForLine(ranges, err.line);
      if (uuid) m.set(err.id, uuid);
    }
    return m.size === 0 ? EMPTY_STRING_MAP : m;
  }, [sourceText, allLatexErrors]);

  const errorSnippets = useMemo(() => {
    if (allLatexErrors.length === 0 || !sourceText) return EMPTY_STRING_MAP;
    const lines = sourceText.split("\n");
    const m = new Map<string, string>();
    for (const err of allLatexErrors) {
      if (err.line <= 0 || err.line > lines.length) continue;
      const raw = lines[err.line - 1].trim();
      if (!raw) continue;
      m.set(err.id, raw.length > 140 ? raw.slice(0, 140) + "…" : raw);
    }
    return m.size === 0 ? EMPTY_STRING_MAP : m;
  }, [sourceText, allLatexErrors]);

  // Compute the rich-text range to highlight for an error:
  //   1. If `err.detail` (the offending key) appears as plain text, pin there.
  //   2. Else scope to the error's paragraph via its UUID.
  //   3. Else null.
  const computeErrorHighlightRange = useCallback(
    (err: LatexError): Range | null => {
      const ed = editorHandleRef.current?.getEditor();
      if (!ed) return null;

      if (err.detail) {
        let hit: Range | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (hit) return false;
          if (!node.isText || !node.text) return true;
          const i = node.text.indexOf(err.detail!);
          if (i !== -1) {
            hit = { from: pos + i, to: pos + i + err.detail!.length };
            return false;
          }
          return true;
        });
        if (hit) return hit;
      }

      const paraId = paragraphByErrorId.get(err.id);
      if (paraId) {
        let paraFrom: number | null = null;
        let paraTo: number | null = null;
        ed.state.doc.descendants((node, pos) => {
          if (paraFrom !== null) return false;
          if (node.attrs?.uuid === paraId) {
            paraFrom = pos + 1;
            paraTo = pos + node.nodeSize - 1;
            return false;
          }
          return true;
        });
        if (paraFrom !== null && paraTo !== null) {
          return { from: paraFrom, to: paraTo };
        }
      }

      return null;
    },
    [paragraphByErrorId, editorHandleRef],
  );

  // Keep the error-highlight range in sync with the current selection. Runs when
  // the selection, the error list, or the editor mount state changes.
  useEffect(() => {
    if (!selectedErrorId) {
      setErrorHighlightRange(null);
      return;
    }
    const err = allLatexErrors.find((e) => e.id === selectedErrorId);
    setErrorHighlightRange(err ? computeErrorHighlightRange(err) : null);
  }, [selectedErrorId, allLatexErrors, computeErrorHighlightRange, editor]);

  // Visual-editor jump: select + highlight + scroll. The immediate + 200/500ms
  // retries absorb the old cross-mode pending-scroll drain effect — under the
  // multi-doc keep-alive the visual editor is warm-mounted, so a jump issued
  // right after the shell flips out of PDF view lands once layout settles.
  const jumpToErrorVisual = useCallback(
    (err: LatexError) => {
      setSelectedErrorId(err.id);
      setErrorHighlightRange(computeErrorHighlightRange(err));
      const paraId = paragraphByErrorId.get(err.id);
      if (!paraId) return;
      const doScroll = () => {
        try {
          editorHandleRef.current?.scrollToParagraphId(paraId);
        } catch {
          /* ignore — scroll is best-effort */
        }
      };
      doScroll();
      setTimeout(doScroll, 200);
      setTimeout(doScroll, 500);
    },
    [computeErrorHighlightRange, paragraphByErrorId, editorHandleRef],
  );

  // Stable identity across no-op renders (hook-return-stability guard): EditorPane
  // is `React.memo`'d and keep-alive, so a bare-literal return would re-identify
  // every render and inflate warm paper-switch cost. A fresh object only when a
  // member actually changes.
  return useMemo(
    () => ({
      allLatexErrors,
      selectedErrorId,
      setSelectedErrorId,
      dismissedErrorIds,
      dismissError,
      expandedErrorIds,
      expandError,
      toggleErrorExpanded,
      errorSnippets,
      paragraphByErrorId,
      computeErrorHighlightRange,
      errorHighlightRange,
      jumpToErrorVisual,
    }),
    [
      allLatexErrors,
      selectedErrorId,
      setSelectedErrorId,
      dismissedErrorIds,
      dismissError,
      expandedErrorIds,
      expandError,
      toggleErrorExpanded,
      errorSnippets,
      paragraphByErrorId,
      computeErrorHighlightRange,
      errorHighlightRange,
      jumpToErrorVisual,
    ],
  );
}

// ── Distribution (context) ─────────────────────────────────────────────────
// Now that the single per-doc owner is LOCAL to `EditorPane` (`useDiagnostics`
// mounts there), the error surfaces read the bundle from context instead of an
// ~11-prop fan-out hand-threaded through every rail call site. `EditorPane`
// wraps its render subtree in `DiagnosticsProvider value={diagnostics}` (the
// bundle is already an identity-stable `useMemo`, so the Provider value only
// re-identifies when a member actually changes — the keep-alive/memo contract
// holds), and the rail sub-components (`PaneRail` → `OmniHost`, `PaneRailBody`
// → `ErrorsHost`) consume it via `useDiagnosticsContext()`. The upward
// `paneState` bubble to the shell's code-view Errors sidebar is unchanged — it
// still reads the same owner's state, so selection/dismissal/expansion stays
// one set across all surfaces.
const DiagnosticsContext = createContext<UseDiagnostics | null>(null);

export const DiagnosticsProvider = DiagnosticsContext.Provider;

export function useDiagnosticsContext(): UseDiagnostics {
  const ctx = useContext(DiagnosticsContext);
  if (ctx === null) {
    throw new Error(
      "useDiagnosticsContext must be used within a <DiagnosticsProvider>",
    );
  }
  return ctx;
}
