# Keystroke Sanctity — Findings + Architectural Refactor Memo

_Date: 2026-05-23_

## TL;DR

Per-keystroke lag in the Virgil editor has a single root cause: **eight separate plugins and hooks each subscribe independently to `editor.on('update' | 'transaction')` and respond by walking the whole document one or more times to re-derive their state.** The transaction's structural information (`tr.steps`, `tr.mapping`) — which describes precisely what changed — is ignored. Each plugin essentially does `oldArray.diff(newArray)` instead of inspecting the operation that just happened.

The fix is a single architectural shift, not a bag of patches:

> **Keystroke sanctity:** Only one plugin reads every transaction synchronously — a `DocStructureObserver` that does cheap step inspection and publishes typed structural events. All other "react to doc changes" work subscribes to those events. Decoration plugins use the canonical `DecorationSet.map(tr.mapping)` pattern. A keystroke that doesn't change structure must trigger zero downstream work.

Done right, a keystroke in the middle of a paragraph triggers ProseMirror's own apply, one cheap fast-path bail-out in the observer, and nothing else. Structural keystrokes (Enter, deleting a footnote marker, pasting a block) fire typed events to exactly the relevant subscribers — and those subscribers receive the diff, not the document.

---

## 1. The full inventory of per-keystroke reactors

Definition: fires on `editor.on('update' | 'transaction')` for `tr.docChanged` transactions and does work proportional to document size, not edit size.

### 🔴 Red — full doc walks, unthrottled, per keystroke

| Title | File:line | What it does for the user |
|---|---|---|
| Footnote orphan watcher | `src/lib/tiptap/footnote.ts:155–200` | Detects when a footnote marker is deleted so the matching note in the panel can be tidied up. Walks `oldState.doc` + `newState.doc` per keystroke. |
| Anchor orphan watcher | `src/lib/tiptap/linked-anchor.ts:114–132` | Same idea for any text range that has a card linked to it (notes, cuts, revisions, comments). Two full doc walks. |
| Marginalia anchor guard | `src/lib/tiptap/linked-anchor.ts:187–250` | Re-inserts an empty paragraph with the same UUID when the only paragraph a margin card is attached to gets deleted, so the card doesn't go orphan. Two full doc walks plus mapping. |
| Section numberer | `src/components/Editor.tsx:1446–1470` | Keeps "1.2.3"-style section numbers next to your headings. Recomputes all heading numbers from scratch per keystroke. |
| Expex example numberer | `src/lib/tiptap/expex.ts:1329–1380` | Renumbers `(1), (2), (3)…` linguistic examples and rebalances gloss columns. Walks all expex blocks per keystroke. |
| LaTeX command highlighter | `src/lib/tiptap/latex-command.ts:60–102` | Styles raw `\cite{...}`/`\ref{...}` so they look like commands. Regex-scans every text node every keystroke. |
| Float-panel content mirror | `src/lib/float-sync.tsx:113–145` | If you've popped a heading/list/etc. into a floating editor, syncs it from the main doc. Re-extracts the source per keystroke. |

### 🟡 Amber — per-keystroke, smaller scope but still polling

| Title | File:line | Notes |
|---|---|---|
| UUID attribute decorator | `src/lib/tiptap/uuid-attr.ts:94–122` | Tags every block's DOM element with its UUID. Walks top-level blocks. |
| PageMark decorator | `src/lib/tiptap/pgmark.ts:59–165` | Renders `\pgmark{N}` page-break markers. Regex-scans text nodes. Early-outs to empty if no pgmarks. |
| LaTeX-comment auto-detector | `src/lib/tiptap/latex-comment.ts:103–120` | Converts paragraphs starting with `% ` into styled comment blocks. |
| Label auto-generator | `src/lib/tiptap/label.ts:91–100` | Emits a stable label node when `}` is typed inside `\label{`. |
| Section-fold pruner | `src/lib/section-folding.ts:111–145` | Removes folded section IDs from the fold set when their heading is deleted. |
| Active text-object resolver | `src/text-objects/active-text-object-context.tsx:150–172` | Figures out which block the cursor is in for the gutter handle and action menu. |
| In-text card position cascader | `src/hooks/useInTextPositions.ts:318–322` | Updates the Y-position map of in-line cards (footnote markers, anchored pills). |
| Marginalia registry structural sync | `src/hooks/useMarginaliaRegistry.ts:432–458` | UUID-set diff for re-subscribing viewport observers. Already cheap, but still polls. |

