// Keystroke-sanctity permitted-subscriber guardrail (task 044; extended by
// perf Wave 4 P6) — the CI half of the keystroke-sanctity law, the sibling of
// `scroll-reposition-guardrail.test.ts`.
//
// The law (AGENTS.md, "Keystroke sanctity"): no plugin, hook, or React effect
// may do work proportional to document size on each keystroke. Its most direct
// enforcement point is the set of live `editor.on('update'|'transaction')`
// subscribers on the MAIN editor — each must be O(1) per transaction (a
// debounced timer reset, a counter bump, or a RAF-coalesced layout read) or
// O(edit-size) (consuming the DocStructureObserver diff), never an
// `editor.on('update', () => walkWholeDoc())`.
//
//   SOURCE-GREP ALLOWLIST — walk `src/`, collect every file that makes a real
//   `editor.on("update"|"transaction", …)` subscription call (comment/docstring
//   mentions of the doctrine stripped first), and assert the flagged set equals
//   `PERMITTED_KEYSTROKE_SUBSCRIBERS`. A new unlisted subscriber FAILS CI.
//
// The grep is a heuristic — O(1)-ness is semantic, not syntactic — so, exactly
// like the keystroke-sanctity prose list and `PERMITTED_SCROLL_REPOSITIONERS`,
// the allowlist + per-entry justification is what makes it robust: a human
// confirms each listed site is genuinely O(1)/O(edit-size); the test only guards
// against a NEW *unlisted* site appearing.
//
// A JUSTIFICATION MUST DESCRIBE THE CALLBACK, NOT JUST THE GATE. The grep can
// see the `editor.on(...)` call form and the conditionals around it; it cannot
// see the cost of what the handler CALLS. `lib/float-sync.tsx` sat here reading
// "docChanged-gated + own-write meta filter — O(1) per tx" — true of the
// subscriber, silent about the O(doc) `readSource` behind it — so this test was
// green while every main keystroke walked the whole document once per open
// text-object float (task 140). When adding or reviewing an entry, name what
// the handler ultimately runs and why THAT is bounded. The behavioral half of
// that particular fix lives in `float-source-touch-gate.test.tsx`, which counts
// the callback's invocations instead of trusting a sentence. The prose list in
// AGENTS.md and this allowlist are cross-references of the same reality — keep
// them in sync.
//
// COST-CLASS TAGS (Wave-4 P6): every justification MUST begin with a
// `[cost: …]` tag naming the per-event cost of the handler AND the cost class
// of its deferred body ("RAF-coalesced" alone no longer qualifies — a
// RAF-coalesced O(doc) walk is still an O(doc) walk, one frame later; the
// float-sync lesson in tag form). The tag-format test below enforces the
// prefix; the content is human-verified like the rest of the sentence.
//
// SELECTION-UPDATE CENSUS (Wave-4 P6): `editor.on("selectionUpdate", …)` moves
// under the same discipline. Selection moves on EVERY keystroke (the caret
// advances), so an un-deferred non-O(1) selection handler is a keystroke cost
// in all but name — it was simply invisible to the original grep. Same shape:
// its own detector, its own exact-set allowlists per silo, same tag rule.
//
// Scope notes (mirroring task 042's scoping cautions):
//   • Matches ONLY the `.on("…"` call form — the real runtime subscription.
//     This sidesteps `onUpdate:` React callback props on panels, float-body
//     `onUpdate({ editor })` config options (separate bounded float editors),
//     and `onUpdate` TipTap options (the useDocument autosaver subscribes that
//     way and is a prose-only entry). The ONE `<VirgilEditor onUpdate=` JSX
//     mount is pinned by its own census below.
//   • `focus`/`blur` stay ungoverned here (edge events, not per-keystroke).
//   • Walks BOTH silos: `src/` against the src allowlists (the AGENTS.md prose
//     list) and `library/` against the library twins (library/AGENTS.md "Perf
//     doctrine"). Each silo keeps its own allowlist because each keeps its own
//     prose doctrine — the justifications live next to the code they govern.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── The permitted-subscriber allowlist ──────────────────────────────────────
// Every `src/` file that legitimately makes a main-editor
// `editor.on('update'|'transaction')` subscription. Each entry's value is the
// `[cost: …]`-tagged one-line justification — the SAME facts the AGENTS.md
// prose list carries. Files with more than one subscriber (EditorLayout,
// EditorPane) get one justification covering all of them. If you cannot
// justify the cost class, the subscriber is the bug, not this list.
const PERMITTED_KEYSTROKE_SUBSCRIBERS: Record<string, string> = {
  "components/EditorLayout.tsx":
    "[cost: O(1)/tx; deferred body O(headings) fast-path, O(doc) flag-off fallback] Two subscribers: activity-presence counter bump (docChanged-gated, mounted only while iHavePen); section-path recompute, main pane ('update' → RAF-coalesced + perf-flag gate; the deferred compute's PRIMARY path is the Wave-2 C2 geometry derivation computeSectionPathAt — ONE posAtCoords + binary search over the DocStructure snapshot behind geomBreadcrumbEnabled() — with the legacy coordsAtPos doc-walk surviving only as the virgil:geom-breadcrumb flag-off/service-null fallback; the resize path is gesture-parked via LAYOUT_SITE_SECTION_PATH, scroll stays live). (The PDF-stale bump was removed in P6 — pdfStale is owned solely by EditorPane. The MIRROR pane's twin recompute was removed in task 115 with the editor split, which nothing had mounted since its render site was dropped.)",
  "components/EditorMirror.tsx":
    "[cost: O(1)/tx; deferred body O(edit) replay] RAF-deferred mirror replay — the transaction handler only schedules a frame. PARKED since task 115: its only consumer (SplitEditorPanes) is deliberately unmounted, so this subscriber cannot run today; it stays listed because this census greps FILES, not mounts, and the subscription would be live again the moment something mounts it.",
  "components/EditorPane.tsx":
    "[cost: O(1)/tx; deferred body O(doc) outline memo off-path] Two subscribers: PDF-stale bump (stamp a timestamp ref, flip pdfStale ≤once per compile cycle); Outline-panel tick (debounced 300 ms timer reset + one counter bump — the doc-walk is deferred into the outlineContent memo, off the keystroke path; the effect stays UNMOUNTED when docProductsEnabled).",
  "components/Marginalia.tsx":
    "[cost: O(1)/tx] RAF-coalesced host-element notify.",
  "components/PendingChangePill.tsx":
    "[cost: O(1)/tx; RAF body O(marks) + 1 coordsAtPos] Pending-change margin-pill reposition: schedules a RAF (early-returns if one is pending) + placementsEqual bail on the single coordsAtPosCached placement. Same RAF-coalesced fixed portal recorded on the scroll allowlist.",
  "components/SelectionActionsMenu.tsx":
    "[cost: O(1)/tx; RAF body O(depth) + 1 coordsAtPos] Margin-bolt reposition: suppression check + RAF-already-scheduled bail; the single coordsAtPosCached placement math short-circuits on a placement-equality bail.",
  "components/SlashCommandPopup.tsx":
    "[cost: O(1)/tx, open-only] Mounted only while the popup is open; RAF-coalesced caret reposition.",
  "components/editor-layout/panels/omni-fold-mirror-invalidation.ts":
    "[cost: O(1)/tx] Fold-mirror invalidation SSOT (subscribeFoldMirrorInvalidation, consumed by omni-host's editorTick effect): a single getMeta(sectionFoldingPluginKey) check on the transaction handler — bumps ONLY on a fold-meta tx, returns immediately on a plain keystroke; its other sources are structural DocStructureBus events (headings/blocks added/removed/reordered), which never fire on a plain in-block keystroke.",
  "hooks/useEditorUIState.ts":
    "[cost: O(1)/tx] Section-fold persister: gated via the shared transactionTouchesFold predicate (fold-meta or docChanged) — O(1) per tx.",
  "hooks/useLatexSource.ts":
    "[cost: O(1)/tx; debounced body O(doc) serialize off-path] Diagnostics source feed (P5 item 4): the handler only resets a timer; the O(doc) serializeToLatex fires in the debounced callback, off the keystroke path. Suppressed while the code view feeds sourceText directly (CodeEditor.onTextChange).",
  "hooks/useWordCount.ts":
    "[cost: O(1)/tx; debounced body O(doc) walk off-path] 300 ms debounce, then the full doc walk — the per-keystroke cost is just the timer reset. Legacy flag-off path only (docProductsEnabled passes null).",
  "lib/code-pane-bridge.ts":
    "[cost: O(1)/tx; debounced body O(doc) serialize off-path] TipTap→code sync: docChanged-gated + own-write ('syncing') filtered, then a debounced serialize.",
  "lib/doc-products/pipeline.ts":
    "[cost: O(1)/tx; tiered bodies O(changed)→O(doc) off-path] THE single DocProducts subscriber (perf Wave 1): the update handler is a dirty flag + one timer reset; all O(doc)/O(changed) product work (per-block toJSON/serialize misses, assembly tails, word counts) runs in the 300 ms interactive tier or the requestLowPriority idle tier, off the keystroke path. Flag-on it REPLACES the useLatexSource + useWordCount + EditorPane outline-tick + editor-ops latestDoc subscribers (those entries remain while the flag-off legacy path exists; deleted in Wave-1 S6).",
  "lib/float-sync.tsx":
    "[cost: O(steps)/tx; readSource O(doc) only on source-touch] One subscription per OPEN text-object float: docChanged-gated + own-write meta filter + the source-touch gate (task 140) — the handler maps the float's live source range through the transaction's steps (and its appendedTransactions') and calls readSource ONLY if a step intersected it. The third gate is the load-bearing one: readSource is O(doc) in every body, so the first two alone cost a full-document walk per keystroke per open float. This entry's pre-140 text ('O(1) per tx') described the subscriber and not its callback — see the header note.",
  "text-objects/TextObjectGrabHandle.tsx":
    "[cost: O(1)/tx; RAF body O(near-zone) fast-path, O(doc) flag-off fallback] docChanged-gated → RAF-coalesced placement resolve. The RAF body is NOT unconditionally cheap: with the mouse armed over the editor, each docChanged keystroke re-resolves hover — via the geometry service's blocksAtY (Wave-2 C1, cached near-zone bands, zero per-block DOM reads) on the primary path, but the virgil:geom-hover flag-off/service-null FALLBACK is the legacy O(doc) [data-uuid] querySelectorAll + rect-per-candidate sweep. Hover mousemoves route through the layout-gesture park (one settle per gesture); viewport data reads the C7 service frame.",
};

