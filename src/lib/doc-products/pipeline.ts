/**
 * DocProducts — the per-doc derived-products pipeline (perf plan Wave 1 / P2).
 *
 * THE problem this solves: at every ≥300 ms typing pause, four independent
 * `editor.on('update')` subscribers each deep-copied the whole doc
 * (useLatexSource serialize 78.6 ms + useWordCount 47.7 ms + EditorPane
 * outline snapshot + EditorLayout latestDoc, measured at 2,883 blocks) in
 * the same wakeup — a ~220 ms main-thread hitch exactly when the user
 * resumes typing (MEMO_PERF_DEEP_RESEARCH_2026_08_08.md §3).
 *
 * Now ONE subscriber owns the debounce and every product derives from ONE
 * shared per-block cache (PM-node-identity WeakMaps — the miss IS the
 * diff, see block-caches.ts):
 *
 *   keystroke     → timer reset + dirty flag. Nothing else.
 *   Tier A 300ms  → docJson (per-block json refs; identity-preserved when
 *                   nothing changed) — the outline / latestDoc snapshot.
 *   Tier B idle   → sourceText (per-block latex + assembleLatex tails) +
 *                   wordCounts — via requestLowPriority, off the
 *                   interactive path.
 *   Tier C        → unchanged owners: useLatexLint keys off sourceText
 *                   identity; autosave calls ensureFresh() at its own fire.
 *
 * The pipeline also owns the preamble/postamble lifecycle formerly in
 * useLatexSource (disk read at attach, TEX_DELIMITERS_CHANGED re-read,
 * line-number-parity gate) and the code-view mutual exclusion: while the
 * code view is active it feeds `setExternalSourceFeed` with raw CodeMirror
 * text and the pipeline's own serialize is suppressed — byte-preserving
 * useLatexSource's contract.
 *
 * KEYSTROKE SANCTITY: the `editor.on('update')` handler below is O(1) per
 * transaction (dirty flag + one timer reset). Every O(doc)/O(changed)
 * product refresh runs in Tier A/B callbacks, off the keystroke path. This
 * file is a PERMITTED_KEYSTROKE_SUBSCRIBER — see
 * `src/lib/__tests__/keystroke-subscriber-guardrail.test.ts` + AGENTS.md.
 */

import type { Editor, JSONContent } from "@tiptap/react";
import {
  assembleLatex,
  collectPreambleTitleFields,
  type AssembleLatexOptions,
} from "@/lib/latex-serializer";
import { computeCategoryCounts, type CategoryCounts } from "@/lib/word-count-core";
import { readTex } from "@/lib/storage";
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import type { BibFamily } from "@/lib/bib-family";
import {
  TEX_DELIMITERS_CHANGED_EVENT,
  type TexDelimitersChangedDetail,
} from "@/lib/tex-delimiters-event";
import { requestLowPriority } from "@/lib/keep-alive/schedule-low-priority";
import { getBlockJson, getBlockLatex } from "./block-caches";

export interface ProductsSnapshot {
  /** Bumps on every publish — the cheap staleness compare for consumers. */
  generation: number;
  /** Shared doc snapshot (per-block json refs; unchanged blocks keep their
   *  element identity, and a no-op refresh keeps the WHOLE object identity —
   *  so downstream memos bail exactly like the per-consumer snapshots did). */
  docJson: JSONContent | null;
  /** Serialized `.tex` (disk preamble + body + postamble), or the raw code
   *  text while the code view feeds, or null before the preamble resolves
   *  (line-number-parity gate — same contract as useLatexSource). */
  sourceText: string | null;
  /** Whole-doc per-category tallies (word-count-core). Null until the first
   *  Tier B. Headline numbers are derived through `includedTotals`, never
   *  stored here — see the CategoryCounts doc comment. */
  wordCounts: CategoryCounts | null;
}

export interface DocProductsConfig {
  docId: string;
  /** Read at serialize time (the user may change bibPackage). */
  getBibFamily: () => BibFamily | null;
  /** True while the code view owns the sourceText feed. */
  isSuppressed: () => boolean;
  /** Keep-alive gate: hidden panes mark dirty but schedule nothing. */
  isVisible: () => boolean;
  /** Tier A debounce. Default 300 ms. */
  interactiveMs?: number;
}