### 🟢 Per-keystroke but defers / debounces all real work (no change needed)

| Title | File:line | Window |
|---|---|---|
| Autosaver | `src/hooks/useDocument.ts:193–217` | 1500 ms debounce; only resets a timer on keystroke. |
| Word counter | `src/hooks/useWordCount.ts:254–299` | 300 ms debounce, then full doc walk. |
| LaTeX linter | `src/hooks/useLatexLint.ts:30–62` | 1500 ms debounce, then full AST parse. |
| Last-paragraph saver | `src/hooks/useEditorUIState.ts:174–197` | 400 ms debounce for cursor; immediate on fold change. |
| Activity-presence bumper | `src/components/EditorLayout.tsx:953–956` | Increments a counter. |
| `beforeinput` interceptor | `src/components/RichTextField.tsx:433–466` | Cheap normalization. |

### ⚠️ Verify and probably remove

| Title | File:line | Notes |
|---|---|---|
| Old `Marginalia` recheck | `src/components/Marginalia.tsx:81–84` | Pre-registry layout recheck (debounced 120ms). May be dead since `useMarginaliaRegistry` shipped. Grep for consumers and remove if so. |

---

## 2. The diagnosis

Three observations:

1. **Transactions already describe what changed.** Every PM transaction carries `tr.steps` (atomic operations: `ReplaceStep`, `ReplaceAroundStep`, etc.) and `tr.mapping` (positions before → after). The slice being removed by a step is small — typically a single character. To find which footnote/anchor/UUIDs disappeared on a keystroke, you walk the removed slice, not the entire old document.

2. **The current code ignores this.** Every red-category plugin reads `oldState.doc` and `newState.doc` and computes a set diff. That's the equivalent of writing a Redux reducer that ignores the action payload and recomputes the entire store from scratch every dispatch.

3. **Most keystrokes are structurally null.** Typing a character inside an existing paragraph changes no UUIDs, no headings, no footnote IDs, no anchor IDs, no labels, no expex blocks. The downstream watchers do all that work to discover that nothing they care about changed. The fast path doesn't exist; every keystroke pays the slow path.

The cumulative effect: in a doc with footnotes, linked anchors, marginalia, and expex blocks, **a single keystroke triggers somewhere between 6 and 12 full document traversals** before the next paint. That's the lag you're feeling.

---

## 3. Architectural principle: keystroke sanctity

The invariant to enforce — and to encode somewhere lintable:

> **No plugin, hook, or React effect may do work proportional to document size on each keystroke.** Doc-walking work must be event-driven from structural changes derived from `tr.steps`. Decoration plugins must use `DecorationSet.map(tr.mapping)` and re-scan only changed regions.

Practical operationalization:

1. **Exactly one plugin** subscribes to every transaction: `DocStructureObserver`. Its `apply` is O(edit size) in the worst case and O(1) in the common case.
2. **Every other "react to doc changes" hook/plugin** subscribes to typed events from the observer. Receives the diff, not the document.
3. **Decoration plugins** use `oldSet.map(tr.mapping)` to re-position existing decorations (microseconds) and re-scan only the touched regions.
4. **Layout-derived state** (already mostly fixed by `useMarginaliaRegistry`) is driven from layout observers, never from edit events.
5. **No new `editor.on('update' | 'transaction')` subscription** survives the rewrite except the observer itself and the handful of explicitly-permitted O(1) hooks (autosaver, presence bumper, etc.).

---

## 4. Proposed architecture

### 4.1 `DocStructureObserver`

A single ProseMirror plugin maintaining an incrementally-updated structure index:

```ts
// src/lib/tiptap/doc-structure/types.ts
export type DocStructure = {
  version: number;                                    // monotonic, bumps on any structural change
  uuids:     ReadonlySet<string>;                     // all anchorable-block UUIDs
  headings:  ReadonlyArray<{ uuid: string; level: number; pos: number; text: string }>;
  footnotes: ReadonlyArray<{ id: string; pos: number }>;
  anchors:   ReadonlyArray<{ id: string; from: number; to: number; kind: string }>;
  examples:  ReadonlyArray<{ id: string; pos: number }>;    // expex
  labels:    ReadonlyArray<{ id: string; pos: number }>;
  comments:  ReadonlyArray<{ pos: number }>;                // latex comment blocks
};

export type StructureDiff = {
  // Every field is a delta. Empty array = nothing in that category changed.
  addedUuids:      string[];
  removedUuids:    string[];
  addedHeadings:   HeadingEntry[];
  removedHeadings: HeadingEntry[];
  changedHeadings: HeadingEntry[];          // text or level changed but UUID stable
  addedFootnotes:  FootnoteEntry[];
  removedFootnotes: FootnoteEntry[];
  addedAnchors:    AnchorEntry[];
  removedAnchors:  AnchorEntry[];
  addedExamples:   ExampleEntry[];
  removedExamples: ExampleEntry[];
  addedLabels:     LabelEntry[];
  removedLabels:   LabelEntry[];
  // Blocks whose CONTENT (not identity) changed — needed by float-mirror.
  contentChangedUuids: string[];
};
```

The plugin's `apply`:

```ts
apply(tr, prev: DocStructureState, oldEditorState, newEditorState) {
  if (!tr.docChanged) {
    return prev;                                       // selection / mark-only / meta-only: O(1) bail
  }
  const diff = inspectSteps(tr, oldEditorState.doc, newEditorState.doc);
  if (isEmpty(diff)) {
    return prev;                                       // structurally null edit: O(edit-size) bail
  }
  const next = applyDiff(prev.structure, diff);
  return { structure: next, pendingDiff: diff };
}
```

The key piece is `inspectSteps`. It walks **only**:
- The slices removed by each step (`oldDoc.slice(step.from, step.to)`), to find which structural entities disappeared.
- The slices inserted by each step (`step.slice` for `ReplaceStep` / `ReplaceAroundStep`), to find which were added.
- Optionally checks `tr.mapping` to detect position changes for stable-ID entities (rare; needed for `pos` updates).

For a one-character insertion, both slices contain a single text node — no structural entities at all. `inspectSteps` returns an empty diff. The fast path triggers and the entire downstream chain skips.

For a `Backspace` that removes a heading, the removed slice contains a heading node with a UUID. `inspectSteps` returns `{ removedHeadings: [...], removedUuids: [...] }`. Two typed events fire. Two subscribers wake up.

### 4.2 Event dispatch

The observer plugin has a `view` spec with an `update(view, prevState)` hook. This fires once per transaction, AFTER all plugins have applied and the view has reconciled. It reads `pendingDiff` from the plugin's state and dispatches typed events on an `EventTarget` that lives on the editor.

```ts
// src/lib/tiptap/doc-structure/observer-plugin.ts
const observerPlugin = new Plugin<DocStructureState>({
  key: docStructureKey,
  state: { init, apply },
  view(view) {
    const bus: DocStructureBus = view.editor._docStructureBus; // attached at editor-create time
    return {
      update(view, prevState) {
        const { pendingDiff } = docStructureKey.getState(view.state)!;
        if (!pendingDiff) return;
        bus.emit(pendingDiff);                          // single fan-out, typed events
      },
    };
  },
});
```

The bus exposes:

```ts
export interface DocStructureBus {
  // Snapshot reads
  get structure(): DocStructure;

  // Typed subscriptions; return unsubscribe
  onUuidsRemoved(fn: (uuids: string[], structure: DocStructure) => void): Unsub;
  onUuidsAdded(fn: (uuids: string[], structure: DocStructure) => void): Unsub;
  onHeadingsChanged(fn: (headings: HeadingEntry[], structure: DocStructure) => void): Unsub;
  onFootnotesRemoved(fn: (ids: string[], structure: DocStructure) => void): Unsub;
  onAnchorsRemoved(fn: (anchors: AnchorEntry[], structure: DocStructure) => void): Unsub;
  onExamplesChanged(fn: (examples: ExampleEntry[], structure: DocStructure) => void): Unsub;
  onLabelsChanged(fn: (labels: LabelEntry[], structure: DocStructure) => void): Unsub;
  onCommentsChanged(fn: (comments: CommentEntry[], structure: DocStructure) => void): Unsub;
  onBlockContentChanged(uuid: string, fn: () => void): Unsub;   // for float-mirror

  // Convenience: any structural change at all
  onAnyChange(fn: (diff: StructureDiff, structure: DocStructure) => void): Unsub;
}

// React-side convenience hook
export function useDocStructure(): DocStructure;
export function useDocStructureBus(): DocStructureBus;
```

### 4.3 Plugin ordering

