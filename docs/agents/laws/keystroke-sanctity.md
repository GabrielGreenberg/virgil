<!-- last-verified: 3a8f4892 2026-09-15 -->
<!-- derives-from: AGENTS.md#laws -->
<!-- covers-code: src/lib/tiptap/doc-structure, src/hooks/useStructuralRevisions.ts, src/hooks/useInTextPositions.ts -->

# Keystroke sanctity

> **No plugin, hook, or React effect may do work proportional to document size on each keystroke.** Doc-walking work must be event-driven from the typed structural diff. Decoration plugins must use `DecorationSet.map(tr.mapping)` and re-scan only changed regions.

The diff is produced once per transaction by `DocStructureObserver` ([src/lib/tiptap/doc-structure/](../../../src/lib/tiptap/doc-structure/)) — the **first** extension in the editor's extension list. It inspects `tr.steps` (O(edit-size), O(1) bail on `!tr.docChanged`) and publishes typed events on an editor-attached `DocStructureBus`.

**Consume the diff. Don't walk the doc.**

- From a ProseMirror `appendTransaction`: `readPendingDiff(newState)` returns the current `StructureDiff`.
- From a React component: `useDocStructure(editor)` / `useDocStructureBus(editor)` / `useDocStructureEvent(editor, "onHeadingsRecomputable", fn)`.
- From a long-lived hook: `getBus(editor)` for direct subscription.

### Permitted `editor.on('update' | 'transaction')` subscribers

The keystroke-sanctity sweep allows these direct subscriptions, because each is O(1) per transaction (debounced timer reset, counter bump, or RAF-coalesced layout read). This list is CI-enforced: [src/lib/\_\_tests\_\_/keystroke-subscriber-guardrail.test.ts](../../../src/lib/__tests__/keystroke-subscriber-guardrail.test.ts) greps `src/` AND `library/` for the `editor.on("update"|"transaction", …)` call form and fails if any subscribing file is missing from its allowlist — `PERMITTED_KEYSTROKE_SUBSCRIBERS` for `src/` (this prose list), `PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS` for the library silo (prose twin in library/AGENTS.md "Perf doctrine"; sole entry: `usePgmarkPages`, docChanged-gated). The same discipline the scroll-anchor sibling has — see "Scroll-anchor stability" below. Keep list and prose in sync: a new subscriber must be added to BOTH, each with its "why it's O(1)" justification.