export type ProductsTier = "interactive" | "idle";

export interface DocProducts {
  snapshot(): ProductsSnapshot;
  /** Synchronous refresh-now for imperative consumers (autosave, code-view
   *  one-shots). Runs Tier A + Tier B work inline and returns the result. */
  ensureFresh(): ProductsSnapshot;
  /** Code-view feed (raw CodeMirror text) — flips the suppression latch the
   *  same way useLatexSource.setSourceText did. */
  setExternalSourceFeed(text: string): void;
  /** Assemble a full `.tex` with the CALLER's delimiters/family through the
   *  shared per-block caches — the code-pane bridge's 150 ms flush, which
   *  must keep its OWN (possibly unsaved) preamble, never the pipeline's
   *  disk-derived one. O(changed blocks) + the joined-string tails. */
  assembleSourceWith(opts: AssembleLatexOptions): string;
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

/** Probe state (read via window.__docProductsStats in probe.ts). */
export const pipelineStats = {
  tierARuns: 0,
  tierBRuns: 0,
  assemblies: 0,
  ensureFreshCalls: 0,
  lastTierAMs: 0,
  lastTierBMs: 0,
};

const registry = new WeakMap<Editor, DocProducts>();

export function getDocProducts(editor: Editor | null): DocProducts | null {
  return editor ? (registry.get(editor) ?? null) : null;
}

export function createDocProducts(
  editor: Editor,
  config: DocProductsConfig,
): DocProducts {
  const interactiveMs = config.interactiveMs ?? 300;

  let snapshot: ProductsSnapshot = {
    generation: 0,
    docJson: null,
    sourceText: null,
    wordCounts: null,
  };
  const subscribers = new Set<() => void>();

  let destroyed = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelIdle: (() => void) | null = null;

  let preamble: string | undefined;
  let postamble: string | undefined;
  let preambleReady = false;
  // Once the code view has fed us raw text, the pipeline's own serialize
  // defers to it until the next visual-editor edit re-serializes (the same
  // hasExternalFeed contract useLatexSource had).
  let externalFed = false;

  function publish(next: Partial<ProductsSnapshot>) {
    snapshot = { ...snapshot, ...next, generation: snapshot.generation + 1 };
    for (const fn of subscribers) fn();
  }

  /** Rebuild the shared docJson from per-block caches. Identity-preserving:
   *  returns the PREVIOUS object when no child reference changed. */
  function refreshDocJson(): JSONContent {
    const doc = editor.state.doc;
    const prev = snapshot.docJson;
    const content: JSONContent[] = new Array(doc.childCount);
    let changed = !prev || (prev.content?.length ?? 0) !== doc.childCount;
    for (let i = 0; i < doc.childCount; i++) {
      const json = getBlockJson(doc.child(i));
      content[i] = json;
      if (!changed && prev!.content![i] !== json) changed = true;
    }
    if (!changed && prev) return prev;
    return { type: "doc", content };
  }

  function runTierA() {
    if (destroyed) return;
    const t0 = performance.now();
    pipelineStats.tierARuns++;
    const docJson = refreshDocJson();
    if (docJson !== snapshot.docJson) publish({ docJson });
    pipelineStats.lastTierAMs = performance.now() - t0;
  }

  function buildSourceText(): string | null {
    if (!preambleReady) return snapshot.sourceText;
    const doc = editor.state.doc;
    const parts = [];
    for (let i = 0; i < doc.childCount; i++) parts.push(getBlockLatex(doc.child(i)));
    pipelineStats.assemblies++;
    return assembleLatex(
      parts,
      collectPreambleTitleFields(refreshDocJson()),
      {
        preamble,
        postamble,
        bibFamily: config.getBibFamily() ?? null,
      },
    );
  }

  function runTierB() {
    if (destroyed) return;
    const t0 = performance.now();
    pipelineStats.tierBRuns++;
    const next: Partial<ProductsSnapshot> = {};
    // sourceText: suppressed while the code view owns the feed. A visual
    // edit reaching here means the code view is closed (or never opened),
    // so the pipeline reclaims the feed — clearing the external latch.
    if (!config.isSuppressed()) {
      const text = buildSourceText();
      if (text !== null && text !== snapshot.sourceText) {
        externalFed = false;
        next.sourceText = text;
      }
    }
    const docJson = refreshDocJson();
    if (docJson !== snapshot.docJson) next.docJson = docJson;
    if (docJson) {
      const wordCounts = computeCategoryCounts(docJson);
      next.wordCounts = wordCounts;
    }
    if (Object.keys(next).length > 0) publish(next);
    pipelineStats.lastTierBMs = performance.now() - t0;
  }

  function scheduleTierB() {
    cancelIdle?.();
    cancelIdle = requestLowPriority(() => {
      cancelIdle = null;
      runTierB();
    });
  }

  const onUpdate = () => {
    // KEYSTROKE PATH: dirty flag + timer reset only.
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!dirty || destroyed) return;
      if (!config.isVisible()) return; // hidden pane: stay dirty, inert
      dirty = false;
      runTierA();
      scheduleTierB();
    }, interactiveMs);
  };
  editor.on("update", onUpdate);

  // ── Preamble/postamble lifecycle (lifted from useLatexSource) ──────────
  let attachCancelled = false;
  readTex(config.docId)
    .then((diskText) => {
      if (attachCancelled || destroyed) return;
      const extracted = extractPreambleAndPostamble(diskText);
      preamble = extracted?.preamble;
      postamble = extracted?.postamble;
      preambleReady = true;
      // Initial population: seed docJson now, products on the idle tier —
      // unless the code view already fed fresher raw text.
      runTierA();
      if (!externalFed) scheduleTierB();
    })
    .catch(() => {
      if (attachCancelled || destroyed) return;
      // Disk read failed — default-preamble serialize so lint still runs
      // (the useLatexSource fallback contract).
      preamble = undefined;
      postamble = undefined;
      preambleReady = true;
      runTierA();
      if (!externalFed) scheduleTierB();
    });

  const onDelimitersChanged = (e: Event) => {
    const detail = (e as CustomEvent<TexDelimitersChangedDetail>).detail;
    if (!detail || detail.docId !== config.docId) return;
    readTex(config.docId)
      .then((diskText) => {
        if (destroyed) return;
        const extracted = extractPreambleAndPostamble(diskText);
        if (!extracted) return;
        preamble = extracted.preamble;
        postamble = extracted.postamble;
        if (!config.isSuppressed()) scheduleTierB();
      })
      .catch(() => {
        /* best-effort — keep the current preamble */
      });
  };
  if (typeof window !== "undefined") {
    window.addEventListener(TEX_DELIMITERS_CHANGED_EVENT, onDelimitersChanged);
  }

  const products: DocProducts = {
    snapshot: () => snapshot,
    ensureFresh() {
      pipelineStats.ensureFreshCalls++;
      if (destroyed) return snapshot;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      cancelIdle?.();
      cancelIdle = null;
      dirty = false;
      runTierA();
      runTierB();
      return snapshot;
    },
    setExternalSourceFeed(text: string) {
      externalFed = true;
      if (text !== snapshot.sourceText) publish({ sourceText: text });
    },
    assembleSourceWith(opts) {
      const doc = editor.state.doc;
      const parts = [];
      for (let i = 0; i < doc.childCount; i++) {
        parts.push(getBlockLatex(doc.child(i)));
      }
      pipelineStats.assemblies++;
      return assembleLatex(
        parts,
        collectPreambleTitleFields(refreshDocJson()),
        opts,
      );
    },
    subscribe(fn: () => void) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    destroy() {
      destroyed = true;
      attachCancelled = true;
      editor.off("update", onUpdate);
      if (typeof window !== "undefined") {
        window.removeEventListener(
          TEX_DELIMITERS_CHANGED_EVENT,
          onDelimitersChanged,
        );
      }
      if (timer) clearTimeout(timer);
      cancelIdle?.();
      cancelIdle = null;
      subscribers.clear();
      if (registry.get(editor) === products) registry.delete(editor);
    },
  };

  registry.set(editor, products);
  return products;
}