// ── The library-silo allowlist ──────────────────────────────────────────────
// Same discipline over `library/` (the Reader mounts the SAME EditorPane, so
// the law applies verbatim). Prose twin: library/AGENTS.md "Perf doctrine" →
// "Keystroke sanctity (library edition)".
const PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS: Record<string, string> = {
  "hooks/usePgmarkPages.ts":
    "[cost: O(1)/tx; re-scan O(doc) on real doc change only] \\pgmark page collection: docChanged-gated (the Reader is read-only, so plain transactions never fire it); layout re-scans ride a RAF-coalesced RO parked during pane drags; `pages` is identity-gated (label+docY equality) so no-op re-scans keep consumer memos intact.",
};

// ── The selectionUpdate allowlists (Wave-4 P6) ──────────────────────────────
// Selection moves on every keystroke, so these handlers run per keystroke too.
// The census found 8 sites; each is human-verified below. The heavy bodies are
// all either RAF/debounce-deferred or bounded by depth/selection — the two
// un-deferred O(depth) walks (active-text-object, useEditorUIState's caret
// channel) are ancestor walks over the selection head, never doc walks.
const PERMITTED_SELECTION_SUBSCRIBERS: Record<string, string> = {
  "components/PendingChangePill.tsx":
    "[cost: O(1)/event; RAF body O(marks) + 1 coordsAtPos] Same RAF scheduler as its update subscription: gesture-suppression + RAF-pending bail; the body reads marks at the caret (anchorIdsAtCaret — nodeBefore/nodeAfter, no walk) + one placement with equality bail.",
  "components/SelectionActionsMenu.tsx":
    "[cost: O(1)/event; RAF body O(depth) + 1 coordsAtPos] Same RAF scheduler as its update subscription: suppression + RAF-pending bail; body is one resolveAnchorableNode ancestor walk + one coordsAtPosCached + placementsEqual bail.",
  "hooks/useEditorUIState.ts":
    "[cost: O(depth)/event + 400 ms debounced sidecar write] Caret-paragraph channel: synchronous paragraphUuidAtSelection ancestor walk (O(depth), notifies only on paragraph CHANGE via caretNotifyRef — the shared channel useAutoApplyPendingChanges and the EditorPane riders piggyback on, deliberately no extra subscribers) + a 400 ms debounced last-paragraph persist.",
  "hooks/useSelectionCounts.ts":
    "[cost: O(1)/event; debounced body O(selection)] Flag-on selection-counts half of the old useWordCount (Wave 1): 50 ms timer reset per event; the debounced getSelectionCounts is O(1) null on a caret and one nodesBetween bounded to the selection otherwise. Mutually exclusive with useWordCount's twin (docProductsEnabled picks exactly one).",
  "hooks/useWordCount.ts":
    "[cost: O(1)/event; debounced body O(selection)] Legacy flag-off twin of useSelectionCounts — same 50 ms debounce + selection-bounded count; dead when docProductsEnabled.",
  "lib/code-pane-bridge.ts":
    "[cost: O(1)/event; RAF body O(depth) + cached range lookup] Code-band sync (mounted only while the code pane is open): disposed check + RAF-pending bail; the RAF body is one active-uuid ancestor walk + a WeakMap-cached char-range lookup (re-parse O(source) only after a code-doc change) + a {from,to} equality bail before the CM dispatch.",
  "text-objects/TextObjectGrabHandle.tsx":
    "[cost: O(1)/event; RAF body O(near-zone) fast-path, O(doc) flag-off fallback] Same RAF scheduler as its update subscription — see the keystroke entry: hover resolve via blocksAtY, legacy [data-uuid] sweep only under the virgil:geom-hover kill-switch.",
  "text-objects/active-text-object-context.tsx":
    "[cost: O(depth)/event, un-deferred] Active-text-object recompute: resolveFromSelection is a doc.resolve + ancestor walk over the selection head (never a doc walk), with a refsEqual identity bail before any subscriber notify.",
};

