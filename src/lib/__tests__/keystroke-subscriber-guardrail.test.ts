// Keystroke-sanctity permitted-subscriber guardrail (task 044; extended by
// perf Wave 4 P6) — the CI half of the keystroke-sanctity law, the sibling of
// `scroll-reposition-guardrail.test.ts`.
//
// The law (docs/agents/laws/keystroke-sanctity.md, "Keystroke sanctity"): no plugin, hook, or React effect
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
// the callback's invocations instead of trusting a sentence.
//
// ONE RECORD (task 925). These allowlists are the SOURCE. The prose lists in
// docs/agents/laws/keystroke-sanctity.md and library/AGENTS.md are PINNED to
// them: each sits between `<!-- census:<name> -->` markers, every bullet opens
// with a backticked allowlist key, and the "prose pin" block below asserts the
// two key sets are equal in both directions, that a multi-subscriber file's
// bullet states its count (`×2`), and that no bullet cites a line number (a
// line cite rots on the next edit above it; a symbol name does not). Before
// 925 they were "kept in sync" by comment alone and had drifted: five stale
// line cites, four prose entries this census could not see, stale tags here.
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
// THREE PER-TRANSACTION FORMS (task 925). A transaction reaches app code by
// three doors, and the census covers all three, COUNTED PER FILE (a file-level
// boolean let a second subscriber in an already-listed file land unseen):
//   1. `<receiver>.on("update"|"transaction"|"selectionUpdate", …)` — the
//      runtime subscription (the original census).
//   2. A ProseMirror plugin `view()`'s returned `update(view, prevState)` —
//      runs after EVERY dispatch, makes no `.on(` call, and was invisible both
//      here and to `plugin-apply-guardrail` (which censuses `apply` /
//      `appendTransaction`). Discovered in every file constructing a
//      `new Plugin`, following a `view: factory(…)` reference into the same
//      file's function.
//   3. The MAIN editor's TipTap option handlers (`onUpdate:` / `onTransaction:`
//      / `onSelectionUpdate:` inside `components/Editor.tsx`'s `useEditor({…})`)
//      — TipTap wires these internally, so form 1 cannot see them. Its consumers
//      are pinned by the `<VirgilEditor` mount census.
// Scope notes (mirroring task 042's scoping cautions):
//   • `onUpdate:` React callback props on panels, and the `useEditor` option
//     handlers of float bodies / card editors (separate, bounded editors — a
//     keystroke there never costs the MAIN document's size) are out of scope.
//   • NodeView `update(node)` methods are out of scope: ProseMirror calls them
//     only for the nodes a redraw reaches, O(1) per node.
//   • `focus`/`blur` stay ungoverned here (edge events, not per-keystroke).
//   • Walks BOTH silos: `src/` against the src allowlists (the AGENTS.md prose
//     list) and `library/` against the library twins (library/AGENTS.md "Perf
//     doctrine"). Each silo keeps its own allowlist because each keeps its own
//     prose doctrine — the justifications live next to the code they govern.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  bodyAfterParams,
  codeOnlyLines,
  commentsStripped,
  localFunctions,
  matchFrom,
  walkFiles,
} from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

/** A justification (one subscriber in the file) or `{ count, why }` for a file
 *  holding several — ONE justification covering all of them, and the count is
 *  exact, so a second subscriber in a listed file fails CI. */