- `useDocument.ts` autosaver (1500 ms debounce; subscribes via TipTap's `onUpdate` option through the `EditorPane` wrapper)
- `useEditorUIState.ts` (transaction subscriber persists section folds, gated via the shared `transactionTouchesFold` predicate — fold-meta or docChanged; the last-paragraph saver rides `selectionUpdate`, 400 ms debounce)
- `useWordCount.ts` (300 ms debounce, then full doc walk)
- `EditorLayout.tsx` activity-presence bumper (`:~935`, `on('transaction')`, docChanged-gated counter increment; mounted only while `collab.iHavePen`)
- `EditorPane.tsx` PDF-stale bump (`EditorPane:~939`, `on('update')`; O(1): stamp a timestamp ref, flip `pdfStale` at most once per compile cycle). EditorPane is the SOLE owner of `pdfStale` (P6); the former duplicate `EditorLayout` bump was removed — a code-view edit round-trips through the code-pane bridge into TipTap and fires this same tracker.
- `EditorPane.tsx` Outline-panel doc tick (`:968`, `on('update')`; a debounced 300 ms timer reset + one counter bump — the doc-walk happens later inside the `outlineContent` memo, off the keystroke path)
- `hooks/useLatexSource.ts` diagnostics source feed (`on('update')`; P5 item 4 — mounted once per doc in `EditorPane`, it serializes the LIVE TipTap doc to `.tex` so lint/snippets/jump-anchors populate WITHOUT the code view being opened. O(1) per keystroke: the handler only resets a debounce timer; the O(doc) `serializeToLatex` runs in the debounced callback, off the keystroke path. Suppressed while the code view feeds `sourceText` directly via `CodeEditor.onTextChange`.)
- `EditorLayout.tsx` section-path recompute, main pane (`:~2019`, `on('update')`; the handler only `cancelAnimationFrame`+`requestAnimationFrame` + a perf-flag gate — and since Wave-2 C2 the DEFERRED compute's primary path is `computeSectionPathAt` (ONE `posAtCoords` + snapshot binary search, behind `geomBreadcrumbEnabled()`); the `coordsAtPos` doc-walk survives only as the `virgil:geom-breadcrumb` flag-off/service-null fallback, and the resize path is gesture-parked)
- `SelectionActionsMenu.tsx` margin-bolt reposition (`:275`, `on('update')`; suppression check + RAF-already-scheduled bail — the single `coordsAtPos` placement math is RAF-coalesced and short-circuits on a placement-equality bail)
- `PendingChangePill.tsx` pending-change margin-pill reposition (`:364`, `on('update')`; schedules a RAF and early-returns if one is pending, plus a `placementsEqual` bail on the single `coordsAtPos` placement — the same RAF-coalesced fixed portal recorded on the `PERMITTED_SCROLL_REPOSITIONERS` scroll allowlist)
- `src/components/editor-layout/panels/omni-fold-mirror-invalidation.ts` fold-mirror invalidation SSOT (`subscribeFoldMirrorInvalidation`, `on('transaction')`; consumed by omni-host's `editorTick` effect). Its transaction handler is a single `getMeta(sectionFoldingPluginKey)` check — bumps ONLY on a fold-meta tx, returns immediately on a plain keystroke. Its other sources are structural DocStructureBus events (headings/blocks added/removed/reordered) — it MIRRORS the section-folding plugin's own `hiddenIdx`-rebuild trigger set so the omni fold mirror never reads a stale absolute-top-level-index set after a block add/remove/reorder while a section is folded (task 126). None of these fire on a plain in-block keystroke, so `emitCount` stays flat.
- `lib/code-pane-bridge.ts` TipTap→code sync (`:470`, `on('transaction')`; docChanged-gated + own-write (`syncing`) filtered, then a debounced serialize — O(1) per tx)
- `lib/doc-products/pipeline.ts` — THE single DocProducts subscriber (perf Wave 1, flag `virgil:doc-products`): the update handler is a dirty flag + one timer reset (O(1)); every O(doc)/O(changed) product refresh (shared docJson, per-block-cached `.tex`, word counts) runs in the 300 ms interactive tier or the `requestLowPriority` idle tier, off the keystroke path. Flag-on it replaces the useLatexSource / useWordCount / EditorPane outline-tick / editor-ops latestDoc subscribers; derived doc products come from `getDocProducts(editor)`, never a private `getJSON` timer.
- `lib/section-folding.ts` shared fold-chevron refresher (the `sectionFoldingPlugin` `view()`; ONE plugin-view per editor, not N per-heading subscribers — #29 nit-3). Its `update(view, prevState)` does an O(1) reference-compare of the `SectionFoldingState` (`sectionFoldingPluginKey.getState` old vs new) and bails on a plain keystroke — the apply reducer returns the SAME object on a structurally-null tx. Only on a real fold change does it `querySelectorAll('.heading-fold-chevron')` and resync each from live state via `closest('[data-uuid]')`, off the keystroke path. The per-NodeView `refreshFoldBtn()` at construction + in `update()` (editor-extensions.ts) is retained and is O(1)-per-affected-node — it is NOT an `on('transaction')` subscriber, so needs no list entry.
- `lib/tiptap/inline-atom-grab.ts` atom-grab affordance stamp (the `InlineAtomGrab` plugin's `view()`; ONE plugin-view per editor, task 524). Its `update()` writes `data-atoms-graspable` from `atomsAreGraspable` — the same expression the mousedown handler gates the GESTURE on, so the CSS `cursor: grab` and the drag cannot disagree. [cost: O(1)/tx] two boolean reads plus one `getAttribute` compare, idempotence-gated (a `setAttribute` invalidates style even at an unchanged value — task 430), so a plain keystroke costs a string compare and writes nothing. Like its sibling above it is NOT an `on('transaction')` subscriber, so it is prose-listed here and not in the guardrail's allowlist, whose census greps that call form.
- `SlashCommandPopup.tsx` (mounted only while the popup is open; RAF-coalesced reposition)
- `TextObjectGrabHandle.tsx` (docChanged-gated → RAF-coalesced placement resolve. Since task 336 the RAF body is bounded by **input modality**, not by luck: the HOVER branch is the only pointer-derived one and is answered only in POINTER modality, so a keystroke resolves the selection branches and stops — a collapsed caret costs a `from !== to` compare, a live selection one O(depth) ancestor walk plus one placement. Its two earlier one-liners here are both worth remembering: "docChanged-gated, cheap" was the gate-not-callback failure mode this list's own rule outlaws (corrected in Wave-4 P6), and its replacement then *documented* the armed-hover cost as an accepted caveat rather than fixing it — see "Input modality" below.)
- `EditorMirror.tsx` (RAF-deferred replay). PARKED since task 115 — its only consumer, `SplitEditorPanes`, is deliberately unmounted, so this subscriber cannot run today. It stays listed because the file still makes the subscription and the guardrail greps files, not mounts.
- `Marginalia.tsx` (RAF-coalesced host-element notify)
- `float-sync.tsx` (`useMainTransactionSync`, one subscription per OPEN text-object float). docChanged-gated + own-write meta filter + the **source-touch gate** (task 140): the handler maps the float's live source range forward through the transaction's steps — and its `appendedTransactions`' — asking in the same O(steps) pass whether any step intersected it, and invokes `readSource` only if one did (steps, not step maps: see the note below on `StepMap.empty`). That third gate is the load-bearing one: `readSource` is O(doc) in every body, so the first two alone made each main keystroke cost a full-document walk PER OPEN FLOAT. **This is the entry that proves a justification must describe the CALLBACK, not just the gate** — it previously read "O(1) per tx", which was true of the subscriber and false of what it called, and the grep guardrail can only see the `editor.on(...)` call form. Contract: [src/lib/\_\_tests\_\_/float-source-touch-gate.test.tsx](../../../src/lib/__tests__/float-source-touch-gate.test.tsx) counts `readSource` calls on the real hook against a real editor — typing in five other paragraphs with three floats open must run it zero times.
- `src/lib/identity/useIdentityBusConsumer.ts` — the SINGLE inline-atom bus consumer (PLAN D1.2/D1.4; behind `virgil:identity-cascade`, default OFF). NOT an `editor.on(...)` subscriber: it opens exactly ONE `DocStructureBus.onAnyChange` subscription (`onAnyChange` is `emitCount`-gated, so it never fires on a plain keystroke), then bails O(1) when no citation/footnote entered or left the transaction. Only on a markerless re-parse (same-tx add+remove of atoms whose ids regenerated) does it run `detectRegenRemap` — O(addedAtoms+removedAtoms) = edit size, never doc size — and route the `oldId→newId` remap through the `IdentityCascade` so selection/float/pin survive (OMNI-F3-02, CI-A3-01, the CI-F1-02 id-survival class). This is the **+1, not +3** consumer: Wave-2 T2 (inline-atom lifecycle) and T5 (citation add-resync) register as ordered POLICIES on this one dispatcher (`registerPolicy`) rather than opening their own `onCitations*`/`onFootnotes*` subscriptions. Typing N plain chars leaves `__virgilBusStats().emitCount` flat and runs zero consumer code.

**Plugin `apply` / `appendTransaction` bodies are censused too** (task 433) — see "The probe half" below: a whole-document walk reachable from one must take the `touchedTextblocks` door or carry a `[cost: …]` line directly above the method ([plugin-apply-guardrail.test.ts](../../../src/lib/__tests__/plugin-apply-guardrail.test.ts)).

Anything else added to that list needs a comment explaining why it's O(1) — and a matching entry (with the same justification) in the `PERMITTED_KEYSTROKE_SUBSCRIBERS` allowlist of the guardrail test above, or CI fails. **Cost-class tags (Wave-4 P6):** every allowlist justification must BEGIN with a `[cost: …]` tag naming the per-event cost AND the deferred body's class ("RAF-coalesced" alone no longer qualifies — a RAF-coalesced O(doc) walk is still an O(doc) walk one frame later); the guardrail's tag-format test enforces the prefix. **selectionUpdate census (Wave-4 P6):** `editor.on("selectionUpdate", …)` is governed by the SAME test under its own exact-set allowlists (`PERMITTED_SELECTION_SUBSCRIBERS`; the library twin is deliberately empty) — the caret moves on every keystroke, so a selection handler IS a keystroke handler; the 8 censused sites are tag-justified in the test, which is their SSOT. The lone `<VirgilEditor onUpdate=` JSX mount (EditorPane) is pinned by its own census in the same file.

**A justification must cover the CALLBACK, not just the gate.** The grep guardrail sees the `editor.on(...)` call form and the surrounding conditionals; it cannot see the cost of what the handler *calls*. `float-sync.tsx` sat on this list for a year reading "docChanged-gated + own-write meta filter — O(1) per tx" — accurate about the subscriber, silent about the O(doc) `readSource` behind it, so CI was green while the law was broken once per open float per keystroke (task 140). When you write or review an entry, name what the handler ultimately runs and why *that* is bounded. If the callback is O(doc), the fix is a gate that answers "is this transaction relevant to me?" from the edit — the observer's `StructureDiff` for entity-shaped questions, or [src/lib/float-source-range.ts](../../../src/lib/float-source-range.ts) (`trackSourceRange`) for positional ones, which maps a tracked region through the transaction's steps and tests intersection in one O(steps) pass. Note that `readPendingDiff` is NOT available to an `editor.on('transaction')` handler — the observer's `view.update` clears it before TipTap emits the event — which is why the positional primitive exists.

**Writing a positional gate: a step map is not a description of what changed.** It describes how positions MOVE, so a step that moves nothing returns `StepMap.empty` — `AddMarkStep`, `RemoveMarkStep`, `AddNodeMarkStep`, `RemoveNodeMarkStep`, `AttrStep`, `DocAttrStep`. Their transactions are still `docChanged`. A gate that reads `tr.mapping.maps` alone therefore concludes "nothing happened" when the user bolds a word, and for a mirroring consumer that is worse than a stale render: the float keeps its pre-bold copy and its next write-back rebuilds the source from it, **deleting the mark from the document** (with `addToHistory: false`, so not even undoable). Ask the STEP, not just its map, and fail safe on a shape you don't recognize — `stepTouches` in the primitive above. Two other things a positional gate must handle: TipTap emits one `transaction` event per dispatch carrying `appendedTransactions` alongside the root, and all of them land in the state, so all of them must be mapped; and an own-write filter must ignore only the *root* transaction it authored, because an appended transaction that reshaped that write (a renumber, a uuid re-mint, a normalizer replacing the block) is exactly the case that must re-read.

**Wall-clock services are exempt from this list** (they are not `editor.on(...)` subscribers and do no per-keystroke work). The **`DiskWatcher`** ([src/lib/disk-watcher.ts](../../../src/lib/disk-watcher.ts), mounted by `DiskWatcherProvider`) is one: a per-doc `setInterval` poller (~3 s, paused while `document.hidden`, immediate on tab-focus) that detects out-of-band edits to the `.tex`/`.bib` on disk (the external-change badge). It *pulls* the `saveTimerRef.current !== null` dirty flag at poll time — never subscribes to the editor — so typing leaves `__virgilBusStats().emitCount` flat. False positives are killed by the `diskLedger` ([src/lib/disk-ledger.ts](../../../src/lib/disk-ledger.ts)), stamped only on load + writes, never on plain reads.

### Card-source derivation: no raw update counters

Panel/card data (footnotes, citations, examples, archive order, marginalia markers) is derived from the live editor on demand. **Gate those memos on the per-category counters from [`useStructuralRevisions`](../../../src/hooks/useStructuralRevisions.ts) (built on the `DocStructureBus`) — never on a `docVersion`-style counter bumped from `editor.on('update')`.** A structurally-null keystroke (typing inside a paragraph) fires no structural event, so nothing re-derives and no card re-renders or shifts. Live in-text positions come from the observer's snapshot (`getBus(editor).structure`), resolved at measure time in [`useInTextPositions`](../../../src/hooks/useInTextPositions.ts) — not from re-walked arrays, which would drift on the keystroke that wraps a line. Since the typing-latency fix (2a) the snapshot's own maintenance is O(edit) too: a structurally-null tx only ACCUMULATES its StepMaps (no entity iteration, no Map clones), and the O(entities) remap materializes lazily at consumer-read time (`readDocStructure`, RAF/user-paced; capped at 32 pending maps). Per-keystroke `appendTransaction` guards resolve single touched blocks via `resolveTouchedBlock` without materializing. `window.__virgilBusStats().materializeCount` must stay flat while typing. The observer tracks blocks, headings, footnotes, **citations** (`CitationEntry` — including container-nested cites tagged with the generalized `nestedInContainerId: { kind: "footnote" | "example", id }`, surfaced load-only by `buildInitial`; the legacy `nestedInFootnoteId` is retained byte-for-byte alongside the footnote case), anchors, examples, figures, and labels. Verify with `window.__virgilBusStats()` in the dev preview: typing N plain characters must leave `emitCount` (and `materializeCount`) unchanged.

**The cap's cost, measured rather than assumed (task 337).** Past `MAX_PENDING_MAPS` (32) the fold runs ON the keystroke path, inside plugin `apply` — a designed trade (the cap bounds remap cost) that had never been priced on a rich document. Measured through the REAL observer with 32 pending maps, median of 12 rounds: **0.11 ms at 500 blocks, 0.40 ms at 1 500, 0.67 ms at 3 000** (max 1.1 ms) — linear, ~0.22 µs per tracked entity per fold, so even a 10 000-entity paper stays near 2 ms. Well under the ~4 ms bar, so the cap stands and nothing was amortized. Three honest limits: the harness populates BLOCKS (the dominant collection, and the one that costs a Map clone), extrapolating to the other seven by the fold's linearity; it is jsdom/node, not Chrome; and unlike every other measurement claim in this file it names **no committed reproducer** — it was a one-off harness (a real editor with N uuid'd paragraphs, 32 plain-keystroke dispatches, then a timed `readDocStructure`, median of 12 rounds), deleted rather than committed because a wall-clock assertion in CI is a flaky test wearing a guard's clothes. **Do not raise the cap to make this cheaper** — the cap is what bounds the remap, and the 33rd keystroke of a sustained burst is the only place it is paid.

**Initial population:** the `useStructuralRevisions` counters start at 0 and bump only on *changes* — `buildInitial` emits nothing, so none fire on doc load. A card-source memo must therefore also depend on the reactive **editor instance** (`editor`/`editorInstance` state), not a counter alone, so it computes once the editor mounts. Never gate a `ref`-based derivation (`editorRef.current?.getX()`) on a counter alone — the ref identity never changes and the counter is silent on load, so it reads the not-yet-ready ref once and never refreshes. Derive from the reactive `editor` and thread the result down as a prop (e.g. `footnoteInfos` / `examples` in `EditorPane`).

### The pause half: a cache's granularity must match the granularity of CHANGE

> **A derived-product cache keyed on TOP-LEVEL nodes answers "what changed?" with "the whole top-level block" — which is the truth for a paragraph and a lie for a container.** Where a container's assembly is a pure concatenation of per-child pure functions, the cache RECURSES: the unit of re-derivation is the touched child, at any depth. And a path that exists to be CHEAP must be audited for the O(doc) probe hiding inside its own gate.

This is the "typing in a long bulleted list hitches when I resume after a think-pause" class (task 337) — the pause-tier companion to the per-keystroke costs the modality half took out. Three costs, and the first is the list-specific one:

- **The cache stopped at the container.** ProseMirror re-creates every ANCESTOR of an edited node, so a keystroke inside item 50 of a 100-item enumeration invalidated the LIST. Both doc-products caches then re-derived it whole: a full `toJSON()` deep clone in the 300 ms interactive tier — which lands, by construction, exactly as the user resumes typing — and a full LaTeX re-serialization in the idle tier, whose `requestIdleCallback` carries a forced ~200 ms deadline, so on a real bibliography or enumeration the hitch arrives mid-burst. **Every fixture list in the suite was 2–3 items**, which is the whole reason this was invisible: the cost is real only at the size real papers reach.
- **The decoration floor.** `latex-command`'s plugin called `DecorationSet.find()` **argless** on every `docChanged` transaction whose changed region held no backslash — i.e. every plain keystroke — purely to ask "is the set non-empty?". Argless `find` is the one call on that class that walks the WHOLE decoration tree: `findInner`'s child gate is true for every subtree at the default `0 … 1e9` range, and it allocates a copied `Decoration` per hit. A paper with hundreds of `\commands` paid a full-set walk plus that allocation traffic per character, on the path that exists to be cheap. **The gate bought nothing** — mapping can never ADD a decoration, so an empty set implies an empty mapped set, and the bounded `find(from, to)` loop it guarded already answers `[]` for every range. Same shape as the empty-`StepMap` trap two sections up: the gate was right and the probe inside it was wrong. **Stated precisely, because the win is a constant factor and not an asymptote:** `findInner` iterates the whole `children` array at each level and gates only the RECURSION, so the surviving bounded probe is still linear in the number of DECORATED top-level blocks — measured against the shipped library, 6.56 µs and 600 allocations for the argless call vs 0.37 µs and zero for the bounded one at 300 decorated paragraphs, with the bounded call at 3.28 µs by 3 200. An ~18× cut with the allocations gone, not the removal of all doc-proportional work.
- **The 33rd-keystroke fold**, measured and left alone — see the paragraph in "Card-source derivation" above.

Four rules the cache half earned:

- **The compose predicate is SCHEMA-derived, not a kind list.** `getNodeJson` composes when `node.isBlock && !node.isTextblock && node.content.size > 0` ([block-caches.ts](../../../src/lib/doc-products/block-caches.ts)) — so every container the schema has (lists, items, blockquotes, the expex family, figures) or GAINS is covered with nothing to add, and the boundary lands exactly where `toJSON` stops being expensive: a textblock's children are inline nodes, where per-child WeakMap entries would cost more than they save.
- **The LaTeX half is narrower than the JSON half, and the line is a PROPERTY, not a preference.** The serializer memoizes a child only where the parent maps its children through `serializeNode(child, S, D)` with S and D constant across the map — lists, blockquotes, list-item tails — because only there is a child's output a pure function of itself. The expex walkers are deliberately excluded: `serializeExampleBlock` chooses its separator from the PREVIOUS piece's type, so its assembly is not a concatenation, and an example is bounded by its own construct where an enumeration is not. The parent's framing and any post-processing of the JOINED string (`listItem`'s `/\n+$/` tail strip, which can eat into the second-to-last child) stay in the parent, so the composition is byte-neutral by construction.
- **The collector side channel is captured as DATA and replayed.** A memoized child returns `{latex, requirementIds, bibFamily}`; `need` is a Set add (idempotent, commutative) and `needBibFamily` folds first-concrete-wins with distinct ⇒ natbib (also idempotent and commutative), so replaying a hit's pair into the enclosing collector is byte-equivalent to re-running the child inside it — the same argument `foldBibFamilies` already rests on. A cached child that silently dropped its `need("graphicx")` would emit a `.tex` with no `\usepackage`.
- **Deeper sharing makes the read-only contract load-bearing, so the one unguarded mutator was fixed first.** `storage-dev.writeDocBundle` ran `assignUuids(content)` **unconditionally** on the caller's object — which under the pipeline is the shared `docJson`. It now mirrors the FSA backend's `needsUuidWork` + deep-copy guard. The memo keys on JSON-object identity, and that is a faithful proxy for PM node identity **only** because composed JSON is cached per node and never mutated. **Do not read this as "the change created the hazard", which the first draft of this paragraph did:** `assignUuids` writes `node.attrs.uuid = …` IN PLACE on the attrs object, and prosemirror's own `toJSON` shares `this.attrs` by reference at every depth (which is why `composeJson` deliberately mirrors that) — so pre-337 the dev backend could already write through the shared snapshot into LIVE ProseMirror node attrs. What composition changes is the BLAST RADIUS: the grandchild wrapper is now the child's cache entry, shared with every prior generation, where before each generation's `toJSON()` minted fresh wrappers. **Stated limit:** the completeness of "the one unguarded mutator" was established by inspection (the only in-place doc-JSON mutators are `assignUuids` and the disabled `recoverOrphanedUuids`; all four `assignUuids` sites are either on a freshly-parsed tree or now guarded), NOT by a census — which is what this file's own doctrine would ask for, and is the honest gap here.

Probe: `window.__docProductsStats()` gains `childPartMisses` / `childPartHits` — a keystroke inside a list must move the first by ONE item's subtree, never by the list. CI: [container-granularity.test.ts](../../../src/lib/doc-products/__tests__/container-granularity.test.ts) drives a REAL 100-item list and measures Tier A with an implementation-INDEPENDENT probe (calls to prosemirror's own `Node.prototype.toJSON`, which `Fragment.toJSON` invokes once per descendant): **301 per keystroke pre-fix, under 20 after**, measured by neutering the fix. Its byte-identity legs compare the cached output against a full cache-free re-serialize, since the produced bytes are the thing that must NOT move. [decoration-probe-cost.test.ts](../../../src/lib/tiptap/__tests__/decoration-probe-cost.test.ts) counts argless `find` calls across a real typing burst (12 pre-fix, 0 after) and censuses both silos for the shape — the plugin was never the only place it can appear, and a second one would be invisible to any behavioural test of this plugin.

#### The probe half: a gate exists because the REBUILD is all-or-nothing

Same plugin, same law, one probe over (task 400) — and the case where the gate
this repo already fixed once grew back, later, under a different name. Task 337
took the ARGLESS `DecorationSet.find()` off `latex-command`'s `apply` because it
was an O(all decorations) call on the path that exists to be cheap. What it left
standing was the SHAPE: three probes in front of an all-or-nothing
`buildDecorations(tr.doc)`.

Each probe was correct. A backslash scan of the changed text, an overlap test
against the mapped set, and — added with the type-time carrier in task 360 — a
MARK-step test, because an `AddMarkStep` carries an empty step map and neither
earlier probe can see the carrier promoting a bare run to the mark, so a
decoration left standing over the now-marked run paints a SECOND `.latex-cmd`
inside the mark's own span and the nested `font-size: 0.9em` compounds to 0.81em.
Every one of them gated a WHOLE-DOCUMENT walk ending in `DecorationSet.create`,
whose `buildTree` re-scans the entire decoration array once per top-level child.
**Measured:** typing the nine characters of `\emph{hi}` into paragraph 0
re-derived **605** decorations in a 60-paragraph document and **2405** in a
240-paragraph one — the keystroke cost scaling with the paper, at ~320 000
`buildTree` iterations per rebuild on a 400-paragraph one. And the reach was
wider than "while typing a command": probe 2 fires for a keystroke ANYWHERE in a
paragraph carrying the `p-cmd-only` NODE decoration, which is every prose
paragraph holding exactly one command run.

> **A probe in front of a re-derivation is a symptom of the re-derivation's
> GRANULARITY. Ask the one question that has an answer — WHICH BLOCKS DID THIS
> TRANSACTION TOUCH — and scope the rebuild to it; there is then nothing left to
> gate.**

Six rules it earned:

- **The empty-StepMap rule now has ONE home.** `AGENTS.md` states it two
  sections down ("a step map is not a description of what changed") and it was
  implemented in three places — one of which did not carry it, which is exactly
  why the third probe had to exist beside a range extractor that could not see a
  mark step. [src/lib/tiptap/changed-ranges.ts](../../../src/lib/tiptap/changed-ranges.ts)
  states it once (`positionalStepRange`) and derives both readings from it: the
  PREDICATE (`stepTouches`, moved out of `float-source-range.ts`) and the
  EXTRACTOR (`touchedRanges`).
- **Two exports, not one function with a boolean, because the two answers are
  different claims.** `contentChangedRanges` (step maps only) is what a consumer
  that derives something FROM TEXT wants — the type-time carrier derives marks
  from characters, so a mark step is its OUTPUT and never its input, and that
  exclusion is what makes its re-entry on its own appended transaction
  terminate. `touchedRanges` (maps plus every positional step) is what a
  consumer that re-derives RENDERING wants. A defaulted argument would be a
  decision nobody made.
- **The narrowing is sufficient because every decoration here is block-LOCAL** —
  inline spans inside one textblock, and a `p-cmd-only` aggregate over one
  paragraph's own children. That is a property to CHECK before scoping a
  rebuild, not a hope: an aggregate over anything wider would need its own
  invalidation.
- **The removal window is "reaches INTO the block", not "lies wholly inside
  it".** `find(from, to)` is inclusive at both endpoints, so a neighbour's
  `p-cmd-only` node deco — whose range abuts exactly — comes back from the query
  and must NOT be dropped; and a mapped inline deco can STRADDLE a boundary
  (press Enter inside a command run and the split maps its `from` into the first
  paragraph and its `to` into the second, where `forChild` paints it on both
  halves), which a wholly-inside test would leave standing. The retired
  whole-document rebuild cleaned that up by accident.
- **The block lookup takes an O(depth) fast path**, and it is shared: an
  ordinary keystroke and every mark step sit inside ONE textblock, so
  `doc.resolve` answers in O(depth) where `Fragment.nodesBetween` walks the
  parent's children from index 0 until it passes `to` — cheap per step, but
  proportional to the block's INDEX. Both plugins in this file consume it, so
  the carrier got the fast path too.
- **It CLOSED a correctness hole no probe could see.** Any OTHER mark landing in
  a `p-cmd-only` paragraph (bolding a word beside the command) changes the
  aggregate from one element child to two — and all three probes missed it,
  because the map is empty and the third filtered on `latexCommand` alone. The
  stale class survived until something else rebuilt the document.

**The silo is the finding — and it is CLOSED (task 433).** Nothing used to grep
a plugin `apply` or an `appendTransaction`: the keystroke-sanctity guardrail
matches the `editor.on(…)` call form, and this file makes no such call.
[plugin-apply-guardrail.test.ts](../../../src/lib/__tests__/plugin-apply-guardrail.test.ts)
is the sibling census for that silo. Membership is DISCOVERED (every shipped
file in either silo that constructs a `new Plugin`; every method-shaped
`apply(` / `appendTransaction(` inside it), and each site's REACH is the
transitive closure over same-file functions — so a walk hidden one helper down
(`buildDecorations`, `buildSet`, `buildFoldArtifacts`) is attributed to the
site that calls it. A site whose reach performs a whole-document walk
(`descendants(`, `nodesBetween(0, …)`, `DecorationSet.create(`) must either
spell the `touchedTextblocks` DOOR in its own body or carry a `[cost: …]` line
in the comment block DIRECTLY ABOVE the method, naming the per-keystroke cost
AND the class of the deferred walk. The allowlist of untagged walks is EMPTY;
every site's verdict (`door` / `tagged` / `clean`) is an exact-set pin, so a
new plugin must be acknowledged and a retired walk must be retired there.
Two placements are load-bearing: the site tag is read ABOVE the method only,
because a door site keeps a whole-doc arm (`replacesWholeDoc` — setContent /
code-pane re-parse) stated with its own in-body `[cost:` line, and counting
that as the site's justification would let a neutered door pass; and a door
site with a residual walk MUST carry that in-body statement. Measured:
restoring a whole-document `buildDecorations(tr.doc)` in this plugin's
`apply` fails three legs. Stated limit: the reach follows same-file functions
only — a walk behind an IMPORTED helper is invisible, the same limit the
subscriber census states about its callbacks.

CI: [decoration-probe-cost.test.ts](../../../src/lib/tiptap/__tests__/decoration-probe-cost.test.ts)
counts whole-document WALKS (`Node.prototype.descendants`, which prosemirror
recurses past through `nodesBetween`, so one build registers exactly one call)
and DERIVATIONS (`Decoration.inline` / `Decoration.node` constructions). The leg
with teeth asserts the nine-keystroke cost is IDENTICAL at 60 and at 240
paragraphs — no whole-document rebuild can satisfy that, whatever its constant.
[latex-command-cmd-only.test.ts](../../../src/lib/tiptap/__tests__/latex-command-cmd-only.test.ts)
pins all four `p-cmd-only` crossings plus the mark step, and
[changed-ranges.test.ts](../../../src/lib/tiptap/__tests__/changed-ranges.test.ts) pins
the two readings and the exclusion between them. Measured by neutering each half
in turn: the pre-400 probes take 3 legs (2 cost, 1 the stale flag), a
wholly-inside removal window 1, and the four transition legs are non-regression
pins that pass either way — stated at the site rather than counted as defects.

**The bookkeeping floor is CLOSED (task 430).** 400 made the re-derivation
per-block and left the SET proportional to the paper: a `Decoration.node` over
a paragraph fails prosemirror's strict-containment filing (`takeSpansForNode`),
so every `p-cmd-only` node deco lived in the ROOT set's `local` array, and each
keystroke's `find`/`remove`/`add` swept O(command-only paragraphs) — the very
alternative `globals.css`'s own comment named (a Wave-0 class stamp). The
aggregate is a per-paragraph DERIVED fact, so it is stamped at write time by
the paragraph NODEVIEW from the node that changed
([cmd-only-paragraph.ts](../../../src/lib/tiptap/cmd-only-paragraph.ts):
`paragraphIsCmdOnly` / `stampCmdOnly`; the card bodies' `CardParagraph` — both
scope configs set `paragraph: false` and `buildCardBodySchema` supplies it, so
every surface that mounts the mark mounts a stamping paragraph by construction
— and the main editor's titled paragraph, which stamps its OUTER dom, exactly
where the retired node deco landed). ONE scanner, two readers: the decoration
plugin's `forEachBareCommand` is the same function the stamp counts with, so
the grey span and the rhythm class cannot drift. Deliberately NOT a node attr
written from `appendTransaction` — a derived view signal is never document
content ("Transient state is never document content"). The stamp is
idempotence-gated (an unchanged answer touches no attribute — the
scroll-activity rule) and `ignoreMutation`-guarded so its own class write never
triggers a DOM re-read. The decoration set carries inline spans ONLY: its root
`local` array is EMPTY, pinned at 60 and at 240 paragraphs in
decoration-probe-cost (measured 60/240 entries on the pre-430 tree), and the
transition/mark-step legs in latex-command-cmd-only are the task-400 contract
byte-for-byte, re-asserted against the stamp — measured, an un-stamping
`CardParagraph` fails 9 of them. The census legs pin that every paragraph
extension adding a NodeView spells `stampCmdOnly`, that no production file
spells the class by hand (the leaf declares `CMD_ONLY_CLASS`; CSS reads it),
and that `latex-command.ts` constructs no `Decoration.node` at all.

### The stylesheet half

Style invalidation is keystroke work too. [src/lib/\_\_tests\_\_/css-invalidation-guardrail.test.ts](../../../src/lib/__tests__/css-invalidation-guardrail.test.ts) (Wave-4 P6) pins globals.css: **zero live `:has()`** (every historical one was a measured invalidation cliff; a new one needs a write-time replacement — class stamp, node decoration, or NodeView data-attr, the four Wave-0 patterns), the universal drop-mode descendant selector stays dead (body-only form inherits identically at none of the 36 ms full-tree cost), every `contain:` rule stays scoped under `body.perf-contain` (**Wave-4 Stage A**: `contain: layout style` on card/omni/panel-list/float containers, flag `virgil:perf-contain` via [src/lib/perf-feature-flags.ts](../../../src/lib/perf-feature-flags.ts), DEFAULT OFF until soak — containment changes containing-block semantics for absolutely-positioned descendants; the targets were verified portal-safe), and `content-visibility` stays out entirely (Stage B was decision-gated on the visible-window trace, which found no per-keystroke style mass for it to win against — [docs/perf/style-invalidation-findings.md](../../../docs/perf/style-invalidation-findings.md)).

### The modality half: only POINTER input answers a pointer question

> **A HOVER answer is derived from where the pointer IS. Only pointer input may (re-)derive it — a document or selection change INVALIDATES it and never re-answers it.** The rule is stated once in [src/lib/input-modality.ts](../../../src/lib/input-modality.ts) (`isTypingModality` / `notePointerInput` / `subscribeInputModality`); pointer-derived chrome reads it, and while the user is typing that chrome HIDES until the pointer speaks again.

This is the "typing in a bulleted list feels like being watched by large processes" class (task 336), and its lesson is about a cost that was *documented instead of fixed*. `TextObjectGrabHandle` subscribes to `docChanged` AND `selectionUpdate` — the caret moves on every keystroke — and its RAF body took the hover branch whenever the stored pointer position was armed, i.e. whenever the physical pointer rests inside the editor, **which is exactly where it sits after you click to place the caret**. So every keystroke re-ran a hover hit-test at a pointer that had not moved, plus one `computePlacement` per containing level: 1 for a paragraph, 2–3 in a list, each list placement paying ~3× a paragraph's forced-layout reads (the `listItem` band walks `closest('ul,ol')` + a `getComputedStyle`; the container arm added a `querySelector` + a child rect + `bulletBandAnchor` on top). The allowlist entry named this cost precisely and called it a caveat.

Four rules it earned:

- **Read the DEVICE, not the derived change.** The obvious gate — "a `docChanged`/`selectionUpdate` invalidates the stored point" — is wrong on a CLICK: clicking into prose moves the selection, so it would invalidate the pointer's own answer and leave the handle hidden until the user jiggled the mouse; whether a re-arm from the click's own `mousedown` lands before or after ProseMirror's selection sync is then an ordering race to win. A `keydown` is keyboard, a `mousemove` is pointer, and a click never produces a `keydown`.
- **A pure modifier types nothing.** `Shift`/`Control`/`Alt`/`Meta`/`CapsLock` do NOT flip modality — a Cmd-click on a grab handle begins with a `Meta` keydown, and a handle that unmounted on it would be gone before the click that wanted it landed.
- **The gate is scoped to the POINTER-derived branch.** A selection handle is selection-derived: a shift-arrow extension must keep moving it while the user types. Suppressing "all chrome while typing" would have been a bigger blast radius than the phenomenon.
- **The suppression is an EDGE, not a per-event check.** The modality subscriber fires once per flip, so a 40-character burst schedules ONE resolve (which hides the handle) and the remaining 39 keystrokes schedule nothing from it. A gate that removes per-keystroke work must not add per-keystroke work of its own.

The same task took the two costs a WRAP-CHANGING keystroke still paid in the geometry engine, both of them per RO **entry** where they belong per **flush**: the invalidation cascade now runs ONCE from the topmost dirty block (`invalidateFromUuids` — a cascade from index `i` subsumes any cascade from `j > i`, and a list rewrap delivers the `<li>` and its title wrapper together), visible as `cascades` in `window.__geometryStats()`; and `measureBlock`'s `[data-glyph-anchor]` probe is KIND-gated ([glyph-anchor.ts](../../../src/lib/editor-geometry/glyph-anchor.ts)) — an unconditional `querySelector` walks the WHOLE subtree to report the no-match that is the only possible answer for prose and containers, which on a `bulletList` is a full-list scan per measure. The gate fails OPEN on a block with no kind attribute, and closes a correctness hole on the way: an `exampleBlock` nested in a `listItem` used to hand the ancestor its `(n)` as the ancestor's visual top.

**Measurement, honestly.** Every prior probe missed this because the whole chain is mouse-gated: a synthetic keystroke harness — and any live measurement with the pointer parked over devtools — leaves the stored position null, so the resolver returns `[]` and costs nothing. `emitCount`, dispatch time and end-to-end latency all read clean. **The condition that reproduces it is the ordinary condition of use.** CI: [grab-handle-typing-cost.test.tsx](../../../src/text-objects/__tests__/grab-handle-typing-cost.test.tsx) drives the REAL component with the mouse ARMED and counts the resolver's calls plus per-element rect / computed-style reads; [input-modality.test.ts](../../../src/lib/__tests__/input-modality.test.ts) pins the flip-edge, modifier and refcount rules; [wrap-cascade-and-glyph-anchor.test.tsx](../../../src/lib/editor-geometry/__tests__/wrap-cascade-and-glyph-anchor.test.tsx) pins the flush-scoped cascade (the leg with teeth is the pass COUNT — the measured SET is identical either way) and discovers the glyph-anchor membership from the emitters. Every defect leg fails on the pre-336 tree, measured.

### The tier half: an imperative refresh door refreshes only the tier its callers READ

> **A pipeline that tiers its work by cost must not have a door that runs every tier.** Freshness is per-TIER and per-INPUT — what each tier last ran against — never one boolean over one input. A caller that wants product X gets tier(X) refreshed and every other tier merely RE-ARMED on its own schedule.

Task 592, in [src/lib/doc-products/pipeline.ts](../../../src/lib/doc-products/pipeline.ts). The doc-products pipeline states its own tier contract in its header — Tier A (300 ms) produces `docJson`, Tier B (idle) produces `sourceText` + `wordCounts`, "off the interactive path" — and `ensureFresh()` ran **both**, synchronously, unconditionally, from four save-path doors. The most frequent is the 1500 ms autosave ([useDocument.ts:696](../../../src/hooks/useDocument.ts)), so every typing pause paid the idle tier twice: once where it belongs and once inline on the save timer, at exactly the pause-ladder position task 337 was fixed to clear. **All four callers read `.docJson` and nothing else** — the Tier B half of that call had never had a reader.

Four consequences of the single flag, all of them one shape:

- **A door that cannot ask which tier is stale must redo everything.** `dirty` was set by `editor.on('update')` and cleared by Tier A, so it could not say "Tier A is current, Tier B is not". The record replaces it: `tierADoc` / `countsDoc` (the PM doc each ran against) and `sourceFresh` (doc + `preamble` + `postamble` + `bibFamily`). `ensureFresh` now runs Tier A only when the doc has moved, and `scheduleTierB()` when the record says Tier B is stale.
- **A flag over a TRANSACTION cannot see an input that fires no transaction.** `setBibPackage` ([useCitations.ts:383](../../../src/hooks/useCitations.ts)) is a user control that injects a `\usepackage{natbib|biblatex}` line and shifts every body line, yet it produced no edit, so nothing re-derived and every `err.line` pointed at the wrong paragraph — against a surface whose documented promise is line-number parity. Because `bibFamily` is now a recorded INPUT rather than a getter read blind at serialize time, it re-arms like any other. Its channel is the one `revalidate()` door, called from `useDocProductsHost`'s single input-change effect — which is also why the hook now takes `bibFamily` as a **value** and not a getter: an input a host cannot watch is an input the pipeline cannot be told about.
- **A hidden pane's dead end stops being masked the moment the door gets cheap.** `if (!config.isVisible()) return;` left the pane stale with nothing watching for it to come back; autosave's `ensureFresh` had been hiding that. The `isVisible` false→true edge is a dependency of the same effect, so the re-arm is a *prerequisite* of the fix, not an extra.
- **A read-only projection may degrade; it may never escape.** `buildSourceText` failed open around the per-block loop and reasoned from "this tier is a read-only projection running on an idle callback" — precisely what `ensureFresh` invalidated. `assembleLatex` and `computeCategoryCounts` threw past it into a call site with no `try` and the debounce already disarmed: no write, no `noteSaveBlocked`, no retry, no badge. Tier B now carries a try per PRODUCT (one refusal must not take the others), and `ensureFresh` answers **EXACT OR NOTHING** — a Tier A failure returns `docJson: null` so the caller takes its documented `?? editor.getJSON()` fallback and writes the LIVE document rather than a stale projection.

CI: [pipeline.test.ts](../../../src/lib/doc-products/__tests__/pipeline.test.ts) — a settled-tier `ensureFresh` leaves `tierBRuns`/`assemblies` flat and arms no idle callback; a mid-pause one refreshes Tier A and re-arms (never runs) Tier B; a throwing `assembleLatex` cannot escape `ensureFresh` or the idle tier; a `bibFamily` flip re-serializes with no edit; a hidden pane converges on the visible edge; an input-less `revalidate()` re-arms nothing. Each fails on the pre-592 tree, measured in four neuters.

### Why this exists

Memo: [docs/perf/keystroke-sanctity-findings.md](../../../docs/perf/keystroke-sanctity-findings.md). Predecessor sweeps in [docs/perf/cursor-selection-reactor-audit.md](../../../docs/perf/cursor-selection-reactor-audit.md) and [docs/perf/reactor-sweep-followup-findings.md](../../../docs/perf/reactor-sweep-followup-findings.md).
