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
 *   keystroke     → timer reset. Nothing else.
 *   Tier A 300ms  → docJson (per-block json refs; identity-preserved when
 *                   nothing changed) — the outline / latestDoc snapshot.
 *   Tier B idle   → sourceText (per-block latex + assembleLatex tails) +
 *                   wordCounts — via requestLowPriority, off the
 *                   interactive path.
 *   Tier C        → unchanged owners: useLatexLint keys off sourceText
 *                   identity; autosave calls ensureFresh() at its own fire.
 *
 * FRESHNESS IS PER-TIER AND PER-INPUT (task 592). It used to be one boolean
 * (`dirty`) over one input (a transaction), which could not say "Tier A is
 * current but Tier B is not" and could not see any serialize input that is
 * not an edit. Two things followed: `ensureFresh()` had no choice but to redo
 * EVERYTHING — so the four save-path doors dragged the idle tier's two
 * whole-doc walks onto the 1500 ms autosave, twice per typing pause, for a
 * product not one of them reads — and a `bibFamily` switch, which fires no
 * transaction yet can shift every body line, re-derived nothing at all.
 *
 * Now each tier records what it last ran against — `tierADoc`, `countsDoc`,
 * and `sourceFresh` (doc + preamble + postamble + bibFamily) — and staleness
 * is the comparison. `ensureFresh()` refreshes TIER A ONLY (the one product
 * its callers read) and merely RE-ARMS a stale Tier B; every input that
 * changes without an edit re-arms through the ONE `revalidate()` door.
 *
 * The pipeline also owns the preamble/postamble lifecycle formerly in
 * useLatexSource (disk read at attach, TEX_DELIMITERS_CHANGED re-read,
 * line-number-parity gate) and the code-view mutual exclusion: while the
 * code view is active it feeds `setExternalSourceFeed` with raw CodeMirror
 * text and the pipeline's own serialize is suppressed — byte-preserving
 * useLatexSource's contract.
 *
 * KEYSTROKE SANCTITY: the `editor.on('update')` handler below is O(1) per
 * transaction (one timer reset). Every O(doc)/O(changed)
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
  /** Keep-alive gate: hidden panes stay stale but schedule nothing — the
   *  visible edge calls `revalidate()` and they converge there. */
  isVisible: () => boolean;
  /** Tier A debounce. Default 300 ms. */
  interactiveMs?: number;
}

export type ProductsTier = "interactive" | "idle";

export interface DocProducts {
  snapshot(): ProductsSnapshot;
  /** Synchronous refresh-now for the save path (autosave, flushNow, the
   *  paused-autosave capture, flushAnchorCommit). Refreshes TIER A ONLY —
   *  `.docJson` is the one product all four callers read — and re-arms the
   *  idle tier if it has gone stale, never running it inline (task 592).
   *  EXACT OR NOTHING: if Tier A cannot produce an exact snapshot the
   *  returned `docJson` is null, so the caller takes its documented
   *  `?? editor.getJSON()` fallback and writes the LIVE document rather
   *  than a stale projection. */
  ensureFresh(): ProductsSnapshot;
  /** The ONE door for an input that changed without an editor transaction —
   *  a bibFamily switch, a preamble re-read, a hidden pane becoming visible
   *  again. Re-checks every tier's recorded inputs and schedules whatever has
   *  gone stale. Cheap and idempotent: a no-op when nothing moved. */
  revalidate(): void;
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelIdle: (() => void) | null = null;

  // ── The freshness record (task 592) ───────────────────────────────────
  // What each tier last ran against. A tier is stale iff its record differs
  // from the live inputs — there is no flag, so no door can be wrong about
  // WHICH tier needs work, and an input that fires no transaction (bibFamily)
  // is as visible as one that does.
  /** The PM doc `docJson` was last built from. */
  let tierADoc: unknown = null;
  /** The PM doc the word counts were last computed from. */
  let countsDoc: unknown = null;
  /** Every input `sourceText` was last serialized from. Null = never, or the
   *  code view took the feed (setExternalSourceFeed). */
  let sourceFresh: {
    doc: unknown;
    preamble: string | undefined;
    postamble: string | undefined;
    bibFamily: BibFamily | null;
  } | null = null;

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

  /** Returns whether `snapshot.docJson` is now an EXACT projection of the
   *  live doc. False means the json walk refused — the save path must fall
   *  back to the editor, never persist the previous projection. */
  function runTierA(): boolean {
    if (destroyed) return false;
    const t0 = performance.now();
    pipelineStats.tierARuns++;
    const doc = editor.state.doc;
    let docJson: JSONContent;
    try {
      docJson = refreshDocJson();
    } catch {
      pipelineStats.lastTierAMs = performance.now() - t0;
      return false;
    }
    tierADoc = doc;
    if (docJson !== snapshot.docJson) publish({ docJson });
    pipelineStats.lastTierAMs = performance.now() - t0;
    return true;
  }

  /** `built` = a fresh `.tex`; `refused` = the serializer would not express a
   *  node, so the honest answer is the last good text (and the inputs ARE
   *  recorded — retrying the same doc would refuse identically); `not-ready` =
   *  the preamble has not resolved, so nothing may be recorded. */
  type SourceBuild =
    | { state: "built"; text: string }
    | { state: "refused" }
    | { state: "not-ready" };