type Permit = string | { count: number; why: string };
type Allowlist = Record<string, Permit>;
const whyOf = (p: Permit) => (typeof p === "string" ? p : p.why);
const countOf = (p: Permit) => (typeof p === "string" ? 1 : p.count);
const expectedCounts = (list: Allowlist) =>
  Object.fromEntries(
    Object.entries(list)
      .map(([k, p]) => [k, countOf(p)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

// ── The permitted-subscriber allowlist ──────────────────────────────────────
// Every `src/` file that legitimately makes a main-editor
// `editor.on('update'|'transaction')` subscription. Each entry's value is the
// `[cost: …]`-tagged one-line justification — the SOURCE the law doc's
// `census:transaction-subscribers` list is pinned to. If you cannot justify the
// cost class, the subscriber is the bug, not this list.
const PERMITTED_KEYSTROKE_SUBSCRIBERS: Allowlist = {
  "components/EditorLayout.tsx": {
    count: 2,
    why: "[cost: O(1)/tx; RAF body 1 posAtCoords + O(log headings) fast path, O(headings) coordsAtPos flag-off fallback] Two subscribers: (1) activity-presence counter bump ('transaction', docChanged-gated, mounted only while collab.iHavePen); (2) section-path recompute, main pane ('update' → isTier1BDisabled perf-flag gate + cancel/requestAnimationFrame). The deferred compute's PRIMARY path is the Wave-2 C2 geometry derivation computeSectionPathAt — ONE posAtCoords + a binary search over the DocStructure snapshot, behind geomBreadcrumbEnabled() — with the legacy O(headings) coordsAtPos walk surviving only as the virgil:geom-breadcrumb flag-off / service-null fallback; resize AND scroll are gesture-parked via LAYOUT_SITE_SECTION_PATH. (EditorPane solely owns pdfStale since P6; the MIRROR pane's twin recompute left with the editor split, task 115.)",
  },
  "components/EditorMirror.tsx":
    "[cost: O(1)/tx; deferred body O(edit) replay] RAF-deferred mirror replay — the transaction handler only schedules a frame. PARKED since task 115: its only consumer (SplitEditorPanes) is deliberately unmounted, so this subscriber cannot run today; it stays listed because this census greps FILES, not mounts, and the subscription would be live again the moment something mounts it.",
  "components/EditorPane.tsx": {
    count: 2,
    why: "[cost: O(1)/tx; debounced body O(doc) outline memo off-path] Two 'update' subscribers: (1) PDF-stale tracker — stamp lastEditTimeRef, flip pdfStale at most once per compile cycle; (2) Outline-panel doc tick — clear+reset a 300 ms timer, then one counter bump; the doc walk happens later inside the outlineContent memo. The tick effect returns early when docProductsEnabled, a MODULE constant read once at page load (readFlag), so its `[editor]` deps are exact — it is never mounted flag-on.",
  },
  "components/Marginalia.tsx":
    "[cost: O(1)/tx] RAF-coalesced host-element notify.",
  "components/PendingChangePill.tsx":
    "[cost: O(1)/tx; RAF body O(marks) + 1 coordsAtPos] Pending-change margin-pill reposition: schedules a RAF (early-returns if one is pending) + placementsEqual bail on the single coordsAtPosCached placement. Same RAF-coalesced fixed portal recorded on the scroll allowlist.",
  "components/SelectionActionsMenu.tsx":
    "[cost: O(1)/tx; RAF body O(depth) + 1 coordsAtPos] Margin-bolt reposition: suppression check + RAF-already-scheduled bail; the single coordsAtPosCached placement math short-circuits on a placement-equality bail.",
  "components/SlashCommandPopup.tsx":
    "[cost: O(1)/tx, open-only] Mounted only while the popup is open; RAF-coalesced caret reposition.",
  "components/editor-layout/panels/omni-fold-mirror-invalidation.ts":
    "[cost: O(1)/tx; O(1)/structural emit] Fold-mirror invalidation SSOT (subscribeFoldMirrorInvalidation, consumed by omni-host's editorTick effect): the 'transaction' handler is a single getMeta(sectionFoldingPluginKey) check — bumps ONLY on a fold-meta tx. Its other source is the bus's ONE generic channel, onAnyChange, gated on the section-folding plugin's own rebuild predicate diffHasStructuralEntries (task 657) — onAnyChange never fires for a content-only diff, so a plain keystroke leaves emitCount flat and this gate silent.",
  "hooks/useEditorUIState.ts":
    "[cost: O(1)/tx; O(folded) write only on a real fold change] Section-fold persister: one reference compare of the fold set's IDENTITY (foldedSetOf, task 925) against the last one it saw — the section-folding reducer keeps that Set's reference on every transaction that changes no fold, a keystroke while folded included. Only a real fold change (meta or prune) spreads the set into writeFolds. (Its predecessor gate, transactionTouchesFold, was true for every docChanged tx — O(folded sections) per keystroke under an O(1) tag.)",
  "hooks/useLatexSource.ts":
    "[cost: O(1)/tx; debounced body O(doc) serialize off-path] Diagnostics source feed (P5 item 4): the handler only resets a timer; the O(doc) serializeToLatex fires in the debounced callback, off the keystroke path. Suppressed while the code view feeds sourceText directly (CodeEditor.onTextChange).",
  "hooks/useWordCount.ts":
    "[cost: O(1)/tx; debounced body O(doc) walk off-path] 300 ms debounce, then the full doc walk — the per-keystroke cost is just the timer reset. Legacy flag-off path only (docProductsEnabled passes null).",
  "lib/code-pane-bridge.ts":
    "[cost: O(1)/tx; debounced body O(doc) serialize off-path] TipTap→code sync: docChanged-gated + own-write ('syncing') filtered, then a debounced serialize.",
  "components/editor-layout/card-actions/grab-menu-target.ts":
    "[cost: O(steps)/tx, open-only; RAF body 1 coordsAtPos/nodeDOM + rows' applies() O(depth)] The OPEN grab menu follows its target (task 737): mounted only while the menu is open; the handler maps the target span through the transaction's (and appendedTransactions') step maps — the selection-staleness test rides the same pass — and a RAF-coalesced ≤1/frame publish re-derives the anchor (one layout read) and the rows' applies() (per-kind / O(depth) container resolve). The one uuid walk that seeds a node ref's span runs once, at open, never per tx.",
  "lib/tiptap/use-live-editor-signature.ts":
    "[cost: O(1)/tx, open-only; RAF body O(cells)] useLiveEditorSignature (task 738): the painted state of an OPEN surface follows the editor. Mounted only by a component that exists only while its surface is open (today the lightning panel, ActionsMenuPanel). The handler is a pending-RAF check; the ≤1/frame RAF body is the caller's signature() — for the lightning panel 7 editor.isActive reads (O(selection) each) + 16 grid-row applies() + 11 card-row applies() (per-kind / O(depth)), never a document walk — and it re-renders only when the signature string changed.",
  "lib/doc-products/pipeline.ts":
    "[cost: O(1)/tx; tiered bodies O(changed)→O(doc) off-path] THE single DocProducts subscriber (perf Wave 1): the 'update' handler is one timer reset (staleness is a comparison of each tier's recorded inputs, so the handler writes nothing else); all O(doc)/O(changed) product work (per-block toJSON/serialize misses, assembly tails, word counts) runs in the interactive tier after the debounce or the idle tier, off the keystroke path. Flag-on it REPLACES the useLatexSource, useWordCount and EditorPane outline-tick subscribers (those entries remain while the flag-off legacy path exists; deleted in Wave-1 S6) — and the editor-ops latestDoc feed, which is an onUpdate forward through <VirgilEditor>, not a subscriber here.",
  "lib/float-sync.tsx":
    "[cost: O(steps)/tx; readSource O(doc) only on source-touch] One subscription per OPEN text-object float: docChanged-gated + own-write meta filter + the source-touch gate (task 140) — the handler maps the float's live source range through the transaction's steps (and its appendedTransactions') and calls readSource ONLY if a step intersected it. The third gate is the load-bearing one: readSource is O(doc) in every body, so the first two alone cost a full-document walk per keystroke per open float. This entry's pre-140 text ('O(1) per tx') described the subscriber and not its callback — see the header note.",
  "text-objects/TextObjectGrabHandle.tsx":
    "[cost: O(1)/tx; RAF body O(1) while typing, O(depth) per selection handle] docChanged-gated → RAF-coalesced placement resolve, and since task 336 the RAF body is bounded by INPUT MODALITY rather than by luck. The HOVER branch is the only pointer-derived one and it is answered only in pointer modality (@/lib/input-modality), so a keystroke resolves branches 1/2 and stops: with a collapsed caret that is a from!==to compare and nothing else; with a live selection it is one O(depth) ancestor walk plus one placement. The pre-336 entry recorded the armed-hover cost as an accepted caveat — with the pointer parked where the user last clicked (i.e. always) every keystroke re-ran blocksAtY plus one computePlacement per containing level, 2-3 of them in a list at ~3x a paragraph's forced-layout reads. Hover mousemoves route through the layout-gesture park (one settle per gesture); viewport data reads the C7 service frame; the geom-hover flag-off fallback (legacy O(doc) [data-uuid] sweep) is now unreachable from a keystroke for the same reason. Contract: text-objects/__tests__/grab-handle-typing-cost.test.tsx counts the resolver's calls with the mouse ARMED.",
};

// ── The library-silo allowlist ──────────────────────────────────────────────
// Same discipline over `library/` (the Reader mounts the SAME EditorPane, so
// the law applies verbatim). Prose twin: library/AGENTS.md "Perf doctrine" →
// "Keystroke sanctity (library edition)".
const PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS: Allowlist = {
  "hooks/usePgmarkPages.ts":
    "[cost: O(1)/tx; re-scan O(doc) on real doc change only] \\pgmark page collection: docChanged-gated (the Reader is read-only, so plain transactions never fire it); layout re-scans ride a RAF-coalesced RO parked during pane drags; `pages` is identity-gated (label+docY equality) so no-op re-scans keep consumer memos intact.",
};

// ── The selectionUpdate allowlists (Wave-4 P6) ──────────────────────────────
// Selection moves on every keystroke, so these handlers run per keystroke too.
// The census found 8 sites; each is human-verified below. The heavy bodies are
// all either RAF/debounce-deferred or bounded by depth/selection — the two
// un-deferred O(depth) walks (active-text-object, useEditorUIState's caret
// channel) are ancestor walks over the selection head, never doc walks.
const PERMITTED_SELECTION_SUBSCRIBERS: Allowlist = {
  "components/PendingChangePill.tsx":
    "[cost: O(1)/event; RAF body O(marks) + 1 coordsAtPos] Same RAF scheduler as its update subscription: gesture-suppression + RAF-pending bail; the body reads marks at the caret (anchorIdsAtCaret — nodeBefore/nodeAfter, no walk) + one placement with equality bail.",
  "components/SelectionActionsMenu.tsx":
    "[cost: O(1)/event; RAF body O(depth) + 1 coordsAtPos] Same RAF scheduler as its update subscription: suppression + RAF-pending bail; body is one resolveAnchorableNode ancestor walk + one coordsAtPosCached + placementsEqual bail.",
  "hooks/useEditorUIState.ts":
    "[cost: O(depth)/event + 400 ms debounced sidecar write] Caret-paragraph channel: synchronous paragraphUuidAtSelection ancestor walk (O(depth), notifies only on paragraph CHANGE via caretNotifyRef — the shared channel useAutoApplyPendingChanges and the EditorPane riders piggyback on, deliberately no extra subscribers) + a 400 ms debounced last-paragraph persist.",
  "hooks/useSelectionCounts.ts":
    "[cost: O(1)/event; debounced body O(top-level index)+O(selection)] Flag-on selection-counts half of the old useWordCount (Wave 1): 50 ms timer reset per event; the debounced getSelectionCounts is O(1) null on a CARET (from === to, which every plain keystroke and caret move takes) and otherwise a doc.slice(from,to,true) — a structure-sharing cut whose top-level Fragment.cut scans block children up to the selection end (arithmetic only, same scan the pre-122 nodesBetween walked) — then toJSON + the canonical walker over the selected subtree. Mutually exclusive with useWordCount's twin (docProductsEnabled picks exactly one).",
  "hooks/useWordCount.ts":
    "[cost: O(1)/event; debounced body O(top-level index)+O(selection)] Legacy flag-off twin of useSelectionCounts — same 50 ms debounce and the same getSelectionCounts body; dead when docProductsEnabled.",
  "lib/code-pane-bridge.ts":
    "[cost: O(1)/event; RAF body O(depth) + cached range lookup] Code-band sync (mounted only while the code pane is open): disposed check + RAF-pending bail; the RAF body is one active-uuid ancestor walk + a WeakMap-cached char-range lookup (re-parse O(source) only after a code-doc change) + a {from,to} equality bail before the CM dispatch.",
  "text-objects/TextObjectGrabHandle.tsx":
    "[cost: O(1)/event; RAF body O(1) while typing, O(depth) per selection handle] Same RAF scheduler as its update subscription — see the keystroke entry. The caret moves on every keystroke, so this IS a keystroke handler: since task 336 its RAF body cannot reach the hover resolver in keyboard modality, and a selection handle (the branch a shift-arrow must still move) costs one ancestor walk plus one placement.",
  "text-objects/active-text-object-context.tsx":
    "[cost: O(depth)/event, un-deferred] Active-text-object recompute: resolveFromSelection is a doc.resolve + ancestor walk over the selection head (never a doc walk), with a refsEqual identity bail before any subscriber notify.",
};

const PERMITTED_LIBRARY_SELECTION_SUBSCRIBERS: Allowlist = {
  // Deliberately EMPTY — the library silo has no selectionUpdate subscribers.
  // A new one must be justified here (same tag rule) or rewritten.
};

// ── The <VirgilEditor> mount census (Wave-4 P6) ─────────────────────────────
// The main editor's `onUpdate` JSX prop is the ONE subscription path the call-
// form grep above cannot see (TipTap wires it internally). Pin the mount set
// so a second <VirgilEditor onUpdate=…> cannot appear ungoverned: EditorPane's
// single mount forwards to the caller + the useDocument autosaver, both O(1)
// per keystroke (each defers its O(doc) getJSON into its own debounce).
const PERMITTED_VIRGIL_EDITOR_MOUNTS: Allowlist = {
  "components/EditorPane.tsx":
    "[cost: O(1)/tx] The sole <VirgilEditor> mount: onUpdate forwards the editor BY REFERENCE to the caller's optional onUpdate and (visible panes only) the useDocument autosaver — both defer their O(doc) serialize into their own debounce timers.",
};


// ── The plugin-view update census (task 925) ────────────────────────────────
// A ProseMirror plugin `view()` returns an object whose `update(view,
// prevState)` runs after EVERY dispatch — a keystroke handler that makes no
// `.on(` call. Keyed by file (src/-relative), counted per file, same tag rule.
const PERMITTED_PLUGIN_VIEW_UPDATES: Allowlist = {
  "lib/section-folding.ts":
    "[cost: O(1)/tx; O(chevrons) resync only on a real fold change] The shared fold-chevron refresher — ONE plugin view per editor, not N per-heading subscribers (#29 nit-3). update() compares the fold set's identity (foldedSetOf) old vs new and bails; only a real fold change runs the querySelectorAll('.heading-fold-chevron') resync.",
  "lib/tiptap/doc-structure/observer-plugin.ts":
    "[cost: O(1)/tx drain; emit fan-out only to the diff's categories; snapshot materialized lazily] THE observer's end-of-dispatch hook (makeViewSpec): nulls the two transient diff fields, returns when the dispatch carried no entries, else emits — a structural diff with the already-materialized snapshot, a content-only diff (every plain keystroke) with a THUNK that resolves only if an onContentChanged subscriber exists.",
  "lib/tiptap/expex.ts":
    "[cost: O(1)/tx] Example-width vars: two string compares of the plugin's WidthState old vs new; applyExpexWidthVars (two style writes) only when a width string changed.",
  "lib/tiptap/inline-atom-grab.ts":
    "[cost: O(1)/tx] Atom-grab affordance stamp (task 524): stampAtomsGraspable — two boolean reads (atomsAreGraspable, the same predicate the mousedown gesture gates on) + one getAttribute compare; idempotence-gated, so a plain keystroke writes nothing (a setAttribute at an unchanged value still invalidates style — task 430).",
  "lib/tiptap/linked-anchor.ts": {
    count: 2,
    why: "[cost: O(1)/tx] The two orphan guards' live-view trackers (linkedAnchorGuard, textObjectOrphanGuard): update() is one reference assignment (liveView = v2), so the deferred orphan checks read the SETTLED state.",
  },
  "lib/tiptap/slash-popup.ts":
    "[cost: O(1)/tx] Slash-popup publisher (task 750): one plugin-state reference compare old vs new; on a change, slashPopupStore.set (by-value bail inside).",
  "lib/tiptap/spellcheck-decorator.ts":
    "[cost: O(1)/tx; the check itself is the debounced pass] update(): on the ownership-CLAIM edge only, one dropNativeSpellMarkers; then syncAndSubscribe — a port identity compare, a version compare, a dirty-length read and at most one timer reset (schedule). The dirty-block / whole-document spell pass runs in the debounced callback, never in update().",
};

const PERMITTED_LIBRARY_PLUGIN_VIEW_UPDATES: Allowlist = {
  // Deliberately EMPTY — the library silo constructs no plugin with a view.
};

// ── The main editor's TipTap option handlers (task 925) ─────────────────────
// `components/Editor.tsx` builds the MAIN editor; an `onUpdate:` /
// `onTransaction:` / `onSelectionUpdate:` option inside its `useEditor({…})`
// runs per transaction and is wired by TipTap internally — form 1's grep cannot
// see it. Keyed `<file>#<option>`. Its consumers are pinned by the mount census.
const MAIN_EDITOR_FILE = "components/Editor.tsx";
const PERMITTED_MAIN_EDITOR_OPTION_HANDLERS: Allowlist = {
  "components/Editor.tsx#onUpdate":
    "[cost: O(1)/tx] Forwards the editor BY REFERENCE (and the transaction) to the <VirgilEditor onUpdate> prop — EditorPane's sole mount, whose consumers (the caller's handleUpdate / editor-ops latestDoc feed and the useDocument 1500 ms autosaver) each defer their O(doc) getJSON/serialize into their own debounce. Pre-fix this called getJSON() per keystroke.",
};

/**
 * Strip comments so a docstring that MENTIONS the doctrine (`editor.on('update')`
 * appears in prose all over the perf-critical files) doesn't read as a real
 * subscription. The shared `commentsStripped` (literals intact — the needle
 * lives inside the quotes) is literal-aware, so a `//` inside a string cannot
 * swallow the rest of its line. Stripping only removes text, so it can never
 * manufacture a false match.
 */
export const stripComments = commentsStripped;

const KEYSTROKE_RE = /\.on\(\s*["'](?:update|transaction)["']/g;
const SELECTION_RE = /\.on\(\s*["']selectionUpdate["']/g;
const VIRGIL_EDITOR_RE = /<VirgilEditor[\s>]/g;
const countMatches = (source: string, re: RegExp) =>
  (stripComments(source).match(re) ?? []).length;

/**
 * Form 1: real `<receiver>.on("update"|"transaction", …)` subscription calls,
 * COUNTED. Text-level on purpose (a per-handler AST scope check would be
 * brittle); the allowlist + justification closes the semantic gap.
 */
export function countKeystrokeSubscribers(source: string): number {
  return countMatches(source, KEYSTROKE_RE);
}
export const detectKeystrokeSubscriber = (s: string) => countKeystrokeSubscribers(s) > 0;

/** The selectionUpdate call form — its own detector so the two censuses can't
 *  blur (the quote-delimited keystroke form deliberately does NOT match it). */
export function countSelectionSubscribers(source: string): number {
  return countMatches(source, SELECTION_RE);
}
export const detectSelectionSubscriber = (s: string) => countSelectionSubscribers(s) > 0;

/** A real `<VirgilEditor` JSX mount (comment-stripped). */
export function countVirgilEditorMounts(source: string): number {
  return countMatches(source, VIRGIL_EDITOR_RE);
}

const VIEW_SPEC_RE = /(^|[\s,{])view\s*(\(|:)/gm;
const UPDATE_METHOD_RE = /(^|[\s,{])update\s*(?::\s*(?:function\s*)?)?\(/gm;

/** Method-DEFINITION-shaped `update(` occurrences in `body` (calls excluded). */
function countUpdateMethods(body: string): number {
  let n = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(UPDATE_METHOD_RE.source, "gm");
  while ((m = re.exec(body))) {
    if (bodyAfterParams(body, m.index + m[0].length - 1)) n++;
  }
  return n;
}

/**
 * Form 2: plugin-view `update(` methods. Only a file that constructs a
 * `new Plugin` is scanned; every `view(…) {…}` method / `view: (…) => {…}`
 * arrow / `view: factory(…)` or `view: factory` reference (resolved to the
 * same file's function) is a view spec, and each method-shaped `update(`
 * inside its body counts. A type annotation (`view: EditorView`) names no
 * local function and is skipped. Stated limit, the sibling census's own: a
 * factory IMPORTED from another file is not followed.
 */
export function countPluginViewUpdates(source: string): number {
  const code = codeOnlyLines(source);
  if (!/\bnew Plugin\b/.test(code)) return 0;
  const fns = localFunctions(code);
  let n = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(VIEW_SPEC_RE.source, "gm");
  while ((m = re.exec(code))) {
    const at = m.index + m[0].length - 1;
    if (m[2] === "(") {
      const b = bodyAfterParams(code, at);
      if (b) n += countUpdateMethods(code.slice(b[0], b[1] + 1));
      continue;
    }
    const rest = code.slice(at + 1).trimStart();
    if (rest.startsWith("(") || rest.startsWith("function")) {
      const paren = code.indexOf("(", at + 1);
      const b = bodyAfterParams(code, paren);
      if (b) n += countUpdateMethods(code.slice(b[0], b[1] + 1));
      continue;
    }
    const ref = /^([A-Za-z_$][\w$]*)/.exec(rest)?.[1];
    const body = ref ? fns.get(ref) : undefined;
    if (body) n += countUpdateMethods(body);
  }
  return n;
}

const OPTION_HANDLER_RE = /(^|[\s,{])(onUpdate|onTransaction|onSelectionUpdate)\s*(:|\()/gm;

/**
 * Form 3: the per-transaction option handlers inside a file's `useEditor({…})`
 * call(s), as `<option>` names (one entry per occurrence).
 */
export function mainEditorOptionHandlers(source: string): string[] {
  const code = codeOnlyLines(source);
  const out: string[] = [];
  const call = /\buseEditor\s*\(/g;
  let c: RegExpExecArray | null;
  while ((c = call.exec(code))) {
    const open = c.index + c[0].length - 1;
    const close = matchFrom(code, open, "(", ")");
    if (close < 0) continue;
    const args = code.slice(open + 1, close);
    // Only TOP-LEVEL keys of the options object: blank nested braces' content
    // so a nested `editorProps: { … }` cannot contribute.
    const objStart = args.indexOf("{");
    if (objStart < 0) continue;
    const objEnd = matchFrom(args, objStart, "{", "}");
    let top = "";
    let depth = 0;
    for (let i = objStart + 1; i < objEnd; i++) {
      const ch = args[i];
      const atTop = depth === 0;
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
      // Keep the brackets that OPEN / CLOSE a top-level value (a method
      // shorthand's `(` is what marks `onX(` as a definition).
      top += atTop || depth === 0 || ch === "\n" ? ch : " ";
    }
    let m: RegExpExecArray | null;
    const re = new RegExp(OPTION_HANDLER_RE.source, "gm");
    while ((m = re.exec(top))) out.push(m[2]);
  }
  return out;
}

function walkSource(dir: string): string[] {
  // Skip test + fixture trees so the guard never scans itself.
  return walkFiles(dir, { skipDirs: ["__tests__", "__fixtures__"] }).filter((f) => /\.(ts|tsx)$/.test(f));
}

/** `{ silo-relative file → count }` for every file with a non-zero count. */
function detectedCounts(root: string, count: (s: string) => number): Record<string, number> {
  const out: [string, number][] = [];
  for (const f of walkSource(root)) {
    const n = count(readFileSync(f, "utf8"));
    if (n > 0) out.push([path.relative(root, f).split(path.sep).join("/"), n]);
  }
  return Object.fromEntries(out.sort(([a], [b]) => a.localeCompare(b)));
}

/** One exact-set census leg, counts included, both directions. */
function censusLeg(root: string, count: (s: string) => number, list: Allowlist) {
  // If this fails with an EXTRA file (or a higher count): a new per-transaction
  // handler landed. Confirm it is O(1) per transaction (debounced timer reset /
  // counter bump / RAF-coalesced read) or O(edit-size) (consumes the
  // DocStructureObserver diff), then add it here with a [cost: …]-tagged
  // justification AND to the matching `census:` prose list — OR rewrite it to
  // stop walking the doc per keystroke. A MISSING file is a stale entry.
  expect(detectedCounts(root, count)).toEqual(expectedCounts(list));
}

describe("keystroke-subscriber guardrail — source allowlist", () => {
  it("counts exactly the allowlisted main-editor subscribers per file — no unlisted new ones", () => {
    censusLeg(SRC, countKeystrokeSubscribers, PERMITTED_KEYSTROKE_SUBSCRIBERS);
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

  it("COUNTS per file: a second subscriber in an already-listed file is visible (task 925)", () => {
    const one = `editor.on("update", a);`;
    const two = `editor.on("update", a);\n editor.on('transaction', b);`;
    expect(countKeystrokeSubscribers(one)).toBe(1);
    expect(countKeystrokeSubscribers(two)).toBe(2);
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
  it("counts exactly the allowlisted src/ selection subscribers", () => {
    censusLeg(SRC, countSelectionSubscribers, PERMITTED_SELECTION_SUBSCRIBERS);
  });

  it("counts exactly the allowlisted library selection subscribers (none today)", () => {
    censusLeg(LIBRARY, countSelectionSubscribers, PERMITTED_LIBRARY_SELECTION_SUBSCRIBERS);
  });
});

describe("keystroke-subscriber guardrail — <VirgilEditor> mount census (Wave-4 P6)", () => {
  it("pins the mount set (a second onUpdate-bearing main-editor mount cannot appear ungoverned)", () => {
    censusLeg(SRC, countVirgilEditorMounts, PERMITTED_VIRGIL_EDITOR_MOUNTS);
  });
});

describe("keystroke-subscriber guardrail — plugin-view update census (task 925)", () => {
  it("counts exactly the allowlisted src/ plugin-view update() hooks per file", () => {
    censusLeg(SRC, countPluginViewUpdates, PERMITTED_PLUGIN_VIEW_UPDATES);
  });

  it("counts exactly the allowlisted library plugin-view update() hooks (none today)", () => {
    censusLeg(LIBRARY, countPluginViewUpdates, PERMITTED_LIBRARY_PLUGIN_VIEW_UPDATES);
  });

  it("canary — sees a view() method's update, a view: arrow's, and a view: factory reference's", () => {
    const src = `
      import { Plugin } from "@tiptap/pm/state";
      function makeView(editor: any) {
        return (view: any) => ({ update(v: any) { walk(v.state.doc); }, destroy() {} });
      }
      export const a = new Plugin({ view(v) { return { update(v2, prev) { x(); } }; } });
      export const b = new Plugin({ view: (v) => { return { update: (v2) => { y(); } }; } });
      export const c = new Plugin({ view: makeView(editor) });
    `;
    expect(countPluginViewUpdates(src)).toBe(3);
  });

  it("canary — calls, NodeView-free files, annotations and view-less plugins count zero", () => {
    expect(countPluginViewUpdates(`function f(view: EditorView) { view.update(s); }`)).toBe(0);
    const src = `
      import { Plugin } from "@tiptap/pm/state";
      function helper(view: EditorView) { editor.commands.update(); }
      export const p = new Plugin({ view() { return { destroy() {} }; }, state: { init: () => 0, apply: (t, v) => v } });
    `;
    expect(countPluginViewUpdates(src)).toBe(0);
  });
});

describe("keystroke-subscriber guardrail — main editor option handlers (task 925)", () => {
  it("pins the per-transaction option handlers of the MAIN editor's useEditor call", () => {
    const found = mainEditorOptionHandlers(readFileSync(path.join(SRC, MAIN_EDITOR_FILE), "utf8"))
      .map((o) => `${MAIN_EDITOR_FILE}#${o}`)
      .sort();
    expect(found).toEqual(Object.keys(PERMITTED_MAIN_EDITOR_OPTION_HANDLERS).sort());
  });

  it("canary — reads only TOP-LEVEL option keys (a prop type or nested editorProps cannot count)", () => {
    const src = `
      interface Props { onUpdate: (e: Editor) => void }
      const editor = useEditor({
        extensions,
        editorProps: { handleDrop: () => { onTransaction: 1; } },
        onUpdate: ({ editor }) => { forward(editor); },
        onSelectionUpdate({ editor }) { x(); },
      });
    `;
    expect(mainEditorOptionHandlers(src)).toEqual(["onUpdate", "onSelectionUpdate"]);
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
      PERMITTED_PLUGIN_VIEW_UPDATES,
      PERMITTED_LIBRARY_PLUGIN_VIEW_UPDATES,
      PERMITTED_MAIN_EDITOR_OPTION_HANDLERS,
    ];
    for (const list of lists) {
      for (const [key, permit] of Object.entries(list)) {
        expect(
          /^\[cost: [^\]]+\]/.test(whyOf(permit)),
          `${key} justification must start with a [cost: …] tag`,
        ).toBe(true);
        expect(countOf(permit), `${key}: an explicit count must be ≥ 2 (omit it for 1)`).toBeGreaterThanOrEqual(
          typeof permit === "string" ? 1 : 2,
        );
      }
    }
  });
});

describe("keystroke-subscriber guardrail — library silo", () => {
  it("counts exactly the allowlisted library subscribers — no unlisted new ones", () => {
    // Same escape hatch as the src/ block; the prose twin is library/AGENTS.md
    // "Perf doctrine" → "Keystroke sanctity (library edition)".
    censusLeg(LIBRARY, countKeystrokeSubscribers, PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS);
  });
});

// ── The prose pin (task 925) ────────────────────────────────────────────────
// The law doc's lists are cross-references of THESE allowlists. Each prose list
// sits between `<!-- census:<name> -->` and `<!-- /census -->`; every top-level
// bullet opens with a backticked allowlist key.
const LAW_DOC = path.resolve(SRC, "../docs/agents/laws/keystroke-sanctity.md");
const LIBRARY_GUIDE = path.resolve(LIBRARY, "AGENTS.md");
const PROSE_PINS: ReadonlyArray<{ doc: string; block: string; list: Allowlist }> = [
  { doc: LAW_DOC, block: "transaction-subscribers", list: PERMITTED_KEYSTROKE_SUBSCRIBERS },
  { doc: LAW_DOC, block: "plugin-view-updates", list: PERMITTED_PLUGIN_VIEW_UPDATES },
  { doc: LAW_DOC, block: "main-editor-options", list: PERMITTED_MAIN_EDITOR_OPTION_HANDLERS },
  { doc: LIBRARY_GUIDE, block: "library-transaction-subscribers", list: PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS },
];

/** The text between a doc's census markers, or null when the block is absent. */
export function censusBlock(doc: string, name: string): string | null {
  const open = `<!-- census:${name} -->`;
  const a = doc.indexOf(open);
  if (a < 0) return null;
  const b = doc.indexOf("<!-- /census -->", a);
  return b < 0 ? null : doc.slice(a + open.length, b);
}

/** Top-level bullets of a census block, as `{ key, text }`. */
export function censusBullets(block: string): Array<{ key: string | null; text: string }> {
  const bullets: Array<{ key: string | null; text: string }> = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("- ")) {
      bullets.push({ key: /^- `([^`]+)`/.exec(line)?.[1] ?? null, text: line });
    } else if (bullets.length && line.trim()) {
      bullets[bullets.length - 1].text += `\n${line}`;
    }
  }
  return bullets;
}

/** A line citation — `File.tsx:123`, `` `:968` ``, `EditorPane:~1017`. */
const LINE_CITE_RE = /:~?\d{2,}\b/;

/** Everything wrong with one prose block against its allowlist (empty = pinned). */
export function proseDrift(block: string | null, list: Allowlist): string[] {
  if (block === null) return ["census block missing"];
  const problems: string[] = [];
  const bullets = censusBullets(block);
  const keys = new Set(Object.keys(list));
  const named = new Set<string>();
  for (const { key, text } of bullets) {
    if (!key) {
      problems.push(`bullet does not open with a backticked allowlist key: ${text.slice(0, 60)}`);
      continue;
    }
    named.add(key);
    if (!keys.has(key)) problems.push(`prose names \`${key}\`, which no allowlist entry covers`);
    const n = keys.has(key) ? countOf(list[key]) : 1;
    if (n > 1 && !text.includes(`×${n}`)) problems.push(`\`${key}\` holds ${n} subscribers; its bullet must say ×${n}`);
    if (LINE_CITE_RE.test(text)) problems.push(`\`${key}\` cites a line number (${LINE_CITE_RE.exec(text)?.[0]}) — name the symbol instead`);
  }
  for (const k of keys) if (!named.has(k)) problems.push(`allowlist entry \`${k}\` is missing from the prose list`);
  return problems;
}

describe("keystroke-subscriber guardrail — the prose lists are pinned to the allowlists (task 925)", () => {
  for (const { doc, block, list } of PROSE_PINS) {
    it(`${path.basename(doc)} census:${block} names exactly its allowlist's keys, with counts, no line cites`, () => {
      expect(proseDrift(censusBlock(readFileSync(doc, "utf8"), block), list)).toEqual([]);
    });
  }

  it("has teeth: a planted, a dropped, an uncounted and a line-cited entry are each reported", () => {
    const list: Allowlist = { "a.ts": "[cost: O(1)] a", "b.ts": { count: 2, why: "[cost: O(1)] b" } };
    const good = "\n- `a.ts` — fine\n- `b.ts` ×2 — fine\n";
    expect(proseDrift(good, list)).toEqual([]);
    expect(proseDrift(good + "- `fake.ts` — planted\n", list).join()).toContain("fake.ts");
    expect(proseDrift("\n- `a.ts` — only\n", list).join()).toContain("missing from the prose list");
    expect(proseDrift("\n- `a.ts`\n- `b.ts` — two of them\n", list).join()).toContain("×2");
    expect(proseDrift("\n- `a.ts` (`:968`)\n- `b.ts` ×2\n", list).join()).toContain("line number");
    expect(proseDrift(null, list)).toEqual(["census block missing"]);
  });
});