const PERMITTED_LIBRARY_SELECTION_SUBSCRIBERS: Record<string, string> = {
  // Deliberately EMPTY — the library silo has no selectionUpdate subscribers.
  // A new one must be justified here (same tag rule) or rewritten.
};

// ── The <VirgilEditor> mount census (Wave-4 P6) ─────────────────────────────
// The main editor's `onUpdate` JSX prop is the ONE subscription path the call-
// form grep above cannot see (TipTap wires it internally). Pin the mount set
// so a second <VirgilEditor onUpdate=…> cannot appear ungoverned: EditorPane's
// single mount forwards to the caller + the useDocument autosaver, both O(1)
// per keystroke (each defers its O(doc) getJSON into its own debounce).
const PERMITTED_VIRGIL_EDITOR_MOUNTS: Record<string, string> = {
  "components/EditorPane.tsx":
    "[cost: O(1)/tx] The sole <VirgilEditor> mount: onUpdate forwards the editor BY REFERENCE to the caller's optional onUpdate and (visible panes only) the useDocument autosaver — both defer their O(doc) serialize into their own debounce timers.",
};

/**
 * Strip block + line comments so a docstring that MENTIONS the doctrine
 * (`editor.on('update')` appears in prose all over the perf-critical files)
 * doesn't read as a real subscription. Stripping is conservative — it only
 * removes text, so it can never manufacture a false match; a real `.on("update"`
 * that survives stripping is a genuine call. (A `.on("update"` sitting AFTER a
 * `//` on the same line would be commented-out code — correctly not a live call.)
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * The guarded class as a machine-detectable form: a real
 * `<receiver>.on("update"|'update'|"transaction"|'transaction', …)` subscription
 * call. File-level on purpose (a per-handler AST scope check would be brittle);
 * the allowlist + justification closes the semantic gap — a listed site is
 * human-verified as O(1)/O(edit-size).
 */
