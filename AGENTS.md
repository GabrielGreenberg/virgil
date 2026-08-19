<!-- last-verified: fb1fd726 2026-08-19 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization -->
<!-- covers-code: src/lib/tiptap/doc-structure, src/hooks/useStructuralRevisions.ts, src/hooks/useInTextPositions.ts -->

# Agent guide to Virgil

Virgil is a browser-based visual LaTeX editor for academic writing, designed to cowork with AI agents. It runs fully client-side (File System Access API for disk, IndexedDB for prefs), doesn't compile LaTeX, and renders `.tex` meaningfully while preserving the source. Agents interact with the user's paper by reading the same `.tex`/`.bib` files and writing JSON sidecars into the paper's `virgil/` folder.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Codebase guide

Deeper docs in `docs/agents/`. Load them on demand when their topic comes up — they aren't auto-transcluded, so this index stays lean:

- **[docs/architecture/VIRGIL.md](docs/architecture/VIRGIL.md)** — **the canonical "what Virgil is" source of truth** (the rooted architecture spine; the `docs/agents/*` docs below derive from it). Read first for the conceptual account.
- **[docs/agents/overview.md](docs/agents/overview.md)** — What Virgil is, tech stack, `src/` map, core concepts. Read first in a new session.
- **[docs/agents/glossary.md](docs/agents/glossary.md)** — User terminology → code names + file paths. Consult whenever the user uses a term (panel, Virgil bar, marginalia, jump-to button, can-I-request button, etc.) you don't recognize.
- **[docs/agents/ui-chrome.md](docs/agents/ui-chrome.md)** — Panels, tool strips, the Virgil bar strip and the MenuBar menu pod that docks inside it, actions/formatting toolbars, floating panels and cards.
- **[docs/agents/main-text.md](docs/agents/main-text.md)** — TipTap editor, block/inline nodes, paragraph UUIDs, link architecture, marginalia, citations, LaTeX round-trip.
- **[docs/agents/architecture.md](docs/agents/architecture.md)** — Registries, key hooks, persistence, sidecars, drag/drop MIME map, per-panel overrides.
- **[library/AGENTS.md](library/AGENTS.md)** — The Library subsystem (catalog, multi-tab libraries, skill cowork, Python pipeline). Self-contained under `library/`; load on demand for any work touching the Library tab.
- **[editor/AGENTS.md](editor/AGENTS.md)** — The editor-side skill set (`/editor/review` umbrella + per-kind subskills, AI-request bridge, paragraph-context helper scripts). Self-contained under `editor/`; load on demand for any work touching AI requests, sidecar skills, or the cowork plumbing in `src/lib/ai-request-bridge.ts`.

## Glossary protocol

If the user uses a term that doesn't resolve cleanly to a code name, append it to the **Pending terminology** section at the bottom of `docs/agents/glossary.md` with your best-guess code referent and today's date. The cleanup skill consolidates these on the next merge cycle.

Each sub-doc begins with `<!-- last-verified: <sha> <date> -->`. If the hash is far behind `HEAD` and something feels stale, verify against the current code before relying on the doc.

## Keystroke sanctity

> **No plugin, hook, or React effect may do work proportional to document size on each keystroke.** Doc-walking work must be event-driven from the typed structural diff. Decoration plugins must use `DecorationSet.map(tr.mapping)` and re-scan only changed regions.

The diff is produced once per transaction by `DocStructureObserver` ([src/lib/tiptap/doc-structure/](src/lib/tiptap/doc-structure/)) — the **first** extension in the editor's extension list. It inspects `tr.steps` (O(edit-size), O(1) bail on `!tr.docChanged`) and publishes typed events on an editor-attached `DocStructureBus`.

**Consume the diff. Don't walk the doc.**

- From a ProseMirror `appendTransaction`: `readPendingDiff(newState)` returns the current `StructureDiff`.
- From a React component: `useDocStructure(editor)` / `useDocStructureBus(editor)` / `useDocStructureEvent(editor, "onHeadingsRecomputable", fn)`.
- From a long-lived hook: `getBus(editor)` for direct subscription.

### Permitted `editor.on('update' | 'transaction')` subscribers

The keystroke-sanctity sweep allows these direct subscriptions, because each is O(1) per transaction (debounced timer reset, counter bump, or RAF-coalesced layout read). This list is CI-enforced: [src/lib/\_\_tests\_\_/keystroke-subscriber-guardrail.test.ts](src/lib/__tests__/keystroke-subscriber-guardrail.test.ts) greps `src/` AND `library/` for the `editor.on("update"|"transaction", …)` call form and fails if any subscribing file is missing from its allowlist — `PERMITTED_KEYSTROKE_SUBSCRIBERS` for `src/` (this prose list), `PERMITTED_LIBRARY_KEYSTROKE_SUBSCRIBERS` for the library silo (prose twin in library/AGENTS.md "Perf doctrine"; sole entry: `usePgmarkPages`, docChanged-gated). The same discipline the scroll-anchor sibling has — see "Scroll-anchor stability" below. Keep list and prose in sync: a new subscriber must be added to BOTH, each with its "why it's O(1)" justification.

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
- `SlashCommandPopup.tsx` (mounted only while the popup is open; RAF-coalesced reposition)
- `TextObjectGrabHandle.tsx` (docChanged-gated → RAF-coalesced placement resolve. Since task 336 the RAF body is bounded by **input modality**, not by luck: the HOVER branch is the only pointer-derived one and is answered only in POINTER modality, so a keystroke resolves the selection branches and stops — a collapsed caret costs a `from !== to` compare, a live selection one O(depth) ancestor walk plus one placement. Its two earlier one-liners here are both worth remembering: "docChanged-gated, cheap" was the gate-not-callback failure mode this list's own rule outlaws (corrected in Wave-4 P6), and its replacement then *documented* the armed-hover cost as an accepted caveat rather than fixing it — see "Input modality" below.)
- `EditorMirror.tsx` (RAF-deferred replay). PARKED since task 115 — its only consumer, `SplitEditorPanes`, is deliberately unmounted, so this subscriber cannot run today. It stays listed because the file still makes the subscription and the guardrail greps files, not mounts.
- `Marginalia.tsx` (RAF-coalesced host-element notify)
- `float-sync.tsx` (`useMainTransactionSync`, one subscription per OPEN text-object float). docChanged-gated + own-write meta filter + the **source-touch gate** (task 140): the handler maps the float's live source range forward through the transaction's steps — and its `appendedTransactions`' — asking in the same O(steps) pass whether any step intersected it, and invokes `readSource` only if one did (steps, not step maps: see the note below on `StepMap.empty`). That third gate is the load-bearing one: `readSource` is O(doc) in every body, so the first two alone made each main keystroke cost a full-document walk PER OPEN FLOAT. **This is the entry that proves a justification must describe the CALLBACK, not just the gate** — it previously read "O(1) per tx", which was true of the subscriber and false of what it called, and the grep guardrail can only see the `editor.on(...)` call form. Contract: [src/lib/\_\_tests\_\_/float-source-touch-gate.test.tsx](src/lib/__tests__/float-source-touch-gate.test.tsx) counts `readSource` calls on the real hook against a real editor — typing in five other paragraphs with three floats open must run it zero times.
- `src/lib/identity/useIdentityBusConsumer.ts` — the SINGLE inline-atom bus consumer (PLAN D1.2/D1.4; behind `virgil:identity-cascade`, default OFF). NOT an `editor.on(...)` subscriber: it opens exactly ONE `DocStructureBus.onAnyChange` subscription (`onAnyChange` is `emitCount`-gated, so it never fires on a plain keystroke), then bails O(1) when no citation/footnote entered or left the transaction. Only on a markerless re-parse (same-tx add+remove of atoms whose ids regenerated) does it run `detectRegenRemap` — O(addedAtoms+removedAtoms) = edit size, never doc size — and route the `oldId→newId` remap through the `IdentityCascade` so selection/float/pin survive (OMNI-F3-02, CI-A3-01, the CI-F1-02 id-survival class). This is the **+1, not +3** consumer: Wave-2 T2 (inline-atom lifecycle) and T5 (citation add-resync) register as ordered POLICIES on this one dispatcher (`registerPolicy`) rather than opening their own `onCitations*`/`onFootnotes*` subscriptions. Typing N plain chars leaves `__virgilBusStats().emitCount` flat and runs zero consumer code.

Anything else added to that list needs a comment explaining why it's O(1) — and a matching entry (with the same justification) in the `PERMITTED_KEYSTROKE_SUBSCRIBERS` allowlist of the guardrail test above, or CI fails. **Cost-class tags (Wave-4 P6):** every allowlist justification must BEGIN with a `[cost: …]` tag naming the per-event cost AND the deferred body's class ("RAF-coalesced" alone no longer qualifies — a RAF-coalesced O(doc) walk is still an O(doc) walk one frame later); the guardrail's tag-format test enforces the prefix. **selectionUpdate census (Wave-4 P6):** `editor.on("selectionUpdate", …)` is governed by the SAME test under its own exact-set allowlists (`PERMITTED_SELECTION_SUBSCRIBERS`; the library twin is deliberately empty) — the caret moves on every keystroke, so a selection handler IS a keystroke handler; the 8 censused sites are tag-justified in the test, which is their SSOT. The lone `<VirgilEditor onUpdate=` JSX mount (EditorPane) is pinned by its own census in the same file.

**A justification must cover the CALLBACK, not just the gate.** The grep guardrail sees the `editor.on(...)` call form and the surrounding conditionals; it cannot see the cost of what the handler *calls*. `float-sync.tsx` sat on this list for a year reading "docChanged-gated + own-write meta filter — O(1) per tx" — accurate about the subscriber, silent about the O(doc) `readSource` behind it, so CI was green while the law was broken once per open float per keystroke (task 140). When you write or review an entry, name what the handler ultimately runs and why *that* is bounded. If the callback is O(doc), the fix is a gate that answers "is this transaction relevant to me?" from the edit — the observer's `StructureDiff` for entity-shaped questions, or [src/lib/float-source-range.ts](src/lib/float-source-range.ts) (`trackSourceRange`) for positional ones, which maps a tracked region through the transaction's steps and tests intersection in one O(steps) pass. Note that `readPendingDiff` is NOT available to an `editor.on('transaction')` handler — the observer's `view.update` clears it before TipTap emits the event — which is why the positional primitive exists.

**Writing a positional gate: a step map is not a description of what changed.** It describes how positions MOVE, so a step that moves nothing returns `StepMap.empty` — `AddMarkStep`, `RemoveMarkStep`, `AddNodeMarkStep`, `RemoveNodeMarkStep`, `AttrStep`, `DocAttrStep`. Their transactions are still `docChanged`. A gate that reads `tr.mapping.maps` alone therefore concludes "nothing happened" when the user bolds a word, and for a mirroring consumer that is worse than a stale render: the float keeps its pre-bold copy and its next write-back rebuilds the source from it, **deleting the mark from the document** (with `addToHistory: false`, so not even undoable). Ask the STEP, not just its map, and fail safe on a shape you don't recognize — `stepTouches` in the primitive above. Two other things a positional gate must handle: TipTap emits one `transaction` event per dispatch carrying `appendedTransactions` alongside the root, and all of them land in the state, so all of them must be mapped; and an own-write filter must ignore only the *root* transaction it authored, because an appended transaction that reshaped that write (a renumber, a uuid re-mint, a normalizer replacing the block) is exactly the case that must re-read.

**Wall-clock services are exempt from this list** (they are not `editor.on(...)` subscribers and do no per-keystroke work). The **`DiskWatcher`** ([src/lib/disk-watcher.ts](src/lib/disk-watcher.ts), mounted by `DiskWatcherProvider`) is one: a per-doc `setInterval` poller (~3 s, paused while `document.hidden`, immediate on tab-focus) that detects out-of-band edits to the `.tex`/`.bib` on disk (the external-change badge). It *pulls* the `saveTimerRef.current !== null` dirty flag at poll time — never subscribes to the editor — so typing leaves `__virgilBusStats().emitCount` flat. False positives are killed by the `diskLedger` ([src/lib/disk-ledger.ts](src/lib/disk-ledger.ts)), stamped only on load + writes, never on plain reads.

### Card-source derivation: no raw update counters

Panel/card data (footnotes, citations, examples, archive order, marginalia markers) is derived from the live editor on demand. **Gate those memos on the per-category counters from [`useStructuralRevisions`](src/hooks/useStructuralRevisions.ts) (built on the `DocStructureBus`) — never on a `docVersion`-style counter bumped from `editor.on('update')`.** A structurally-null keystroke (typing inside a paragraph) fires no structural event, so nothing re-derives and no card re-renders or shifts. Live in-text positions come from the observer's snapshot (`getBus(editor).structure`), resolved at measure time in [`useInTextPositions`](src/hooks/useInTextPositions.ts) — not from re-walked arrays, which would drift on the keystroke that wraps a line. Since the typing-latency fix (2a) the snapshot's own maintenance is O(edit) too: a structurally-null tx only ACCUMULATES its StepMaps (no entity iteration, no Map clones), and the O(entities) remap materializes lazily at consumer-read time (`readDocStructure`, RAF/user-paced; capped at 32 pending maps). Per-keystroke `appendTransaction` guards resolve single touched blocks via `resolveTouchedBlock` without materializing. `window.__virgilBusStats().materializeCount` must stay flat while typing. The observer tracks blocks, headings, footnotes, **citations** (`CitationEntry` — including container-nested cites tagged with the generalized `nestedInContainerId: { kind: "footnote" | "example", id }`, surfaced load-only by `buildInitial`; the legacy `nestedInFootnoteId` is retained byte-for-byte alongside the footnote case), anchors, examples, figures, and labels. Verify with `window.__virgilBusStats()` in the dev preview: typing N plain characters must leave `emitCount` (and `materializeCount`) unchanged.

**The cap's cost, measured rather than assumed (task 337).** Past `MAX_PENDING_MAPS` (32) the fold runs ON the keystroke path, inside plugin `apply` — a designed trade (the cap bounds remap cost) that had never been priced on a rich document. Measured through the REAL observer with 32 pending maps, median of 12 rounds: **0.11 ms at 500 blocks, 0.40 ms at 1 500, 0.67 ms at 3 000** (max 1.1 ms) — linear, ~0.22 µs per tracked entity per fold, so even a 10 000-entity paper stays near 2 ms. Well under the ~4 ms bar, so the cap stands and nothing was amortized. Three honest limits: the harness populates BLOCKS (the dominant collection, and the one that costs a Map clone), extrapolating to the other seven by the fold's linearity; it is jsdom/node, not Chrome; and unlike every other measurement claim in this file it names **no committed reproducer** — it was a one-off harness (a real editor with N uuid'd paragraphs, 32 plain-keystroke dispatches, then a timed `readDocStructure`, median of 12 rounds), deleted rather than committed because a wall-clock assertion in CI is a flaky test wearing a guard's clothes. **Do not raise the cap to make this cheaper** — the cap is what bounds the remap, and the 33rd keystroke of a sustained burst is the only place it is paid.

**Initial population:** the `useStructuralRevisions` counters start at 0 and bump only on *changes* — `buildInitial` emits nothing, so none fire on doc load. A card-source memo must therefore also depend on the reactive **editor instance** (`editor`/`editorInstance` state), not a counter alone, so it computes once the editor mounts. Never gate a `ref`-based derivation (`editorRef.current?.getX()`) on a counter alone — the ref identity never changes and the counter is silent on load, so it reads the not-yet-ready ref once and never refreshes. Derive from the reactive `editor` and thread the result down as a prop (e.g. `footnoteInfos` / `examples` in `EditorPane`).

### The pause half: a cache's granularity must match the granularity of CHANGE

> **A derived-product cache keyed on TOP-LEVEL nodes answers "what changed?" with "the whole top-level block" — which is the truth for a paragraph and a lie for a container.** Where a container's assembly is a pure concatenation of per-child pure functions, the cache RECURSES: the unit of re-derivation is the touched child, at any depth. And a path that exists to be CHEAP must be audited for the O(doc) probe hiding inside its own gate.

This is the "typing in a long bulleted list hitches when I resume after a think-pause" class (task 337) — the pause-tier companion to the per-keystroke costs the modality half took out. Three costs, and the first is the list-specific one:

- **The cache stopped at the container.** ProseMirror re-creates every ANCESTOR of an edited node, so a keystroke inside item 50 of a 100-item enumeration invalidated the LIST. Both doc-products caches then re-derived it whole: a full `toJSON()` deep clone in the 300 ms interactive tier — which lands, by construction, exactly as the user resumes typing — and a full LaTeX re-serialization in the idle tier, whose `requestIdleCallback` carries a forced ~200 ms deadline, so on a real bibliography or enumeration the hitch arrives mid-burst. **Every fixture list in the suite was 2–3 items**, which is the whole reason this was invisible: the cost is real only at the size real papers reach.
- **The decoration floor.** `latex-command`'s plugin called `DecorationSet.find()` **argless** on every `docChanged` transaction whose changed region held no backslash — i.e. every plain keystroke — purely to ask "is the set non-empty?". Argless `find` is the one call on that class that walks the WHOLE decoration tree: `findInner`'s child gate is true for every subtree at the default `0 … 1e9` range, and it allocates a copied `Decoration` per hit. A paper with hundreds of `\commands` paid a full-set walk plus that allocation traffic per character, on the path that exists to be cheap. **The gate bought nothing** — mapping can never ADD a decoration, so an empty set implies an empty mapped set, and the bounded `find(from, to)` loop it guarded already answers `[]` for every range. Same shape as the empty-`StepMap` trap two sections up: the gate was right and the probe inside it was wrong. **Stated precisely, because the win is a constant factor and not an asymptote:** `findInner` iterates the whole `children` array at each level and gates only the RECURSION, so the surviving bounded probe is still linear in the number of DECORATED top-level blocks — measured against the shipped library, 6.56 µs and 600 allocations for the argless call vs 0.37 µs and zero for the bounded one at 300 decorated paragraphs, with the bounded call at 3.28 µs by 3 200. An ~18× cut with the allocations gone, not the removal of all doc-proportional work.
- **The 33rd-keystroke fold**, measured and left alone — see the paragraph in "Card-source derivation" above.

Four rules the cache half earned:

- **The compose predicate is SCHEMA-derived, not a kind list.** `getNodeJson` composes when `node.isBlock && !node.isTextblock && node.content.size > 0` ([block-caches.ts](src/lib/doc-products/block-caches.ts)) — so every container the schema has (lists, items, blockquotes, the expex family, figures) or GAINS is covered with nothing to add, and the boundary lands exactly where `toJSON` stops being expensive: a textblock's children are inline nodes, where per-child WeakMap entries would cost more than they save.
- **The LaTeX half is narrower than the JSON half, and the line is a PROPERTY, not a preference.** The serializer memoizes a child only where the parent maps its children through `serializeNode(child, S, D)` with S and D constant across the map — lists, blockquotes, list-item tails — because only there is a child's output a pure function of itself. The expex walkers are deliberately excluded: `serializeExampleBlock` chooses its separator from the PREVIOUS piece's type, so its assembly is not a concatenation, and an example is bounded by its own construct where an enumeration is not. The parent's framing and any post-processing of the JOINED string (`listItem`'s `/\n+$/` tail strip, which can eat into the second-to-last child) stay in the parent, so the composition is byte-neutral by construction.
- **The collector side channel is captured as DATA and replayed.** A memoized child returns `{latex, requirementIds, bibFamily}`; `need` is a Set add (idempotent, commutative) and `needBibFamily` folds first-concrete-wins with distinct ⇒ natbib (also idempotent and commutative), so replaying a hit's pair into the enclosing collector is byte-equivalent to re-running the child inside it — the same argument `foldBibFamilies` already rests on. A cached child that silently dropped its `need("graphicx")` would emit a `.tex` with no `\usepackage`.
- **Deeper sharing makes the read-only contract load-bearing, so the one unguarded mutator was fixed first.** `storage-dev.writeDocBundle` ran `assignUuids(content)` **unconditionally** on the caller's object — which under the pipeline is the shared `docJson`. It now mirrors the FSA backend's `needsUuidWork` + deep-copy guard. The memo keys on JSON-object identity, and that is a faithful proxy for PM node identity **only** because composed JSON is cached per node and never mutated. **Do not read this as "the change created the hazard", which the first draft of this paragraph did:** `assignUuids` writes `node.attrs.uuid = …` IN PLACE on the attrs object, and prosemirror's own `toJSON` shares `this.attrs` by reference at every depth (which is why `composeJson` deliberately mirrors that) — so pre-337 the dev backend could already write through the shared snapshot into LIVE ProseMirror node attrs. What composition changes is the BLAST RADIUS: the grandchild wrapper is now the child's cache entry, shared with every prior generation, where before each generation's `toJSON()` minted fresh wrappers. **Stated limit:** the completeness of "the one unguarded mutator" was established by inspection (the only in-place doc-JSON mutators are `assignUuids` and the disabled `recoverOrphanedUuids`; all four `assignUuids` sites are either on a freshly-parsed tree or now guarded), NOT by a census — which is what this file's own doctrine would ask for, and is the honest gap here.

Probe: `window.__docProductsStats()` gains `childPartMisses` / `childPartHits` — a keystroke inside a list must move the first by ONE item's subtree, never by the list. CI: [container-granularity.test.ts](src/lib/doc-products/__tests__/container-granularity.test.ts) drives a REAL 100-item list and measures Tier A with an implementation-INDEPENDENT probe (calls to prosemirror's own `Node.prototype.toJSON`, which `Fragment.toJSON` invokes once per descendant): **301 per keystroke pre-fix, under 20 after**, measured by neutering the fix. Its byte-identity legs compare the cached output against a full cache-free re-serialize, since the produced bytes are the thing that must NOT move. [decoration-probe-cost.test.ts](src/lib/tiptap/__tests__/decoration-probe-cost.test.ts) counts argless `find` calls across a real typing burst (12 pre-fix, 0 after) and censuses both silos for the shape — the plugin was never the only place it can appear, and a second one would be invisible to any behavioural test of this plugin.

### The stylesheet half

Style invalidation is keystroke work too. [src/lib/\_\_tests\_\_/css-invalidation-guardrail.test.ts](src/lib/__tests__/css-invalidation-guardrail.test.ts) (Wave-4 P6) pins globals.css: **zero live `:has()`** (every historical one was a measured invalidation cliff; a new one needs a write-time replacement — class stamp, node decoration, or NodeView data-attr, the four Wave-0 patterns), the universal drop-mode descendant selector stays dead (body-only form inherits identically at none of the 36 ms full-tree cost), every `contain:` rule stays scoped under `body.perf-contain` (**Wave-4 Stage A**: `contain: layout style` on card/omni/panel-list/float containers, flag `virgil:perf-contain` via [src/lib/perf-feature-flags.ts](src/lib/perf-feature-flags.ts), DEFAULT OFF until soak — containment changes containing-block semantics for absolutely-positioned descendants; the targets were verified portal-safe), and `content-visibility` stays out entirely (Stage B was decision-gated on the visible-window trace, which found no per-keystroke style mass for it to win against — [docs/perf/style-invalidation-findings.md](docs/perf/style-invalidation-findings.md)).

### The modality half: only POINTER input answers a pointer question

> **A HOVER answer is derived from where the pointer IS. Only pointer input may (re-)derive it — a document or selection change INVALIDATES it and never re-answers it.** The rule is stated once in [src/lib/input-modality.ts](src/lib/input-modality.ts) (`isTypingModality` / `notePointerInput` / `subscribeInputModality`); pointer-derived chrome reads it, and while the user is typing that chrome HIDES until the pointer speaks again.

This is the "typing in a bulleted list feels like being watched by large processes" class (task 336), and its lesson is about a cost that was *documented instead of fixed*. `TextObjectGrabHandle` subscribes to `docChanged` AND `selectionUpdate` — the caret moves on every keystroke — and its RAF body took the hover branch whenever the stored pointer position was armed, i.e. whenever the physical pointer rests inside the editor, **which is exactly where it sits after you click to place the caret**. So every keystroke re-ran a hover hit-test at a pointer that had not moved, plus one `computePlacement` per containing level: 1 for a paragraph, 2–3 in a list, each list placement paying ~3× a paragraph's forced-layout reads (the `listItem` band walks `closest('ul,ol')` + a `getComputedStyle`; the container arm added a `querySelector` + a child rect + `bulletBandAnchor` on top). The allowlist entry named this cost precisely and called it a caveat.

Four rules it earned:

- **Read the DEVICE, not the derived change.** The obvious gate — "a `docChanged`/`selectionUpdate` invalidates the stored point" — is wrong on a CLICK: clicking into prose moves the selection, so it would invalidate the pointer's own answer and leave the handle hidden until the user jiggled the mouse; whether a re-arm from the click's own `mousedown` lands before or after ProseMirror's selection sync is then an ordering race to win. A `keydown` is keyboard, a `mousemove` is pointer, and a click never produces a `keydown`.
- **A pure modifier types nothing.** `Shift`/`Control`/`Alt`/`Meta`/`CapsLock` do NOT flip modality — a Cmd-click on a grab handle begins with a `Meta` keydown, and a handle that unmounted on it would be gone before the click that wanted it landed.
- **The gate is scoped to the POINTER-derived branch.** A selection handle is selection-derived: a shift-arrow extension must keep moving it while the user types. Suppressing "all chrome while typing" would have been a bigger blast radius than the phenomenon.
- **The suppression is an EDGE, not a per-event check.** The modality subscriber fires once per flip, so a 40-character burst schedules ONE resolve (which hides the handle) and the remaining 39 keystrokes schedule nothing from it. A gate that removes per-keystroke work must not add per-keystroke work of its own.

The same task took the two costs a WRAP-CHANGING keystroke still paid in the geometry engine, both of them per RO **entry** where they belong per **flush**: the invalidation cascade now runs ONCE from the topmost dirty block (`invalidateFromUuids` — a cascade from index `i` subsumes any cascade from `j > i`, and a list rewrap delivers the `<li>` and its title wrapper together), visible as `cascades` in `window.__geometryStats()`; and `measureBlock`'s `[data-glyph-anchor]` probe is KIND-gated ([glyph-anchor.ts](src/lib/editor-geometry/glyph-anchor.ts)) — an unconditional `querySelector` walks the WHOLE subtree to report the no-match that is the only possible answer for prose and containers, which on a `bulletList` is a full-list scan per measure. The gate fails OPEN on a block with no kind attribute, and closes a correctness hole on the way: an `exampleBlock` nested in a `listItem` used to hand the ancestor its `(n)` as the ancestor's visual top.

**Measurement, honestly.** Every prior probe missed this because the whole chain is mouse-gated: a synthetic keystroke harness — and any live measurement with the pointer parked over devtools — leaves the stored position null, so the resolver returns `[]` and costs nothing. `emitCount`, dispatch time and end-to-end latency all read clean. **The condition that reproduces it is the ordinary condition of use.** CI: [grab-handle-typing-cost.test.tsx](src/text-objects/__tests__/grab-handle-typing-cost.test.tsx) drives the REAL component with the mouse ARMED and counts the resolver's calls plus per-element rect / computed-style reads; [input-modality.test.ts](src/lib/__tests__/input-modality.test.ts) pins the flip-edge, modifier and refcount rules; [wrap-cascade-and-glyph-anchor.test.tsx](src/lib/editor-geometry/__tests__/wrap-cascade-and-glyph-anchor.test.tsx) pins the flush-scoped cascade (the leg with teeth is the pass COUNT — the measured SET is identical either way) and discovers the glyph-anchor membership from the emitters. Every defect leg fails on the pre-336 tree, measured.

### Why this exists

Memo: [docs/perf/keystroke-sanctity-findings.md](docs/perf/keystroke-sanctity-findings.md). Predecessor sweeps in [docs/perf/cursor-selection-reactor-audit.md](docs/perf/cursor-selection-reactor-audit.md) and [docs/perf/reactor-sweep-followup-findings.md](docs/perf/reactor-sweep-followup-findings.md).

## Scroll-anchor stability

> **An overlay anchored to document content must not re-solve its position per scroll frame.** It must be either (a) **pod/host-relative** — living inside the scroll container so it moves with content by layout, with NO scroll listener (`top = elementRect.top − hostRect.top`); or (b) a **RAF-coalesced fixed portal** — `position:fixed`, recomputing `top` at most once per animation frame behind an equality bail (`placementsEqual` / `prev.top === next.top`). Never a raw `coordsAtPos`/`getBoundingClientRect` re-solve inside an `addEventListener('scroll')` / `onScroll` handler — that jitters and lags per frame.

This is the "card/overlay position recomputes and JUMPS on scroll" class (task 041/042). Two guards enforce it:

- **Runtime probe** — `window.__scrollRepositionStats()` ([src/lib/scroll-reposition-probe.ts](src/lib/scroll-reposition-probe.ts)) reports per-portal `{ total, commitsThisScroll, distinctTopsThisScroll }`. On a pure scroll a stable portal reports **≤1 distinct top/frame**; a jittery one reports **>1**. The RAF-coalesced fixed portals (`SelectionActionsMenu`, `PendingChangePill`, `SlashCommandPopup`, `useFloatingMenuPosition`) each record one placement per coalesced frame.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/scroll-reposition-guardrail.test.ts](src/lib/__tests__/scroll-reposition-guardrail.test.ts) greps `src/` AND `library/` for the risky conjunction (a `position:fixed` overlay that measures via `coordsAtPos`/`getBoundingClientRect` and listens to `scroll`) and asserts every such site is on the silo's allowlist (`PERMITTED_SCROLL_REPOSITIONERS`; the library twin is deliberately empty). **Anything added to an allowlist needs a one-line comment explaining why it's stable** (pod-relative / RAF+equality-bail / hides-on-scroll) — same discipline as the keystroke-sanctity permitted-subscriber list above. A new naive per-scroll-frame re-solve fails CI.

## Pane-drag stability

> **Every pane/divider resize gesture runs on the ONE engine at [src/lib/pane-resize/](src/lib/pane-resize/)** (`usePaneResizeHandle`): pointer capture on the handle, element-scoped move/up/cancel/lostpointercapture, `button===0` start gate, `(buttons & 1)===0` missed-release failsafe (the primary-button BIT test, not `buttons===0` — releasing the drag button while a second is chorded fires only a pointermove with an updated mask, never a pointerup), Escape restore, a drag shield over iframes, RAF-coalesced equality-bailed imperative `apply()` (CSS-var writes; grid templates own hard clamps via `minmax()`/`clamp()`), and `commit()` exactly once on release. **Never** a bespoke `window`/`document` `pointermove` handler, and **never** per-frame React state, store notifies, or localStorage from a continuous gesture. Per-frame React state inside an engine consumer is sanctioned ONLY when a render-derived layout decision needs the live value (current sole case: `SplitWithCode`'s `liveRatio` — the compressed-gutter flip + clip fade derive from it in render), and only as LOCAL state driven from the engine's RAF-coalesced `apply()` (≤1 set per frame) with child subtrees bailing on element identity and persistence still commit-once; anything else is the per-frame-commit bug class this section exists to kill.

A gesture the engine's `getValue/apply/commit(px)` shape genuinely doesn't fit (a snap-to-row *selection* like the Outline focus band; a float move) may stay bespoke — the guardrail's either/or names those — but it does **not** get to re-derive the two pointer invariants: it imports them from [src/lib/pane-resize/pointer-invariants.ts](src/lib/pane-resize/pointer-invariants.ts) (`isPrimaryDragStart`, `isMissedRelease`), the same predicates the engine itself calls. A bespoke gesture missing them stays live after a release it never observed — ghost-tracking the pointer and committing on the user's next click (task 185).

**And "bespoke" buys a different SHAPE, never an exemption from the rest of the discipline** (task 330). The float move read it as the latter for a year: per raw `mousemove` (120-240 Hz, no RAF coalescing anywhere) it committed React state *and* swept the DOM for the dock proximity test, the sweep growing a rect-read-PER-BAND inside the 80px dock gate. Write → read → write per event, worst exactly where Gabriel reported it worst ("especially laggy near the docking sites"). The four obligations a bespoke gesture inherits whole: **coalesce** (≤1 imperative write per frame, equality-bailed — the float shell moves by `translate3d` on its own element, composite-only, since a `left`/`top` write re-lays-out every frame; React renders on edges only and JSX never sets `transform`, the drop-mode lift-overlay law); **snapshot** (every geometry the per-event math needs is captured ONCE on a gesture edge and hit-tested as pure arithmetic — `readDockGeometry` + the viewport clamp bounds, re-armed only on a real invalidation, which for a drag is a window-resize burst read off the LayoutGestureBus SET channel); **commit once** (state + persistence on the end edge, through ONE end path every variant enters, so no ending can skip the chrome teardown); and the two **pointer invariants** above.

What makes the snapshot half more than a perf trick is the affordance law — and stating it *precisely* is the whole of it, because the loose version was wrong twice in this task's own first cut. The hover and the release read the same **door**, so they cannot answer from two different tables ("what the hover OFFERS is what the commit ACCEPTS", tasks 258/321/332, arriving through the geometry rather than through a placement list). They can still legitimately differ where the *world* differed — a snapshot genuinely re-captured because it was invalidated — which is the right answer, not a disagreement. What is NOT allowed is either half answering from something the other cannot see, and the adversarial pass on this fix found both shapes: the release read the raw snapshot **ref** while only the hover went through the lazy door, so (a) an ordinary 1px undock flick reached the release with no snapshot at all and silently declined a redock the pre-fix live sweep performed, and (b) a bus edge landing in the pause people take to confirm a drop target — `endWindowGesture` is a trailing-idle timer, independent of pointer state — nulled the snapshot between the last move and the mouseup, so a lit dock outline redocked NOWHERE and then cleared itself. The invalidation meant to prevent staleness had reintroduced the false affordance. Both halves now enter `geometry()`, and a release that carries **no trustworthy coordinate** (the missed-release bail) re-probes at the last cursor the gesture OBSERVED rather than falling back to the float's vertical centre — that fallback resolves a different band for a tall float, so the one path that exists to end a gesture safely was the one path that could accept an index nobody was offered.

Two structural notes. `dock-drag.ts` deliberately exposes **no live one-call hit-test** — `findDockTargetAtPoint` (dead since the band-stack model) and `findDockTargetByPanelProximity` (whose only callers were the two converted sites) are DELETED, because a function that sweeps and answers in one call is exactly what a per-move caller reaches for; a consumer must now spell `readDockGeometry` to sweep, which a move-path source contract can forbid. And a **snapshot reader belongs at the gesture edge, not just a rect reader**: `getWindowInsetTopPx()` (the WCO top clamp) reads `localStorage` twice per call, which is invisible to any "no `getBoundingClientRect`" grep and was running at pointer rate.

CI: [float-move-gesture-cost.test.tsx](src/components/__tests__/float-move-gesture-cost.test.tsx) drives the REAL gesture and asserts the cost contract directly — the shell's React-owned `left`/`top` frozen while only the transform moves, one queued frame for eight events, zero `querySelectorAll`/`getComputedStyle`/rect reads across twenty moves *through* the dock corner (instrumented on `Element.prototype` as well as `document`, since the old code's own shape was an element-scoped query off a cached column), hover-target ≡ release-target, both invariants, and the docked→undock→redock round trip whose post-reflow capture ordering the whole lazy-capture design rests on. The leg with teeth is a SOURCE census, and it is **effect-wide, not region-wide**: a region scan over the `onMove` MOVE branch follows no calls, and lifting the per-move geometry work into a same-effect arrow function — the idiom the file already establishes — takes every needle out of the branch while the work still runs per event (demonstrated on a scratch copy during the review, every region leg green). So the census asks the whole gesture effect, `applyTranslate`'s RAF body included, to name no DOM-measuring API and to spell `readMoveGeometry` exactly ONCE, in the memoized door; the narrower branch leg survives only to localize a failure. Since task 335 that census also asks the effect to spell `setPos(` exactly ONCE — the per-frame-commit class is not a move-branch fact, and the region leg is blind to the `else` arm by construction — while [floating-panel-edge-resize.test.tsx](src/components/__tests__/floating-panel-edge-resize.test.tsx) takes the frame clock and pins the resize half behaviourally (one frame for eight events, an equality bail counted through a `<Profiler>` because with equal values React's own style diff writes nothing either way, and a release whose frame never ran still committing what the user dragged to) with every existing clamp assertion's VALUE unchanged. Every leg fails on its own pre-fix behaviour, measured by neutering each half in turn.

**Residuals, stated rather than implied.** (1) The **resize** branch's per-event commit is CLOSED (task 335). It never had the interleaved-thrash half (it does no DOM read), but "must re-layout" is not "must re-layout uncoalesced" — the engine's own `apply()` writes real layout and still coalesces — so it now schedules one frame per event and commits at most ONE equality-bailed `setPos` per frame, through the same `commitPos` door the move's edges use. The shape is the one thing worth carrying forward: React stays the **owner** of `width`/`height` and the coalescing sits in FRONT of it, because JSX *does* set those properties — the move path's imperative channel is safe only because JSX never writes `transform`, so a mid-gesture re-render leaves a translate standing and would clobber an imperative width. A resize therefore has no zero-commit form; one commit per frame is its floor. (2) The bus's window publisher needs two resize events in 100 ms, so a **one-shot** viewport change mid-drag (keyboard maximize, DPR change) publishes nothing and leaves the snapshot stale for the rest of the gesture; survivable because both readers share it and stay stale *together*, which is the exposure the StackIcon's cached rect already carries. (3) The `[cost: …]` tag convention is enforced since **task 334** — see "The tag half" below. (4) The four sibling gestures named here (`useDragPosition`, the editor-scrollbar thumb, the card-lift threshold detector, `useMarginEdit`'s hand-written twins) were **closed by task 333**, along with the census blindness — see "The census half" below.

**The engine owns the gesture, the `.dragging` chrome HOOK and — since task 189 — the handle's a11y SEMANTICS; the consumer owns the look.** `PaneResizeHandleProps` returns nothing visual, so every consumer renders `drag-gap drag-gap-{h,v} band-grip` **on the handle's own element** or sits on `PERMITTED_UNCHROMED_RESIZERS` with a stated reason (one entry: the Library list's column boundary, a content-height header track the 28→44px pill would overflow — and it still takes the family's tokens AND its state→color mapping, transparent → `--drag-highlight` on hover → an escalated drag state, because an exception buys a different shape, never a different palette). The semantic half is a recorded POSTURE, not an oversight: **Virgil does not yet commit to keyboard/screen-reader operation of its layout chrome** (STYLE_GUIDE "Resize gutters" → "Accessibility posture"), so the engine emits `aria-hidden` and **no divider announces itself** — the pre-189 middle state, where 4 of 10 handles carried a *named, valueless, non-operable* `role="separator"` while `FloatingPanel`'s 5 edges and `EditorPane`'s 4 margin guides carried `aria-label` on bare divs ARIA forbids naming (inert, announcing nothing), is the thing outlawed: a control that claims to work and then refuses is worse than one that stays quiet. Both halves are censused in the same guardrail, and each is blind to the OTHER legs' needles — a hand-rolled *look* or *role* on a perfectly correct gesture matches none of them, which is exactly how both drifted with CI green.

Three properties of that census are load-bearing rather than incidental, each earned by its own first draft being wrong. It asks **per handle, not per file** — `LibraryView` holds three and `panel-column` two, so a file-level question lets one drifting handle be exempted by a chromed sibling, and the original `--accent` drift was catchable only because `LeftList` happens to hold exactly one. It reads JSX by scanning to the tag's **real** end rather than to the first `>`, because `onMouseDown={(e) => …}` is the repo's dominant idiom and a `[^>]*` class truncates the tag at the arrow — which is how the four margin guides sat unflagged under a guard written to indict them. And it asks whether a handle's subtree holds a **focusable node**, since that is the premise `aria-hidden` rests on and nothing else states it.

### The content half: the drag that inherited none of the four obligations

Same law, and the case where the reference implementation was written down, cited by name in
the very allowlist the offender sits on, and simply never applied to the gesture people use
most (task 351). Gabriel: dragging bullet-list items is "extremely choppy and rough — should
be smooth-like-butter Notion-style." A content drag — the block / text-object lift that routes
through the drop-mode controller — had a lift overlay that was exemplary (RAF-coalesced
`translate3d`, equality bail, React on edges only) bolted onto a **controller that took none of
task 330's four obligations**, and three costs outside it that only a real drag reaches.

Four findings, each silent, and the order below is the order they bite:

- **A `pointer-events: auto` overlay above the editor turns `posAtCoords` into an O(doc)
  forced-layout sweep.** `view.posAtCoords` asks `document.elementFromPoint` first; when the
  answer is a node OUTSIDE `view.dom`, ProseMirror falls back to `elementFromPoint(view.dom, …)`
  — a wrap-around `getClientRects()` scan over EVERY top-level block with no early break — and
  `posFromCaret` then returns null, so `posFromElement`'s `findOffsetInNode` sweeps them all
  again. **Two doc-proportional passes per throttled move.** `globals.css` had made floating
  panels click-through for exactly this reason in Wave 0 ("floats become click-through so the
  cursor falls through to the editor for hit-testing") and the member list was never completed:
  the MARGIN chrome — grab handles, marginalia markers, the overflow pill, the orphan dock —
  sits inside `.ProseMirror`'s own 88/72px padding band, which is precisely where a Notion-style
  user drags. One rule, an incomplete member list, and the cost of the gap is not a missed hover.
- **The gesture measured at POINTER rate.** `feedAutoScroll` ran on every raw `mousemove` and
  opened with `scrollEl.getBoundingClientRect()` — the zone gate lives *inside* the probe, so a
  forced layout answered "am I near an edge?" about a container that cannot move under a held
  pointer, 120–240 times a second, for a drag nowhere near an edge. Verbatim the shape task 334
  found in `focus-band-drag` and task 333 in `useDragPosition`'s RAF body.
- **It coalesced on a wall clock, not a frame** — and its fast branch ran the whole hit-test
  SYNCHRONOUSLY inside the mousemove handler, so the indicator's own React style write landed
  between two of the gesture's own reads. A 16 ms timer against a 16.67 ms frame also beats
  against vsync at ~2.5 Hz, so the pass lands at a drifting phase relative to paint.
- **The one thing that actually MOVES was moved by `top`.** The drop indicator is
  `position: fixed` and `globals.css` eased its `top` — an 80 ms main-thread LAYOUT animation
  restarted on every placement change, which during a drag through a dense list is most frames.
  The tree was therefore never clean, so every rect read in the app paid a forced style+layout
  flush. The float shell and the lift overlay both move by `translate3d` under a law this file
  already states ("a `left`/`top` write re-lays-out every frame"); the bar was the one element in
  the gesture that moves and the one that hadn't taken it.

> **A content drag is a bespoke gesture, so it owes the four obligations whole: COALESCE (one
> pass per FRAME, at the LIVE pointer, never inline in the event), SNAPSHOT (every geometry the
> per-move math needs captured once at the edge and read through ONE lazy door), COMMIT ONCE,
> and the two POINTER INVARIANTS. And the gesture's CHROME owes a fifth: everything painted
> above the editor is click-through for the session, because the hit-test has to reach the
> editor through it.**

The snapshot door is [src/components/drop-mode/move-geometry.ts](src/components/drop-mode/move-geometry.ts),
the same shape `FloatingPanel`'s `readMoveGeometry` has: lazy capture, re-armed off the bus's SET
channel, dropped on the ONE teardown every ending funnels through. Two rules it earned:

- **The span memo is HORIZONTAL-only, and that is load-bearing rather than tidy.** Auto-scroll
  moves content vertically under a parked pointer, so a cached `.top` is stale within a frame,
  while `.left`/`.width` cannot change without a reflow a drag does not cause. The door therefore
  stores the PAIR, not the `ContentEdges` record — there is no `.top` to reach for — and a
  consumer that needs a vertical number reads the one live block rect the hit-test already threads.
- **The re-hit-test is REQUESTED, not run.** Auto-scroll's frame writes `scrollTop` and then asks
  for a pass, so the WRITE and the next READ land in different frames. Running it inline bought a
  one-frame-fresher indicator nobody can see, at the price of a forced flush immediately behind
  the gesture's own write.

The same pass closed the par-title hover band ([Editor.tsx](src/components/Editor.tsx)) — the grab
handle's **twin**: same question (which block is the pointer over?), same source (`blocksAtY`),
and during a drag the answer is invisible under the ghost. `TextObjectGrabHandle`'s tracker took
`parkDuringLayoutGesture` + a RAF in Wave 2; this one took neither, so per RAW pointer event it
ran a `localStorage` read (the `virgil:geom-hover` kill-switch — the `getWindowInsetTopPx` shape
task 330 names, at pointer rate), a host rect, an O(near-zone) scan, and then an UNINDEXED
`querySelector` over each hit's whole subtree. **A `bulletList` hit's subtree is the whole list**,
which is why the felt cost was list-shaped and why a bullet-item drag was worse than any other.

CI: [content-drag-move-cost.test.ts](src/components/drop-mode/__tests__/content-drag-move-cost.test.ts)
drives the REAL controller and asserts what runs per EVENT versus per coalesced FRAME (twelve raw
moves cost ZERO DOM reads after the gesture's one capture; eight cost ONE hit-test, at the LAST
coordinate); [content-drag-guardrail](src/lib/__tests__/content-drag-guardrail.test.ts) gains the
click-through census (per HOOK, and the hooks are re-checked against what the components emit — a
rename would leave the CSS matching nothing) and the coalescing/snapshot pins. Every defect leg
fails on its own pre-fix half, measured by neutering each in turn. One harness detail worth
carrying forward: the fixture stubs the scroll container's OWN `getBoundingClientRect`, which
**shadows `Element.prototype`** — so the first draft's prototype-only counter reported zero and the
per-move-read leg passed vacuously under its own neuter. Count at the source (the trap
`float-move-gesture-cost` records).

**Owed, not claimed.** This run had no browser: the wall-clock half of the acceptance bar — a
DevTools trace of a 5 s drag over `doc_perftest` with no >8 ms task attributable to the drag path,
and Gabriel's own "smooth like butter" feel check — is outstanding. What is proven here is the
STRUCTURE (call counts and coalescing), which is what the sibling harnesses prove too. Residuals
the audit named and this pass did not close, in priority order: the geometry service's
IntersectionObserver path is ungated during a gesture, so each auto-scroll frame can fire a
`measureBlock` + a full Marginalia grid repack; `EditorLayout`'s section-path breadcrumb parks for
RESIZE only and runs live on the scroll a drag generates; and three ungoverned scroll listeners
(the editor scrollbar, the scroll-activity tracker, and `EditorPane`'s scroll-persist, which reads
`offsetHeight` per event) run per scroll frame.

### The census half: an invariant with no census is how the others drifted

Same law, and the case where the law was already written, already mandatory, and enforced by a guard that could not see most of the gestures it governed (task 333). `detectWindowDragGesture` is a **conjunction** — a window-level move listener AND drag chrome (a body-cursor write, a CSS resize cursor, or the shared handle classes) — because it was built to catch a bespoke *divider*, and a divider always wears one of those. A whole category of window drag wears none: a scrollbar thumb sets no cursor, and a **hold-threshold detector** (the card lift, the marginalia marker re-anchor, the inline-atom grab, the block grab handle) is chrome-free until it hands off. Eleven files in `src/` install a window-level move listener; the chrome census saw six.

The four it could not see had each drifted differently, and none of them throws:

- the **editor-scrollbar thumb** had NO invariant at all — not even a button gate, so a right-press started a drag whose end event the context menu then ate, and the document ghost-scrolled under a released pointer;
- **`useDragPosition`** (the Preferences window, the app's other bespoke 2D move) had no missed-release bail, so the dialog stayed glued to the cursor and committed on the user's next click with the grabbing cursor and the global `user-select: none` wedged on `<body>` — task 185 verbatim, in a gesture the chrome allowlist already sanctioned. It also read `offsetWidth`/`offsetHeight` inside its RAF body, a forced layout per frame for a value that cannot change mid-drag;
- the **card-lift** and **grab-handle** threshold detectors stayed ARMED after a swallowed mouseup, so the user's next ordinary mouse movement crossed the threshold and popped a card out of the panel — or lifted a block out of the document — from a press they had already let go of;
- the **marginalia marker** watcher leaked its listeners forever, and since each later movement re-armed `suppressClickRef`, the marker's click stopped opening its panel *permanently*.

> **Every file that installs a window/document-level move listener is censused, chrome or no chrome. One that also tears down from a pointer RELEASE owns a held gesture and must REFERENCE the invariants module; and nothing anywhere may re-derive what that module publishes.**

Three legs, and the membership one is deliberately not the interesting one — it is the *reach* that lets the other two ask their question of the whole category. `PERMITTED_WINDOW_POINTER_LISTENERS` carries a per-file justification; the invariants and no-twins allowlists are **EMPTY**, and stay that way: a hit is MIGRATE-it. Four rules it earned:

- **The gesture/watcher line is drawn at the RELEASE TEARDOWN, not by hand.** A permanent hover tracker (`TextObjectGrabHandle`'s `document` mousemove, which resolves which block the handle points at) has no release to miss and owes no invariants — and it is exempt *by construction* rather than by allowlist, because it registers no `mouseup`. That same file's OTHER listener is a gesture and is held to both. A per-file allowlist entry would have exempted both halves at once.
- **A bail is PRE-threshold only where the post-threshold gesture has another owner.** `inline-atom-grab` and `TextObjectGrabHandle` hand off at the threshold — to the drop-mode controller and to `LiftHost`, each of which carries its own bail. Ending the gesture from the *detector* after handoff would commit the drop at a stale coordinate. So the detector bails only in its exclusive ownership window, and says so at the site.
- **The bail alone is not the fix; the END PATH must cancel the queued frame.** A coalesced gesture schedules a frame on a held move; if the missed release lands before that frame runs, a bail that merely stops listening still lets the stale coordinate commit one frame later. `useDragPosition` therefore ends through ONE path that cancels the RAF, clears the chrome and detaches — the "commit once, through one end path" obligation, read as *no ending may skip the teardown*.
- **The no-twins leg sweeps BOTH silos, not just the censused files.** A gesture can take the SSOT for its start gate and hand-write its release bail — which is exactly how `useMarginEdit` sat correct-but-forked, restating the engine's own reasoning verbatim in its own comments. And a `button !== 0` on an ordinary click handler is where the *next* gesture's start gate gets copied from, so nine production sites were converted, not four.

**Whether a shared 2D-move primitive earns its keep** (the question task 334 asks): **not yet.** After this task `FloatingPanel` and `useDragPosition` are the two 2D moves, and what they share is now four *predicates and rules* — all of which live in modules both import or in this prose. What is left un-shared is genuinely per-site: the float snapshots dock bands and a WCO inset and moves by `translate3d` on its own element; the dialog snapshots two clamp bounds and commits React state, because its position IS its session state and there is no persistence to defer. A primitive over two call sites with that little in common buys a parameter bag, not an invariant. **Task 334 confirmed the decline** after closing the two real items behind it (below), and the reason is worth keeping: the copies are held together by shared *predicates*, a shared *census*, and now a per-site *cost statement* — three instruments that each catch a different drift, where a shared hook would have caught only the one nobody was getting wrong.

CI: [bespoke-gesture-missed-release.test.tsx](src/lib/__tests__/bespoke-gesture-missed-release.test.tsx) drives all three REAL gestures (`useDragPosition` through the real hook, the thumb through a real `EditorScrollbar` render, the card lift through a real `PanelCard` press) and every defect leg fails on the pre-fix code, measured. jsdom defaults `buttons` to 0, so every LIVE move in these suites passes `buttons: 1` explicitly — which is how the legs prove the invariant is wired rather than passing vacuously, and why two pre-existing lift suites needed the same field added. The census legs live in the same [pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts) as the chrome half; measured on the pre-fix tree they name seven bare gestures and nine re-derived twins.

### The tag half: a convention with no leg is a habit, and the copies had already diverged

Same law, and the case where the instrument that would have caught the drift was written down in one guardrail and merely *imitated* in its sibling (task 334). `keystroke-subscriber-guardrail` has enforced a `[cost: …]` prefix on every justification in every one of its allowlists since Wave-4 P6; `pane-drag-guardrail` carried the convention — task 330's `FloatingPanel` entry opens with one — and enforced it nowhere. So two of its five drag entries and **all five** ResizeObserver entries described the MECHANISM and never the per-event cost: the gate-not-callback shape that let `float-sync` sit on the keystroke list for a year, one file over.

> **Every allowlist in a cost census states, per entry, what one EVENT costs and what one coalesced FRAME writes. A list whose justifications answer a different question (a LOOK, an a11y ROLE, a safety argument) declares `cost: false` and says which — and membership is DISCOVERED from the file's own source, never hand-listed.**

What the tag buys is not tidiness, and the proof is that writing one is what found the bug. Composing the sentence for `focus-band-drag.ts` surfaced a `getBoundingClientRect()` it ran **per move** — a forced layout in the write path for an origin that cannot move under a held pointer, the same shape task 333 took out of `useDragPosition`'s RAF body, and invisible to every other leg in the file: the chrome census asks who installs a listener, the pointer census asks whether it takes the invariants, and neither asks what a move COSTS. A sentence that must name the per-event and per-frame costs *separately* is the cheapest instrument that asks.

Three rules it earned:

- **The membership leg reads this file's own source.** Any `const PERMITTED_*: Record<string, string>` must appear in the `ALLOWLISTS` registry, so a sixth list cannot land untagged. A hand list inside the guard that outlaws hand lists is the task-260 defect one level up — it would sit green while the new list drifted.
- **`cost: false` is an ANSWER, not an escape hatch.** The three non-cost lists (`PERMITTED_UNCHROMED_RESIZERS` — a look; `PERMITTED_ANNOUNCED_SEPARATORS` — a11y semantics; the two EMPTY invariant lists — safety) each state their reason, and the leg requires one. Without that, a real per-event census walks out of the tag rule by relabelling itself.
- **Write the tag as a claim you would have to defend, not as a summary of the code.** The `FloatingPanel` entry recorded its resize branch's uncoalesced per-event commit **as a residual with a task number**, where the pre-334 text argued that a layout write excuses it — and naming it that way is what got it fixed one task later (335). The editor-scrollbar thumb's un-coalesced write is the entry that shows the difference: a scroll position is state the browser itself coalesces to one paint, which is exactly the argument the resize branch could not make.

**And the copies had already diverged, which is the other half of what this task filed.** The lift overlay (`LiftHost`) moves by RAF-coalesced `translate3d` on two portal nodes — the same channel `FloatingPanel`'s `applyTranslate` runs — and it had **no equality bail**, so every frame at an unchanged delta rewrote both nodes' `transform`. That is not a theoretical frame: a hold over a drop target is how people confirm a target before releasing, and the drop controller's edge-zone auto-scroll re-runs its hit-test at a **parked** cursor by design. Two details make the bail correct rather than merely present: it records the TARGET NODES alongside the delta (a node swapped by a ghost↔popout flip must be written even at an unchanged delta), and it records **nothing** when neither node is mounted yet — a frame that ran before the portal committed would otherwise claim the delta as applied and the node would never receive it. The rest value at zero delta (an empty string, not an identity transform) is pinned too, so the two copies of one channel agree on their rest as well as on their bail.

**Residual, stated rather than implied:** `focus-band-drag` is not on the `LayoutGestureBus`, so a one-shot reflow with the button held (a keyboard window resize, Stage Manager, a DPR change) leaves its snapshotted origin stale for the rest of that drag — a constant offset in the transient band, healed by the next mousedown. Same exposure residual (2) above names for the float's snapshot, and stated at the site rather than papered over with a parking claim the file cannot back.

CI: the tag, non-cost-reason and discovered-membership legs live in [pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts); the overlay's write channel is driven through the REAL `beginLift` gesture in [lift-overlay-motion-cost.test.tsx](src/text-objects/__tests__/lift-overlay-motion-cost.test.tsx) (one queued frame for eight events, the bail, the rest value, and no stale write behind the missed-release end path); and the focus band's cost claim is pinned where the gesture can be driven, in [focus-band-edge-drag.test.tsx](src/panels/Outline/__tests__/focus-band-edge-drag.test.tsx) — one rect read for fifteen moves, and a fresh read on the NEXT gesture, since a snapshot inherited across drags is the same staleness the reset exists to prevent. Every defect leg was measured by neutering the half it guards.

Drag-time coordination is **edge-only** on the app-wide `LayoutGestureBus` (`isLayoutGestureActive`/`onLayoutGestureChange` — fires once on begin, once on end, never per frame; it replaced the retired `virgil:drag-gap-start/end` window events and `library/lib/gutter-drag.ts`). Followers built on those edges: `PaneFreeze` (width-locks a heavyweight pane's content so pdf.js/ProseMirror see exactly ONE resize per gesture) and `parkDuringLayoutGesture` (geometry observers stash-dirty mid-gesture, settle once on the end edge). This is the "gutter drag chops/hangs/ghost-resumes; chrome outline snaps late" class (library-UI refactor 2026-07). CI: [src/lib/\_\_tests\_\_/pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts) greps BOTH silos for window-level move listeners paired with drag chrome (a body-cursor write, a resize cursor token, or the shared `.drag-gap`/`.band-grip` handle classes); every hit must be on `PERMITTED_WINDOW_DRAG_GESTURES` with a why-safe justification (a pane divider never qualifies — migrate it to the engine), the retired primitives are pinned dead, and every library-silo `ResizeObserver` must be on `PERMITTED_LIBRARY_RESIZE_OBSERVERS` (the census with CI teeth — kills the unparked-RO and measured-chrome reintroduction paths). Library-silo doctrine: library/AGENTS.md "Perf doctrine".

## Layout-gesture stability

> **A continuous layout gesture — a pane-divider drag, an OS window resize, OR a content drag (drop-mode session) — costs O(1) settles, not O(frames) recomputes.** Every geometry follower either **PARKS** (`parkDuringLayoutGesture`: stash the call, replay exactly once on the gesture's end edge) or **SUPPRESSES** (`useLayoutGestureActive` / `isLayoutGestureActive` / `onLayoutGestureChange`: hide for the gesture, restore on the end edge). Nothing re-solves per frame.

This is the "resizing the PWA window makes the whole right side flicker" class (task 317), and its lesson is not that followers were sloppy — the doctrine above already existed and was **structurally unreachable for the gesture that needs it most**. `activeDrag` had exactly one writer repo-wide, `beginPaneDrag` inside the engine's `onPointerDown`, and **an OS window drag delivers no pointer events to the page at all**. So `isPaneDragging()` was false for the entire gesture: every park took its immediate-`run()` branch, `PaneFreeze` never locked, `parkDuringPaneDrag` had zero callers in `src/`, and the three `library/` consumers were inert while their comments asserted a freeze that wasn't there. Eighteen `addEventListener("resize")` sites and ~17 ResizeObservers ran live, every frame.

**One bus, three publishers.** [src/lib/pane-resize/layout-gesture-bus.ts](src/lib/pane-resize/layout-gesture-bus.ts) carries `kind: "pane" | "window" | "content"` on the info, so every pre-existing consumer gained window — and then content-drag — coverage with zero code change. One bus rather than several because the consumer set is identical and *the second subscription is exactly the one that gets forgotten* — this bug's own signature was `RightDetail` parking its ResizeObserver on the pane bus while registering a raw window `resize` listener to the same scheduler 38 lines away. The publishers stay **separate** (pointer edges, resize-burst edges, and the drop-mode session lifecycle are genuinely different detectors) and **colocated** (the edge functions are withheld from the barrel, so no consumer can fake an edge). The bus tracks a **set** and publishes only 0→1 / 1→0 on the main channel, because a pane drag and a window reflow (external display, Stage Manager) can overlap and an end edge published mid-gesture would un-park every follower.

**The content publisher** (perf Wave 2): a drop-mode session — block / text-object / inline-atom / card-anchor / stack-pull drag — publishes through `beginContentGesture`/`endContentGesture`, whose kind is pinned inside the bus and whose ONE legitimate caller is the drop-mode controller (the single chokepoint every pointer-driven content drag routes through; CI: [src/lib/\_\_tests\_\_/content-drag-guardrail.test.ts](src/lib/__tests__/content-drag-guardrail.test.ts) pins the import set). Edges: begin on session start; end at **commit entry** (the pointer gesture is over — a confirm dialog must not hold every park hostage) and idempotently in `endDropSession`, so no cancel path can leak a wedged gesture. Every producer is a hold-drag, so the controller's shared mousemove AND the lift overlay bail on `isMissedRelease` — with the bus in the loop, a swallowed mouseup would otherwise wedge every parked follower app-wide, not just leak an overlay. The same guardrail pins the rest of the content-drag law: the lift overlay moves by RAF-coalesced `translate3d` (React renders on edges only; JSX never sets `transform`), the Wave-0 universal drop-mode selector stays dead, and the hit-test move path never mints. The controller also owns edge-zone **auto-scroll** ([src/components/drop-mode/auto-scroll.ts](src/components/drop-mode/auto-scroll.ts)) — one self-terminating RAF loop that re-runs the throttled hit-test as content slides under the parked pointer; zero cost off the drag path.

**Kind-sensitive consumers use the SET channel, never the edge info.** The main channel publishes only OUTERMOST edges, so under overlap its begin and end can carry DIFFERENT gestures — an `info.kind` (or `info.id`) filter there skips the restore half and wedges the consumer. `onLayoutGestureSetChange` fires on every MEMBERSHIP change with that gesture's own info (still ≤2 fires per gesture, never per frame), and `hasActiveLayoutGesture(kinds)` reads the live set — recompute the desired state from it per fire, idempotently. On it today: `PaneFreeze` freezes for RESIZE-family only (a content drag must never freeze the pane hosting the drag — the Library Reader's `.tex` branch mounts an EditorPane inside one) and unfreezes the moment the last resize gesture leaves, even mid-content-drag; the editor-scrollbar thumb suppress is kind-filtered (a content drag moves no pane edge, and drag auto-scroll wants the thumb visible); `zen-margin` + `panel-column` id-filter on it (their old edge-channel id filters could strand `isResizing` under overlap). `useLayoutGestureActive(kinds?)` is the hook form of the same rule.

**The window publisher's edges**, the one genuinely new piece, since there is no `resizestart` and no pointer stream to derive one from: **BEGIN** on the *second* resize event inside a 100 ms burst — so a one-shot resize (maximize, zoom, keyboard, DPR change) never parks anything and nothing is left stale for a debounce window; **END** on a 150 ms trailing idle. A false end (the user holds still mid-drag) is benign by construction: followers settle once at the held position and re-park on the next event.

**Park or suppress — the choice is not stylistic.** Park a follower that MEASURES the resizing content from outside: nothing user-visible depends on its value mid-gesture, so it settles once and is correct. Suppress a **text-anchored overlay** (the slash popup, the selection bolt, the pending-change pill): parking one leaves it visibly *detached* from the text it points at, which is worse than the flicker it was meant to fix. Stay LIVE only where the frame itself is the obligation — today just `useWindowChrome` (the WCO strip tracks the native system buttons), and even that is RAF-coalesced, because it notifies through `useSyncExternalStore` at the app ROOT.

**Honest about the residual.** The left-edge asymmetry Gabriel reported is *compositor-side*, not ours: every placement path in both silos is client-origin-relative (`screenX`/`outerWidth`/`visualViewport` appear nowhere), so for the same resulting size a left- and a right-edge drag deliver byte-identical values to every handler — the DOM cannot observe which edge moved. What is ours is the *missed frame*; Chromium converts a missed frame on a moving frame-origin into a whole-window displacement rather than a stale edge strip. Removing our per-frame work removes the late frames. Expect a large improvement, not perfection. What IS ours on the right side: the editor column carries `flex: 1000 1 0` between two `flex-grow:1` rails, so a width delta moves its left edge ~0.001·d and its **right edge ~0.999·d** — identical JS lag is sub-pixel on left-anchored chrome and full-delta on right-anchored chrome, which is why the left-anchored grab handles never visibly flickered under the same handler count.

Two guards enforce it (the same probe + grep-allowlist pattern as the laws above):

- **Runtime probe** — `window.__layoutGestureStats()` ([src/lib/layout-gesture-probe.ts](src/lib/layout-gesture-probe.ts)) reports `{ gestures, framesInGesture, active }` plus per-site `{ parkedFires, settles, liveRuns }`. During a continuous drag every parked site reports `settles === 0` and `parkedFires ≈ framesInGesture`; after release, **exactly 1** settle per site that fired; a one-shot resize reports `gestures === 0`. Honest floor: the publisher needs two events to know a gesture started, so a real drag's first event or two run live and are counted in `liveRuns`.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/window-resize-guardrail.test.ts](src/lib/__tests__/window-resize-guardrail.test.ts) censuses every resize registration in `src/` **and** `library/` (`addEventListener("resize"` on any receiver, plus the `onresize =` and `visualViewport` forms) against `PERMITTED_RESIZE_LISTENERS`, and — the leg with teeth — asserts each censused file actually *references* the park/suppress API unless it is on `PERMITTED_LIVE_RESIZE_HANDLERS` with a why-live justification. **None of the three older censuses greps a resize listener**, and that gap is precisely how eighteen ungoverned sites accumulated without a single CI failure. Keep this prose and both allowlists in sync — same discipline as the other laws.

Deliberately NOT done, and a UX call rather than an oversight: **no root-level `PaneFreeze`**. Its anchor must be the *stationary* edge (anchoring to the moving one is visibly worse than no freeze at all), knowing which window edge moved requires a `screenX`/`screenY` probe this codebase otherwise doesn't use, and freezing the whole app during a live OS resize shows background slivers until release.

## Editor geometry ("where is it on screen?")

> **Per-block screen geometry has ONE owner per editor: the EditorGeometry service** ([src/lib/editor-geometry/](src/lib/editor-geometry/service.ts), perf Wave 2 — the marginalia registry's engine evolved editor-attached, the `getBus`/`getDocProducts` precedent). IO near-zone culling (viewport ±800 px), one per-editor RO, a sparse uuid-keyed metrics cache with ε bails and parked (positioned-but-unpainted) twins, a RAF-coalesced gesture-parked measure pass. A consumer that needs a block's Y asks `getGeometry(editor)` (`blocksAtY`, `getMetrics`) or derives from the DocStructure snapshot (`computeSectionPathAt` — the breadcrumb: ONE `posAtCoords` at the reference line + binary search over pos-sorted headings ∪ `BlockEntry.parTitled` blocks) — it does not walk the doc calling `coordsAtPos` per block, and it does not `querySelectorAll` + rect-read per candidate. The pre-service scans survive only as automatic fallbacks (service null) behind kill-switches (`virgil:geom-breadcrumb`, `virgil:geom-hover` — `"off"` reverts). `useMarginaliaRegistry` is a thin adapter over the service; its suites are the engine's parity gate. The service also owns the **viewport frame** (wave-2b C7): text edges / pod rect / scroll band / portal context, measured ONCE per editor by the engine's single RO (the editor element + its scroll container ride the same observer as the near-zone blocks) + window-resize + gesture park, equality-bailed, read through `useViewportFrame` ([src/lib/editor-geometry/use-viewport-frame.ts](src/lib/editor-geometry/use-viewport-frame.ts)) by the placement overlays (`SelectionActionsMenu`, `TextObjectGrabHandle`, `PendingChangePill`, `LiftHost`) — plus ONE non-placement reader that takes the channel directly rather than through the hook, `Marginalia`'s `useLaneCols`, because it needs a per-side COLUMN COUNT rather than a frame and subscribes with a primitive snapshot so an unchanged regime costs no render (see "The lane regime" below) — the per-consumer `useEditorViewportCache` (4 hook instances, 8 ROs + 4 resize listeners per pane measuring identical geometry) is DELETED. Caret line boxes on the placement path go through `coordsAtPosCached` (per-frame + per-doc memo on the service; service-less editors fall back to a direct read). Same inversion for the active-paragraph nav history (wave-2b C6): `computeActiveParagraphId` ([src/lib/editor-geometry/active-block.ts](src/lib/editor-geometry/active-block.ts)) — hidden-pane bail, `__DOC_TOP__` sentinel, ONE `posAtCoords` at the viewport top edge + snapshot binary search, legacy triple-walk retained as automatic fallback behind `virgil:geom-active-block`; its two wall-clock pollers (EditorLayout recorder, reader `useParaNavHistory`) gate on `document.hidden` + `isLayoutGestureActive()`. `useInTextPositions` (wave-2b C5) exact-reads only the scroll band and interpolates out-of-band anchors (`approxTopForPos`; scroll-idle refinement settles them exact) — with band membership decided on the anchor's document POSITION, never on the card's own last-committed top (see "The refinement gate" below). On the drop path, the per-move hit-test's block-rect read is THREADED into the placement builders (wave-2b C8) — one forced-layout read per move, with the builders' own read kept only as the fallback for rect-less callers. Probe: `window.__geometryStats()` (alias of `__marginaliaStats`; includes the `blocksAtY` hover-path counters). The wave-2 residual conversions (C5/C6/C7/C8) are all delivered.

### The refinement gate: an approximation never decides its own eligibility

> **A gate that chooses which items get the exact read must not read the estimate it exists to correct.** Ask the question in a space where the input is ground truth — for anchored geometry that is the document POSITION, maintained by the observer's mapping, and the band comes back from the view (`resolveVisiblePosBand`, [viewport-probe.ts](src/lib/editor-geometry/viewport-probe.ts)) rather than from anything a previous pass wrote.

This is the "the card lane beside the text I'm reading is empty, and when cards do come in they overlap" class (task 327), and its lesson is about a defect that **no amount of care inside the gate could have prevented**, because the loop was in the gate's *shape*. C5 classified each already-measured card by its RETAINED pod-relative top: outside the ±`NEAR_ZONE_PX` band ⇒ deferred to `approxTopForPos`. That is a self-referential test, so its error mode is **absorbing** rather than merely occasional: a card whose retained top is wrong by more than the band's padding classifies out-of-band, is re-approximated from the same knots, and classifies out again — forever. *The exact read that would correct the retained top is exactly what the wrong retained top prevents.* Nothing throws, nothing degrades, and the scroll-idle refinement keeps running as a fixed-point iteration on its own output.

Every ingredient ships in production and none is exotic. The **seed** is the degeneracy guard's own deliberate choice — a first-paint measure that raced layout (FOUT, KaTeX / figure NodeViews, the FSA load) commits anyway, "rather than render a blank column". The **displacement** is an FSA open restoring a mid-doc scroll, so the viewport lands far from the only well-seeded region. And the **magnitude** comes free on a real paper: the two endpoint knots are linear in pos over `[0, docSize]`, so with structurally uneven px-per-pos density mid-doc interpolation error passes 600 px easily. The dev doc is small, uniform, and has no FSA timing — which is why this is a member of the FSA-masked class (`anchor_persistence_dev_masks_fsa`) and why the durable evidence is a unit harness, not a preview pass.

Four rules it earned:

- **The probe FAILS OPEN.** `resolveVisiblePosBand` widens anything unresolvable to the document's edge. The asymmetry is the whole point: a band that is too wide costs extra `coordsAtPos` reads for one pass (the pre-C5 cost — correct, just slower), while a band that is too narrow silently withholds the read from something the user can see, which is the defect itself. A padded extent already covering the content box resolves to the whole document with no probe at all — cheaper *and* exact.
- **A probe must land ON SCREEN, and the near-zone padding is therefore applied in POSITION space.** This one was caught by the adversarial pass on the fix, where the first cut probed at the ±600 px padded edges — off-screen by construction on the very mid-doc scroll the fix targets. `posAtCoords` asks the browser first, and the browser answers null for an off-viewport point; PM's fallback is a wrap-around `getClientRects()` sweep over every top-level block, and on an inter-block margin gap it returns `view.dom` and sweeps them all again. So an off-viewport probe is a doc-proportional forced-layout read wearing an O(1) call's clothes — on a path the editor RO already attributes keystroke work to. The probes now take the scroll container's REAL edges and the padding is converted through the density those two probes measure (the document average when both land on one position). The visible range, the part that must never be wrong, stays exact; the padding is a comfort margin, and under-estimating it only defers a card that far off-screen to the scroll-idle refinement that already exists. **The lesson generalizes past this hook: `posAtCoords` is O(1) only where the browser's own hit-test can answer.**
- **"Never measured" may still widen the exact set.** An item with no prior entry is exact-read whatever the band says. That is a fact about HISTORY, not a derived geometry estimate, and it only ever admits more items — so it cannot re-introduce the absorbing state, while it keeps the cold pass richly seeded with knots.
- **The heal has to reach the HEIGHT too.** The card-rect read lives inside the exact branch, so a permanently-deferred card is also a permanently `DEFAULT_ENTRY_HEIGHT` card — which is why the second symptom was arithmetic-exact overlap at the 60 + 4 px quantum rather than mere misplacement. One gate, two symptoms; fixing the classification fixes both, and the suite asserts the height half separately so a future change can't restore one without the other.

The two probes share the hit-test idiom `computeSectionPathAt` and `computeActiveBlockId` had each re-derived (probe at the CONTENT BOX's horizontal center — not the pod's, which is a different anchor and a defined term two sections down; clamp Y; try/catch; null on a miss) — now one `posAtViewportY` all three call, which is also where the viewport half of the clamp now lives for all of them. CI: [useInTextPositions-pos-band-classification.test.tsx](src/hooks/__tests__/useInTextPositions-pos-band-classification.test.tsx) drives the REAL hook through the real story (compressed cold measure → real geometry → repeated passes) over a deliberately PIECEWISE synthetic map — a uniform document heals itself by accident and would prove nothing — and its four classification legs fail on the pre-fix gate while its fifth, "probes the band ON SCREEN", fails on the fix's own first cut. [viewport-probe.test.ts](src/lib/editor-geometry/__tests__/viewport-probe.test.ts) pins both properties a later "tightening" would be most tempted to invert: the fail-open direction, and that no probe leaves the viewport however large the padding.

### The lane regime: pod-anchored chrome asks whether its slot still clears the prose

> **Every element in the marginalia lane is POD-anchored — its x is a fixed offset from the pod edge — while the prose text edge moves with the margin. So each one must ask, from the MEASURED margin, whether its slot still lands in the margin or back over the text. One predicate answers it for all of them: [`laneSlotClearsProse(inset, available)`](src/lib/marginalia.ts).**

This is the "markers paint over the last words of every marked line" class (task 214), and its lesson is about a decision that was *scattered by omission*. The lane's width is floored only while the lane is RESERVED (`marginaliaLaneReserved`), and three consumers depended on that: the floor itself (`resolveHorizontalMargin`), the selection bolt (`computeBoltLeftFromPod`, which since task 045 tucks against the scrollbar and floors at the prose edge), and the marker grid — which **never asked at all**. It packed at the fixed 104px-lane offsets whatever the margin was, so opening the Code pane (which caps the margin at `CODE_VIEW_GUTTER_PX` = 48 and stops reserving the lane) put right col0's opaque badge 14px inboard of the text edge. The `EditorPane` comment claimed markers "gracefully degrade (same as zen / the Library reader)" — but zen and the reader HIDE and the bolt TUCKS, while the grid did neither. **A stated invariant with no consumer is not an invariant.**

Three rules it earned:

- **The question is geometric, not a flag.** `available` is the MEASURED pod-edge → text-edge distance (`podRight − editorRight`, `contentLeft − podLeft` from the geometry service's viewport frame), never the `--editor-pl`/`--editor-pr` pref — the pod sits inside the code-split clip, so `podRight` is the VISIBLE edge and the pref overstates the room. Reading geometry rather than a flag also covers every OTHER narrowing path (zen, a hand-dragged margin, the reader) without threading a second flag to a third consumer, which is exactly how the first one was missed.
- **The threshold is DERIVED per element, from where it actually paints.** `inset` is the distance from the pod edge to that element's INNERMOST edge: the bolt's inboard slot is 96 (⇒ needs a 104px margin — byte-identical to the inline comparison it replaced), the marker grid's is `marginGridInset(side)` — right 62 (⇒ 70), left 44 (⇒ 52, because the left grid is ONE column and the inner-left slot belongs to the popout button). The thresholds differing is the point: the bolt is inboard of the markers, so it tucks at margins where the markers still clear the prose honestly.
- **Failure mode per element, and the unmeasured frame FAILS OPEN.** The bolt tucks; the grid gives up COLUMNS, and at nothing-left it hides that side entirely — cells, "+K" pill and the orphan re-pin dock together, since all three are pinned in the same column. (The original text said "a two-column grid has no sub-lane left to tuck into" and that was the sentence task 325 had to retire: there is one, and the tuck was sitting on it.) An uncommitted viewport frame (`frame.editorEl === null`: pre-first-refresh, a keep-alive pane mounted while `display:none`, a detached view) is every-field-zero, so keying the regime on the arithmetic instead of that sentinel would cull every marker on the first commit of every pane and on every warm tab switch — far worse than the overlap being guarded.

`computeMarkerPositions` takes the resolved per-side COLUMN COUNTS as a REQUIRED argument (a defaulted answer is a decision nobody made), and `Marginalia`'s `useLaneCols` reads the service's viewport channel through `useSyncExternalStore` with a PRIMITIVE packed-integer snapshot — no new observer, no editor subscription, and React bails the re-render on every refresh that leaves the regime unchanged (which is every refresh a keystroke can cause: a height change moves the frame's vertical fields and the regime reads only horizontal ones). CI: [src/lib/\_\_tests\_\_/marginalia-lane-regime.test.ts](src/lib/__tests__/marginalia-lane-regime.test.ts) sweeps every margin 0–200 on both sides through the REAL predicate into the REAL grid and asserts no cell (or pill) ever starts inside `text edge ± INNER_PAD`; it also censuses the production call sites, because a test of the predicate alone structurally cannot catch the original shape — the predicate was never the part that misbehaved, the call site that never asked was.

#### The ordering half: two thresholds that differ need one ORDER, not two answers

Same lane, one axis in (task 325) — and the case where both predicates were right and their *combination* was nobody's job. The grid clears the prose down to a 70px margin and the bolt loses its inboard slot below 104px, so between them BOTH render; the tucked bolt's band is `[64, 92]` in container coordinates and marker col1's is `[70, 92]`, so col1 was painted over — and, the bolt being a fixed portal above `pointer-events-auto` cells, unclickable. `RIGHT_LANE_BANDS` was built to make disjointness STRUCTURAL, and it delivered that only in the reserved regime: both cramped fallbacks were computed OUTSIDE the list, one in pod coordinates and one at wide-lane column offsets.

> **Where several pod-anchored elements share a lane, "does my slot clear the prose?" is not enough — the lane is RESOLVED once, outboard → inboard, in ONE coordinate space, and every element reads its answer off that resolution.**

[`resolveRightLane(available)`](src/lib/marginalia.ts) is it: the scrollbar is fixed, the BOLT places (its reserved inboard band where the lane is whole, otherwise the tuck against the scrollbar floored at the prose edge), and the GRID takes the columns that remain entirely inboard of wherever the bolt landed. `computeBoltLeftFromPod` and `resolveMarkerCols` are both thin readers of it. Four rules it earned:

- **Priority is stated once, in the resolution, and it is a product call.** The bolt outranks the grid because it is the sole entry to `ActionsMenuPanel` (no other surface reaches it) and its 28px body cannot degrade, while the grid already has a graceful absence (214) and a graceful overflow (the "+K" pill). Nothing is dropped that does not have to be: in the 70–103 band the grid keeps col0 — the same single-column shape the LEFT lane has always had — rather than the whole side going dark, which is why option "raise the grid's threshold to 104" was rejected. It would have thrown away the honest band 214 derived.
- **Re-base the outlier into the shared space; don't compare across two.** `MARGINALIA_BOLT_TUCK_X_RIGHT` is the tuck as a container-relative lane offset (= 64), pinned byte-exact against BOTH its task-045 pod spelling and the band-list spelling, so the re-basing is provably neutral. "Which columns does the bolt cover?" is then arithmetic over one origin instead of a comparison between coordinate systems — the shape that let a fixed pod-offset sit on col1 for a year.
- **The count is DERIVED by walking the same column offsets `cellAt` packs against** (`rightColumnsClearingBolt`), never a hand-written "one", so it follows the bolt size, the icon width and the gaps automatically.
- **This cost nothing at the prose threshold, and the reason is worth knowing.** Right cells run OUTWARD from col0, so `marginGridInset("right")` is col0's left edge at ANY column count — losing col1 cannot move 214's derived 70. A future change that made the right grid pack INWARD would have to renegotiate that, which is why the suite pins the independence explicitly.

**Known residual, stated rather than implied:** the orphan re-pin dock is not a band. It is flow-positioned at `right: 2` inside the same column, so it overlaps the scrollbar gutter in EVERY regime and the tucked bolt in this one — pre-existing, independent of the bolt, and a visible chrome relocation to fix, so it is out of scope here and explicitly outside the disjointness sweep, which asks about cells and the pill.

CI: the same [marginalia-lane-regime.test.ts](src/lib/__tests__/marginalia-lane-regime.test.ts), widened with the sweep in the prose-clearance sweep's own shape — every margin 0–200, markers enough to force a second row and a pill, and at each one the bolt's band must miss every rendered cell, with counters asserting the sweep crossed BOTH regimes *with markers up* so it cannot pass by hiding everything. Three legs fail when the cramped branch is reverted to the full column count.

### The stability half: a card moves only when it must, and then it SLIDES

Same lane, and the case where every mechanism was correct and nobody owned the question of *whether to run it* (task 328). Gabriel: cards jump far too much; the gutter must FEEL STABLE. Two symptoms — a card stack that "resets several times to stay visible" while scrolling, and a perfectly visible card that jumps to the best position the moment you click its linked text.

> **A reposition is sanctioned only when the thing the user needs is not already where they need it.** ONE predicate answers that for both axes a click can move — the CARD (an omni pin, which re-cascades the deck around it) and the DOCUMENT (an `alignEntryToY` scroll of the shared row) — and every door consults it. No call site keeps a private copy.

[src/lib/reposition-policy.ts](src/lib/reposition-policy.ts) is the rule, in four rungs: a sub-`REPOSITION_EPSILON_PX` move is JITTER, not intent ⇒ hold; a rect or band we cannot READ fails OPEN; not FULLY visible in its band ⇒ move; farther from the target than `farThresholdFor(band)` ⇒ move; otherwise hold. Two doors read it — `alignEntryToYIfNeeded` / `scrollEntryIntoViewIfNeeded` ([layout-scroll.ts](src/components/editor-layout/layout-scroll.ts)) for the document, `requestOmniCardPlacement` / `holdOmniCard` ([omni-card-placement.ts](src/components/editor-layout/omni-card-placement.ts)) for the card — and six publishers that each decided for themselves now enter one of them.

Six rules it earned:

- **Necessity (c) needed no rule of its own.** Gabriel named three sanctioned cases: off-screen, very far from its linked text, and a margin-marker click on a card buried in a dense 16-card stack. The third is not a third rule — a buried card's displacement from its own anchor IS what being buried means, so the FAR rung surfaces it. Three stated cases, two rungs; a third would have been a switch nobody could keep in sync with the other two.
- **The fail-open direction is the whole of rung 1, and a DEGENERATE band is "unreadable", not "visible".** A needless move is the pre-328 behaviour and one the user asked for by clicking; a wrongly-held move makes a deliberate click do nothing with nothing on screen to explain it. And a `display:none` keep-alive pane reports a zero-height band while an unrendered wrapper reports a zero-height rect — a naive containment test calls both fully visible (visible span and whole are both 0) and would hold every move for a pane nobody can see.
- **A refused card placement writes NOTHING; it does not write a no-op pin.** A pin at the card's own current top looks deck-neutral and in isolation is (the cascade's forward pass reproduces the value it is then overridden with, and its backward pass is the identity on a deck that already clears). But the store holds ONE pin per side, so publishing it REPLACES whatever pin another card holds — releasing that card to its natural position and re-packing its neighbours. **A "hold" that moves a different card is this bug wearing the fix's clothes.** `holdOmniCard` is the deliberate exception, and the reason the two doors are spelled separately: the wrapper's mousedown freeze exists precisely to install a pin.
- **A jump is TWO movements, and the card's exists only to compensate for the document's — so the pin rides the scroll's verdict.** `jumpToLink`/`jumpToCard` dispatch `virgil-card-jumped` only when `alignEntryToYIfNeeded` reports a real scroll; the handler then asks the card question against the card's POST-scroll rect, which is exactly the right moment — a card the scroll pushed off screen comes back to its marker, one still comfortably in view rides the scroll with the rest of the deck. Renegotiated deliberately: pre-328 the pin froze the clicked card's screen position on every jump, which kept ONE card still by moving all its neighbours.
- **Hysteresis belongs at the ONE place tops commit.** `holdWithinEpsilon` in the measure pass ([useInTextPositions.ts](src/hooks/useInTextPositions.ts)): a pass that would move a card less than the epsilon keeps the committed value, so `measureVersion` never bumps and the deck does not re-render. That is what kills the per-scroll-pause reset — the C5 scroll-idle refinement re-runs on every 150ms pause while approximated items exist, and post-327 its corrections are small, but small and visible are different things. Comparing against the COMMITTED value (never the last measured one) bounds the held error at one epsilon instead of letting a slow real drift integrate. Heights take the tighter `HEIGHT_EPSILON_PX` because they feed the cascade: every card packed below an unchanged card inherits its wobble.
- **A sanctioned move SLIDES, and the hysteresis is what makes that safe.** `.omni-entry-slide` transitions `transform` (the property the cascade already positions with — composite-only, so a moving deck costs no main-thread work) for 180ms, opted IN under `prefers-reduced-motion: no-preference`, and withheld during the pod's arming window and any live layout gesture. Without the hold, this transition would promote sub-threshold jitter from a teleport the eye can miss into a visible glide it cannot — the transition must not turn a stability defect into a nicer-looking stability defect. A freshly mounted wrapper never animates: a CSS transition does not run on an element's FIRST computed value, and a card renders only once `positions` has a top for it.

CI: [gutter-stability-census.test.ts](src/components/editor-layout/__tests__/gutter-stability-census.test.ts) is the leg with teeth — the predicate was never the part that could misbehave, a call site that never asks it is. `omniPinStore.requestPin` may be called only from the placement door, and `alignEntryToY` only from `layout-scroll.ts`, where it is asked PER LINE (exactly two calls: the gated door, and `scrollHeadingToActiveLine`'s Outline click-to-jump — a deliberate "take me there" NAVIGATION and the one exemption in this doctrine). A hit is MIGRATE-it, never an allowlist entry. Beside it, [gutter-stability-doors.test.ts](src/components/editor-layout/__tests__/gutter-stability-doors.test.ts) drives both doors against real DOM into the REAL `resolveCascade`, [omni-pin-anchor-lifecycle.test.ts](src/components/editor-layout/__tests__/omni-pin-anchor-lifecycle.test.ts) drives BOTH renderers of one anchor across an edit (below), and [useInTextPositions-hysteresis.test.tsx](src/hooks/__tests__/useInTextPositions-hysteresis.test.tsx) drives the REAL hook. Every defect leg fails on the pre-fix behaviour (measured).

**Residuals, stated.** The slide's arming window is a wall-clock 700ms rather than a settle signal (the corrections come from independent sources — the settle passes, `document.fonts.ready`, NodeView mounts — and only a timer covers all of them), so a correction later than that animates once. Since task 370 that is deliberate rather than residual: the settle is no longer ~500ms-bounded, and a LATE correction is exactly the case that should glide instead of teleport — see "The settle half" below, and the recalibrated `SLIDE_ARM_MS` docstring, which used to justify its value by a loop that no longer exists. And the rule governs GESTURE-driven repositions: a structural edit that moves a card's anchor still moves the card, which is the card tracking its text rather than jumping away from it.

#### The pin half: an override is stored relative to the anchor, never on the pod

Same lane, and the residual the section above named and left standing (task 362) — reported by Gabriel from a real paper, with screenshots: an archive card and its margin marker in completely different places, the anchor demonstrably healthy (the uuid live in `main.tex`, the `paragraphSnapshot` matching byte-for-byte).

An anchor has TWO renderers. The MARKER is derived live, every measure, from the block's own geometry (`computeMarkerPositions` over `AnchorNodeMetrics.top`) and carries no stored Y at all — `MarginaliaMarker` has no positional field. The CARD was FROZEN: `PinRequest.pinTop` was a pod-relative ABSOLUTE Y, written once by the gesture and cleared only by a replacing pin or the card-lift gesture — never by anything the document does — so `resolveCascade` re-applied the same unexamined number on every pass. Every edit above the anchor moved the anchor, moved the marker with it, and left the card behind — permanently, by a distance that compounds with each edit, while the deck re-packed around the stale Y as well. Nothing throws, the deck is well-formed, and the card is simply beside the wrong paragraph.

> **A persistent override of an anchor-derived position is stored as an OFFSET FROM THE ANCHOR, never as a coordinate on the surface.** The absolute Y is a live function of the anchor, so storing it freezes a derived answer and the two renderers of one anchor can disagree. Stored relative, the invariant holds by construction — which is why there is no expiry rule and no drift threshold.

`PinRequest.offset` is pod-relative pixels from the card's NATURAL top (`coordsAtPos(anchorPos).top − podRect.top`, the number the measure pass already commits for every card); `resolveCascade` re-derives `naturalTop + offset` each pass. Four rules it earned:

- **The conversion happens ONCE, at the publish site, and nowhere else.** A gesture genuinely speaks in screen coordinates ("put it where I clicked"), and the necessity rule (`mayReposition`) is rightly a SCREEN question — is the card visible, is it far from where the user pointed? What is DURABLE about the gesture is its relationship to the anchor, so that is what is stored. `omni-card-placement.ts` does all three conversions (screen → pod → anchor-relative) in one place, which is what lets the store hold a value no later edit can falsify.
- **The anchor reference travels on the DOM, and the door fails CLOSED without it.** The pod publishes each card's measured natural top as `data-omni-natural-top` on the positioned wrapper — the same element the door already resolves, so no registry and no ladder, and the number always belongs to the wrapper the door actually resolved. Stated precisely rather than generously: that INHERITS the door's existing multi-pane semantics (a caller holding its element is exact; the two event-driven publishers still take the `findOmniEntry` lookup, the task-329 shape), it does not improve them — but it cannot introduce a cross-pane mismatch of its own, which a side-keyed registry could. A wrapper with no readable natural top resolves to "nothing to pin", exactly like a missing wrapper: the alternative — fall back to an absolute Y — is the decoupling this retires, arriving back silently on whichever path lost the attribute. It costs nothing, because the pod renders a positioned wrapper only for a card it HAS a natural top for.
- **A pin naming an unmeasured card is INERT, not absolute.** A deleted anchor drops the card out of the natural map; the pin resolves to `null` and the deck re-packs as if it were not there. Same answer as a pin naming a card the category filter has hidden — which pre-362 re-activated at the stale Y the moment the card returned.
- **The reference may be an ESTIMATE, and that is a stated trade rather than an oversight.** A card whose anchor is outside the visible band carries an INTERPOLATED natural (wave-2b C5), refined to exact on scroll idle — and moving an off-screen card is precisely what the necessity rule sanctions, so this is the ordinary path. The pinned card therefore moves by the estimation error when the refinement lands, where a pod-absolute pin was immune to it by construction. Accepted: the correction moves the card TOWARD its anchor (the user's chosen offset, now measured from the truth), it lands on the very next pass because the pin has just brought the card into view, it is bounded by the same interpolation task 327 made non-absorbing, and the 328 slide renders it as a glide. Pinned as a contract, not left to be rediscovered.
- **The lift clears by the WRAPPER's id.** A pin stores the id the wrapper carries, and a multi-anchor card's row is `<key>@N`; `clearPin`'s identity guard declines a mismatch, so the lift gesture's bare-`cardKey` clear silently cleared nothing for exactly those rows and left the pin standing after the card had left the deck. Found while in the code, closed here because it is the same identity fork one field over.

The store header's claim that `OmniViewPanel` cleared stale pins from a `useSelection()` subscription was **stale prose** — there is no such subscription, and the panel's own comment 30 lines away said the opposite. Corrected at the site rather than left standing: a header describing a lifecycle the code does not have is how the next reader concludes the pin is already bounded.

CI: [omni-pin-anchor-lifecycle.test.ts](src/components/editor-layout/__tests__/omni-pin-anchor-lifecycle.test.ts) drives BOTH renderers over one anchor — the REAL `computeMarkerPositions` and the REAL `resolveCascade`, fed by a pin published through the REAL door — and asserts the thing that must not move: their DIFFERENCE across an edit. They speak different origins (marker Ys are host-container relative, card Ys pod-relative), so "the same number" would be the wrong contract; what the defect broke is that neither may move relative to the other without the anchor itself moving. Its defect leg reimplements the RETIRED rule locally rather than re-parameterising the live one, so it fails for the reason it names instead of by arithmetic identity. Measured: neutering the DOOR half alone fails 7 legs, both halves 8.

Two legs carry the teeth, and neither is the invariant leg. The **producer** leg lives in [omni-view-panel-split-contract.test.tsx](src/panels/Omni/__tests__/omni-view-panel-split-contract.test.tsx), because `positions.get(id)` and `naturals.get(id)?.naturalTop` are both `number | undefined` — so publishing the CASCADED top instead compiles, renders, and makes every pin's own reference move with the pin, with every other leg green. And the **census** in `gutter-stability-census` polices the cross-layer attribute name, the `link-dom-contract` (204/255) shape: the reader imports `DATA_OMNI_NATURAL_TOP` and the writer cannot (JSX has no computed attribute name), so a drift would silently disable EVERY omni pin — the door fails closed — with nothing failing and nothing logged.

**Residuals, stated.** The two renderers track together in practice but not *by construction*: they use different primitives (the marker's optical cap-band rect vs the card's `coordsAtPos` line-box), different origins, and different epsilons (the geometry service's 0.5 px bail vs the card's 6 px hysteresis hold), so a 2–5 px reflow can move one and hold the other. That is a sub-epsilon disagreement, not a decoupling, and it is what the contract's ε allows for. And a SECOND, independent path to the same symptom survives, filed separately: the archive omni builder resolves its anchor with a bare live-uuid test while the margin-marker builder routes through the four-rung `resolveCardAnchor` SSOT, so a card recovered by the snapshot rung paints a normal marker beside the recovered paragraph while its row is binned `pos:null` into the orphan strip.

#### The settle half: a termination criterion is the consumer's FIXED POINT, never a proxy for it

Same lane, and the case where the mechanism was right, the classification was
right (327), the movement policy was right (328) — and the loop that had to run
them all **stopped too early**, on a measurement of something else (task 370).

> **A geometry pass is an OBSERVATION, not a fix.** A trigger says "the world
> may have moved"; the honest answer is *keep measuring until two consecutive
> passes AGREE*, never *measure once and hope*. The agreement is the consumer's
> OWN fixed point — for this lane, a pass that commits nothing past the task-328
> hysteresis — so there is no second rule to keep in sync. And the budget is
> WALL-CLOCK, because a frame cap is a lie on a busy main thread: the frames a
> slow settle needs are exactly the frames it does not get.

Gabriel (2026-08-18, two screenshots, a card-dense page): the lane renders every
card packed contiguously from the top at minimum spacing — including cards whose
anchors are off-screen — and only "suddenly separates and goes to approximately
the right places" after scrolling a couple of lines. The cold-start healer was a
rAF loop that terminated the first frame the editor's `scrollHeight` was
unchanged (`SETTLE_STABLE_FRAMES = 1`), or after a 30-frame cap. Both halves
measure the wrong quantity, and the first is the interesting one: `scrollHeight`
is a **TOTAL**, and inner layout moves inside an unchanged total constantly — a
KaTeX span sizing, an expex example reflowing, a figure NodeView that reserves
its final box on mount and lays its contents out over the next several frames —
while an absolutely-positioned lane never touches it at all. After the loop
stopped, NOTHING re-measured until the user scrolled.

The rule now lives once, in
[src/lib/editor-geometry/settle-convergence.ts](src/lib/editor-geometry/settle-convergence.ts)
(`createConvergenceController`), which owns SCHEDULING and TERMINATION and is
blind to geometry: `measure()` reports a `MeasureOutcome` and the controller
folds verdicts. Five rules it earned:

- **Every trigger enters ONE door.** Cold mount, `document.fonts.ready`, the
  editor RO, the per-card RO, the structural bus, `focusout`, the scroll-idle
  refinement and a dirty keep-alive re-show all mean the same thing and all used
  to get DIFFERENT answers — the mount got the 30-frame proxy loop, everything
  else got a single rAF-coalesced pass. A single pass is right only when one pass
  is enough, which is precisely what a cold load, a font swap and a late NodeView
  mount each falsify.
- **The per-FIRE cost is unchanged; the per-EVENT cost is up to three bounded
  passes, and the difference is worth stating precisely** — the first draft of
  this section said "idle-paced" and was wrong on exactly the path it was
  defending. A re-arm while a pass is pending ADDS NO PASS (one pending pass is
  the whole rate limit), so a trigger STORM still costs one pass, and a sustained
  typing burst is still capped at one pass per frame — the pre-370 ceiling. What
  is genuinely added is the trailing CONFIRMATION: after the last trigger, a
  wrap-changing keystroke costs its pass plus up to two more where pre-370 it
  cost one. Those two are paced by the ramp below (rAF only while the previous
  pass CHANGED something, so the confirmations fall to idle), each is
  O(in-band items) and read-only — one forced-layout batch, not one per card —
  and the alternative is the defect. Stated as a cost, not waved away: three
  bounded passes per wrap change, at most one per frame.
- **The budget is per CHAIN and is never refreshed**, which the same review
  found the first cut getting wrong in a way that mattered. A committing pass
  bumps `measureVersion`, which re-runs the per-card RO effect, which
  re-`observe()`s every card, whose initial delivery arrives back as a
  `request()` — so a refresh-on-request deadline was being extended by a trigger
  the chain itself had caused (measured against a browser-faithful observer over
  never-settling geometry: 3 378 reads at 18 s, climbing linearly). A budget a
  live chain can extend is not a budget.
- **The trigger door DROPS while the pass DEFERS, and the asymmetry is the
  keep-alive contract.** A trigger arriving inside the re-show suppression
  window is storm noise by construction — the window is only ever open when the
  cached geometry is already correct — so arming on it would make a CLEAN warm
  switch pay a settle it does not need (measured on the first cut: 6 `coordsAtPos`
  reads and 15 spin passes where the instant-switch invariant says ZERO). A pass
  of an ALREADY-ARMED chain reports `deferred` and retries, because that chain's
  reason to exist predates the window.
- **TWO agreeing passes, not one — because one agreement is a PLATEAU**, and a
  plateau is exactly what the retired proxy mistook for a settle. An async layout
  settle routinely holds still for a frame between a font swap and the mounts it
  triggers.
- **`deferred` is not agreement, and it is not a reason to stop.** The pre-370
  step did `if (!canMeasureNow()) return;` with **no reschedule**, so ONE frame
  that landed while hidden or inside the 250 ms re-show suppression window killed
  the settle permanently. Confirmed reachable at source by a read-only sweep
  during this task, and the everyday path needs no race: a paper opens with the
  editor ready but its sidecar cards not yet loaded, the user tabs to the Library,
  the cards arrive WHILE HIDDEN (the companion one-shot is `canMeasureNow`-gated,
  so it is skipped), and on return the re-show effect early-returned on an empty
  cache — *"cold mount, the wiring effect handles it"* — handing off to an effect
  that does not re-run on a visibility flip. So the COLD branch of the re-show
  now arms convergence, and a HIDDEN pass reports `inert` (park) rather than
  spinning the budget against a `display:none` pane. The same rule reaches the
  companion one-shot: an items rebuild that cannot measure because the pane is
  hidden marks the hook DIRTY, so the re-show cannot take its CLEAN branch over
  cards it has never measured.
- **A dirty re-show CLOSES the suppression window rather than waiting it out.**
  The window exists to protect a CLEAN re-show's cached geometry from the
  display-flip reflow storm; a DIRTY verdict is the evidence that its premise is
  false. It is closed inside the deferred callback, so the storm is still
  swallowed for the deferral and only the deliberate convergence runs — and the
  storm's own triggers coalesce to one pending pass anyway.

The task-328 policy is untouched and does the visual work: corrections land
through the hysteresis (sub-ε commits nothing, so `measureVersion` never bumps)
and the `.omni-entry-slide` transition, so convergence is a calm glide rather
than the first-scroll SNAP. The typing gate is hoisted to hook scope and read by
EVERY pass now, not just the per-card observer's — so a font-ready ping during
card typing can no longer walk around it — and `focusout` re-arms, which is what
keeps a long typing session from outliving the budget and stranding a
half-settled deck.

**The law has a census, and it earned one the hard way.** Every door law in this
file ships one on the stated ground that *the door was never the part that could
misbehave — a call site that never asks it is* — and that prediction came true
inside this fix's own first cut, caught by the adversarial pass rather than by
any leg: the companion one-shot (an items/resolvePos rebuild) called `measure()`
DIRECTLY and entered no door, while two comments asserted that "a later item
arrival re-arms through the companion one-shot like any other trigger". That is
the COMMONEST cold open there is — the editor mounts before the sidecar cards
load, so the mount chain reports `inert` and terminates, and the cards then get
exactly one pass against still-settling layout. The pre-370 defect, on the path
the prose claimed was covered.
[settle-convergence-census.test.ts](src/lib/editor-geometry/__tests__/settle-convergence-census.test.ts)
enumerates the measure call sites per LINE (two, each with its reason), requires
the synchronous companion pass to be PAIRED with a `request()` on the next line
(the allowlist key matches a bare `measure();` either way, so permitting the call
without pinning the pairing would re-open it), pins the controller's single
owner, and pins that `request()` writes neither the deadline nor the fast window
outside its new-chain guard.

Probe: `window.__settleConvergenceStats()` (sibling of `__layoutGestureStats` /
`__scrollRepositionStats`) reports `{ arms, passes, outcomes, lastChainMs,
lastStop }`. A healthy cold open reads `lastStop: "converged"` with a small
`lastChainMs`; `"capped"` is the honest failure mode and the one worth reporting.
CI: [useInTextPositions-settle-convergence.test.tsx](src/hooks/__tests__/useInTextPositions-settle-convergence.test.tsx)
drives the REAL hook over a fixture whose `scrollHeight` is CONSTANT while its
line positions ramp — the "inner layout inside an unchanged total" shape — and
**dispatches no scroll and no resize**, which is why no pre-370 suite could see
this: every one of them hands the hook by hand exactly the external trigger whose
absence IS the defect. Measured by neutering each half in turn: restoring the
scrollHeight proxy fails the convergence leg, restoring the re-show hand-off
fails the empty-deck leg, removing the controller's pending-pass guard fails the
storm-cost leg (24 reads where 3 are allowed), stubbing the controller inert
fails ALL SIX, and `STABLE_PASSES = 1` — the plateau the retired proxy mistook
for a settle — fails two. The two termination legs (sub-ε jitter, and geometry
that never settles) are bounds pins rather than defect legs and say so at the
site; both were VACUOUS in the first cut and both are worth knowing about. The
jitter leg asserted only `calls === calls`, satisfied by zero, so it now carries
a lower bound; and the cap leg's fixture alternated on a 16 ms wall-clock period
that the 32 ms idle tail sampled at unchanging parity, so the geometry looked
static, the chain reported `converged`, and raising `MAX_MS` to ten million left
the leg green. Its fixture is driven per PASS now, and it reads `lastStop` off
the shipped probe — because a leg that names the wall-clock budget must not pass
on an implementation that has none.

**Owed, not claimed:** a preview eyeball on a crowded fixture and a real-FSA
pass on Gabriel's own paper. Cold opens and restored mid-doc scroll positions
are where this bites, and that is the FSA-masked class — the durable proof here
is the unit contract.

## Card presence tiers

> **A COLLAPSED card body mounts machinery proportional to its usefulness, not one live TipTap editor per card.** Tier model (per body; header/chrome always render): **T0** summary string → **T1** static HTML → **T2** read-only live editor → **T3** editable (the expand boundary, unchanged — an expanded card is never tier-gated). Behind `localStorage["virgil:card-tiers"]="on"` (perf Wave 3; **default OFF until soak**; off = every switch site takes its legacy branch, byte-identical).

The pre-tier shape was the diagnosis's 881-live-editors problem: EVERY collapsed footnote/archive body mounted a read-only `BorrowedMainText` editor and every collapsed example a FULL float-surface `ExampleCardEditor`. Policy: collapsed footnote/archive → **T1 always** (prose; the static render is visually identical, so nearness is irrelevant); collapsed example → **T2 near the viewport / T1 far** (the expex projection needs real NodeViews); hidden keep-alive panes → ceiling T1 (re-show promotes near cards back — static paints instantly, live editors resume at leisure, aligned with instant-switch).

The pieces, and the contracts they carry:

- **[src/lib/borrowed-render.ts](src/lib/borrowed-render.ts)** — `renderBorrowedHtml(value, scope, resolveCitation)`: normalize → `refreshCitationDisplay` (factored here; the live twin imports it) → `generateHTML` over the SAME extension list `buildCardBodySchema` composes. A static tier is a THIRD body surface bound by the task-308 scope rule — its schema is derived, never hand-copied. **Failure is a refusal**: a body the scope can't represent returns null and the caller shows the plain-text projection, never a blank (generateHTML throws where the live editor would silently blank — pinned in [borrowed-render.test.ts](src/lib/__tests__/borrowed-render.test.ts), including the scope fork).
- **[src/components/StaticBorrowedText.tsx](src/components/StaticBorrowedText.tsx)** — the T1 surface: carries `tiptap rtf-content rtf-content-<variant> borrowed-main-text` (the `.tiptap p` typography contract) but deliberately NOT `ProseMirror` (nothing here is an editor — and the tier test counts `.ProseMirror` as its zero-live-editors tooth); sets `--editor-font-size` alongside `font-size` (the var-masking bug the live twin's typography effect exists for); repaints math atoms one-shot through the SAME `renderMath` the live NodeView uses, reading the `latex` attr `generateHTML` carries through.
- **[src/cards/presence.tsx](src/cards/presence.tsx)** — `CardPresenceProvider` (ONE per EditorPane, above the float map + both rails; portals keep tree position) owns the **doc-open ramp**: ceiling T0 at `ready` → T1 → full, stepped via self-chained `requestLowPriority`, so the curtain-lift commit renders summaries, not hundreds of bodies. The keep-alive visibility context caps hidden panes at T1. `useCardTier(policy, cardEl)` is the per-card read; flag off ⇒ 3 unconditionally.
- **[src/cards/card-near-zone.ts](src/cards/card-near-zone.ts)** — ONE shared IntersectionObserver (viewport root ±600px) over registered card ELEMENTS, promote-on-enter / demote after a 2s dwell (edge jitter can never thrash an editor down/up). Deliberate deviation from the plan's "geometry service writes the store" sketch: the service's set is keyed by anchorable BLOCK uuid, but the one nearness-gated kind (collapsed examples) is ENTITY-anchored with no block uuid — observing the card's own element answers the real question with one mechanism for omni cards, docked lists, and floats (always intersecting → near, correctly), and inherits none of the service set's detach/heal spurious-leave semantics. Cold start is FAR-until-proven-near, so doc-open paints static first. IO-paced only — no editor subscription, no polling.
- **The switch sites** (exactly two, each swapping ONLY the body child inside the tier-invariant clamp/title/empty-sentinel wrappers): EditableCard's compressed borrowed branch ([panel-primitives.tsx](src/components/panel-primitives.tsx) `borrowedTier`) and ExampleCard's collapsed branch ([ExampleCard.tsx](src/panels/Examples/ExampleCard.tsx) `collapsedTier`; the far static line carries `data-example-tier="static"`, NO `font-mono` — that class stays the bare-mount fallback's signature). Contracts: [card-presence-tiers.test.tsx](src/cards/__tests__/card-presence-tiers.test.tsx) (far collapsed footnote mounts ZERO `.ProseMirror` against the REAL live twin; T0 ramp commit; flag-off legacy) and the renegotiated [ExampleCardCollapsedProjection.test.tsx](src/panels/Examples/__tests__/ExampleCardCollapsedProjection.test.tsx) (near ≡ the #43 parity contract verbatim; far = static with zero embedded instances; far→near promotes live).

Runtime guard: `window.__editorCensus()` — with the flag on, `total` must track `main surfaces + expanded cards + NEAR collapsed examples`, not the collapsed-card population.

## Editor-observer stability

> **No deep MutationObserver (`subtree`/`characterData`) over editor content, ever** — a characterData MO fires as a pre-paint microtask on EVERY keystroke, and one that reads layout (`scrollHeight`/`getBoundingClientRect`) forces a full-document layout right after the text mutation; one that then writes styles dirties layout AGAIN (measured ~30 ms per full-page relayout at ~320 blocks — the old editor-scrollbar MO paid this double-forced-layout per keystroke, the "typing feels sticky" class). Geometry belongs to **ResizeObservers** (post-layout delivery, ≤1/frame, only on real size change) and structure to the **DocStructureBus** — and an RO callback must be **read-before-write with equality bails** on every write (CSS var or React state), so it can't force mid-frame layout or feedback-loop on its own writes (var write → observed element resizes → RO fires → equal values → zero writes → stop).

Two guards enforce it (the same probe + grep-allowlist pattern as the laws above):

- **Runtime probe** — `window.__keystrokeStats()` ([src/lib/keystroke-latency-probe.ts](src/lib/keystroke-latency-probe.ts)) measures keydown→paint latency (Event Timing API, sub-16 ms keystrokes counted honestly in p50/p95) and, via its work-attribution channel (`recordKeystrokeWork(siteId)`), names WHICH observer/measure sites ran on each keystroke. A healthy plain keystroke attributes **zero** fires; a wrap-changing keystroke at most one per site. `window.__keystrokeStatsReset()` between scenarios.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/editor-observer-guardrail.test.ts](src/lib/__tests__/editor-observer-guardrail.test.ts) flags every `new MutationObserver` with `subtree`/`characterData: true` (allowlist `PERMITTED_DEEP_MUTATION_OBSERVERS` — currently only the Outline panel's own-DOM measure) and every `new ResizeObserver` (allowlist `PERMITTED_RESIZE_OBSERVERS`), each entry carrying a one-line bounded/equality-bailed justification. A new unlisted observer fails CI. Keep this prose and both allowlists in sync — same discipline as the other two laws.

## Per-doc services under multi-pane keep-alive

> **A module-level value that is per-DOCUMENT is a REGISTRY keyed by its owner, never a single slot — and a departing owner removes only its OWN entry.** N `EditorPane`s are mounted at once (multi-doc keep-alive, default ON at capacity 3; the Library Reader mounts the same component again, up to 4), one visible and the rest `display:none`. "The current doc" is therefore not a module-level fact. Where a caller has no owner in hand, resolve through the ONE ladder — `pickActiveByEditor` / `pickProbeEditor` ([src/lib/active-editor-probe.ts](src/lib/active-editor-probe.ts)): focused → visible (`offsetHeight > 0`, which is exactly what `display:none` falsifies) → sole → null. Never "whichever was written last".

This is the "drag-and-drop goes dead after switching back to a paper I already had open" class (task 329), and its two failure modes are the pair `editor-actions-bridge.ts` had already named and closed for typed actions:

- **MIS-ROUTE.** A warm switch is a visibility flip, not a remount, so with last-writer-wins the pane that mounted LAST kept the slot forever. Every doc-scoped read then addressed the wrong document — and each consumer failed differently, which is why the symptom looked like nothing at all: `hitTest` rejected every `targetScope: "main-only"` spec, `text-range-move` resolved no source range, and `inlineAtomMoveSpec` fell through to its CREATE branch, where `atomAttrsFor` read the *other* doc's footnote hook, degraded to `emptyRichContent()` and landed an **empty `\footnote{}`** carrying the card's real id — the task-233 shape, re-entered from the side.
- **CLOBBER.** The unmount cleanup wrote `null` unconditionally, so evicting an LRU tail, closing a background tab, or a Library-reader round trip disarmed drag-and-drop **app-wide** until some pane mounted fresh.

Four rules it earned:

- **Key by the OWNER, not by the doc.** The drop registry keys on a token the provider mints once, because a provider registers while its `mainEditor` may still be null — the ctx's own getters resolve it later. `target-registry.ts` keys by DOM node and the actions bridge by `editor.view`; all three dispose identity-guarded (`if the entry is still mine`), which is what makes "an evicted pane can never null out a live one" structural rather than careful.
- **Bind the value to the GESTURE, not to a global "current".** `DropSession` carries the `DropCtx` it started in, resolved once at `beginDropSession`, and the hit-test and the commit both read `session.ctx`. This is strictly stronger than "whichever pane is visible": it is correct with two visible panes (a future split view, Reader-beside-doc), it survives a pane mounting or gaining focus mid-drag, and it makes `ctx.mainEditor` mean *the document this gesture began in* BY CONSTRUCTION — the invariant every consumer already assumed. A producer that knows its editor (the in-text atom grab, the lifted-overlay grab) passes it as an exact hint; the rest take the ladder.
- **The ladder is the three rungs it names, and NOTHING else — a caller's own short-circuits stay at the CALL SITE.** Each registry brackets `pickActiveByEditor` with two decisions that are its own: a *sole-entry* short-circuit ABOVE it (return the one entry whatever its editor looks like — this is what keeps a `mainEditor: null` pane, Reader mode, and every hand-built test fixture resolving), and a *last-resort* tail BELOW it (the drop registry's legacy default slot; the bridge's `DEFAULT_KEY`). Folding either into the shared function looks like tidying and is a wide silent regression — it would null out the view-less publish path the cross-surface action suites all run through. `findRowScroll` ([layout-scroll.ts](src/components/editor-layout/layout-scroll.ts)) is the same shape in the DOM: a `≤1 match` short-circuit around the same visible-wins rule. The ladder's contract is stated where it lives: an entry whose accessor answers `null` does not participate, and **the caller decides what to do when nothing wins** — so it takes no `fallback` parameter (a defaulted argument is a decision nobody made).
- **Deep ≠ broadest blast radius.** The other module singletons in this neighbourhood — `card-lift`, `dock-drag`, `stack-drop-target`, `inline-atom-source`, `drag-ghost` — are **gesture**-scoped, and one gesture at a time app-wide is *correct* for them. Do not convert them; keying a genuinely app-global value by pane is the same error mirrored.
- **A window listener registered per pane is this bug with no ctx in it.** `EditorPane`'s `virgil-stack-drop` handler is one: the event is dispatched on `window`, so every warm pane answered it, each snapshotting against its own doc and calling its own `closeCardPopout`. It gates on `isVisibleRef.current` — the ref, never the render value, because a warm pane is not remounted on a switch and a captured value would freeze at its mount-time answer. A pane outside any keep-alive provider (the Reader) reads `true` and behaves as before.

CI: [dropctx-multipane-registry.test.tsx](src/components/drop-mode/__tests__/dropctx-multipane-registry.test.tsx) mounts TWO real providers with settable DOM visibility (jsdom reports `offsetHeight === 0` for everything, so each fake editor defines its own) and pins the ladder, the scoped dispose, the session binding and the exact hint; five of its legs fail on the pre-fix semantics, and two are explicit non-regression pins — a warm switch still moves ownership, and unmounting the pane that OWNS a live session still cancels it (the atoms-draggable protection: an `externalCommit` gesture has no controller mouseup of its own, so the crosshair cursor and the global `user-select:none` would stick with nothing left to clear them). The leg with teeth is the **census** — the registry was never the part that could misbehave, a second publisher going through the legacy single slot is, and that would reinstate the clobber with every behavioural leg green. No production file in either silo may call `setDropCtx`; a hit is MIGRATE-it, never an allowlist entry.

**Verification, honestly:** this class masks in the dev preview (multi-pane + FSA), so the durable proof is the unit contract above and a real-app eyeball is *owed*, not claimed.

## Cross-window store stability

> **A store that caches a `localStorage` snapshot at module (or hook) scope MUST re-hydrate on the native `storage` event — through [src/lib/cross-window-storage.ts](src/lib/cross-window-storage.ts) (`subscribeToStorageKey`), never a hand-rolled listener.**

Multi-window is first-class (`openNewVirgilWindow`, keyboard-bound and menu-wired), and the common store shape — hydrate ONCE behind a `loaded` latch, then serialize the WHOLE snapshot on every setter — is silently unsafe without this: window B never learns about A's write, so B's snapshot is permanently stale and B's next write **clobbers A's change from that stale base**. The loss is silent and the two windows disagree until one reloads. This is the "colors/prefs I set in the other window vanished" class (task 111 → task 177).

The listener is centralized because the contract has two guards that are easy to get subtly wrong, and each wrong copy is invisible until it isn't: **foreign keys** must be ignored, and **`key === null` is a `clear()`** that counts only when `storageArea === localStorage` (a peer's `sessionStorage.clear()` fires with a null key too). Pre-177 there were three hand-rolled copies and two were missing the null-key branch entirely. On the event, re-read through the store's OWN parse/validate path (factor it into a `readXFromStorage()` shared with the hydrate) so a peer's blob is filtered exactly like a local one — never a second, drifting copy of the validation rules.

CI: [src/lib/\_\_tests\_\_/cross-window-storage-guardrail.test.ts](src/lib/__tests__/cross-window-storage-guardrail.test.ts) greps `src/` AND `library/` for raw `addEventListener("storage", …)` and asserts the flagged set equals the silo's allowlist — `PERMITTED_RAW_STORAGE_LISTENERS`, whose sole entry is the primitive itself (the library twin is deliberately empty). A store that re-implements the contract fails CI: migrate it, don't list it. Same discipline as the three laws above.

Two companions in the same module serve the **hook-state** variant of the shape (state in `useState`, not a module global): `useStorageKeySync(keys, onPeerChange)` puts the listener in an effect, and `writeStorageIfChanged(key, value)` makes a write idempotent. The second is load-bearing wherever a store persists from a *state-watching effect* rather than from its setters: there the peer sync IS a write, so two windows ping-pong forever. Skipping the unchanged write kills the echo on its first bounce. Prefer persisting from the setters; use `writeStorageIfChanged` when the persist-effect shape is already load-bearing (`useLibraryTabs`, `view-session-store`).

Riding it: `panel-theme.ts`, `panel-typography.ts`, `outline-prefs-store.ts`, `useStack`, `useStyleLibrary`, and — since task 179, which drained the census — `usePreferences`, `useZenMode`, `pref-links`, `useWordCountConfig`, `useLibraryTabs`, `library/lib/view-session-store`, the `ActionsMenuPanel` palette. Cross-window-safe by other means: `useViewPrefs` (the `global-pref-changed` bus in `src/lib/multi-window/bus.ts`), and the no-module-cache helpers that re-read per call (`style-library`, `library-store`, `row-viewed-store`, `list-columns`). Degenerate-but-safe, deliberately unmigrated: `useHelperMode` (a single boolean — a stale peer can only lose a toggle) and `InstallPwaPrompt` (a monotonic `"1"` sentinel).

`view-session-store` is the one member the plain re-read doesn't fit: its write is debounced 250 ms, so a peer event routinely arrives while a local change is still only in memory. Adopting the peer blob would drop it; ignoring the peer keeps the clobbering base. So it does a **three-way merge** — base = `lastPersisted` (the snapshot last known to be ON DISK, advanced only on a write that actually landed), ours = the live session, theirs = the peer's blob; per node, whichever side changed it wins, recursing into objects, ours winning a genuine leaf conflict. The pending timer then flushes the merged blob so the peer converges too. **Diff against a base, don't track dirty paths**: a path list is only as fine-grained as the bookkeeping remembers to be, and nearly all of this store lives under one key (`scopes[""]`, the singleton scope), so a `scopes.<id>` granularity would swap that whole subtree and still drop a peer's edit to a different panel inside it. A peer blob that this code cannot parse (corrupt, or a future `schemaVersion`) is ignored rather than adopted — at init an unreadable blob resolves to an empty session, which is right; mid-session it would wipe the user's live view.

### The sidecar half: two writers means ONE serialized read-modify-merge authority

Same law, other medium (task 220) — and the one where the two writers were each internally correct and disagreed only about what the *other* had just done.

`localStorage` stores get the `storage` event; a `virgil/*.json` sidecar has no such thing, and it has a THIRD writer the section above doesn't contemplate: the `/editor/*` skills, which read-modify-write the file straight on disk while the paper is open. `ai-requests.json` had all three. Its two in-app writers had structurally incompatible persistence MODELS:

- **`useAiRequests`** persisted its **whole in-memory snapshot**, derived from React `prev` with no read-merge, and never published — so it overwrote anything written since its own last read, and nothing else learned that it had written;
- **`bridgeCardAiRequestFlag`** read-modify-wrote and did publish, but its `readSidecar` ran **outside** the serialized write critical section — only `writeSidecar`'s callback is funnelled through `enqueueWrite` + `withDocLock` — so a write landing between its read and its own write was merged away from a base that no longer existed.

Neither is a type error, neither throws, and no suite could see either, because every one of them exercised a single writer at a time.

> **A file with more than one writer has ONE authority, and every mutation is a pure function of the list as it is ON DISK, computed INSIDE the serialized write critical section, published on success.** Nothing persists a whole snapshot it computed earlier from state it merely hopes is current — and the reader re-hydrates from the disk-side external-change signal, because an in-process bus is not a cross-window one.

Three pieces, at three altitudes:

- **The primitive.** [`mutateSidecar(h, filename, default, mutate)`](src/lib/storage-fsa.ts) — the read runs inside the same `enqueueDocWrite` task as the write, in BOTH backends. The read is deliberately `readSidecar` (a direct disk read) and never `readSidecarIfExists`: a cached bundle snapshot is exactly the stale base this exists to eliminate. `null` from the mutator means nothing to change — no write, no ledger stamp, and the call resolves `null`, so a caller can tell a declined mutation from a landed one. The same commit put dev's `writeSidecar` on the per-file queue: it PUT straight through, so two writers for one sidecar raced there in a way they never could under FSA, and the new door would have had nothing to serialize against.
- **The authority.** [src/lib/ai-requests-store.ts](src/lib/ai-requests-store.ts) — `mutateAiRequests` / `readAiRequests`, the only place the filename is spelled. Every writer enters here and every landed write publishes. The filename constant is module-**private**, and that is load-bearing rather than tidy: this task's first cut exported it, and an importable name is a name a writer can address the file with — `mutateSidecar(handle, AI_REQUESTS_FILE, …)` spells no literal, calls neither censused function, and bypasses the authority (so it never publishes, which is the whole drop-D3 half of the original defect) while every leg of the census stays green. The census asks *who spells the filename*; the law is *who WRITES the file*, and those coincide only while the name cannot travel. The one reader outside the module needs the QUESTION, not the name, so it gets `isAiRequestsFile(filename)` — publish whole operations, never the pieces (task 273's rule, one medium over).
- **The reader.** `useAiRequests` subscribes to the `SidecarWatcher`'s `virgil-sidecar-changed` event for this file — the same channel `usePersistentState` rides, with the same dirty-guard shape (defer while a mutation is in flight, re-check after the await). This is what makes a PEER WINDOW's write converge rather than merely not-clobber: the disk ledger is per-window module state, so a peer's bytes are unledgered here and the watcher reads them as a genuine external change.

Two rules the fix earned, both about the mutator boundary:

- **The mutator is PURE, because it runs TWICE.** Once optimistically against React state (so the UI never waits on a disk round-trip) and once authoritatively against the on-disk list. So ids and timestamps are minted OUTSIDE it — the bridge builds its candidate row before the call — and a mutator that read the clock or minted an id would produce two different answers for one user gesture.
- **A stale edit DECLINES rather than resurrects.** `updateRequestText`/`deleteRequest`/`relinkRequests` return `null` when the row is no longer on disk, so an edit racing a peer's delete writes nothing instead of re-creating the row from the local snapshot. The pre-fix snapshot persist did exactly that.

**What the lock does NOT cover, stated.** The third writer is out of process: `withDocLock` is a Web Locks primitive, so it serializes this browser's windows and reaches the `/editor/*` python scripts not at all. Nothing here claims otherwise. What covers that writer is the other half of the design — every in-app mutation merges over the freshly-read on-disk list, so a skill's row is never computed away from a stale base, and the watcher re-hydrate converges the live inbox onto what the skill wrote. A guard that overstates its reach is the failure mode this whole section is about, so the census records the same limit rather than implying its two TypeScript roots are the whole story.

CI: [ai-requests-authority.test.ts](src/lib/__tests__/ai-requests-authority.test.ts) **and** [mutate-sidecar-primitive.test.ts](src/lib/__tests__/mutate-sidecar-primitive.test.ts). The second exists because of a gap the first cannot close by construction, and the gap is the exact shape this file keeps re-learning: every task-220 suite `vi.mock`s `@/lib/storage` and hand-writes a `mutateSidecar` that puts the read inside the queue, so what they prove is that the STORE and the two WRITERS are correct *given* a correct primitive — never that either shipped primitive **is** correct. The defining property of the whole fix had zero coverage: hoisting `const current = await readSidecar(…)` above the `enqueueDocWrite(` call in both backends reinstates the pre-220 bridge defect one layer down, and all 6180 tests stayed green (measured, not assumed — the three mocking suites pass through it, 41 green). The primitive suite drives the REAL exports against a fake disk in both backends, and asserts in two shapes: a CONTENT leg (two overlapping mutations both land) and an ORDERING leg (no read starts between another mutation's read and its write), because a content assertion can be satisfied by luck on a fast enough fake. Its post-write disk-ledger **stat** is deliberately excluded from the ordering invariant — it happens after the write and reads no content, so counting it would indict a correct implementation. Four legs fail on the reinstated hoist.

Two kinds of leg in the first suite, and both were needed. The CONCURRENCY legs run two writers over a deliberately slow, genuinely serialized backend, since a base read outside the critical section is invisible to any single-writer test; all four fail on the pre-220 writers, each with the lost-update content (`['card-B']` where both cards were toggled, `[]` where a peer's row should survive). The CENSUS is the leg with teeth — the authority was never the part that could misbehave, a call site that never asks it is — so no production file outside the store and the bundle vocabulary may spell the filename, neither in-app writer may name `readSidecar`/`writeSidecar` at all, and **nothing outside the authority may call `mutateSidecar` at all** (the filename grep cannot see a writer holding the name by another route, so the second leg closes the category the private constant closes the realistic route to). Its one exemption is `card-registry.tsx`'s dev-only error message, keyed by a fragment of the PROSE rather than by the file (task 204's rule: a file-scoped exemption would also excuse a real write added there later). The stripper self-check runs on a synthetic FIXTURE, not on that exemption: proving "literals survive the stripper" from the one production line the allowlist exists to DRAIN is circular — drain it and the proof evaporates while the leg keeps passing vacuously, since zero post-strip lines would contain the needle at all. A canary must not stand on the defect.

One harness detail worth carrying forward, because the suite's first draft got it wrong: these setters schedule their persist from inside a `setState` **updater**, which React invokes lazily at the next render — so `await act(async () => { setter(); await sleep(20) })` waits *before* the updater has run, and the write is still unscheduled when the assertion reads the disk. Every leg then "fails on the pre-fix code" for a timing reason rather than a content one, which is an unfalsifiable defect leg wearing a passing one's clothes. Call the setter in a SYNC `act` to force the flush, then drain the I/O in an async one.

#### The daemon half: against a writer you cannot serialize with, write LESS and NOTICE the fork

Same file, one writer further out (task 363) — and the case where the authority
above was correct, the lock was correct, and the third writer it names as out of
reach turned out not to be the only one.

`withDocLock` serializes this browser's windows; the merge covers the
out-of-process `/editor/*` skills. A paper folder inside Dropbox / iCloud /
OneDrive / Google Drive / Syncthing has a FOURTH writer, and it is the one
nothing in the model contemplates: a sync daemon that cannot be locked against,
cannot be detected, and does not merge. When it lands a remote version of a file
whose local copy has moved on it renames one side aside as a "conflicted copy"
and says nothing to the application.

Measured in Gabriel's `Dropbox/Apps/Overleaf/Coherence Intro/virgil/`
(2026-08-18): **197 conflicted copies plus 19 leftover `.crswap` files**, and the
distribution is the finding. 134 of the 197 are on the three files that **no list
in the codebase named** — `editor-state.json` 102, `virgil.json` 27,
`collab.json` 5 — against `notes` 36, `revisions` 20, `citations` 4, `archive` 2,
`todos` 1. `ALL_SIDECAR_FILENAMES` meant "the files a doc MOUNT reads", not "the
files Virgil WRITES", and the three loudest writers were in neither list. The
loudest of all is a file whose entire contents are a scroll offset, a caret
paragraph uuid and a list of folded uuids: `useEditorUIState`'s two 400 ms
numbers debounced the TRIGGERS (a scroll settle, a caret settle) and coalesced
the WRITE not at all, so each scroll pause, each caret move into a new paragraph
and every fold toggle was a full-file rewrite — a hundred-odd per reading
session, each one a `createWritable()` swap file plus a rename, watched by a
daemon.

> **Against a writer you cannot serialize with there are exactly two moves:
> shrink the race window, and notice the fork.** Both are derived from what the
> file is WORTH, declared once. A **VIEW**-state sidecar coalesces hard, because
> losing the last few seconds of it costs nothing. A **CONTENT** sidecar keeps
> its prompt cadence, because losing it costs the user's writing — and a
> conflicted sibling of a content file is unmerged user data, which is the half
> that must never be silent.

[src/lib/sidecar-value.ts](src/lib/sidecar-value.ts) is the declaration —
`tier` plus `mount`, total over what Virgil writes into `virgil/`, an import-free
leaf (the placement rule `latex-markers.ts` and `node-attr-sets.ts` earned: a
facet the layer that needs it cannot import will be re-copied). Seven rules it
earned:

- **Every column has a reader, and one of them retired a second list.** `tier` is
  read by `sidecarWriteDebounceMs` (the cadence) and by the conflict report (a
  fork of a content file is unmerged writing; a fork of a view file is debris);
  `mount` DERIVES `ALL_SIDECAR_FILENAMES`, so "which files does a mount read"
  can no longer drift from "which files does Virgil write". They were two
  hand-kept arrays, and the drift was not hypothetical — it is the whole reason
  the three storm files were invisible.
- **The default FAILS CLOSED to content.** An undeclared file gets the prompt
  cadence and the loud report, never the lossy ones. A wrongly-content file costs
  some extra writes; a wrongly-view file costs the user's writing, and that
  asymmetry is the entire justification for the direction.
- **Coalescing is only honest if it settles at the boundary that matters.** Every
  coalescing writer flushes on doc switch, unmount, AND the tab going hidden
  ([tab-hidden.ts](src/lib/tab-hidden.ts) — ONE shared `visibilitychange`
  listener, because ~20 `usePersistentState` instances per doc × up to four kept
  alive would otherwise install ~80 identical listeners). Hidden, not `pagehide`:
  that is the last edge at which an async FSA write still reliably completes, so
  a writer that waited for `pagehide` would be trading a coalesced write for a
  lost one.
- **The 300 ms content cadence is byte-unchanged**, and a suite asserts it per
  file. A fix for a write STORM that quietly slowed the user's writing to disk
  would be a worse bug than the one it closed.
- **Virgil does not merge or delete a fork.** The two sides are whole-file
  snapshots taken at unknown times; picking a winner is precisely the destructive
  act the sync service itself declined to make. So the app REPORTS — which files
  forked, and which of them hold writing — and the surface is a WARNING about the
  folder, never an alarm about the document (the file Virgil owns is intact and
  its own writes are correct, so nothing here may gate a write).
- **…and the notice is dismissible, which is a consequence rather than a
  softening.** The reporting folder holds four months of accumulated forks that
  can only be cleaned in Finder, so a non-dismissible banner would be permanent,
  and a permanent banner is how a real signal becomes furniture.
- **The detection grammar can be generous because the base vocabulary is
  CLOSED.** `notes 2.json` can only be a fork of `notes.json`, because nothing in
  Virgil is called `notes 2`; an exact match against a declared filename
  short-circuits first, so no decoration grammar can reinterpret a real sidecar
  (`bib-settings.json` as `bib` + a suffix). OneDrive is the one service
  deliberately left OUT: its `-<hostname>` decoration is unconstrained and
  indistinguishable from a file the user parked there, and naming a user's own
  file as their lost writing is a worse error than missing a fork. Stated rather
  than implied — this scanner is not complete over every sync service.

**The DiskWatcher/ledger interaction was already right and had never been named.**
A daemon produces two shapes and the ledger has to tell them apart: a RE-WRITE of
bytes Virgil itself just wrote (same content, new mtime/inode — the ping-pong
seed) and a genuine LAND of a differing remote version. The existing mtime/size
drift → confirm-by-content-hash algorithm answers both correctly; what was
missing was a leg saying so, which is
[sync-race-back.test.ts](src/lib/__tests__/sync-race-back.test.ts). The other
half of "no ping-pong" is that the app's reaction to an emit is a READ —
`usePersistentState`'s handler calls `setState`, never `persist`, and defers
entirely while a local write is pending.

**What the forks actually cost, measured rather than assumed.**
[tools/triage-sync-conflicts.mjs](tools/triage-sync-conflicts.mjs) reports
per-file whether any fork holds a record the live sidecar lacks. On the reporting
folder: **189 of 204 forks carry nothing** (every `editor-state`, `virgil`,
`collab` and `todos` fork), and **12 forks hold 12 records that exist only in a
fork** — one note, three archived excerpts, four revision cards, four citations.
So the divergence is real and narrow, which is the shape the badge's copy takes.
`--prune` deletes only what a run proved inert; nothing merges.

CI: [sidecar-value-ssot.test.ts](src/lib/__tests__/sidecar-value-ssot.test.ts)
(totality over what production spells, the derivation, the byte-unchanged content
cadence, and the CENSUS — no write site may spell its own debounce literal, which
is exactly how a 400 ms *settle* came to mean a 400 ms *disk write*),
[sync-conflict.test.ts](src/lib/__tests__/sync-conflict.test.ts) (the grammars,
over REAL fork names copied out of the reporting folder — a hand-invented fixture
would only prove the regex matches its author's idea of Dropbox), the race-back
suite above, and
[editor-state-write-cadence.test.ts](src/hooks/__tests__/editor-state-write-cadence.test.ts),
whose shape is the point: **no pre-363 suite could see this**, because every one
of them asserts a SINGLE write's payload, which the pre-fix code satisfied
perfectly. The defect is a RATE, so the leg is a COUNT over a simulated reading
session — twelve scroll settles cost ONE write. Measured by neutering the
coalescer: all five cadence legs fail on the pre-fix immediate write.

**Owed, not claimed:** a real-Dropbox eyeball. This class masks everywhere but a
genuinely synced folder — the dev preview's `virgil-data/` is local and nothing
watches it — so the durable proof here is the unit contracts plus the triage
tool's measured run against the reporting folder.

## Capture/schema symmetry — never delete what you cannot restore

> **A destructive action must never delete content its capture destination cannot represent.** A card body that holds a verbatim slice of the document declares `bodySchema: "excerpt"` in `CARD_REGISTRY` and mounts the FULL main-document vocabulary; anything that deletes-and-captures validates the capture against that schema (`canMountInCardBody`) **before** dispatching the delete, and aborts + notifies if it doesn't fit.

This is the "archiving a section destroyed it" class (task 308). It is silent in *both* directions, which is why it needs a law rather than care: the capture is faithful (nothing looks wrong at write time), and **TipTap does not throw on a schema mismatch** — `createNodeFromContent` swallows the `RangeError` and returns an **empty document** (`enableContentCheck` is off), so the card renders blank with only a `console.warn`. Net effect: gone from the doc, blank in the card, and the first keystroke in that blank body persists the empty doc back over the capture. An unknown **mark** and an unknown node type at **any depth** all blank the whole document identically.

Two scopes, one SSOT in [src/lib/tiptap/borrowed-schema.ts](src/lib/tiptap/borrowed-schema.ts):

- **`"card"`** (`CARD_STARTER_KIT_CONFIG`) — authored card prose. No heading / blockquote / codeBlock / horizontalRule; the footnote/note rationale, still correct.
- **`"excerpt"`** (`EXCERPT_STARTER_KIT_CONFIG` + `buildExcerptOnlySchema`) — a document slice. Full StarterKit block vocabulary + the expex family + `titleField`/`maketitleMarker` + the `highlight`/`textColor` marks + the nested `footnote` marker. Today's only member is `archive`.

`EditableCard` resolves the scope **once** from the kind (`bodySchemaForCardKind`) and threads the same value to both body surfaces — `RichTextField` (expanded) and `BorrowedMainText` (compressed) — so a card's two views can never mount different schemas. That asymmetry was itself a live bug: `BorrowedMainText` registered `footnote` and `RichTextField` did not, so an archived paragraph carrying a `\footnote` rendered fine collapsed and blanked on expand.

CI: [src/lib/\_\_tests\_\_/…/excerpt-schema.test.ts](src/lib/tiptap/__tests__/excerpt-schema.test.ts) pins the **reverse** contract — every node **and** mark type the MAIN editor registers must be mountable in the excerpt schema. The pre-existing `borrowed-schema.test.ts` invariant runs one-directionally (borrowed ⊆ main) and therefore structurally *cannot* catch a main-only type reaching a card; this is the direction that does. A new main-editor node kind fails CI until the excerpt surface admits it — or until you confirm the guard refuses it, which turns a would-be data loss into a refusal. `archive-section-capture.test.tsx` pins the dispatcher end: the section is captured whole, and a capture that can't mount leaves the document **completely untouched**.

### The rebuild half: a per-kind capability is DERIVED, never hand-enumerated

Same law, other direction (task 233). Re-anchoring an **unanchored** card rebuilds its inline atom from scratch, so everything the atom can't regenerate must be read back from the card — and the read has to be a *derived obligation*, not a field someone remembers to add. `footnoteDropSpec.createAtom` built its atom with a hard-coded EMPTY body because the `DropCtx` sub-bag its citation twin got (`commandFor`) was never mirrored for footnotes. Re-placing an archived footnote therefore planted an empty atom, and since `getFootnotes()` re-derives BOTH the panel and the serialized `\footnote{}` from that node, the user's text was destroyed in the document. Nothing failed: the spec was registered, the dispatch worked, the node was well-formed. **A "registered and reachable" spec proves nothing about whether it can reach what it needs.**

So the accessor set is derived from the kind union, not enumerated per kind: [src/components/drop-mode/atom-card-apis.ts](src/components/drop-mode/atom-card-apis.ts) (`buildInlineAtomCardApis`) is a `Record` over `InlineAtomCardKind` (= the keys of `InlineAtomCardAttrs` in [drop-mode/types.ts](src/components/drop-mode/types.ts)), so a kind declared and left unwired is a **compile error**; `DropModeProvider` takes ONE `atomCards` prop instead of one field × four enumerations. The guard that catches the *original* shape is the implication `createsAtom ⇒ requiresCardApi` — both set by the factory from its own options and asserted off `CARD_REGISTRY` in [atom-card-api-coverage.test.ts](src/components/drop-mode/__tests__/atom-card-api-coverage.test.ts). Keying it on the declaration alone would prove nothing: the pre-233 spec *rebuilt an atom and declared nothing*. (Scope: this covers kind coverage; each kind's attr list is still hand-written — see the note on `InlineAtomCardAttrs`.)

Two more rules the same task earned. **A rebuild that can't read what it needs REFUSES** — the footnote branch declines when no accessor is wired rather than falling back to the empty create shape, because that fallback *is* the bug (empty `\footnote{}` into the `.tex`, with the real body still sitting unread in the sidecar). And **reconcile only where the derivation can corroborate it**: `onAnchored` (which clears the card's `unanchored`/`archived` intent) fires only for a drop into the MAIN editor, since the panels resolve "anchored?" against the main doc alone — clearing it for an atom inside a card body would hide the card from *both* lists. The panel-side derivation obeys the `resolveAnchorState` law directly (`selectAtomlessFootnoteRefs`): **a live marker wins over declared intent.**

### The lifecycle half: a record that manages document state SETTLES it before it ends

Same law, third carrier (task 238). A `status:"applied"` revision/cutter suggestion carries an `appliedChange` descriptor that binds a **live range in the user's `.tex`** — the light-blue `pending-ai-change` mark. Morphing that card to a comment, or deleting it, ends the record. Before this, both did so silently: the morph declared `drops: []` (so no confirm fired at all), and the converter rebuilt a comment with no `status`/`appliedChange`. The range survived its manager — `isAppliedPending` ([pending-change-collect.ts](src/links/pending-change-collect.ts)) requires `kind==="suggestion" && status==="applied" && appliedChange`, so Keep/Revert could no longer resolve it, and on reload `reapply-pending-marks` skipped the record and the orphan reaper stripped the mark. Net: unreviewed AI text left in the document, unrevertable, never warned.

The three carriers this class has now shown, all closed at the ONE chokepoint (`runCardLifecycleEvent`, [run-event.ts](src/cards/lifecycle/run-event.ts)): the record **envelope** (`archived`, task 072), a **text field** the target shape can't hold (`explanation`, task 199), and a **live document splice** (238). The first two are card data; the third is the user's prose, which is why it earns an obligation rather than a `drops` entry — **declaring `appliedChange` in `morph.drops` would surface a confirm and still leave the range unresolved.** So SETTLE is a distinct step: resolve the splice (keep = finalize, revert = byte-restore) *before* the mutate, cancel abandons the whole event, and a host that **cannot** settle (no editor) **refuses** rather than proceeding — the same decline-don't-fall-back rule the inline-atom rebuild follows.

Two structural rules it earned. **Membership is derived**: the kinds that own a splice are keyed on the existing `PendingChangeFamily` union ([applied-splice.ts](src/cards/lifecycle/applied-splice.ts)), so a third family member left unwired is a compile error. And the obligation is **kind-agnostic and passed to every door**, so there is no per-kind decision to forget — the delete leg carries it exactly as the morph leg does, because a delete ends the record just as surely. CI: [applied-splice-wiring-guardrail.test.ts](src/cards/__tests__/applied-splice-wiring-guardrail.test.ts) greps every `runCardLifecycleEvent(` / `makeUnbridgingDelete(` call site and fails any that omits `appliedSplice` — the guard that catches the *original* shape, which a test of the executor alone structurally cannot, since the executor was never the part that misbehaved.

#### An obligation owns its MODE, not just its firing

Same executor, one axis in (task 313). The UNBRIDGE obligation — discharge the card's linked `ai-requests.json` row — had been *whether*-pinned since task 198 (`assertMorphCoverage`'s `drops` biconditional) and never *how*-pinned, so the mode was picked per EditorPane call site and forked in silence: delete and archive passed `"terminate"`, and the morph callback passed **nothing**, inheriting `bridgeCardAiRequestFlag`'s `"toggle"` default. The two modes differ on exactly the state that matters — `"toggle"` matches through `isRequestOpen`, which reports an **answered-L3** row (`in-progress` + a non-empty `resultId`, what an L3 *propose* responder leaves behind) as CLOSED. So the drop matched nothing, wrote nothing, threw nothing, and the row survived on a routing-less kind with no next toggle to clear it. Every test was green, because the executor was never the part that misbehaved.

So `unbridgeModeFor(event.type)` ([run-event.ts](src/cards/lifecycle/run-event.ts)) answers it once, from the event, with an **exhaustive switch over the union** (a third `LifecycleEvent` type is a compile error until someone states its terminality); every door forwards, none decides — including `makeUnbridgingFootnoteDelete`, which deliberately skips the executor for its *signal* obligations and asks this SSOT anyway. Two rules fall out. **A defaulted argument is a decision nobody made**: `bridgeCardAiRequestFlag`'s `mode` is now **required**, because the two clients want opposite fail-safes (a checkbox must PRESERVE an answered row; a departing card must CLOSE it), so there is no safe guess to default to. And a **terminal transition is defined by the card leaving its aiRequest identity**, not by the card leaving — a flag-dropping morph qualifies exactly as a delete does. CI: [unbridge-mode-wiring-guardrail.test.ts](src/cards/__tests__/unbridge-mode-wiring-guardrail.test.ts) reads source per call site and fails a `bridgeCardAiRequestFlag(` that states no mode, a hard-coded mode outside `PERMITTED_LITERAL_MODES` (a literal means *this site decided* — right only where the site IS the intent), or any mode literal inside `src/cards/lifecycle/`. Types can say "you must pass something"; only the grep can say "you must not have chosen it."

### The move half: an insert asks the CONTAINER what it can hold

Same law, fourth carrier (task 257). A between-blocks drop deletes its source in the same transaction it inserts, so **"where does this block fit here?" is a content-safety question, not a cosmetic one** — and it must be answered in ONE place, from the schema, for every insert site.

`tr.insert` at a position whose parent rejects the node does not fail. ProseMirror's fitter makes room, and it has two very different ways of doing so: it **pads** (adding whatever the content expression requires, payload landing inside the same container — benign, and shipped behavior relies on it), or it **splits** the container to close it off — tearing one node into two that **both keep the original uuid**, with the payload stranded at top level between the halves. Only the second is corruption, and it was reachable from two directions at once, each call site looking complete on its own terms:

- `text-range-move.ts` fit the context with a **list-only literal** (`classifyParentAt === bulletList|orderedList` → wrap in a `listItem`) and knew nothing of expex → a text selection released in an example's item gap split the **example**;
- `textobject.ts` fit the context through the **registry adapters**, which know expex and the sub-object containers and nothing of lists → a paragraph released in a list-item gap split the **list**;
- `util/block-move.ts` and `stack-pull.ts` asked **nothing at all** — including stack-pull's text-SLICE door, which spliced block content with `tr.replace` and split the `exampleItemList` so the example grew a second item list.

The SSOT is [`fitNodeInContainer`](src/text-objects/drop-adapters.ts) (pure, schema-level) behind [`fitNodesAtInsert`](src/components/drop-mode/specs/drop-context.ts) (editor-level), a four-rung ladder: **direct** where the immediate parent accepts the bare node → **wrap** where a wrapper in `buildWrap`'s vocabulary is both valid at that index *and* able to hold the node → **direct** where a probe shows the fitter only pads → **reject**. Four rules it earned:

- **The wrap capability is DERIVED from the construction.** `tryBuildWrap` attempts the real `buildWrap` (now `createChecked` at every level) and reads null as "can't hold it" — so the `exampleBlock` wrapper, whose true shape interposes an `exampleItemList`, is answered correctly without a second, driftable description of that shape.
- **Ask the fitter, don't predict it.** The pad-vs-tear distinction is settled empirically (`bareInsertTearsContainer`): build the real trial transaction, then check that the payload LANDED (`doc.eq` plus a size floor — `tr.docChanged` counts steps, not change) and that each ANCESTOR type's count moved by exactly what the payload's own subtree contributes. Crediting the payload's root type alone refused a nested list, whose `listItem` children are ancestor-typed too. A throw counts as a tear. At a top-level gap there is no ancestor to tear and the payload-landed test is the whole guard.
- **A payload arrives in the target's vocabulary or not at all.** Cross-editor drops carry nodes built from the SOURCE schema, and every rung compares NodeTypes by identity — so `fitNodesAtInsert` re-hydrates a foreign node through the target schema first, and refuses when the target genuinely cannot represent it (a card body has no `heading`). Same law as the capture side, at the other end.
- **The adapter proposes; the container disposes.** `textobject.ts` still runs the registry adapter (that is where a KIND's preference lives — ordered-vs-bullet, compatible-parent), then passes its answer through the fit, which is the authority on what this container can actually hold. Where the adapter is already right the fit reports `direct` and nothing changes.

Rejection is **atomic over the payload** (one unfittable node refuses the whole drop — a partial landing is content loss) and returns **before** the transaction is built, so the source is never deleted. Because rule 3 sanctions a padded insert, every multi-node loop advances its cursor by the transaction's **actual** size delta, not by `n.nodeSize`.

CI: [container-fit-guardrail.test.ts](src/components/drop-mode/__tests__/container-fit-guardrail.test.ts) flags every SPLICE SITE in `src/components/drop-mode/` — the whole `insert`/`replace`/`replaceWith`/`replaceRangeWith`/`replaceSelectionWith`/`step`/`insertContentAt` family, any receiver — and fails any whose **enclosing declaration** neither calls `fitNodesAtInsert` nor carries an in-place `container-fit-exempt: <why>` marker (files carrying markers are allowlisted in `PERMITTED_UNFITTED_INSERTS`; today: inline-atom placement at a caret, the two inline-cursor slice moves, and the probe's own trial transaction). Both halves of that shape were learned the hard way: the guard's first version matched only `.insert(` and asked its question per FILE, and the two holes conspired — the stack-pull slice door was invisible to the regex *and* would have been exempted by a fit elsewhere in the same file, so CI was green while that door still tore examples. This is the guard that catches the ORIGINAL shape — a test of the fit function alone structurally cannot, since the fit was never the part that misbehaved; the part that misbehaved was a call site that never asked.

#### The proxy half: an adapter asks the SCHEMA before it asks the classifier

Same gesture, one rung earlier (task 234). The fit above is the authority on what a container can hold, but it only ever sees what the registry ADAPTER proposed — and the adapter can refuse the drop outright (`no-op`) before the fit is consulted. So the adapter's own wrap-vs-direct decision has to rest on the same truth the fit does.

It didn't. `blockIntoExpexDropAdapter` asked the schema at the true immediate parent (`canDropDirect`); the two sub-item adapters asked `classifyParentAt`'s `isCompatibleParent` verdict, which is a **lossy proxy** — it reports the nearest *registered* `TextObjectKind`, so an unregistered structural container between the insert point and that ancestor is skipped and two structurally different positions collapse onto one answer.

> **A wrap-vs-direct decision is a schema question. The FIRST thing every adapter asks is whether the TRUE immediate insert parent accepts a bare node of its kind; the classifier's verdict is a fallback for the positions the schema signal cannot settle, never the opening move.**

`exampleItemList` is unregistered, and `exampleItem`'s content ends in `exampleItemList?` — so an expex example NESTS, and Tab/`sinkListItem` makes that tier reachable. At a nested item gap the walk-up lands on the enclosing `exampleItem` instead of the `exampleBlock`, `isCompatibleParent("exampleItem","exampleItem")` is false, and `exampleItemDropAdapter` fell to its wrap branch — where task 065's gate *correctly* refuses a fresh `exampleBlock` inside an `exampleItemList`. Net: the hit-test painted a drop indicator at the nested boundary and the release did **nothing**, silently, while the schema at the true parent (`exampleItem+`) accepted the bare item all along. Lists never hit it because their intermediary (`bulletList`) is itself registered AND compatible — the defect needs an unregistered container in the middle, which is exactly what a proxy cannot see.

The ladder is now ONE function, [`resolveWrapOrDirect`](src/text-objects/drop-adapters.ts), shared by all three: **schema accepts the bare node → direct**; **schema refuses it but the fabricated wrapper is valid here → wrap** (the 065 gate); **the proxy says the enclosing registered container welcomes this kind → direct**, handing the exact shape to the container fit, which can still wrap, pad or refuse; **no evidence → the adapter's own default** — a sub-item wraps (and no-ops if its gate refuses that wrap), a BLOCK drops direct, which is why `blockIntoExpexDropAdapter` never returns `no-op`. Rungs 2–4 are each adapter's pre-234 behaviour case for case; rung 1 is the whole of the fix.

Three things worth knowing. The proxy rung is kept deliberately, not left over: an `exampleItem` released in a SINGLE example's widened body is refused bare (rung 1 no) and cannot be wrapped in an `exampleBlock` there (rung 2 no), yet the fit lands it inside the block — deleting rung 3 would turn that shipped drop into a dead one.

The **residual, scoped honestly**: for the SAME-KIND peer resolver (`resolveSubItemPeerBlock`) the indicator can now only under-surface, never over-promise — it reports a hit only where an ancestor's type equals the dragged kind, so its `insertPos` sits in a container that demonstrably already holds that type, and rung 1 fires by construction. That guarantee does **not** extend to the generic fallback: a popped-out `listItem` over a nested `exampleItem` gap takes neither the peer resolver (wrong kind) nor `resolveBlockIntoExpex` (a `listItem` is not an `EXPEX_INNER_KIND`), so `resolveAnchorableBlock` paints an ordinary between-blocks bar there — and the release is correctly refused (rung 4), silently. Bar painted, nothing happens, no message: that is the section's own symptom class, surviving for cross-kind sub-items in a foreign container's item gap. It is a *refusal* rather than a corruption, and closing it is an affordance question (suppress the bar, or say why) rather than an adapter one — recorded here as a known residual, not fixed in this pass. Task 321 (the feedback half below) took the second half of its cost: the refusal now reaches the DECISION, so the session cancels and the popped-out float survives instead of being dismissed over an untouched document. The bar and the silence remain.

And the position half, which the adversarial review of this fix surfaced: the same-editor commit **maps** the insert position through the delete (`tr.mapping.map`) instead of predicting it as `insertPos − (to − from)`. That arithmetic assumes `tr.delete` removes the source's declared node size, and it does not when the source is the SOLE child of a container whose content forbids emptiness (`exampleItemList` is `exampleItem+`, and expex's Tab keymap makes one-item lists routine): ProseMirror keeps a minimal valid residue, so the insert landed four positions early — inside the preceding peer, which the fitter closed to fit it, tearing that item in two with a duplicate uuid on a document that still `check()`s clean. Pre-existing (it misplaced top-tier drops too), but rung 1 is what first routes a drop *into* it at the nested tier, where the old answer was an untouched document. **Ask the transaction where a position went; never predict it** — the same rule the fit follows about the fitter and the identity net about multi-step transactions.

##### …and the position half was fixed in ONE spec and left stale in its three twins (task 331)

The rule above was written down twice and implemented once. `specs/textobject.ts` mapped; `util/block-move.ts` (the example card's own drop), `specs/text-range-move.ts`'s inline-cursor branch and `util/inline-atom-move.ts` each kept a private copy of `insertPos − (to − from)`, and the "advance the multi-node cursor by what ACTUALLY landed" half was re-derived at five sites. **A rule that holds at three call sites out of four is how this class keeps recurring**, so both halves now live in [src/components/drop-mode/util/mapped-insert.ts](src/components/drop-mode/util/mapped-insert.ts) (`resolveInsertPos` / `insertNodesAdvancing` / `selectInsertedSpan`) and every splice reads them there.

Three rules it earned:

- **The ORIGIN is a required, named union, because the two answers are different claims about the same integer.** `{ mapThrough }` means "a pre-delete coordinate — ask the mapping"; `{ liveAt }` means "already in this transaction's coordinates". A defaulted "map if a delete happened" would be a decision nobody made *and* silently wrong for the between-blocks range move, whose `dropEmptiedSourceBlock` maps the position itself and RE-maps it when it sheds the residue — so what it holds at insert time is already live, and mapping again would double-count the cut.
- **Convert the sites where no drift is measurable too, and say which is which.** Measured against the real schema: drift **2** for an `exampleBlock` alone in a `blockquote`, drift **4** for the sole `exampleItem` (the case above). The inline-cursor range move's cut is text-bounded and no shape was found where its prediction and the mapping disagree — that conversion is a HARDENING, and the comment at the site says so rather than claiming a bug it can't demonstrate.
- **Lifting a splice into a shared door nearly DRAINED the census that governs it.** `container-fit-guardrail`'s `SPLICE_CALL` needs a `.method(` receiver, so a bare `insertNodesAdvancing(…)` call matches nothing: left alone, every converted site would have stopped being a splice site and both the fit and the adoption questions would have gone unasked for it — the exact drift those legs exist to catch, arriving as a tidy-up. So the door is itself in the splice family, and the primitive's two allowlist entries are honest *only* because of that: **a wrapper relocates an obligation to its callers; it never absorbs one.**

The same task deleted the two **unreachable cross-editor branches** in `textobject.ts` and `block-move.ts`. Both specs resolve their source inside `placement.editor` — the TARGET doc — so `targetEditor === src.editor` was true by construction and the insert-then-delete branch behind it could never run: code reasoning about a dispatch ordering that cannot occur, which the dead-SSOT rule outlaws. Deleted rather than wired live, deliberately: making a cross-editor block move real would newly enable main→card-body block CAPTURE, a product decision the capture/schema-symmetry law governs. `textobject.ts`'s `LocatedSource` no longer carries an `editor` field at all — **unrepresentable beats deleted**, since a value that can only equal `placement.editor` is an invitation to re-add the fork. The one genuinely cross-editor spec remains `text-range-move.ts`, which resolves its source from the `DropCtx`.

CI: [mapped-insert-position.test.ts](src/components/drop-mode/__tests__/mapped-insert-position.test.ts) drives the REAL `blockMoveSpec` against the REAL schema over a source whose delete leaves a residue, and its defect leg fails on the pre-fix arithmetic with the diagnostic the class deserves — `duplicate uuid in ["tail","ex1","ex1-i","ex1-p","tail"]`, the passed-over paragraph torn in two with its text severed across the halves. Beside it: a byte-identical non-regression pin for an ordinary top-level move (where the mapping and the prediction agree), the primitive's own contract, and a pin that `selectInsertedSpan` cannot throw — `block-move` was the one of the three selection sites with no try/catch, and since task 321 these transactions are built inside `planDrop`, which `classifyDrop` calls bare inside an `async commitDropSession` whose callers `void` it.

CI: the rung-1 law is asserted over **every distinct `dropAdapter` on `TEXT_OBJECT_REGISTRY`** ([drop-adapters.test.ts](src/text-objects/__tests__/drop-adapters.test.ts)) rather than over the two adapters that were fixed — a future adapter, or a future kind pointed at an existing one, inherits it without anyone extending a list — against a target that is adversarial in both directions (the proxy verdict that tempted the wrap AND a `canPlaceHere` that would sanction one). End-to-end, [nested-tier-sub-item-drop.test.ts](src/components/drop-mode/__tests__/nested-tier-sub-item-drop.test.ts) runs the REAL editor schema, because the pre-existing sub-item harness hand-rolls `exampleItem` as `paragraph+` and therefore **cannot even build** the shape that breaks — the reason this sat live and untested.

#### The affordance half: what the hover OFFERS is what the commit ACCEPTS

Same gesture, one step earlier still (task 258). The two halves above govern where a payload may *land*; this one governs what the drag may *promise*. The hit-test walks the SESSION's placement list in priority order — before this task always the spec's `allowedPlacements` — and returns the first geometry match. But `inGap`/`inText` are an **exact partition** of every cursor position, and `paragraph-side` matches EITHER. So a `paragraph-side` listed after both partition members can never be returned, and `stackPullDropSpec` declared exactly that shape from the day the Stack landed (`c4f95034`, 2026-05-14): pulling a note/todo/archive/revision/cutter CARD onto a paragraph painted an **inline caret**, mouseup asked the spec's own per-payload validity check, which refuses `inline-cursor` for a card, and the drop silently did nothing. The `paragraph-side` arm of that check and the whole `paragraphId` anchoring branch behind it were dead code — the paragraph-anchored pull the spec advertised did not exist.

> **A spec-wide static priority order cannot answer a PER-PAYLOAD question, and the hover and the commit must answer it from the SAME table.** Where one key prefix covers several payload shapes, the spec narrows its list per payload (`DropSpec.placementsFor`), resolved ONCE per session; the geometry rule that consumes it lives in one function both the loop and its guard read.

[src/components/drop-mode/placement-policy.ts](src/components/drop-mode/placement-policy.ts) is that rule: `winningPlacementKind(placements, "gap" | "text")` **is** the hit-test's switch, `unreachablePlacements` is derived from it over both geometries, and `resolveSessionPlacements` is called once in `beginDropSession` (never per pointermove — the resolution reads persisted state; stack-pull parses its whole localStorage envelope, and the payload behind a cardKey cannot change mid-gesture). Four rules it earned:

- **One table, two readers.** `stack-pull.ts`'s per-payload table (`placementsForPayload` over the four named lists + `CARD_PLACEMENTS`) backs `placementsFor` (the affordance) *and* `isPlacementValidFor` (the commit). The defect was never one of them being wrong — it was the same question answered twice from different tables, which is invisible until the two disagree at one geometry.
- **Order matters only against `paragraph-side`.** `between-blocks` and `inline-cursor` are mutually exclusive, so their relative order never bites; the card list is `["between-blocks", "paragraph-side"]` so a gap still means "unanchored" and the text world falls to the side placement. This is also why the surgical fix (reorder the union) was wrong rather than merely shallow: `paragraph-side` first would have stolen the text-slice pull's caret.
- **An empty list is an ANSWER, and the resolution fails CLOSED.** A payload with no implementation (`example`: its `applyCardDrop` branch is a documented v1 no-op), an unresolvable key (the item evicted mid-drag), and a payload SHAPE this build doesn't know (`readEnvelope` validates the envelope and then casts, so a blob from another build arrives typed as something it is not) all resolve to `[]` — no bar paints anywhere, instead of an inviting bar over a commit that will refuse. Nothing coalesces a missing answer back to `allowedPlacements`: for the one spec that has a per-payload policy, that union is precisely where `paragraph-side` is unreachable, so a fallback would reinstate the defect for exactly the payload nobody understood — and the same `undefined` would throw on `.includes` inside `classifyDrop`, which the controller does not catch, wedging the session. `allowedPlacements` remains the declared ENVELOPE for such a spec, derived from the table, and is explicitly **not** a priority order — read as one it is still unreachable-complete, because it is a union.
- **Per-kind capability is DERIVED from what the branch does.** `CARD_PLACEMENTS` grants `paragraph-side` iff that kind's `applyCardDrop` branch passes `paragraphId` to its `ctx.stack` factory (a footnote/citation/bib pull has no paragraph anchor to take), keyed on `StackCardKind` so a new stackable kind is a compile error until someone states where its pull may land.

CI: [placement-reachability.test.ts](src/components/drop-mode/__tests__/placement-reachability.test.ts) censuses **every spec a drag can dispatch** (`CARD_REGISTRY[k].dropSpec` + the four module specs) and fails any that declares a placement the switch can never return — reading the rule from `winningPlacementKind` rather than restating it, with the pre-fix array pinned as a canary. A spec answering per payload is censused through its published per-payload lists, not its envelope, and the leg that keeps that from being an escape hatch asks the LIVE SPEC OBJECTS which of them declare `placementsFor` and requires each to publish. (A source grep was the obvious move and would have been wrong twice: it misses the ES method-shorthand `placementsFor(key) {…}` — already the local idiom for `classifyDrop`/`applyDrop` — and 13 of the ~17 censused specs are authored under `src/panels/<Panel>/drop-spec.ts`, outside any drop-mode-directory scan.) [stack-pull-placement-policy.test.ts](src/components/drop-mode/__tests__/stack-pull-placement-policy.test.ts) drives the REAL hit-test end to end (four defect legs plus the non-regression pins a naive reorder would break), re-derives `CARD_PLACEMENTS` by running the REAL `applyDrop` against a recording `StackPullApi` over the table's OWN keys, and — the leg that catches the original shape, since every other one calls `hitTest` directly with a hand-resolved list — drives the real controller through `beginDropSession` + a synthetic mousemove, so reverting `handleMove` to pass `spec.allowedPlacements` (which typechecks) fails CI, along with a read-count leg pinning the once-per-gesture resolution.

**Scope, honestly — three residuals.** (1) This closes the PLACEMENT-KIND axis only: a placement whose *kind* the spec accepts can still be refused downstream by the container fit or a registry adapter — the residual recorded in the proxy half above. Since task 321 (the feedback half below) that refusal at least reaches the DECISION, so the session cancels with the float intact instead of reporting a drop that never happened; the bar still paints and the release still says nothing, which is the affordance question left open. (2) `winningPlacementKind` models the priority SWITCH, which is step 6; two resolvers run before it (`resolveSubItemPeerBlock`, `resolveBlockIntoExpex`), each gated only on `placements.includes("between-blocks")` and each able to return a `between-blocks` placement for an IN-TEXT cursor. Every spec that reaches them declares `between-blocks` first, so the census is exact today — but a future `["paragraph-side", "between-blocks"]` spec would need that path folded into `unreachablePlacements`, not the assertion relaxed. (3) Of the eight card kinds this makes paragraph-anchorable, only `todo` and `archive` capture a `paragraphSnapshot` at creation (`EditorPane`'s `dropStackApi`); note / the two revision kinds / the two cutter kinds create a snapshot-less Mode-A link, so they lean entirely on `finishApply`'s `requestAnchorFlush` for durability rather than on the reload reconciler's find-by-text fallback that `textObjectSideReanchorSpec` gives every other paragraph-side drop.

#### The feedback half: the DECISION is derived from the EXECUTION

Same gesture, last step (task 321) — and the half where every guard above was already correct and the user still saw the drop fail silently.

`DropSpec` asks the same question at two moments: `classifyDrop` decides (once, at mouseup, inside `commitDropSession`) and `applyDrop` executes. They were independent functions, and **every refusal the sections above installed lived only in the second**, as a bare `return` — the 065 adapter `no-op`, a wrapper that cannot hold the node, the container fit's `reject`, a rehydrate that threw, a `ctx` sub-bag unwired in this doc. So for a gesture the spec would refuse: the hit-test painted a valid landing bar; release ran `classifyDrop`, which said `apply`; `finishApply` set `applied = true` **because nothing THREW**; `postDrop: "close"` dismissed the popped-out float; and the document was unchanged with no toast, no cursor change, nothing. It read as "it worked and then vanished." Worse on the throw path, where the close ran unconditionally: the card disappeared on the one path where something had actually gone wrong.

> **A spec that can refuse states ONE resolution — `planDrop` — and both doors are DERIVED from it.** The plan reads live state and returns either a `DropPlan` whose `commit()` merely dispatches, or `null`. `null` reaches the controller as `no-op`, which cancels the session with the float intact. And **the close is gated on the same report the anchor flush is**: `postDrop: "close"` fires only when `applyDrop` completed without throwing — the predicate this section indicts three sentences earlier, which is honest here because it is the only report `applyDrop` can make, and is enough for the two paths that exist (a refusal never reaches it, and a throw no longer takes the float with it). The `planned-spec.ts` header states what it would take to make that report a real one, and who owes it.

[src/components/drop-mode/planned-spec.ts](src/components/drop-mode/planned-spec.ts) is the factory; `DropPlan`/`DropPlanner` live on the type leaf beside the `DropSpec.planDrop` field they populate. Four rules it earned:

- **The plan is PURE and the commit is the only side effect.** It runs TWICE per gesture — once per door, and never per hover frame — so a `ctx.stack` factory call or a sidecar write in the plan would fire on the classify pass too. The rule is also written forward: no planned spec can answer `confirm` today, but the moment one can, the plan runs once before the user has agreed to anything. Transactions are BUILT in the plan (so a splice that throws is a refusal rather than a half-applied gesture, and the container fit stays in the same declaration as the splices it governs — which is exactly what `container-fit-guardrail` checks) and DISPATCHED in the commit.
- **`applyDrop` re-plans; it never commits the plan `classifyDrop` built.** For a planned spec today the two calls are back-to-back in one tick, so this buys nothing yet — it is the rule that keeps the `await` on the confirm path from becoming a live hazard the moment a planned spec can reach it, since a transaction built at classify time would then be dispatched against a document that has moved on. Planning runs twice per gesture and never per hover frame — the per-frame path is the hit-test — so the safe order is also the cheap one.
- **A non-null plan is a PROMISE that `commit()` changes something.** A commit that can still silently do nothing reproduces the drift one level in. This is why stack-pull's card branch resolves *which factory would run* (and refuses on an unknown kind or an unwired `ctx.stack`) rather than switching inside the commit.
- **No `decide` hook.** A refinement from a resolved plan to `{kind:"confirm"}` would be an option nothing reads — the dead-field class (task 227). Add it with its first real caller, and with the two obligations the header names: a real applied-report for `applyDrop`, and the re-plan rule above becoming load-bearing rather than precautionary.
- **A planner that THROWS is a refusal.** The construction this moved into `planDrop` used to live only in `applyDrop`, inside `finishApply`'s `try`; `classifyDrop`'s caller has no catch and is `async`, so an escaped throw would become a rejected promise that never reaches `endDropSession()` — leaking the window listeners, the `data-drop-mode-active` body attr and the lift overlay past mouseup. The factory restores that boundary on the door that lacks one. No such throw is reachable today, which is exactly what would make it a latent trap.

Converted: `textobject.ts`, `text-range-move.ts`, `util/block-move.ts`, `stack-pull.ts`. The two factories whose doors were already symmetric by construction stay hand-written and are allowlisted with that reason — `inlineAtomMoveSpec` (one shared `resolve` closure, and the create branch decided by the same pure `buildCreateNode` probe on both sides — the model this fix generalizes) and `textObjectSideReanchorSpec` (guard-for-guard twins off the same `getApi(ctx)`; also the repo's only `confirm` producer).

Three adjacent silent-failure doors closed with it, each the same shape one field over: stack-pull's text branch had **no empty-slice guard** where both its `text-range-move` siblings do, and failed in the WRONG direction at each geometry (in a gap `rangeSliceToBlocks` falls back to a fresh paragraph, so it landed a BLANK block and reported success; at a caret it dispatched an effect-less transaction); its heading branch **swallowed a per-node rehydrate failure** and landed a partial section, the one non-atomic door in a file whose every other refusal is all-or-nothing (a pull is a copy, so refusing costs nothing — the item stays on the Stack); and `finishApply` closed the float without reading `applied`.

CI: [planned-decision-guardrail.test.ts](src/components/drop-mode/__tests__/planned-decision-guardrail.test.ts) — a SOURCE census (every drop-mode file that calls `fitNodesAtInsert` must build through `plannedDropSpec`; allowlist empty, a hit is CONVERT-it) plus a RUNTIME census over every spec a drag can dispatch (expose `planDrop`, or sit on `PERMITTED_HAND_WRITTEN_DECISIONS` with a stated reason the two doors cannot disagree — asked of the live objects, for the same reasons `placement-reachability` gives), the derivation's own contract, and the real specs against a container that genuinely refuses, with an accepting control so no leg can pass vacuously. [refused-drop-keeps-float.test.ts](src/components/drop-mode/__tests__/refused-drop-keeps-float.test.ts) drives the REAL controller through all three endings — lands / refuses / throws — because the close is the controller's branch, not the spec's. Both suites' defect legs fail on the pre-fix derivation. Renegotiated on the way: two `sub-item-drop-resolution` legs asserted `{kind:"apply"}` three lines above asserting nothing was dispatched, which **is** this defect, pinned as intended behaviour.

Known residual, unchanged by this and stated in the affordance half above: a refused position still paints an inviting bar and says nothing on release. Making refused positions unhoverable needs a predicate cheap enough for the per-frame hit-test (the plan is not — it builds transactions), so it is a product decision, not a follow-on.

#### The other gesture: the Stack capture never asked the facet built to answer it

Same law, outside drop-mode entirely (task 332) — and the case where the SSOT existed, was
correct, was pinned three ways, and the gesture that most needed it simply never called it.

Releasing a popped-out float over the StackIcon is a drag with no `DropSpec` in it: the shell
(`FloatingPanel`) lights the icon's capture ring while dragging and dispatches a
`virgil-stack-drop` window event on release; `EditorPane`'s handler resolves the `Floatable`
and asks it to serialize. The hover gated on `if (cardKey)` and pure geometry. Only the
handler read `CARD_REGISTRY[kind].stackable` — by which point the gesture had already
promised. So a **Report / Report Request / Example** float lit the ring exactly as a note
does, the release was accepted, `snapshotForStack` answered null, and the float was closed
anyway under the comment *"Close the source float regardless of snapshot success — the user's
intent is clear."* Right about the intent (capture) and wrong about the outcome: the card
vanished from the screen with nothing on the Stack, no strip opening, and no message.
Task 259 built `stackable` precisely so this question would have ONE answer; this gesture
never asked it.

Three pieces, mirroring the drop-mode halves above:

- **The declaration.** [`canCaptureToStack(floatKey)`](src/floats/stack-capture.ts) — parse the
  key, read the registry. `FloatingPanel` resolves it **ONCE at mousedown** onto the move
  gesture's own state (never per mousemove: a registry read cannot change mid-gesture, the
  rule `resolveSessionPlacements` follows), and BOTH the ring and the release read that one
  value. A float whose kind cannot be captured lights no ring and falls through to the normal
  drop/redock handling. The module is deliberately LIGHT — the card spine's runtime leaf and
  the key grammar, nothing else — because the drag shell is imported by half the app; the
  execution half may be heavy and lives elsewhere.
- **The door.** [`captureFloatToStack`](src/floats/resolve-floatable.ts), built on the same
  `resolveFloatable` `FloatHost` renders from. The host had carried its own copy of that
  dispatch, announced in its comment as *"Mirror `FloatHost.resolveFloatable`"* — a stated fork,
  which is the shape "A registry earns its name by being read" outlaws. Moving the
  `@/cards/floats` registration import with it is what makes the capture path declare its own
  obligation instead of inheriting it from whoever imported the renderer.
- **The report is the permission.** The float closes only on a snapshot that actually landed.
  The declaration cannot answer everything the execution can — a text-object float outlives the
  block it was lifted from, so a deleted source resolves to null at capture time — and *that*
  is exactly what the report is for. Which also earned the fix's one non-obvious line: the
  stack-drop branch returns before the shared position commit, harmless only while a capture
  always closed the float, so it now commits the dragged rect itself or a refused capture
  strands the float over the icon at a position nothing stored.

**A text-object float is capture-capable as a FAMILY, and that is derived rather than waved
through**: `snapshotTextObject` is total over `TextObjectKind`, so there is no kind-shaped
refusal to declare — only per-moment resolution failures, which the report owns. It is
deliberately NOT keyed on `TEXT_OBJECT_REGISTRY[kind].floatBodyComponent`, which is mutable
state written by a side-effect registration module: an affordance must not depend on import
order.

CI: [stack-capture-affordance.test.tsx](src/components/__tests__/stack-capture-affordance.test.tsx)
drives the REAL gesture (mousedown → mousemove onto the icon's published rect → mouseup) for one
stackable kind and the three non-stackable ones — **every other guard in this cluster is blind
to the drag by construction**, which is how the gesture shipped for a year never asking the
facet. Its close-gate leg reads `EditorPane` SOURCE, because that handler lives in a component
no unit test mounts and the part that could misbehave was never the door. `stack-coverage`
gains the affordance ⇔ declaration sweep per kind (keying the guard on the declaration alone
would prove nothing — it has to ask the predicate the gesture reads), and `float-snapshot` the
door's refusals plus a census that `snapshotForStack` has exactly ONE production caller: a
second capture site would ask no capability at all, and the ring would be honest while the
commit was not. The refusal legs assert the record is never even RESOLVED (the kind's
`toFloatable` must go uncalled), since the null alone passes with the capability check deleted —
the two-tables shape restored with CI green.


#### The vocabulary half: an exemption is scoped to the shape it justifies

Same gesture, and the case where the law was already written, already enforced, and enforced in a place two call sites had a written licence to skip (task 328). Rule 4 of the move half above — *a payload arrives in the target's vocabulary or not at all* — lived **inside** `fitNodesAtInsert`, as a private helper reachable only by going **through** the container fit. Two splices are deliberately exempt from that fit, each carrying a `container-fit-exempt:` marker whose stated reason is *"an open slice merging with the text around a caret… no container is being entered"* — a true statement about **containers** and a false one about **vocabularies**. Because the adoption sat in the same function, the exemption silently bought an exemption from it too.

The cost is the worst outcome this whole section legislates against, and it is silent at every layer. A lifted selection — or a footnote/citation card's marker — released at an inline caret **inside a card body** was spliced with nodes built from the SOURCE schema. Two `Schema` objects built from the same extension list hold **distinct `NodeType`s**, and ProseMirror's `Fitter` compares them by identity: it `dropNode()`s the payload, `replaceStep` returns null, and `Transform.replace` appends **no step at all** — `steps: 0`, `docChanged: false`, no throw. The move's *second* transaction, the unconditional source delete, then ran. Prose gone from the document, nothing in the card, `selectInserted` highlighting a run of the card's own pre-existing text so the drop looked successful. For the atom it also destroys the footnote's **body**, which is the atom's `content` attr and lives nowhere else. This is task 321's "it worked and then vanished" one level deeper: there the document was merely untouched; here it is damaged.

> **Adoption is an obligation SEPARATE from fitting, and so is the report.** Every splice that can receive a payload from another editor re-hydrates it through the TARGET's schema and REFUSES when that schema cannot represent it; and a relocation dispatches its source delete only on **evidence the insert landed**, never on the absence of a throw.

[src/components/drop-mode/schema-adopt.ts](src/components/drop-mode/schema-adopt.ts) is the SSOT — `adoptNodeIntoSchema` / `adoptSliceIntoSchema` (same schema ⇒ the same object by identity, zero cost; foreign ⇒ re-parse or `null`) and `insertLanded`. `fitNodesAtInsert` calls the first, so nothing on the fitting path changed; the exempted splices call it directly. Five rules it earned:

- **An exemption is scoped to the shape it justifies** — task 204's rule, arriving here from the other direction. There the finding was a census exempting a whole category on ergonomic grounds; here it is a marker whose author was right about the question they were answering and silent about the one they weren't. The generalizable half: **when an exemption's reason names a specific mechanism ("no container is entered"), check what ELSE that mechanism happens to gate.** The two questions now carry distinct markers (`container-fit-exempt:` / `schema-adopt-exempt:`) precisely so neither can answer for the other.
- **The two nets are independent, and the second is not a corollary.** `Slice.fromJSON` / `Node.fromJSON` validate the **vocabulary** — an unknown node type or mark throws — and say nothing about the **content expression**, so a payload the target can NAME but cannot HOLD still reaches the fitter and is still swallowed. `insertLanded` (steps > 0 **and** growth ≥ the payload) is the same rule `restoreExcerptAtCaret` earned in "The return half", for the same reason: `replace` / `insert` / `insertContent` all swallow a mismatch, so `void` looks identical for "landed" and "destroyed". It is deliberately redundant — it catches the next swallowed splice even if someone adds one without adopting. Its stated limit: it reads a NET growth, so it is meaningful only for an insert-ONLY transaction, which is exactly the cross-editor shape.
- **Adopt ABOVE the same/cross fork, not inside it.** `text-range-move` resolves the payload once before it asks which editor it is talking to — the same-editor answer is the identical slice by identity — so the obligation is unconditional rather than a branch someone has to remember, and the census's declaration-level region honestly vouches for both splices instead of one branch vouching for its sibling.
- **A refusal only `applyDrop` can see is the task-321 defect.** `inlineAtomMoveSpec` is one of the two specs allowlisted out of the `plannedDropSpec` derivation on the ground that its doors are "symmetric by construction"; adding a refusal to one of them would have retired that ground. Both doors now derive from ONE pure `resolveDrop` (`create` | `move-within` | `move-across`), which is what makes the allowlist entry true rather than merely traditional. The cross-editor insert transaction is BUILT there, where the answer can still be `null`; `commit` only dispatches it and then deletes the source.
- **Moving a transaction onto the CLASSIFY door moves a THROW there with it** — the trap `planned-spec.ts` had described as unreachable, made reachable by this very fix and caught by the adversarial pass on it. `Transform.replace` resolves both positions (`RangeError` on a stale `placement.pos`) and `Transform.step` throws `TransformError` on a step that fails to apply; a hit-test position recorded on the last throttled mousemove can be stale by mouseup if the target card body shrank under it. `applyDrop` is caught by `finishApply`; `classifyDrop` is called BARE inside the controller's `async commitDropSession`, whose callers `void` it with no `.catch` — so an escaped throw becomes a rejected promise that never reaches `endDropSession()`, leaking the window listeners, the `data-drop-mode-active` body attr and the lift overlay past mouseup. So the containment is EXPORTED (`refuseOnThrow`) rather than re-derived, the hand-written spec wraps its RESOLUTION (not each door, so a third door cannot forget), and `planned-spec.ts`'s "no such throw is reachable today" sentence was retired rather than left standing. **An entry on `PERMITTED_HAND_WRITTEN_DECISIONS` is a claim about AGREEMENT between the doors, never about safety** — its allowlist reason now says so, because this fix is what proved the two are different claims.
- **The census is the leg with teeth, and it needs TWO editors to have any.** The primitive was never the part that could misbehave — a call site that doesn't ask it is. So [container-fit-guardrail.test.ts](src/components/drop-mode/__tests__/container-fit-guardrail.test.ts) asks two questions over the same splice-site family (*did you fit?* AND *did you adopt?*), with the adoption exemptions allowlisted **per LINE** — a file-scoped list would excuse the next splice added beside them, and two of the three entries live in the very file whose cross-editor splice was the defect. Measured on the pre-fix tree, it names all three defect sites. The behavioural half ([cross-editor-adoption.test.ts](src/components/drop-mode/__tests__/cross-editor-adoption.test.ts)) builds **two genuinely distinct `Schema` objects**, which is the reason no existing suite could see any of this: every one of them builds ONE schema and hands the same object to both editors, where the splice is native by construction and the defect is unrepresentable.

**Reachability, stated honestly rather than implied.** Narrow today, and a reason to price it below "urgent" rather than to leave it: the target must be a REGISTERED drop-target editor other than the main one (only `RichTextField` card bodies register — `BorrowedMainText` does not), expanded and editable; it must be hit-testable during a drop session, and `globals.css` makes every `[data-floating-panel="true"]` subtree `pointer-events: none` while one is active, so the reachable surface is the omni column; and the body must contain a node DECLARING a `uuid` attr, since `hitTest` bails when `resolveAnchorableBlock` returns null and card-body `paragraph`/`heading` carry none. A note with display math, or an archived excerpt holding a figure, is enough. The same two lines are also a **latent trap** — anything that registers a second drop-target editor, or gives card bodies uuid'd paragraphs, widens this to every card body at once.

### The identity half: a move conserves identity, a split mints it

Same gesture, one axis in (task 320). A between-blocks / inline-cursor **text-range** move builds its payload from `doc.slice(from, to)`, so every block child arrives carrying the SOURCE block's `uuid` — and the cut is TEXT-bounded (`findLinkedAnchorRange` returns text positions), so `tr.delete(from, to)` can never *remove* its first block: it opens it and joins what follows into it. Net, before this: **two live blocks answering to one uuid** (the moved copy and the residue), plus a blank paragraph sitting where the text used to be. A uuid is the anchor identity every card/sidecar resolves against (`resolveTextRangeByAnchorId`, the marginalia/panel derivations, `assignUuids` on save), so a card anchored to the source could resolve to the MOVED text and the next save's dedup had to pick a winner.

> **After a relocation, exactly one live presence may answer to a given `uuid` (or inline-atom id) — and the identity belongs to the TEXT.** A block the cut consumed ENTIRELY hands its id to the moved copy; a block the cut only PARTIALLY consumed keeps it at the source, and the moved fragment is a new presence that mints fresh.

The SSOT is [src/lib/tiptap/node-identity.ts](src/lib/tiptap/node-identity.ts) (`collectBlockUuids` / `collectAtomIds` / `remintCollidingIdentity` / `inheritBlockUuid`), and five rules it earned — the last three of them from an adversarial pass on the *fix*, each a way the cure reproduced the disease:

- **Ask "did the source survive?", not "which end was partial?"** The two cases differ only in whether the source presence outlives the cut, which is exactly what a COLLISION test answers — so the mover stages the deletion, reads the ids still live at the destination, and re-mints only what would clash. No reasoning about open depths or join semantics, and a clean move returns the payload array unchanged. This is the **dual** of `stack-pull.ts`'s unconditional `withFreshUuid`/`withFreshAtomIds`: a pull is paste-as-new (the source always survives → every id fresh), a move is relocation (it usually doesn't → ids travel). Same axis, read two ways, which is why both share the collectors.
- **A NET is not a MECHANISM.** [`BlockUuidBackfill`](src/lib/tiptap/block-uuid-backfill.ts) already guaranteed unique block uuids for every insertion — and could not have fixed this, because it sees only *that* two blocks collide, never which one the user meant. Its tie-break is document order, which for a range move is the empty residue: it keeps the identity and re-mints the moved text, silently detaching every anchor from its own words. So a relocating gesture states identity before dispatch and the net catches what no mechanism declared — the same division of labour as the container fit above.
- **"The schema permits it" is not "it was residue."** `dropEmptiedSourceBlock` sheds the block the cut emptied, and the first version gated that on `isTextblock` + `Node.canReplace` — which answers *is the parent still valid without this child?* For a whole family of textblocks the answer is yes while their EXISTENCE still carries meaning their text does not: `alignedGlossRow` is `glossCell*`, so dropping an emptied gloss cell shifts every column to its right against the other tiers and silently destroys the interlinear alignment (a `\gla` measured at 2 cells against a 3-cell `\glb`); a `proseGlossRow` is the whole `\glft` line; a `heading` is the section, its outline entry and its fold; a `titleField` is `\title{}`. No schema-derived predicate separates those from prose — a `glossCell` is even its parent's default type — so the rule asks the narrow question it can answer honestly: **is the shell the plain `paragraph`, with every attribute but `uuid` at its default?** A wrongly-kept empty paragraph is visible and one keystroke to fix; a wrongly-removed gloss cell is silent corruption. `canReplace` and a `protect` veto (the drop's own insert point) remain as the second and third guards.
- **Shedding a shell TRANSFERS its identity; it must never destroy it.** `rangeSliceToBlocks` handles a range inside ONE textblock — the commonest form of the gesture — by building a brand-new `paragraph.create(null, …)`, so the source uuid is not on the payload at all. That was harmless only while the emptied block survived to hold it; the moment the residue is shed the identity is carried by nothing and leaves the document, orphaning every card anchored to it. Which is *the same anchor detachment this law exists to prevent*, arriving from the opposite side. So `inheritBlockUuid` stamps the freed id on the payload's first null-uuid node (outermost first, since the container fit may have wrapped it), and the collision pass then sees a free id and keeps it. Cross-editor drops deliberately do NOT transfer: uniqueness is a per-document invariant and a main-doc id means nothing in a card body.
- **A branch with nothing to inherit does not shed.** The inline-cursor move dissolves its run INTO an existing block, so no payload block exists to receive a freed identity — shedding the shell there would delete the uuid outright. It is left exactly as L3f-2 shipped it, which is the law applied, not an exemption from it. (And its no-re-mint is *not* because "the open slice's boundary blocks never materialize" — with a range whose ends share a container they do. What keeps it collision-free is that a text-bounded `tr.delete` joins BACKWARDS, so the id that survives at the source belongs to the block that merges away here. That is a property of the delete, not of this code, so the guarantee rests on the net — which is what a net is for. Stating the true reason matters more than stating a tidy one.)

And the reason the net was silent rather than merely wrong: **its coordinates were per-transaction where they had to be per-step.** It read every step's positions against `trk.before` and mapped them through the FULL `trk.mapping`, re-applying earlier steps' maps to positions that already reflected them. For the delete-then-insert shape *every* relocation uses, that collapses the inserted range to nothing when the insert lands BELOW the cut — zero candidates, no backfill, a duplicate in the document, CI green. (An insert ABOVE the cut mapped correctly and did fire, which is why the defect looked direction-dependent — and why that direction shipped the *other* failure, the moved text re-minted and the shell keeping the id.) It now reads `trk.docs[si]` and `trk.mapping.slice(si)`. This is the same law the `DocStructureObserver` learned about multi-step transactions; a third copy of it should fold onto one primitive rather than re-derive.

**The range stays the step's own SPAN, never the ranges its `StepMap` reports** — a tempting simplification that would have retired the `instanceof ReplaceStep | ReplaceAroundStep` filter, and a live regression. A `ReplaceAroundStep`'s map covers only its two side ranges and deliberately omits the GAP: the preserved content that changes *parent*. Anchorability in the backfill is a function of the parent (`isDeferredInnerParagraph`), so a paragraph LIFTED out of a `listItem`/`blockquote` becomes a first-class text object entirely inside that gap — and read from the map alone, every toggle-list-off, toggle-blockquote-off and Backspace-at-list-start left the lifted block with a null uuid, hence no `data-uuid`, hence no grab handle and no anchorable target. Verbatim the bug the plugin exists to fix, on a plugin mounted on every surface.

Contracts: [range-move-identity.test.ts](src/components/drop-mode/__tests__/range-move-identity.test.ts) runs the spec against the real schema with **no plugins mounted** — deliberately, since a spec that needed the net to be correct would be letting the net's document-order tie-break decide the semantics — and covers the whole-block move, the partial-cut re-mint, the single-block identity transfer, and the two shells that must survive (a `heading` at default attrs, a `glossCell` whose row is `glossCell*`). [block-uuid-backfill.test.ts](src/lib/tiptap/__tests__/block-uuid-backfill.test.ts) pins both directions of the per-step fix (a duplicate inserted below the cut is re-minted; a whole-block move below the cut still keeps its id) plus the lifted-block gap case. Every one of them fails on the implementation it was written against.

### The return half: what an excerpt card holds must be able to come back

Same law read backwards (task 106). `bodySchema: "excerpt"` says a card body holds a verbatim slice of the document — which means it holds the ONLY copy of prose the capture deleted. The capture direction has been guarded since 308; the return direction had **no user-reachable path at all**: `ArchivePanelProps` declared `onInsert`/`onRestore`, `EditorPane` built handlers, `ArchiveHost` passed them, and `ArchivePanel`'s parameter list never destructured them. Archived text could be edited, jumped-to and deleted, never put back.

> **A capability declared on a card body is an obligation on both directions. Un-archiving is a MOVE: the content lands in the document FIRST, and the card that held it retires only on the strength of a report that it landed.**

Four rules, mirroring the capture side's:

- **The affordance is DERIVED from the same facet as the guard.** `isExcerptCardKind` ([predicates.ts](src/cards/predicates.ts)) gates the restore control, so the declaration that makes the capture legal is the declaration that makes the return reachable — a future excerpt kind inherits both. `EditorPane`'s handler map is pinned to `excerptCardKinds()` by a boot assertion (a compile error where membership is a type union, as with `atomCards`; `bodySchema` is a runtime facet, so it is asserted instead).
- **A card action is a CONTEXT, not a prop.** [card-restore-actions.tsx](src/panels/_shared/card-restore-actions.tsx) mirrors `card-archive-actions.tsx`: `EditableCard` consumes it directly, so the wiring cannot dead-end in a component that forgot to read it. Types prove a prop was *passed*; nothing proves it was *used*, and the panel that drops it type-checks exactly like the panel that renders it. CI: [dead-panel-prop-guardrail.test.ts](src/panels/__tests__/dead-panel-prop-guardrail.test.ts) flags any `*Props` member with no second occurrence in its own file — `src/panels/**` is drained to EMPTY; the pre-existing host-layer census is pinned so it can only shrink. A hit is WIRE-it or DELETE-it, never an allowlist entry.
- **The report is the permission.** [`restoreExcerptAtCaret`](src/lib/tiptap/restore-excerpt.ts) validates against the **live** editor schema (the dual of `canMountInCardBody`) and then checks the document actually changed — because `insertContent` swallows a mismatch exactly as `createNodeFromContent` does, so `void` looks identical for "restored" and "destroyed". `useArchive.restoreSnippet(id, land)` **takes** the landing function rather than returning the snippet, so there is no ordering for a caller to get wrong; the two old handlers dropped the entry either side of a call that could silently no-op.
- **AT the caret, never OVER a selection — and only where a split is ordinary.** `insertContent` replaces a non-empty selection, so restoring with prose selected would delete that prose (the same destruction, aimed at a different victim); anchoring at `selection.to` makes it purely additive. And a caret insert *splits the block it sits in*, which is ordinary editing in a top-level `paragraph` and silent corruption everywhere else — inside an `exampleItem` it splits the example in two, inside a `glossCell` it destroys the interlinear alignment, inside a `heading` it mints a phantom section — all of which still change the document, so the landed-test reports SUCCESS and the caller retires the only copy. This door is invisible to `container-fit-guardrail` (which censuses `src/components/drop-mode/`), so it carries its own check: refuse unless the caret is in a plain top-level paragraph. Conservative by choice — a rule verifiable by construction over a probe that must be trusted; the general form is `bareInsertTearsContainer` parameterised by the depth that may split, worth folding onto one primitive at the second caret-shaped splice.
- **Retiring is SET-ASIDE, not delete.** The document insert is an undoable history entry; the sidecar write is not. Delete the entry and the user's next Cmd+Z — the natural key when an excerpt lands somewhere unintended — pulls the prose back out of the document with nothing left in the Archive: gone from both, no undo remaining. So the card flips `archived` (the reversible per-card axis every kind already has). The same choice drains the durability race, since the sidecar's 300 ms write no longer outruns the document's 1500 ms autosave into a window where a crash loses both halves.

**Two doors, one queue** — the persistence half, and the reason the bug had a second life. `usePersistentState` exposes `update()` (coalesced through a 300 ms debounce) and `persist()` (write now), and only the first owned the queue: an immediate write could be OUTLIVED by an older scheduled payload, which flushed afterwards and **resurrected on disk** what had just been removed, with in-memory state and the sidecar permanently disagreeing until the next edit. That is a PRIMITIVE hazard rather than one caller's slip — it is inherent to two write doors where one owns the queue — so `persist()` now cancels the pending timer and drops the stale payload, once, for every caller, and stamps the loader-stomp flag *after* the two guards that can make the write not happen (stamping it for a suppressed or dropped write would hide the sidecar for the whole session). Scope, stated honestly: the sidecar hooks with their own bespoke `persist` (`useFootnotes`, `useExamples`, `useAiRequests`, `useBibReview`, `useStack`, `useEditorUIState`) do **not** go through this door; among this hook's consumers only `useSuggestions.clearSuggestions` still calls it directly. Prefer `update()` regardless; `persist()` is for a read-then-write that needs the computed value back synchronously, and it cancels rather than merges, so its payload must already reflect any `update()` issued before it. Contracts: [archive-restore-contract.test.tsx](src/hooks/__tests__/archive-restore-contract.test.tsx), [restore-excerpt.test.ts](src/lib/tiptap/__tests__/restore-excerpt.test.ts), [card-restore-affordance.test.tsx](src/components/__tests__/card-restore-affordance.test.tsx).

### The transport half: content that references PER-DOC state carries it, whatever payload it rides

Same law across DOCUMENTS (task 235). The Stack is deliberately cross-document scope, so a pull into a different doc is a first-class flow — and a `\cite{smith2020}` means nothing there on its own: `references.bib` is per-doc and bib-review annotations live in a per-doc `annotations.json` sidecar, so no global resolver rescues an unknown citekey. Whatever a payload references has to travel with it.

The CARD family did (task 069): `snapshotCard`'s citation/bibliography arms resolved bib sidecars through a `CardSnapshotCtx`, and `applyCardDrop`'s citation branch upserted them. The three CONTENT families — a text slice, a paragraph, a heading section — did not, although the remint code's own comment (task 138) names them as *the headline case for atoms riding a slice*. Same gesture, same atoms, one family bib-complete and three silently not: the pulled `\cite` landed with no entry in doc B's `.bib` (a LaTeX undefined reference) and the source's note gone. Nothing failed; every id was correctly reminted on the way.

> **A payload that can carry a reference carries what the reference needs — resolved ONCE at the single ADD door and discharged ONCE at the single PULL door, both blind to which payload family they are looking at.**

[src/lib/stack/bib-carry.ts](src/lib/stack/bib-carry.ts) is that seam (`collectCiteKeys` → `buildBibCarry`/`withBibCarry` → `applyBibCarry`), and `StackItem.bib` is the ONE carrier — the per-card `bibEntries`/`bibAnnotations`/`annotation` fields are DELETED from `StackCardSnapshot`, not left beside it, because a field the type still has is a field a future writer can populate, re-forking the carrier (the "delete the stored copy" rule, one medium over). `normalizeStackItemBib` lifts them off a persisted blob at `readEnvelope` — the ONE read door the hook, its cross-window re-read and `readStackItem` all share — so no consumer downstream ever sees the old shape and the pull side needs no legacy branch. Four rules it earned:

- **The keys are DERIVED from the content, not enumerated per payload kind.** The collector walks the payload as plain JSON and reads every `citation` node's `command` at any depth in any field — so a cite inside a footnote body (`attrs.content`, the one place a schema walk would not enter), inside an example, or inside a note card's body is reached by the same pass, with nothing to add when a new payload shape ships. The per-kind switch that remains covers only what a card *declares* rather than *contains* (a `CitationRef`'s `keys`, a `BibEntry`'s own `key`) and is exhaustive, so a new stackable kind must state its answer. And the key is read off the atom's `command` — the same derivation the DESTINATION uses (`useCitations.syncFromEditor` rebuilds every `CitationRef` with `parseCiteCommand`), rather than through the source's citations sidecar, which could carry a set the destination never asks about.
- **The obligation sits on the DOOR, not in the helpers.** `addStackItem(item, bib)`'s second argument is REQUIRED, and the hook's unused `add` was deleted rather than given the same signature — a second add door is a door someone reaches for without the obligation. This is the half a per-helper `CardSnapshotCtx` structurally misses: `StackIcon`'s HTML5 `MIME_TEXT_INSERT` drop hand-builds its payload and never touches `lib/stack/snapshot.ts` at all. **The original defect was not a wrong snapshot helper; it was a producer that never asked.** A doc with no bibliography answers with resolvers that resolve nothing — an answer; there is no default to omit, because "this doc has no bib" and "someone forgot to wire it" must not look the same.
- **Discharge by WRAPPING the resolved plan, so no branch can be forgotten** — `withBibUpsert` wraps whatever `planDrop` resolved, inside `commit` (a plan is pure and runs twice per gesture, so an upsert in the plan would fire on the classify pass too) and BEFORE the payload lands, so a pulled cite is never momentarily dangling. **A carry that cannot be discharged REFUSES**: with no `ctx.stack` the pull is a `no-op` decision rather than a landing that reinstates the dangling `\cite` — decline-don't-fall-back, and a pull is a copy, so refusing costs nothing.
- **ONE conflict rule for both halves: what the destination already has, it KEEPS** — and the adversarial pass on this fix is what earned it, because the first cut had the two halves resolving a conflict in opposite directions. `upsertBibEntry` is insert-if-absent by its own contract, so on a known citekey the destination keeps its own `BibEntry`; an annotation written over the destination's would then describe *the entry that was discarded* — on a work that may merely share the key, since author-year citekeys collide across papers routinely — replacing authored prose in a sidecar write with no undo and no warning. So `applyBibCarry` reads before it writes (`BibCarrySink.getAnnotation`, a REQUIRED `StackPullApi` member): a carry exists to make a pulled `\cite` **resolvable**, to fill an empty slot, never to restate doc A's bibliography over doc B's. That also makes a same-doc pull write nothing at all — `usePersistentState.update` bails only on referential equality, so re-writing a byte-identical note would still schedule a persist.
- **A key the SOURCE could not resolve is not invented.** The source was already dangling there; the annotation still travels, because it is the one artifact the destination could still use.

CI: [bib-carry.test.ts](src/lib/stack/__tests__/bib-carry.test.ts) (the seam, including the two task-069 contracts re-expressed at the add door — it replaces `snapshot-bib-annotation.test.ts`, since the helper is a pure serializer again), [stack-content-bib-carry.test.ts](src/components/drop-mode/__tests__/stack-content-bib-carry.test.ts) (**the defect leg**: REAL snapshot → REAL add door → REAL `applyDrop` into a SEPARATE destination editor, for text/paragraph/heading and the nested-footnote-body case, each asserting the cite actually landed so no leg passes on a refusal), [stack-pull-bib-annotation.test.ts](src/components/drop-mode/__tests__/stack-pull-bib-annotation.test.ts) (069's restore half + a pre-235 persisted blob + the destination's own note surviving), and [stack-add-door.test.ts](src/hooks/__tests__/stack-add-door.test.ts), whose **census** is the leg with teeth — the door was never the part that could misbehave, a second write door that bypasses it is, and that is exactly what a required argument cannot see (nothing but `useStack.ts` may write the envelope; `addStackItem`'s signature is pinned by SOURCE as well as arity, since `bib?:` erases at emit and reports the same `Function.length`). One leg's shape is load-bearing and its first draft was wrong: the refusal `withBibUpsert` owns must be pinned against a **content** payload, because for a CARD payload `planCardDrop`'s own pre-321 `if (!stack) return null` refuses first — a card-shaped leg asserts the right verdict for the wrong reason and would stay green with the new refusal deleted, so it carries an accepting control beside it.

**Scope, honestly.** This carries the BIBLIOGRAPHY, which is the reference a `\cite` needs. A pulled footnote/citation ATOM still lands as an atom whose panel-side record the destination re-derives, and other per-doc state a payload might reference (a `\ref` label's target, a figure's raster) is untouched — those are different questions, not a fourth divergence of this one, and each would enter through the same collect→carry→discharge seam rather than beside it.

#### The fidelity half: rebuild FROM the record and SUBTRACT, never copy INTO an empty one

Same gesture, and the case where the payload was complete at every link of the chain and lossy at the last inch (task 330). The transport half above asks whether a pull carries what its content REFERENCES; this one asks whether it carries the content itself. It did not: **every stackable kind lost at least one field the user had typed.** A note's `title` — and, because `useNotes.addNote` hard-sets `titleAuto: true`, the new record also claimed the title had never existed, so "never titled" and "title lost" became the same card. A todo's `notes`, which the seed TYPE (`{ text?: string }`) could not even express, so no host could have delivered it however carefully written. A revision/cutter suggestion's `user_text` (the human's OWN rewrite, and the field the apply path prefers — `replacement = user_text or suggested_text`) plus its `instructions`, with `author` hard-coded `"human"` on a record the AI may have written. Nothing warned, and the Stack thumbnail previewed the very `user_text` the pull then discarded.

`snapshotCard` deep-clones the whole record and `planCardDrop` passed most of it whole, so the loss was not in the capture or the transport. It was in the **direction of the materialization**: the ONE host implementation (`EditorPane`'s `dropStackApi`) started each card from an EMPTY record and hand-copied a few names into it.

> **A per-kind materialization never hand-picks fields out of a full-record snapshot. It rebuilds FROM the snapshot and SUBTRACTS — so a field arrives unless someone stated a reason it must not.**

The direction is the whole fix, and the reason is about what each shape can be REVIEWED for. A copy list omits *silently*: an omitted field looks exactly like a field the record does not have, which is why four separate omissions sat unnoticed from the Stack's landing commit (`c4f95034`) and why the one arm that carried a title (archive's) still got it wrong — it routed through `updateSnippetTitle`, which stamps `titleAuto: false`, so the title arrived claiming a human had typed a machine default. A subtraction list is a finite set of decisions, each written down and readable back.

[src/lib/stack/pull-seed.ts](src/lib/stack/pull-seed.ts) is that list — `NON_TRAVELLING_FIELDS` + `pullSeed(kind, data)`. Five rules it earned:

- **The table is checked against the record TYPE, so its two rot modes are compile errors.** It is `{ [K in StackCardKind]: readonly (keyof SnapshotData<K>)[] }`: a name that is not a field of that kind's record fails to compile, and a new stackable kind with no entry fails too. That closes the dead-facet hazard (202/227) by construction rather than by a census — worth contrasting with `CARD_REGISTRY.footnote.content.textFields = ["title"]`, which names a field `FootnoteRef` does not have and is *honest anyway* (the content model is fed a composed `{ content, title }` built from the atom's node attrs). `CardMeta.content`'s doc claimed that existence was "pinned by `assertContentCoverage`"; it is not and cannot be, and that sentence was retired rather than left standing.
- **Three reasons a field stays behind, and nothing else counts as one:** identity (`id`/`createdAt`/the `kind` discriminant), per-doc bindings (`links`, `selectedText`, `unanchored`), doc-bound lifecycle (`archived`, `aiRequest`, `status`, `appliedChange`, `originalAnchor`). Dropping `status`/`appliedChange` is load-bearing rather than tidy — an applied suggestion's `appliedChange` binds a LIVE range in the *source* paper's `.tex`, so a copy claiming `applied` would offer Keep/Revert over a splice this document has never had ("The lifecycle half"). The one EMPTY entry is `bibliography`, and it is a decision rather than an omission: a bib entry travels whole through `upsertBibEntry`, the same insert-if-absent sink `applyBibCarry` already feeds with source-doc entries, so stripping its `uid` on the card path while the carry path keeps it would be a fork wearing a fix's clothes.
- **Provenance travels WITH the content it describes.** `titleAuto` and `author` are facts about the words that arrive, so a pull that delivered the words and dropped the flags would deliver a record that lies about itself. This is also why the fix is a spread and not a per-field setter: `updateNoteTitle`/`updateSnippetTitle` *re-decide* provenance they have no business re-deciding.
- **A narrowed seed type is a field nobody can deliver.** Every `StackPullApi` factory now takes the whole `PullSeed<K>`, and each hook grows one `…FromSeed` door that spreads it over a fresh record. The doors ask the registry's own content model for their pristine gate (`cardHasContent`) rather than "is the body empty?", because a pulled note whose only content is its TITLE — or a todo whose only content is its `notes` — was real user writing that the body-only gate discarded on the next click-away, losing it a second time one layer down.
- **The strip is a DENYLIST, stated as such.** An unknown key from a blob written by another build spreads through onto the new record. That is deliberate: an allowlist is the per-field hand-enumeration this deletes, and an unknown key is inert where a dropped known one is lost writing.

CI: [pull-seed.test.ts](src/lib/stack/__tests__/pull-seed.test.ts) pins the FLOOR (every field `CARD_REGISTRY[k].content` declares survives the strip — derived, so a new content field is covered by declaration alone) and the CEILING (no identity, binding or lifecycle survives), over fully-populated per-kind fixtures whose completeness is itself asserted, since a fixture that stopped populating `notes` would make the floor pass vacuously. [stack-pull-seed-doors.test.tsx](src/hooks/__tests__/stack-pull-seed-doors.test.tsx) drives the REAL hooks, because three of the four losses were caused by hook behaviour no host could see from outside. And [stack-pull-content-fidelity.test.ts](src/cards/__tests__/stack-pull-content-fidelity.test.ts) is the leg with teeth, aimed at the HOST — the factories were never the part that could misbehave, a call site that picks fields out of the seed instead of forwarding it is, and no type can see that (`notesHook.addNote(paragraphId, seed.content)` type-checks perfectly and IS the defect). Its census allows exactly two exempt lines, marked per LINE with their reason — footnote and citation, whose entire travelling set is one field the hook re-derives the rest from. Measured on the pre-fix shapes, the spec leg and the census each fail.

**Stated limits.** A footnote's `title` cannot be pulled at all: it lives on the atom's node attrs and never reaches `FootnoteRef`, so the loss is at the CAPTURE, one layer before any of this — recorded as the fidelity suites' single `UNCARRIABLE_CONTENT_FIELDS` entry rather than relaxed inside an assertion, and closing it means teaching `snapshotCard` to take the atom's title, at which point the suites demand it back. And the revisions/cutter seed doors are twins, which is the pre-existing fork filed as task 201 — not something to unify inside this one.

## Transient state is never document content

> **A view-only signal painted over the document — a search hit, a diagnostics error range, a hovered card's anchor, a quoted revision — is a ProseMirror DECORATION replaced by a meta-only transaction. Never a mark, never a node attribute the document carries.**

This is the "clicking a search result ate my redo stack" class (task 120). Marks look like the obvious carrier and are wrong in four ways at once, none of which points back at the call site:

- **History.** A mark-add is a history entry, so painting a band clears the redo branch — undone edits become unrecoverable. And the *clear* is a recorded doc-changing transaction too, so the first Cmd+Z after the band goes away UNDOES the clear and **resurrects** it, with the producing panel already closed and nothing left to clear it again.
- **Dirty/autosave.** A mark tx is `docChanged`, so it arms the `useDocument` autosaver: a mere hover writes an unedited document to disk and exercises the disk-ledger / DiskWatcher machinery for a no-op.
- **Scope.** A mark can't be scoped to "the transient one" — clearing means selecting the WHOLE doc and unsetting *every* highlight, so a real authored highlight is collateral. It also forces the SELECTION onto the range to apply at all, which is where the grey inactive-selection ghost (and its restore-the-caret workaround) came from.
- **Capture.** A mark is content, so a card that captures a document slice captures the band with it.

The carrier is [src/lib/tiptap/transient-highlight.ts](src/lib/tiptap/transient-highlight.ts) (`setTransientHighlights(view, targets)` / `clearTransientHighlights(view)`): idempotent, send the COMPLETE desired set per frame, `[]` clears, and the clear-when-already-empty bails without dispatching. Its node/atom-attribute sibling is `AnchorHighlightDecorator` ([anchor-highlight-deco.ts](src/lib/tiptap/anchor-highlight-deco.ts)) — same meta-only shape, different geometry (`Decoration.node` for whole blocks and inline atoms; `Decoration.inline` here, because a partial-block text band has no node to hang on). Both are keystroke-sane by construction: rebuild only on their own meta, `DecorationSet.map(tr.mapping, tr.doc)` otherwise.

CI: [src/lib/\_\_tests\_\_/transient-highlight-guardrail.test.ts](src/lib/__tests__/transient-highlight-guardrail.test.ts) greps `src/` AND `library/` for `.setHighlight(`/`.unsetHighlight(`/`.toggleHighlight(` and asserts the flagged set is EMPTY (`PERMITTED_HIGHLIGHT_MARK_WRITERS`; the library twin likewise). The `highlight` mark stays registered in the schema so a genuinely *authored*, persisted highlighter can still be built — that would be a legitimate allowlist entry with its justification. The behavioral contract (no history entry, no `docChanged`, no `onUpdate`, band survives an edit by mapping, dies with its text) is pinned in [src/lib/tiptap/\_\_tests\_\_/transient-highlight.test.ts](src/lib/tiptap/__tests__/transient-highlight.test.ts) against the real main extension stack.

## A preservation guard may not restore the removal itself

> **A guard that reverts a user's removal must never leave the document
> BYTE-IDENTICAL.** Where its remedy reproduces exactly what vanished, the guard
> has preserved nothing — it has VETOED the gesture, silently, permanently, with no
> feedback and no user-reachable escape. Ask the literal question
> (`removed.eq(replacement)`) rather than a proxy for it, and fail OPEN.

This is the "Backspace does NOTHING and only the grab-handle delete works" class
(task 367), and its lesson is that the defect lived in a guard whose *contract* was
right and whose *implementation of the exception* was one caller's meta.
`MarginaliaAnchorGuard` ([linked-anchor.ts](src/lib/tiptap/linked-anchor.ts))
re-inserts `paragraph({ uuid })` when an anchored uuid-bearing block vanishes, so a
card's Mode-A anchor survives an incidental edit — correct, and load-bearing. Its
one exception, `LIFECYCLE_DELETE_META`, is spelled by exactly two callers (the
grab-handle Archive / Delete actions). So the contract reads *incidental vs
deliberate* and the code reads *grab-handle vs everything else*, and a Backspace
aimed squarely at a block is classified incidental.

That is invisible for a NON-empty block (the remedy drops the content, so the
gesture visibly did something). It is total for an EMPTY uuid-only paragraph: the
remedy IS the removed node, so the document is byte-identical and the key is dead
for every press, forever. And those husks are the guard's own output — a block the
guard resurrected once is an invisible, undeletable husk from then on. A stray
`%!v:XXXX` anchor line in the `.tex` parses to exactly this node, which is how
Gabriel met it twice in one paper.

Four rules it earned:

- **The predicate IS the law.** `removed.eq(paraType.create({ uuid }))` asks
  "would re-inserting reproduce what vanished?" — type, attrs, marks and content in
  one call. No hand-listed conditions, and it follows automatically if the remedy's
  shape ever changes. An empty paragraph carrying a `parTitle` is correctly NOT this
  case: the title is visible, so dropping it changes the document.
- **Fail OPEN, and re-check the identity to make that honest.** A position that
  reads back as nothing, or as a node whose uuid doesn't match, resurrects — a
  needless resurrection is the status quo, while a wrong stand-down orphans a card.
  Without the uuid re-check a stale position would silently compare the WRONG node.
- **Standing down is not data loss, because the sweep was already correct.**
  `TextObjectOrphanGuard` re-reads the SETTLED doc in its deferred pass, so a block
  this guard declined to resurrect is genuinely gone and its event fires: the card
  lands in the orphan strip, re-pinnable — precisely the outcome the one
  user-reachable deletion path already produces for the same block.
- **The isolating-boundary hypothesis was FALSIFIED and is pinned as such.** The
  filed diagnosis blamed PM's `findCutBefore` refusing to cross `isolating`, so that
  both `joinBackward` and `selectNodeBackward` return false. Measured against the
  real stack, `selectNodeBackward` node-selects an isolating sibling perfectly well
  and the two-press select-then-delete affordance works at every isolating edge — so
  no shared boundary handler was added, and a suite leg keeps that from being
  "fixed" again. *Verify a phenomenon is general before generalizing the fix.*

**Decided, with its evidence:** a comment line that is only an anchor KEEPS minting
its empty block. The uuid is a card's anchor identity, so dropping it at parse time
would orphan the card on every load with no user gesture at all — strictly worse
than the husk, which is now deletable.

**The premise is confirmed against the reporting paper, not only reproduced
synthetically.** Both reported uuids are live Mode-A anchors in that paper's
`virgil/revisions.json` — `3be5` on one revision card, `c194` on two — which is
exactly the condition this guard fires on. Two details corroborate the fix's
outcome. The husks themselves are now GONE from that `.tex` while those cards still
name them, i.e. Gabriel already removed them the only way that worked (grab-handle
Delete) and already accepted the orphaning this fix produces. And the THREE husks
live in it today (`2d33`, `4a3b`, `f0c5`) are named by no sidecar at all — so they
were always deletable, which is why the defect reads as intermittent: whether the
key works depends on whether a card happens to anchor that husk.

CI: [anchored-empty-block-keyboard-delete.test.ts](src/lib/tiptap/__tests__/anchored-empty-block-keyboard-delete.test.ts).
Every leg drives `view.someProp("handleKeyDown", …)` on the REAL
`buildEditorExtensions("main")` stack, and that is the whole point — the
pre-existing [anchored-block-delete-reinsert.test.ts](src/lib/tiptap/__tests__/anchored-block-delete-reinsert.test.ts)
characterizes this guard thoroughly by dispatching `tr.delete` DIRECTLY, where the
remedy is a real change and the defect is **unrepresentable**. It only appears when a
real keystroke removes a block that was already the husk. Measured by neutering the
predicate: 5 defect legs fail, the 7 control and non-regression legs pass either way.

**Owed, not claimed:** a real-FSA eyeball on Gabriel's own `.tex` geography — this
class is FSA-masked (the husks come from a paper's stray anchors), so the durable
proof here is the unit contract.

## Addressing the live document across an async gap

> **A surface that renders from a SNAPSHOT and writes on a later gesture names its target by durable IDENTITY, never by position.** The vocabulary is [src/lib/tiptap/block-address.ts](src/lib/tiptap/block-address.ts) — `BlockAddress` (`uuid` + a pre-hydration `index` fallback), `BlockSpanAddress` (+ `section`), resolved against the LIVE doc at apply time by `resolveBlockIndex` / `resolveBlockSpan`.

This is the "the drop rearranged a different section" class (task 285, the T3 residual). The Outline renders from a debounced `content` snapshot and calls back a frame or more later; between the render that produced the row and the gesture that consumed it, a concurrent writer — Gabriel typing a block insert, an AI `apply_response`, a second window — can add or remove a top-level block ABOVE the target. Every index below the edit shifts, so the reorder moves the wrong section and the click scrolls to the wrong heading. Nothing throws, the document stays well-formed, `doc.check()` is clean; only the content is wrong. T3/W3a fixed exactly this for rename / parTitle / label (`editStructuredNodeByUuid`); reorder, scroll and the three focus-band writes never made the migration, so the panel spoke two addressing models at once.

Four rules it earned:

- **A HYDRATED address resolves by uuid and ONLY by uuid.** A uuid no longer in the document means the block was deleted under the gesture, and the resolve REFUSES (`null`) rather than degrading to the index it travelled with — falling back turns "the thing you clicked is gone" into "so here is a different one," which is the mis-address the module exists to prevent.
- **An UNHYDRATED address degrades for a READ and is REFUSED for a WRITE**, and the asymmetry is the point: the navigation door and the destructive door want opposite fail-safes, so one shared "degrade gracefully" would be a decision nobody made. `resolveBlockSpan` is the strict door — a span is only ever produced by an outline pod, and a pod with no uuid is exactly the case `handleRename` already refuses. This half was WRONG in the fix's first cut, which let the splice degrade positionally on the strength of a stated precedent that does not exist ("the same graceful degradation the rename path chose" — rename refuses). Stating a precedent that isn't there is how the next producer decides an un-hydrated address is safe. The reachable uuid-less producer, since "rare" deserves a name: the legacy `\partitle{X}` parser branch emits an EMPTY top-level paragraph, which `assignUuids` skips and which reaches TipTap through the `content` constructor option, firing no `appendTransaction` for `BlockUuidBackfill` to run in — and that pod is draggable.
- **An EXTENT is re-derived live, never carried.** A heading pod owns its whole section, and the snapshot's `blockCount` is stale in the same way its `blockIndex` is — worse, it is stale under an edit INSIDE the section, which no amount of correct index addressing would catch. So `BlockSpanAddress` carries `section: boolean` and no count at all, and the landing index is computed from the TARGET's live extent too (the pre-285 `landingBlockIndex` folded the target's stale count into the integer it handed over, so a write inside the target section mis-landed the drop even when the source addressed correctly).
- **The affordance may ask the snapshot; the WRITE asks the live doc — and the write refuses one case MORE.** The indicator and its own-range rejection run on the snapshot pods (they must: they paint against what the user sees); the handler re-checks against the resolved spans, off the same shared predicates (`isInsideOwnRange` / `isNoOpLanding`, [outline-drop.ts](src/panels/Outline/outline-drop.ts)) so neither side hand-writes the rule. The extra case is a landing on either BOUNDARY of the dragged run: the write refuses it, because dispatching a delete-and-reinsert that changes nothing costs a history entry and an autosave for a gesture with no effect, while the indicator deliberately still lights it — a section dropped back where it already is leaves the document exactly as the user intended, so the lit line is honest, and going dark there would paint a forbidden-looking band around the dragged section's own position. That is NOT the 083 false-affordance class, which is a line promising a change and delivering none; the adversarial pass on this fix proposed folding the two predicates into one, and the pre-existing suite had already pinned the answer.
- **The section rule is spelled once.** "A heading owns itself up to the next heading of the same or a higher level" had FOUR copies — the pods' `blockCount`, `sectionRange`'s heading branch, the outline's per-section word count, and the live walk the reorder needed. (Three, until the adversarial pass found the fourth still hand-written 700 lines below one of the converted ones, in the same file, while this section claimed "spelled once". A count is a claim like any other.) It is now `sectionExtentFromHeadings` with two adapters — a `(index, level)` list and a doc (`sectionExtentAt`) — because the indicator paints from the snapshot copy while the drop lands by the live one, so a disagreement between them is a line that lies about where the blocks go.

**What crosses the boundary, and what deliberately doesn't.** All five Outline write/navigate callbacks now take addresses: `onScrollTo` (`null` = the Document-start row), `onReorderBlocks(source, target, side)`, and the focus band's `onFocusMoveTo` / `onFocusExpandTo` / `onFocusSnapBoundary`. The focus engine was the subtle one, and its conversion took two passes. It STORES uuids (`FocusBand`), so the row index the outline handed it looked like the single stale input — but resolving that index live while still interpreting it against a heading list threaded in from a render-time `useMemo` leaves two clocks, which is a milder form of the same drift. So the three write actions take an address and NOTHING else: [`regionForAddress`](src/hooks/useFocusMode.ts) derives the heading list from the same live doc it resolves the address against, and `useFocusActions` no longer threads a list into them at all. `FocusBandRow` is itself a `BlockAddress` plus its three offsets, so the row the edge snaps to IS the thing the commit hands over. Two addresses stay deliberately positional and say so at the site: the **Document-start** row (`{ uuid: null, index: 0 }` — "whatever block is first" is a positional fact that survives an insert above by definition) and `resolveDragCommit`'s moved-test (both sides come from the outline's own snapshot, so they describe one revision; what crosses the gap is the commit, and that carries the address).

**Residuals, stated.** `focusMode.activate`'s `currentSeedBlockIndex` is still an index. It is not a captured row — it comes from the section-path recompute, which re-runs on scroll and (unless `disableTier1B` is set) on update — but the gap is narrower, not absent: the value a click reads is whatever the last RAF wrote. `SectionPathEntry` carries no uuid today, which is what closing it would take. The same field's OTHER consumer, the position chevron's match against the outline snapshot's heading indices, is display-only and predates this task.

CI: [block-address.test.ts](src/lib/tiptap/__tests__/block-address.test.ts) pins the resolver rules (including the read-degrades / write-refuses split at the two doors) against a doc that has MOVED since the address was captured — a test against an unchanged document proves nothing here, since the two addressing models agree there by construction. [outline-mutators-address-live-doc.test.tsx](src/components/editor-layout/card-actions/__tests__/outline-mutators-address-live-doc.test.tsx) is the defect leg: the REAL `useEditorOps` handlers against a REAL ProseMirror doc, with the concurrent write applied BETWEEN the capture and the gesture. Measured rather than assumed: neutering rule 1 (resolve by the carried index) fails ten of the two suites' legs, including every reorder and scroll leg whose document moved — the three that survive are the ones testing rule 3 or the own-range guard, which that neuter leaves intact. [focus-region-address.test.ts](src/hooks/__tests__/focus-region-address.test.ts) does the same for the focus band's one entry point — the member with no defect leg at all in the first cut, since `useFocusMode.test.ts` re-implements the action bodies as local helpers and both focus-band-drag suites are snapshot-internal by design. And [outline-address-census.test.ts](src/panels/Outline/__tests__/outline-address-census.test.ts) is the leg with teeth: the resolver was never the part that can misbehave — a PRODUCER that stops carrying the uuid is, and `{ uuid: null, index }` typechecks perfectly while being exactly the pre-285 integer wearing the new type. So `uuid: null` inside the Outline's producers is allowlisted per LINE (not per file — a file-scoped exemption would excuse the next producer added beside it), with a synthetic canary rather than one standing on the lines the allowlist drains.

## A registry earns its name by being read

> **A table that declares per-kind behaviour is an SSOT only if something READS it. A published export is alive only if something CALLS it — and a re-export is not a caller.**

This is the "dead SSOT" class (task 202), and it is worse than having no table at all: the next agent reaches for the declared path believing it is the enforced one. `src/links/` was a phased migration whose read half landed and whose write half never did. `createLink` + its three kind builders sat exported with **zero callers for three months** while real footnote/citation creation went through the atom commands and real anchors through `createLinkedAnchor`. `LINK_REGISTRY` announced itself as "the single source of truth for the Link taxonomy" and no component or hook read it: its `connectorStroke` styled a `<LinkConnector>` hard-deleted in `96675ca1`, its `multiplicity: "one"` was "enforced at runtime in `createLink`" by an `enforceMultiplicity` nobody invoked (and would not have helped: 1:1 holds by construction at CREATE time, since each link mints its own target card id, but nothing re-mints on an in-document copy/paste of an atom — so deleting the unreachable enforcer costs nothing, while calling the property *enforced* would have been a second false claim), and its `cardKind` column was decided in `collectLinksFromEditor`. Two more files said "Phase 0: stub" in the present tense.

**The mechanism that hid it was the barrel.** `links.ts` re-exported the whole subtree, so `enforceMultiplicity`, `LINK_REGISTRY`, `resolveCardKind` and `resolveLinkPanel` each had a "reference" in `src/` and every grep a reviewer would run came back green. So the census in [src/links/\_\_tests\_\_/link-surface-honesty.test.ts](src/links/__tests__/link-surface-honesty.test.ts) strips `export { … } from "…"` clauses — and string literals, since the dead `createLink`'s own throw message (`` `createLink: kind "…" not supported.` ``) was otherwise its only "caller". Imports are deliberately kept (an unused import is a lint error, so an import really is a use). Scope is `src/links/**` value exports; the allowlist is **empty**, and an entry there must justify why a symbol earns its keep with no caller — WIRE it or DELETE it.

What survived the cut is the half that ships: the `LinkKind` union in [src/links/\_shared/types.ts](src/links/_shared/types.ts) is the taxonomy (a union with a doc comment, not a parallel table), and [src/links/link-dom-contract.ts](src/links/link-dom-contract.ts) owns the marker DOM contract — `data-link-id` / `data-link-kind` / `data-link-card` plus the `<cardKind>:<cardId>` grammar. Deleting alone would have left the live half as loose as the dead half was, so the same commit made it load-bearing: **every marker producer emits the attribute names from those constants** (`linked-anchor-attrs.ts`, `footnote.ts`, `citation.ts`, and the drop-mode ghost's clone list, which must mirror them), and **nothing spells a `<cardKind>:<cardId>` token by hand, emitting or querying** — `linkCardKey`/`parseLinkCardKey` do. That second rule is the one with reach: a QUERY that restates the grammar (`[data-link-card="citation:${id}"]`, five sites) breaks by silently not matching, with no type error and nothing to grep. A CSS selector — and a JSX attribute, which has no computed-name syntax — may still write the attribute NAME inline; `globals.css` has no other option.

The prose half is guarded too: no file under `src/links/**` may promise an unbuilt phase ("Phase 2 wires this up", "not yet wired"; lettered phases count, since this subsystem numbers as many with a letter as a digit). A note about what a phase *did* is fine and common. As with every copy check, the regex pins the SHAPE of the promise; only a reader pins whether a sentence is honest.

**Two limits worth knowing before you trust it.** The call census is a bare-name grep with no module resolution, so a dead export whose name collides with a live symbol anywhere in either silo still reads alive — a distinctive name is the only thing standing between a future scaffold and a silent exemption. And `VALUE_EXPORT` reads the `export function|class|const|let NAME` forms only, so `export default`, a bare `export { local }` re-publication, and a destructured `export const { a, b } =` are not censused declarations. Both are known holes with a filed follow-up, not oversights — a guard that overstates its own reach is the failure mode this whole section is about. What the census DOES enforce, it enforces exactly: a suite is not a consumer (`callSites` splits test hits from real ones, because on the pre-fix tree the deleted `cardKindToLegacyAnchorKind` reported fourteen callers, every one of them its own test), and both barrel spellings are stripped — the one-statement `export { X } from "…"` and the split `import { X } … export { X };` that is already the idiom in this very directory.

### The stored-copy half: a LIVE answer is never frozen into a record

Same law, other tense (task 205). "Which side does this card's margin chrome live on?" is a function of where the owning panel is docked **right now** — and it had three hand-maintained answers plus two consumers, only one of which was dock-aware. The marginalia grid resolved `override > panelSides[panelId] > row default` per pass and FOLLOWED the dock; the Mode-A anchor **rail** read `link.anchor.margin.side`, a value frozen into the sidecar at create time by `inferMarginSide` — a hardcoded `report|report-request → left, default → right` switch whose own docstring claimed to read the panel registry and never did. Nothing refreshed the stored side, ever. So docking Notes / Todo / Revisions / Cutter to the LEFT (or Reports RIGHT) put the marker on one edge and the kind-colored rail on the other, against `globals.css`'s own stated intent ("a kind-colored vertical line on the same side as the margin marker"). It read as latent for a year because the two tables agree on every *default*; the bug is that one of them ignores the *dock*.

> **A value that is a live function of app state is resolved at READ time from one authority — never computed once and stored on the record.** A stored copy cannot be wrong at write time and cannot be right afterwards; it drifts silently, and the surface that reads it disagrees with the surface that recomputes.

[src/lib/margin-side.ts](src/lib/margin-side.ts) is that authority: `resolveMarginSide(panel, panelSides, override?)` with `marginSideForMarkerType` / `marginSideForCardKind` as the two keyed doors, and the DEFAULT derived from `PANEL_REGISTRY[panel].defaultStripSide` rather than restated. Both consumers call it with the same live dock map (`EditorPane`'s `marginaliaPanelSides`, already the map `<Marginalia>` packs against — a `useMemo` over the placement list, so threading it into the reconciler adds no per-keystroke and no per-render work). Three rules it earned:

- **Delete the stored copy; don't merely align it.** `anchor.margin` is gone from the `Link` type, from every site that wrote it (four in `links.ts`, the two synthesized Mode-B links, the migrator's carry-forward, the two reconciler rebuilds, and the agent-side `create_card.py`) and from its one reader. Leaving it written-but-unread would be the dead-SSOT failure above, one file over: the next agent reaches for `link.anchor.margin.side` believing it is the side. Legacy sidecars still carrying the key keep it until something rewrites their link: the migrator's canonical branch is a pass-through, but the load-time anchor reconciler REBUILDS the anchor object in its two relocating branches (`resolve-card-anchor.ts` hybrid-cleanup and `relocateBySnapshot`) and persists the result, so the key does quietly disappear there. Harmless — nothing reads it — but worth saying accurately rather than claiming disk is untouched. The agent-side writer is included in the delete: `editor/scripts/create_card.py` no longer emits the key, and its `--margin` flag is now an explicitly-documented no-op (kept only so a stale skill bundle doesn't crash on an unrecognized flag) with every skill that taught it updated.
- **A derived column that nothing reads is still dead.** Deriving `MARKER_META[t].defaultSide` from the registry was the first cut — and once the grid asked `marginSideForMarkerType` instead, the column was written by `meta()` and read by nobody. It is deleted too: the default lives once, on `PANEL_REGISTRY`.
- **Say which question a shared table is answering.** `defaultStripSide` serves two: *where does this card's margin chrome paint* (this SSOT) and *where does this panel's STRIP dock/open* (five placement sites, which disagree among themselves on the last-resort fallback for the one null-sided panel — a real latent fork, filed separately, deliberately untouched here because it decides where a pod opens, not where chrome paints).

The same task retired the marginalia builder's second orphan formula: the re-pin dock flag was `resolveCardAnchor(…).source === "orphan"`, a parallel path to `resolveAnchorState` that structurally could not see a card's declared intent. It now asks the SSOT (`state !== "anchored"` — the margin's question is binary, expressed *on top of* the SSOT rather than beside it), and `resolveAnchorState`'s witness parameter admits a uuid as well as a position, since being `number`-only is exactly why this surface couldn't call it. CI: [src/lib/\_\_tests\_\_/margin-side-ssot.test.tsx](src/lib/__tests__/margin-side-ssot.test.tsx) — the defect-catching leg drives the REAL reconciler against a REAL editor under a left-docked Notes panel and asserts the rail's `data-margin-side` equals the grid's marker side (it fails on the pre-fix read); the census legs pin `src/` + `library/` free of `anchor.margin`, `inferMarginSide`, `MarkerMeta.defaultSide`/`panelId`, any `source === "orphan"` comparison, and any `defaultStripSide` read outside the SSOT and the named strip sites — plus a THIRD root, `editor/`'s Python writers and skill markdown, which the two-silo habit does not reach and where a fifth `margin` writer survived this task's own first cut. Two of those legs earned their own repairs under review: the `orphan` needle must run against comments-stripped source (the code-only stripper blanks the very literal it greps for, so the leg was unfalsifiable), and the stripper is a one-pass SCANNER rather than a regex chain — chained template-then-string stripping let a backtick inside a double-quoted string swallow 7 kB of a real production file, the task-202b runaway, which a declaration-count self-check now pins.

#### The seed half: a DETECTED answer never overwrites a DECLARED one

Same law read in reverse (task 344). Above, a live answer was frozen into a record; here a
GUESS overwrote the authoritative record — and the two defects that made it were each
invisible on their own.

**The detector was fed bytes its own contract forbids.** `detectBibPackage` handed the WHOLE
RAW `.tex` — preamble, body, comments, verbatim blocks — to `detectPreambleBibFamily`, whose
docstring says in as many words to pass the inert-stripped preamble. So a commented-out
`% \usepackage{biblatex}`, the single most ordinary thing in an academic preamble, outranked a
live `\usepackage{natbib}`; so did a verbatim-quoted package line in a methods paragraph. The
requirements side has projected inert bytes away since P4 and its comment explains exactly why.
Two detectors, one question, opposite discipline.

**And the answer was written into the user's record.** `refreshBib` did
`if (data.detectedPackage) setState(…)` — and the detector never returns null (it defaults), so
the guard was always true. The Citations panel's own Package control was discarded on every doc
open AND every `DOC_BIB_CHANGED_EVENT`; since `usePersistentState.update` persists the whole
state object, the next unrelated citations write made the mis-detection durable, whereupon the
SAVE path reads `citations.json` as authoritative, hands it to `ensurePreambleRequirements` as
`declaredBibFamily`, and injects the wrong `\usepackage` into the `.tex`. Biblatex under
natbib-style `\citep` usage leaves an undefined `\citep`: **the paper stops compiling.**
`storage-fsa.ts`'s own comment claimed the family was "never overridden by detection once set."

> **A detector that cannot report "I found nothing" is a SEED, never an authority.** It answers
> the VIEW where nothing is declared and writes to no record — and it believes only the bytes
> the compiler would, through the same projection every sibling detector uses.

Five rules it earned:

- **The projection is a NAMED door, not an option bag.** [`projectDetectableLatex`](src/lib/latex-lexer.ts)
  (`projectLiveLatex` at the NARROW verbatim family) is what "which bytes may a detector
  believe?" means; `latex-requirements`' `projectDetectableBody` and `bib-family`'s
  `detectBibFamily` both call it, so the P3 fork-F1 family decision cannot be re-made per
  caller. Kept NARROW deliberately: the requirements pass injects `\usepackage` lines off this
  projection, so widening it to `VERBATIM_ENVS_FULL` changes saved `.tex` bytes rather than
  tidying anything. Inline `\verb` stays live for the same byte-compatibility reason — both are
  stated residuals at the door, not oversights.
- **Ask each half of the question where it lives.** The `\usepackage` half is asked of the
  PREAMBLE, split on the PROJECTED text so a commented-out `\begin{document}` cannot move the
  boundary, and failing OPEN (no marker ⇒ the whole projection is preamble) so a fragment still
  answers. The command-usage FALLBACK stays whole-source on purpose: a `\citep` inside a
  `\newcommand` is real usage, and narrowing a fallback can only lose detections. What it gains
  is inertness.
- **The record must be able to say "nobody has chosen."** `CitationsState.bibPackage` is
  OPTIONAL now, and `migrate` normalizes through `asBibFamily` instead of defaulting to
  `"biblatex"`. That fabricated default is *why* the stomp could not be gated: "the user chose
  biblatex" and "nobody has spoken" were the same value. Detection resolves at READ time
  (`stored ?? detected ?? DEFAULT_BIB_FAMILY`) and writes nothing, which also retires the
  ordering hazard a gated write would carry — `refreshBib` races the sidecar load, so any
  "write only if unset" guard would have to be evaluated against the LOADED state, and a
  non-writer has no race to lose.
- **The baseline is spelled ONCE, and the disagreement was not cosmetic.** `DEFAULT_BIB_FAMILY`
  ( = `"natbib"`, the family `VIRGIL_BASELINE_PACKAGES` ships) had three hand copies that
  disagreed: the detector fell back to natbib while the hook's EMPTY state and its inert twin
  said biblatex. So the hook announced biblatex, then changed to the detected family — and
  `CitationCard`'s package-change effect reads any CHANGE of that value as a user toggle and
  re-derives every citation's command shape. On the majority of documents an ordinary doc OPEN
  looked like a package switch. One constant makes the common case settle with no change at all.
- **No silent correction, and that is the pre-existing decision rather than a new one.** A
  document stored as natbib whose preamble later hard-loads biblatex is a CONFLICT, and
  `reconcileBibFamily`'s locked user decision is *warn, never rewrite*. Detection correcting the
  record would be that rewrite by another route.

CI: [bib-family-detection-authority.test.ts](src/lib/__tests__/bib-family-detection-authority.test.ts)
(detection + the census) and [citations-bib-family-seed.test.tsx](src/hooks/__tests__/citations-bib-family-seed.test.tsx)
(the authority half, through the REAL hook — a stored natbib under a `.tex` that detects
biblatex, the `DOC_BIB_CHANGED_EVENT` re-stomp, and the bytes that reach disk). The leg with
teeth is the CENSUS: the door was never the part that could misbehave, a second call site
feeding it raw bytes is — which is exactly what shipped, spelling no needle any behavioural test
of the door could see. So only `bib-family.ts` may call the raw-byte primitives, only the lexer
may spell the projection's option bag, and the hook may not spell a family literal. Measured by
neutering each half in turn: the projection takes 5 legs, the seed-not-stomp rule 4, the shared
baseline 1.

**Residual, stated.** Documents whose `citations.json` already carries a family *written by the
pre-344 stomp* keep it, and it is now authoritative — right by the no-silent-correction rule,
and fixable in one click from the panel, but it does mean the fix does not retroactively undo
what the old behaviour persisted. And the mount-time settle is narrowed rather than closed: a
biblatex document still transitions once from the baseline to its resolved family on load, where
`CitationCard`'s effect can re-derive command shapes — now toward the CORRECT family. Closing it
properly means the effect riding the explicit `setBibPackage` EVENT instead of a value diff (the
"read the DEVICE, not the derived change" rule, one subsystem over), which is a change to the
citation-command pipeline rather than to this one.

##### …and the same detector rule had a THIRD reader, sitting inside the emitter

Same rule, one layer down (task 345). 344's law — *a detector believes only the bytes the
compiler would* — was applied to the two detectors that look like detectors. It missed the one
that does not: `declareFromRawLatex` ([latex-serializer.ts](src/lib/latex-serializer.ts)), the
P4 "requirements by emission" declaration for a **raw-passthrough** block. Every other `need()`
site in that file declares from the NODE MODEL — the serializer knows an `exampleBlock` emits
`\ex`, a gloss `\begingl`, a `graphicsBlock` an `\includegraphics` — and so searches for
nothing. A `texBlock`'s `code` and a `figureBlock`'s `extras` are the only inputs that reach a
declaration where the emitter has no idea what the bytes mean, so it has to SCAN them. It
scanned the RAW string.

> **A requirement declared by SCANNING bytes is a DETECTION wherever it sits, so it projects.
> A declaration read off the node model is exempt — the line is not "did a regex touch user
> bytes" but "is a regex SEARCHING user bytes for a package's vocabulary".**

That distinction is drawn where it is because the looser one has a counterexample in the same
file: the `textColor` mark validates a user-authored hex with `/^[0-9A-F]{6}$/` and then declares
xcolor beside the `\textcolor[HTML]{…}` it is itself about to write. A regex runs over something
the user wrote, and projecting a hex colour would be nonsense — it shapes bytes the emitter
emits, it does not search them.

Because `assembleLatex` UNIONs declared with detected ("the two never subtract"), the
unprojected half always won: a commented-out `\includegraphics` in a figure's `extras` injected
`\usepackage{graphicx}`, and a paragraph EXPLAINING expex inside a `\begin{verbatim}` wrote a
`\newenvironment{xlist}` macro into the user's preamble on the strength of prose. Injecting a
package a document never runs can break a previously compiling paper — which is the reason the
requirements side has projected since P4, in a comment directly above the vocabulary the
non-projecting half was already importing from. Case D is the everyday one: commenting an old
figure path out while trying a new one is ordinary editing, and a raw-passthrough block is
precisely where a user parks LaTeX they are *not* running.

Three rules it earned:

- **The projection lives INSIDE the declaration, not at its two call sites**, so a third caller
  cannot forget it and there is no second spelling of "inert" for the two halves to drift on.
  It spells `projectDetectableLatex` — the named door, never an option bag (344's rule).
- **The vocabulary was forked too, and that was the deeper half.** `TIKZ_RE` was shared and the
  other four regexes were hand-copied between `declareFromRawLatex` and `BODY_DETECTORS`,
  byte-for-byte, while the collector's own header described the shared-predicate design the
  copies had already half escaped. `PACKAGE_DETECTORS`
  ([latex-requirement-collector.ts](src/lib/latex-requirement-collector.ts)) is now the one
  table both read. Byte-neutral when it landed — the regexes were identical — which is exactly
  why it needed doing before the next vocabulary change landed in one half only.
- **A "declares nothing" leg needs a live CONTROL somewhere**, or it passes when the vocabulary
  is simply broken. And the injected-bytes probe needs a BARE preamble: `CLASSIC_PREAMBLE`
  already ships graphicx / xcolor / natbib / expex, and `xcolor` is on `ALWAYS_REQUIRED_IDS`, so
  against the default seed "did this inject a package?" has no observable answer at all — the
  per-member sweep reads `serializeTopLevelBlock(...).requirementIds` instead.
- **"Declared from the node model" is a claim about the MECHANISM, not a promise that the bytes
  are live.** `graphicsBlock` is the near miss worth knowing, because it is the shape the next
  member of this class will have: it declares graphicx off its node TYPE while its whole payload
  is one free-form `command` attr that `applyGraphicsCommandEdit` stores verbatim when it can't
  parse it, so a commented-out command still declares. Left alone deliberately — fail-open is
  the right direction for a node whose type says what it is, graphicx is in
  `VIRGIL_BASELINE_PACKAGES` so the over-declaration is unobservable, and a commented command
  stops being a `graphicsBlock` on the next parse anyway.
- **A needle that rides on another needle's evidence is unfalsifiable.** The census's first cut
  asserted "at least N−1 of the needles fire in the collector", which absorbs exactly one
  silently-broken needle — and the tikz needle matches nothing outside the collector (it was the
  one member already shared), so that leg was its ONLY evidence anywhere. The liveness assertion
  is exact now, and the canary spells all five shapes rather than two.

**Residuals, stated rather than implied.** The projection is inherited WHOLE, including the
door's own over-strip — a raw `%` inside a `\verb|100%|` or a `\url{…a%20b}` truncates the rest
of that line — and since both readers now project, nothing rescues it: a live `\includegraphics`
sharing such a line goes undeclared. The failure direction flips from over-injection (which
silently breaks a compiling paper) to under-injection (a loud `Undefined control sequence`),
which is the better trade and not a free one. The projection is also stateful over the string it
is GIVEN, so a `code` beginning mid-verbatim reads LIVE here and INERT in the whole-body
detector — per-block isolation, the conservative direction. And the class has known-open members
this task deliberately did not close, so the section does not read as drained: the **preamble
boundary** is still resolved by a raw `indexOf("\begin{document}")` at five sites (including
`injectPreambleRequirements` itself, whose splice would *un-comment* an inert
`% \begin{document}` and write a non-compiling `.tex`), which needs an offset-preserving
`firstLiveIndexOf` rather than this projection — `document-class.ts`'s private
`isLiveDocumentClass` is the shape; `StyleApplyDialog.diffPreambles` counts commented-out
packages as things a style swap will destroy; and `compile-service`'s `hasBiblatex` probe scans
unprojected while its own neighbour `reference-resolution.ts` projects.

CI: [raw-passthrough-declaration.test.ts](src/lib/__tests__/raw-passthrough-declaration.test.ts)
— fixtures A/B/D through the REAL `serializeToLatex` with two live controls, plus a per-member
sweep (driven FROM `PACKAGE_DETECTORS`, so a new package is covered by declaration alone, and
supplying the live half for the ids the fixtures don't control) asserting the declaration and
the projected detector agree on the same raw bytes in both the comment and verbatim shapes. The
leg with teeth is the CENSUS, swept over BOTH silos: the declaration function was never the part
that could misbehave — a caller handing it raw bytes is, and so is a SECOND scanner spelling its
own copy of the vocabulary, which is invisible to every behavioural test of this function.
Measured, that sweep needs no allowlist — 763 production files, one hit, the collector. Measured
by neutering each half in turn: dropping the projection takes 5 legs, re-forking the vocabulary
WITH a drifted member 2 (a byte-identical re-fork trips only the census, which is the point),
and hoisting the projection to the call sites 1 — behaviour identical, rule broken.

### The field half: a context field is a promise that some `run()` consults it

Same law, third tense (task 227). The export census above asks whether a published symbol is CALLED and structurally **cannot** see a declared field that is written but never read — so `ActionContext` accumulated three of them.

> **A field on a context/seed bag is an SSOT only if something READS it. Construction is not consumption: a value ten callers build and nobody consults is dead, and the plumbing makes it read as load-bearing.**

`ActionContext.position` (`ActionPosition = "cursor" | "passage-end"`) declared the **insertion-placement policy** in a JSDoc that named real surface-specific defaults, was threaded through `EditorActionsHandle.runAction`'s seed, forwarded by the bridge, and mirrored by four suites — while **no site in `src/` ever passed a value and no `run()` ever read one.** The policy it named lived hardcoded in the legacy dispatcher ([drag-handle-actions.ts](src/components/editor-layout/card-actions/drag-handle-actions.ts), the footnote/citation collapse to `range.to`). `cardLifecycle` was the same shape one field over: its doc claimed the lifecycle actions used it, and those actions reach a `CardLifecycleApi` through a *different* channel entirely (`cardRun` → `ctx.dispatch` → `useDragHandleActions`, which closes over its own copy from `DragHandleActionsDeps`). Both are DELETED — re-add either **with** its first real reader, never ahead of one.

Three rules it earned, two of them from the guard's own first version being wrong:

- **Scope the read needle by TYPE-awareness, not by name alone.** The census's first version searched all of `src/` for `ctx.<field>` and was unsound in the *permissive* direction: `surface` reported alive off [editor-extensions.ts](src/lib/editor-extensions.ts)'s `ctx.surface === "float"`, where `ctx` is an `EditorExtensionsCtx` and the file never mentions `ActionContext`. It now counts only files that REFERENCE `ActionContext` — a file that reads one is a file that types one. The residual (a namesake `ctx` *inside* such a file; `action-registry.ts` already has two) is stated in the guard rather than papered over, exactly as the export census states its own two limits.
- **Anchor the can-see canary on a field that cannot be retired.** The first version proved "the census isn't blind" with `toContain("surface")` — the one field the census would have flagged had it been sound. A canary standing on the defect is not a canary; it is now anchored on `editor`/`view`/`ref` plus a live read-site count.
- **One copy of the stripper.** A census that must not count a name in prose needs comment+literal blanking, and this is the THIRD to need it — after 202b's runaway (a backtick inside a double-quoted string ate 7 kB and nine declarations, silently, suite green) and 205's unfalsifiable leg. The one-pass scanner moved to [\_source-scan.ts](src/lib/__tests__/_source-scan.ts) and both censuses import it; re-deriving a fourth copy is how the first two defects happened.

CI: [action-context-honesty.test.ts](src/lib/actions/__tests__/action-context-honesty.test.ts). Rule 1 — every `ActionContext` field has a production read. Rule 2 — every `runAction` seed member NAMES a context field (the seed can only carry what the context can hold, and rule 1 keeps the context to what something consumes). Plus a swallow self-check, a pinned proof that `library/` has no `ActionContext` consumer, and `PERMITTED_DEAD_CONTEXT_FIELDS` — **one** entry, `surface`, which is the pre-existing third hit recorded honestly rather than swept: it is the only REQUIRED field in the census, ten production sites write it, and it is a member of the plugin-land `runAction` seed, so retiring it is a materially bigger call than the two that were retired. Its declaring JSDoc names its consumer as `command-input.ts` — a file this same registry's header records as DELETED through CHIP 7a. The reader was removed and the field was not. The set can only SHRINK. A hit is WIRE-it or DELETE-it.

Flagged, not fixed, and invisible to this guard by construction: `ActionContext.dispatch` has three production reads, and **every one is gated behind `ctx.ref.kind !== "cursor"`** while its sole supplier (the bridge) always synthesizes a `CursorRef` — so no `ctx.dispatch?.()` can fire from that path. The census asks whether a read EXISTS, never whether it can EXECUTE; that is a different guard.

### The vocabulary half: a token two layers must agree on is spelled ONCE

Same law, fourth tense (task 255) — and the one where deleting the dead declaration would have been the *smaller* half of the truth.

The finding was a textbook dead facet: `TEXT_OBJECT_REGISTRY[kind].sourceMarker` declared `vexid`/`vxid`/`vlid` under a header advertising **"source-marker round-trip"** among the things the rest of the system reads off the registry, and after task 064 removed its last proxy reader (`meta.sourceMarker?.idLength === 4`) **nothing read it for five weeks**. But the round trip it claimed to drive carried the same tokens as hardcoded literals in the serializer's nine emit sites, the parser's seven recognition sites *and* its block-boundary command list, the footnote-body parser/serializer, `SHIM_COMMAND_NAMES`, the `.bib` uid regexes, and a line of UI copy in the style editor that named three of the seven. Nothing structural held those copies together.

> **A token that two layers must agree on byte-for-byte is spelled in ONE place, and every layer reads it there. Nothing spells a `\v*` marker command by hand — emitting, parsing, or declaring.**

[src/lib/latex-markers.ts](src/lib/latex-markers.ts) is that place: `VIRGIL_MARKERS`, keyed by the entity each marker identifies, so the record IS the kind→marker map. Four rules it earned:

- **Put the SSOT where the layer that needs it can reach it.** The registry facet was decorative *by construction*, not by neglect: the registry is editor-coupled (TipTap `Editor`, the doc-structure bus, the drop adapters), so the parser and serializer can never import it. That is also why "wire the round-trip to read the registry" was the wrong shape of fix and the module has **zero imports** — a leaf every low-level consumer can take. A facet the layer that needs it cannot import will be re-copied, every time.
- **Derive the subsets from FACETS, not from a second list.** `containsInternalMarker`'s guard set (the reparse refusal for untrusted suggestion text) is every marker with `file:"tex"` + `position:"inline"`; the parser's block-boundary set is `file:"tex"` + `position:"block"`; `SHIM_COMMAND_NAMES` is *all* of them, because every marker is written into a file LaTeX may compile, so a new one cannot be added and left undeclared. Each facet has real readers — a facet nobody reads is the thing this section is about.
- **Frozen bytes are DATA, not a spelling.** `style-library.ts`'s `LEGACY_CLASSIC_PREAMBLE_V0`/`_V1` still name three markers inline and must: they record what past build generations wrote, and the v2 migration gate is exact byte equality, so deriving them would seal those libraries out of the upgrade. That is the census's one allowlist entry, and it can only shrink.
- **The two failure modes are silent in opposite directions.** A renamed command with a stale *parser* makes Virgil emit a document it cannot read back; with a stale *shim list* it emits one LaTeX cannot compile. Neither is a type error, and no round-trip suite could catch either — every one of them spells the token the same way the code it tests does.

Deliberately NOT folded in: the `%!v:xxxx` block anchor and texBlock's `%!vtex:begin/end` sentinel are a different FORM (a trailing comment, no preamble shim) with their own regexes in [uuid.ts](src/lib/uuid.ts); merging two grammars buys a bigger table, not a smaller fork.

CI: [latex-marker-ssot.test.ts](src/lib/__tests__/latex-marker-ssot.test.ts) — the leg with teeth is the **census** (both silos, comments stripped and literals KEPT, since the drift lives in literals), because the module was never the part that could misbehave; a call site spelling its own copy is. It has a THIRD root too (`library/` + `editor/` skill markdown and Python, which the two-silo habit does not reach): markdown cannot import the SSOT, so that leg asserts MEMBERSHIP — every marker-shaped command the skills teach an agent to write is still one the vocabulary knows, which is exactly the rename hazard. `docs/` is deliberately out of that leg, since a design memo may name a marker nobody built. Plus a canary + stripper swallow self-check, the shim/inline-set wiring pins, and a per-marker emit→parse round trip through the REAL parser and serializer, keyed on the `VirgilMarkerId` union so a new marker is a **compile error** until someone states how it survives a save/reload. Three of its legs fail on the pre-fix tree.

#### The deploy half: a convention SIX consumers follow is not a convention

Same law, other medium (task 365) — and the case where the SSOT was never
written down at all, so it existed only as an idiom six files had each
re-derived, and the seventh simply didn't know about it.

Virgil ships as a static export that may be served from the origin root OR from
a subdirectory (`NEXT_PUBLIC_BASE_PATH=/virgil`, what `deploy.yml` sets). Next
prefixes the URLs it generates itself — page routes, `next/font`, chunk
`<script>`s — and touches nothing you build by hand. Every asset under `public/`
is reached by a hand-built string, so every one of them owes the prefix. Six
consumers hand-rolled the same three lines; three did not, and all three failed
SILENTLY and only in production:

- **The Library PDF tab** (`PdfView`'s `VIEWER_SRC`) requested
  `<origin>/pdfjs/web/viewer.html` — outside the app — and rendered the host's
  404 page inside the pane. This is the one Gabriel reported.
- **The `apple-touch-icon` `<link>`** 404'd the iOS home-screen icon, with no
  symptom anyone would ever file.
- **The service worker's TeX precache** — the DATA half, and the one no source
  census would have found. `scripts/build-tex-bundle.mjs` emitted ONE spelling
  into TWO tables whose consumers apply DIFFERENT bases: `tex-core-manifest.ts`
  is prefixed by its consumer, while `sw.js` resolves each entry with
  `new URL(p, self.location.href)` — against its own SCOPE, where a leading
  slash DISCARDS the base and escapes to the origin root. Under `/virgil` all 82
  assets 404'd at install, swallowed by the SW's per-asset `try/catch`: the P1
  offline-compile pillar was simply not there, with no error and no symptom
  until the user went offline.

> **Every URL that reaches a `public/` asset is built by ONE door —
> [`publicAssetUrl`](src/lib/public-asset-url.ts). A path stored in a DATA table
> is public-RELATIVE and each consumer applies its OWN base; where two tables
> have consumers with different bases, they get two spellings, stated at the
> generator.**

Four rules it earned:

- **Dev CANNOT see this class.** With an empty basePath every root-absolute
  string is accidentally correct, which is why all three shipped and why the
  door's own suite carries an opt-in leg over a real
  `NEXT_PUBLIC_BASE_PATH=/virgil` export (`npm run preview:pages`).
- **The env read's SPELLING is load-bearing, and it was measured, not assumed.**
  Against a real basePath build, `process.env.NEXT_PUBLIC_BASE_PATH ?? ""`
  compiles to the literal `"/virgil"`, while the `typeof`-guarded form three of
  the folded-in copies used compiles to
  `void 0 !== shim.default && "/virgil" || ""` — a runtime conditional whose
  false branch is `""`, i.e. **the bug itself**, reachable silently wherever
  Next's `process` shim is absent. A guard whose failure mode is the defect is
  worse than no guard. The build-smoke leg pins the inlined literal, because it
  is the one thing no unit test can see: get it wrong and every other leg still
  passes while production serves an unprefixed URL.
- **Membership is DISCOVERED, because a hand list could only be missing a name**
  — and here it would have been missing the two that matter. The census's
  vocabulary is the real `public/` tree ∪ the dirs the build scripts emit into
  it, since `examples/` and `skill-bundle/` are build output and do not exist in
  a fresh checkout at all.
- **The exemption is scoped to the DATA shape it justifies.** `tex-core-manifest`
  is allowlisted as a table whose consumer prefixes — and a second leg requires
  that file to name no URL-consuming API, so the exemption cannot silently cover
  a `fetch` added beside the table later.

CI: [public-asset-url-ssot.test.ts](src/lib/__tests__/public-asset-url-ssot.test.ts).
The leg with teeth is the **census** — the door was never the part that could
misbehave, a call site that never asks it is, and that call site type-checks
perfectly. It blanks `publicAssetUrl(...)` ARGUMENTS before matching, so the
question it asks is exactly "is this literal reaching the door?"; a positive twin
pins that only the door reads `NEXT_PUBLIC_BASE_PATH` at all. Beside it: the SW
half driven through `sw.js`'s OWN resolution expression (read out of the file, so
the two cannot disagree), and the reported defect driven through the REAL
`PdfView`. Measured by neutering each half in turn — the PdfView fork takes 3
legs, and the SW strip, the shipped manifest, the generator's second spelling,
the icon link and a re-forked prefix copy take 1 each.

#### The twin half: a parser that shares SOME vocabularies is how the rest drift

Same law, and the case where the SSOT existed, was read by one layer, and hand-copied by its twin (task 341). `footnote-content.ts` is a COMPLETE second inline parser and serializer — it is what reads and writes every `\footnote{}` body and every note/todo/report/archive card body — built deliberately as a twin of the main one in `latex-parser.ts`. Four vocabularies had already been unified across that seam, each by its own task and each with a comment at the site saying so (`smartenStraightQuotes` 209, `matchInlineVerbAt` 264, `matchCommandToken` 338, `CHAR_ESCAPE_TABLE` 339). Three had not, and every one of them was silent in the direction that matters:

- **Math delimiters.** The fork knew `$…$` and nothing else, so `\(x^2\)`, `$$E=mc^2$$` and `\[x^2\]` in a card body fell through to the PROSE buffer and were char-escaped: `^` became `\textasciicircum{}`, which in math mode typesets a **literal caret**, so every superscript and subscript in the body was lost in the PDF. And the damage was **invisible in the editor forever** — the fork's unescape rung maps the spelling back to `^` on the way in, so the footnote kept looking right while the file on disk stayed permanently wrong.
- **Cite names.** A hand alternation of 17 against the registry's 27, so ten commands (`\fullcite`, `\nocite`, `\citetitle`, `\citeurl`, `\citedate`, `\smartcite`, `\smartcites`, `\footfullcite`, `\citenum`, `\citetext`) became grey monospace text inside a card body while behaving as citations one node up — no card, no panel row, no `.bib` linkage, and the `\vcid` **deleted from the `.tex`** on the next save, since the marker branch consumed it and the cite branch never fired to re-emit it.
- **The cite ARGUMENT grammar**, which is the one that proves sharing a name list is not enough: the fork hand-wrote the multi-cite loop with the per-key brackets consumed only before the FIRST key, so `\footcites[p1][q1]{alpha}[p2][q2]{jones_21}` — a name it already had — let its tail fall through to prose and had the citekey escaped to `\{jones\_21\}` on disk.

> **A registry publishes the whole OPERATION, not the piece that was easiest to share.** The cite scanner (`matchCiteCommandAt`, [cite-commands.ts](src/lib/cite-commands.ts)) answers vocabulary AND argument shape in one call; the math scanner (`matchInlineMathAt`, [latex-lexer.ts](src/lib/latex-lexer.ts)) owns the four delimiter pairs and their escape-aware close search — the same shared-scanner shape `matchInlineVerbAt` already had. Both inline parsers call them at the same position in the same branch order.

Four rules it earned:

- **PARITY is the contract; byte-identity is a stronger claim the reference itself does not meet.** Measured on the pre-fix tree, body text already normalizes `\(x^2\)` and `$$E=mc^2$$` to `$x^2$` / `$E=mc^2$`. So "round-trips byte-identically" and "behaves exactly as body text does" cannot both hold, and the second is the one that names the defect. The suite pins parity plus **idempotency** (the canonical form is a fixed point, so nothing accumulates across saves) and records the normalization as pre-existing main-parser behaviour this task deliberately does not touch. Widening it to preserve the delimiter is a change to the DOCUMENT surface, not a fork repair.
- **An id parked by a marker binds to the atom that follows it, or to nothing.** `pendingCitationId` was a bare field cleared only when a citation consumed it, so a marker whose atom the scanner failed to recognize kept its id alive for the rest of the body and handed it to the NEXT citation — two cards resolving to one identity, the later one writing its edits into the earlier one's `.bib` entry. That was routinely reachable in the fork (whose vocabulary was ten names short) and reachable anywhere by a hand-typed stray marker. [`PendingMarkerId`](src/lib/latex-markers.ts) parks the POSITION alongside the id, so the binding is structural rather than careful, and an unclaimed marker is dropped — right, since it names an atom that is not there. Both markers (`\vfid`, `\vcid`) and both parsers take it.
- **A block-level command inside an ARGUMENT is not a block boundary.** `readParagraph` tested `BLOCK_BOUNDARY_COMMAND_RE` at any depth, so `Text.\footnote{Display \[x^2\] here.}` split at the `\[`: the `\footnote` lost its argument and was demoted to a grey `latexCommand`, `{Display` and `here.}` became prose in two different paragraphs, and the document round-tripped to `\footnote\{Display` / `\[…\]` / `here.\}` — which LaTeX errors on ("Paragraph ended before \footnote was complete") and which emits no `\vfid`, so it had stopped being a footnote at all. The test is now depth-gated. Only the COMMAND test is: the blank-line and comment breaks stay unconditional, and that is exactly what bounds an unbalanced `{` in hand-written source to its own paragraph instead of the rest of the file.
- **The census counts a LIST, not a mention.** "No file spells a cite name" is the wrong needle — a `"\\cite{}"` seed for a fresh citation card is a legitimate default value, and routing it through the registry would buy an index, not an invariant. The needle is *three or more DISTINCT registry names on one line, in code* (comments stripped, string literals KEPT, since the drift lives in regex literals and quoted arrays), which is what an alternation, an array or a Set looks like and what a single seed never does.

**The recorded residual, named rather than allowlisted in silence:** `src/lib/bib-parser.ts` (and `library/lib/bib-parser.ts`, a whole-file copy of it — its own pre-existing fork) holds three more hand lists. Deliberately not folded in, for a stated reason: it answers a DIFFERENT question — parsing a complete command STRING into normalized typed parts — and its natbib/biblatex split IS that normalization, deciding whether pre/post-notes are whole-citation or per-key, not merely recognizing a name. Its lists are also not the registry's: they carry `fullcites` / `footfullcites`, which `KNOWN_CITE_COMMANDS` does **not** have, so deriving them would silently DROP two real biblatex commands unless the vocabulary is widened first — a judgement call about what Virgil recognizes, not a de-duplication. Two other residuals measured in passing and left alone because both are pre-existing and independent of this seam: a `\\[2pt]` hard break with optional spacing is torn into two paragraphs at the block level — **closed by task 349 M4**, see "The provenance half" below — and `$$…$$` demotes display math to inline on BOTH surfaces.

CI: [card-body-inline-parity.test.ts](src/lib/__tests__/card-body-inline-parity.test.ts). Its shape is the whole point — **every pre-existing suite exercises ONE fork at a time** (the parser suites drive body text, the footnote-content suites drive card bodies, and each spells its fixtures the way the code it tests happens to handle them), so a divergence between them is *unrepresentable* in either, which is exactly how three vocabularies drifted with 6 972 tests green. Every leg here drives BOTH surfaces over the SAME bytes, and the vocabularies are swept FROM the SSOTs (`for (const cmd of KNOWN_CITE_COMMANDS)`, `MULTI_CITE_NAMES`, `CHAR_ESCAPE_TABLE`), so a future registry addition is covered by declaration alone. Measured by neutering each half in turn: the math scanner takes 8 legs, the multi-cite repetition 8, the positional marker binding 2, the paragraph gate 2 — and re-introducing a hand alternation in the fork trips the census, which is the shape it exists to prevent. The ten missing cite names were measured directly against the pre-fix tree rather than by that neuter, which under-reports five of them because the old alternation prefix-matched `\citet`/`\cite` out of `\citetitle`/`\citeurl` and then fell through.

#### The default half: what a system does not model, it CARRIES — and a hand list can only be missing a name

Same round trip, one branch over (task 342) — and the case where the two halves of a construct's handling were answered by two DIFFERENT kinds of thing, so they could only agree about the constructs somebody had enumerated.

`\begin{env}` dispatches through one switch with six modeled cases and a `default:`. That default branch neither took the block's uuid nor declared its body literal, and both omissions were invisible in the same way — **the first save looks perfect**:

- **Identity.** The trailing `%!v:` anchor is EMITTED per node TYPE (the serializer emits one for any carrier paragraph that has a uuid, unconditionally) and was HARVESTED per environment NAME, from a hand list of exactly the six names the switch happened to model. So `align` / `equation` / `table` / `tabular` / `center` / `abstract` / `theorem` — every env Virgil doesn't model — was written WITH an anchor and read back WITHOUT one: `assignUuids` minted a fresh uuid **every save**, and the orphaned line was re-read as a standalone empty paragraph. Measured over four cycles on `\begin{align}`: one stray `%!v:` line and one phantom blank block per save, unbounded, with the uuid walking `7a3c → 3f63 → e770 → dbe1` — so every note / todo / archive / marginalia card anchored to that block orphaned on every save, with **no edit by the user**. `itemize` was a clean fixed point beside it, which is why it read as latent.
- **Byte-literalness.** The carrier text wore the `latexCommand` mark, whose serializer path runs `smartenStraightQuotes`. A fancyvrb `\begin{Verbatim}` body reading `print("hi")` came back `print(``hi'')` on the first save — stable on the corrupted form, invisible in the editor forever (the unescape rung maps it back on the way in), and visibly wrong in the compiled PDF as literal backticks. `alltt` and `comment` the same; `lstlisting` was clean, being on the list.
- **And a third, found by measurement rather than by the report:** the whole-document `\n{3,}` collapse stashed only the verbatim FAMILY — another list of names — so an `align` body with a three-blank-line gap came back with one.

> **An environment the system does not model is BYTE-LITERAL by definition, and it carries its own identity.** It is raw source being conveyed through — nothing downstream is entitled to rewrite it, and the node that conveys it is a node like any other. Where a capability is EMITTED from the node model and CONSUMED from a list of names, the list is the bug: delete it, don't extend it.

Four rules it earned:

- **The right list of exceptions was EMPTY, so the derivation replaces the list rather than growing it.** Every branch of the switch produces a node and the serializer anchors every carrier node that has a uuid, so the harvest is unconditional for every env name. Safe by construction rather than by care: `NODE_UUID_ANCHOR` is start-anchored with `[ \t]*`, so it can match nothing but an anchor on the SAME line as the `\end{env}` just consumed — which is precisely where this env's own carrier would have put it. (Check the one asymmetry before copying this: an env branch that produced NO node would still have to CONSUME the anchor rather than leave it in the stream.)
- **Widening the vocabulary fixes the names you thought of; moving the DEFAULT fixes the ones you didn't.** Making `default:` the byte-literal carrier covers every environment Virgil will ever fail to model, including ones that don't exist yet. `VERBATIM_ENVS_FULL` then decides only the RICHER treatments — the `codeBlock` node, first-close-wins end-finding, and inertness to every scanner that projects live LaTeX (`\documentclass` detection, `\label`/`\ref` resolution, the syntax checker) — never whether the user's bytes are safe. That also collapsed the family's own special-case branch into `default:`, which now produces byte-identical nodes.
- **The membership criterion is what the membership BUYS, and that is what keeps `alltt` out.** The family is "does this body execute as LaTeX?", so `Verbatim`/`BVerbatim`/`LVerbatim` (+ starred) and `comment` joined — the linter already knew the last two, and the SSOT was the SHORTER list, and the one the round trip read. `alltt` looks verbatim and isn't: `\`, `{` and `}` keep their meanings, so its refs are real refs and its braces are real braces. Its bytes are safe anyway, which is exactly the point of the default.
- **The collapse asks "did WE write these bytes?", not "is this env verbatim?"** — the same substitution one file over. `SERIALIZER_GENERATED_ENVS` (quote / itemize / enumerate / figure / figure* / xlist) is the serializer's own emit set and the stash is its COMPLEMENT, so a carried env is protected whether or not anyone named it. Bare `verbatim` is deliberately not a member although its wrapper is generated: its BODY is the thing the collapse must not touch.

**Residual, stated:** the stash's non-greedy tail stops at the first `\end{<same name>}`, so a carried env nested inside another of the same name leaves the outer tail unstashed. Correct for the whole verbatim family (non-nestable by construction) and a stale-blank-line risk only for a self-nested `tabular`/`align` — which the pre-342 code got wrong for *every* env rather than one shape of one. Serializer cost was measured rather than assumed, since the pattern now runs against every `\begin{` instead of four names: 1 000 `align` blocks 1.2 ms, 1 000 unmatched `\begin{}` 1.2 ms, against a 1 000-paragraph prose baseline of 1.6 ms.

CI: [unmodeled-env-roundtrip.test.ts](src/lib/__tests__/unmodeled-env-roundtrip.test.ts). Its shape is the point and it is why the pre-fix tree was green: **the accumulation is invisible to a single round trip** — cycle 1 looks perfect — and every existing round-trip suite spells its fixtures with the envs the code happens to model. So each leg runs the REAL `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over four cycles, asserting byte-identity from cycle 1, an unchanged uuid, and an unchanged top-level block count, with `itemize`/`quote`/`lstlisting`/`verbatim` as passing CONTROLS so no leg passes vacuously. Two censuses carry the teeth — no file but the lexer may spell a family member in code, and every literal `\begin{env}` the serializer emits must be a declared generated env (membership DISCOVERED from that file's own source, never re-listed in the guard) — plus a behavioural leg driving the real parser per declared member, which is the direction with the consequences: a STALE member would collapse user-written bytes. Measured by neutering each half in turn: the uuid hand list takes 18 legs, the `latexCommand` mark 18, the family-scoped stash 2, a re-declared linter list 2, a stale generated member 2, an undeclared emit 1.

**…and the first of those censuses was itself a hand list (task 358).** It watched ONE member (`lstlisting`), so widening the vocabulary did not widen the guard: the five names 358 was filed about joined the SSOT with the census blind to any fork that spelled them, and a fancyvrb-only copy (`Verbatim` + `BVerbatim`) would have passed. Every needle is now built FROM `VERBATIM_ENVS_FULL`, in the three shapes a fork actually takes, each measured to drain to EMPTY on the current tree: **A** a second COPY of the list (≥2 distinct members within four lines — one member's name proves nothing, since `comment` is a revision/cutter record kind and `minted` is a local in the drop controller); **B** a hand-spelled family ENV (`\begin{<member>}` / `\end{<member>}`, the single-member fork — a private skip or terminator, which decides both end-finding and inertness privately); **C** a per-member special CASE (the bare quoted literal). Only C needs exemptions and both are scoped to the shape they justify: the parser's `case "verbatim":` per LINE by source fragment, since it is the one member with a modeled node; and the NAME `comment`, whose collision with the card record kind is **checked** rather than asserted (a leg reads `kind: "comment";` out of `src/lib/types.ts`, so a rename retires the exemption with it) and which A and B still cover. Stated limit: C sees quoted spellings, so a bare `lstlisting` identifier — a variable name, not a family decision — is no longer flagged. The two REPORTED fixtures are pinned in the reporter's own spelling in [nested-construct-opacity.test.ts](src/lib/__tests__/nested-construct-opacity.test.ts) beside an `it.each` sweep of the same property over every member; the `comment` one fails when the names are removed, while the fancyvrb one is a PROPERTY pin — measured, it still passes under that neuter, because 342's default carrier is a second independent net for the bytes.

#### The attr half: what one side WRITES from a derivation, the other must not READ from a hand list

Same round trip, one field over (task 343) — and the case where both halves were already lists of node types, one derived and one hand-written, so they could only agree about the kinds somebody had remembered.

`parTitle` (the optional user-typed title in the strip above a block) and `collapsed` are **sidecar-only**: `\partitle{}` is parsed for legacy migration and nothing serializes it, so `virgil/virgil.json` is the sole carrier and `mergeSidecarTitles` is its only reader anywhere in `src/`. The WRITE walked `UUID_BEARING_NODE_TYPES` — which includes `exampleBlock`; the READ hand-listed four names. Exactly five node types declare a `parTitle` attr, so exactly one was write-only. Click the title strip above an expex example, type a name, save: the title lands on disk correctly, the reload refuses to look at it, and the **next save serializes the now-title-less doc back over the entry**. Destroyed with no warning and no undo, while paragraph / bulletList / orderedList / texBlock behaved — which is why it read as flaky rather than broken.

> **Where two halves of a round trip must agree about which node types carry an attr, they read ONE declaration — and because the parser and serializer are TipTap-free by construction, that declaration is CHECKED against the real schema in CI rather than maintained by hand.**

[src/lib/node-attr-sets.ts](src/lib/node-attr-sets.ts) is the declaration — `UUID_BEARING_NODE_TYPES` (moved out of the serializer), `TITLED_NODE_TYPES`, `COLLAPSIBLE_NODE_TYPES` — an import-free leaf, the placement rule `latex-markers.ts` earned in task 255: a facet the layer that needs it cannot import will be re-copied, every time. Four rules it earned:

- **The premise is CHECKED, not restated** — the same instrument task 148 earned one registry over. The sets can't be derived where they live, but a suite can build the REAL main-editor schema and assert each one equals the node types declaring that attr, so a schema addition fails the build instead of silently going write-only. Measured: the schema's `uuid` set was already exactly the serializer's sixteen-name list, so the pin costs nothing today and is the only thing that will notice tomorrow.
- **Symmetry is made structural on BOTH sides.** `extractSidecarData` now asks the same two sets it is read back by, so "what is written is what can be restored" is a property rather than a coincidence. Behaviour-neutral today (TipTap drops undeclared attrs, so a non-titled type cannot carry a meaningful `parTitle`) — the point is that a write set broader than the read set is precisely the shape that destroyed the title.
- **`collapsed` was the one-member hand list beside it**, gated `node.type === "texBlock"` inline. Only `texBlock` declares it, so that list was *true* — and a one-member hand list is exactly what becomes the next 343 when a second collapsible kind ships. It is a checked set now for the same reason.
- **The same class was live one branch over, and measurement is what found it.** `assignUuids` minted from its own hand list of seven and skipped **`texBlock`** and **`exampleItem`**, both of which it happily *dedups* against the derived set. A uuid-less texBlock serializes as `%!vtex:begin ` with an empty id, which the parser cannot match: the block comes back as a `latexComment` plus a paragraph whose raw LaTeX has been through smart typography (`--` → `–`) — the user's passthrough source shredded, silently. So the mint is now the DEFAULT (every uuid-bearing type except `paragraph`, whose identity is genuinely conditional: non-empty, not inside a container), which is 342's rule applied to a list of kinds instead of a list of env names. This heals rather than changes: the parser and `BlockUuidBackfill` — whose own eligibility is already schema-derived (`spec.attrs.uuid !== undefined`) — cover every real document, which is why the gap had stayed latent.
- **And a mutator's GATE is part of the mutator.** `needsUuidWork` is the read-only twin both save backends consult *before* they deep-copy and run `assignUuids` at all, and it carried its own copy of the same list of seven — so moving the mint to a derivation and leaving the gate behind would have shipped a heal that production can never reach, with the sibling equivalence suite still green because it pinned the pair over HAND-WRITTEN fixtures and therefore spoke only for the kinds someone had thought to write down. It reads the SSOT too, and its sweep is driven per member OF the set. The general form: **when a rule moves to a derivation, the predicate that decides whether the rule RUNS is a second implementation of it** — and a `?`-shaped equivalence test between the two proves nothing about the members neither side enumerates.

CI: [node-attr-sets.test.ts](src/lib/__tests__/node-attr-sets.test.ts). The round-trip legs are driven **per member OF the set**, so the next titled kind cannot ship write-only — it arrives with no fixture and the coverage leg fails first — and each runs two full cycles, because cycle 1 shows the loss and cycle 2 is where the sidecar entry is *overwritten*. The four working kinds stay as passing controls so no leg passes vacuously. The census forbids any file that touches a sidecar `paragraphs` map from re-listing three or more titled node types (the legitimate `CONTAINER_TYPES` sets name two and answer a different question, so they sit below the needle rather than in an allowlist), with synthetic canaries rather than ones standing on the drained defect. Three properties of it are load-bearing: its scope is **DISCOVERED** from the accessor rather than hand-listed (a hand list inside the guard that outlaws hand lists is this defect one level up — it could only speak for the files someone remembered); it splits on `;{}` so it sees a `||` **CHAIN** as well as a bracketed array, because the two lists this task deleted had different shapes and a bracket-only needle would have been blind to the second one in the very commit that fixed it; and the import leg strips comments and requires a real binding `import`, since `toContain("@/lib/node-attr-sets")` over raw source is satisfied by a comment reading "mirrors …, keep in sync" — the fork the whole task exists to prevent. The MINT half is deliberately **not** censused and the suite says so: `assignUuids`' list named only one *titled* type, so a titled-name needle is structurally blind to it and widening it to all sixteen names flags every legitimate content classifier in these files (measured: seven sites). That half is guarded behaviourally instead, by the sibling equivalence sweep — which is strictly stronger than a grep, and is what caught the real one. Measured by neutering each half: the read-set derivation takes 2 legs, the `assignUuids` default 4, the `needsUuidWork` gate 2 (`texBlock` and `exampleItem`, exactly).

#### The carrier half: what a system does not TYPESET, it still has to CARRY

Same round trip, and the construct that appears in every real `.tex` (task 347). 342's rule — *what the system does not model, it CARRIES* — had never been applied to the `%` comment, so a comment was **three different things in three places**: carried (at the head of a line), invisible (inside an expex body), and prose-to-be-escaped (mid-line). Every member was a **fixed point**, so no later save healed it, and all of it landed on OPEN, since `readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad` unconditionally. Measured at `552eeda7`:

- **DELETED.** A `%` line inside an `\ex`/`\pex` body was dropped outright — the user's writing, gone on the first open. `parseExampleBodyAsBlocks` runs `parseBody` (which builds a correct `latexComment` node) and then filters its children to a whitelist an example item's schema can hold; `codeBlock` had been given a byte-literal carrier paragraph by task 264 and `latexComment` never was. `itemize`, `quote` and `figure` all preserved theirs, which is what localizes this to the one splitter rather than to a policy.
- **PROMOTED.** A mid-line `%` fell into the prose buffer, and the char-escape table then rewrote it to `\%`. So `% TODO cite` and `% fix this` — the most ordinary annotations in academic LaTeX — **started typesetting in the compiled PDF**, and afterwards nothing could distinguish a promoted comment from a `\%` the user actually wrote. `Growth of 5%` began printing the text LaTeX had been discarding; `continues%` at end of line, which is TeX's line-JOIN idiom, became a printed percent that keeps the space.
- **SPLIT.** A comment line between two prose lines ended the paragraph, and the serializer then wrote a blank line around the `latexComment` block it had made — so one LaTeX paragraph became two in the PDF.
- **DE-IDENTIFIED.** `stripUuidAnchor`'s end-anchored regex failed whenever anything followed the anchor, so `Some prose. %!v:aaaa % user note` (reachable by typing in the code pane) lost the block's uuid on the next save, orphaning every card, marginalia marker and sidecar title keyed on it.

> **A comment is CONTENT. What LaTeX declines to typeset, Virgil re-emits verbatim — and it needs a representation to do that, because a construct with no representation falls into the prose buffer and the escape table decides its meaning.**

`LATEX_COMMENT_TAIL_MARK` ([latex-lexer.ts](src/lib/latex-lexer.ts)) is the third member of the carrier family, beside `latexCommand` ("raw LaTeX the editor doesn't model") and `latexVerbatim` ("these bytes are literal"). It says something stricter than either: **not typeset at all**. It is a separate mark for the two reasons task 264 gave for splitting `latexVerbatim` off `latexCommand` — a mark that declares attrs changes the JSON shape of every existing carrier, and two distinct mark types can never be merged into one text node — and, like its sibling, it is re-derived from the source bytes on every parse, so it needs no representation in the `.tex` and nothing to migrate. Six rules it earned:

- **The recognition belongs INSIDE the inline scanner, not ahead of it.** A pre-split of the paragraph text on `%` would have been the obvious move and would have broken task 338's own `\url{http://ex.com/a%20b}` case. By the time the carrier branch is reached, every command / verb / math matcher has already declined this byte, so a `%` inside a `\url{}`, a `\verb|…|` or `$…$` was consumed as part of that construct and never reaches it. The `\%` escape is safe for the same structural reason: an escaped percent enters the `\` branch and is consumed by `matchCharEscapeAt`.
- **The default is OFF, and the default is the load-bearing half.** A comment tail owns everything to the end of its LINE, so it may only be recognized where the emitted form actually ends a line. `parseInlineContent` recurses into six braced ARGUMENTS (`\texttt{}`, `\textbf{}`, a `\footnote{}` body, a heading, a gloss cell, a figure caption), and there the next byte the serializer writes is the closing `}` — a carrier would comment out the brace and break the document. So the two block-level paragraph callers opt IN (`PARAGRAPH_INLINE`) and a new caller has to state that its content is line-final before it can get one. Escaping to `\%` inside a braced argument is the CORRECT behaviour, not a divergence.
- **The line obligation is the carrier's own, and it is reachable from the KEYBOARD.** Nothing the serializer writes after a tail may share its line, or it stops appearing in the PDF while round-tripping perfectly — this task's defect arriving through typing instead of through save. Closed at both ends: `inclusive: false` on the mark (text typed at the trailing edge does not inherit it) and `closeCommentTail` at the emit end. Byte-neutral for everything the parser produces, which always leaves the newline at the head of the next prose run. The one `lineFinal` exemption is stated where it is taken: a paragraph and a list-item head, whose next bytes are a `%!v:` anchor — comment bytes — and then a newline.
- **The anchor IS a comment, which is what makes the identity fix small.** `stripUuidAnchor` gained one optional group for a comment remainder after the anchors, so the anchor may ride at the end of a tail (`… % user note %!v:aaaa`) — canonicalized once on the first save and stable after. It still requires the anchors to be present, so it can never mistake a trailing `\url{…a%20b}` for one.
- **The paragraph break was a MODEL error, not a formatting one.** In LaTeX a `%` line between two non-blank lines is discarded with its newline, so `A\n% c\nB` is ONE paragraph. `readParagraph` no longer breaks there. The two shapes that genuinely separate paragraphs still do, because both are blank-line shapes — and the distinction the pre-347 parser could not draw is precisely the one LaTeX draws.
- **…and dropping that break re-opened 338's hazard until the boundary test learned the same rule.** A block-level command inside a COMMENT is not a block boundary — 341's brace-depth gate, one construct over — so `% \end{itemize}` was being split into an empty `%` plus a live-looking terminator. The gate reads `startsLineComment` (the SCAN's rule, deliberately NOT TeX's), so `readParagraph` and `findMatchingEnv` agree by construction about where a construct ends; reading the wider rule here is the layer disagreement whose one failure direction swallows the rest of the document.

**Task 338's recorded premise was FALSE and is corrected rather than left standing** — in its own task file and at the definition that taught it. It read: *"mid-line a `%` is ordinary prose it preserves byte-for-byte — verified against the real parser."* The `\url` half was true; the first half was verified on the PARSE side and the EMIT side was never asked. The narrowing 338 made was right and must not be reverted; what was wrong was the reason given for it being harmless.

CI: [comment-carrier-roundtrip.test.ts](src/lib/__tests__/comment-carrier-roundtrip.test.ts). Every pre-347 suite spells its fixtures the way the code it tests happens to handle them and exercises one construct at a time, so a comment reaching the escape table was **unrepresentable** in all of them — which is how this shipped for a year with the suite green. Each leg drives the REAL save pipeline over TWO cycles (cycle 1 is where the loss happens; cycle 2 is what proves nothing accumulates), with the controls — `itemize`/`quote`, a block-boundary comment, 338's own `\url`, and a genuinely AUTHORED `\%` — through the identical harness so no leg passes vacuously. Measured by neutering each half in turn: the emit escape takes 12 legs, the parse branch 11, the paragraph break 2, the expex carrier 2, the anchor remainder 1, the line obligation 1, the in-comment boundary gate 1. **The M4 leg's first draft passed under its own neuter** and is worth remembering: it grepped `%!v:` in the emitted bytes, and a DEAD marker stranded inside a comment still matches — so it read the identity as preserved while a fresh uuid had been minted beside it. It asks the parsed node's `uuid` attr now. The same pass found the `\ex` leg satisfied by the paragraph fix rather than by the splitter carrier, so a comment-BEFORE-prose shape was added, which is the one that reaches it.

**Residuals, stated.** The carrier is scoped to the MAIN document body: `footnote-content.ts`, the second inline parser (card bodies and `\footnote{}` arguments), keeps escaping `%` to `\%` — correct there by the argument rule above, and a deliberate asymmetry rather than a fork to close. A mid-line `% \end{env}` after prose is still read as live by both the scan and the boundary gate, which is 338's own stated residual, unchanged in kind. And the two paragraph legs of the round trip move bytes exactly once: an anchor typed before a comment is canonicalized to sit after it, and a paragraph ending in a comment inside an expex body gains one blank line before its `\xe`.


#### The position half: a marker is DETACHED where it is APPENDED

Same round trip, and the case where one marker's two halves each stated its position independently — with a comment in the emitter asserting that they agreed (task 348). Every block emitter appends its `%!v:` anchor after its own last byte, which is where `stripUuidAnchor` takes it off; the **`listItem`** did not. It wrote the anchor after the item's HEAD LINE and let tail children follow beneath it (`\item Head. %!v:me` / `\begin{itemize}…\end{itemize} %!v:child`), while `ITEM_TRAILING_UUID_REGEX` read from the end of the whole item SLICE. For an item with a tail those are different places, and neither is exotic — a sub-list under a bullet, or a bullet with two paragraphs.

Measured through the real save pipeline, two consecutive saves of Virgil's OWN canonical output: the item took whatever uuid sat at its slice end — for a nested list, **its own child's** — and the child was re-minted as a duplicate. It **never converged**: every save shuffled again, on a document nobody was editing, so any note / todo / archive / marginalia card anchored to that item or that sub-list pointed at a uuid that had moved to a different node, and the disk ledger, the `DiskWatcher` and git all saw a moving `.tex`. The un-consumed head-line marker then rode the next parse as content (pre-347 it was `\%`-escaped into printed text; post-347 it survives as comment bytes — the identity defect underneath is the same either way).

> **Where a marker is written and where it is read are ONE rule, stated once. A construct's `%!v:` anchor is APPENDED to the end of its serialized body and DETACHED from the end of that body — [`appendUuidAnchor` / `detachUuidAnchor`](src/lib/uuid.ts), exact inverses, and nothing spells the token by hand.**

Six rules it earned:

- **Put the anchor where the reader can find it WITHOUT knowing the structure.** The reader has a flat slice; only the emitter has the node tree. So the position that can be stated once is the one that needs no structural knowledge — the end. Reading from the head instead was the smaller diff and is not generally possible: an item whose head paragraph WRAPS across lines (ordinary hand-written LaTeX) puts the head's last line somewhere no flat rule can identify.
- **Stacking is safe because the detach takes exactly ONE, greedy-prefixed.** An item whose last tail child is uuid-bearing now ends `\end{itemize} %!v:child %!v:me`, and the greedy prefix means the LAST anchor wins — innermost-first by construction. This is why the item's door is **not** `stripUuidAnchor`, which consumes a whole RUN: sharing that one would recover the parent's id by destroying the child's. A block never has this shape (its inner children serialize with uuids suppressed), which is the honest reason the two doors differ rather than a tidier one.
- **The upgrade is part of the fix.** Reading an existing document with the new rule alone would take the slice-end anchor exactly as the pre-fix reader did — shuffling every nested item's identity ONE more time on the upgrade save, orphaning the cards this task exists to protect. `detachItemAnchor` therefore carries a narrowly-signed legacy branch: more than one line AND the FIRST line ends with an anchor. Under the current emitter a tail-bearing item's first line ends with the head's prose and a single-line item has no second line, so neither can be mistaken for it; and it is deliberately the FIRST line rather than "any line but the last", since a deep nesting puts a grandchild's `\end{itemize} %!v:…` on a non-last line and a looser rule would steal it. **Stated gap:** a legacy item whose head WRAPPED is not recoverable — it degrades to the pre-fix behaviour once and is stable after.
- **The SEPARATOR was the same defect in the structural axis, and its rule is the PARSER's own.** The head was joined to the tail by a single `\n`, which does not end a paragraph — so an item with a second paragraph came back MERGED into one on the next open, the user's paragraph break destroyed with no edit, and since 347 a comment line inside an item does the same. The separator now asks [`startsBlockBoundary`](src/lib/latex-lexer.ts), the predicate `readParagraph` itself reads (moved to the lexer leaf so both halves can reach it). A nested `\begin{itemize}` is self-delimiting, so it keeps its single newline and **every existing document's nested lists reformat by nothing at all** — which a hand list of self-delimiting child kinds would also have achieved, and would have gone stale the way 342's did.
- **The token's EMIT form is spelled once, everywhere.** The fifteen hand-built `` ` %!v:${uuid}` `` strings in the serializer (and the `%!v:blank` sentinel) now go through `uuidAnchorSuffix` / `uuidAnchorToken`. Byte-neutral — the whole round-trip corpus is the proof — and it is what gives the census something to ask.
- **The pre-fix suites could not see any of this, and the reason is the fixture.** Every list round-trip suite spells its items with a SINGLE paragraph, where the head line IS the slice end and the two positions coincide by accident; the disagreement is unrepresentable in all of them. Nothing about care would have helped.

CI: [list-item-anchor-position.test.ts](src/lib/__tests__/list-item-anchor-position.test.ts) drives the REAL `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over FOUR cycles per item shape (a single trip looks perfect for the two-paragraph case and merely *starts* the shuffle for the nested one), keying every uuid by STRUCTURAL PATH so a steal reads as two changed paths and a re-mint as one, with the simple and wrapped single-paragraph items as passing CONTROLS. The leg with teeth is the **census**: the pair was never the part that could misbehave — an emitter spelling its own template is, and that is exactly what shipped. Measured by neutering each half in turn: the pre-fix pair takes 10 legs, the separator 2, the upgrade branch 3. The emit position ALONE takes 1 — the wrapped head with a tail — and that is recorded rather than hidden, because the upgrade branch is a fully general reader for a single-line head and masks a reverted emit everywhere else; that shape is in the fixture list precisely to keep the emit rule honest.

**Residuals, stated.** The census covers the EMIT form; the READ side still has four private `%!v:` regexes (`stripUuidAnchor`, `latex-paragraph-map`, and the two preamble helpers) answering differently-shaped questions — a separate sweep, not claimed here. `exampleItem` was checked rather than assumed and does **not** share this bug: it carries a `\vxid{…}` PREFIX marker, which is positionally bound to the item's own token and needs no end-of-body rule; `blockquote` serializes its children with uuids suppressed and anchors after `\end{quote}`, measured stable. Two adjacent quirks were measured while checking those siblings and left alone as pre-existing and independent: a multi-paragraph `blockquote` glues its `\end{quote}` onto its last paragraph (top level and inside an item alike), and `parseExampleBodyAsBlocks` DROPS a nested `itemize` inside an expex `\a` item outright — the second is content loss and is recorded for triage rather than folded in here.

#### The provenance half: a construct with no representation becomes PROSE, and the escape table then decides its meaning

Same round trip, and the case where the carrier rule was applied to environments (342) and comments (347) and never to the things a COMMAND is made of — its arguments — nor to the two ACTIVE characters a document is written with (task 349). The escape/typography rungs are correct about prose and are handed bytes that were never prose, so they rewrite them as if the user had typed those characters. All seven members; every one was a **fixed point** (no later save healed it) and every one landed on OPEN, since `readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad` unconditionally:

- **A command's THIRD argument (M1–M3).** The unknown-`\command` reader consumed `[…]` groups only BEFORE the braces and capped the braces at TWO, so the third fell into the prose buffer and its braces were escaped as literals. `\definecolor{myblue}{rgb}{0.2,0.4,0.8}` and `\resizebox{3cm}{!}{Some content}` reached the compiler with two arguments and **the paper stopped compiling**; `\addcontentsline{toc}{section}{Introduction}` still compiled and silently produced a wrong ToC plus stray printed text, which is worse in one way — nothing tells the user. The fixed ORDER was the same defect one axis over: `\newcommand{\x}[1]{…}` puts its optional argument after a brace, so the bracket loop had already finished and `[1]` was escaped to `{[}1{]}`.
- **A break's own argument run (M4).** `\\[2pt]` — the residual task 341 recorded — needed TWO fixes, and either alone leaves the bytes wrong. `readParagraph`'s `\[` test fires at the SECOND backslash of `\\[`, where the accumulated `result` holds only ONE, so the `/\\\\\s*$/` guard that exists to suppress exactly this break can never match for the abutting shape: the paragraph split, `Line one\` was emitted with a dangling backslash, and `\[2pt]` became an **unterminated display-math opener**. And with the split fixed the `[` still fell into the prose buffer, where task 037's `protect` member wrapped it as `{[}` and the PDF printed a literal `[2pt]`.
- **A `~` TIE and a bare `{…}` GROUP (M5, M6).** Both are ACTIVE characters in bare unmarked text, which is the residual task 339 recorded against its own table: `emit: "always"` wrote `\textasciitilde{}` for a tie and the parse rung collapsed BOTH spellings to the same character, so `Fig.~1` and `Section~\ref{sec:a}` — the standard idiom — came back as a **printed tilde**, unrecoverably (nothing downstream could tell a promoted tie from one the user meant). A bare `{a, b}` is a LaTeX GROUP: it scopes and prints nothing, and escaping it to `\{a, b\}` **changes what the PDF says**.
- **A non-Latin accented letter (M7).** `typographyToLatex` NFD-decomposed anything and folded any combining mark `ACCENT_TABLE` knew, so Greek `ή` was written to disk as `\'{η}` and Cyrillic `й` as `\u{и}` — **stable inside Virgil forever** (the parse rung composes them straight back to the same glyph) and wrong in the `.tex`, where an accent command over a non-Latin base is an `inputenc`/pdflatex error.

> **A byte that arrived as LaTeX leaves as LaTeX. Where a construct's arguments are part of the construct, the atom carries ALL of them; where an ACTIVE character has a Unicode counterpart, the provenance lives in the DOCUMENT MODEL as two different characters; and a transform defined over one script asks the SCRIPT, not the code point.**

Nine rules they earned:

- **A cap of two is a hand list wearing an integer's clothes.** [`matchCommandArgumentRun`](src/lib/latex-lexer.ts) consumes every abutting group in whatever ORDER, bounded three ways rather than by a guessed count: the SSOT scanners (`extractBraced` / `extractBracketed`) FAIL CLOSED on an unbalanced group, so the run ends exactly where the pre-349 code ended; a group spanning a blank line is refused, which bounds a caller that hands over a wider slice than one paragraph; and the group count is capped at TeX's own `#1`…`#9`. Unbounded consumption is what task 338 spent a whole task preventing, so the bound is stated rather than assumed.
- **It closed three fork divergences on the way past** (341's twin rule). `footnote-content.ts` had its own copy of the cap AND of the fixed order, and — unlike the main parser — **no `{[}`-protection check at all**, so a prose bracket abutting a command was folded into it there and not here. One door, one answer.
- **Ask `isEscaped`, not a wider `/\\\\/` guard.** The M4 boundary fix states the rule at the right altitude — a construct begins at a LIVE backslash, never at the tail of an escaped pair — and it leaves the `\\`-then-newline case the old guard was written for reading exactly as before, since there the boundary fires at a third, unescaped backslash. `matchLineBreakAt` lives beside `startsBlockBoundary` because the two are halves of one question (where a `\\` token ENDS, and whether what follows begins a new block) and the defect was the two answering differently.
- **A bare `\\` keeps its MODEL; an argument-bearing one takes the carrier.** Virgil does not model break spacing, so `\\*` / `\\[2pt]` / `\\*[1ex]` ride the raw-LaTeX mark (342's rule) while a plain `\\` stays the `hardBreak` node Shift+Enter produces. A modelled spacing ATTR is the richer treatment and a schema change across three body surfaces; the carrier is what makes the bytes safe today. The match is ABUTTING-only, stated at the door: LaTeX skips spaces before the `*`/`[`, but reading that wider rule would swallow a genuinely prose `[` one space after a break — and the serializer's own `{[}` protection means the abutting form is the only one Virgil's output can produce.
- **A GLYPH beats a mark, where Unicode has the character.** M5 is `{ text: U+00A0, tex: "~", kind: "glyph" }` in `CHAR_ESCAPE_TABLE` — a third declared `kind`, stated because the claim differs from `escape`/`protect`: the pair is a MODEL distinction, not a safety one, and the direction that matters is INWARD. Two code points in the document is strictly stronger than a mark (which degrades the first time an edit splits or merges a run — the objection the task's own Design section raised) and it renders as what it is, a space that does not break, rather than as grey monospace between `Section` and a `\ref` chip. It is deliberately NOT in `LITERAL_TABLE` beside the dashes: that rung is suppressed for code spans, and a `~` inside `\texttt{a~b}` is a tie exactly as it is outside one. Free consequence worth knowing: a bare U+00A0 arriving by PASTE used to reach disk verbatim, where pdflatex+inputenc may refuse it, and is now written as the tie it means.
- **Nothing is dropped from the table, because the fix is PROVENANCE.** An ASCII `~` the user types as prose still emits `\textasciitilde{}`, and an escaped `\{` still parses to a literal brace and re-emits escaped. The `escape` and `glyph` members for the tilde coexist with nothing to order: `escapeLatexChars` is a single-pass character scan keyed on the character, so the two are disjoint by construction, and the parse rung is longest-`tex`-first, so `\textasciitilde{}` still wins wherever both could match.
- **M6 takes 342's carrier and marks only the BRACES.** Marking the whole group raw would grey out the user's words, which is worse than the bug for `{a, b}`; 347's comment carrier is the wrong family member, since its promise (*not typeset at all*) is false for braces that scope. `matchBraceGroupAt` is bounded exactly as `matchCommandArgumentRun` is — `extractBraced` fails closed on an unbalanced group, a blank line refuses, and "is this a `{[}` protection?" is ASKED of `CHAR_ESCAPE_TABLE` rather than re-spelled.
- **The set of POSITIONS a scanner must offer is derived too.** Both inline parsers gated the non-backslash members on a literal `text[i] === "{"`, so `~` was emitted correctly by `escapeLatexChars` and unreachable on the way back in. `CHAR_ESCAPE_LEADS` comes off the table (today `{` and `~`), so a new member is reachable by declaration alone — the same "a hand list can only be missing a name" rule 342 earned, applied to reachability instead of vocabulary.
- **A leg with no measurable byte difference is asserted on the MODEL.** Deleting the `{[}`-protection check is byte-neutral (an absorbed `{[}` re-emits raw; an unwrapped one is re-escaped by the prose rung), so a byte assertion there has no teeth. What actually differs is whether the user can EDIT those characters — grey-monospace raw LaTeX versus prose — which is the whole reason the rule exists, so that is what the leg reads.

CI: [non-prose-bytes-roundtrip.test.ts](src/lib/__tests__/non-prose-bytes-roundtrip.test.ts). Every pre-349 round-trip suite spells its fixtures the way the code it tests happens to handle them and exercises one construct at a time, so a command's third argument — or a Greek accented letter — reaching the escape table was **unrepresentable** in all of them. Each leg drives the REAL save pipeline over TWO cycles (cycle 1 is where the loss happens, cycle 2 proves nothing accumulates), with the controls through the identical harness: `\textcolor{red}{warning}`, a bare `\\`, a prose `[` after a break, an unterminated `\\[` and an unbalanced `{`, `café` / Vietnamese `ặ` / `søster`, a `~` inside `\url{}` / `\verb` / math / a comment tail, and an ESCAPED `\{` plus a brace typed in the EDITOR — the two controls that keep the prose direction honest. The leg with teeth is the **CENSUS**, because both fixes are shared DOORS and a behavioural test of a door structurally cannot see a SCANNER that never asks it — which is exactly what shipped. It requires both inline parsers to gate on `CHAR_ESCAPE_LEADS` and to carry a group through `matchBraceGroupAt` (341's twin rule), sweeps both silos for a `matchCharEscapeAt` caller that skips the derived set, and asserts the files it EXAMINED are exactly the two scanners so a needle matching nothing cannot pass for the wrong reason. Measured by neutering each half in turn: the pre-349 cap+order takes 7 legs, the M4 boundary gate 4, the M4 carrier 3, the accent script guard 3, the `{[}` protection 1, the M5 glyph member 7, the M6 group carrier 6, a hand-gated lead set 8, and a card fork that stops calling the group door 2.

**Residuals, stated.** M5 changes two derived numbers that are not bytes: a tie is now WHITESPACE to `word-count-core`'s `/\s+/` split, so `Fig.~1` counts as two words rather than one (arguably the truer answer — the PDF prints two — but a visible change), and the same is true of any plain-text projection. Search is unaffected in either direction: neither `~` nor U+00A0 ever matched a typed space. M6 is scoped to a BARE group the source already carried as syntax; the tie is scoped to the MAIN document body and the card-body fork, and `footnote-content.ts` still escapes `%` to `\%` for the reason 347's residual gives. One byte does move exactly once on a group holding a trailing comment (`{a % c}` gains the newline `closeCommentTail` owes it) — which CLOSES a group the source had left open, and is a repair rather than a rewrite.

#### The type-time half: a carrier applied when the bytes are WRITTEN, not when they are read

Same round trip, and the case where every rule above was correct and the
DOCUMENT MODEL had a fourth carrier nobody had declared (task 360).

`latexVerbatim`, `latexCommentTail` and `latexCommand` each say what their bytes
are. A BARE text node says nothing — and it was carrying raw LaTeX all the same:
`tiptap/latex-command.ts`'s decoration plugin exists precisely to paint a
bare-text `\command` span grey-monospace WHILE THE USER TYPES IT, without
marking it, and the autosave fires 1500 ms later. So `escapeLatexChars` was
handed a run that was raw LaTeX by intent and prose by document model, with no
way to tell them apart. Task 339 shipped the only honest guess available — *a run
with no backslash cannot be LaTeX, so escape it whole; a run with one is
ambiguous, so leave its ambiguous members alone* — and filed two residuals:
a source `\textbackslash{}emph` came back as a LIVE `\emph` on the first save,
and a run mixing a literal brace with a typed command kept its braces raw, so
`see {this} and \emph{that}` lost its printed braces to the PDF.

> **Bare text is PROSE, by construction.** A raw-LaTeX span takes the
> `latexCommand` mark as soon as an edit WRITES one — in the same dispatch, from
> the same lexer door the parse rung reads — and the two inline parsers carry a
> CONTROL SYMBOL rather than buffering its backslash. The vocabulary at a
> backslash is then TOTAL, so `CHAR_ESCAPE_TABLE` emits its whole vocabulary
> unconditionally and the `emit` field that declared the narrowing is deleted
> with it.

Six rules it earned:

- **Promotion needs a WRITER, and that is a PROVENANCE rule before it is a cost
  rule.** The carrier marks only a construct the transaction's own changed ranges
  TOUCH. Merely existing is not evidence: a literal backslash that arrived from a
  source `\textbackslash{}` is byte-identical to a typed command, so promoting it
  on an unrelated keystroke elsewhere in the paragraph would re-create the very
  corruption this closes. That the correctness rule and the keystroke-sanctity
  rule turn out to be the SAME rule — *look only at what the edit did* — is what
  makes the cheap implementation the correct one rather than a compromise.
- **A document REPLACEMENT is not a writer.** `setContent` (the load, the
  code-pane bridge's re-parse) replaces `0…docSize` in one step and its content
  already carries whatever marks the parse rung decided; scanning it would
  promote every literal backslash in the file, on OPEN, with no gesture. Detected
  by TipTap's own `preventUpdate` meta plus a structural whole-doc test as the
  backstop for a raw dispatch. Undo/redo is skipped through prosemirror-history's
  exported `isHistoryTransaction` — restored content must keep exactly the marks
  it had, and a re-derivation there ping-pongs.
- **The vocabulary is the LEXER's** — `scanRawLatexSpans` reads the same doors,
  in the same order, that both inline parsers read at a backslash (line break →
  control word + `matchCommandArgumentRun` → accent → `matchControlSymbolAt`). A
  local copy is how the decoration's own `matchCommandLength` came to cap
  arguments at two and know nothing of task 349's argument-run rules.
- **A typed `{…}` group is LaTeX only if it CONTAINS LaTeX, and that asymmetry
  with the parse rung is deliberate.** 349 M6 carries the braces of EVERY bare
  group, because a group in the SOURCE is syntax the source already carried; a
  group the user TYPES is not — `see {this}` is prose whose braces must print.
  So 339's evidence rule is applied at GROUP granularity here. Both answers are
  fixed points (a typed `{this}` saves as `\{this\}` and parses back to literal
  braces; a source `{this}` saves as `{this}` and parses back to a group), so
  nothing oscillates.
- **The control symbol is the member that makes the vocabulary total, and it was
  found by MEASUREMENT.** Both parsers' unknown-command fallback reads a control
  WORD; everything else at a `\` fell into the prose buffer. Against this repo's
  own corpora `\;` (16), `\ ` (14) and `\,` (9) occur in ordinary body prose —
  `U.S.\ Route`, the standard abbreviation idiom — and they round-tripped ONLY by
  the accident that the escape rung refused to touch a backslash. Once `\` is
  escaped unconditionally an un-carried `U.S.\ Route` reaches the `.tex` as
  `U.S.\textbackslash{} Route`, a printed backslash. Two twin divergences closed
  at the same door: the card fork buffered `\\` as two literal backslashes, and
  the main parser buffered an UNKEYED cite name (`\citep and more`) where the card
  fork already reached the marked answer through its unknown-command fallback.
- **`inclusive: false`, the boundary its two siblings already took.** ProseMirror
  defaults marks to inclusive, so prose typed at the trailing edge of a command
  INHERITED the carrier — which is why `serializeMarks`' latexCommand branch
  smart-quotes at all. With the mark derived from the text, inheritance is not
  merely unnecessary but wrong, and the scanner re-extends the mark itself while a
  command is still being typed. Deliberately NOT `code: true` unlike the other
  two: smartening a typed quote inside a `\command` run is what keeps a stray
  inherited mark emitting valid `.tex`, and that net stays.

**And the decoration and the mark are now the SAME state, which they have to
be.** A `AddMarkStep` carries an EMPTY step map, so neither of the decoration
plugin's probes could see the promotion, and a decoration left standing over a
now-marked run painted a second `.latex-cmd` over the one the mark renders
itself. The set is rebuilt whenever this mark's presence changes (O(steps)).
Recorded residual: a literal backslash from a source `\textbackslash{}` is still
painted grey by the bare-text decoration although it emits escaped — the one
place the grey and the bytes disagree, and the one that promotion-on-write turns
into a command the moment anyone edits it.

CI: [typed-raw-latex-carrier.test.ts](src/lib/tiptap/__tests__/typed-raw-latex-carrier.test.ts).
Every leg drives a REAL editor and types CHARACTER BY CHARACTER, because the
defect lives in the gap between what a keystroke leaves in the document and what
a save then makes of it — a shape no parse→serialize suite can reach, which is
why 339 could only describe it. Both surfaces are driven (the card body is a
second inline parser AND a second editor), the cost legs count entries into the
lexer door (one keystroke in a 60-paragraph document scans ONE block; a block
with no `\` and no `{` scans none), and `char-escape-table-ssot.test.ts` loses its
one derived exemption — every member round-trips from source now, and the block
that asserted *a bare text node is a real carrier* is renegotiated in place to
assert the opposite with the reason at the site. Measured by neutering each half
in turn: the carrier plugin takes 15 legs, the unconditional escape 21, the
promotion gate 2, the replacement gate 1, the history gate 1, `inclusive: false`
3, and the control-symbol carrier 6.

**Residuals, stated.** A select-all-then-type replaces the whole document too, so
raw LaTeX arriving that way is not promoted — escaped as the literal characters
it is, which round-trips; a missed promotion, never a corruption. A char-escape
spelling typed by hand (`\%`, `\&`) takes the carrier here and is un-escaped to
its literal character by the next parse, so the grey heals to a plain glyph on
reload — the type-time and parse-time answers differ by design, and both are
fixed points. Inside a `\texttt{}` span a control symbol splits the wrapper
(`\texttt{a\,b}` normalizes once to `\texttt{a}\,\texttt{b}`, idempotent
thereafter), which is the price of carrying bytes the fork used to destroy.
**Owed, not claimed:** a preview eyeball of the type-time feel — typing
`\emph{hi}` in prose, saving, reloading.

#### The dispatcher half: the LAST layer that still read "unterminated" as "yours"

Same round trip, and the case where the law had been written down twice, applied
twice, and left unapplied at the branch that fires most often (task 356). Task
350 closed `\ex` and `\begingl`; the lexer's own `skipOpaqueConstructAt` states
the policy outright ("Unterminated ⇒ TRANSPARENT"). The generic `\begin{env}`
DISPATCHER — the branch every list, quote, figure and unmodeled environment
enters — still took `ctx.src.slice(ctx.pos)` and `ctx.pos = ctx.src.length` when
`findMatchingEnv` answered -1.

Four members, and the order below is the order they bite:

- **The dispatcher's EOF slurp.** The whole document tail became one environment
  body, and the modeled branches then kept only what their node can hold —
  `parseList` keeps `\item` slices, `figure` keeps its recognised attrs — so the
  tail was DESTROYED, not merely mis-shaped. The serializer then wrote the
  `\end{X}` the user never typed, making it a fixed point. **The routine trigger
  is not a typo'd or commented-out close: it is TYPING.** In the code pane the
  user writes `\begin{itemize}` and, for the seconds before the close exists,
  every keystroke re-parses a document whose tail is inside that environment.
- **`splitListItems` destroyed an item-less body on WELL-FORMED input.**
  `firstItemPos > 0 ? content.slice(0, firstItemPos).trim() : ""` conflated "no
  `\item` anywhere" (-1) with "an item at offset 0" (no preamble), so a body with
  content but no item reported zero items AND an empty preamble, and `parseList`
  substituted one empty `listItem`. `\begin{itemize}\input{bullets}\end{itemize}`,
  a tuning-only body (`\itemsep`), items hidden inside a `verbatim` — every byte
  gone, emitted as `\begin{itemize}\item\end{itemize}`. No unterminated close, so
  no fail-closed arm anywhere could have caught it.
- **The title family was TWO scans that disagreed twice.** Neither
  `stripTitleFieldsFromText` nor `parsePreambleTitleFields` predated the
  `%`-projection SSOT, so `%\title{old draft}` above the live `\title{…}` was
  PROMOTED to be the document title while the real one was stripped and never
  emitted — and the strip swallowed the trailing newline, fusing the orphaned `%`
  onto the NEXT preamble line and commenting that out too. And the strip was
  strip-ALL against a keep-FIRST parse, so an `amsart`/ACM multi-`\author`
  preamble lost every author but one. All of it under the 350-D gate's word slack.
- **expex `[opts]` were filtered down to `exno=`.** `[everypar={\itshape}]`,
  `[aboveexskip=1ex]` and every other key were consumed and discarded — a
  typographic instruction destroyed on OPEN, costing zero words.

> **"Unterminated ⇒ transparent" is a law about the LAYER, so it holds at every
> layer: a construct whose end nobody can find is not that construct, and the
> parser puts its cursor back on the opener and carries the bytes. And a modeled
> branch that meets a body outside its model has exactly two honest answers —
> carry the whole environment, or throw. Never keep the fraction it recognises.**

Five rules it earned:

- **The refusal is the CARRIER, spelled once.** `pushVerbatimEnvCarrier`
  ([latex-parser.ts](src/lib/latex-parser.ts)) was the environment dispatcher's
  `default:` arm and is now also what a modeled branch takes when it refuses —
  task 342's rule ("what the system does not model, it CARRIES") read one level
  in, at the BODY instead of at the env name. `parseList` answers `null` and the
  caller carries; routing the body through `listPreamble` was the other candidate
  and is strictly worse, since the serializer would then emit an `\item` the user
  never typed.
- **A refusal is scoped to a body with CONTENT.** A genuinely empty
  `\begin{itemize}\end{itemize}` is not a refusal — there is nothing to lose, and
  the one-empty-item node is the editable thing the user wants.
- **Two scans of one question is the defect; ONE scan read by both halves is the
  fix.** `findPreambleTitleFields` is comment-aware through `matchCommentTailAt`
  (TeX's rule, escape-aware, so `\%` is never a comment and a mid-line `%` still
  shadows the rest of its line), and `hoistablePreambleTitleFields` states the
  shared rule: a field is hoisted only when it occurs exactly ONCE live. A
  repeated field stays RAW in the preserved preamble, in its original order.
  **Order is why the obvious symmetric fix is wrong:** hoisting the first and
  leaving the rest raw re-injects the first into the canonical block just before
  `\begin{document}`, which moves the FIRST author to LAST. Cost, stated: a
  multi-author paper's authors are not editable from the title strip. Data over
  affordance.
- **`exno` is INTERPRETED and the rest is CARRIED, and the two cannot drift.**
  `rawOptions` holds the raw bracket run and the serializer emits it verbatim,
  falling back to `[exno=N]` only for a node built programmatically (no source
  bytes). `exnoOverride` stays parsed because the renumberer reads it — and
  nothing WRITES it, which is what makes carrying the raw run safe rather than a
  staleness hazard.
- **A guard that overstates its reach is the thing being fixed.** Two shipped
  suites pinned the pre-356 losses as intended behaviour — `unmodeled-env-roundtrip`
  spelled its list fixture as a bare `body` (passing only because that body was
  destroyed), and `latex-roundtrip-titles` asserted outright that a duplicate
  `\title` is DELETED, "first occurrence wins". Both are renegotiated in place
  with the reason at the site, not quietly re-scoped.

Same pass closed the census's own `%!vtex:begin` twin (a stranded begin marker
folded the document tail into one opaque texBlock, or deleted its own line) and
two silent whitelist drops in the serializer that are unreachable from the parser
today — which is exactly why they had been left dropping: `listItem` took
`children.slice(1)` while emitting an empty head whenever child 0 was not a
paragraph, and the two example-family if/else-if chains, which match the schema
TODAY, had no terminal `else`.

**Verdicts on the rest of the census's triage list, recorded rather than skipped:**
`tokenizeGlossCells`' `cells.join(" ")` and the `latexComment` trim are
whitespace-only normalizations that are fixed points — safe. `stripFigureOwnCommands`
cuts exactly the ranges the serializer re-emits from attrs, which its own comment
states and the round trip proves — safe. `serializeNode`'s `default:` arm (emits
children, drops the wrapper) and `serializeInline`'s childless `return ""` are
REAL silent drops and are deliberately NOT fixed here: making them refuse needs a
decision about what a refusal on the SAVE path does, which is task 357's subject
(the 350-D gate's refusal is itself inert today). Footnote `richJsonToLatex`'s
flattening (a list becomes `· a; · b`) is a modeling gap in the card-body schema,
not a member of this class.

CI: [content-loss-round-2.test.ts](src/lib/__tests__/content-loss-round-2.test.ts).
Every pre-356 env / list / title fixture in the repo is WELL-FORMED and
single-valued, so each of these losses was **unrepresentable** in all of them —
which is how they shipped green. Each leg drives the REAL save pipeline over TWO
cycles (cycle 1 is where the loss happens; cycle 2 proves nothing accumulates,
and every one of these was a fixed point) with controls through the identical
harness. The leg with teeth is a SOURCE CENSUS over both parsers: any assignment
that lets a cursor or a bound reach the end of a source string must carry an
`unterminated-ok:` justification within the eight lines above it — no allowlist, a
hit is JUSTIFY-it or FAIL-CLOSED-it, and the eight surviving sites are justified
in place (line-bounded comment scans, or already-bounded bodies). The census reads
CODE, which this task's own fixes make load-bearing: they explain themselves by
quoting the pre-fix line verbatim, so a raw-source grep would flag its own
explanation. `_source-scan` gains a LINE-ALIGNED mode (`codeOnlyLines`) for it —
the fourth private stripper variant this repo was about to grow. Measured by
neutering each half in turn: the env fail-closed arm takes 4 legs + the census,
the list refusal 6, the title comment-awareness 2, the title symmetry 1 (the
orphaned-`%` leg needs BOTH, which is what the pre-356 tree actually was), the raw
options 2, the vtex arm 1 + the census, the two serializer drops 1 each, and a
single dropped marker the census alone.

**Owed, not claimed:** a real-FSA eyeball. Everything here is proven by the unit
contract; the code-pane mid-typing trigger in particular is worth watching once in
the running app.

### The membership half: a per-kind capability is spelled once, and its guard is the sibling every other facet already has

Same law, fifth tense (task 259) — and the case where the dead facet and the missing guard were the *same* fact.

`CARD_REGISTRY[k].stackable` had **zero production readers**: nothing anywhere asked it. Meanwhile "which card kinds the Stack carries" was hand-restated in six more places that all had to stay in lockstep — the `StackCardKind` union, the `StackCardSnapshot` payload union, each float's `snapshotForStack` being a real `snapshotCard(…)` vs `() => null`, `CARD_PLACEMENTS`, the `applyCardDrop` switch, and the `snapshotCard` / `summarizeStackItem` switches — plus a hand-kept array in `float-snapshot.test.ts` and a `StackPullApi` whose per-kind factories were partly optional. Only one of those (`CARD_PLACEMENTS`, a `Record` over the union) was compile-enforced.

**Every failure mode was silent, and they were silent in different directions**: a missing `applyCardDrop` case meant the bar painted, `classifyDrop` said `apply`, the gesture completed and **no card was created**; a missing `snapshotCard` case returned null, and the drop handler closes the float *outside* its `if (item)` guard, so the popout vanished with nothing on the Stack; an optional `StackPullApi` method reached through `?.` no-oped for a whole kind. None is a type error, none throws, and no round-trip suite catches any of them, because each suite spells the vocabulary the same way the code it tests does.

And the facet had already drifted, exactly where the guard would have caught it: `example` declared `stackable: true` with a `() => null` snapshot, an empty placement list and a documented placeholder pull branch — **stackable in name at every link of the chain and in fact at none.** Alone among the drop-adjacent facets, the Stack had no coverage assertion; `assertMorphCoverage`, `assertContentCoverage`, `assertDropFacetCoverage` and `assertPanelTypographyCoverage` each pin theirs to the real mechanism.

> **Declare a per-kind capability ONCE, derive the union from that declaration, and pin every remaining mirror to it — by the compiler wherever the mirror is data, by a boot assertion where the two mirrors are static, and by a contract test where only a built object or a real dispatch can answer. A capability whose mechanism isn't built is declared `false` and left out of the vocabulary, not carved out of the guard.**

[src/lib/stack/card-kinds.ts](src/lib/stack/card-kinds.ts) is the declaration (`STACK_CARD_KINDS`, with `StackCardKind` derived from it) plus the `CardKind ↔ StackCardKind` bridge — `bib` ↔ `bibliography` is the one name the two vocabularies disagree on, and it was hand-spelled at four sites. Four rules it earned:

- **Put the SSOT where the layer that must read it can reach it** — the same rule the marker vocabulary earned. `card-registry.tsx` is a documented runtime LEAF (a heavier import re-forms the `panel-registry → predicates → card-registry → …` cycle), so the vocabulary lives in a module with **zero runtime imports** rather than in `stack/types.ts`, which carries its own `@/lib/types` edge. `stack/types.ts` re-exports it, so no consumer changed.
- **Three tiers of pin, chosen by what each can actually see.** COMPILER: `CARD_PLACEMENTS` is a `Record` over the union, `StackCardSnapshot` is held to it by an `Exact<>` assertion at the declaration, and all four dispatch switches carry `const unhandled: never` arms (the local idiom — `default: { const x: never = v; void x; return <safe default>; }`, never a throw, since the payload comes from a shallowly-validated `localStorage` envelope). BOOT: `assertStackCoverage()` pins `stackable ⇔ in the vocabulary`, `stackable ⇒ poppable` (the only capture path is a popped float's `snapshotForStack`), and the bridge's injectivity. TEST: the two mechanisms neither can reach — whether a *built* `Floatable` really snapshots, and whether each `applyCardDrop` arm really calls its factory.
- **An optional per-KIND method is a missing switch case wearing a different hat.** Every `StackPullApi` factory is now required; optionality is reserved for per-FIELD enhancements, where absence loses a side-channel rather than the card — and even `setAnnotation` failed that test (an absent one silently dropped the user's bib note on every cross-doc pull), so the *call* stays conditional and the *method* does not.
- **No allowlist, and that is the load-bearing choice.** `assertContentCoverage`'s `allowedNull` carves out kinds that legitimately have no content — a true statement. There is no true statement of the form "this kind is stackable but cannot be stacked", so `example` left the vocabulary rather than entering an exception list: re-add it WITH its first real mechanism (synthesizing an `exampleBlock` on pull), after which the compiler names every other site. Removal is safe by evidence, not by assumption — `git log --all -S` shows no build ever wrote an `example` snapshot, and a hand-planted blob fails closed through the same retired-kind path the suite pins.

CI: [stack-coverage.test.ts](src/cards/__tests__/stack-coverage.test.ts) — the boot assertion silent on the real registry and loud on each drift shape *individually* (so a future edit that guts one branch fails), plus the mechanism legs. The one that catches the ORIGINAL shape is per-kind: drive the REAL `applyDrop` against a recording `StackPullApi` and require a required-factory call, because a kind declared in all six places whose branch does nothing is exactly what shipped. [float-snapshot.test.ts](src/cards/__tests__/float-snapshot.test.ts)'s hand-kept list is retired — it now sweeps `CARD_REGISTRY[k].stackable` and asserts the null half too, from a resolvable record (a `Floatable` that built and *refused*, not one that failed to resolve). Note the honest limit these share with their four siblings: the assertion `console.error`s rather than throwing, and `morphs/index.ts` loads on first sidecar-hook use — so the suite's spy, not the app, is where it has teeth.

### The consolidation half: a helper only SOME siblings call is not an SSOT

Same law, sixth tense (task 273) — and the one where the SSOT was already *written*. `dockOpen` was deliberately extracted as **the** shared docked-open helper, owning three invariants a caller is apt to drop: the **sentinel clear** (a docked band's `[data-dock-slot]` portal target only exists in an expanded, non-blank column), the **cap + LRU eviction**, and the **MRU coupling** (a band that leaves a stack leaves the recency list). Then the consolidation stalled. `redockPanel` re-implemented insertion inline; five setters re-derived the close branch; three re-derived the mode-dispatch/float-open branch; and `clampStack` carried its own `max = 3` beside `MAX_STACK`, with the sole caller passing nothing — so the LOADER owned a second ceiling that a future bump would have left silently truncating a runtime-legal stack.

> **A shared helper is an SSOT only if every sibling path calls it. Half an extraction is worse than none: the invariants the helper encodes drift out of each path that re-derives them, one silent omission at a time — and the next agent reads the helper as the enforced path.**

The proof is what the gap cost: `redockPanel`'s inline copy never cleared the sentinel, so dragging a float onto a *collapsed* side inserted the band and left the column folded — the panel's portal target absent, the panel rendering nothing (task 272, patched surgically at the symptom; retired here at the root, where it falls out for free). Nothing failed: the setter ran, the state was well-formed, every test was green.

[src/hooks/view-prefs-dock.ts](src/hooks/view-prefs-dock.ts) is the engine — `placeInStack` (insertion: sentinel clear, `panelModes`, prior-float + prior-dock shed, cap + `leastRecentlyUsed` eviction, index-or-append, MRU bump) and `removeFromStack` / `closePanel` / `closeAllPanels` / `floatOpen` / `undockToFloat` / `openInMode`. Four rules it earned:

- **Extract to a module, not to a closure.** The old helpers lived *inside* the hook body, so nothing could test them without `renderHook` + jsdom + the storage/BroadcastChannel mocks — which is why the sibling paths were only ever pinned end-to-end, and why a missing sentinel clear had no cheap contract to violate. The engine is now the WRITE twin of the read-only [view-prefs-derived](src/hooks/view-prefs-derived.ts) leaf and follows the same import discipline (types only from `useViewPrefs`, so no runtime cycle), and its suite runs in the bare node env with no mocks at all.
- **Publish whole OPERATIONS, never the pieces.** `stackFor` / `withStack` / `mruFor` / `withMRU` / `bumpMRU` / `pruneMRU` / `leastRecentlyUsed` are module-PRIVATE, and `notePanelUse` is an engine operation precisely so the last of those can be. An exported piece is an invariant waiting to be skipped: a setter that can reach `withStack` + `bumpMRU` re-derives the whole insertion, omits the sentinel clear, and spells none of the census's needles while doing it — the original defect, reproducible with CI green. The public surface is pinned by the suite, so a new export is a decision someone makes on purpose.
- **A defaulted argument is a decision nobody made** — the same rule the unbridge mode earned. `clampStack`'s `max` is now REQUIRED, so the ceiling is stated by the caller from `MAX_STACK` rather than guessed by a module that isn't entitled to own it. `Function.length` pins it at runtime.
- **The optional argument that stays optional is a real fork, stated.** `placeInStack`'s `freeSpacePx` is a caller measurement; supplied ⇒ a newcomer that can't get `MIN_BAND_PX` displaces the stalest band, omitted ⇒ only the hard cap evicts. Redock passes none *by design*: a drag-drop has no measurement, and refusing a deliberate user drop — or evicting a *different* band — for breathing room is worse than a tight fit.
- **Victim SELECTION was never the broken part.** `leastRecentlyUsed` (task 251) was already shared and already correct; only a ~4-line cap-check wrapper was duplicated. Generalizing the *policy* would have been the "deep = broadest blast radius" mistake — the fix is one insertion path, not one eviction rule.

CI: [view-prefs-dock-engine.test.ts](src/hooks/__tests__/view-prefs-dock-engine.test.ts). The leg with teeth is the **census** — nothing below `loadPrefs` in `useViewPrefs.ts` may name `dockStack` / `panelMRU` / `poppedOutPanels` at all. Three details are load-bearing and each was a hole in the guard's own first draft: the needle is the BARE name, not the `dockStack:` key form (which ES shorthand — `{ ...p, poppedOutPanels }`, the realistic accident — defeats silently); string literals are KEPT and only comments stripped (blanking literals would erase a computed `p["dockStack"]`, the same unfalsifiable-leg mistake task 205 made); and the split is BELOW the loader rather than at the hook entry, so a pure helper hoisted to module scope — a zero-behavior-change cleanup — can't walk out of the guard. Alongside it: the engine's export list is pinned (see the operations rule above), and `clampStack`'s signature is pinned by SOURCE as well as arity, because `max?: number` erases at emit and reports the same `Function.length` while making `out.length >= undefined` always false — no ceiling at all, a worse regression than the drifting second one. A test of the engine alone structurally cannot catch any of this: the engine was never the part that misbehaved. Every needle fails on the pre-fix tree. Two limits are stated in the suite rather than papered over — the region above the split is exempt by construction, and the float half's `panelModes` / `floatPositions` can't be censused (`setFloatPosition` writes them legitimately).

#### The writer half: a generic API only SOME keys use is the same stall, one door over

Same file, same class, the *write* side (task 274) — and the case where the SSOT was not merely half-consolidated but half-consolidated **per kind**. `VIEW_PREF_REGISTRY` generated the store shape, the shipped defaults and the global-key set; a registry-driven `setViewPref(key, value)` / `toggleViewPref(key)` was added on top, the three newest Display toggles were routed through it — and the migration stopped there. Ten hand-written twins survived beside it, each byte-equivalent to the generic path for its `kind`: four boolean togglers (`toggleParTitles`, `toggleLatexComments`, `toggleMarginalia`, `toggleHeadingLabels`) plus a fifth wearing a value-setter's clothes (`setShowHighlights`, whose only caller was `() => setShowHighlights(!prefs.showHighlights)`); two enum setters (`setDividerWidth`, `setBibFilter`); and three copies of one includes/filter/append (`toggleHighlightType`, `toggleMarginaliaType`, `toggleDividerLevel`), which existed only because the generic API had **no `set` door at all** — `toggleViewPref` early-returned on non-toggle and `setViewPref` could only overwrite the whole array. `reader-view-prefs.ts` mixed both call forms inside a single object literal, five lines apart.

> **A generic keyed API is an SSOT only if it covers every KIND the vocabulary declares. A missing door isn't a gap — it's a standing instruction to hand-write the next twin, and each twin then drags a per-pref name through every layer between the store and the control.**

The cost was never a wrong toggle (every copy did identical naive work); it was the *thread*. One pref = one hook setter + one `EditorPaneMenuBarBundle` read field + one bundle setter + one `MenuBarProps` pair + one entry in ViewMenu's `Pick` + two rows in the checked/toggle maps + a line in EditorLayout's bundle *and* its dep array + the Reader's twin of the same. Nine artifacts per behavioural fact, none of them enforced against the registry.

Four rules it earned:

- **Complete the kinds, then the value travels by key too.** `toggleViewPrefMember(key, member)` is the missing third door, and its domain is DERIVED (`SetViewPrefKey` = the keys whose `kind` is `"set"`), so a new `set` pref joins by declaration. With all three doors present, `EditorPaneMenuBarBundle`'s twelve per-pref read fields collapse to one `prefs: RegistryPrefs` and MenuBar's twenty-five view props to five — `viewPrefs`, `availableDividerLevels`, and the three writers. A new toggle / enum / set pref is now ONE registry row and zero edits anywhere else.
- **What stays a prop is what isn't a pref.** `availableDividerLevels` (heading levels present in the doc) and `activeDividerLevels` (its intersection with the pref, which the `show-dividers-N` class tokens read) are DERIVATIONS, so they keep their own fields. The three `new Set(prefs.hidden*Types)` memos in EditorLayout and the Reader are deleted rather than moved: `prefs.hiddenMarginaliaTypes` is already reference-stable per field, so reading the array directly serves `memo()` strictly better than minting a fresh Set each render did.
- **A menu row's stable ID belongs to the registry.** The Display block was "registry-driven" for its label and membership while its row ids sat in a hand list in `MenuBar.tsx` — so a new toggle still needed a MenuBar edit. `menuRowId` is now a REQUIRED `ToggleDef` field and `toggleRowsInMenuGroup("display")` builds the block. It is declared, not derived from the key, because the ids are addressed by tests and the menu registry (`"card-outline"`, not `"card-outline-chrome"`) — a naming rule would have to be reverse-engineered from ids it must not change.
- **The `set` door deliberately does NOT validate membership.** The registry's own header says a stored `set` value may include members the MENU doesn't render (the "report" marginalia type). A `member ∈ def.members` check would silently no-op exactly those — a behaviour change wearing a guard's clothes. `members` is the render vocabulary; the stored array is the value. Pinned in the suite so a future "tightening" is a decision rather than a slip.

CI: [view-pref-writer-ssot.test.ts](src/hooks/__tests__/view-pref-writer-ssot.test.tsx). The leg with teeth is the **census**, because the three doors were never the part that could misbehave — an eleventh twin written beside them is: no registry key may appear as a literal object KEY anywhere in `useViewPrefs.ts` (the doors write `{ ...p, [key]: … }` with a *computed* key, so a literal one is a twin by construction), and the ten retired setter names + the twelve per-pref MenuBar props they fed must have zero production occurrences in either silo. Comments **and string literals** are stripped for the first needle — the opposite of the dock-engine census's choice one section up, and for a stated reason: the hook's legacy-key migration table names registry fields as string VALUES (`field: "showHeadingLabels"`), which is a read-side mapping rather than a write, so keeping literals would indict it. The needle is name-EXACT, which is the right precision: `BibliographyPanel`'s `onSetBibFilter` is a presentational prop the host binds to `setViewPref("bibFilter", v)`, not a second store door. Measured on the pre-fix tree, the census names all ten twins. The behavioural legs sweep `VIEW_PREF_REGISTRY` per kind (every toggle flips, every enum value writes, every set member adds-then-removes) rather than enumerating prefs, so a new pref is covered by declaration alone. Stated limit: the census sees the `key:` form, so a hypothetical `p["showParTitles"] = …` write would pass — no such form exists in this immutable store.

### The other half: a shared WALKER is not a shared ANSWER

Same law, seventh tense (task 122) — and the one where the SSOT was not merely half-consolidated but half-*scoped*. `word-count-core` was the canonical categorization walker (task 112) and every surface used it. What no surface owned was the FILTER: "how many words is that" reads the user's `useWordCountConfig` include-set, and that reduce lived privately inside `WordCountPanel`. So the consumers with no reduce of their own read the precomputed, unfiltered `WordCounts.total` instead — the Cutter goal strip (and the `initialWords` baseline `setGoal` freezes from it) and the selection counter, which additionally kept its own flat-text walker and therefore produced a single uncategorized number the config had nothing to filter.

> **Deriving the same DATA is not answering the same QUESTION. When a shared record must be reduced against live app state to become the number a user sees, the reduction belongs beside the walker — and the precomputed unreduced answer is DELETED, not left alongside it.**

With the default config (comments off) a document the panel headlined as 10 words drove a cut goal measured against 15, and the config file's own stated intent ("Comments are noise for the running total — opt-in only") was violated one panel over. Resolved decision (Gabriel): the cut goal and the selection counter follow the panel's filter — one number, and it's the one the panel shows.

[src/lib/word-count-core.ts](src/lib/word-count-core.ts) now owns both halves: `collectCategoryParts` decides which bucket, `includedTotals(counts, include)` decides which buckets count. Four rules it earned:

- **Delete the precomputed answer; making it unrepresentable IS the guard.** `WordCounts` → `CategoryCounts` (`words`/`characters`, per category, nothing else). A consumer can no longer reach an unfiltered total by accident — only by summing `ALL_CATEGORIES` itself, which the census forbids outside the module. The same cut retired `sentences`/`readingTime`/`countSentences`, which had **zero readers** — keeping `total` alive to feed a dead reading-time string would have preserved exactly the field the bug read.
- **Words and characters come back TOGETHER.** One include-set read, one call, so a surface cannot filter one and not the other — task 121's contract made structural instead of duplicated.
- **The summation rule is module-PRIVATE; publish whole operations.** An exported `sumIncluded` is an invitation to re-derive "the total" from `counts.words` at the next call site, which is the fork this closes. `includedTotals` and `sumIncludedWords` (the Outline's per-section ranges, now expressed through the same rule) are the whole public surface.
- **A second producer, not a second walker.** The selection counter cuts its range with `doc.slice(from, to, true)` and hands the block fragment to the canonical walker, so a selection and the document are the same kind of thing (`CategoryCounts`) counted the same way. `includeParents` is load-bearing: without it a selection inside ONE textblock resolves to the shared depth and returns BARE INLINE nodes — no paragraph, no heading — and the block walker silently counts zero for the commonest selection there is.

CI: [word-count-filter-ssot.test.ts](src/lib/__tests__/word-count-filter-ssot.test.ts). The selection legs drive a REAL editor (the `includeParents` distinction is invisible to any hand-built fixture); the leg with teeth is the **census**, because the door was never the part that could misbehave — a call site that doesn't ask it is: no production file outside the module may `reduce` over the include-set, the four retired field names must have no production site, and every file supplying the goal strip's `currentWords` must import the door. All three fail on the pre-fix tree.

**Two residuals, stated.** A goal set before this change keeps an `initialWords` baseline measured on the old ruler, so its progress bar reads high until the goal is re-set (a progress bar, not data — deliberately not migrated); and toggling a category mid-goal moves the live number against that frozen baseline, which is inherent to "the goal follows the panel filter" and was the decision. Deliberately NOT folded in: `getAnchorSummary`'s "selection · 14 words" badge, which counts a captured plain-text snapshot with no category structure to filter — a different question, not a fourth divergence.

### The premise half: a per-kind table that asserts a SCHEMA fact must be CHECKED against the schema

Same law, eighth tense (task 148) — and the one where the table was not dead, not stale and not half-consolidated. It was simply **untrue**, and nothing in the system was entitled to notice.

`TEXT_OBJECT_REGISTRY[kind].actions` curates what a grab-bar menu may offer per kind, and one of its buckets carried a stated premise: `NON_PROSE_BLOCK_ACTIONS` drops footnote / citation / suggest-edit because there is "no place to embed inline insertions in non-prose blocks / structural containers." True for the block ATOMS (`displayMath`, `texBlock`, `graphicsBlock`) and for the `text*` verbatim kinds. False for the four **containers** filed beside them — `bulletList`, `orderedList`, `exampleBlock`, `figureBlock` — each of which holds prose a caret can sit in. So the grab bar greyed three actions at an example while the lightning bolt, which resolves the caret's *immediate textblock parent*, enabled all three one position inside it, and `/footnote` landed the atom there quite happily.

> **A gate answers where the action ACTS, not where the gesture happened to point. And a per-kind table that asserts something about the schema is asserted against the schema in CI — the registry is editor-coupled and cannot check its own premise, so nothing else will.**

[`blockRangeAllowsAction(doc, from, to, action)`](src/text-objects/text-object-registry.ts) is the one door every surface now enters: the grab bar with the block ref's resolved range, the caret surfaces with `from === to`, the selection menu with its span, and the dispatcher's defence-in-depth re-check with the range it is about to splice. Actions that act ON a block still read the range START's curated set (byte-identical to the old `posBlockAllowsAction`, which is now the caret form of this). The `INLINE_INSERT_ACTIONS` family — footnote / citation / suggest-edit, the three that act at an inline POSITION — is answered by the textblocks the range can REACH, every one of which must permit it. Four rules it earned:

- **The family is the thing that could not be answered per kind, and `highlight` is deliberately not in it.** Highlight is mark-backed like suggest-edit, but the true atom blocks keep it as a *pinned clean no-op* (no text ⇒ it early-breaks), so it stays a per-KIND policy answer. `CONTAINER_SENSITIVE_ACTIONS` in the dispatcher is derived as the family + highlight rather than re-listed.
- **Requiring EVERY reachable textblock is the fail-closed direction, and it retired two silent doors of its own.** A selection running from prose into a `titleField` can no longer land the `\title{\cite{}}` task 061 exists to prevent (the old gate asked only `resolved.from` while the atom lands at `range.to`), and a quote or list item whose body is a `codeBlock` can no longer take a footnote into a `text*` node. Cost, stated: a container mixing prose and verbatim greys at the container level even where the landing would have been fine — the caret surface still allows it, so nothing is unreachable.
- **The premise is checked, not restated.** `typeHostsInlineInsert(type, action)` walks the ContentMatch automaton from a kind's node type and asks each reachable textblock whether it admits that inline node (or the `linkedAnchor` mark, for suggest-edit). CI sweeps every kind × the family and fails any drop the schema contradicts, with **one** allowlist entry — `titleField × citation`, "a title has no bibliography," a genuine editorial policy the schema knows nothing about. The set can only shrink.
- **Un-gating is worthless without fixing where the atom goes.** The two inline-atom branches collapse a block ref to its content-range END to put the marker "at the end of the passage" — and for a CONTAINER that is a position *between block children*, which nothing downstream repairs: TipTap's `setTextSelection` clamps to doc bounds, ProseMirror's `TextSelection` constructor only `console.warn`s (once per page load), and `insertContent` then asks the fitter to make room, which **fabricates** a trailing block. A grab-bar footnote on a block quote appended a phantom empty paragraph holding only the marker; on a list, a phantom extra bullet; on a figure, whose caption slot is full, the marker escaped to a new top-level paragraph. Schema-valid every time, `doc.check()` clean, no duplicate uuids, anchored to no word — which is why nothing ever failed. This shipped on `blockquote` / `listItem` / `exampleItem` (PROSE_ACTIONS containers all) long before 148, so [`inlineInsertPos`](src/text-objects/text-object-registry.ts) fixes it for them too rather than only for the kinds this task un-gates.

**`NO_INLINE_LANDING_INSIDE` is the one set all three rules read** — the gate's reachable-textblock walk, the schema premise, and the landing resolver — so "may it land" and "where does it land" can never answer differently. Its two members are editorial facts the schema cannot express, and both were found by driving the real dispatch: an `exampleGloss`, because a `glossCell` is a *column* of an interlinear gloss and an atom in the last cell of the last tier changes that column against every other tier (the alignment destruction `dropEmptiedSourceBlock` refuses, "The identity half" above); and a `figureCaption`, because writing into an EMPTY one flips the `hasCaption` provenance both figure numberers gate on (task 319), silently renumbering every later figure and every `\ref` to them. That second entry is also why `figureBlock` stays on the reduced set although its content expression is prose: its ONLY body is that caption. The landing resolver is therefore a hand walk rather than `Selection.near(…, -1)` — `near` descends into whatever sits last, and for both shapes "whatever sits last" is precisely where the atom must not go.

**Residual, deliberate and pinned in the suite:** the lightning / slash surfaces still permit a footnote at a caret the user placed *inside* a figure caption (`figureCaption` is not a `TextObjectKind`, so it takes the gate's defensive allow). That is the one divergence in this class left standing, because closing it means TIGHTENING a surface the resolved decision said to leave permissive. CI: [container-body-inline-insert.test.ts](src/lib/actions/__tests__/container-body-inline-insert.test.ts) — the schema census is the leg with teeth (the gate was never the part that could misbehave; a table stating a falsehood about the schema was), alongside a real-editor cross-surface parity sweep over BOTH menu surfaces, real-transaction landing legs, and the fail-closed pair. Every defect leg fails on the pre-fix tree.

### The reader half: a declared PREFERENCE is a promise that a pixel reads it

Same law, ninth tense (task 326) — and the one where the declaration was not dead, not stale, not untrue, but **unconsumed at the last inch**.

`mathColor` and `mathPrefixColor` were complete on every plumbing axis and consumed on none: an `EditorPreferences` field, a shipped default, a labelled row in Editor › Code & Math ("Color of rendered math expressions"), a `PREF_TO_CSS` row so `EditorLayout` wrote `--math-color` onto `:root` on every prefs change, a `dev-prefs-registry` source, and a first-paint seed in the managed `PROMOTE-DEFAULTS` block. And **zero `var(--math-color)` reads in either silo**. So a user opened the picker, chose a color, and watched a control that had never done anything — while `STYLE_GUIDE.md`'s own inline-atom list described inline math as "mono purple" for a year and the glyphs took KaTeX's inherited body ink.

> **A preference is an SSOT only if something READS it — and "reads it" means a pixel, not a plumbing layer.** The write is not the consumption: a token `:root` carries and no rule consults is a labelled control that cannot work. Where no consumer is possible, DELETE the declaration rather than leave the picker.

Both halves shipped. `mathColor` was **wired** — one `color` on `.inline-math` / `.display-math` / `.math-popover-preview`, which is the whole mechanism because KaTeX declares `color` on nothing of its own and draws its two non-glyph marks from `currentColor` by two different routes: `border-color` on `.katex *` (the fraction bar is a `.frac-line` border-bottom) and `fill/stroke` on `.katex svg` (the sqrt radical is an SVG path, not a border). It prints in that ink deliberately — the `@media print` block flattens exactly two inline atoms to `color: inherit`, and its own comment scopes that to the CHIP look ("lose the chip border and tinted background so they read as plain prose"), while `.footnote-marker` and `.latex-comment` already print colored. `mathPrefixColor` was **retired** — it promised to color "$ delimiters and prefixes", and `renderMath` runs KaTeX with `output: "html"`, so no delimiter survives into the DOM: there was no element it could ever have painted, and a picker that cannot work is worse than an absent one. Retiring means every site (interface, defaults JSON, tree row, `PREF_TO_CSS`, `dev-prefs-registry`, both `globals.css` seeds), the same "delete the stored copy, don't merely align it" rule the margin-side half earned.

Three rules it earned:

- **The guard runs the direction no existing one could.** `phantom-css-var.test.ts` asks whether a `var()` READ resolves to a definition; this is a definition with no read, and the two are structurally blind to each other. `atom-chrome-tokens.test.ts` (task 194 — the *mirror image* defect, a rule with a literal and no preference) asks whether an atom's rest rule spells a literal, and `.inline-math` declared no `color` at all, so it answered honestly "clean". [inert-preference-controls.test.ts](src/__tests__/inert-preference-controls.test.ts) is the reverse census: every `PREF_TO_CSS`/`DERIVED_CSS` `cssVar` has a reader (leg A), and every leaf of `PREFERENCES_TREE` moves a pixel (leg B).
- **Ask the mechanism which prefs a derived token depends on; don't parse the compute.** A pref can reach the document through a DERIVED token instead of its own — `commentColor`'s own `--comment-color` has no reader and its `hexToRgba`-derived `--comment-bg` does — so leg B establishes the dependency by PERTURBATION against the real `compute` (change the pref, see whether the output moves). A source-parsing version would have to restate the `?? fallback` shape that makes `fontSerif` a real dependency of `--font-headers-family`.
- **Record the other hits honestly; do not widen the allowlist in silence.** The census's first run found **eight** more unread tokens, five of them labelled dialog rows: Suggestions › Mark background / Mark border (the anchor-accent family paints that chrome instead), Panels › Header size (`.panel-header-title` takes color and family from prefs and its size from the `--panel-font-size` inheritance), and the Fonts dialog's Display / Logo pickers (both faces are reached as the bare `next/font` vars, skipping the override rung the sans/serif/mono chains have). Each is PRE-EXISTING, each needs a visual decision about which element takes the value — which is why they are recorded with a stated reason rather than fixed beside the math pref, whose consumer was unambiguous. Both lists may only SHRINK.

**Retiring a preference is not durable until the promoter prunes.** `usePreferences.defaults.json` is not hand-maintained — `tools/promote-defaults.mjs` folds Gabriel's mirrored localStorage blob into it on a Tue/Fri cron that commits and **pushes to main** behind a `JSON.parse` gate with no tsc and no tests. His blob comes from `loadPrefs`'s `{ ...DEFAULT_PREFS, ...JSON.parse(raw) }`, re-serialized whole, so a key retired from the interface is never pruned from his storage, and the mirror POSTs it verbatim. The `replace-all` strategy copied EVERY snapshot key, so a retirement was undone on the next tick — and `check-prefs-coverage` is blind to it by construction (it asserts interface ⊆ defaults; an EXTRA key is not a failure). Proof rather than theory: `aiMarkerText`/`aiMarkerBg`/`aiMarkerBorder` were retired in `1c0c52be` and were back in the JSON the next day (`ffa7dfe0`), where they sat unread for two months until this task deleted them. So `applyAll` now IGNORES (and logs) keys the target does not declare — the snapshot supplies VALUES, never vocabulary. Both `replace-all` targets are closed vocabularies in tracked source, so a legitimately new key is always already present and survives untouched — but what closes each is a TEST, not a type, and the tool's comment says so, because the obvious answer is wrong twice: `DEFAULT_PREFS` and `DEFAULT_PANEL_COLORS` are both `as` CASTS (the thing `print.ts` already says out loud about its own), so the real nets are `check-prefs-coverage` check 1 and `panel-theme-key-freeze`'s hand-written `FROZEN_THEME_KEYS` exact-set assertion. The trade this accepts is stated there too: a pref added to the interface and forgotten in the JSON used to be healed silently by the next tick and is now dropped every tick, with only a launchd log line to show for it — deliberate, since a shipped default no interface declares is worse than a loud missing one. Leg C of the census is the net under the mechanism, with an EMPTY allowlist: no shipped default may be an orphan.

**A file that RENDERS the control is not a witness that the control works.** Channel 3 excludes the two vocabulary files AND every prefs control surface (`FontsDialog`, `PreferencesModal`, `PreferenceTree`, `SmartPreferences`, `PreferenceModePicker`) — because an inert picker's own dialog names its key, and a bare-name grep would otherwise exonerate it off exactly the surface whose emptiness IS the bug. That exclusion is also what covers the second control surface leg B cannot see: `PREFERENCES_TREE` is not the only labelled-row source (`FontsDialog` binds its own `<FieldRow>`s straight to prefs), so a Fonts-dialog pref reaching no token now falls to leg C as an ORPHAN rather than passing everything. It is a pure tightening — measured when it landed, the inert set does not move, since every real font pref reaches pixels through its own `--font-*` token or a derived one.

The stated limits are in the suite's header: a read inside another custom property's definition counts as a read without chasing whether that host is itself read (no pref token is alias-only today); channel 3 is a deliberately generous bare-name grep; leg B's coverage of the Fonts dialog is indirect, so its diagnosis there is right about the fact and vague about the row (folding a second surface into leg B needs that surface to become DATA — JSX rows are not enumerable); `perturb` has no boolean arm because no boolean pref exists yet, and if one lands it fails toward a false ACCUSATION rather than a false exoneration; and **"read" is not "visible"** — a token consumed by a rule whose selector never matches passes here. Only an eyeball settles that. Same commit drained the CSS half of the stripper fork onto one scanner — [_source-scan.ts](src/lib/__tests__/_source-scan.ts)'s `cssCommentsStripped`, the rule task 227 earned after two censuses were burned by private variants. All four call sites now read it: the two hand-rolled twins in `phantom-css-var` / `atom-chrome-tokens` (byte-identical scanners, differing from the shared one only in preserving newlines, so `phantom-css-var`'s CSS `file:line` reports stop drifting by every multi-line comment above them) and `css-invalidation-guardrail`'s regex, which was a fourth variant with two failure modes of its own: it DELETED rather than blanked, so `:has/* c */(` would join into a live-looking `:has(`, and a non-greedy `[\s\S]*?` leaves an UNTERMINATED comment at EOF intact.

### The composition half: a SELECTOR is part of the contract, not a caller's private string

Same law, tenth tense (task 204) — and the one where the SSOT was alive, read, and correct, and had simply stopped one rung short of the form its consumers actually needed.

`link-dom-contract.ts` owned two rungs: the attribute NAMES (`DATA_LINK_*`) and the token GRAMMAR (`linkCardKey` / `parseLinkCardKey`). It did not own the SELECTOR — the composition of a name with a value — which is the **only form either is ever used in at a query site**. So task 202's census closed the producers and wrote *"READS stay free"* into its own leg, on the stated ground that `` `[${DATA_LINK_CARD}="${key}"]` `` reads worse than the literal it would replace. That ground was correct and the conclusion drawn from it was not.

> **A value that two layers must agree on is spelled once; so is the ADDRESS built from it. Where a name and a value meet, the composition belongs to the contract — a call site that assembles its own selector is a second speller of both.**

The sibling grammar had all three rungs the whole time and nobody noticed the asymmetry: `data-card-key` has `cardPopKey` (build), `parseAnyKey` (read) **and** `cardDomSelector` (address), the last pinned byte-exact by `card-key-seams-contract.test.ts`. `data-link-card` had two. Four rules it earned:

- **The missing rung made the wrong answer the better-reading one.** This is the generalizable part. A guard whose compliant form is uglier than the violation loses, and it loses *quietly* — as an exemption written into the guard with a reasonable-sounding justification, which is exactly what "READS stay free" was. When a census must exempt a whole category on ergonomic grounds, the finding is usually a missing primitive, not a necessary exception. The four builders ([link-dom-contract.ts](src/links/link-dom-contract.ts): `linkIdSelector`, `linkKindSelector`, `linkCardSelector`, `linkCardIdSelector`) read *better* than what they replaced, which is why the exemption could then be deleted rather than argued with. A fifth (`linkCardKeySelector`, taking a pre-built token) was written and retired in the same pass — every legacy-token site BUILDS a mark attr and none QUERIES, so it would have shipped with no caller, and the in-file call from its own sibling was enough to make the export census pass. **A sibling call is not a consumer**: that is this directory's own law reaching one rung further than the census can.
- **A PRESENCE test earns no builder and gets none.** `` `.linked-anchor[${DATA_LINK_ID}]` `` has no value to interleave, so the bare interpolated constant reads fine. The rule is drawn at composition, not at "mentions a name" — a builder for every occurrence would be the churn the original judgment call rightly feared.
- **The build census could not see a hand PARSE, and one was live.** `HAND_BUILT_TOKEN` matches interpolation shapes, so it watches a token being *constructed* and is blind to one being *taken apart*. `useTextHoverBridge` read `getAttribute("data-link-card")` and then ran `indexOf(":")` + two slices — `parseLinkCardKey` re-typed, four lines from a module that exports it, with every 202 leg green. Both failure modes are the same one and neither is a type error: **the query stops MATCHING rather than stops compiling.**
- **A duplicated COMPOSITE address is the same defect one size up.** `marker-clicks.ts` and `panel-selection.ts` each spelled `[data-footnote-entry="<id>"], [data-link-card="footnote:<id>"]`, byte for byte, in two files with no shared owner. That one is not the link contract's to own (`data-footnote-entry` is the panel's own vocabulary), so it went to the module that already had the per-panel table: `panelEntrySelector` is exported and `marker-clicks` calls it. **Put the SSOT where the question is already answered**, not where the newest constant happens to live.

CI: [link-surface-honesty.test.ts](src/links/__tests__/link-surface-honesty.test.ts), the same suite, widened. The name census is now TOTAL over both silos — write, query, or bare `getAttribute` — with the two boundaries that genuinely cannot participate stated rather than pretended away (`globals.css`, which imports nothing, and a JSX attribute, which has no computed-name syntax, so the two panel cards spell the name and single-source the VALUE). A second allowlist, `PERMITTED_ATTR_NAME_MENTIONS`, covers the two dev-only `console.error` strings that name an attribute as PROSE — and it is keyed by a **fragment of the prose, not by the file**, which the adversarial pass on this fix is what earned. The obvious file-scoped form (the idiom its sibling list uses) justifies a READ mention and would hand back the WRITE coverage the file already had; one of the two files is `links.ts`, the module whose four query sites this task converted and therefore the likeliest place for a fifth to appear. The stale-entry leg could not have caught that drift either, since a file-scoped version can only re-test the same needle the census uses — which an operative selector satisfies exactly as well as a sentence does. **An exemption must be scoped to the shape it justifies**: per-line here, and never excusing a write. Beside the build leg sits a parse leg (a colon-split whose preceding 10-line window names the card attribute), and the builders themselves are pinned byte-exact against **both** the constants they compose and the literal strings that shipped before this task — a cleanup that moves the DOM contract is a behaviour change wearing a refactor's clothes. Both defect legs fail on the pre-fix tree.

The stated limits: the parse needle's window is coarser than a scope (the alternative is parsing declarations to find the enclosing function, precision it does not need), and the name census is a literal grep — `"data-link-" + "id"` or a `dataset.linkCard` camelCase access would slip through, neither of which is an idiom this repo uses anywhere.

### The exhaustiveness half: a completeness guard whose reference set is a HAND-LIST is a tautology

Same law, eleventh tense (task 260) — and the one where the guard existed, ran in CI, was read, and checked the wrong two things against each other.

`assertActionCoverage` advertised `VIRGIL_ACTION_REGISTRY` as the **COMPLETE SSOT** and asserted it "in BOTH directions": its step-5 leg compared `EXPECTED_ACTION_IDS` (the manifest) against the union of the `COVERED_*` slices, and promised in prose that "if a future chip adds an `ActionId` to the union, it MUST add it to `EXPECTED_ACTION_IDS` + a `COVERED_*` entry + a row — otherwise this guard trips." Both sides were hand-authored `readonly <SubUnion>[]` arrays. The `ActionId` union — the actual master vocabulary — was the reference of neither.

> **A completeness guard is only as strong as what its reference set is PINNED to. An array typed `readonly K[]` enforces SUBSET (every element is a member); only a `Record<K, …>` enforces SUPERSET (every member is present). A union has no runtime enumeration, so union-completeness is a COMPILE-TIME property or it is nothing — a runtime leg comparing two hand-lists is a tautology wearing a guard's clothes.**

The invariant held for **card / format / heading** and only by accident: each of those three has an incidental exhaustive `Record` elsewhere (`CARD_ACTION_PRESENTATION`, `FORMAT_ACTION_ROWS`, `HEADING_ID_LEVEL`) that a new member breaks first, which then makes `covered` auto-expand and the equality leg trip. **atom / title / non-heading-block** had no such Record, and `Partial<Record<ActionId, ActionSpec>>` + an `as` cast made a missing row legal besides. Measured on the pre-fix tree by adding three scratch members (`AtomActionId | "eqref"`, `NonHeadingBlockActionId | "verbatim"`, `TitleActionId | "keywords"`): **zero** production errors for two of them, `assertActionCoverage()` → `[]`, and an action reachable from a consumer that resolves to nothing at runtime.

**The severity, stated precisely, because the adversarial pass on this fix caught the first draft overstating it.** The project typecheck was **red**, not green — one error, from `applicability-collab-gate.test.ts`'s `EXPECTED_MODE` (`Record<ActionId, ActionSelectionMode>`), a test's expected-value table that happens to be exhaustive. So the hole was not CI-invisible; it was **CI-misdirected**. That error names a missing selection-MODE entry, and adding the three ids there satisfies it completely while still shipping three actions the registry cannot resolve. **A net that names the wrong obligation teaches the next author to discharge the wrong obligation** — which is why the pin belongs at the declaration even though something, somewhere, went red.

Four rules it earned:

- **Give every family the shape the accidental ones already had, then DERIVE.** Six `Record<<Family>ActionId, ActionSpec>` row tables spread into an annotated total `Readonly<Record<ActionId, ActionSpec>>`; `EXPECTED_ACTION_IDS` and every `COVERED_*` slice read those keys through `keysOf`. A new member of any family fails to compile **at that family's exhaustive table** — the ROW table for atom / title / block / format, and (measured) the presentation / level table it derives FROM for card / heading, whose row tables are `mapRecord` results and therefore cannot be missing a key; their annotations still refuse a degraded `mapRecord`. A whole new FAMILY fails at the assembly, and `_ACTION_ID_PARTITION_PROOF` beside it turns "property 'x' is missing" on a six-line spread into `{ "an ActionId family has no exhaustive row table": "x" }` — the diagnostic, not the mechanism, and it only ever speaks for that case, since a within-family error fires first. The two halves of `BlockActionId` are `HeadingActionId` and `Exclude<BlockActionId, HeadingActionId>`, so they partition by construction rather than by a second list.
- **Say where the guarantee moved, and demote the leg that no longer carries it.** Step 5 now compares two DERIVED sets, so it can no longer establish completeness — it is a derivation-fork check (a slice re-hand-listed, a row spread in from outside a family table), and its comment says exactly that. Leaving the old prose would have been the worse half of this defect: a guard that overstates its reach is the failure mode this whole section is about.
- **The census is the leg with teeth; the type pin is the mechanism.** The annotation was never the part that could misbehave — a `COVERED_*` re-hand-listed beside it is, and no runtime test can see that. So [action-union-exhaustiveness.test.ts](src/lib/actions/__tests__/action-union-exhaustiveness.test.ts) reads SOURCE: the total annotation with no `Partial`/`as`, an exhaustive family table per family each spread into the registry, every id list derived through `keysOf`, and no re-hand-listed manifest, with a declaration-count swallow self-check and defect fixtures that are synthetic rather than live lines (a canary must not stand on the defect). **The census discovers the family tables from `_FamilyCoveredActionId`'s own `keyof typeof` clauses rather than listing them** — a hand list inside the guard that outlaws hand lists is this defect one level up, and it would sit green while a seventh family's table was annotated `Record<string, …>`. Its remaining reach is stated in the suite rather than implied: the re-hand-listed needle is NAME-scoped and FILE-scoped, so a manifest called `ALL_IDS`, or moved one file over, passes.
- **A type-level leg needs an ACCEPTING CONTROL, for the same reason a defect leg does.** `const _registryIsTotal: Record<ActionId, ActionSpec> = VIRGIL_ACTION_REGISTRY` goes red if the registry ever returns to `Partial` — and would pass for the wrong reason if the registry quietly became `any`. So a `@ts-expect-error`'d twin over `Record<ActionId | "scratch-action", ActionSpec>` sits beside it: type it `any` and the expected error disappears, `TS2578` fires, the build goes red. (An index SIGNATURE is *not* such a route — measured, `Record<string, ActionSpec>` reddens the positive leg directly. The control's first draft claimed otherwise, and naming a mechanism that does not exist is the same overstatement this section is about.) Both are enforced by `tsc --noEmit` (which includes `**/*.ts`), not by vitest — they live in the suite that explains them rather than in production source, where they would read as live code.

**One more accident fired pre-260, on one family only:** `titleFieldRow`'s parameter was hand-typed `"title" | "author" | "date"` instead of `TitleActionId`, so the `.map` failed and named the row *builder* rather than the missing row. That parameter now names the union, so the accident is gone and the declared pin does the work.

Same *class* as task 259 (a per-kind capability that "looks pinned" and isn't) and adjacent to the parked 228 (this same assertion's consumer-**reconciliation** symmetry, a different axis, still open).

### The dialect half: what a system DOES model, it gives back in the form it was given

Same round trip, and the case that is the carrier doctrine's other side (task
355). Task 342's rule — *what the system does not model, it CARRIES* — kept a
linguex paper byte-intact by refusing to claim it (task 350). This one models
it, and the interesting question is then not whether the bytes survive but
whether they come back in the SAME SYNTAX.

Linguistics papers number examples with one of two mutually incompatible
packages, and a real paper loads both:

```
expex     \ex \label{s1} … \xe      (an explicit close)
linguex   \ex.\label{s1} …          (terminated by a blank line)
```

> **A per-example `dialect` attr, and the serializer writes each example back
> in ITS OWN dialect.** Converting on open would rewrite every example in a
> co-authored file Virgil was merely asked to READ — an Overleaf diff bomb —
> and, since both packages define `\ex`, it would need a `\usepackage{expex}`
> that BREAKS the paper. Faithful round-trip is the Virgil-shaped answer;
> convert-on-open was considered and rejected.

Six rules it earned:

- **FORM decides which dialect; the PACKAGE decides whether to model.** The
  period is the per-SITE discriminator ([latex-lexer.ts](src/lib/latex-lexer.ts)
  `matchExpexOpenerAt` / `matchLinguexOpenerAt`, neither consulting a preamble —
  a fragment, a card body and a paste have none), so a mixed document is read
  example by example. Whether Virgil may CLAIM a linguex site is a different
  question, asked once of the LIVE preamble (`preambleLoadsPackage` →
  `livePreamble`, the 344/345 detector law) and held as module state beside
  `seenTitleFields`, because it is a per-DOCUMENT fact and `ParseContext` is
  per-SLICE — a document capability threaded through four sub-context
  constructors is one someone forgets at the fifth.
- **The bound is the GRAMMAR's, not the code's.** A linguex example has no
  closing command; it ends at the paragraph break. So `linguexExampleEnd` stops
  at the first blank line (or block boundary), and task 350's swallow-to-EOF is
  **unrepresentable** here — a property that survives only while nothing bolts a
  "continuation" heuristic onto that scan. Do not add one.
- **What is not modelled is refused WHOLE.** `\exg.` / `\exi.` / `\exr.` are
  different control words, so the control-word boundary declines them and 342's
  carrier takes their bytes with no list to maintain; `\z.`, a glossed part
  (`\bg.`) and a third nesting tier are detected and REFUSE the example, which
  falls back to the same carrier. Never half-parsed — 350 defect C's rule
  (*never emit a node that serializes to less than it consumed*), one dialect
  over.
- **One assembly, two splitters.** The dialects agree on nothing before the
  split and everything after it, so `assembleExampleBody` is shared and every
  consumer downstream — numbering, cards, the panel, drop specs, the float
  bodies — is dialect-BLIND by construction rather than by care. The SERIALIZER
  is deliberately NOT shared (the two assemblies differ line for line, and the
  expex walker's separator coupling describes a grammar linguex does not have).
- **A live compile hazard fell out of the same discriminator.** The
  requirements FALLBACK detector matched `\ex` with no period lookahead, so a
  linguex `\ex.` — carried raw post-350, or modelled post-355 — declared expex
  and `ensurePreambleRequirements` injected `\usepackage{expex}` AFTER the
  user's own `\usepackage{linguex}`. Both define `\ex`, the later load wins, and
  every example in the paper stops compiling: a preamble the user never wrote,
  breaking a document that compiled before Virgil opened it. Fixed at
  [PACKAGE_DETECTORS](src/lib/latex-requirement-collector.ts), and the detector
  is CHECKED against the opener SSOT rather than restated (148's instrument),
  since it sits in a leaf that cannot import the lexer.
- **A NEW example takes the document's DOMINANT dialect, derived from the
  document** ([example-dialect.ts](src/lib/example-dialect.ts)) — purely linguex
  mints linguex, empty / expex / MIXED mints expex. Derived rather than
  re-asking the preamble, because a linguex example only exists in the tree
  because the parse found the package; and the fallback direction is the safe
  one, since expex is injected from the emit itself where linguex never is. The
  task text's gloss ("linguex iff the package is loaded and expex is not") is
  materially worse for the papers this exists for: Gabriel's own loads BOTH and
  writes linguex, so it would start minting expex into a linguex file.

**Stated normalization:** author layout INSIDE an example is canonicalized once
(header line, one part per line, the prose of a single example riding the header)
and is a fixed point from cycle 1 — the same one-time normalization every other
construct in the serializer performs. Part letters are derived from POSITION,
which is what linguex's own 26 aliases are for, so an in-order source reproduces
byte-for-byte and an out-of-order one normalizes.

CI: [linguex-dialect-roundtrip.test.ts](src/lib/__tests__/linguex-dialect-roundtrip.test.ts)
drives the REAL save pipeline over two cycles per leg, with an expex example and
a linguex paper with the package COMMENTED OUT as controls through the identical
harness. Every pre-355 example fixture in the repo is spelled in expex, so a
dialect divergence was unrepresentable in all of them. The leg with teeth is the
**census**: the parse and the serializer were never the part that can misbehave —
a CONSUMER that starts special-casing the dialect is, and it would type-check
perfectly. So the literal `"linguex"` may appear in production code only in the
five layers that DECIDE the dialect; a hit is a design question, not an allowlist
entry. Measured by neutering each half in turn: dropping the modelling takes 10
legs, the extent scan's marker skip 4, the detector lookahead 2, the refusal
vocabulary 2, the preamble projection 2.

**Owed, not claimed:** a preview eyeball and a real-FSA open of Gabriel's own
co-authored linguex paper. What is proven here is the `.tex` round trip end to
end, which is not FSA-masked.

## The write path: no automatic write may lose content

> **A write the user did not ask for is measured before it lands.** Virgil's
> `.tex` is the user's only copy, and every automatic path to it — the
> load-writeback, the 1500 ms autosave, an anchor-mint flush, a code-pane
> re-parse, the editor's own mount — can persist a model that represents the
> file less completely than the file does. Each of those doors MEASURES what it
> is about to commit against what the document was READ with, and a shortfall is
> a REFUSAL published to one channel that reaches the user and gates the door.

This is the content-loss cluster (task 350 defect D, then 357), and the reason it
needs a section rather than a fix is that every member is **silent and a fixed
point**: the output is well-formed LaTeX, the save succeeds, the reload looks
consistent, and the document is simply shorter than the one the user wrote.
Nothing throws. The parser-side laws above ("what a system does not model, it
CARRIES", and its five siblings) keep a round trip honest; this section is what
happens when one of them is nonetheless wrong.

**Five gates, one channel.** Each asks a different question, in the order a byte
travels:

- **LOAD** ([tex-preservation.ts](src/lib/tex-preservation.ts), `checkTexPreservation`)
  — the load-writeback re-stamps the `.tex` seconds after open. Refuses when the
  re-serialization holds materially fewer content words than the bytes just read:
  a parse that could not represent this file must not overwrite it.
- **MOUNT** ([mount-preservation.ts](src/lib/mount-preservation.ts) over
  [schema-mount.ts](src/lib/tiptap/schema-mount.ts)) — *a model that a gate has
  measured is not yet a document.* `enableContentCheck` is off, so
  `createNodeFromContent` swallows a `nodeFromJSON` throw and returns an **empty
  document**: a model naming one node type this build's schema has not got opens
  the paper BLANK, word-complete on the way past, and the write gate steps aside
  on the user's first keystroke into that blank. Both main-document doors ask,
  and they ask differently on purpose — the load door measures what the editor
  KEPT (that catch has exactly one product, so it is O(1) on the happy path), the
  code-pane door asks BEFORE it commits so nothing lossy ever enters.
- **CODE PANE** ([code-pane-bridge.ts](src/lib/code-pane-bridge.ts)) — 600 ms
  after a code-view keystroke the text is re-parsed into the live document, and
  mid-typing is exactly when unterminated constructs EXIST. Round-trips the parse
  against the delimiters it just extracted and refuses BEFORE `setContent`,
  keeping the last-good model. Surfaces on the pane's own inline error rather
  than the document banner: the model never entered, so the hazard is averted
  rather than pending — and the refusal is a state the user types their way OUT
  of.
- **SERIALIZE** ([`UnserializableNodeError`](src/lib/latex-serializer.ts),
  published by [serialize-refusal.ts](src/lib/serialize-refusal.ts)) — the
  serializer itself. See "The dispatcher half" below.
- **WRITE** ([write-preservation.ts](src/lib/write-preservation.ts)) — 350-D
  exempted the autosave on the sound ground that once the user has edited, the
  model IS their document. That rationale does not cover `writeDocBundle`'s OTHER
  caller: `flushNow` writes the whole bundle on an anchor-UUID MINT, so ONE card
  gesture (grab-handle click, omni open, card drag) on a uuid-less paragraph
  persists immediately with **no typing at all** — and replaces `virgil.json`
  wholesale, carrying sidecar damage no `.tex` gate can see. So a write is
  measured against the bytes the doc was LOADED with until a real user edit lands.

Ten rules the cluster earned:

- **A "real user edit" is an UNDOABLE transaction, not a `docChanged` one.** An
  anchor mint IS doc-changing, so keying the step-aside on that re-opens the very
  hole it closes. The test is `addToHistory !== false` — a POSITIVE test, so a new
  system write cannot count as a user edit by merely not being on a denylist; it
  must opt in by being undoable. Stated limit at the door: that is a convention,
  not an enforced invariant.
- **The baseline is RETAINED at read, never re-read at write.** By write time the
  file may already carry the load-writeback's own re-stamp, so a re-read would
  compare the model against Virgil's own output and measure nothing.
- **The measure asks WHICH words, not how many.** A net count is defeated by
  simultaneous growth: a pass that dropped `\author{Jane Q. Doe}` while adding
  four words elsewhere scored a loss of ZERO. `Σ max(0, before(t) − after(t))` is
  `≥` the net for every input (a strict strengthening — nothing the old rule
  refused is now allowed) and is ORDER-INVARIANT, which is why it is a multiset
  and **not** a contiguous-run check: the serializer legitimately MOVES word runs
  (`\title` hoisted past the package block; a figure's attrs re-emitted in the
  serializer's own order), and a run check false-refuses on every one of those.
  Measured before adopting — over every `.tex` corpus in the repo, two save cycles
  each, the shortfall is 0 in both regions.
- **The regions are measured separately** (body / preamble), because a preamble
  rewrite and a body loss mask each other in one total.
- **A refusal is a fact about the DOCUMENT, not a log line.** Every gate publishes
  to [preservation-notice.ts](src/lib/preservation-notice.ts) — a store, not a
  return value, because the fact is produced on a promise nobody awaits and
  consumed by a topbar pill and by the save path, two readers with no call
  relationship to the producer (the `useSyncExternalStore` shape the DiskWatcher's
  external-change store has).
- **The posture is WRITE-GATING, not read-only.** While a notice stands the 350-D
  step-aside is SUSPENDED — that rationale assumes the model represents the file,
  and a refusal is exactly the evidence that it does not, so without this the gates
  only delay the loss by one gesture. The editor stays EDITABLE: the danger is
  exclusively what reaches disk, the file on disk is intact whatever the user does
  in the editor, and a read-only posture would take away the two things they most
  need (copying text out, reading the source in the code view) on a stronger
  diagnosis than the gate can support.
- **Acknowledgment outranks everything, and cannot silently cost the missing
  bytes.** "Save anyway…" (behind a danger confirm) is the one way out — refusing a
  user who has been told and has decided is the worse failure. The FIRST refusal
  forces an unconditional forensic snapshot of the intact bundle into
  `virgil/.history/`, bypassing the autosave rate limit, so the pre-refusal file
  is on disk before any acknowledged write. Only the armed EDGE snapshots (the
  autosave retries every 1500 ms while the notice stands). The dev backend keeps
  no history folder, so its armed edge is unused — stated at its sites rather than
  silently absent. There is deliberately NO plain dismiss: dismissing would hide
  the notice while every write stayed refused, which is the silence the surface
  exists to end. And the banner sits BEFORE the `topbarRightCollapsed` gate — a
  data-integrity notice must not be hideable by a layout preference.
- **A refused write returns NORMALLY, so the save path reads the CHANNEL rather
  than the absence of a throw.** It used to set `saveStatus: "saved"` and advance
  `lastSavedRef` for a write that never happened — the second of which also
  suppresses a later legitimate mint-flush of that doc.
- **Every function that writes a document's file is ACCOUNTABLE** — it MEASURES
  the write against what was read, or SNAPSHOTS the bytes it is about to
  overwrite, or states at the site why it needs neither. `writeTex` (the style
  swap) was the one `.tex` writer with neither, carrying the most destructive write
  Virgil makes. No GATE, deliberately — the swap is user-intent and refusing it
  would refuse what the user asked for — but an **unconditional**
  `snapshotPriorBundle`, unconditional because it fires on a discrete gesture and
  never on a timer.
- **The `/editor/*` skills are the THIRD writer and had no net.**
  `apply_response.py`'s `region-replace` rewrites the whole preamble from model
  output. The rule is ported to `_common.py`, held to the TS implementation by a
  shared fixture CORPUS whose `expected` numbers are GENERATED from it — a golden
  file rather than a shared input, because a shared input alone is satisfied by
  both languages drifting the same way, which is what a "port the rule" commit is
  most likely to do. The splice refuses on two grounds and the asymmetry is the
  design: the BODY takes the words rule (this mode preserves body bytes verbatim,
  so a body shortfall can only mean a wrong `endMarker` ate document content),
  while the PREAMBLE is deliberately NOT word-gated (`/editor/style-merge`
  legitimately drops the `\documentclass`, the shim block, the title fields and
  shadowed packages) and gets the structural invariant the mode rests on instead:
  exactly one `\begin{document}` in the result.

### The dispatcher half: a serializer that cannot represent its input REFUSES

The last member, and the one where the gates above were all correct and still
could not help. `serializeNode`'s `default:` arm emitted a node's CHILDREN and
dropped its WRAPPER — and, for a childless node, emitted nothing at all; the
second dispatcher, `serializeInline`, had a trailing `return ""` of the same
shape. Both produce well-formed LaTeX that is simply shorter, and no gate
downstream can see it once the user has typed: **the write gate's step-aside
rests on "after a real user edit the model IS the document", which is exactly
the moment a wrapper-dropping serialize stops being measured against anything.**

> **A serializer that cannot represent its input must not emit LESS** — "less" is
> byte-indistinguishable from a correct shorter document. And the set of node
> types it CAN represent is CHECKED against the real schema, since the serializer
> is TipTap-free by construction and cannot ask.

Five rules it earned:

- **ONE dispatcher.** `serializeInline`'s five non-text arms were byte-identical
  duplicates of `serializeNode`'s, so the sequence walker now delegates and the
  second `return ""` is retired **by construction rather than by repair** — the
  twin rule, one file over. Two arms were added on the way: `figureCaption`
  (consumed contextually by `figureBlock`, declared so the census can see it has an
  ANSWER — the expex family's shape) and `text` (a text node reaching the BLOCK
  walk is a malformed model, but the answer to a structural anomaly is never "lose
  the user's prose"; pre-357 it fell to the default arm and vanished).
- **The refusal is a THROW, not a sentinel.** Every one of `serializeToLatex`'s
  ~ten callers would otherwise have to remember to test a sentinel, and the one
  that forgot would write the sentinel to disk. A throw is refused by default and
  has to be caught on purpose.
- **…so the doors split into two kinds, and both are censused.** The four bundle
  writers (two per backend) CATCH it and publish to the same channel a lossy write
  uses — a throw escaping one of them would be a third inert refusal, since
  nothing awaits the load writeback and `save()` catches, logs and leaves the doc
  dirty, so the user watches an autosave that never lands and is told nothing.
  Every read-only projection of the `.tex` FAILS OPEN and keeps its last good
  text: the pipeline's idle tier, `useLatexSource`, the code-view line probe, the
  example-card LaTeX cache — and the CODE VIEW, which falls back to the intact DISK bytes,
  because "open the code view to see the source" is the banner's own advice and
  that surface must still work on a refused document.
- **The code pane's fail-open was NARROWED, not inherited.** An
  `UnserializableNodeError` IS evidence about the parse — committing that model
  would put the live paper into a state no write could ever leave — so the bridge
  refuses and names the node. Any other throw keeps the original rule (not
  evidence the parse was lossy; refusing on it would block the pane on an
  unrelated defect).
- **This refusal offers no "Save anyway", and that is the honest answer.** The
  other three refusals have a version to save — a shorter document the user may
  knowingly accept. This one does not: the serializer produced no bytes at all, so
  acknowledgment would promise what the commit cannot do and refuse again one
  gesture later. The badge branches on `source` and withholds the row.

**Reachability, stated rather than implied.** `parseLatex` builds for this schema,
so this cannot fire for a document today's editor can hold — and CI keeps it that
way. It is the net for the two cases where the schema and the serializer genuinely
diverge: a node extension registered without a serializer arm (which CI turns into
a build failure rather than a silent drop), and a model reaching the serializer
from outside the schema. The same two cases the mount probe exists for, from the
other end.

### The conflict half: a guard that pauses owes BOTH sides a door

Same path, other direction (task 364). Every gate above answers *may this write
land?* This one answers what happens when the file changed **underneath** the
model: the `DiskWatcher` confirms a genuine byte divergence, the autosave PAUSES
rather than clobbering the external write, and the badge surfaces it. The
detection was honest and the posture was right, and the resolution was
one-sided — the only action offered was **Reload**, which discards the user's
unsaved edits. Their own side had no door at all, and the pill was red for an
event whose commonest cause is a sync service (Gabriel's paper lives in the
Overleaf/Dropbox integration folder, so the "external writer" is a daemon).

> **A conflict has TWO sides — the bytes on disk and the unsaved model — so it
> gets two doors, and a door that discards one side puts that side in the net
> FIRST. Which door was chosen may not change what the net holds: the two doors
> differ only in which side they APPLY.**

That last clause is the whole shape. Archiving per door is how the two come to
disagree about what gets kept, silently, with every behavioural leg green — so
the order is stated ONCE in
[conflict-resolution.ts](src/lib/conflict-resolution.ts) and both doors are
derived from it. The net is [`snapshotConflictSides`](src/lib/storage-fsa.ts):
one `virgil/.history/<ts>/` slot holding the disk bundle under its own names
(the same slot shape `snapshotPriorBundle` writes, so recovering from a conflict
slot is recovering from any other) plus the editor's side as `unsaved-<tex>`,
serialized through the SAME `buildSerializeOpts` door the save path uses — so
the archived copy is the bytes a keep-mine write would actually have produced.

Six rules it earned:

- **The net comes first for BOTH doors, and its receipt is READ.** `null` means
  no copy was taken, and the badge SAYS so rather than repeating a promise it
  could not keep — the false-affordance rule, applied to a claim made after the
  gesture instead of before it. A net that could not be taken does **not** cancel
  the resolution: the user is mid-conflict with a paused autosave, and stranding
  them with no way forward is worse than the risk being guarded.
- **Keep-mine ACKNOWLEDGES before it writes.** `hasUnresolvedChange()` gates
  every save path in `useDocument`, so a write issued while the conflict still
  stands is precisely the write the clobber guard is holding back. Re-baselining
  first also makes the write that follows *expected* to the watcher rather than a
  second external change.
- **The keep-mine write is EXEMPT from the 357 write gate, and the exemption is
  stated as a claim** (`writeDocBundle`'s `userResolvedConflict`). That gate
  exists because an AUTOMATIC write must not lose content, and a conflict
  resolution is the opposite of automatic; refusing it would leave the badge's
  promise unkept with nothing on screen to say so — this cluster's own silence
  failure mode. The unconditional net is what makes the exemption safe.
- **ONE registration, not three.** `registerDocActions(docId, {reload, keepMine,
  archiveSides})` — three registrations is three chances to wire two of them, and
  a `keepMine` that never registered is a button that silently does nothing.
- **The `change` tier is untouched.** With no unsaved edits nothing of the
  user's is at stake, so it keeps its one-click Reload and its `Dismiss`; the
  conflict tier alone grew doors, and `take-disk` reuses that same reload path so
  the two severities cannot come to disagree about what "load the disk version"
  means.
- **The red went away because the net arrived**, not to soften the message —
  STYLE_GUIDE, "RED means an action would destroy content WITHOUT a net". The
  copy also NAMES the likely writer as far as it is knowable: FSA hands out a
  directory handle and no path, so Virgil cannot say *which* app, and the honest
  general answer ("another app or a sync service — Dropbox, Overleaf, a text
  editor") is what stops a user alone at the keyboard reading it as corruption.

CI: [conflict-resolution.test.ts](src/lib/__tests__/conflict-resolution.test.ts)
drives the REAL resolution against recording ports and asserts the SEQUENCE (a
leg that only asserted "the archive was called" passes on an implementation that
archives the outcome); [conflict-net.test.ts](src/lib/__tests__/conflict-net.test.ts)
drives the REAL `snapshotConflictSides` against a fake disk and reads the slot
back, because the ordering legs pass just as happily on a net that copies
NOTHING — the failure a user would discover only after losing a version;
[external-change-badge.test.tsx](src/components/__tests__/external-change-badge.test.tsx)
pins both doors inline and the two REPORTED failure shapes; the multi-doc suite
pins that `resolveConflict` drives only the ACTIVE doc's ports; and
[useDocument.autosave-pause.test.ts](src/hooks/__tests__/useDocument.autosave-pause.test.ts)
drives the REAL registered `keepMine` with the watcher still reporting the
conflict. Measured by neutering each half: archiving after the apply takes 6
legs, dropping `userResolvedConflict` 1, and a net that skips the editor side 3.
Four badge legs were RENEGOTIATED rather than re-scoped — they pinned the
one-sided affordance (danger tone, a destructive confirm, keep-mine buried in the
kebab) as intended behaviour.

**Residuals, stated.** The dev backend takes this ONE net (the affordance
promises it, and the app is previewed there) while keeping no history for
ordinary writes, and its slots are unpruned — the dev API has no directory
listing. The badge shows no diff summary: computing one needs both sides' bytes
at render time, and the pill is not a place to do disk I/O. And the real-Dropbox
eyeball is **owed, not claimed** — this class masks in the dev preview, so the
durable proof here is the unit contracts.

### CI, and the limits stated rather than implied

Suites: [write-preservation-gate](src/lib/__tests__/write-preservation-gate.test.ts),
[preservation-refusal-posture](src/lib/__tests__/preservation-refusal-posture.test.ts),
[preservation-notice-badge](src/components/__tests__/preservation-notice-badge.test.tsx),
[mount-preservation-gate](src/lib/__tests__/mount-preservation-gate.test.ts),
[code-pane-preservation-gate](src/lib/__tests__/code-pane-preservation-gate.test.ts),
[serializer-node-coverage](src/lib/__tests__/serializer-node-coverage.test.ts),
[tex-write-accountability](src/lib/__tests__/tex-write-accountability.test.ts),
[write-tex-forensic-snapshot](src/lib/__tests__/write-tex-forensic-snapshot.test.ts),
[preservation-measure-parity](src/lib/__tests__/preservation-measure-parity.test.ts),
[preservation-measure-python](src/lib/__tests__/preservation-measure-python.test.ts)
+ `editor/scripts/tests/test_preservation_measure.py`.

**The legs with teeth are the censuses, every time** — the gates were never the
part that could misbehave; a WRITER or a DOOR that never asks is, and such a
writer type-checks perfectly and is invisible to every behavioural test of every
gate. `tex-write-accountability`'s needle is the WRITE, not the filename (a
filename census is a hand list wearing a regex's clothes, and `writeTemplateFiles`
writes a `.tex` without ever spelling the word). `serializer-node-coverage`'s
premise leg sweeps the REAL main-editor schema, so a node extension added without
a serializer arm fails the build; its door census requires both backends to catch
the refusal at BOTH bundle-write sites **and to rethrow anything else** — swallowing
an unrelated failure there turns a real bug into a silently skipped save, the
defect's own shape.

Known limits, none of them papered over:

- **The 4-word floor is real.** Deleting `\usepackage{expex}` (2 words) does not
  trip the gate, and a lone `\author{Jane Q. Doe}` still passes. Recorded as a
  PASSING leg that documents the limit rather than a failing one that pretends the
  gate is tighter than it is.
- **A words measure cannot see re-ORDERING or `%`-fusion damage**, and the
  contiguous-run check that would catch one shape of it costs false refusals on
  every legitimate hoist — measured, then declined.
- **The Python half reaches only the skills.** `withDocLock` is a Web Locks
  primitive: it serializes this browser's windows and does not reach the
  out-of-process `/editor/*` scripts at all. What covers that writer is the
  words/structural refusal in `_common.py`, not the lock.
- **The autosave after a real user edit is deliberately UNGATED** (unless a notice
  stands). That is 350-D's decision, not an oversight: refusing to save the user's
  own typing is the worse failure.
- **Owed, not claimed:** a real-FSA eyeball of the banner, the refusal posture, and
  a live style switch leaving a `virgil/.history/` slot behind. This class masks in
  the dev preview (see the FSA-masking note in the memory index), so the durable
  proof here is the unit contracts.

## Style

[src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) is the design-system reference. Check it before building new UI. Update it when a UI decision feels generalizable.

## Sample paper for the dev doc

[samples/annotation-history/](samples/annotation-history/) is a frozen reference paper that exercises every card panel and most of the formatting vocabulary (footnotes, citations, bibliography, reports, examples with expex glosses, notes, todos, archive, cuts, revisions with multi-turn dialogue, suggestions, AI requests, bib reviews). The essay is on the history of annotation — self-referential, so the apparatus around the text mirrors what the text describes.

Use it to refresh `virgil-data/doc_devtest/` whenever it gets choppy from testing:

```
rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest
```

If the sample itself needs updating (new card kind, schema change), edit `virgil-data/doc_devtest/` live in the dev preview and copy back: `cp -R virgil-data/doc_devtest/. samples/annotation-history/`.