The observer **must run first** so that downstream plugins' `appendTransaction` hooks (if any survive) can read the diff from `tr.meta`. In TipTap, this means the observer extension must be added before any plugin that needs to consume structural events synchronously within the same transaction.

In practice, since we're migrating everyone OFF synchronous transaction listening, the only thing that needs the diff synchronously is the marginalia anchor guard (it dispatches a new transaction). That can remain as an `appendTransaction` plugin that calls into `inspectSteps`-like logic, OR it can be eliminated entirely — see §6.

---

## 5. Per-consumer migration map

| Current consumer | Migration |
|---|---|
| **Footnote orphan watcher** | Delete its `appendTransaction`. Subscribe to `onFootnotesRemoved(ids => emitOrphanEvents(ids))`. The orphan-event dispatch was already deferred via `setTimeout(0)`; it still is. |
| **Anchor orphan watcher** | Same pattern. `onAnchorsRemoved(anchors => emitAnchorOrphanedEvents(anchors))`. |
| **Marginalia anchor guard** | See §6 — preferred path is to delete it entirely. If kept, it stays as a small `appendTransaction` plugin that consumes the diff (already computed by the observer) instead of recomputing. |
| **Section numberer** | Subscribe to `onHeadingsChanged`. Cache section numbers keyed on heading UUIDs. Re-emit decorations only when heading set or levels actually changed. Use `DecorationSet.map(tr.mapping)` for position re-syncing in between. |
| **Expex numberer** | Subscribe to `onExamplesChanged`. Same pattern — recompute numbers only when the example set changes. |
| **LaTeX command highlighter** | Doesn't use the observer. Switch to the canonical PM decoration-mapping pattern (§7). Re-scan only the regions `tr.mapping` reports as changed. |
| **PageMark decorator** | Same as LaTeX command highlighter. |
| **UUID attribute decorator** | Same — `oldSet.map(tr.mapping)` + add/remove decorations for `addedUuids`/`removedUuids` from the observer's diff. |
| **LaTeX-comment auto-detector** | Subscribe to `onBlockContentChanged` for blocks whose first text run might be `% `, OR keep as a small `appendTransaction` plugin gated on the observer's diff. |
| **Label auto-generator** | Keep as `appendTransaction` (it needs to dispatch a transaction synchronously), but read the diff from the observer instead of walking. Or — even simpler — gate on whether `}` is the inserted character and inspect only the slice around it. |
| **Section-fold pruner** | Subscribe to `onHeadingsRemoved`. Prune folded set when removed headings include folded UUIDs. |
| **Active text-object resolver** | Subscribe to `onUuidsAdded`/`onUuidsRemoved` for structural changes, AND continue subscribing to `selectionUpdate` for cursor-position resolution. (Cursor moves are separate from doc changes; this hook legitimately needs both signals, just not the heavy doc walk on every keystroke.) |
| **In-text card position cascader** | Subscribe to `onUuidsAdded`/`onUuidsRemoved` for structural changes. Layout reads (`coordsAtPos`) only when structure changes; positions of unchanged blocks are stable. |
| **Marginalia registry structural sync** | Already cheap (UUID-set diff), but trivial to swap onto `onUuidsAdded`/`onUuidsRemoved` and remove the manual diff. |
| **Float-panel content mirror** | Subscribe to `onBlockContentChanged(uuid)` for each float's anchor UUID. Most keystrokes change one block; most floats sit idle. |

After this, the things that still subscribe directly to `editor.on('update' | 'transaction')` are:

- `DocStructureObserver` itself.
- The autosaver (debounced timer reset; trivial).
- The activity-presence bumper (counter increment; trivial).
- Possibly the label auto-generator and marginalia anchor guard, if they remain as `appendTransaction` plugins. Both consume the observer's diff and do O(edit-size) work.

That's the target: **3 to 5 subscribers, none of them doing doc walks.**

---

## 6. The deepest question: does the marginalia anchor guard need to exist?

The guard's job is to re-insert an empty paragraph with the same UUID when the user deletes the only paragraph a margin card is anchored to. Its existence is a consequence of the anchor strategy: cards point to paragraph UUIDs, and full-paragraph deletion destroys the UUID. The guard fights this by silently rebuilding ghost paragraphs.

This is the architectural smell. Two alternatives:

### Option A: Embrace orphans, expose an "orphan tray"