export function detectKeystrokeSubscriber(source: string): boolean {
  return /\.on\(\s*["'](?:update|transaction)["']/.test(stripComments(source));
}

/** The selectionUpdate call form — its own detector so the two censuses can't
 *  blur (the quote-delimited keystroke form deliberately does NOT match it). */
export function detectSelectionSubscriber(source: string): boolean {
  return /\.on\(\s*["']selectionUpdate["']/.test(stripComments(source));
}

/** A real `<VirgilEditor` JSX mount (comment-stripped). */
export function detectVirgilEditorMount(source: string): boolean {
  return /<VirgilEditor[\s>]/.test(stripComments(source));
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function detectedSet(root: string, detect: (s: string) => boolean): string[] {
  return walkSource(root)
    .filter((f) => detect(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
}

describe("keystroke-subscriber guardrail — source allowlist", () => {
  const detected = detectedSet(SRC, detectKeystrokeSubscriber);

  it("flags exactly the allowlisted main-editor subscribers — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new `editor.on('update'|'transaction')`
    // subscriber landed on the main editor. Confirm it is O(1) per transaction
    // (debounced timer reset / counter bump / RAF-coalesced read) or O(edit-size)
    // (consumes the DocStructureObserver diff), then add it to
    // PERMITTED_KEYSTROKE_SUBSCRIBERS with a tagged justification AND to the
    // AGENTS.md prose list — OR rewrite it to stop walking the doc per keystroke.
    expect(detected).toEqual(Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS).sort());
  });

  it("keeps the allowlist free of stale entries (every listed file still exists + still subscribes)", () => {
    for (const rel of Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectKeystrokeSubscriber(src)).toBe(true);
    }
  });

  it("would flag a NEW unlisted subscriber (naive walk-the-doc fixture)", () => {
    // The exact regression this guard exists to catch: a per-transaction
    // subscriber that walks the whole doc on every keystroke, on no allowlist.
    const naiveFixture = `
      function useNaivePlugin(editor) {
        useEffect(() => {
          const onUpdate = () => {
            editor.state.doc.descendants((node) => { recount(node); });
          };
          editor.on("update", onUpdate);
          return () => editor.off("update", onUpdate);
        }, [editor]);
      }
    `;
    expect(detectKeystrokeSubscriber(naiveFixture)).toBe(true);
    expect(
      Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS).some((k) =>
        naiveFixture.includes(k),
      ),
    ).toBe(false);
  });

  it("does not flag a file that only MENTIONS the doctrine in comments", () => {
    // The perf-critical files are full of prose like `NOT an editor.on('update')
    // subscriber` — stripping comments first is what keeps those from reading as
    // live subscriptions. This pins that behavior.
    const commentOnly = `
      // This service is NOT an editor.on('update' | 'transaction') subscriber.
      /* It never calls editor.on("update", …) — it polls instead. */
      export function poll() { return 1; }
    `;
    expect(detectKeystrokeSubscriber(commentOnly)).toBe(false);
  });

  it("keeps the two detectors disjoint (selectionUpdate/focus/blur never match the keystroke form)", () => {
    expect(detectKeystrokeSubscriber(`editor.on("selectionUpdate", fn)`)).toBe(false);
    expect(detectKeystrokeSubscriber(`editor.on('focus', fn)`)).toBe(false);
    expect(detectKeystrokeSubscriber(`editor.on("blur", fn)`)).toBe(false);
    expect(detectSelectionSubscriber(`editor.on("update", fn)`)).toBe(false);
    expect(detectSelectionSubscriber(`editor.on("selectionUpdate", fn)`)).toBe(true);
  });
});

describe("keystroke-subscriber guardrail — selectionUpdate census (Wave-4 P6)", () => {
  it("flags exactly the allowlisted src/ selection subscribers", () => {
    expect(detectedSet(SRC, detectSelectionSubscriber)).toEqual(
      Object.keys(PERMITTED_SELECTION_SUBSCRIBERS).sort(),
    );
  });

  it("flags exactly the allowlisted library selection subscribers (none today)", () => {
    expect(detectedSet(LIBRARY, detectSelectionSubscriber)).toEqual(
      Object.keys(PERMITTED_LIBRARY_SELECTION_SUBSCRIBERS).sort(),
    );
  });

  it("keeps the selection allowlist free of stale entries", () => {
    for (const rel of Object.keys(PERMITTED_SELECTION_SUBSCRIBERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectSelectionSubscriber(src)).toBe(true);
    }
  });
});

describe("keystroke-subscriber guardrail — <VirgilEditor> mount census (Wave-4 P6)", () => {
  it("pins the mount set (a second onUpdate-bearing main-editor mount cannot appear ungoverned)", () => {
    expect(detectedSet(SRC, detectVirgilEditorMount)).toEqual(
      Object.keys(PERMITTED_VIRGIL_EDITOR_MOUNTS).sort(),
    );
  });
});

describe("keystroke-subscriber guardrail — cost-class tags (Wave-4 P6)", () => {
  it("every justification in every allowlist begins with a [cost: …] tag", () => {
    const lists = [
      PERMITTED_KEYSTROKE_SUBSCRIBERS,
      PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS,
      PERMITTED_SELECTION_SUBSCRIBERS,
      PERMITTED_LIBRARY_SELECTION_SUBSCRIBERS,
      PERMITTED_VIRGIL_EDITOR_MOUNTS,
    ];
    for (const list of lists) {
      for (const [key, justification] of Object.entries(list)) {
        expect(
          /^\[cost: [^\]]+\]/.test(justification),
          `${key} justification must start with a [cost: …] tag`,
        ).toBe(true);
      }
    }
  });
});

describe("keystroke-subscriber guardrail — library silo", () => {
  const detected = detectedSet(LIBRARY, detectKeystrokeSubscriber);

  it("flags exactly the allowlisted library subscribers — no unlisted new ones", () => {
    // Same escape hatch as the src/ block: confirm the new subscriber is O(1)
    // per transaction, then add it to PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS
    // with a tagged justification AND to the library/AGENTS.md "Perf doctrine"
    // prose list — OR rewrite it to stop walking the doc on every keystroke.
    expect(detected).toEqual(
      Object.keys(PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS).sort(),
    );
  });

  it("keeps the library allowlist free of stale entries", () => {
    for (const rel of Object.keys(PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS)) {
      const src = readFileSync(path.join(LIBRARY, rel), "utf8");
      expect(detectKeystrokeSubscriber(src)).toBe(true);
    }
  });
});
