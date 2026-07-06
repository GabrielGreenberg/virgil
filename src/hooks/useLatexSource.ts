"use client";

/**
 * Per-doc LaTeX source feed for diagnostics (lint / snippets / paragraph maps).
 *
 * THE DEEP FIX (P5 item 4): diagnostics used to derive from `codeEditorText`, a
 * mirror of the CodeMirror pane that is `null` until the code view is opened
 * once — so lint / error snippets / jump anchors were silently empty for a user
 * working only in the visual editor. This hook makes the source doc-agnostic: it
 * serializes the LIVE TipTap doc to `.tex` on a debounced tick, independent of
 * whether the code pane is mounted. TipTap is canonical; the code view is just
 * another editor that syncs back INTO TipTap.
 *
 * Line-number parity: the serialize mirrors what the compiler + code pane
 * produce so `err.line` maps to the right paragraph/snippet. That means the SAME
 * `serializeToLatex` with (a) the same disk preamble/postamble and (b) the same
 * authoritative `bibFamily` the disk-save/compile path uses — because
 * `bibFamily` can INJECT a `\usepackage{natbib|biblatex}` into the preamble
 * (`reconcileBibFamily`) and shift every body line. `onRequirementConflict` is
 * intentionally omitted (it's a warn-only notice the save path already surfaces;
 * firing it on every debounced serialize would double-notify).
 *
 * Keystroke sanctity: the `editor.on('update')` subscriber below is O(1) per
 * transaction (it only resets a debounce timer). The O(doc-size) serialize runs
 * inside the debounced callback, off the keystroke path. This file is therefore
 * a PERMITTED_KEYSTROKE_SUBSCRIBER — see
 * `src/lib/__tests__/keystroke-subscriber-guardrail.test.ts` + AGENTS.md.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { readTex } from "@/lib/storage";
import { serializeToLatex } from "@/lib/latex-serializer";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import type { BibFamily } from "@/lib/bib-family";
import {
  TEX_DELIMITERS_CHANGED_EVENT,
  type TexDelimitersChangedDetail,
} from "@/lib/tex-delimiters-event";

export interface UseLatexSourceOptions {
  /** The live TipTap editor for the active doc. Null before it mounts. */
  editor: Editor | null;
  /** The doc whose on-disk preamble/postamble frame the serialized source. */
  docId: string;
  /**
   * True while the code view is mounted. When true this hook SUPPRESSES its own
   * ongoing serialize-on-update — CodeEditor's `onTextChange` feeds
   * `setSourceText` with the raw CodeMirror text (the freshest source while the
   * user edits code), avoiding a double-feed race.
   */
  codeViewActive: boolean;
  /**
   * Getter for the authoritative per-doc bib family, threaded into the serialize
   * so `sourceText` matches the compiler's / code-pane's bibFamily-aware
   * serialization (line-number parity — see the module docstring). A GETTER, not
   * a value, so the debounced serialize always reads the CURRENT family (the user
   * may change `bibPackage`) without re-subscribing. Omit → body-derived family.
   */
  getBibFamily?: () => BibFamily | null;
  /** Serialize debounce (ms). Default 300 — the expensive lint pass is gated by
   *  `useLatexLint`'s own 1500 ms debounce downstream, so this stays short. */
  debounceMs?: number;
}

export interface UseLatexSource {
  /** Serialized LaTeX of the live doc (preamble + body + postamble), or `null`
   *  before the editor mounts / the preamble resolves. Fed to `useLatexLint`
   *  and the snippet / paragraph-map derivations. */
  sourceText: string | null;
  /** Imperative override so the code view (CodeEditor.onTextChange) can feed its
   *  raw CodeMirror text while mounted. Equality-bailed; also marks that an
   *  external feeder has taken over (so the mount seed defers to it). */
  setSourceText: (text: string) => void;
}

/**
 * Own the per-doc `sourceText`. One instance per open doc inside `EditorPane`
 * (which is remounted per doc via the `<DocPipeline key={slotDocId}>` boundary),
 * so `sourceText` resets automatically on doc switch — no cross-doc staleness.
 */