When the paragraph is gone, the card becomes orphaned and surfaces in a homeless-cards tray in the panel. The user re-anchors with a click, or the system auto-snaps to a likely neighbor (previous block of same kind).

- **Pros:** Zero per-keystroke work. Cards never silently morph the document. Users see what happened.
- **Cons:** Adds one UI affordance (the tray). Users have to make explicit re-anchoring decisions that the silent-ghost behavior was hiding.
- **Effort:** ~1 week.

### Option B: Content-addressed anchors

Cards store a hash of the anchored text + neighborhood. Deletion → orphan → system attempts re-find on next idle. This is what e.g. CodeMirror's collab plugin does for stable references.

- **Pros:** Cards survive structural shuffling (paragraph merges, splits, copy-paste).
- **Cons:** Real engineering. Needs tuning. Edge cases.
- **Effort:** ~1 quarter.

### Recommendation

**Ship Option A as part of this rewrite.** It removes a per-keystroke plugin, surfaces a class of bug that's currently silent, and adds one component (the tray) that's straightforwardly designed. Option B is a future investment if the orphan-tray UX proves clumsy.

If you don't want to touch this in the same rewrite, then keep the guard but rewrite it to consume the observer's diff. It becomes ~20 lines of cheap code instead of two doc walks. Either way, the per-keystroke cost disappears.

---

## 7. Decoration plugins: the canonical pattern

Three current plugins are decoration plugins (`latex-command`, `pgmark`, `uuid-attr`). They don't need the observer — they need to use the standard PM idiom for incremental decoration sets:

```ts
const decorationPlugin = new Plugin({
  state: {
    init(_, state) {
      return buildInitialDecorations(state.doc);
    },
    apply(tr, oldSet, _oldState, newState) {
      // Cheap: re-position existing decorations through the change.
      let set = oldSet.map(tr.mapping, tr.doc);
      if (!tr.docChanged) return set;
      // Re-scan only the regions tr touched.
      tr.mapping.maps.forEach((stepMap) => {
        stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
          set = rescanRegion(set, newState.doc, newFrom, newTo);
        });
      });
      return set;
    },
  },
  props: {
    decorations(state) {
      return this.getState(state);
    },
  },
});
```

For docs without any matches (no `\cite{}` in the file, no `\pgmark{}` markers), `rescanRegion` finds nothing and the set stays empty. Mapping a 1000-decoration set through a one-character transaction is microseconds. The current code re-scans the entire doc on every keystroke regardless.

Same pattern for `uuid-attr`: existing UUID node-attribute decorations get mapped through `tr.mapping`; only the regions where blocks were inserted/removed need new decorations. The observer's `addedUuids`/`removedUuids` can drive this directly.

---

## 8. Implementation plan (one giant rewrite)

The user has chosen one giant rewrite over incremental. The shape:

1. **Verify the inventory.** Re-grep for `editor.on('update'` and `editor.on('transaction'` and `appendTransaction`. List every hit. Confirm this memo is comprehensive; add anything missing to the per-consumer migration map.

2. **Build `DocStructureObserver`.** New folder `src/lib/tiptap/doc-structure/`. Land:
   - `types.ts` — `DocStructure`, `StructureDiff`, entry types
   - `step-inspector.ts` — `inspectSteps(tr, oldDoc, newDoc): StructureDiff`
   - `structure-index.ts` — `buildInitial(doc)`, `applyDiff(prev, diff)`
   - `observer-plugin.ts` — the PM plugin + view spec
   - `bus.ts` — the typed `DocStructureBus` + `useDocStructure*` hooks
   - Tests for `inspectSteps` and `applyDiff` covering: typing inside a paragraph (empty diff), splitting a paragraph, deleting a heading, pasting a multi-block slice, undoing each of the above.

3. **Wire the observer into the editor.** Add it as a TipTap extension. Confirm `useDocStructure()` returns sensible values during dev-doc browsing. Confirm zero events fire when typing inside a paragraph.