  function buildSourceText(bibFamily: BibFamily | null): SourceBuild {
    if (!preambleReady) return { state: "not-ready" };
    const doc = editor.state.doc;
    const parts = [];
    try {
      for (let i = 0; i < doc.childCount; i++) parts.push(getBlockLatex(doc.child(i)));
    } catch {
      // FAIL OPEN (task 357). The serializer now REFUSES a node it cannot
      // express rather than emitting the document without it. This tier is a
      // read-only projection running on an idle callback, so the honest answer
      // is the LAST GOOD text — never a shorter one, and never an exception
      // escaping into `requestIdleCallback`. The write-side gate is where a
      // refusal is published and the user is told.
      return { state: "refused" };
    }
    pipelineStats.assemblies++;
    return {
      state: "built",
      text: assembleLatex(parts, collectPreambleTitleFields(refreshDocJson()), {
        preamble,
        postamble,
        bibFamily,
      }),
    };
  }

  /** Is any Tier B product out of date with respect to its own inputs? The
   *  source half is only ever asked while the pipeline actually owns the feed
   *  — a suppressed (code-view-fed) source is not stale, it is not ours. */
  function isTierBStale(): boolean {
    const doc = editor.state.doc;
    if (countsDoc !== doc) return true;
    if (config.isSuppressed()) return false;
    return (
      sourceFresh === null ||
      sourceFresh.doc !== doc ||
      sourceFresh.preamble !== preamble ||
      sourceFresh.postamble !== postamble ||
      sourceFresh.bibFamily !== (config.getBibFamily() ?? null)
    );
  }

  function runTierB() {
    if (destroyed) return;
    const t0 = performance.now();
    pipelineStats.tierBRuns++;
    const next: Partial<ProductsSnapshot> = {};
    const doc = editor.state.doc;
    // PER-PRODUCT TRY (task 592). `buildSourceText` fails open around the
    // per-block loop only; `assembleLatex` (requirements pass,
    // reconcileBibFamily, collapseBlankRuns) and `computeCategoryCounts` threw
    // clean past it — out of the idle callback and, through the old
    // ensureFresh, into the autosave. This is a read-only projection: it may
    // degrade, it may never escape, and one product's refusal may not take the
    // others down with it.
    try {
      // sourceText: suppressed while the code view owns the feed. A visual
      // edit reaching here means the code view is closed (or never opened),
      // so the pipeline reclaims the feed — clearing the external latch.
      if (!config.isSuppressed()) {
        const bibFamily = config.getBibFamily() ?? null;
        const built = buildSourceText(bibFamily);
        if (built.state !== "not-ready") {
          sourceFresh = { doc, preamble, postamble, bibFamily };
        }
        if (built.state === "built" && built.text !== snapshot.sourceText) {
          externalFed = false;
          next.sourceText = built.text;
        }
      }
    } catch {
      /* source degraded to the last good text — see above. */
    }
    try {
      const docJson = refreshDocJson();
      tierADoc = doc;
      if (docJson !== snapshot.docJson) next.docJson = docJson;
      if (docJson) {
        next.wordCounts = computeCategoryCounts(docJson);
        countsDoc = doc;
      }
    } catch {
      /* counts degraded to the last good tally — see above. */
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

  /** Bring Tier A to the live doc and RE-ARM (never run inline) a stale
   *  Tier B. Returns whether `docJson` is exact. The single body behind the
   *  debounce boundary, `ensureFresh` and `revalidate` — so all three agree
   *  about which tier is stale and where each tier is allowed to run. */
  function catchUp(): boolean {
    let exact = true;
    if (tierADoc !== editor.state.doc) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      exact = runTierA();
    }
    if (config.isVisible() && isTierBStale()) scheduleTierB();
    return exact;
  }

  function revalidate() {
    // A hidden pane stays inert; the visible edge calls this again.
    if (destroyed || !config.isVisible()) return;
    catchUp();
  }

  const onUpdate = () => {
    // KEYSTROKE PATH: timer reset only. Staleness is no longer a flag — it is
    // the comparison of each tier's recorded inputs against the live ones —
    // so this handler writes nothing at all beyond the debounce.
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (destroyed) return;
      if (!config.isVisible()) return; // hidden pane: stays stale, inert
      catchUp();
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
        // The preamble/postamble ARE Tier B inputs, and the record says so —
        // so this door no longer decides for itself what has gone stale.
        revalidate();
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
      // TIER A ONLY (task 592). All four callers read `.docJson` and nothing
      // else, and Tier B's two whole-doc walks belong on the idle callback the
      // tier header promises — not inline on the 1500 ms save timer, where
      // they ran a second time per pause and where a projection failure
      // aborted the write with the debounce already disarmed.
      const exact = catchUp();
      // EXACT OR NOTHING: hand the save path the live projection or null,
      // never the previous one.
      return exact ? snapshot : { ...snapshot, docJson: null };
    },
    revalidate,
    setExternalSourceFeed(text: string) {
      externalFed = true;
      // The code view owns the feed now, so whatever the pipeline last
      // serialized no longer describes `snapshot.sourceText`: the source half
      // of the idle tier is stale by construction, and stays stale until the
      // pipeline reclaims the feed.
      sourceFresh = null;
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