export function useLatexSource({
  editor,
  docId,
  codeViewActive,
  getBibFamily,
  debounceMs = 300,
}: UseLatexSourceOptions): UseLatexSource {
  const [sourceText, setSourceTextState] = useState<string | null>(null);

  const preambleRef = useRef<string | undefined>(undefined);
  const postambleRef = useRef<string | undefined>(undefined);
  // Gate the first serialize on the preamble being resolved — else a
  // DEFAULT_PREAMBLE serialize would shift every line number vs. the compile
  // log / snippets (line-number parity).
  const preambleReadyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read at fire time so a code-view toggle never re-subscribes the listener.
  const codeViewActiveRef = useRef(codeViewActive);
  codeViewActiveRef.current = codeViewActive;
  // Read the bib family at serialize time (reactive without re-subscribing).
  const getBibFamilyRef = useRef(getBibFamily);
  getBibFamilyRef.current = getBibFamily;
  // Whether an external feeder (the code view) has fed us at least once. Gates
  // the ONE-TIME mount seed: if the code view already fed, the seed defers to it
  // (never overwrites the fresher raw code text); otherwise the pane self-seeds
  // from TipTap so `sourceText` is never left null on a code-view-open cold open
  // (the bubble-not-ready race). After mount this ref is inert.
  const hasExternalFeedRef = useRef(false);

  // Internal commit — equality-bailed, does NOT flip the external-feed flag.
  const commitSourceText = useCallback((text: string) => {
    setSourceTextState((prev) => (prev === text ? prev : text));
  }, []);

  const setSourceText = useCallback(
    (text: string) => {
      hasExternalFeedRef.current = true;
      commitSourceText(text);
    },
    [commitSourceText],
  );

  const serializeNow = useCallback(() => {
    if (!editor) return;
    try {
      const latex = serializeToLatex(editor.getJSON(), {
        preamble: preambleRef.current,
        postamble: postambleRef.current,
        bibFamily: getBibFamilyRef.current?.() ?? null,
      });
      commitSourceText(latex);
    } catch {
      /* serializeToLatex should never throw in normal use; skip this tick */
    }
  }, [editor, commitSourceText]);

  // Read preamble/postamble from disk on load, then seed `sourceText` once
  // resolved. Mirrors CodeEditor.tsx:168-193 — the body comes from live TipTap,
  // the preamble/postamble from disk so line numbers align with compile/lint.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    preambleReadyRef.current = false;
    readTex(docId)
      .then((diskText) => {
        if (cancelled) return;
        const extracted = extractPreambleAndPostamble(diskText);
        preambleRef.current = extracted?.preamble;
        postambleRef.current = extracted?.postamble;
        preambleReadyRef.current = true;
        // Initial population: gate on the reactive `editor` being ready (the
        // structural-revision counters are silent on load — AGENTS "Initial
        // population"). Skip ONLY if the code view already fed us (defer to the
        // fresher raw code text); otherwise self-seed even with code view open,
        // so a cold open never leaves diagnostics empty.
        if (!hasExternalFeedRef.current) serializeNow();
      })
      .catch(() => {
        if (cancelled) return;
        // Disk read failed — fall back to a default-preamble serialize so lint
        // still runs on load (matches CodeEditor's catch at :183-189).
        preambleRef.current = undefined;
        postambleRef.current = undefined;
        preambleReadyRef.current = true;
        if (!hasExternalFeedRef.current) serializeNow();
      });
    return () => {
      cancelled = true;
    };
  }, [docId, editor, serializeNow]);

  // Refresh preamble/postamble on a style switch / external reload — mirrors
  // CodeEditor.tsx:294-309. Re-serialize so the source reflects the new preamble
  // (keeps line-number parity after the delimiters change). Skip while the code
  // view is the active feeder (CodeEditor re-reads the delimiters itself).
  useEffect(() => {
    const onDelimitersChanged = (e: Event) => {
      const detail = (e as CustomEvent<TexDelimitersChangedDetail>).detail;
      if (!detail || detail.docId !== docId) return;
      readTex(docId)
        .then((diskText) => {
          const extracted = extractPreambleAndPostamble(diskText);
          if (!extracted) return;
          preambleRef.current = extracted.preamble;
          postambleRef.current = extracted.postamble;
          if (!codeViewActiveRef.current) serializeNow();
        })
        .catch(() => {
          /* disk read best-effort — keep the current preamble */
        });
    };
    window.addEventListener(TEX_DELIMITERS_CHANGED_EVENT, onDelimitersChanged);
    return () =>
      window.removeEventListener(TEX_DELIMITERS_CHANGED_EVENT, onDelimitersChanged);
  }, [docId, serializeNow]);

  // Debounced serialize-on-update. KEYSTROKE SANCTITY: the handler only resets a
  // timer (O(1)); the O(doc) serialize fires after the lull, off the keystroke
  // path. Suppressed while the code view feeds `setSourceText` directly. When the
  // code view CLOSES, `sourceText` retains the last raw code text (the freshest)
  // and the next visual edit re-serializes — no explicit close-reseed needed (a
  // reseed here would overwrite fresh code text with a possibly-stale TipTap doc
  // if a code edit is still in the bridge's sync debounce).
  useEffect(() => {
    if (!editor) return;
    const onUpdate = () => {
      if (codeViewActiveRef.current) return; // code view owns the feed
      if (!preambleReadyRef.current) return; // wait for preamble (parity)
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(serializeNow, debounceMs);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [editor, debounceMs, serializeNow]);

  // Stable identity across no-op renders (hook-return-stability guard) — a fresh
  // object only when `sourceText` actually changes.
  return useMemo(() => ({ sourceText, setSourceText }), [sourceText, setSourceText]);
}