4. **Migrate consumers in dependency order:**
   - **First:** the decoration plugins (`latex-command`, `pgmark`, `uuid-attr`) onto the canonical mapping pattern. Independent of the observer — can go first.
   - **Next:** the orphan watchers (`footnote`, `linked-anchor` orphan, marginalia anchor guard). Subscribe to observer events. **Marginalia anchor guard: decide A or B per §6.** If A, build the orphan tray; if deferred, rewrite the guard to consume the diff.
   - **Then:** the numbering plugins (`section-numbers`, `expex` numberer). Subscribe and memoize on heading/example sets.
   - **Then:** `latex-comment` detector, `label` auto-generator, `section-folding` pruner. Each becomes either a tiny diff-consuming `appendTransaction` or an observer subscriber.
   - **Then:** `float-sync`, `useInTextPositions`, `useMarginaliaRegistry` structural sync, `active-text-object-context`. The React-side consumers.

5. **Sweep `editor.on('update' | 'transaction')`.** Grep again. Every remaining subscription must be on the explicitly-permitted list (autosaver, presence bumper, observer, plus any consciously-kept `appendTransaction` plugins). Anything else fails review.

6. **Verify on the dev doc.** `samples/annotation-history` exercises every card panel and most formatting (footnotes, citations, examples, notes, todos, suggestions, bib reviews). Refresh `virgil-data/doc_devtest` from it and confirm visual parity. Type a long burst in the middle of a long paragraph and confirm latency feels qualitatively different.

7. **Verify the legacy `Marginalia.tsx`.** Grep for consumers. If `useMarginaliaRegistry` has replaced it, delete `src/components/Marginalia.tsx`.

8. **Encode the invariant.** Add a section to `AGENTS.md` (or wherever architectural conventions live) titled "Keystroke sanctity" with the rule, the list of permitted direct-transaction subscribers, and a pointer to this memo. Future PRs that add `editor.on('update' | 'transaction')` get pushed back unless they're on the list.

---

## 9. Verification

After the rewrite:

- **Console check:** Typing 100 characters in a long paragraph should fire **zero** events on the `DocStructureBus`. (Verifiable by instrumenting `bus.emit` to count.)
- **Console check:** Pressing Enter to split a paragraph fires exactly one event tick (`onUuidsAdded` with one UUID). Deleting that paragraph fires `onUuidsRemoved`.
- **Frame-time check:** Type a 200-char burst on the long dev doc. Browser DevTools Performance panel: no main-thread tasks > 8 ms attributable to plugin applies. Before the rewrite this is consistently 20–50 ms per keystroke on a doc with footnotes + anchors.
- **Grep check:** `rg "editor.on\(['\"](update|transaction)" src/` returns at most the 3–5 permitted subscribers.
- **Behavior parity:** Section numbers, expex numbering, footnote orphan handling, anchor orphan handling, LaTeX command styling, page-mark rendering, float-panel sync all visibly identical to before. Card panels still display correctly.

---

## 10. Out of scope (acknowledge, defer)

These are real but separate from the keystroke-sanctity refactor:

- **Word counter's full-doc walk after debounce.** Can become incremental on the observer's diff in a follow-up. Not on the keystroke path; doesn't block the rewrite.
- **LaTeX linter's full re-parse after debounce.** Same — incrementalize later.
- **Editor mirror's transaction replay** (`src/components/EditorMirror.tsx:93`). RAF-deferred; doesn't block the keystroke. Could later be observer-driven for cheaper resyncs but not urgent.

---

## 11. What survives on the keystroke path

After the rewrite, when the user types one character inside an existing paragraph:

1. ProseMirror's own transaction apply (unavoidable, cheap).
2. `DocStructureObserver.apply` — checks `tr.docChanged` (true), inspects `tr.steps` (one ReplaceStep with a one-char slice, no structural entities), returns the same plugin state. **O(1).**
3. Decoration plugins' `apply` — `oldSet.map(tr.mapping)` (microseconds) + `rescanRegion` over a one-character span. **O(1).**
4. Autosaver's `onUpdate` — clears and resets a `setTimeout`. **O(1).**
5. Activity-presence bumper — increments a counter. **O(1).**

Five callbacks, all O(1), totaling well under a millisecond on a modern machine regardless of document size. That's the standard.

When the user presses Enter to split a paragraph:

1. ProseMirror apply.
2. Observer detects a new UUID, emits `onUuidsAdded` and `onBlockContentChanged` for the predecessor.
3. Subscribers wake up: marginalia registry attaches an observer to the new block, in-text positions cascader updates one entry, active text-object resolver re-resolves, float-sync (if a float points to the predecessor) re-extracts. Each is O(1) in the size of the change.
4. Decoration plugins map through; no rescan needed unless the user typed within a styled region.

That's the architectural goal. Everything else is implementation detail.
