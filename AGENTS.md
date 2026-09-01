<!-- last-verified: 6ad2d54a 2026-09-01 -->
<!-- derives-from: docs/architecture/VIRGIL.md#code-organization -->
<!-- covers-code: src/lib/tiptap/doc-structure, src/hooks/useStructuralRevisions.ts, src/hooks/useInTextPositions.ts -->

# Agent guide to Virgil

Virgil is a browser-based visual LaTeX editor for academic writing, designed to cowork with AI agents. It runs fully client-side (File System Access API for disk, IndexedDB for prefs); its RENDERING never compiles — the editor is driven by the parse/serialize round trip, which preserves the source — while an optional in-browser SwiftLaTeX pdfTeX compile produces a PDF on demand (`src/lib/compile/`, offline core bundle in `public/swiftlatex/`). Agents interact with the user's paper by reading the same `.tex`/`.bib` files and writing JSON sidecars into the paper's `virgil/` folder.

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

Each sub-doc begins with `<!-- last-verified: 41d988c2 2026-08-25 -->`. If the hash is far behind `HEAD` and something feels stale, verify against the current code before relying on the doc.

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

**Plugin `apply` / `appendTransaction` bodies are censused too** (task 433) — see "The probe half" below: a whole-document walk reachable from one must take the `touchedTextblocks` door or carry a `[cost: …]` line directly above the method ([plugin-apply-guardrail.test.ts](src/lib/__tests__/plugin-apply-guardrail.test.ts)).

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
  mark step. [src/lib/tiptap/changed-ranges.ts](src/lib/tiptap/changed-ranges.ts)
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
[plugin-apply-guardrail.test.ts](src/lib/__tests__/plugin-apply-guardrail.test.ts)
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

CI: [decoration-probe-cost.test.ts](src/lib/tiptap/__tests__/decoration-probe-cost.test.ts)
counts whole-document WALKS (`Node.prototype.descendants`, which prosemirror
recurses past through `nodesBetween`, so one build registers exactly one call)
and DERIVATIONS (`Decoration.inline` / `Decoration.node` constructions). The leg
with teeth asserts the nine-keystroke cost is IDENTICAL at 60 and at 240
paragraphs — no whole-document rebuild can satisfy that, whatever its constant.
[latex-command-cmd-only.test.ts](src/lib/tiptap/__tests__/latex-command-cmd-only.test.ts)
pins all four `p-cmd-only` crossings plus the mark step, and
[changed-ranges.test.ts](src/lib/tiptap/__tests__/changed-ranges.test.ts) pins
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
([cmd-only-paragraph.ts](src/lib/tiptap/cmd-only-paragraph.ts):
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

## Refocus is not navigation

> **`focus()` is two commands wearing one name.** Besides taking DOM focus,
> TipTap's `focus()` schedules — inside a `requestAnimationFrame` — an
> `editor.commands.scrollIntoView()`, because its `scrollIntoView` option
> defaults to `true`. That deferred scroll targets whatever the SELECTION is by
> the time the frame runs. So a commit that edits **at a node** and leaves the
> caret alone does not "return focus": it NAVIGATES, to a stale caret. The door
> for "give the editor its focus back and leave the document where it is" is
> [`refocusEditor(editor)`](src/lib/tiptap/refocus-editor.ts).

This is the "adding a label to a section makes the scroll jump" class (task 486,
Gabriel's own report), and it is the reposition-policy doctrine (task 328 — *a
reposition is sanctioned only when the thing the user needs is not already where
they need it*) read on the DOCUMENT axis and on the EDIT path. 328 swept the
gesture-driven jumps (card clicks, marker clicks); the edit-commit refocus was
never swept, and the heading-label strip has carried the defect for as long as it
has existed: `tr.setNodeMarkup` at a uuid-resolved heading, `view.dispatch`, then
a bare `nodeEditor.commands.focus()` whose frame dragged the paper to wherever the
user's caret happened to be.

Six rules it earned:

- **The discriminator is TIMING, not the call.** `delayedFocus` runs in a frame,
  so `chain().focus().setTextSelection(edit)…` scrolls to the EDIT — the chain has
  already moved the selection by then — and so does the lightning grid's
  `chain().focus().run()` prelude in front of a caret insert. Most `focus()` sites
  in the app are that shape and are deliberately left alone. **What breaks is a
  BARE refocus after an at-a-node write**, where nothing moves the selection and
  the frame finds the caret exactly where it was.
- **`editor.view.focus()` never scrolls** — prosemirror-view focuses with
  `preventScroll` — which is why the drop-mode / NodeView sites that already spell
  it are correct as they stand and need no door. The population is TipTap's
  command form only.
- **A site that DOES want the reader moved says so explicitly, once.** The
  Reader's Outline jump was the shape worth fixing beside the reported one: it
  spelled a bare `focus()`, a `setTextSelection`, and then its own
  `dom.scrollIntoView({ behavior: "smooth" })` — so the implicit frame raced the
  smooth scroll and cancelled it with an instant jump to the same place. It lands
  the reader nowhere WRONG; it simply performs two scrolls where one was intended.
  One explicit scroll, and (per 328) through `mayReposition` / the necessity-gated
  doors in `layout-scroll.ts` where a necessity question applies.
- **The chain form already had a door and this is its standalone twin.**
  [insert-inline-atom.ts](src/lib/tiptap/insert-inline-atom.ts) rooted
  `chain().focus(null, { scrollIntoView: false })` for inline-atom creation (the
  "the new footnote lands just out of view at the top" bug). Two spellings of one
  rule is one too many, so the option literal now has exactly TWO spellers — the
  chain door and the standalone door — and everything else adopts one of them.
  `Editor.tsx`'s hand-spelled copy was retired onto the door in the same pass.
- **The census's at-a-node needles are the WRITE/RESOLVE family
  (`setNodeMarkup` / `insertContentAt` / `nodeDOM` / `domAtPos`), NOT the
  read-only walks** — and that narrowing was measured, not assumed. Including
  `.descendants(` / `doc.forEach(` flags two genuine caret commits
  (`Editor.tsx`'s `archiveSelection`, `smart-insert.ts`'s prelude) whose
  declarations happen to walk the doc for an unrelated reason, and buying those
  off with exemptions would put two standing licences where the allowlist is
  supposed to be EMPTY.
- **Explicit `tr.scrollIntoView()` after a caret insert is a different mechanism
  and is out of scope.** The ~15 sites that spell it (`expex.ts`, the action
  registry, `smart-insert.ts`) move the caret onto their insert first, so they are
  scrolling the edit into view deliberately. This section governs the IMPLICIT
  scroll `focus()` schedules.

CI: [refocus-no-scroll.test.ts](src/lib/tiptap/__tests__/refocus-no-scroll.test.ts)
drives the REAL heading NodeView — click the label chip, type, press Enter — with
the caret parked in a distant paragraph, and counts transactions carrying
ProseMirror's own `scrolledIntoView` flag. That flag IS the scroll request
(`Transaction#scrollIntoView()` sets it, `EditorView#updateState` acts on it), so
counting flagged transactions is counting scroll requests rather than a proxy for
them — which matters, because jsdom has no layout and `scrollTop` there is
synthetic. The CANARY leg fires a bare `focus()` through the identical harness and
requires the probe to see one, so a green defect leg can never mean "the probe is
blind"; a zero-rect `Range.getClientRects` shim keeps PM's scroll math from
THROWING in jsdom, which would abort the dispatch before the probe could read it.
**No pre-486 suite could see any of this**: `render-annot-bail.test.ts` drives the
same NodeView and asserts the ANNOTATION DOM, `structural-edit.test.ts` drives the
label WRITE one layer below the NodeView where the refocus does not exist, and
neither parks a caret anywhere or observes a transaction flag.

The leg with teeth is the CENSUS
([refocus-scroll-census.test.ts](src/lib/tiptap/__tests__/refocus-scroll-census.test.ts))
— the door was never the part that could misbehave, a chrome commit that never
asks it is, and that type-checks perfectly. Population DISCOVERED across both
silos; region = the enclosing DECLARATION, brace-balanced with a hop out of
control statements (the stated limit `container-fit-guardrail` also carries: a
node resolve in one branch speaks for a focus in a sibling branch). Allowlist
EMPTY. Measured by neutering each half in turn: the pre-486 bare refocus takes 5
legs (3 behavioural + 2 census), reverting the Reader's Outline jump 2 census
legs, and re-spelling `Editor.tsx`'s copy by hand 2. The two control legs — a
same-label re-entry, and "focus STILL returns to the editor" — pass either way and
say so at the site.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture,
no disk), so the check is cheap and real — click into a paragraph mid-document,
scroll somewhere else, add a label to a heading from its strip, and watch the
scroll hold still.

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

### The capture half: the census RECOMMENDED the shape it could not examine

Same law, the third widening of one census (task 439) — and the case where the
guard's own docblock held the offending shape up as a virtue.

`StripButton` ([drag-drop.tsx](src/components/editor-layout/drag-drop.tsx)), the
panel-rail icon drag, is a bespoke held gesture: `onPointerDown` arms an origin,
`onPointerMove` crosses a 5px threshold and calls `setPointerCapture`,
`onPointerUp` commits `movePanel`. It took **none of the four obligations**, for
as long as it has existed, with every leg of `pane-drag-guardrail` green — and
the reason is structural rather than an oversight. Task 333 widened that census
after finding `detectWindowDragGesture` blind to a whole category, and its
widened rule is still *"every file that installs a **window/document-level move
listener** is censused"*. That is a MECHANISM. This gesture installs no window
listener at all; the census's own header even says the element-scoped
pointer-capture shape is *"exactly what this grep is steering new code toward"*.
**Task-404's lesson verbatim — discover a census's population by the QUESTION,
not by the MECHANISM — one census over.**

Three costs, and the first two are correctness:

- **A right-press toggled the panel.** `onPointerUp` fired for ANY button with
  no start gate, so a right-press reached the click branch and opened/closed
  the panel beside the context menu the same press opened. Deterministic, zero
  race. Middle-click likewise.
- **A swallowed release left the gesture ARMED, and the next HOVER became a
  phantom drag.** The origin was cleared only by events the BUTTON received, so
  a press whose release the button never saw (the context menu ate it; the
  pointer left the button under threshold and released elsewhere; a release over
  an iframe) left it set. `pointermove` fires on HOVER with no button held, so
  the user's next pass over the icon crossed the threshold, appended the fixed
  z-9999 ghost, and called `setPointerCapture` on a pointer with **nothing
  pressed** — from then on every pointer event in the document retargeted to
  that strip button, and the next click committed a `movePanel` nobody made.
  Task 185/333's ghost-tracking class with an extra turn of the screw, because
  capture makes it document-wide rather than confined to the gesture.
- **The move path took neither COALESCE nor SNAPSHOT.** Per RAW pointermove it
  wrote the ghost's `left`/`top` (a layout write per event, where this file's own
  law says a moving element moves by `translate3d`) and then re-swept the strip:
  a `paneStrip` resolve, a `querySelectorAll` for its icons, a strip rect and a
  `getBoundingClientRect()` **per button** — forced-layout reads for geometry
  that cannot move under a held pointer. The indicator itself was `position:
  fixed` with `transition: top 0.1s ease`, a main-thread LAYOUT animation
  restarted on most frames, so the tree was never clean and every rect read in
  the app paid a forced flush. Task 351's diagnosis item by item, in a gesture
  351 did not touch.

> **A census over held gestures asks "who owns a pointer the user is HOLDING",
> and that has TWO element-scoped spellings as well as the window one: a file
> that takes POINTER CAPTURE, or a single JSX element pairing a press handler
> with a move/release handler.** Both are censused, both must REFERENCE the
> invariants module, and the invariants allowlist is the SAME empty list the
> window census uses — it is the same claim.

Five rules it earned:

- **Do the correctness half and the cost half TOGETHER.** Splitting them leaves
  this file as the standing counter-example ("the invariants were added and the
  four obligations were not") that the next bespoke gesture copies.
- **The bail runs BEFORE the event's coordinate is read**, and through the ONE
  teardown `cleanupDragArtifacts` already was — which task 141 built and never
  made reachable from a missed release. That teardown cancels the queued frame
  too, or a bailed gesture still commits one frame behind itself (task 333).
- **`armed` is what the start gate EARNS.** Gating `onPointerDown` alone is not
  enough: `onPointerUp` must perform the click/commit only for a gesture this
  component actually armed, or a right-press still falls through to `onClick()`.
- **The snapshot is read through a lazy `geometry()` door by BOTH the hover and
  the release** — the `readMoveGeometry` shape, and the half `FloatingPanel`'s
  own adversarial pass earned: a release reading the raw ref while only the
  hover went through the door is how the two come to answer from different
  tables. Re-armed off the `LayoutGestureBus` SET channel, subscribed on the
  threshold edge and dropped in the teardown, so an idle strip pays nothing.
- **The slot snapshot carries each icon's `panelId`, not just its midpoint.** A
  drop can then NAME what it lands beside rather than only counting — the seam
  an index-space fix needs, deliberately left as a seam rather than folded in.

CI: [strip-button-drag-teardown.test.tsx](src/components/editor-layout/__tests__/strip-button-drag-teardown.test.tsx)
drives the REAL component. **jsdom defaults `PointerEvent.buttons` to 0**, which
the missed-release bail reads as "the release already happened", so every LIVE
event in that file now passes `{ button: 0, buttons: 1 }` explicitly — measured,
all five pre-existing legs fail against the fixed component until the field is
added, which is itself the proof the invariant is wired (the trap AGENTS.md
already records for `bespoke-gesture-missed-release.test.tsx`). The leg with
teeth is the CENSUS — the gesture was never the part that could misbehave, a
population that cannot see it is. Measured by neutering the fix: the seven new
behavioural legs all fail on the pre-439 component (the six teardown legs pass
either way, and are the accepting controls), and the census names
`drag-drop.tsx`.

**Owed, not claimed:** a real-pointer preview eyeball — jsdom's pointer capture
is a stub and the context-menu race cannot be reproduced headlessly. Right-click
a strip icon (menu opens, panel does not toggle); press an icon, drag 3px off it,
release over the editor, then hover back over the strip (no ghost).

### The commit half: a rule stated at 7 of 10 call sites is not an SSOT

Same engine, the VALUE half of task 189's own headline (task 470) — 189 pulled
the a11y semantics into the engine and left the COMMIT POLICY scattered.

The engine called `commit()` on **every** completed gesture, a plain click on a
6-10px divider included, and its own suite pinned that as the contract ("a click
with zero movement still commits the start value exactly once"). Every editor
consumer then hand-wrote the identical four-line guard against it — the SAME
predicate (the engine px against that handle's own `getValue()` snapshot) and
the SAME remedy (the function it already passes as `restore`) — and the editor
adoption suite states the guard as a LAW in its own header. **Six handles
implemented it; four did not**, and three of those four are exactly the ones
whose `getValue()` returns a value the code's own comments say can be SMALLER
than what is stored: `LibraryView`'s nav / list / papers dividers read the
RESOLVED track (`offsetWidth` / `offsetHeight`) against a `clamp()`ed grid
template. So one accidental click on a Library divider on a narrow window wrote
the CLAMPED size into `view-session-store` permanently — widening the window no
longer restored the width, nothing threw, and the user could not tell the click
had done anything. That is the invariant `library-grid-template.ts` opens by
declaring ("the stored value is never rewritten by a mere viewport change"), and
it is Gabriel's own seed symptom from task 457 ("grabbing and then dropping in
the same place — should not change anything") reproduced on the divider family.
Measured against the shipped constants, the list track clamps at any grid
narrower than 792px on the defaults — a laptop, not an edge case.

> **A gesture that produced no NET change has nothing to persist: the engine
> calls `restore()` and commits ZERO times. The engine holds both halves the
> rule needs — `startValue` and `spec.restore` — so the rule is its own, not
> ten consumers'.**

Five rules it earned:

- **`restore()`, never `apply(startValue)`.** A wander-and-return has already
  OVERWRITTEN the style with the snapshot px, which for a `clamp()`ed track is a
  RENDERING of a larger stored value, and mid-drag React may have rendered a
  different flex string than the resting one (`zen-margin` spells this out).
  Only the consumer can re-sync from the source of truth — which is exactly what
  all six retired copies did, so the change is byte-identical for them.
- **The comparison is EXACT px against the `getValue()` snapshot**, and that is
  what keeps the ratio-valued dividers safe: a ratio round-trip
  ((r·track)/track) is not IEEE-exact for ~10% of stored (ratio, track) pairs,
  so a ratio-equality guard would fire a spurious pref write per plain click.
  The engine deliberately does NOT also skip a commit that merely ROUNDS to the
  same persisted integer — it speaks px and knows nothing about a consumer's
  rounding; integer-idempotence belongs inside that consumer's own `commit`.
- **A consumer with no `restore` gets nothing called**, which is strictly better
  than the redundant identical-widths store write `LeftList` used to make.
- **The engine's own suite pinned the DEFECT as the contract**, and is
  renegotiated in place with the reason at the site — as are the four other legs
  that used a zero-move release merely as a witness that a gesture had ENDED.
  Each drives a real move now: with the rule in place, `committed()` after a
  bare click is `[]` whether or not the gesture ever started, so those legs were
  about to become unfalsifiable.
- **The census is the leg with teeth** — the engine was never the part that
  could misbehave, a consumer that re-forks the guard is, and a re-forked guard
  type-checks perfectly and is invisible to every behavioural test of the
  engine (it would simply run BEFORE the engine's branch, as dead code, until
  someone "simplified" the engine).

CI: the zero-move census in
[pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts)
resolves every handle's `commit:` body by BALANCING delimiters rather than by
regex — an expression body (`setLayout({ navWidth: Math.round(px) })`) carries
both braces and commas, so a `[^,}]*` cut truncates it and the guard goes blind
on exactly the three sites the defect lived at — and asks per HANDLE, the
granularity the chrome census already earned (`LibraryView` holds three,
`panel-column` two). Allowlist EMPTY; a hit is DELETE-it.
[library-divider-zero-move.test.tsx](library/components/__tests__/library-divider-zero-move.test.tsx)
is the defect leg, and **no pre-470 suite could represent it**: the engine's own
harness commits an unrelated number, so "the committed value is a clamped
rendering of a larger stored one" is unrepresentable there, and
`pane-resize-adoption.test.tsx` — which states the law in its own header — never
touches the Library silo, which is why three unguarded handles shipped green.
Measured by neutering the engine's branch with the six consumer guards already
gone: **11 legs fail**, five of them the editor adoption suite's own zero-move
legs, unchanged — they pass because of the engine now, which is the point.

**Owed, not claimed:** the preview eyeball. Not FSA-masked (pure pointer +
localStorage). Narrow the window until the Library list track visibly clamps,
click the list divider once without moving, widen the window, and confirm the
list returns to its stored width.

### The key half: a live gesture CLAIMS the keys it answers

Same engine, the KEYBOARD (task 471) — and the case where the rule was already
written down one level *below* and the gesture was the one owner that never
took it.

The engine cancels a live divider drag on Escape from a `window` **capture**
listener, and it neither `preventDefault`ed nor `stopPropagation`ed. Capture
phase makes it run FIRST; it does not make it run ALONE. So one press ran every
other Escape owner in the app, and the two that cost real work are:

- **`useMarginEdit`** — a `window` **bubble** listener whose `cancel()` drops
  `liveMargins`, which is where all four guides' drag results live until the
  user presses Save. Cancelling a panel-gutter drag while margin-edit mode was
  on therefore discarded **the whole margin-edit session** and closed the mode
  under the user. Not a race: a window-capture listener always precedes a
  window-bubble one for the same event, so this happened on every such press —
  and margin-edit is precisely the mode in which a user is also nudging panel
  widths.
- **The dialog stack** — `document` **capture**, which is upstream of window
  bubble, and whose Escape branch *deliberately* ignores `defaultPrevented`
  ("a modal always has a way out", "The cue half"). So a scrimless draggable
  window closed from the same press: Preferences, and the bug reporter with a
  half-typed report in it. That one is why the claim must be the PAIR —
  `preventDefault()` alone does not reach it.

> **A live pointer gesture is the INNERMOST transient thing on screen — more
> transient than any dialog, menu or mode left open behind it — so one press
> ends exactly one thing.** `claimGestureKey` (the third rule in
> [pointer-invariants.ts](src/lib/pane-resize/pointer-invariants.ts), beside
> `isPrimaryDragStart` and `isMissedRelease`) is that claim, and a bespoke
> gesture imports it rather than re-deriving it.

Four rules it earned:

- **Virgil already stated this one level down and for a less transient thing.**
  Task 389 built `dialog-stack.ts` so that only the TOP dialog answers a key.
  A gesture outranks every dialog on screen and was the only Escape owner that
  did not say so.
- **It claims PROPAGATION, not the target — stated at the site so nobody
  rediscovers it as a bug.** `stopPropagation()` does not stop a listener
  already registered on the SAME target in the SAME phase, so an open menu's
  `window`+capture handlers (`useMenuDismiss`, `useMenuKeyboard`) still run.
  Accepted: a menu is dismissed by the divider's own `pointerdown` long before
  Escape, and `stopImmediatePropagation()` — the only thing that would reach
  them — would also silence unrelated same-target listeners the app depends on
  (`input-modality`'s typing tracker is exactly the shape this file says must
  never be silenced).
- **The gate stays in the SSOT rather than in the consumers.** The surgical
  alternative was to gate `useMarginEdit`'s Escape on `isLayoutGestureActive()`
  — which closes the one reported pair, leaves the dialog-stack pair open, and
  puts knowledge of the gesture bus inside a hook that has no other business
  with it. That is re-forking the rule into the consumers, which is the inverse
  of what the engine exists for.
- **A mode is not a claimant.** `useMarginEdit`'s own Escape keeps its lone
  `preventDefault()` and is deliberately NOT converted: margin-edit is a MODE,
  not the innermost transient thing on screen, and the census's fixtures pin
  that distinction so a later sweep does not "unify" them.

CI: three legs in
[use-pane-resize-handle.test.tsx](src/lib/pane-resize/__tests__/use-pane-resize-handle.test.tsx)
drive a live gesture with the two real owners registered at their real
receiver+phase (`window`/bubble and `document`/capture) and dispatch ONE press
**from inside the document**, because a press dispatched at `window` has a
propagation path of just `[window]` and can never reach a `document` listener —
i.e. the obvious harness makes the leg unfalsifiable. The two accepting controls
are load-bearing: with no gesture live BOTH owners must still fire (an engine
that silenced Escape app-wide would be a worse bug than the one being fixed),
and a non-Escape key during a live gesture must reach both. The census in
[pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts)
(`PERMITTED_REDERIVED_KEY_CLAIMS`, EMPTY) resolves each
`window`/`document.addEventListener("keydown", <name>)` handler by NAME and
brace-matches its body — two looser needles were tried and both were wrong on
this tree, measured, and the second one is the interesting one: it indicted
`Marginalia` and `panel-primitives`, whose hits are real key claims on a leaf
`<button>`. A component key handler is answering for ITSELF, not standing in
front of every other owner in the app, and its question lives in
`card-delete-key-door.test.ts`. Measured by neutering: the engine claim takes 1
behavioural leg, and a hand-written claim planted on a real gesture file takes
the census.

**Owed, not claimed:** the preview eyeball. Not FSA-masked. Enter margin-edit,
drag two guides, grab a panel gutter, press Escape — the guides must still be
where you dragged them and the mode must still be open.

#### The second member: the same disease in the gesture people actually use

Same rule, the CONTENT drag (task 504) — and the case where 471 stated the
class, fixed one member, and recorded the other as out of scope. The drop-mode
controller is the single chokepoint every pointer-driven content drag routes
through (block lift, text-object drag, inline-atom grab, card-anchor drag,
stack pull), and its Escape was UNCLAIMED — so cancelling a drag discarded
every margin guide dragged this session and closed a scrimless Preferences or
bug-report window, exactly as 471 describes, on a gesture far more common than
a divider drag.

Three rules it earned:

- **The PHASE is half the fix, and the claim alone buys nothing here.** The
  engine's listener is `window` + CAPTURE, so a claim added there reaches
  everything downstream. This one was `window` + BUBBLE — the LAST phase —
  where `document` capture (the dialog stack) has already run and
  `useMarginEdit` is a same-target same-phase listener registered FIRST, which
  `stopPropagation` cannot reach (and `stopImmediatePropagation` is ruled out
  by the SSOT's own stated limit). Measured: a bubble-phase claim fails the
  defect leg exactly as the unfixed controller does.
- **A capture listener is NOT removed by a bubble-phase removal**, so the
  teardown moves with the registration or the claim outlives the gesture —
  installed app-wide for the rest of the session, cancelling a session that no
  longer exists and stopping every other owner from seeing the press. Measured:
  a mismatched removal takes 2 legs, one of them the "no session live" control.
- **Claiming is safe because the listener is strictly gesture-scoped**, and
  both halves of that were checked at source rather than assumed:
  `removeListeners()` is the ONE end path every session ending funnels through,
  and `commitDropSession` calls it BEFORE awaiting any confirm dialog — so the
  handler is already gone by the time a dialog can want the key.

**The real deepening is the POSITIVE census leg**, and it is the leg that would
have caught BOTH members. `PERMITTED_REDERIVED_KEY_CLAIMS` is a NEGATIVE
question — does a gesture that DOES claim spell the claim by hand? — and is
structurally blind to a gesture that claims NOTHING, which spells no banned
form and reads as ordinary code. `PERMITTED_UNCLAIMED_GESTURE_KEYS` (EMPTY, a
hit is CLAIM-it) asks the other half, over a DISCOVERED population: a keydown
handler whose `removeEventListener` sits in the same region as the teardown of
a pointer MOVE/RELEASE listener — i.e. one whose lifetime IS the gesture's. The
region is resolved by walking OUTWARD from the removal and stopping at the
first FUNCTION body, which is what makes the exclusions structural rather than
allowlisted: the engine's `finally` block and the controller's
`removeListeners()` body are both caught at level 1, while `useMarginEdit`'s
MODE-level Escape — removed by a `useEffect` cleanup with no pointer teardown —
is excluded BY CONSTRUCTION, since a mode is deliberately not a claimant. Its
population **includes the ENGINE directory**, unlike every other census in this
file: there the engine is the answer and is rightly excluded, here it is a
MEMBER and the class's first offender, so a leg that could not see it would
only ever have caught the second one. An unresolvable handler fails CLOSED.

CI: [drag-escape-claim.test.ts](src/components/drop-mode/__tests__/drag-escape-claim.test.ts)
drives the REAL controller through a live session with the two real owners
registered at their real receiver+phase and ONE press dispatched **from inside
the document** (471's recorded harness trap — a press dispatched at `window` has
a propagation path of just `[window]` and can never reach a `document`
listener, which is exactly the observation a phase fix needs). Its two accepting
controls are the same two 471 earned. Measured by neutering each half in turn:
the pre-504 handler takes 1 behavioural leg plus the census, a bubble-phase
claim 1, and a mismatched capture removal 2.

**Owed, not claimed:** the preview eyeball, and it is cheap and real (NOT
FSA-masked): margin-edit on with two guides dragged and Preferences open, start
dragging a block, press Escape — the drag cancels, the guides stay, the mode
stays open, Preferences stays open.

## Layout-gesture stability

> **A continuous layout gesture — a pane-divider drag, an OS window resize, OR a content drag (drop-mode session) — costs O(1) settles, not O(frames) recomputes.** Every geometry follower either **PARKS** (`parkDuringLayoutGesture`: stash the call, replay exactly once on the gesture's end edge) or **SUPPRESSES** (`useLayoutGestureActive` / `isLayoutGestureActive` / `onLayoutGestureChange`: hide for the gesture, restore on the end edge). Nothing re-solves per frame.

This is the "resizing the PWA window makes the whole right side flicker" class (task 317), and its lesson is not that followers were sloppy — the doctrine above already existed and was **structurally unreachable for the gesture that needs it most**. `activeDrag` had exactly one writer repo-wide, `beginPaneDrag` inside the engine's `onPointerDown`, and **an OS window drag delivers no pointer events to the page at all**. So `isPaneDragging()` was false for the entire gesture: every park took its immediate-`run()` branch, `PaneFreeze` never locked, `parkDuringPaneDrag` had zero callers in `src/`, and the three `library/` consumers were inert while their comments asserted a freeze that wasn't there. Eighteen `addEventListener("resize")` sites and ~17 ResizeObservers ran live, every frame.

**One bus, three publishers.** [src/lib/pane-resize/layout-gesture-bus.ts](src/lib/pane-resize/layout-gesture-bus.ts) carries `kind: "pane" | "window" | "content"` on the info, so every pre-existing consumer gained window — and then content-drag — coverage with zero code change. One bus rather than several because the consumer set is identical and *the second subscription is exactly the one that gets forgotten* — this bug's own signature was `RightDetail` parking its ResizeObserver on the pane bus while registering a raw window `resize` listener to the same scheduler 38 lines away. The publishers stay **separate** (pointer edges, resize-burst edges, and the drop-mode session lifecycle are genuinely different detectors) and **colocated** (the edge functions are withheld from the barrel, so no consumer can fake an edge). The bus tracks a **set** and publishes only 0→1 / 1→0 on the main channel, because a pane drag and a window reflow (external display, Stage Manager) can overlap and an end edge published mid-gesture would un-park every follower.

**The content publisher** (perf Wave 2): a drop-mode session — block / text-object / inline-atom / card-anchor / stack-pull drag — publishes through `beginContentGesture`/`endContentGesture`, whose kind is pinned inside the bus and whose ONE legitimate caller is the drop-mode controller (the single chokepoint every pointer-driven content drag routes through; CI: [src/lib/\_\_tests\_\_/content-drag-guardrail.test.ts](src/lib/__tests__/content-drag-guardrail.test.ts) pins the import set). Edges: begin on session start; end at **commit entry** (the pointer gesture is over — a confirm dialog must not hold every park hostage) and idempotently in `endDropSession`, so no cancel path can leak a wedged gesture. Every producer is a hold-drag, so the controller's shared mousemove AND the lift overlay bail on `isMissedRelease` — with the bus in the loop, a swallowed mouseup would otherwise wedge every parked follower app-wide, not just leak an overlay. The same guardrail pins the rest of the content-drag law: the lift overlay moves by RAF-coalesced `translate3d` (React renders on edges only; JSX never sets `transform`), the Wave-0 universal drop-mode selector stays dead, and the hit-test move path never mints. The controller also owns edge-zone **auto-scroll** ([src/components/drop-mode/auto-scroll.ts](src/components/drop-mode/auto-scroll.ts)) — one self-terminating RAF loop that re-runs the throttled hit-test as content slides under the parked pointer; zero cost off the drag path.

**Kind-sensitive consumers use the SET channel, never the edge info.** The main channel publishes only OUTERMOST edges, so under overlap its begin and end can carry DIFFERENT gestures — an `info.kind` (or `info.id`) filter there skips the restore half and wedges the consumer. `onLayoutGestureSetChange` fires on every MEMBERSHIP change with that gesture's own info (still ≤2 fires per gesture, never per frame), and `hasActiveLayoutGesture(kinds)` reads the live set — recompute the desired state from it per fire, idempotently. On it today: `PaneFreeze` freezes for RESIZE-family only (a content drag must never freeze the pane hosting the drag — the Library Reader's `.tex` branch mounts an EditorPane inside one) and unfreezes the moment the last resize gesture leaves, even mid-content-drag; the editor-scrollbar thumb suppress is kind-filtered (a content drag moves no pane edge, and drag auto-scroll wants the thumb visible); `zen-margin` + `panel-column` id-filter on it (their old edge-channel id filters could strand `isResizing` under overlap). `useLayoutGestureActive(kinds?)` is the hook form of the same rule.

**The window publisher's edges**, the one genuinely new piece, since there is no `resizestart` and no pointer stream to derive one from: **BEGIN** on the *second* resize event inside a 100 ms burst — so a one-shot resize (maximize, zoom, keyboard, DPR change) never parks anything and nothing is left stale for a debounce window; **END** on a 150 ms trailing idle. A false end (the user holds still mid-drag) is benign by construction: followers settle once at the held position and re-park on the next event.

**A FOLLOWER asks the kind-blind question; an OWNER names its kinds** (task 472). Nearly every reader of this bus is a follower — it parks or suppresses because a gesture of ANY kind can move content under it, so `isLayoutGestureActive()` is exactly right there and five production files spell the bare `if (isLayoutGestureActive()) return;` form legitimately. There is one reader on the other side: the engine's own start gate, which asks a mutual-EXCLUSION question, and whose scope is *the kinds that contend for the singletons a second gesture would clobber*. Those are the drag shield plus the saved body cursor / `user-select` ([drag-shield.ts](src/lib/pane-resize/drag-shield.ts)) — engine-owned, so PANE-only, and the gate reads `hasActiveLayoutGesture(EXCLUSION_KINDS)` with `EXCLUSION_KINDS = ["pane"]`. Three rules it earned:

- **The comment said PANE and the predicate said ANY**, which is how the two costs went unnoticed for as long as the bus has carried three kinds: a divider press inside the window publisher's 150 ms trailing-idle tail (`RESIZE_IDLE_MS`, below) was **silently swallowed** — grab a divider straight after dragging the OS window edge and the first press does nothing, no cursor change, no grip escalation — and one wedged drop-mode session would have **disabled every divider in the app**, in both silos, until a reload. AGENTS.md already recorded that a swallowed mouseup there "would wedge every parked follower app-wide"; this second blast radius was never written down.
- **It is a POINT-IN-TIME read, so the SET-channel rule above does not apply.** That rule governs an `info.kind` filter inside an outermost-EDGE listener, where the begin and end edges can carry different kinds; a predicate asked once, synchronously, inside a `pointerdown` has no edge to miss. Said at the site too, or the next reader "fixes" the scope back.
- **`content` never belongs in the exclusion set** — that is the failure mode, not a guard. `["pane", "window"]` is the sanctioned fallback if a reviewer decides a divider drag *during* a live OS reflow is worth refusing; it still closes the unbounded half. The multi-touch case needs no scope of its own: the gate's `isPrimaryDragStart` already refuses a non-primary pointer.

CI: the scope census in [pane-drag-guardrail.test.ts](src/lib/__tests__/pane-drag-guardrail.test.ts) ("start-gate SCOPE"), whose POPULATION is the ENGINE FILE and not a two-silo sweep — stated because it is the load-bearing choice: the bare-return form is also how a follower suppresses, so a wholesale sweep would be the WRONG population rather than a stricter one, and the leg would carry no signal at all. Beside it, three behavioural legs in [use-pane-resize-handle.test.tsx](src/lib/pane-resize/__tests__/use-pane-resize-handle.test.tsx) drive the REAL bus (`__emitWindowResizeForTest` for the window publisher, `beginContentGesture` for the content one): a press during a WINDOW gesture starts, a press during a CONTENT gesture starts, and a second PANE gesture is still refused — the last a non-regression pin that passes either way and says so at the site. Measured by neutering the scope back to kind-blind: 2 behavioural legs and the census fail.

**Park or suppress — the choice is not stylistic.** Park a follower that MEASURES the resizing content from outside: nothing user-visible depends on its value mid-gesture, so it settles once and is correct. Suppress a **text-anchored overlay** (the slash popup, the selection bolt, the pending-change pill): parking one leaves it visibly *detached* from the text it points at, which is worse than the flicker it was meant to fix. Stay LIVE only where the frame itself is the obligation — today just `useWindowChrome` (the WCO strip tracks the native system buttons), and even that is RAF-coalesced, because it notifies through `useSyncExternalStore` at the app ROOT.

**Honest about the residual.** The left-edge asymmetry Gabriel reported is *compositor-side*, not ours: every placement path in both silos is client-origin-relative (`screenX`/`outerWidth`/`visualViewport` appear nowhere), so for the same resulting size a left- and a right-edge drag deliver byte-identical values to every handler — the DOM cannot observe which edge moved. What is ours is the *missed frame*; Chromium converts a missed frame on a moving frame-origin into a whole-window displacement rather than a stale edge strip. Removing our per-frame work removes the late frames. Expect a large improvement, not perfection. What IS ours on the right side: the editor column carries `flex: 1000 1 0` between two `flex-grow:1` rails, so a width delta moves its left edge ~0.001·d and its **right edge ~0.999·d** — identical JS lag is sub-pixel on left-anchored chrome and full-delta on right-anchored chrome, which is why the left-anchored grab handles never visibly flickered under the same handler count.

Two guards enforce it (the same probe + grep-allowlist pattern as the laws above):

- **Runtime probe** — `window.__layoutGestureStats()` ([src/lib/layout-gesture-probe.ts](src/lib/layout-gesture-probe.ts)) reports `{ gestures, framesInGesture, active }` plus per-site `{ parkedFires, settles, liveRuns }`. During a continuous drag every parked site reports `settles === 0` and `parkedFires ≈ framesInGesture`; after release, **exactly 1** settle per site that fired; a one-shot resize reports `gestures === 0`. Honest floor: the publisher needs two events to know a gesture started, so a real drag's first event or two run live and are counted in `liveRuns`.
- **Grep-allowlist test** — [src/lib/\_\_tests\_\_/window-resize-guardrail.test.ts](src/lib/__tests__/window-resize-guardrail.test.ts) censuses every resize registration in `src/` **and** `library/` (`addEventListener("resize"` on any receiver, plus the `onresize =` and `visualViewport` forms) against `PERMITTED_RESIZE_LISTENERS`, and — the leg with teeth — asserts each censused file actually *references* the park/suppress API unless it is on `PERMITTED_LIVE_RESIZE_HANDLERS` with a why-live justification. **None of the three older censuses greps a resize listener**, and that gap is precisely how eighteen ungoverned sites accumulated without a single CI failure. Keep this prose and both allowlists in sync — same discipline as the other laws.

### The scroll half: a CONTENT drag scrolls the document, so its followers are the SCROLL listeners

> **A pane drag and a window resize scroll nothing — but a CONTENT drag scrolls
> the document ITSELF, so during that gesture every scroll listener is a
> per-frame follower exactly as every resize listener is a window drag's.** A
> user scroll is not a layout gesture, so the same park is a no-op for ordinary
> scroll-tracking chrome; the rule costs nothing outside a drag.

This is the residual half of the "list drag and drop is an absolute mess" report
(task 416; the placement half is "The candidate half" below, the performance
half was task 351). The content publisher has been on the bus since perf Wave 2
and reached **none** of the scroll listeners, because every census in this file
asks a question that cannot see one: `keystroke-subscriber` greps
`editor.on(…)`, `scroll-reposition` greps `position: fixed` + `coordsAtPos`,
`pane-drag` greps pointer moves + drag chrome, and `window-resize` greps
`resize`. Meanwhile [auto-scroll.ts](src/components/drop-mode/auto-scroll.ts)
writes `scrollTop` once per RAF for the whole of a long drag, so four followers
ran per auto-scroll frame with CI green:

- **The two section-path breadcrumb walks** (`EditorLayout` and the Reader's
  twin), whose comment stated the exemption outright — *"the scroll path stays
  live: a breadcrumb must follow the scroll it describes."* True of a scroll the
  USER performs, and blind to the one a drag performs. `compute` is ONE
  `posAtCoords` + a binary search on the fast path and an O(headings)
  `coordsAtPos` walk on the flag-off fallback, which is the single heaviest
  per-frame cost in the app at ×1 pane (×2 with the Reader).
- **`EditorPane`'s scroll-position persist**, whose `el.offsetHeight` is a
  FORCED-LAYOUT read once per scroll event, interleaved with the drop
  indicator's own React `top` write — the write → read → write thrash the
  float-move law names. Parking is also the semantically right answer: the value
  captured is *where the reader left the document*, and mid-gesture there is no
  such position.
- **The grab handle's placement re-solve.** Task 317 parked its resize path and
  argued the scroll path could stay live because *"an OS window drag delivers no
  pointer events to the page."* A content drag delivers them, so task 336's
  modality gate reads POINTER and the hover branch stayed answerable: it re-ran
  `blocksAtY` plus one `computePlacement` per containing level for the whole
  drag — under a lift ghost, on chrome `globals.css` has already made
  `pointer-events: none` for the session. Its MOUSEMOVE path has parked since
  perf Wave 2, so the scroll path was the last live refresher and closing it
  finishes a decision already taken rather than making a new one.
- **The geometry service's IntersectionObserver.** `onResize` has been
  gesture-gated since 317 and `onIntersection` never was, although the IO is the
  one the auto-scroll actually fires: blocks cross the ±800 px near-zone
  boundary continuously, each crossing paying a `measureBlock` plus a
  `notify()` — the marginalia deck's full repack, the one O(markers) cost in
  that file — and each BATCH paying one unconditional `host.getBoundingClientRect()`
  even when it measured nothing.

Five rules it earned:

- **A kind-blind park is EXACTLY right here, and that is worth stating rather
  than reaching for `hasActiveLayoutGesture`.** A pane drag and a window resize
  produce no scroll OF THEIR OWN, so the park is essentially unreachable for
  them — and where a rewrap that shortens the scroll range does make the UA
  clamp and fire one, parking is the answer 317 already chose for that gesture,
  so the kind-blind form is not merely harmless there but correct. One park per
  follower covers all three families with no filter to keep in step.
- **ONE park, one clock, one settle — a second park publishes a HOLED deck.**
  The adversarial pass on this fix found the first cut using a separate notify
  park, and the two settle through different clocks: `scheduleRecompute` only
  ARMS a RAF while `notify()` is synchronous, so the deck was announced one
  full frame BEFORE the measures it was announcing, against a cache holding
  every mid-gesture LEAVE eviction and none of the deferred ENTER measurements.
  Every block that left and re-entered the near zone during the drag lost its
  marker for a painted frame at drop time, and the gesture cost TWO O(markers)
  repacks instead of the one the code claimed. The deferred notification rides
  the recompute park as a flag (`pendingNotify`), so `flushRecompute` measures
  and then publishes.
- **Defer the MEASUREMENT, never the BOOKKEEPING.** The IO's observed set is the
  engine's memory of which blocks it is tracking, and a swallowed crossing
  leaves it permanently wrong after the drag — including the detach-heal path,
  whose whole job is to re-observe an element ProseMirror redrew. So mid-gesture
  the ENTER branch observes, joins the set and runs the heal, and only the
  measure defers, onto the same `pendingRecompute` work list `onResize` already
  collects into. Same shape as "park the MEASURE PASS, never the accumulation".
- **A forced-layout read belongs behind the branch that needs it.** The host
  rect resolves LAZILY now, for the same reason the position resolver already
  did — a batch that measures nothing (a pure scroll-away, or any batch during a
  gesture) must pay nothing.
- **"Live" buys a per-frame OBLIGATION, never a per-frame COST.** The four
  followers that stay live are the ones for which the scroll ITSELF is the
  feedback — the scrollbar thumb (whose suppress is already kind-filtered so a
  content drag keeps it VISIBLE), the Library page lozenge and its page readout,
  a hint that must vanish, and the reposition probe that cannot park on the
  gestures it instruments. Each is O(1) per event with no doc walk. The
  scroll-activity tracker earned its place by getting CHEAPER: `setAttribute`
  invalidates style even when the value is unchanged, so the write is now
  idempotence-gated and a continuous scroll costs one invalidation instead of
  one per frame.
- **The detector's own first cut was narrower than its doctrine, which is the
  hole every census in this file has had to be widened out of once.** React's
  `onScroll={…}` prop registers the same listener and fires once per scroll
  frame, and the Library silo uses it for two real followers (the list's
  virtual window, the Reader's position persist — the second reachable by a
  content drag, since the Reader mounts an `EditorPane` inside its scroller).
  An `addEventListener`-only grep saw neither. Both were found by asking the
  QUESTION rather than by trusting the regex, which is the only thing that
  ever widens a census. The residual it still carries is named rather than
  waved away — `useEditorScrollParentEvent` takes the event NAME as a
  parameter and is documented as the way to attach an editor scroll listener,
  so the census's file list is accurate only because that helper has no
  callers yet.
- **The census is the leg with teeth, and leg 2 is per FILE — so the
  justifications are written about the SCROLL path.** `editor-scrollbar.tsx` is
  the live example: its resize path parks and its thumb suppresses, so it passes
  participation on a scroll path that is deliberately live. The pre-416
  breadcrumbs were the same shape in the other direction — a park existed in the
  file while the heavier path ran raw — which is why four per-site pins sit
  beside the census.

CI: [scroll-listener-guardrail.test.ts](src/lib/__tests__/scroll-listener-guardrail.test.ts)
(the fifth grep-allowlist sibling: `PERMITTED_SCROLL_LISTENERS` +
`PERMITTED_LIVE_SCROLL_HANDLERS`, plus the four converted-site pins, each of
which fails on the pre-416 source) and
[gesture-scroll-parking.test.tsx](src/lib/editor-geometry/__tests__/gesture-scroll-parking.test.tsx),
which drives the REAL service through a REAL content gesture. **No pre-416 suite
could see any of this**: every geometry suite in the repo drives the observers
with no gesture live, where the parked and unparked paths are byte-identical by
construction. Measured by neutering each half in turn: the pre-416 handler
takes 6 legs, a whole-handler bail (the shape the bookkeeping rule outlaws) 5
— including the detach-heal leg no fixture that primed every block could have
reached — a second notify park 1, dropping the per-batch host-rect memo 1, and
each converted site its own census pin.

**Owed, not claimed:** a DevTools trace of a 5 s drag over `doc_perftest` with
no >8 ms task attributable to the drag path, plus Gabriel's own feel check.
A worktree cannot run the dev server, so both happen against clean `main`.

Deliberately NOT done, and a UX call rather than an oversight: **no root-level `PaneFreeze`**. Its anchor must be the *stationary* edge (anchoring to the moving one is visibly worse than no freeze at all), knowing which window edge moved requires a `screenX`/`screenY` probe this codebase otherwise doesn't use, and freezing the whole app during a live OS resize shows background slivers until release.

## Bar occupancy: several occupants, ONE priority rule

> **Where several elements share a fixed-width strip, they do not position
> themselves against each other — the strip RESOLVES a priority ladder, once,
> from measured natural widths, and the lowest tier yields.** The ladder for the
> Virgil bar is stated in
> [src/components/editor-layout/bar-occupancy.ts](src/components/editor-layout/bar-occupancy.ts)
> (protected status > tabs > collapsible tools; `STYLE_GUIDE.md` → "Occupancy
> priority") and resolved by `useBarOccupancy` from ONE ResizeObserver over three
> boxes. Under it sits a structural FLOOR: the tab strip clips its own
> horizontal overflow, so an overlap is unrepresentable rather than merely
> avoided.

This is the "tool icons paint across the tab label at a narrow window" class
(task 395), and it is the marginalia lane's law one strip over — same shape as
"The lane regime" and "The ordering half" below, arriving in the bar because
`TabStrip` is `flex-1 min-w-0` while every tab inside it is `shrink-0` with no
clip, and `StatusCluster` is `shrink-0`. Three occupants, no negotiation: the tab
row simply spilled RIGHT and the two interleaved by paint order.

**The prose outlived the mechanism by two months, which is why it read as safe.**
`TopBar` promised "the toolbar never overlaps tabs even when they crowd the
middle", clamped against a "topbar-left sentinel" `TabStrip` described in a
comment — with NO element and no consumer anywhere. Git archaeology: the clamp
was real once (`1b2bed95`, a floating MenuBar pod with two ResizeObservers on the
bar's left and right groups), the pod moved into the pod chrome header
(`93b286c0`) and its `menuLocation` pref was deleted as dead (`bab3a399`). The
task-202 shape, in comments rather than exports: **a comment describing a
retired mechanism is how the next reader concludes the invariant is held.**

Four rules it earned:

- **The predicate is STATE-INDEPENDENT, so it needs neither hysteresis nor a
  cached "width in the other state".** Written naively — *do the tabs overflow
  their box?* — collapsing frees room, the tabs then fit, the rule expands, and
  it re-collapses on the next frame, forever, in the band where the freed width
  is just enough. The strip's own assigned box already nets out the protected
  width AND (while expanded) the tools, so `T + (collapsed ? K : 0) ≤ tabStripPx`
  reduces to `T + K + R ≤ W` in BOTH states. Cancellation, not damping.
- **Live during a layout gesture, deliberately** — the `useWindowChrome`
  exemption in "Layout-gesture stability" above. Parking the verdict means the
  bar visibly overlaps for the whole of an OS window drag, which is the defect.
  Affordable because the per-fire cost is three `contentRect.width` reads
  (post-layout, forces no layout) behind a per-role equality bail plus one
  boolean; a whole resize drag commits ONE React render, at the crossing.
- **The rule governs the DEFAULT; the user outranks it — and an override is
  minted only where there is something to out-rank.** The auto rule never writes
  the persisted `topbarRightCollapsed` pref, and expanding out of an AUTO
  collapse sets a session override dropped on the auto TRUE→FALSE edge, so the
  chip is never a control that does nothing (the false-affordance class). The
  half worth carrying forward is the *mint* condition, which the first cut got
  wrong: `setExpandOverride(autoRef.current)`, never a bare `true`. An override
  created while nothing was crowding has no expiry — its drop fires on an edge
  that never comes — so an ordinary wide-window collapse-then-expand left a
  sticky override that disabled the rule for the session and clipped the tab row
  instead of yielding the tools, the exact inverse of the priority. **An
  override's lifetime is the condition it overrides; if that condition is
  absent, so is the override.**
- **Nothing in a HIGHER tier may change width as a function of the verdict**, or
  the state-independence above is false and the flip-flop is back. `R` is only
  constant across the verdict because tier 1 does not react to it — which is why
  `SaveStateBadge` reads the user's `collapsePreference` and not the effective
  value. It is the same fact as the ladder's own rule (a data-integrity surface
  is not hideable by a layout preference), arriving as a soundness requirement:
  a tier-1 element that hid itself on an auto collapse would shrink `R`, grow
  the strip by more than `K`, and make the two states disagree.
- **The collapsible group collapses by WIDTH, not by unmounting**, which is what
  makes rule 1 cheap: its `max-content` wrapper keeps reporting the group's
  natural width in both states. That is a measurement decision, and it leaves
  three debts the unmount used to pay, all of them owed on the collapse EDGE:
  (a) the children are REMOUNTED (a `key` on the inner content, never on the
  measured wrapper — keying that would drop the measurement and fail the rule
  open into a flip-flop), because `visibility: hidden` cannot reach a child that
  body-PORTALS its dropdown and a remount closes every such menu for every
  portal owner present and future, where a per-child gate closes it for the one
  somebody remembered; (b) focus moves to the chip, since `aria-hidden` over a
  focused element is forbidden and the chip is the affordance that brings the
  group back — tracked as focus-WITHIN on the group, because `activeElement` has
  already fallen to `<body>` by the time any effect can ask, and asking
  "is it body?" would steal focus whenever the bar collapsed with nothing
  focused; (c) the clip is CONDITIONAL — an unconditional `overflow: hidden`
  trims every button's focus ring in the expanded state too. A surface whose
  open state lives OUTSIDE the group (the help menu, owned by `EditorLayout`) is
  unaffected by a remount and is gated explicitly, exactly as unmounting left it.

A composed ref on a measured element is a **stable** `useCallback`, never an
inline arrow: React detaches and re-attaches an unstable ref callback on every
render, and this one's detach drops the strip's measurement, so an inline arrow
makes an ordinary re-render look like "the tab strip left the bar" and can bounce
the verdict against its own re-renders (measured — the suite hung until it was
stabilized).

CI: [bar-occupancy.test.tsx](src/components/editor-layout/__tests__/bar-occupancy.test.tsx)
drives the REAL `TopBar` (real `TabStrip`, real `StatusCluster`) through a fake
`ResizeObserver`, because jsdom has no layout and "the boxes do not intersect" is
not a question it can answer at all — what IS measurable is the DECISION, and the
flip-flop leg is the one a naive overflow rule fails. Its census covers the two
halves no render can see: the strip's `overflow-x: clip` / `overflow-y: visible`
pair (`hidden` would coerce the vertical axis to `auto` and eat the active tab's
seam overhang), and the shared label cap — declared in the inline renderer and
NOT in the active folder tab, whose `calc-size(max-content, …)` width therefore
grew without bound with the document's name. Measured by neutering each half in
turn: the naive rule takes 3 legs, no auto-collapse 4, the clip 1, the label cap
2, and restoring the retired sentinel prose 1.

**Residuals, stated rather than implied.** The floor CLIPS; it does not offer an
overflow affordance. A tab row wider than the strip after the tools have yielded
loses its rightmost tabs with nothing on screen to say they exist, and the
paper-drop indicator — absolutely positioned inside the clipped strip — is
invisible for a drop past the boundary (the drop INDEX is computed from cursor
midpoints and still commits correctly; what is missing is the feedback). Both
are strictly better than the pre-395 behaviour, which was to paint over the
protected badges, and both want a product decision (a scroll, an overflow
chevron) rather than a wider guard.

**Owed, not claimed:** the preview eyeball at the screenshot's width plus one
narrower. NOT FSA-masked; this run was unattended and could not start a dev
server.

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
- **Failure mode per element, and the unmeasured frame FAILS OPEN.** The bolt tucks; the grid gives up COLUMNS, and at nothing-left it hides that side entirely — cells and the "+K" pill together, since both are pinned in the same column. (Pre-410 the orphan re-pin dock was culled with them, which was the wrong answer for a surface whose whole job is that an anchor-less card does NOT vanish; it has since left the lane — see "The occupancy half" below.) (The original text said "a two-column grid has no sub-lane left to tuck into" and that was the sentence task 325 had to retire: there is one, and the tuck was sitting on it.) An uncommitted viewport frame (`frame.editorEl === null`: pre-first-refresh, a keep-alive pane mounted while `display:none`, a detached view) is every-field-zero, so keying the regime on the arithmetic instead of that sentinel would cull every marker on the first commit of every pane and on every warm tab switch — far worse than the overlap being guarded.

`computeMarkerPositions` takes the resolved per-side COLUMN COUNTS as a REQUIRED argument (a defaulted answer is a decision nobody made), and `Marginalia`'s `useLaneCols` reads the service's viewport channel through `useSyncExternalStore` with a PRIMITIVE packed-integer snapshot — no new observer, no editor subscription, and React bails the re-render on every refresh that leaves the regime unchanged (which is every refresh a keystroke can cause: a height change moves the frame's vertical fields and the regime reads only horizontal ones). CI: [src/lib/\_\_tests\_\_/marginalia-lane-regime.test.ts](src/lib/__tests__/marginalia-lane-regime.test.ts) sweeps every margin 0–200 on both sides through the REAL predicate into the REAL grid and asserts no cell (or pill) ever starts inside `text edge ± INNER_PAD`; it also censuses the production call sites, because a test of the predicate alone structurally cannot catch the original shape — the predicate was never the part that misbehaved, the call site that never asked was.

#### The ordering half: two thresholds that differ need one ORDER, not two answers

Same lane, one axis in (task 325) — and the case where both predicates were right and their *combination* was nobody's job. The grid clears the prose down to a 70px margin and the bolt loses its inboard slot below 104px, so between them BOTH render; the tucked bolt's band is `[64, 92]` in container coordinates and marker col1's is `[70, 92]`, so col1 was painted over — and, the bolt being a fixed portal above `pointer-events-auto` cells, unclickable. `RIGHT_LANE_BANDS` was built to make disjointness STRUCTURAL, and it delivered that only in the reserved regime: both cramped fallbacks were computed OUTSIDE the list, one in pod coordinates and one at wide-lane column offsets.

> **Where several pod-anchored elements share a lane, "does my slot clear the prose?" is not enough — the lane is RESOLVED once, outboard → inboard, in ONE coordinate space, and every element reads its answer off that resolution.**

[`resolveRightLane(available)`](src/lib/marginalia.ts) is it: the scrollbar is fixed, the BOLT places (its reserved inboard band where the lane is whole, otherwise the tuck against the scrollbar floored at the prose edge), and the GRID takes the columns that remain entirely inboard of wherever the bolt landed. `computeBoltLeftFromPod` and `resolveMarkerCols` are both thin readers of it. Four rules it earned:

- **Priority is stated once, in the resolution, and it is a product call.** The bolt outranks the grid because it is the sole entry to `ActionsMenuPanel` (no other surface reaches it) and its 28px body cannot degrade, while the grid already has a graceful absence (214) and a graceful overflow (the "+K" pill). Nothing is dropped that does not have to be: in the 70–103 band the grid keeps col0 — the same single-column shape the LEFT lane has always had — rather than the whole side going dark, which is why option "raise the grid's threshold to 104" was rejected. It would have thrown away the honest band 214 derived.
- **Re-base the outlier into the shared space; don't compare across two.** `MARGINALIA_BOLT_TUCK_X_RIGHT` is the tuck as a container-relative lane offset (= 64), pinned byte-exact against BOTH its task-045 pod spelling and the band-list spelling, so the re-basing is provably neutral. "Which columns does the bolt cover?" is then arithmetic over one origin instead of a comparison between coordinate systems — the shape that let a fixed pod-offset sit on col1 for a year.
- **The count is DERIVED by walking the same column offsets `cellAt` packs against** (`rightColumnsClearingBolt`), never a hand-written "one", so it follows the bolt size, the icon width and the gaps automatically.
- **This cost nothing at the prose threshold, and the reason is worth knowing.** Right cells run OUTWARD from col0, so `marginGridInset("right")` is col0's left edge at ANY column count — losing col1 cannot move 214's derived 70. A future change that made the right grid pack INWARD would have to renegotiate that, which is why the suite pins the independence explicitly.

**The residual this section used to record is CLOSED by task 410.** It read: *the orphan re-pin dock is not a band — it is pinned at `right: 2` inside the same column, so it overlaps the scrollbar gutter in EVERY regime and the tucked bolt in this one … a visible chrome relocation to fix, so it is out of scope here and explicitly outside the disjointness sweep.* The relocation happened: the dock is gone from the lane entirely, so the sweep's scope ("cells and the pill") is now a statement about every occupant there is, rather than an exclusion. See "The occupancy half" immediately below.

CI: the same [marginalia-lane-regime.test.ts](src/lib/__tests__/marginalia-lane-regime.test.ts), widened with the sweep in the prose-clearance sweep's own shape — every margin 0–200, markers enough to force a second row and a pill, and at each one the bolt's band must miss every rendered cell, with counters asserting the sweep crossed BOTH regimes *with markers up* so it cannot pass by hiding everything. Three legs fail when the cramped branch is reverted to the full column count.

#### The occupancy half: a lane packed by ONE walk has ONE kind of occupant

Same lane, and the case where the packer was complete, correct, and simply not
the only thing rendering into the column it packs (task 410). Task 366 made
"the LANE is packed, once, in one walk" true of the marker ROWS. `OrphanDock`
was a second owner in that column — `position: absolute; top: 6; zIndex: 12`,
`pointer-events-auto`, rendered as the last child of the same `MarginColumn`
and invisible to `computeMarkerPositions` by construction.

Three costs, measured, and the third is what made this a relocation rather
than a z-index nudge:

- **It overlapped the first blocks' cells, and it STOLE their clicks.** Its
  band is `6 … 12 + 26n`; the prose root sits below a 40px
  `doc-prose-leadin::before`, so the first cell lands at ≈83 at the default
  40px top margin and ≈43 at `MARGIN_MIN.top` — n ≥ 3 and n ≥ 2 respectively.
  Horizontally the dock is 32 wide, so on the LEFT it clipped col0 by 12px and
  on the RIGHT it covered col1 entirely. Being an opaque `pointer-events-auto`
  surface ABOVE the cells, a covered marker lost its pixels AND its clicks —
  the task-325 bolt-over-col1 shape, one axis over.
- **It was culled with the cells.** The `laneCols[side] <= 0` gate (a cramped
  margin, zen, the read-only reader) dropped the dock along with the grid, so
  the one surface that exists to stop an anchor-less card vanishing could
  itself vanish.
- **It was unreachable on any scrolled document.** `top: 6` inside a naturally
  tall, non-scrolling pod (`.editor-pane-pod` is `overflow: clip`) means the
  re-pin entry point is only on screen at the very top of the paper.

> **A lane whose packing is "one walk" has exactly ONE kind of occupant, or the
> claim is about the walk and not about the lane. And an affordance for a fact
> that is not POSITIONAL does not live in a positional lane: the unanchored set
> needs no metrics, no side and no lane regime, so it is derived at the marker
> SOURCE and surfaced in chrome that is visible from anywhere in the document.**

[`UnanchoredCardsChip`](src/components/UnanchoredCardsChip.tsx) is that
surface — an "N unanchored" pill in the pod's STICKY chrome header, beside the
MenuBar. Six rules it earned:

- **The deep move is that the packer stops KNOWING about them.**
  `MarkerPositionsResult` no longer carries an `orphans` bucket at all, and
  `computeMarkerPositions` skips an `m.unanchored` marker before the side is
  even resolved. Reserving a band for the dock (the other candidate) was
  rejected for the reason 366 exists: it teaches the packer about a
  non-marker-row owner, which is exactly the claim being repaired. A bucket
  left behind is a bucket a future renderer reaches for.
- **The relocation is what makes the cramped-lane cull go away** — not a
  second exemption inside the gate. The chip takes no lane input, so its
  visibility cannot be decided by a margin width.
- **The entries are the SAME `MarkerButton` the lane renders**, in flow layout
  (the shape the "+K" overflow popover already uses). Click still opens the
  card's panel and the grab still starts the drop-mode re-anchor session —
  nothing about that gesture depends on where the button sits, which is why
  the relocation costs no behaviour.
- **It is fed from the UNFILTERED marker set.** The master "show marginalia"
  toggle and the per-type hide set are preferences about the LANE; a card that
  lost its anchor is the same class of fact as a save refusal, and this file's
  own rule is that a data-integrity notice is not hideable by a layout
  preference. Archived cards ARE excluded — an archived card is deliberately
  out of the margin and out of its panel's default list, and its home is the
  Archive panel.
- **The chip renders NOTHING at zero**, rather than a disabled control that
  does nothing (the false-affordance rule).
- **`MarginColumn` is exported for the sweep**, the way `MarkerButton` already
  is for the pin-gesture suite — the interception half is a DOM fact, and a
  geometry-only assertion passes on an implementation that paints correctly and
  still eats the click.

CI: [unanchored-cards-chip.test.tsx](src/components/__tests__/unanchored-cards-chip.test.tsx).
The sweep drives the REAL grid into the REAL `MarginColumn` over n = 1..4
unanchored × margin 0–200 × both sides, with counters proving it crossed both
lane regimes, and asserts BOTH halves: no unanchored marker in either lane
bucket, and **no click-taking surface in the column that is not a marker
button**. Its fixture's `node.top` includes the 40px lead-in — without it the
sweep false-positives at n = 1. The leg with teeth is the CENSUS: the packer
was never the part that could misbehave, a second owner rendered into the
column is, and so is a chip fed from the view-filtered set or mounted inside
the scrolling pod — none of which any test of `computeMarkerPositions` can see.
Measured by neutering each half in turn: restoring the in-lane dock takes 2
legs (the sweep's interception half and the census), feeding the chip
`visibleMarginaliaMarkers` 1, and mounting it in the pod 1. The pre-410
contracts in `marginalia-grid.test.ts` ("it goes to `orphans`") and
`marginalia-lane-regime.test.ts` ("the dock goes with the cells") are
RENEGOTIATED in place with the reason at the site — both pinned the defect as
the contract.

**Owed, not claimed:** a real-FSA eyeball. Orphan state comes from real anchor
death, which is the FSA-masked class, so the durable proof here is the unit
sweep — delete a paragraph carrying three same-side cards, then click the first
block's markers (they answer) and open the chip (all three are there, and one
of them drags back onto a paragraph).

#### The vertical half: a per-owner layout with no cross-owner resolution

Same lane, the other axis (task 366) — and the case where the resolver was
complete, correct, and answering a question one scope too small. The grid
resolves a collision WITHIN one anchor node (rows × cols, then the "+K" pill);
two nodes' grids were placed independently at their own `node.top`s, and
nothing owned the space between them.

That is safe exactly while consecutive block tops sit further apart than an
icon is tall — false for the shape at the top of every paper. A
title/author/date stack, a run of short headings, any small-print block: two
grids overprint, and the user sees two markers stacked half-on-half with no
error, no log line and a well-formed layout (Gabriel's screenshot).

> **Where several owners lay out into one shared lane, "did I place my own
> items correctly?" is not enough — the LANE is packed, once, in one walk.**
> `computeMarkerPositions` orders each side's node groups by document position
> and walks every row it is about to place against a running frontier, pushing
> a row just clear of the one above it. Same minimal-displacement forward pass
> the omni deck's card cascade runs one lane over (`resolveCascade`), which is
> the sibling that already had this and the reason the hole was invisible: the
> cards were packed and the markers beside them were not.

Four rules it earned:

- **The walk is UNIFORM over intra- and inter-node rows.** A user looking at
  two overlapping icons does not know which block each belongs to, and the walk
  does not have to ask — it asks only "does this row clear the one above it?".
  So a node whose own line pitch is tighter than an icon (18px small print)
  stops self-overlapping too, at the cost of its lower rows drifting off their
  lines. That is the right trade: line alignment that overlaps is not
  alignment.
- **The gap is the rhythm the uncrowded case already has**, which is what makes
  the byte-identity claim true rather than hopeful. `MARGINALIA_ROW_MIN_GAP` is
  2 = a canonical 24px line minus the 22px icon, so the walk cannot fire on the
  canonical pitch and an uncrowded document is placed exactly as it was
  pre-366. Raising it to 4 fails two legs, one of them in the pre-existing grid
  suite — measured, not assumed.
- **Past a stated bound the walk stops pushing and FOLDS.**
  `MARGINALIA_MAX_MARKER_DRIFT` (two icon heights) — beyond that a marker reads
  as belonging to a different paragraph, so the node's markers go into a "+K"
  pill instead, the affordance an over-full grid already uses. Consecutive
  folded nodes share ONE pill, and that is what bounds the cascade: the first
  fold costs a cell, every fold after it costs nothing, so a crowd of any depth
  collapses to a pill rather than a ladder of ever-more-drifted markers. Stated
  honestly at the site: the pill itself sits further than the bound from the
  anchor that minted it, because in a crowd that dense there is no room — one
  pill beats N drifting markers.
- **What a fold must preserve is IDENTITY, not position.** A hidden marker
  renders as an ordinary `MarkerButton` with no cell, and the click path
  resolves its card by `(entityKind, entityId)` — never by Y — so click, delete
  and re-anchor behave exactly as in-grid. The suite asserts the identity
  round-trip rather than assuming it.
- **Document order is a TOTAL order, or the pack reshuffles for reasons the
  reader cannot see.** `top` then `domTop` then the anchor UUID. The last rung
  looks decorative and is not: a full geometric tie is a real shape (a
  `bulletList` and its first `listItem` are both uuid-bearing and can measure to
  the same top AND domTop), and without it the walk falls through to
  `Array#sort`'s stability — i.e. to whichever PANEL emitted its markers first,
  so an unrelated panel's list changing would visibly reorder the pack. The uuid
  is arbitrary between two tied nodes and INTRINSIC, which is the property that
  matters.

CI: [marginalia-cross-node-collision.test.ts](src/lib/__tests__/marginalia-cross-node-collision.test.ts).
Its shape is the point: **every marginalia fixture in the repo drives ONE node**
(`"p1"`), so two grids disagreeing is unrepresentable in all of them — which is
how this shipped with the grid suites green. Every fixture here is multi-node,
and the invariants are swept over the placed cells (zero pairwise overlap,
bounded drift, conservation — every input marker comes back exactly once,
placed or hidden) rather than pinned to hand-computed pixels. Measured by
neutering each half in turn: per-node independence takes 4 legs, the intra-node
half 1, the fold 3, a rigid row offset 4, the crowd-RESTART disjunct 1, each
tie-break rung 1, and a widened gap 2 (one of them in the old suite).

Two of those legs exist because the adversarial pass on this fix found their
branches **unreachable from every fixture** — the shape this file keeps
re-learning, one level down from a call site that never asks: a live branch with
no leg is deletable in silence. Both needed a fixture no natural crowd produces.
The crowd-restart rung only fires when a TALL grid at a tight pitch shoves the
frontier far below its own block and short blocks underneath then fold while
sliding past the open pill's anchor — a uniform run of short blocks keeps the
frontier only ~50px ahead and never reaches it. And the tie-break rungs need two
nodes at one `top`, which no fixture in the repo had, because `AnchorNodeMetrics`
fixtures are written one node at a time. The leg that pins the restart is a
PROPERTY (`no pill collects markers whose anchors span more than the bound`), not
the branch's shape, so it survives a rewrite of how the crowd is tracked.

#### The ink half: chrome NEVER paints on the ink it labels

Same question, other gutter (task 382) — and the case where the anchor knew
about the glyph, the two passes that could MOVE the anchor's answer did not, and
one of them was written a year later.

A grab handle's X is `markerLeft − gapPx − HANDLE_WIDTH`, and for a list `<li>`
`markerLeft` is the MIDDLE of the measured `padding-left` band — an anchor whose
whole stated point is "the handle clears the bullet", because the `::marker`
pseudo has no rect to read. Two later passes then took that answer as a starting
position rather than as a bound: the narrow-viewport FLOOR
(`editorColumnLeft − marginInset`), which pins a top-level list's CONTAINER
handle, and task 353's same-row SEPARATION, which pushes each inner handle
`MIN_SAME_ROW_GAP_PX` inboard of the one before it — **with no upper bound at
all**. On a top-level list the container is on the floor, so the whole 24px has
to come out of the item's side, and the item's box landed on the `•` (Gabriel's
screenshot). Nothing failed: the placement was well-formed and every pass was
self-consistent with the numbers it held.

> **Where several passes decide one affordance's position, they resolve a LANE,
> not a point: `[floor … cap]`, with the cap derived from the row's `inkLeft` —
> the leftmost DOCUMENT INK on that row, resolved BESIDE the anchor
> (`resolveMarkerGeometry`) so the two can never disagree. Every pass that moves
> the affordance moves it within the lane, and the cap outranks the spacing
> target.**

Five rules it earned:

- **The cap binds the RESTING position, not just a push** — which is what
  turned a list fix into a class fix. An ordered list's `10.` reaches further
  left than the band-middle anchor assumes, so that row collided with no push
  involved. A cap applied only to the separation would have closed the reported
  case and left its sibling live.
- **A measurement may only TIGHTEN a heuristic, never loosen it** (`min`). The
  band middle is what we are entitled to assume without a rect; the measured
  marker-string width (`text-metrics.ts` `measureTextWidth` — never a hardcoded
  px, per this same section's own rule) is what closes the gap where the
  assumption is false. Where there is no canvas the measurement answers "no
  opinion" and the heuristic stands alone.
- **The FLOOR outranks the CAP.** An unreachable handle is worse than an
  overlapping one, and a cap left of the floor means the row has no clear margin
  at all.
- **The bound is per-ROW and the widest marker is the safe one.** A list's
  ink boundary is computed from the widest marker the LIST can render
  (`children.length`, O(1)) rather than this item's own index (O(siblings) on
  every hover placement) — a bound that covers every row is the safe direction,
  and the cheap one.
- **Widening the lane is a real lever, and it is a layout decision.** The
  `.tiptap ul/ol` marker band went 1.5em → 2em in the same task, because at
  1.5em the cap fired on the everyday top-level list instead of being the
  rare-case net it is meant to be. Recorded in `STYLE_GUIDE.md` with the
  inequality that says what "fits" means, since it moves every list in every
  document.

CI: [handle-marker-ink-clearance.test.tsx](src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx)
drives the REAL component over a REAL marker band at TWO font sizes — the em/px
unit mix (band in em; floor, gap-min and handle width in px) is why the report
reads as intermittent — and states the contract as a CLEARANCE rather than as
non-intersection: at the reported geometry the pre-fix box ended **0.25px** short
of the band middle, so a bare "doesn't intersect" leg would have passed on the
very screenshot that produced the task. Each geometry leg asserts twice: against
the RESOLVED boundary (the contract) and against where the FIXTURE actually
paints the glyph (the reality), because a leg that checks only the code's own
estimate cannot tell a good estimate from a bad one — the same shape as "an
approximation never decides its own eligibility", one gutter over. Measured by
neutering each half in turn: the separation cap takes 4 legs, the lane cap 7,
the measured-ink half 4, and the shipped 2em band 1.

**Residual, stated rather than implied.** `inkLeft` is a LEFT edge, not a span,
so a handle is bounded by the ink it approaches and not by ink it has already
passed. The one shape where that shows is an expex row 1, whose `(n)` sits
between the block's handle and the item's: the item handle's box straddles the
`(n)` — pre-existing, unchanged by this task, and unfixable with left edges
alone. Closing it needs ink SPANS plus a row-lane packer, and the alternative
available today (treat an outboard marker's LEFT edge as a barrier) would force
both handles into the 1.5em `(n)` column and reproduce the unreadable blob task
353 exists to prevent.

##### The hierarchy half: a per-level answer is anchored to its OWN level

Same gutter, the VERTICAL axis (task 394) — and the case where the rule was
right about the shape it was measured on and generalized to a shape that
falsifies it. Task 353 (Gabriel's own spec) measured a FLAT list and concluded
that a container's handle must anchor to the HOVERED row, so that "a container
and its item produce the SAME opticalCenterY" holds at every row rather than
only at row 1; the implementation delivered it by threading a per-hover
`descendTo` HINT into `resolveFirstLineTarget`.

A nested list falsifies it. The hover set is every CONTAINING level, so
anchoring each of them to the pointer's row stacks one handle per level onto
that one row — Gabriel's screenshot: three handles bunched on "locations", the
innermost pushed onto the bullet glyph (the very 382 collision the ink cap
exists to bound, arriving from the axis the cap cannot see). Nothing failed:
every placement was well-formed, every handle was on the row 353 asked for.

> **Every grab handle anchors at its OWN block's first visual line, at its own
> marker-derived X.** Visibility stays hover-scoped to the containing chain
> (353 points 1-2 unchanged); the hovered — lowest — node contributes exactly
> one handle, on its own row. So the gutter reads outward-in as a structural
> breadcrumb: the outer list beside the outer list's top row, the outer item
> beside its own line, the inner list beside ITS top row, one handle on the
> hovered node.

Five rules it earned:

- **The fix is a DELETION.** `descendTo` is retired from `resolveFirstLineTarget`
  and from both public entry points (`resolveContentEdges` /
  `resolveBlockFrame`), so there is one rule with no special case — rather than
  a distribution pass layered on top of the stacking, which would have left both
  descriptions live and let them drift. It is uniform over the whole container
  family by construction (the descent is `CONTAINER_KINDS`-keyed), not a list
  special case.
- **A container's first grabbable child IS its own first visual line.** A `<ul>`
  has no text line and an `.expex-block`'s only direct text is its `(n)` chip at
  `0.95em` — the wrong metrics to anchor chrome to — so the descent that 353
  inherited was always answering the right question; what 353 added was the
  hint that overrode it.
- **The same-row machinery survives for GENUINE coincidences.** A list's first
  row, or a container whose first child is a container, really is one line
  shared by two levels: 353's separation and 382's ink cap still govern exactly
  those. With the levels distributed vertically they shrink to ≤2 handles in
  practice, which is what makes both mechanisms sufficient — and why the item
  handle's X on row 1 legitimately differs from its resting X on rows 2-N.
- **Interaction gets STRONGER, not weaker, and the reason is structural.** The
  hover band already returns every containing level, and a container's own first
  row is inside that container — so travelling UP the gutter toward a
  container's handle keeps the pointer inside it and the handle alive at an
  unmoving position. Pre-394 that handle MOVED as the pointer travelled, which
  is what the travel leg measures.
- **Decided default, stated at the site:** a container whose first line has
  scrolled off-screen paints its handle off-screen with it — the chrome belongs
  to its structure, and there is no viewport pinning in v1.

CI: the renegotiated [grab-handle-hover-spec.test.tsx](src/text-objects/__tests__/grab-handle-hover-spec.test.tsx).
353's set-membership legs are untouched; its SAME-Y legs are renegotiated in
place with the reason at the site (the defect asserted as the contract, which is
this file's own rule about a guard that pins the wrong thing). The legs with
teeth drive the NESTED fixture, and its absence is why no pre-394 suite could
see this: **every grab-handle fixture in the repo is a FLAT list**, where a
container has exactly one containing level and "one handle per level on the
hovered row" is indistinguishable from "one handle" — the defect needs four
levels to be representable at all. Measured by neutering the fix back to the
hovered-row hint: 6 legs fail, and the X-order leg passes either way, which is
correct — X was never the defect and that leg is a non-regression pin.

**Owed, not claimed:** the preview eyeball on the screenshot's exact shape
(nested list, hover the last inner item → four handles at four distinct rows,
none touching a bullet). This class is NOT FSA-masked, so the check is cheap and
real.

###### The set half: both prior passes held the SET fixed and argued PLACEMENT

Same gutter, the third statement of one rule (task 425) — and the case where
two passes each corrected the other's geometry while carrying the same
unexamined premise. 353 said every containing level gets a handle, all on the
hovered row; 394 said every containing level gets a handle, each at its own
first line. Gabriel, on 394's own nested screenshot: FOUR handles on three rows
for a pointer on the deepest item is wrong. His rule, verbatim:

> If you are at the top row of a list of nested items, you get two handles —
> one for the item, one for the list. If you are not at the top row, you get
> one — for that item. And that's it. The same rule applies up and down the
> hierarchy.

So the hovered item ALWAYS gets its handle, and a container gets one ONLY when
the hovered line is that container's own top row. The visible set is ≤2 by
construction under the list schema — a `listItem`'s first child is a
paragraph, so no row is the top row of two nested lists at once — not by a
cap. And it is a SET change only: with the set fixed, 394's placement (each
level at its own first line) is already right, because under this rule a
container's first line IS the hovered row whenever its handle shows at all.

Four rules it earned:

- **"Top row" is STRUCTURAL, decided by the chain the placement already
  descends.** [`isTopRowOf`](src/text-objects/block-frame.ts) walks
  `GRABBABLE_CHILD_SELECTOR` down from the container — the literal descent
  `resolveFirstLineTarget` performs to PLACE a container's handle — and asks
  whether it arrives at the hovered item. So "is this the top row" and "where
  does the container's handle go" cannot disagree, the answer costs zero rect
  reads, and a WRAPPED first item hovered on its second visual line still
  shows both handles (the geometric reading is the tempting one and differs
  exactly there).
- **The decision is made at the SET, never by computing and discarding.**
  `restrictToTopRowSet` runs inside `resolveTextObjectsAtMouse` on the
  innermost-first chain: keep the item, walk outward, keep a level only while
  it still owns the top row, stop at the first that does not (an inner list's
  non-first item cannot be the top row of anything above it). `computePlacement`
  therefore runs ≤2 times per hover, and the leg that pins it spies the
  non-qualifying levels' first-line rects rather than counting handles — a
  surgical "place every level, keep the ones on the hovered row" paints the
  same pixels on the common case and fails that leg.
- **A non-container ancestor grants nothing.** An outer `listItem` above a
  nested list has no top row of its own to confer, so the walk stops there:
  that is what keeps liB off the inner list's top row in the nested fixture,
  and it is the rule rather than a list special case (the descent is
  `CONTAINER_KINDS`-keyed).
- **394's "travel up the gutter" property is given up deliberately**, stated
  at the renegotiated leg: hovering a deep row shows no list handle, and to
  grab the list you go to its top row. The same-row machinery (353's
  separation, 382's ink cap) now governs the ONE shape that produces two
  handles on a row, and the ink-clearance suite gains level-2 and level-3
  top-row cases with both handles present — measured, the band between the
  floor and the bullet widens by one marker band per level, so two handles
  fit at every depth with room to spare and no "item wins, list dropped" arm
  is needed in the lane resolver today.

CI: the renegotiated [grab-handle-hover-spec.test.tsx](src/text-objects/__tests__/grab-handle-hover-spec.test.tsx)
— 353's per-row set legs and 394's four-handle and travel legs renegotiated in
place with the reason at the site, the nested fixture swept per row, a wrapped
first-item fixture, and the rect-spy leg above — plus the nested legs in
[handle-marker-ink-clearance.test.tsx](src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx).
Measured by neutering the set restriction back to the 394 tree: 8 legs fail;
the 5 that pass are the controls (row 1, the outer top row, the wrapped row 1,
X consistency, the margin lane).

**Owed, not claimed:** the preview eyeball, REQUIRED here — the last two passes
each shipped green and looked wrong. Add a nested list to the dev doc, hover
each row in a real Chrome tab: two handles on a top row, one everywhere else,
none on a bullet.

###### The column half: a CONTAINER has no marker to hug, so it OCCUPIES one

Same gutter, the horizontal axis the last three passes each argued about and
none renegotiated (tasks 483 + 487) — and the case where a placement rule was
right for every block that HAS a marker and VACUOUS for the one kind that does
not.

`markerLeft − gapPx − HANDLE_WIDTH` is a hug: it puts a handle one uniform gap
left of the glyph it labels. A markerless CONTAINER renders no glyph on its own
row, so there was nothing to hug and the rule degraded to a STEP — an arbitrary
`--margin-track-width` off its first item's anchor. Measured live against `main`
on a top-level bullet list's top row (task 483, the audit that found it): the
LIST handle at x 514.5–526.5 and the ITEM handle at 522.25–534.25, a **4.25px
overlap**, with the list winning the z-order across the shared band — so the two
pills read as one ~20px blob and a press in the left of the ITEM's box grabbed
the LIST. With task 480 unfixed that mis-grabbed payload then extracted the item
out of its own list. And the geometry is not width-dependent: both positions are
column-relative constants for a top-level list, so it reproduced at every window
size, on the commonest list shape there is, while task 425's suite claimed "two
handles fit at every depth with room to spare" — true of ITS fixtures.

Gabriel ruled on it directly rather than accepting a separation bump: *"In
bullets, the outer grab handle should justify right under the the bullet point
above. this does require making the depth of the bullet indents slightly
deeper."*

> **A block with a marker of its own HUGS it. A markerless container OCCUPIES
> the marker column of the level ABOVE it — the column its structure hangs
> from, whose glyph sits a row up and which is therefore EMPTY on this row —
> right-justified to that column's inner edge.** Which of the two readings
> applies is decided ONCE, in `block-frame.ts` (`BlockFrame.columnRight`: a
> column, or `null` for "hug your own marker"), never at a call site.

Seven rules it earned:

- **Non-overlap stops being a target and becomes a PROPERTY.** Two levels sit
  in two different marker columns, so their handles are disjoint by
  construction. That is why the ruling beats the surgical answer (raise
  `MIN_SAME_ROW_GAP_PX`): a separation constant is a number someone has to keep
  larger than a width, where two columns cannot coincide.
- **…and it reads as a breadcrumb**, which is the affordance half of the same
  fact: travelling out through the gutter, each handle sits under the bullet of
  the level that owns it.
- **The ITEM anchor had to move WITH it, and that is the non-obvious half.**
  A list `<li>` anchored at the MIDDLE of its measured `padding-left` band — a
  stand-in for a rect the `::marker` pseudo does not give — and the stand-in's
  whole justification ("the glyph stays in the band's right half") is a fact
  about a 2em band, not about the marker. Deepen the band and the middle drifts
  steadily further LEFT of the bullet: the item's handle detaches from the very
  thing it labels and drifts toward the column the container now occupies. So
  where the marker string CAN be measured (`text-metrics.ts`, never a hardcoded
  glyph width) the measurement is the answer for the ANCHOR as well as the INK,
  and the band middle survives only as the fallback for builds that cannot
  measure. Anchor and ink being one number also retires the `min` that used to
  reconcile them.
- **The band is part of the geometry, so widening it is the ruling's price and
  is stated as an inequality rather than a taste.** `.tiptap ul/ol` goes 2em →
  2.5em, and the band must hold one row's worth of geometry whole —
  `band > markerInk + 0.25em trail + --margin-handle-gap + 12px`, the surplus
  being the seam. For a `•` at the shipped 15.2px prose font the right-hand side
  is ≈30.6px against a 2em band of 30.4px: **2em does not fit at all**, and the
  deficit IS the 4.25px overlap 483 measured. 2.5em leaves ~7px. Pinned as its
  own leg, so a future "tidy the indents" is a failing test rather than a
  regression.
- **The separation gets a SECOND pass, and its predecessor's stated reason for
  having only one was a fact about the retired anchor.** 353 pushed INNER
  handles inboard and explained itself: *"the outermost handle is already
  sitting ON the floor … there is no room further out."* True while a container
  stepped a track-width off its item's band middle and normally clamped at the
  floor; false under the ruling, where it sits in a column nowhere near the
  floor. So where the inboard push has run out of lane (an inner handle pinned
  against its own ink) and the pair is still closer than `HANDLE_WIDTH + 6`, the
  OUTER handle gives way into the margin instead, bounded by the lane's new
  `minLeft` (the floor). Nothing on a row lies left of that row's own marker, so
  that margin is free BY CONSTRUCTION — which is what turns the guarantee from a
  hope into an argument. Right-to-left, so a moved handle is re-checked against
  its own outer neighbour; the floor still outranks it, and the resulting
  overlap is the documented degraded state (unreachable under the shipped band
  and 425's two-handle cap).
- **Membership in "lends a column" is the STRONGER question, and `exampleItem`
  is the instructive non-member.** The test is not *does this kind have a
  marker* but *does the structure nested under it hang from that marker's
  column* — same column, empty on this row. A nested `<ul>` is a block child of
  its `<li>`, so it fills the item's content box and its own border-box left IS
  the x the parent's bullet band ends at. An expex item's marker is a GRID cell
  with a 0.8em gap and then a BODY column, so a structure inside it begins right
  of the marker, not under it; right-justifying there would land the handle in
  the gap between marker and text. It is unreachable besides — `exampleItem`'s
  content model admits no list (task 427) — and it is named in the code as a
  non-member precisely so the next reader does not "complete" the set.
- **A container with no column above it is not a special case, it is the OTHER
  reading.** A top-level list, or one inside a blockquote, has nothing to
  occupy, so it takes the ordinary markerless slot — its own content edge, the
  same slot every paragraph handle takes — and lines up with them in the gutter.

CI: the new legs in
[handle-marker-ink-clearance.test.tsx](src/text-objects/__tests__/handle-marker-ink-clearance.test.tsx)
state the contract in TWO tiers, because they have different guarantors. DISJOINT
(≥ `HANDLE_WIDTH` between left edges) is the GUARANTEE — and it is asserted as
PRESS TARGETING, not as a distance: each handle's centre and 2px inside each edge
of its box must resolve to exactly one owner, which is what 483 measured with
`elementsFromPoint` and what a bare distance assertion cannot see. FLUSH UNDER
THE BULLET ABOVE is the RULING, asserted as the one number that states it (the
container handle's RIGHT edge lands on the level-above's content edge), and it
holds wherever the row has room; a nested two-digit `12.` counter eats the room
and the outboard pass trades the alignment for the guarantee — asserted
separately, so a failure says which of the two gave way. Both are swept at two
font sizes and over `ul` and `ol`, since the band is em and the floor, gap-min
and handle width are px, which is exactly why the report reads as intermittent.
The retired rules are RENEGOTIATED in place with the reason at the site rather
than deleted — the band-middle anchor legs, the `min`-tightening leg, the
`markerLeft − trackWidth` container leg, the 2em band pin, and (in
`grab-handle-hover-spec`) "the container handle stays OUT of the margin lane",
whose bound was ALSO 40px too strict for a coincidental reason worth recording:
it read `style.left` (PORTAL space) against a VIEWPORT-space floor and passed by
exact equality on the pre-487 numbers.

Measured by neutering each half in turn: the column rule takes **5** legs (the
four FLUSH sweeps and the geometry leg), the measured item anchor **8**, the
outboard separation pass **1** (the nested `12.` case at 19px — its 28px twin is
a passing control, since the band scales with the font and the wide counter
still fits there), and reverting the band to 2em **1**. The pre-487
`grab-handle-hover-spec` margin-lane leg fails on the fixed tree for the
coordinate-space reason above, which is what forced its renegotiation.

**Owed, not claimed:** the preview eyeball, REQUIRED — three handle passes in a
row have now shipped green and looked wrong, and this one moves every list in
every document. Not FSA-masked. Nested list in the dev doc: hover each row and
compare against Gabriel's mock-up
(`virgil-tasks/attachments/2026-08-25-487-shot-1.png`) — each handle under its
own level's bullet, two visually distinct pills on a top row, none on a glyph.

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

**Residuals, stated.** The two renderers track together in practice but not *by construction*: they use different primitives (the marker's optical cap-band rect vs the card's `coordsAtPos` line-box), different origins, and different epsilons (the geometry service's 0.5 px bail vs the card's 6 px hysteresis hold), so a 2–5 px reflow can move one and hold the other. That is a sub-epsilon disagreement, not a decoupling, and it is what the contract's ε allows for. The SECOND, independent path to the same symptom this section used to name as an open residual — the omni builders' bare live-uuid gate — is CLOSED by task 369, below.

#### The resolution half: two DRAWINGS of one anchor read ONE resolution

Same lane, one question earlier (task 369) — and the sibling of the pin half above: there the card froze a derived *Y*, here the two renderers disagreed about whether the anchor RESOLVES AT ALL.

A paragraph-anchored card is drawn twice, by two surfaces with no shared owner. The **margin marker** (`EditorPane.marginaliaMarkers`) routed every card through the four-rung anchor-recovery SSOT `resolveCardAnchor` — live uuid → surviving `linkedAnchor` mark → RC1 self-heal → text-snapshot relocation. The **omni card** consulted no resolver at all: each of the six paragraph-anchored builders hand-ran `getLinkedTextObjectIds` + a bare `findParagraphPos(pid)` live-uuid walk, and archive additionally gated on `anchoredArchiveIds`, a `pids.some(live)` fold. **Seven copies of one rule, none of which could see rungs 2–4.**

So the two agreed ONLY on rung 1. For a card whose stored uuid has died but whose `paragraphSnapshot` still matches a live paragraph — the ordinary outcome of a `%!v:` anchor failing to round-trip through the `.tex`, and ARMED FOR EVERY ARCHIVE CLIP, since archive links are created with a snapshot — the margin painted an ordinary marker beside the RECOVERED paragraph while the omni row was binned `pos: null` into the orphan strip. Marker in the margin, card nowhere near it, no error, nothing logged.

> **Where one fact is drawn by two surfaces, it is RESOLVED once, by one authority, and both surfaces READ the resolution.** Neither may re-derive it — that is the fork. The published ROWS are the shared vocabulary: the margin emits one marker per row and the omni one card per row, so their `@N` keying agrees BY CONSTRUCTION rather than by two implementations of one rule staying in step.

[src/links/card-anchor-rows.ts](src/links/card-anchor-rows.ts) is the authority (`buildCardAnchorPass` → `resolve` + the margin's own two-line reader, `buildMarginMarkerRows` / `marginAnchorIndex`); [src/panels/_shared/omni-anchor-rows.ts](src/panels/_shared/omni-anchor-rows.ts) is the omni reader every builder now calls. Six rules it earned:

- **The ROWS are the vocabulary, not the pid.** A resolved card's rows are seeded with `res.paragraphId` — which may be a paragraph that is not among the card's stored pids at all — then every still-live stored pid, deduped and order-stable. Publishing only the resolver's single binding would drop P2..Pn of a healthy multi-anchor card; publishing only the stored pids is the pre-369 defect. This is also what closes `anchorIndexFor`'s recovered-pid gap for free: indexed over the ROWS, a marker click on a recovered paragraph pins the omni row it belongs to, where indexing the STORED pids returned `undefined` and pinned nothing.
- **The authority answers "does it resolve?", never "free or orphaned?"** That second split reads the card's declared intent, and what "a card with no links at all" MEANS differs per panel — an unlinked note is deliberately free by that panel's rule, an archive clip reads its own `unanchored` flag. So the free intent is a parameter of the omni reader and the authority is not entitled to decide it. A card whose stored anchor is DEAD never takes that path: it classifies from the card record, so a lost marker still reads `orphaned` (red) rather than being laundered into `free`.
- **The mount-gap fail-open is inherited, not re-derived.** Against a zero-uuid index every card resolves `orphan` and the re-pin dock flashes, so a not-ready index falls back to the raw stored pids with NO orphan verdict. That guard existed only on the margin side; hoisting it into the authority is what lets both surfaces inherit it. The two are still ALLOWED to differ exactly there — the omni row has no position to show and `OmniViewPanel` drops it while `editor` is null — and nowhere else.
- **It is a net keystroke REDUCTION, and the count is stated per HOST rather than per document, because that is what it is.** `findParagraphPos` was a full `descendants` walk PER PID, so the omni pass cost O(doc · anchors) per items rebuild; the authority builds ONE index and resolves each card in O(1) against it, memoized per card within the pass (a pass has several readers per card — the margin's rows and its click index, the omni row builder, the archive fold — and the ladder must not run once each). Each HOST memoizes its own pass on the DocStructureBus counters plus the reactive editor, and there are up to three per pane: `EditorPane`'s margin pass and one `OmniHost` pass per `PaneRail` (left and right). So a structural keystroke costs up to three index builds, where the pre-fix tree paid O(doc) per pid per items rebuild in two hosts. Plain typing rebuilds nothing. A shared per-editor pass (the `getBus` / `getGeometry` / `getDocProducts` precedent) would take it to one; it is not worth the lifecycle machinery at three call sites, and the honest number is recorded here rather than rounded down.
- **`uuidToPos` rides the walk `buildResolveIndex` already does — and paid for the walk it retired.** The index's own `descendants` pass visits every uuid-bearing node WITH its position, so the position map costs one `Map.set` per node. It also made `uuidToParagraph` derivable as that map's key set, retiring the separate `collectLiveUuids` pass the index used to run first: the index is ONE walk now where it was two. (`collectLiveUuids` was then dead in production and the task-202 link-surface census said so — "a suite is not a consumer" — so it is deleted; callers that want the set read `buildResolveIndex(editor).uuidToParagraph`.)
- **The margin's own pre-check went with them, and it was the LAST place the two could disagree.** Five of the six marker loops opened with `if (getLinkedTextObjectIds(card).length === 0) continue;` — a gate OUTSIDE the authority. A card whose stored pids are empty but whose snapshot (or surviving mark) still resolves is a shipped shape (task 107's Mode-B card with empty `textObjectIds`), and it got an anchored omni row and NO marker at all. The skip is the authority's now: a card with nothing to resolve returns zero rows and the loop emits nothing.
- **A third re-derivation went with them.** `anchoredArchiveIds` (the docked ArchivePanel + float badge) was the same bare gate a third time, so a recovered clip read "orphaned" in the docked panel too. It is now a fold over the authority.

CI: [card-anchor-two-renderers.test.tsx](src/links/__tests__/card-anchor-two-renderers.test.tsx) drives the REAL editor, the REAL authority and BOTH REAL readers — plus one real builder end to end — over the snapshot-recovered card, the genuinely dead card, and the Mode-B mark rung (the only shape where the resolved paragraph is not a stored pid AND live stored pids remain). **No pre-369 suite could see any of this**: each of them drives ONE surface, with the other's answer unrepresentable. Its defect legs reimplement the RETIRED bare-uuid rule locally rather than re-parameterising the live one; measured by neutering the authority to that rule, three fail.

The leg with teeth is the CENSUS ([card-anchor-authority-census.test.ts](src/links/__tests__/card-anchor-authority-census.test.ts)) — the authority was never the part that could misbehave, a call site that never asks it is, and `findParagraphPos(pid)` type-checks perfectly while answering the wrong question. Membership is DISCOVERED from the panels tree, so a new panel is covered by existing. Six legs, and three of them exist because the obvious three were a census of the LAST defect rather than of the question:

- no `omni.tsx` may declare a private position lookup, or read a card's raw stored pids — **and** (the leg that generalizes) may not spell the anchor VOCABULARY at all: no `textObjectIds`, no `.links`, no `state.doc`, no `descendants(`. Grepping only the two names the pre-369 builders happened to use leaves the realistic re-fork route — read `card.links[0].anchor.textObjectIds[0]`, walk the doc yourself — passing every leg.
- the one exemption (the Errors builder, whose paragraph id comes from the diagnostics pass, not from a card's links, so it has no ladder to run and no second renderer to agree with) must still cover a REAL offender. Asserting the exempted FILE exists is satisfied by every panel folder; an exemption that has stopped excusing anything is a standing licence for the next private lookup under the exempted name.
- the omni readers are an EXACT SET (every builder that TAKES the authority READS it, and vice versa), not a count floor — a floor lets a 7th adopter mask a builder that regressed, which is the per-file-vs-per-handle failure the pane-drag census records, one level up.
- both hosts must build the pass, the margin must read it through the shared reader, **and the `anchoredArchiveIds` fold must too**. That fold badges the docked panel and its float, it lives inline in `EditorPane`, and no suite mounts it — so without its own leg the commit's claim to have retired the third copy was pinned by nothing.
- nothing outside the authority and the load-time `useReconcileModeAAnchors` MUTATOR may call the recovery ladder at all. Stated limit: that leg greps the two symbol names and walks `src/` only, so an aliased import would evade it.

Measured on the pre-369 tree, the legs name six builders twice, `EditorPane`, both hosts, and the archive fold.

Same pass deleted `getParagraphAnchorPositions` — an EXPORTED helper resolving `pids[0]` with zero production callers, stating a different rule from the live one (`jumpToCard` uses "first RESOLVABLE link"): the task-202 dead-SSOT shape, WIRE-it-or-DELETE-it.

**Residual, stated rather than implied.** `OmniAnchorRow` publishes both `anchored` (the authority's verdict + a resolved position) and `anchorUuid` (the card stores an anchor), and only Archive gates its Jump on the first — the other five builders gate on the second, which is each panel's own pre-369 rule, kept byte-for-byte. They differ for a card whose anchor is UNRECOVERABLE: those five still render a Jump that `jumpToCard` cannot resolve, which is the false-affordance class ("what the hover OFFERS is what the commit ACCEPTS") in a surface this task did not set out to renegotiate. Unifying it is a visible product change in five panels, so it is recorded here and at the field rather than made silently under a refactor.

**Verification, honestly:** this class is FSA-masked (anchor recovery only reproduces under real prod File System Access — the dev preview's uuids round-trip), so the durable proof is the unit contract above and a real-FSA eyeball is *owed*, not claimed.

##### The chrome half: a float is the THIRD renderer, and it never states an answer its own body is about to contradict

Same law, the POPPED-OUT surface (task 435) — and the case where the resolution
was correct, three of a kind's four renderers read it, and the fourth stated
`true`.

`FloatChrome` paints the jump chevron on exactly ONE input (`Floatable.canJump`),
so a float's `canJump` **is** the affordance. Task 136 derived it for `citation`
(`pos !== null`) and task 277 for `footnote` (the anchored/unanchored fork); the
same family's other two members were never swept, and they are the two where the
contradiction is visible on screen:

- **`archive`** — the builder computed `orphaned` from `ctx.anchoredIds` (a fold
  over the task-369 authority, `anchorPass.resolve(s).anchored`) two lines above,
  used it for the BODY, and handed `canJump` a literal. `orphaned === true` means
  the four-rung ladder found nothing, which strictly implies `resolveLink` finds
  nothing, so `jumpToCard` iterates the links, resolves none, and returns `false`
  having done nothing. Archive's other three renderers all gate correctly — the
  docked card on `!orphaned`, the omni card on `row.anchorState`, the margin
  marker on the authority itself — so the float was the ONE surface out of step.
  (This is not the residual "The resolution half" records: that names the five
  builders gating on `anchorUuid` and explicitly EXEMPTS Archive.)
- **`textobject`** — a text-object float OUTLIVES its source, the body already
  detects that (`useFloatMainSync` → `sourceMissing`) and already announces it
  ("Source paragraph deleted — float is disconnected"), and the chrome above the
  banner kept a live chevron whose handler called `scrollToParagraphId` on a uuid
  the document no longer has. One 24px strip contradicting itself.

> **A float is the THIRD renderer of a card's anchor question: it READS the same
> resolution the docked card and the margin marker read, and it never asserts one
> statically when the body it wraps is about to contradict it.** Where the fact is
> resolved per FloatHost render it is read in the builder; where it can change on
> a transaction that never re-renders FloatHost, it travels UP from the body that
> observes it.

Six rules it earned:

- **Gate the AFFORDANCE and the HANDLER** (136's own rule), so a keyboard or
  programmatic path cannot reach the dead call.
- **`anchoredIds` is REQUIRED on the deps bag**, not `anchoredIds?:` — the
  reason `unanchoredFootnotes` states one field up ("a bag that can omit it would
  silently reinstate the blank-float case for every host that forgets"). The
  optional form is precisely what made `orphaned` silently `undefined`.
- **The channel carries the FACT, never the AFFORDANCE.**
  [float-source-report.tsx](src/floats/float-source-report.tsx) reports *the
  source is missing*; `FloatWindow` derives `canJump && !sourceMissing` from it.
  A `setCanJump` channel would be the body RESTATING the chrome's decision, and
  the next chrome element depending on the same fact would need a second channel.
- **The BANNER is the reporter.** `SourceMissingBanner` — mounted iff the user is
  being told the source is gone — declares the fact for its lifetime, rather than
  a setter threaded through `FloatBodyContext` → `TextObjectFloatBodyProps` →
  each of the TEN float bodies. Threading is a per-body obligation, i.e. ten
  chances to forget and a new body that inherits nothing; binding the report to
  the banner's mount makes the agreement STRUCTURAL — you cannot paint the banner
  without withdrawing the chevron, and a body that detects a missing source and
  tells the user nothing reports nothing, which is correct, because the user is
  not being told either.
- **Keystroke sanctity is untouched**: the effect runs on the banner's MOUNT and
  UNMOUNT — the present↔missing EDGE — never per transaction.
- **The static half survives.** `Floatable.canJump` still means *what this KIND
  can ever offer*; the live half is the body's report, and the WINDOW combines
  them. A kind that offers no jump stays jump-less however its body reports.

CI: [float-jump-agreement.test.tsx](src/floats/__tests__/float-jump-agreement.test.tsx)
builds the REAL archive `Floatable` through `CARD_REGISTRY` and drives the REAL
`FloatWindow` over a body running the REAL `useFloatMainSync` against a REAL main
editor whose paragraph is then deleted — the contract being that the header and
the banner AGREE, not that either is right alone. **No pre-435 suite could see
any of this**: every float suite drives the CHROME with a hand-supplied
`canJump`, so a builder's literal disagreeing with its own body is
unrepresentable in all of them. The leg with teeth is the CENSUS — the builders
were never the part that could misbehave, one that resolves an anchor answer and
then hands `canJump` a literal is, and that type-checks perfectly. Regions are
discovered per `registerCardFloatable("<kind>"` (allowlist EMPTY), and the split
being per-BUILDER is itself pinned: a `cardFloatable(`-keyed split puts the
archive registration inside the FOOTNOTE builder's region, which — measured —
made the archive leg pass under its own neuter. Measured by neutering each half
in turn: the archive gate takes 3 legs, the window's derivation 2, the banner's
report 2.

**Owed, not claimed:** a preview eyeball. The archive half is FSA-masked (real
anchor death reproduces under prod File System Access), so the durable proof
there is the unit contract; the text-object half is NOT masked — pop a paragraph
out, delete it in the main editor, and look at the float's header.

###### The preview half: a preview shows what the RELEASE produces

Same header, one moment earlier (task 437) — and the case where the two
renderers were declared to be one component, in four files, by prose alone.

Dragging a text object out of the document shows a **lift ghost**; past the
popout threshold it grows a header bar, and on release that ghost becomes a
real float. Those two headers are the same thing or the handoff moves. They
had not been for months: `FloatChrome` gained a 14px `FloatGrip` as its FIRST
child and a (re)anchor **drop** button (which `textObjectFloatable` sets
`canDrop: true` for unconditionally, so it is on EVERY text-object float), and
the ghost's own `FloatHeaderContent` gained neither. The arithmetic, from the
shipped utilities (`px-2`=8, `gap-1`=4, grip `p-0.5` around a `width=10` svg,
`-ml-1`=−4): ghost label at `+9`, float label at `+23` — **a ~14px jump on
release**, plus one `w-4` button and one gap of extra width on the right.

> **A preview shows what the release produces, so the two render the SAME
> children — ONE component.** Where the CONTAINERS genuinely differ (they are
> positioned by different owners), a census states what may not: the leading
> inset, the gap and the height, because that inset is where the label lands.

Six rules it earned:

- **The fork was in the CHILD ROW, not the container**, so that is what became
  one thing: `FloatChromeContent` (the grip · title · spacer · trailing · jump
  · drop · close row) is exported from `FloatChrome` and mounted by exactly two
  places — `FloatChrome` itself (the release) and `LiftedTextOverlay` (the
  preview). `FloatHeaderContent` is DELETED, which is the honest end state for
  a component whose stated purpose was to be shared with a file that no longer
  exists. Adding the grip and the drop glyph to it instead was the alternative
  and was declined: it re-creates the shared fork one level up.
- **`inert` is a SUBTREE claim, and that is why the per-button one was not
  enough.** The preview's close button is a `PopoutButton`, whose API has no
  `tabIndex` seam — so under `pointer-events: none` + `aria-hidden` it was a
  focusable control inside a hidden subtree, the shape "Pane-drag stability"
  already outlaws for divider chrome. The ghost's container carries the HTML
  `inert` attribute; the content attaches no handler at all.
- **The prop type is a DISCRIMINATED UNION** (`{ inert: true }` forbids the
  handlers; the live arm requires them), so a preview cannot be handed a
  handler and a live mount cannot forget one. A defaulted no-op would be a
  decision nobody made.
- **The container inset is spelled twice and PINNED as a mirror.**
  `FLOAT_CHROME_CONTAINER_CLASS` (`px-2 gap-1 h-6`) and globals.css
  `.lifted-text-overlay__header` (`padding: 0 8px; gap: 4px`, height
  `CARD_FLOAT_HEADER_H`) — CSS can't import TS, so the census reads BOTH
  spellings. A drift between them IS a label jump.
- **The four false SSOT claims are renegotiated in place with the reason at the
  site**, never quietly deleted: they pinned a defect as the contract, and the
  1px correction the overlay's Issue-6 comment records was REAL — what it could
  not survive was a 14px element being inserted in front of the label it
  described. Both halves are load-bearing now and both are pinned.
- **The same sweep closed eight more stale claims** naming the deleted
  `TextObjectFloat` as a live chrome (four in `globals.css`, four per-kind body
  docstrings plus `types.ts`, `floats/index.ts`, `text-object-registry.ts`) —
  the "Bar occupancy" shape, and the reason a census is a phrase-vocabulary
  rather than a name grep: a note saying a claim USED to hold is wanted; a live
  claim is not.

CI: [lift-ghost-header-parity.test.tsx](src/text-objects/__tests__/lift-ghost-header-parity.test.tsx)
renders the REAL ghost header and the REAL `FloatChrome` for the same
text-object float and compares a signature derived from what the user can
PERCEIVE (the `aria-label`s `iconHint` stamps, plus the one decorative child
that publishes none) — never a test-only `data-*` marker, which would be a
signature only the test can see. **No pre-437 suite could see any of this**:
both suites that render the overlay `vi.mock`ed the header content to
`() => null` for module weight, so the one thing that would have failed was the
one thing both stubbed out — they render it for real now. Measured by neutering
each half in turn: the pre-437 child row takes 4 legs, the `inert` attribute 1,
a re-forked private row 1 (the census), and a live `TextObjectFloat` claim 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live pointer
gesture, no disk), so the check is cheap and real — lift a paragraph out slowly
and watch the header label at the moment of release.


###### The archived half: the fact was `archived`, and the omni was the renderer that never read it

Same law, a different FACT (task 476) — and the case where the SSOT's own doc
comment named the surface that never received it.

An archived card lives only under its home panel's View Archives/All, and that
fact has three renderers in one window. Two read `EditorPane.archivedIds` (the
docked list through `getArchived`, the margin markers and the task-410
unanchored chip through the set itself). The OMNI never received it: the rule
was re-derived twice and incompletely — a local `active()` helper in
`omni-host` applied to six of the ten families, a private
`if (ref.archived) continue;` inside the footnote builder, and **citations
covered by NEITHER**. So archiving a citation spliced its `\cite` out of the
`.tex`, hid it from the panel and the margin, and left it rendering in the omni
"N unplaced" bin FOREVER, with the chip beside it counting zero for the same
card and the count growing with every citation the user ever archived. The set's
own comment had always said it drives "the in-document exclusion (margin
markers, highlights) **+ OmniView**".

> **A per-item rule with N producers is applied to the ASSEMBLED array, once, at
> the ONE place the items become a list — never as a per-producer obligation.**
> A producer can skip an obligation by OMISSION and nothing anywhere notices; a
> filter over the assembled array covers the eleventh producer by existing.

[src/panels/Omni/omni-archived.ts](src/panels/Omni/omni-archived.ts) is the rule
(`filterArchivedOmniItems` / `omniItemIsArchived` / `omniItemCardRef`), read
once in `omni-host`'s `items` memo. Five rules it earned:

- **The vocabulary is the ID the builders already publish.** Every
  `OmniItem.id` is `cardPopKey(kind, id)` (`float:card:<kind>:<id>`), optionally
  `@N`-suffixed for a multi-anchor row, so the filter parses `(kind, id)` back
  out through `parseFloatKey` — colon-safe, since a card id can carry interior
  colons — and needs no new field and no per-builder change. The alternative (a
  REQUIRED `cardId` on `OmniItem`, a compile error for a builder that forgets)
  is this repo's usual shape and was declined here for a stated reason: it makes
  the rule a per-builder obligation again, which is the class being closed.
- **Reading the SAME set is what makes the surfaces agree BY CONSTRUCTION.**
  `archivedIds` is kind-blind (raw card ids across every panel — exactly what the
  margin tests `m.entityId` against), so the omni asks the identical question
  rather than a parallel one that has to stay in step. The `isArchivable(kind)`
  gate adds no discrimination against that set; it is a cheap statement of SCOPE,
  so a non-archivable kind (`example`, `error`) whose entity id somehow collided
  could never be dropped by this rule.
- **The prop is REQUIRED on `OmniHostProps`**, not optional — the reason
  `unanchoredFootnotes` states one field up: a bag that can omit it silently
  reinstates the defect for every host that forgets.
- **Retiring `active()` costs O(archived) cheap object allocations per items
  rebuild, and that is stated rather than rounded away.** Archived cards now
  reach the builders and are dropped after; `resolveCardRows` is an O(1) map
  lookup and `content` is a `createElement` (never a mount), and the memo
  rebuilds only when a sidecar collection or a selection id changes — off the
  keystroke path. The structural guarantee is worth the allocations; keeping the
  pre-filter as an "optimisation" would be the two-implementations shape again.
- **Identity-stable when nothing is archived** (the common case), so downstream
  memos stay cached.

CI: [omni-archived-rule.test.ts](src/panels/Omni/__tests__/omni-archived-rule.test.ts)
sweeps every kind `isArchivable` declares (single-anchor AND `@N` rows, each with
its accepting control), drives the REAL citation / footnote / note builders, and
pins the two non-regressions (an ACTIVE unanchored citation still surfaces —
task 056/079; archived-then-UNarchived returns). The leg with teeth is the
CENSUS: the rule was never the part that could misbehave, an eleventh builder
re-deriving its own `archived` gate is, and a host that assembles items and never
asks is — so no `omni.tsx` may spell `archived` at all, the builder population is
DISCOVERED from the host's own import list, and the host must call the door
exactly ONCE against `p.archivedIds`. The task-077 leg in
`anchor-state-classify-contract.test.ts` is RENEGOTIATED in place with the reason
at the site: it asserted the BUILDER dropped the archived ref, which pinned the
per-builder derivation as the contract. Measured by neutering each half in turn:
a pass-through filter takes 28 legs, a re-forked footnote gate 3, a host that
stops asking 1, and a restored `active()` helper 1.

**Owed, not claimed:** the preview eyeball. The derivation is pure and NOT
FSA-masked, but the visible symptom needs a real doc — archive a citation and
watch the "N unplaced" pill and the unanchored chip agree.

**Related, checked and deliberately NOT folded in.** `citedKeys`
([BibliographyPanel.tsx](src/panels/Bibliography/BibliographyPanel.tsx)) iterates
ALL citations including archived, so an archived citation still marks its bib
entry "cited", survives the *Cited entries only* filter and lands in the exported
`cited.bib`. Real, same root — but whether "cited" means *has a live `\cite` in
the `.tex`* or *is referenced by a citation card* is a product call, and an
over-inclusive `cited.bib` is harmless to LaTeX.

###### The chrome half: the SSOT's own comment named the surface that never read it

Same fact, the renderer 476 could not reach (task 497) — and the case where the
authority's doc comment listed a consumer that had never been written.

Gabriel, from a real paper: *"When a note is associated highlighting, and the
note is archived, the highlighting should disappear. (the highlighting should be
structurally linked to the presence of the note)"*. `EditorPane.archivedIds` had
five consumers — margin markers, the re-pin chip, the omni filter (476), the
archive glyph and the jump re-check — and **none of them was the in-document
Mode-B span layer**, though the set's own comment claimed it drove "the
in-document exclusion (margin markers, **highlights**)". 476's class, one word
over.

A note's `linkedAnchor` mark renders through three UNCONDITIONAL CSS paths keyed
on statically-rendered attributes, so archiving — correctly a pure sidecar flag
toggle, with the mark deliberately kept alive as the anchor a restore needs —
removed nothing from the prose: the per-kind 18% wash (gated only on the GLOBAL
highlight prefs), the `!important` tint band (gated on **nothing at all**, and an
archived *highlight* card's entire in-text identity, since `highlight` has
`markerType: null`), and the hover / selection washes an archived card still
painted when touched from the Archives view.

> **The mark's persistence is right; the CHROME's persistence is the bug.** An
> archived card draws no anchor chrome — marker, band, rail, omni row, hover or
> selection wash — and the rule is stated ONCE in
> [archived-anchor-chrome.ts](src/links/_shared/archived-anchor-chrome.ts) as
> TWO PROJECTIONS of one predicate over ONE collection list, because the surfaces
> are keyed differently: `archivedCardIds` for everything keyed by card id, and
> `archivedAnchorIds` for the DOM-keyed span sweep.

Six rules it earned:

- **The two keys are not interchangeable, and that is the whole reason the
  authority publishes both.** On reload `applyLinkedAnchors` deliberately
  re-stamps with an EMPTY `linkCard`, so a restored span reads
  `data-link-card="note:"` — kind token present, **card id absent**. A sweep
  keyed on the card id parsed back out of the DOM works in-session and silently
  dies after every reload; `data-link-id` (the anchorId) is the stable key, so
  the archived CARD set is PROJECTED into an archived ANCHOR set rather than
  recovered from the span.
- **Hiding is an ATTRIBUTE, never an `unsetMark`** ("Transient state is never
  document content"). One `data-anchor-archived` stamp and one CSS rule; the
  document is byte-identical in both directions, pinned as its own leg.
- **`background: none !important` is REQUIRED, and so is the rule's POSITION.**
  The tint band carries an `!important` of its own and paints from `--tint-color`
  rather than `--link-anchor-color`, so nothing but a later `!important` at equal
  specificity turns it off — which makes "after every other `.linked-anchor`
  background rule" a load-bearing fact about the file, censused rather than
  assumed.
- **The in-editor gate sits in `collectTargets` and deliberately NOT in
  `collectCardKey`** — the reconciler collects the two separately precisely so an
  archived card can stop painting into the DOCUMENT while its own row in the
  Archives list still highlights. That is what closes M5 rather than leaving it a
  stated follow-up.
- **Both props are REQUIRED**, for `panelSides`' reason: an optional prop with an
  empty-set default lets a future refactor drop the one line that passes it and
  silently restore the pre-497 behaviour, with no type error and no test failure.
- **The sweep re-runs on the DocStructureBus, and the two redraw shapes were
  MEASURED rather than reasoned about.** A structure-PRESERVING `setContent`
  leaves the span element in place (PM matches and reuses the `MarkViewDesc`), so
  the stamp rides through unaided and the bus correctly stays silent; a
  structure-CHANGING one builds fresh DOM, and that is exactly what
  `onAnyChange` reports. The channel is `emitCount`-gated, so typing fires it
  zero times. Residual, stated: a MARK-ATTRS re-stamp recreates the span without
  waking the bus — but every such re-stamp is driven by a card record change,
  which mints a fresh set upstream and re-fires the effect through its own deps.

CI: [archived-anchor-chrome.test.tsx](src/links/_shared/__tests__/archived-anchor-chrome.test.tsx)
drives the REAL `useLinkHighlight` and the REAL `useAnchorHighlightReconciler`
against a REAL main-stack editor whose paragraph carries TWO `linkedAnchor` marks
— one archived, one active — because a leg with a single span passes on an
implementation that turns EVERY span off. Its fixture stamps `linkCard: "note:"`,
which IS the post-reload shape, so a card-id-keyed fix cannot pass. **No pre-497
suite could see any of this**: `useLinkHighlight` had NO suite at all and
`data-show-hl-` was asserted nowhere, so the whole sweep it owns was unpinned;
and every reconciler fixture in the repo is UNARCHIVED, so a card whose chrome
must not paint is unrepresentable in all of them. The leg with teeth is the
CENSUS — the authority was never the part that could misbehave, a surface that
draws anchor chrome without asking it is, and `archivedIds.has(...)` re-derived
in EditorLayout would type-check perfectly. Measured by neutering each half in
turn: the pre-497 absent sweep takes 4 legs, the reconciler gate 2, the bus
re-stamp 1, the CSS rule's position 1, and a layout that re-derives instead of
reading `PaneState` 1.

**Owed, not claimed:** a real-FSA eyeball. Mode-B anchors and sidecars are the
FSA-masked class, so the durable proof here is the unit contract — archive a note
with a highlight, watch the wash vanish; unarchive, watch it return; reload and
re-check both.


#### The height half: a retained measurement is invalidated by the EVENT that changes it

Same lane, the OTHER number the cascade consumes (task 490) — and the case
where a cache's justification was written down, was true of ONE of its inputs,
and was read as a licence to have no invalidation at all.

Gabriel, from a real paper, in two reports nine minutes apart: *"This archive
card should be lined up with its margin item"* and *"archive cards are
displacing to the same extent as they would be when open."* The second is the
mechanism, and it is arithmetically exact.

**The height half.** `realHeightRef` retains a card's last real height across the
±`NEAR_ZONE_PX` viewport gate (task 043), justified by *"a card's rendered height
is scroll-invariant, so a height read once stays truthful after the card scrolls
out."* That is true of SCROLL and false of everything else a card does: it
COLLAPSES, EXPANDS, swaps presence tier, or finishes laying out a late font /
KaTeX span / image. Its only writer was the measure pass's own
`getBoundingClientRect`, and that read is gated TWICE — the pos-band route
(`deferredItems`) and the `inViewport` px gate — **both asked of the ANCHOR**,
never of the card, while the cascade is precisely the mechanism that makes those
two differ. So a card that shrank while its anchor was out of band kept its
OLD, TALLER height and `resolveCascade` went on reserving it. The hole is
SYMMETRIC: a card that GREW out of band keeps a too-SMALL height and the next
card packs on top of it — the task-043 overlap this cache exists to prevent,
arriving from the other side.

**The pin half.** `holdOmniCard` fires on EVERY non-control mousedown on an omni
card, SKIPS the necessity rule its sibling door asks (`if (desired !== "hold")`),
and stores `cascadedTop − naturalTop` — the displacement the CROWD gave the card
at press time. Nothing ever clears a pin (`omni-pin-store`: "Nothing else clears
one"). So the moment the crowd changes — the card above collapses, its stale
height heals, a passage is archived away — the deck's own answer moves and the
pinned card does not: it stays displaced by an amount the deck no longer
requires. Pressed while the deck was full of EXPANDED cards, it is thereafter
"displacing to the same extent as it would be when open", permanently.

> **A retained measurement is invalidated by the EVENT that changes it, never by
> a proxy for the card's visibility — so the per-card ResizeObserver is the
> height AUTHORITY, not merely a trigger. And a HOLD is a freeze through a
> transient: where there is no transient there is nothing to freeze, and it
> writes NOTHING.**

Six rules they earned:

- **The observer already knows.** It fires on every height change, for every
  rendered card, wherever it sits, and its entry carries the new size
  POST-layout — so recording it forces no layout and needs no gate. The
  near-zone gate exists to skip a FORCED read; there is no forced read here.
  `noteObservedHeights` is therefore a REDUCTION in work, not an addition: the
  pass's rect read stays only as the SEED for a card the observer has not
  delivered yet.
- **BOOKKEEPING FIRST, ALWAYS.** The RO records before it calls `requestSettle`,
  because every gate below that door (hidden pane, the re-show suppression
  window, typing in a card body, the degeneracy guard, the convergence budget)
  can make the pass commit nothing — and none of them is a reason to forget what
  the observer just SAW. The geometry service's own rule, one lane over
  ("The scroll half": *defer the MEASUREMENT, never the BOOKKEEPING*).
- **A ZERO is not a measurement.** A `display:none` keep-alive pane reports 0×0
  for everything and an unpainted wrapper reports 0; writing either packs the
  whole deck contiguously from the top, which is the shape `measure()`'s own
  hidden bail exists to prevent. Skipping keeps the last good value — which IS
  the retain-across-a-hide contract.
- **BORDER box, to match the seed.** The pass writes
  `getBoundingClientRect().height`; `contentRect` is the CONTENT box. They
  coincide for the wrapper the omni renders — but two writers of one cache must
  not speak two boxes, so `borderBoxSize` is preferred with `contentRect` as the
  fallback.
- **A hold on a pin-free side writes NOTHING**, and that is provable rather than
  cautious: `resolveCascade`'s forward pass sets row *i*'s top from its
  PREDECESSORS alone, so a card's top is independent of its own height, and the
  backward (up-pulling) pass — the only thing that can make it depend on it —
  runs ONLY when a pin exists and is the IDENTITY unless the pin moved its card
  above the forward answer.
- **A hold never stores an offset ABOVE the anchor.** A hold's whole content is
  "the deck put me here", and the deck's own rule never puts a card above its
  anchor; a negative offset is another card's pin showing through, and freezing
  it makes this card permanently contradict its own margin marker — task 362's
  decoupling arriving through the offset instead of through the coordinate.

CI: [useInTextPositions-height-authority.test.tsx](src/hooks/__tests__/useInTextPositions-height-authority.test.tsx)
drives the REAL hook with a DELIVERING ResizeObserver over a card whose anchor
is scrolled INTO the band (the only way the pre-490 code could seed the cache)
and then away. **No pre-490 suite could see any of this**:
`useInTextPositions-retained-height` is pure and pins only the SHRINK-PROTECTION
direction ("never re-collapse to the 60px placeholder"), where a card that got
SHORTER out of band is unrepresentable; and **no suite in the repo ever
DELIVERED a per-card ResizeObserver entry** — `settle-convergence` installs a
deliberate NO-OP stub — so the one trigger a collapse actually has was untested
end to end. The door legs live in
[gutter-stability-doors.test.ts](src/components/editor-layout/__tests__/gutter-stability-doors.test.ts),
whose pre-490 freeze leg (an EMPTY store, asserting a hold always writes) is
RENEGOTIATED in place with the reason at the site, as is its twin in
`omni-pin-anchor-lifecycle`. Measured by neutering each half in turn: the pre-490
one-writer cache takes 2 legs, the zero guard 1, the pin-free hold rule 1, and
the above-the-anchor refusal 1.

**Owed, not claimed:** the real-paper eyeball. Both halves are FSA-masked for
Gabriel's own document (archive anchors and a card-dense deck), so the durable
proof here is the unit contract — collapse an archive card whose anchor has
scrolled well off screen, then scroll back and watch the deck below it close up.

**Residual, stated.** A card whose `entry` selector is a FUNCTION rather than an
attribute name cannot be inverted from an observed element, so it keeps the
pre-490 behaviour; the only production caller passes the string form. And the
hold's pin-free rule is deliberately CONSERVATIVE — the backward pass can only
reach cards ABOVE the pinned one, so a press on a card BELOW it is also a no-op,
and asking that would mean resolving the pinned card's wrapper at gesture time.

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

### The DOM half: a per-PANE MARKER is resolved the same way

Same law, other medium (task 438) — and the case where the ladder existed, was
correct, was cited BY NAME in the comment above the very gate that half-closed
this, and reached none of the four sites that resolve a per-pane marker in the
DOM.

A mounted pane stamps five per-PANE markers — `[data-strip-side]` on the tool
strip, and `[data-panel-column-side]` + `[data-flex-col]` (the same element),
`[data-stack-frame]` and one `[data-dock-slot="<side>-<index>"]` band anchor per
docked band from `PanelColumn`. None of those selectors carries a pane
discriminator: `left-0` exists once per mounted pane with a left band. Seven
call sites resolved them with a **document-global**
`querySelector`/`querySelectorAll` and took the FIRST match. `PanelColumn` is
not gated on `useIsVisible()`, so a hidden pane renders its column, its frame
and its anchors with every rect zero.

**Why "first in DOM order" looked safe, and where it stopped being safe.**
`useKeepAliveLRU` promotes the ACTIVE doc to the FRONT of the keep-alive order,
so among the three authored panes the first match really was the pane the user
was looking at — which is exactly why this survived. The Library Reader's pane
is not in that list: `EditorLayout` renders the doc keep-alive block BEFORE the
paper/library block, so **whenever the user is on the Library pane every doc
pane is hidden, still mounted, and still first**. The hazard is therefore
Reader-shaped today and general tomorrow, and the fix is a behaviour TRADE
rather than a strict improvement — see the visible-edge rule below.

> **A per-PANE DOM marker is resolved through ONE door
> ([pane-dom.ts](src/components/editor-layout/pane-dom.ts)) reading the rung the
> editor ladder already names — a hidden pane is exactly what
> `offsetParent === null` / `offsetHeight === 0` reports, and nothing else in a
> mounted tree does.**

Four members, and the first two are the ones the user meets:

- **M1 — the Reader's docked panel renders into a HIDDEN subtree.**
  `FloatingPanel` resolved `left-0` to the hidden doc pane's anchor and portaled
  its whole pod into a `display:none` subtree. The panel is "open" in prefs, the
  strip icon lights `aria-pressed`, and nothing appears anywhere. The hidden
  pane's own `FloatingPanel` had already returned null under the `isVisible`
  gate — which is *why* the anchor was present and free, and why that gate does
  not save it: it closes the half where a hidden pane is the PRODUCER, and this
  is the half where it is the first consumable ANCHOR.
- **M2 — the Reader can never stack two docked bands.** `measureOmniGap(side)`
  read a zero-rect hidden column, so BOTH its branches returned 0;
  `placeInStack`'s `fits = freeSpacePx >= MIN_BAND_PX` was then false for every
  Reader strip-open and the second panel opened evicted the first, forever, with
  no room problem at all.
- **M3 — the dock hit-test snaps to a zero-rect hidden column.** A hidden column
  reports `left = right = 0`, so its snap corner `(0, TOP_BAR + podGap)` sits
  nearer the viewport's top-left than any real column's and wins
  `resolveDockTargetByPanelProximity` outright; `resolveBandTargetIn` then reads
  its all-zero band rects and answers `index = bands.length` with a zero-size
  outline. Same shape task 272 recorded for the 0px COLLAPSED column, one cause
  over — that one was fixed by clearing the collapse sentinel, which does
  nothing for a hidden pane.
- **M4 (mild, fails open) — `computeColumnSpawnRect` drops to its hard-coded
  fallback** because a zero rect misses its `width > 0 && height > 0` guard.
  Listed because it is the same sweep and it moves with the others, or it
  becomes the next reader's "the pattern is fine here".
- **M5 — a divider drag PERSISTS a hidden pane's zero width into the user's
  prefs.** `syncPanelPrefsToRendered` sweeps `[data-flex-col]` (the SAME element
  as M2/M3/M4's, under a different attribute name) on every panel/margin
  drag-start and writes each column's rendered width to `panelWidths[side]` /
  the zen margins. It iterates in keep-alive LRU order and the LAST write per
  side wins, so a warm hidden pane could write `0`. Found by the adversarial
  pass on the fix — and it is the strongest argument that a census keyed on
  attribute NAMES has to enumerate every name a pane stamps, because this call
  sat thirty lines from converted code, on the same DOM node, under a comment
  asserting the exact premise the task retires (*"`[data-flex-col]` is a unique
  attribute on the active EditorPane's panel columns"*).
- **M6 — the strip-icon drag hit-tests a hidden pane's strip.**
  `[data-strip-side]` is stamped once per `EditorPane` and read find-first
  twice: to POSITION the drop indicator, and to compute the drop INDEX from
  that strip's own `[data-panel-id]` buttons. A hidden strip gives an indicator
  at the viewport origin and an index counted off the wrong pane's icons — the
  hover and the commit answering from different tables, which is the law
  "Pane-drag stability" already states one subsystem over.

Five rules it earned:

- **The two miss policies are DIFFERENT CLAIMS, so the argument is REQUIRED.** A
  MEASUREMENT reader (`measureOmniGap`, `computeColumnSpawnRect`,
  `findRowScroll`) fails OPEN — measuring the wrong column is the pre-438 status
  quo, while `null` turns a working feature off. A PORTAL TARGET
  (`FloatingPanel`'s anchor) fails CLOSED — an invisible anchor is strictly
  worse than the body fallback the caller already has. A defaulted policy would
  be a decision nobody made.
- **The set form fails open as a SET.** `paneColumns()` filters to visible and,
  if that leaves nothing, hands back everything — so a sweep can never turn a
  gesture off.
- **The second spelling was retired with it.** `findRowScroll` had implemented
  this exact rule privately for a FOURTH per-pane marker
  (`[data-virgil-row-scroll]`), citing `active-editor-probe` in its own
  docstring. It reads the shared resolver now, keeping its name for its ~dozen
  callers; its pre-existing `≤1` short-circuit is exactly what fail-open
  generalizes to N.
- **A fail-CLOSED resolution must run at a moment when the answer EXISTS, so it
  is re-taken on the VISIBLE EDGE.** `FloatingPanel`'s effect had deps of
  `[mode, slotKey]` and its `!isVisible` bail sits AFTER the hooks, so a pane
  that MOUNTS while hidden — clicking a tab while the PDF viewer is up mounts
  the new doc pane one commit before `pdfView` flips off — resolved once,
  found nothing visible, body-portaled, and never ran again. Fail-open hid that
  (it answered with the LRU-front pane, which was about to become visible);
  fail-closed exposes it, which is why the two shipped together. The same dep
  closes a hazard that predates both: a `dockStack` change made in pane A
  re-keys pane B's slot WHILE B IS HIDDEN, so B resolved A's anchor and kept it
  across the switch. Skipping while hidden costs nothing — the component
  returns null there, so there is no portal to keep pointed at anything.
- **A `?? document` fallback is a document-global resolution wearing the
  relative form's clothes.** `BandDivider.getValue` had one; with no frame in
  hand it would answer with whichever pane came first, hidden ones included. A
  divider with no frame has nothing to trade, so the honest answer is no
  elements — and the census's EMPTY allowlist is only true because that
  fallback was retired rather than exempted.
- **`offsetHeight > 0` is a BACKSTOP, not the primary signal.** `offsetParent`
  is null for a `position: fixed` element that is perfectly visible, so the rung
  is the disjunction. A `display:none` subtree fails both.
- **Scoped by CSS VISIBILITY, not by REACT TREE — stated at the door.** Exact
  for the shipped topology (at most one visible pane); NOT exact for two
  simultaneously visible panes (a future split view), where both pass the rung
  and the first still wins. The context-scoped fix is wider (`FloatingPanel`
  mounts from several places) and does not help `readDockGeometry`, which is
  called from a gesture with no pane in hand. Take the filter now; the context
  is the follow-on if a split view ships.

CI: [pane-dom-multipane.test.tsx](src/components/editor-layout/__tests__/pane-dom-multipane.test.tsx)
builds TWO panes — the hidden one FIRST, as production renders them — and drives
each door plus the REAL `FloatingPanel` in docked mode. **No pre-438 suite could
see any of this**: every panel-column / dock / spawn fixture in the repo builds
ONE column tree, where "the first match" and "the visible pane's match" are the
same element by construction. The leg with teeth is the CENSUS
([pane-dom-census.test.ts](src/components/editor-layout/__tests__/pane-dom-census.test.ts))
— the door was never the part that could misbehave, a call site that never asks
it is, and `document.querySelector('[data-dock-slot="left-0"]')` type-checks
perfectly. Allowlist EMPTY; a relative `closest(…)` / `root.querySelector(…)`
from an element already inside the pane needs no ladder and stays legal.
Measured by neutering each half in turn: the pre-438 resolution takes 10
behavioural legs plus 3 census legs (which name all four original sites);
reverting the `FloatingPanel` call site alone takes 2; the visible-edge deps 1;
and the two later members (`[data-flex-col]`, `[data-strip-side]`) 2 behavioural
plus 3 census. Two of this suite's own first-draft legs were vacuous and are
recorded rather than quietly fixed: a census that stripped STRING LITERALS
erased the very selector it greps for (so every leg passed on the pre-fix tree —
the canary is what caught it), and a "the miss policy is stated" leg read the
RAW file, where both policy literals appear in the door's own header prose.

**Owed, not claimed:** a real eyeball. The repro needs a granted authored doc
AND a Library paper open at once, which is the FSA/multi-pane-masked class, so
the durable proof here is the unit contract.

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

**A detection half is worth what it is WIRED to, and the first wiring was
almost nothing.** The scan was hung off `activateDoc`, which reads like the
doc-open door and is not: the paths that actually open an already-indexed paper —
`openFile` (the Recents list), `createFile`, and the session-restore effect that
reopens last session's tabs — all set `currentDocId` directly and never reach it.
So the whole surface fired for a first-ever open through the folder PICKER and
never again, which is the silence it exists to end. It is keyed on `currentDocId`
now, the one chokepoint every path funnels through; re-scanning on a warm tab
switch is a feature rather than a cost, because a daemon mints forks while the
app is open. Which in turn is why **the dismissal is keyed on the report's
SIGNATURE, not on the docId** — what the user dismissed is a folder STATE ("I
have seen these forks"), and Virgil is a PWA that stays open for days, so a
doc-keyed dismissal would silence a fork of `notes.json` minted at 4pm because
the 9am report was acknowledged.

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

**What the forks actually cost — and the first answer was an OVER-CLAIM.**
[tools/triage-sync-conflicts.mjs](tools/triage-sync-conflicts.mjs) reports
per-file whether a fork holds anything the live sidecar does not. Its first
version decided that by asking whether the fork carried a record ID the live file
lacked, reading records out of a hand list of seven container keys, and it
reported **189 of 204 forks carry nothing**. Both halves of that test fail OPEN
in the destructive direction, and the adversarial pass on this task found both:
eight of the twenty declared sidecars use a key that list does not know (or are
not arrays at all — `annotations.json` is a bare citekey→prose map), so their
forks were never inspected and `--prune` deleted them while the report said they
carried nothing; and an ID-membership test cannot see the COMMONEST conflict
shape there is — the same record edited on two machines, same id, different body.

> **An "inert" verdict is POSITIVE evidence, and a shape the tool does not
> understand is not evidence.** A fork is prunable only where a run PROVED it
> carries nothing: its parsed JSON is structurally equal to the live file, or its
> base is a VIEW-tier sidecar (recomputable by the app's own declaration), or it
> is the browser's `.crswap` debris. Everything else is reported and KEPT. The
> id-diff survives as a labelled hint, deciding nothing.

Re-measured under that rule, the honest number on the reporting folder is **127
proved inert and 96 that DIFFER** — 42 `notes`, 27 `virgil`, 20 `revisions`, 4
`citations`, 2 `archive`, 1 `todos`, most of them "same records, different
content". The divergence is much wider than the first pass claimed, which is
exactly why the tool now keeps them.

Two more rules the same pass earned, both about a copy that could not import its
SSOT: the tool READS the sidecar vocabulary out of `sidecar-value.ts` rather than
treating any lowercase `.json` in the folder as a declared base — the loose
decoration grammars are safe only because the base set is CLOSED, and applying
them to an open set on the side that DELETES inverts the whole argument — and CI
pins both the extraction and the fact that the tool's regexes are a subset of the
module's, since a `.mjs` script has no build step and must restate them.

CI: [sidecar-value-ssot.test.ts](src/lib/__tests__/sidecar-value-ssot.test.ts)
(totality over what production spells, the derivation, the byte-unchanged content
cadence, and the CENSUS — no sidecar writer may spell its own debounce literal,
which is exactly how a 400 ms *settle* came to mean a 400 ms *disk write*). That
census's own first draft is the cautionary half: it named two files by hand and
matched only the DEFAULT form (`debounceMs = 300`), so it was blind to the
CALL-SITE form (`debounceMs: 150`) that `useFocusMode` was live-passing for a
declared VIEW file — a leg that cannot see the one violation in the tree it ships
with is a habit, not a guard. Membership is DISCOVERED now (every file that calls
`usePersistentState`/`writeSidecar`, generics included — the needle that missed
`usePersistentState<StoredBand>(` dropped the offending file straight out of the
population), scoped to WRITERS rather than to every `debounceMs` in the tree
(`useLatexLint` and `useLatexSource` share the word and answer a different
question), and the allowlist is EMPTY.
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

#### The address half: per-MACHINE state does not live in the synced folder

Same folder, the lever the two halves above could not reach (task 417). 363
shrank the write RATE by cadence and 415 by byte-equality, and both left the
premise standing: `editor-state.json` — where THIS window is scrolled to, which
paragraph THIS caret was in, which sections THIS user folded — lived in a folder
whose whole job is to be identical on every machine. Two machines legitimately
DISAGREE about that file, so every sync of it is a conflict the daemon has to
mint, and no cadence reaches zero. It was the loudest fork base in the measured
folder (102 of 197) and holds nothing a second machine wants.

> **A sidecar declares WHERE it lives — `store: "disk" | "local"` on
> `sidecar-value.ts` — and the four sidecar doors in BOTH storage backends
> (`readSidecar` / `readSidecarIfExists` / `writeSidecar` / `mutateSidecar`)
> route on that declaration.** A `"local"` file lives in this browser's
> IndexedDB ([local-sidecar.ts](src/lib/local-sidecar.ts), the same `virgil`/`kv`
> store the emergency mirror uses) and never reaches the paper folder: no swap
> file, no ledger stamp, nothing for a daemon to see. The hook that owns it does
> not know where its bytes went — which is the point, since no writer anywhere
> can then put a local-store file on disk.

Five rules it earned:

- **The VIEW tier is necessary but not sufficient.** `focus.json` is view state
  Gabriel wants waiting on the other machine (a focus band is an authoring
  choice), and `collab.json` is collaborator mode's cross-machine TRANSPORT — a
  partner's tab polls it THROUGH the synced folder, and it is written only while
  collab is enabled. Both stay `"disk"`, stated at the row. The task's resolved
  decision named `collab.json` for local storage; moving it would silently
  delete the feature it carries, so that half is routed back as a question
  rather than shipped.
- **The migration is ONE-TIME and read-only on the folder.** A local miss asks
  the backend's direct disk reader once, copies what it finds in, and the next
  read is local. The disk original is NOT deleted — a delete is itself sync
  traffic (415's rule), the badge's cleanup already drains a view-tier fork, the
  stale file is inert (nothing reads it after the first open, nothing writes it
  again), and it is the seed a second machine migrates from.
- **The name stays in the table**, so the conflict scanner still recognises the
  `editor-state (conflicted copy …).json` debris a folder already holds and the
  cleanup plan still sanctions it. A relocation must not orphan the mess its
  predecessor left.
- **The forensic `.history/` slot and the conflict net stop copying it.** A
  per-machine scroll offset is not evidence of anything, and post-417 it is not
  on disk to copy — the conflict-net leg that pinned the copy is renegotiated in
  place with the reason at the site.
- **`readDocBundle` stops reading it.** Both backends read `editor-state.json`
  into a `bundle.editorState` that NO caller consumed — a disk read per open,
  feeding a dead field (the task-202 shape). Deleted along with the unused
  `DocumentPayload` type.

CI: [local-sidecar-store.test.ts](src/lib/__tests__/local-sidecar-store.test.ts)
drives the REAL FSA doors over a fake disk with a write journal — the complement
every pre-417 sidecar suite lacks, since each of them asserts what a write PUT on
disk and a routing that silently kept the file on disk would pass all of them —
plus the migration, the scanner, and the CENSUS: both backends must route all
four doors, neither may spell a local-store filename in code, and the owning
hook may not reach IndexedDB itself. Measured by neutering each half in turn:
reverting the declaration takes 5 legs, dropping one backend's write route 3.

**Decisions 1 and 3 of the task did NOT land, and the reason is checked rather
than assumed.** Dropbox has no `.dropboxignore`: per its current help pages the
ONLY ignore mechanism is a per-file extended attribute (`com.dropbox.ignored`),
which a browser under the File System Access API cannot set, and the only
name-based rule it honours is the `~$` / `.~` temp-file prefix. So an ignore
file Virgil could write does not exist, and excluding `.history/` from sync has
no mechanism either — the one candidate (renaming it `.~history/`) is an
unverified reading of a rule documented for files. Both are routed back.

**Residual, stated.** With the doc open on two machines at once some conflicts
are inherent; write-rate reduction shrinks the window and never reaches zero.
This half removes one file from the race entirely rather than shrinking it.

**Owed, not claimed:** a real-Dropbox eyeball. FSA-masked AND sync-masked, so
the durable proof is the unit contract; the cheap real check is that no new
`editor-state (conflicted copy …)` appears in the reporting folder after this
ships, ever.

#### The cleanup half: what may be deleted is what a DECLARATION already proves

Same folder, the affordance the daemon half deliberately withheld (task 411).
363 shipped detection and stopped at a stated boundary — *Virgil does not merge
or delete a fork; it REPORTS* — which was the right answer to the question it
could answer, and left a folder that keeps filling with nothing the user can do
about it from inside the app. Measured after 363 shipped: the fork rate fell
roughly 10x (92 forks on the pre-fix day against 10 and 6 after) and the
population kept growing.

> **A delete is offered only where a DECLARATION already proves the bytes carry
> nothing — never where a computation says so.** Two shapes qualify: a fork of a
> **VIEW-tier** sidecar (`sidecar-value.ts` declares it recomputable) and a
> **`.crswap`** leftover (`sync-conflict.ts` declares it browser debris).
> Everything else is REPORTED and KEPT, a content fork above all — *an inert
> verdict is POSITIVE evidence, and a shape the tool does not understand is not
> evidence*, which is the rule 363's own adversarial pass earned and which this
> half inherits rather than re-derives.

[sync-conflict-cleanup.ts](src/lib/sync-conflict-cleanup.ts) is the plan;
`deleteSidecarSiblings` in both backends is the door. Six rules it earned:

- **The DOOR decides, not the caller.** It re-lists `virgil/` INSIDE the write
  critical section and re-derives the sanctioned set through
  `planSidecarCleanup`; the caller's `names` are a FILTER (so nothing is deleted
  that the user was not shown) and never an instruction (so no call site can
  name a content fork into the set). That is the half no type can see —
  `deleteSidecarSiblings(h, notice.groups.flatMap(…))` compiles, runs, and
  deletes the user's unmerged writing.
- **The in-app rule is DECLARATIONS-only, and the offline tool's is not — on
  purpose.** `tools/triage-sync-conflicts.mjs` also prunes a CONTENT fork whose
  parsed JSON matches the live file, and it is entitled to: it runs with the app
  closed, on an operator's decision. In-app the same `deepEqual` would be a
  verdict the user cannot see, and a second copy of the inert test is the third
  speller this file keeps having to retire. CI pins the containment in the one
  direction that matters — anything the app deletes, the tool would too.
- **The net is the PROOF.** No `virgil/.history/` archive, deliberately: a slot
  is itself sync traffic in the folder whose whole problem is sync traffic (task
  415's rule), and archiving bytes that provably carry nothing keeps the file
  count while claiming to reduce it. What the user gets is the check they can
  make — the confirm NAMES every file, and names how many it is leaving alone.
- **Two counts, deliberately different numbers.** The PILL says how many forks
  the folder holds (the report); the cleanup row says how many are proved inert
  (the offer). Conflating them would make one of the two lie, and only a RENDER
  leg can see which number reached the user.
- **It takes the DOC LOCK, and that is about `.crswap` rather than about the
  forks.** A fork is a name Virgil never writes, so it races nothing — but a
  `.crswap` is Chrome's own in-flight write buffer for a file Virgil DOES write,
  and deleting one mid-write breaks that write. `enqueueDocWrite` wraps the task
  in the doc-wide, cross-window `withDocLock`, so a `.crswap` still present while
  we hold it is by construction not one of ours in flight. That is also why the
  fresh listing must be read inside the lock rather than handed in.
- **THE REPORT IS THE PERMISSION.** The receipt has three buckets
  (`deleted` / `refused` / `failed`) and a requested name already gone is in
  none of them — nothing deleted, nothing kept. The affordance reads it rather
  than inferring success from the absence of a throw (tasks 357/364/392), and
  the runner re-scans afterwards so the notice converges by itself.

**Two decisions recorded at their sites rather than re-litigated.** There is
still **no in-app compare** for a divergent fork: a real one needs a reader for
arbitrary sidecar shapes AND an adopt path through each panel's own hook — a
feature with its own design pass, not a badge affordance (`--extract` remains the
answer). And **`virgil.json` is not decoupled from the bundle write** to quiet it
down: that would break the "one bundle, one write" coherence the load-writeback
rests on, which is load-bearing for the whole content-loss cluster. Its entry in
the SSOT also gains the correction the post-415 measurement forced — it holds a
per-block 80-character content FINGERPRINT alongside titles and collapsed state,
so a fork of it is not automatically inert, which is exactly why it is `content`.

CI: [sync-conflict-cleanup.test.ts](src/lib/__tests__/sync-conflict-cleanup.test.ts)
sweeps the PLAN over the REAL `SIDECAR_VALUE` (so a sidecar declared later is
covered by declaration alone, with counters proving the sweep crossed BOTH
tiers), drives the REAL door in BOTH backends against a fake disk, and carries
the CENSUS — the plan was never the part that could misbehave, a call site that
decides for itself is, so every backend door must spell `planSidecarCleanup` over
its OWN fresh listing, nothing outside the one runner may call the door, and the
badge may name no file itself. The count legs live in
[sync-conflict-badge.test.tsx](src/components/__tests__/sync-conflict-badge.test.tsx),
because which NUMBER reached the user is a render fact. Measured by neutering
each half in turn: a door that trusts its argument takes 2 legs per backend, the
tier gate 7, and a second door-caller the census.

**Owed, not claimed:** a real-Dropbox eyeball of the affordance end to end. This
class is both FSA-masked and SYNC-masked, so the durable proof is the unit
contracts; the cheap real check is to run the badge's cleanup on the reporting
folder and then `tools/triage-sync-conflicts.mjs` over it — the tool's
"PROVED to carry nothing" count should have dropped by exactly what the badge
said it deleted, and its "DIFFER and are kept" count should not have moved at
all.

## Capture/schema symmetry — never delete what you cannot restore

> **A destructive action must never delete content its capture destination cannot represent.** A card body that holds a verbatim slice of the document declares `bodySchema: "excerpt"` in `CARD_REGISTRY` and mounts the FULL main-document vocabulary; anything that deletes-and-captures validates the capture against that schema (`canMountInCardBody`) **before** dispatching the delete, and aborts + notifies if it doesn't fit.

This is the "archiving a section destroyed it" class (task 308). It is silent in *both* directions, which is why it needs a law rather than care: the capture is faithful (nothing looks wrong at write time), and **TipTap does not throw on a schema mismatch** — `createNodeFromContent` swallows the `RangeError` and returns an **empty document** (`enableContentCheck` is off), so the card renders blank with only a `console.warn`. Net effect: gone from the doc, blank in the card, and the first keystroke in that blank body persists the empty doc back over the capture. An unknown **mark** and an unknown node type at **any depth** all blank the whole document identically.

Two scopes, one SSOT in [src/lib/tiptap/borrowed-schema.ts](src/lib/tiptap/borrowed-schema.ts):

- **`"card"`** (`CARD_STARTER_KIT_CONFIG`) — authored card prose. No heading / blockquote / codeBlock / horizontalRule; the footnote/note rationale, still correct.
- **`"excerpt"`** (`EXCERPT_STARTER_KIT_CONFIG` + `buildExcerptOnlySchema`) — a document slice. Full StarterKit block vocabulary + the expex family + `titleField`/`maketitleMarker` + the `highlight`/`textColor` marks + the nested `footnote` marker. Today's only member is `archive`.

`EditableCard` resolves the scope **once** from the kind (`bodySchemaForCardKind`) and threads the same value to both body surfaces — `RichTextField` (expanded) and `BorrowedMainText` (compressed) — so a card's two views can never mount different schemas. That asymmetry was itself a live bug: `BorrowedMainText` registered `footnote` and `RichTextField` did not, so an archived paragraph carrying a `\footnote` rendered fine collapsed and blanked on expand.

CI: [src/lib/\_\_tests\_\_/…/excerpt-schema.test.ts](src/lib/tiptap/__tests__/excerpt-schema.test.ts) pins the **reverse** contract — every node **and** mark type the MAIN editor registers must be mountable in the excerpt schema. The pre-existing `borrowed-schema.test.ts` invariant runs one-directionally (borrowed ⊆ main) and therefore structurally *cannot* catch a main-only type reaching a card; this is the direction that does. A new main-editor node kind fails CI until the excerpt surface admits it — or until you confirm the guard refuses it, which turns a would-be data loss into a refusal. `archive-section-capture.test.tsx` pins the dispatcher end: the section is captured whole, and a capture that can't mount leaves the document **completely untouched**.

### The payload half: a guard judges the payload the write will STORE

Same law, and the case where the invariant was right, the schema was right, the
normalizer was right, and the guard was asking about a document that never
reaches disk (task 393). The 308 check validates the capture against the
destination's real schema — the one check that cannot drift from what the body
will do — and it was handed the RAW slice, while the write path stores the
NORMALIZED one. `normalizeRichContent` strips `DOC_ONLY_MARKS` (`linkedAnchor`,
the doc-level anchor mark), and the excerpt schema deliberately does not register
that mark **for exactly that reason** — the excerpt-schema contract test names it
as the one sanctioned omission, `STRIPPED_BY_NORMALIZER`.

So the two tables disagreed by construction. Any passage carrying a Mode-B
`\vlid{…}` span — i.e. worked-over prose, which is the prose a user most wants
to archive, since anchors accumulate there — was refused with "the Archive panel
can't hold part of it, so nothing was removed": **a false refusal, protecting
against a loss that cannot happen, and blocking the action entirely.** Nothing
threw; the guard was doing its job perfectly on a payload nobody stores.

> **A destructive capture derives its payload ONCE, through one door, and the
> object it VALIDATED is the object it STORES.** Normalize first, validate that,
> hand it back — so the guard and the write cannot again disagree about what is
> being judged. And when the check does fire, the refusal NAMES the construct it
> could not hold.

[src/lib/tiptap/card-body-capture.ts](src/lib/tiptap/card-body-capture.ts) is the
door (`prepareCardBodyCapture`, slice-or-JSON → the normalizer's own strip →
`canMountInCardBody` → `{ ok, content }`). Five rules it earned:

- **The door owns the whole derivation, including the slice walk.**
  `sliceToDocJson` moved off the dispatcher into it, so "capture → storable
  payload" is one function rather than a sequence a call site assembles. That is
  the property, not the tidiness: a caller that can reach the pieces re-derives
  the payload and spells none of the census's needles (the task-273 rule, one
  medium over).
- **`canMountInCardBody` stays the SCHEMA question and remains the only probe.**
  The door calls it; it was never wrong. What was wrong was a capture site asking
  it. Its docstring now says so, and the census draws the line.
- **A refusal names the construct, DERIVED rather than parsed.**
  `unsupportedConstructs(schema, json)` ([schema-mount.ts](src/lib/tiptap/schema-mount.ts))
  walks the model and reports the node/mark names the destination schema has not
  got — the schema's own vocabulary, never ProseMirror's message FORMAT, which is
  a dependency's implementation detail. Run only on the failure path: the
  mechanism decides, the probe explains (`checkKeptEverything`'s own rule).
- **The naming FAILS OPEN to the raw reason.** `nodeFromJSON` also throws on a
  malformed model whose every type name is known (a text node with no `text`, a
  non-array `content`), so an empty construct list is not evidence that nothing
  was wrong — the phrase degrades to ProseMirror's message rather than claiming
  completeness.
- **The anchored card's own lifecycle is unchanged, and that is pinned as a
  DECISION.** Archiving text carrying another card's Mode-B anchor puts that card
  on the normal orphan path — asserted as an EQUALITY against a plain Delete over
  the same range, so neither action can drift alone.

CI: [card-body-capture.test.ts](src/lib/tiptap/__tests__/card-body-capture.test.ts)
(the door contract + the census) and
[archive-anchored-capture.test.tsx](src/components/editor-layout/card-actions/__tests__/archive-anchored-capture.test.tsx)
(Gabriel's passage end to end through the REAL hook and the REAL extension
stack). **No pre-393 suite could see this**: every archive fixture in the repo is
UNANCHORED, so the raw and the normalized payload are the same object and the
divergence is unrepresentable in all of them. The leg with teeth is the CENSUS —
the door was never the part that could misbehave, a capture site that validates
one payload and stores another is, and that type-checks perfectly: no production
file may CALL `canMountInCardBody` outside the door (allowlist EMPTY, a hit is
MIGRATE-it), the door must spell `normalizeRichContent`, and every capture site
— DISCOVERED from the tree, so the next one inherits the rule — must enter the
door. Measured by neutering each half in turn: the pre-393 raw validation takes
4 legs, the naming half 1, a re-added direct probe call 1, and a capture site
leaving the door 1.

**Owed, not claimed:** the preview eyeball. This class is FSA-masked for the
real-paper flow (anchor behaviour reproduces under prod File System Access), so
the durable proof here is the unit contract; Gabriel's exact passage is the
fixture.

### The displacement half: a capture SETS TEXT ASIDE, so the margin context it displaces RE-HOMES

Same door, the cards the capture did not capture (task 491) — and the case where
the pre-existing behaviour was a DECIDED contract, pinned as an equality, and
overruled by the user it was decided for.

Gabriel, from a real paper: *"when you archive a passage that has an archive
card, you loose the original archive card. they should just stack up on the
preceeding paragraph."* Task 393 had pinned the opposite explicitly — archiving
text that carries another card's anchor puts that card on the normal ORPHAN
path, **asserted as an EQUALITY with a plain Delete over the same range**. Post
task 410 the orphan is not literally lost (it reaches the pod header's
"N unanchored" chip), but it leaves the margin, which is what the user
experiences as loss.

> **A DELETE removes the context, so a card that pointed at it has nowhere to
> be. An ARCHIVE sets the text ASIDE — the passage still exists, one panel over
> — so the margin context has somewhere to be: the surviving neighbour, which is
> exactly where the fresh snippet lands. One neighbour, resolved ONCE per
> gesture, read by BOTH halves — that is what "stack up" means.**

[resolveDisplacedAnchorTarget](src/text-objects/anchor-resolution.ts) resolves
the neighbour; [retargetDisplacedAnchors](src/cards/retarget-anchors.ts) moves
the anchors. Seven rules they earned:

- **The scope is drawn at the ANCHOR MODE, and the 393 equality survives on the
  half it was actually about.** Every **Mode-A paragraph-anchored** card
  re-homes, because its anchor is a paragraph IDENTITY the neighbour can carry.
  A **Mode-B (`linkedAnchor`)** anchor names the TEXT RANGE, and the range is
  precisely what left — so those keep the pre-491 path
  (`cleanupLinksInRange` → the kind's `lifecycle.delete`), which the archive and
  delete branches SHARE, so widening here would silently change what Delete
  does. Task 393's leg is renegotiated in place, scoped to Mode-B with the reason
  at the site, and the Mode-A asymmetry is pinned beside it.
- **A Mode-A anchor lives on the CARD, so the sweep asks the COLLECTION.**
  Nothing in the removed slice marks it, so it cannot be found by walking the doc
  the way `cleanupLinksInRange` finds atoms and marks. The question has to be
  asked from the other side — *which cards name a uuid this capture is about to
  remove?* — which is why `MarginItemHandlers` now carries its kind's whole
  collection alongside the by-id lookup the delete path uses. ONE bundle, both
  directions, built by the one builder every consumer already shares, so a new
  margin-bearing kind inherits the obligation as a COMPILE ERROR rather than by
  someone remembering.
- **The neighbour is resolved ONCE and read by both halves.** Two resolutions
  would put the snippet and the cards it displaced on two paragraphs, which is
  precisely NOT stacking — and the census asks for exactly one
  `resolveDisplacedAnchorTarget` call per capture site for that reason.
- **The resolver is the honest form of what B2 always MEANT.** The snippet's own
  anchor used `findPreviousAnchorableBlock` gated on `ref.kind !== "selection"`
  — an approximation of *"is the whole anchoring entity being deleted?"*, which
  its own comment states and which is FALSE for a `linkedRange` ref, whose host
  paragraph survives. The resolver asks the real question: rung 1 keeps a
  partially-captured HOST block (a sub-range capture leaves its own paragraph
  standing, and that is where the context belongs), rung 2 is the nearest
  surviving block ABOVE, rung 3 falls FORWARD.
- **Rung 3 is not symmetry for its own sake.** A capture that starts at the
  document's FIRST block has nothing above it, so rung 2 answers `null` — and
  pre-491 that meant the fresh snippet anchored to `""` (born unanchored) and
  every displaced card orphaned. Falling forward keeps the class whole.
- **Rung 1 is asked only where `from` sits INSIDE a textblock.** At a block
  boundary the enclosing node is the doc, or a list wrapper the user never
  pointed at, and answering with it would put the displaced cards somewhere the
  snippet is not — the stacking failure wearing a fix's clothes.
- **The sweep runs BEFORE the delete is dispatched.** Not for position reasons
  (these are sidecar writes) but because the deferred
  `virgil-textobject-orphaned` sweep fires off that transaction and strips any
  link still naming a vanished uuid. Retarget first and the sweep finds nothing
  to strip, by construction rather than by racing it. It also sits INSIDE the
  never-destroy guard's success branch, so a REFUSED capture moves no anchor for
  a passage still in the document.
- **A multi-anchor card moves only the CONSUMED pids**, and gains the neighbour
  only if it is not already anchored there — repeated adjacent archives converge
  on one survivor, and a second identical link would paint a duplicate marker.

CI: [archive-retarget-displaced-anchors.test.tsx](src/components/editor-layout/card-actions/__tests__/archive-retarget-displaced-anchors.test.tsx)
drives the REAL `useDragHandleActions` hook over the REAL main-editor extension
stack and the REAL `links.ts` mutators. **No pre-491 suite could see any of
this**: every archive fixture in the repo either has no other card in the
captured range at all, or (task 393's) carries a Mode-B mark whose fate is
decided by `cleanupLinksInRange` rather than by any anchor question — a Mode-A
card anchored INSIDE the captured range is unrepresentable in all of them. The
leg with teeth is the CENSUS, and it rides the DISCOVERED capture-site
population `card-body-capture.test.ts` already builds: every site that mints an
archive snippet must resolve the neighbour exactly once and retarget through the
door, and nothing outside `retarget-anchors.ts` may re-derive the sweep.
Allowlist EMPTY. Measured by neutering the retarget call: 6 behavioural legs
fail, and the delete-still-orphans leg passes either way — which is the point.

**Owed, not claimed:** a real-FSA eyeball. Archive anchors are the FSA-masked
class, so the durable proof here is the unit contract — archive two adjacent
passages that each carry a card, and both markers stack on the surviving
neighbour.

**Residual, stated.** `cleanupLinksInRange` still DELETES a footnote / citation
card whose atom sits inside the captured range, and a Mode-B card whose mark
does, exactly as it did before. That is shared with Delete and is a product
question (should an archive carry its footnotes into the clip?) rather than an
anchor one, so it is recorded here rather than changed under a fix about
paragraph anchors.

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

#### The inline half: the INLINE sibling of the container question, and its five silent skippers

Same law, the INLINE axis (task 396) — and the case where the SSOT existed, was
correct, was documented with the exact corruption it prevents, and was consulted
by ONE caller for five weeks while five others landed the atom straight past it.

Task 150 built `posHostsInlineAtom` for one question: *can this position host an
INLINE atom?* The MARKLESS verbatim blocks (`codeBlock`, `latexComment`) declare
`content: "text*"` — literal text, no inline nodes — so ProseMirror's fitter
cannot place the atom there. Measured against the real stack, what it does is
worse than the docstring's "splits the block": it **TRUNCATES the block at the
insert offset and EJECTS its tail text into a fresh top-level paragraph beside
the atom.** In a `latexComment` that means a line the user had commented OUT
becomes live printed prose. Nothing throws, the doc is schema-valid, the save
writes it straight through — and `insertLanded` (the 332 net) reads `+3` growth
against a floor of 1, so it false-passes.

> **The inline sibling of "an insert asks the CONTAINER what it can hold":
> `posHostsInlineAtom` is the SSOT, and EVERY site that splices an inline atom
> asks it — through the ONE door `insertInlineAtom`, or by spelling it directly.**
> It is a DIFFERENT predicate from the block gate and must stay one: a
> `titleField` (`content: "inline*"`) legitimately hosts inline math, so reusing
> `posHostsBlockInsert` would grey the title too.

Six rules it earned:

- **A comment describing a retired premise is how the next reader concludes the
  invariant is held.** Task 147 gated the BLOCK-atom cells and recorded, as a
  deliberate exclusion, that "`inline-math` and `ref` insert INLINE atoms (no
  split, valid inside a title/code block)". Task 150 falsified the code-block
  half **one day later** and fixed only the surface it was reported on
  (`math.ts`). That comment then outlived its own premise for five weeks, and
  three later surfaces inherited it unexamined — the grid cell, the `\ref`
  popover commit, and the shared door. The title half was true, which is exactly
  what made the sentence survive review.
- **Gate the DOOR, not just the affordance.** Greying the two cells closes two
  clicks and leaves the deferred create-popover commit open — `handleInsertRef` /
  `commitCitationCreate` land at a position captured at TRIGGER time, which no
  `applies()` can see. `insertInlineAtom` is the deepest point and the only one
  that covers it, plus every future inline atom.
- **…and the affordance half had no CONSUMER until the CELLS were wired.** The
  adversarial pass on this fix found it: the lightning grid greys through a
  hand-computed `blockAtomsDisabled` (ONE probe of the `example` row) and the two
  inline cells carried `disabled={!canEdit}` only, so a correct `applies()` on the
  rows greyed nothing on screen. Each cell asks its OWN row now — deliberately not
  a second shared probe, since the two rows pass different schema node names. *A
  facet nothing reads is this file's own recurring finding, arriving one level up
  from the one the task set out to fix.*
- **The gate is SCOPED to the corrupting case, and the scope is the precision.**
  The tear is a property of a TEXTBLOCK that admits text and not inline nodes. At
  a NON-textblock position (a top-level gap beside a block atom, a GapCursor, a
  `posAtCoords` between blocks) there is nothing to tear — measured,
  `tr.insert(gapPos, citation)` yields a fresh paragraph holding the atom and
  destroys nothing. The first cut refused there too, on an argument about
  `insertContent` REPLACING a `NodeSelection`, which is a different API and a
  different (RANGE) hazard: it would have turned a bib-entry drop beside a figure,
  and a footnote at a gap cursor, into silent no-ops. *A refusal needs the same
  evidence a fix does.*
- **A gate placed after the MINT trades the corruption for a ghost card.** Both
  native drops call a callback that PERSISTS a citation card before the splice, so
  the gate has to run first — otherwise a refused drop leaves an anchored card
  with no atom, which is this defect one layer down. Ordering is invisible to a
  region grep, so it has its own leg.
- **The gate asks about the position the insert will ACTUALLY use.** TipTap's
  `setTextSelection` clamps into `[TextSelection.atStart, TextSelection.atEnd]` —
  the TEXT range — never `doc.content.size`, which resolves to the doc itself. So
  an out-of-range `at` is judged where it LANDS (the first/last textblock) rather
  than at the doc node the scope above waves through. Mirror the clamp; do not
  re-derive a different one.
- **THE REPORT IS THE PERMISSION.** A refusal returns `{ refused: true }` with
  the document untouched, and the callers that mint an entity AFTER the insert
  read it — otherwise a citation/footnote CARD is registered with no atom in the
  document, which is this defect one layer down.
- **The SCHEMA half sits BESIDE the POLICY half, never instead of it.** The typed
  input rules were already refused by `blockKindAllowsAction` (a curated
  per-kind set) and the two answers coincide for the verbatim blocks only by
  construction — `MARKLESS_BLOCK_ACTIONS` happens to subtract
  `INLINE_INSERT_ACTIONS`. They are different questions (*may a footnote be
  created here?* / *can this textblock hold an inline node at all?*), so both are
  asked; the schema half costs nothing today and is what survives an edit to the
  curated set or a new markless kind.
- **A narrow type-only twin does not stay exported.** `blockTypeHostsInlineAtom`
  cannot clamp a stale caret and every real consumer holds a position, so it was
  a dead export (a sibling call is not a consumer) AND an invitation to ask the
  smaller question. Private now; `posHostsInlineAtom` is the one door.

**Three of the fix's own first-cut errors are recorded above rather than quietly
corrected, because each is a rule:** an affordance with no consumer, a refusal
without evidence, and a gate behind a mint. All three were found by the
adversarial pass, none by any leg — which is why each now has one.

**The census found two live sites the report did not name**, both the same shape
one layer out: the native HTML5 `MIME_CITATION` drops in `Editor.tsx` and
`RichTextField.tsx` land at a bare `posAtCoords` with no schema question at all —
so dragging a bib entry onto a `%` comment corrupted it, in the main document and
in a card body (where `latexComment` is registered in EVERY scope and `codeBlock`
rides `EXCERPT_STARTER_KIT_CONFIG`). The dead `MIME_FOOTNOTE` drop beside them is
gated too, as a latent-trap closure.

CI: [inline-atom-container-gate.test.tsx](src/lib/actions/__tests__/inline-atom-container-gate.test.tsx)
drives the REAL stack over the affordance, the run, the door and the REAL `\ref`
popover commit, asserting the serialized `.tex` as well as the node shape — the
`% todo` → live-line promotion is only visible in the bytes. The leg with teeth
is [inline-atom-container-census.test.ts](src/lib/tiptap/__tests__/inline-atom-container-census.test.ts):
the SSOT was never the part that could misbehave, a call site that never asks it
is, and that type-checks perfectly. Membership is DISCOVERED in two precise
halves rather than one loose window — a line that RESOLVES an inline-atom
NodeType off a schema inside a declaration that also splices (half A, which
accepts ONLY the inline gate), and every splice inside a module that DECLARES an
atom (half B, where `math.ts`'s `displayMath` branch legitimately answers with
the BLOCK gate). Allowlist EMPTY. Measured on the pre-396 tree it names all eight
ungated sites, and six of its nine legs fail. The task-147 suite's inline-row
expectation is RENEGOTIATED in place with the reason at the site: it pinned this
defect as intended behaviour.

**The residual this filed is CLOSED by task 414** — the drop-mode / slice family,
which landed atoms at `makeInlineCursorPlacement` positions asking no schema
question at all. See "The drop half" immediately below.

**A second residual, also filed — CLOSED by task 428**, see "The range half"
below: the gate was a SINGLE-POSITION question where the block twin
(`blockRangeAllowsAction`, task 148) requires EVERY reachable textblock.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (pure schema +
serializer), so the check is cheap and real: select a word inside a `% comment`
line, open the bolt, and see `$x$` and `Cross-ref` greyed.

##### The range half: a gate over a SELECTION asks about every textblock the selection reaches

Same predicate, the other axis (task 428) — 396's own recorded second residual.
An inline atom inserted over a non-empty selection REPLACES `[from, to]`
(`insertContent`, `replaceSelectionWith`), and every gate read `selection.from`
alone. Measured on the pre-428 tree: select from mid-paragraph INTO a
`codeBlock`, click the lightning `$x$` cell — the affordance reads the
paragraph and says "ok", `mathRun`'s data-loss guard passes (non-empty text),
the door judges `from`, and the replace destroys the code block's text and
merges the two blocks into one paragraph. The block twin had asked the range
since task 148, and recorded why.

> **`inlineRangeAllowsAtom(doc, from, to, atomType)` is the RANGE form of the
> inline-atom SSOT and `posHostsInlineAtom` is its caret form (`from === to`).
> Both families read ONE walk — `inlineInsertTargetTypes`, factored out of
> `blockRangeAllowsAction` — so the policy gate and the schema gate cannot
> disagree about what "the textblocks this range reaches" means. Fails CLOSED:
> every reachable textblock must admit the atom.**

Three rules it earned:

- **Which form a site owes is decided by what its SPLICE consumes.** A splice
  that replaces the live selection (`insertContent` with no `at`,
  `replaceSelectionWith`, `mathRun`'s wrap) owes the range; a splice that names
  its position (an explicit `at`, which `setTextSelection` first COLLAPSES to,
  a `posAtCoords` drop, an input rule whose match lies inside one textblock)
  owes the caret form, stated at each site.
- **The one permissive answer survives the widening.** A range reaching NO
  textblock (a gap beside a block atom, a GapCursor) is a place PM wraps rather
  than tears, and stays allowed — which keeps the caret form byte-identical to
  its pre-428 self. A `NodeSelection` over a block atom is that shape and
  remains the out-of-scope RANGE hazard `posHostsInlineAtom`'s header names;
  `mathRun`'s data-loss guard is what protects it today.
- **The census asks the SHAPE of the splice.** `inline-atom-container-census`
  gains a fourth question with an EMPTY allowlist: a censused site whose splice
  is `replaceSelectionWith` / `insertContent` must spell the range form or
  enter the door, and the door itself must read `selection.to`.

CI: the range legs in
[inline-atom-container-gate.test.tsx](src/lib/actions/__tests__/inline-atom-container-gate.test.tsx)
drive the REAL stack over a prose→`codeBlock` selection through the affordance,
the run and the door, with the wholly-in-prose, title→prose and caret controls.
Measured by neutering the range primitive back to `from`: 4 legs fail, plus the
census leg when the slash `\footnote` is reverted to the caret form.

**Owed, not claimed:** the preview eyeball — drag-select from a paragraph into
a code block, open the bolt: `$x$` and Cross-ref greyed. Not FSA-masked.

##### The drop half: the AFFORDANCE is where a per-payload container question is asked

Same law, the DRAG carrier (task 414) — and the case where the SSOT was the one
door 396 had just wired everywhere, and the seven sites that skipped it skipped
it from a layer no door gate can reach.

A drop-mode gesture resolves its landing at ONE chokepoint,
`makeInlineCursorPlacement` ([hit-test.ts](src/components/drop-mode/hit-test.ts)),
which returned the raw `posAtCoords` position. `codeBlock` and `latexComment`
both declare a `uuid` attr, so `resolveAnchorableBlock` resolves them, `inText`
is true over their text, and a caret painted inside them like anywhere else.
Measured against the real stack, dropping a citation into `% todo| fix later`:

```
latexComment("% todo") + paragraph[citation, " fix later"]
.tex:  % % todo %!v:m1
       \vcid{x}\cite{a} fix later
```

**A line the user had commented OUT becomes live printed prose** — task 347's
promotion class, arriving through a drag. Nothing throws, the doc is
schema-valid, the save writes it through.

Seven sites: the CREATE branch (`insertNewAtom`, a footnote/citation card
dragged out of its panel), the CREATE-BY-COPY (`stack-pull`'s inline-cursor
`tr.replace`), and five MOVEs — `moveInlineAtomWithin` (all four atom kinds via
the in-text grab), the cross-editor atom insert, and `text-range-move`'s two
slice splices.

> **A container question with a PER-PAYLOAD answer is asked at the ONE hit-test
> chokepoint, so the hover and the commit answer from the same table — and the
> payload is resolved ONCE per session, never per pointermove.** `DropSpec`
> declares `inlinePayloadFor` (the twin of `placementsFor`, resolved on the same
> `beginDropSession` edge); [inline-host.ts](src/components/drop-mode/inline-host.ts)
> folds it over `posHostsInlineAtom`; every splice re-asks against the node or
> slice it actually holds.

Six rules it earned:

- **A gate at each splice alone would have been the FALSE-AFFORDANCE class.**
  The indicator would keep lighting a caret the release then silently refuses —
  in the one subsystem whose own guardrails (`placement-reachability`,
  `planned-decision-guardrail`) exist to outlaw exactly that. So the fix is an
  affordance change, and it is user-visible: no caret paints inside a verbatim
  block **for a payload that block cannot hold**. Plain text still gets one —
  `text*` hosts text, and refusing there would be the false refusal task 396's
  own first cut shipped, which is what the two CONTROL legs pin.
- **A net whose measure is a growth FLOOR cannot see a corruption that GROWS the
  document.** `insertLanded` (task 332) is the cross-editor move's net, and the
  ejected tail INFLATES the growth — measured `+3` against a floor of 1 — so it
  FALSE-PASSED and the unconditional source delete fired, taking a footnote's
  `content` body, which lives nowhere else. The honest test is the container
  question, asked BEFORE the delete; the gate therefore sits above `insertLanded`
  rather than beside it.
- **The BLOCK reading is a DIFFERENT question from the inline one, and reusing
  the atom predicate for it would refuse a working drop.** An open
  multi-paragraph slice at a caret legitimately SPLITS ordinary prose (measured),
  and `posHostsInlineAtom` answers false for a `paragraph` type — so a naive
  one-rule gate kills the commonest slice move there is. What such a payload may
  not do is enter a textblock that hosts *nothing but text*, where the fitter
  truncates and ejects exactly as it does for an atom (measured:
  `codeBlock("hello|world")` → `codeBlock("helloAAA")` + `paragraph("BBB
  world")`). So the block reading asks the WEAKER question, answered by asking
  the schema for a witness rather than by reading a content expression as the
  STRING `"text*"`.
- **The payload is NAMES, not `NodeType`s.** A payload may be resolved from a
  source editor, from persisted JSON, or from a spec's static configuration,
  while the question is asked against the TARGET's schema — and two schemas built
  from one extension list hold DISTINCT `NodeType` objects (the identity fact
  behind task 328). A name is the one currency both ends share, and a name this
  build cannot resolve is SKIPPED: that is the vocabulary question, which
  `schema-adopt.ts` already owns, and answering it here would be a second table
  for one question.
- **Marks are deliberately NOT asked.** Measured, PM drops the disallowed marks
  and the block is intact, so there is no corruption to refuse — and inventing
  one would be the false refusal task 396's own first cut shipped. Stated at the
  door rather than left to be rediscovered.
- **THREE markers on one splice line is not redundancy.** `container-fit-exempt:`
  says no container is entered, `schema-adopt-exempt:` says the payload speaks
  this vocabulary, and `inline-host-exempt:` says this site is not where a
  refusal belongs. Each answers a question the other two are not entitled to
  answer — task 204's rule, and the reason the second question had to exist at
  all.

CI: [inline-cursor-container-gate.test.tsx](src/components/drop-mode/__tests__/inline-cursor-container-gate.test.tsx)
drives the REAL hit-test and the REAL specs over a fixture holding a
`titleField`, prose, a `codeBlock` and a `latexComment` carrying a real commented
line — asserting the serialized `.tex`, because the promotion is only visible in
the bytes. The leg with teeth is the CENSUS, in two halves: the SOURCE half is
`container-fit-guardrail`'s THIRD question (every splice excused from the FIT
must ask the inline question in its enclosing declaration; the four exemptions
are per LINE and each is a dispatch helper, a shared door or a never-dispatched
probe), and the LIVE-OBJECT half is in `placement-reachability` (every spec that
can offer an inline caret declares `inlinePayloadFor`, asked of the objects for
the two reasons that file already gives about `placementsFor` — the ES
method-shorthand form is invisible to a grep, and most specs are authored outside
this directory). The live-object half's allowlist is EMPTY — a hit is DECLARE-it;
the source half's is the four per-LINE exemptions named above, and it may only
shrink. Its population is DERIVED from the fit MECHANISM (`fitted`), never
inherited from question 1's exemption LIST, so a splice carrying no marker and no
fit enters it too; the residual is the file's own region granularity, stated at
the leg. `inline-atom-container-census` drops its `OUT_OF_SCOPE` carve-out for
this directory and says why a green answer from THERE about it would have been a
vacuous one. Measured by neutering each half in
turn: the affordance gate takes 3 legs, the three atom-move commit gates 4, the
stack-pull commit gate 3, the text-range commit gate 2, the block reading 1 (the
atom predicate) and 3 more (the weak proxy — `titleField` / `figureCaption` /
`glossCell`), a spec that drops its declaration 1, a per-MOVE payload resolution
1, and a dropped `inline-host-exempt:` marker 2.

**Residuals, stated.** A caret in a top-level `heading` still passes the block arm
(the `doc` hosts a paragraph beside it), so an open slice dropped mid-heading
splits it and its tail becomes body prose — a real split rather than a loss, and
the same answer the `paragraph` control gets, but it is a type CHANGE and wants
its own decision rather than being folded in here. The gate is also a
SINGLE-POSITION question, inheriting task 396's own second residual: a payload
whose splice spans blocks is judged at its insert position alone. And `text-range-move`'s same-editor branch asks at the
PRE-delete position while inserting at the MAPPED one. That is the honest place
to ask — it is what lets the refusal return before anything is dispatched — and
it is not free of assumption: a text-bounded delete that spans a block boundary
JOINS the blocks, and the survivor takes the LEADING block's type, so a range
running out of a `heading` could leave the mapped position in a different node
type than the one the gate was asked about. Stated rather than closed.

**Owed, not claimed:** the preview eyeball, and it is REQUIRED here rather than
nice to have, because the fix changes what the indicator PAINTS: drag a footnote
card over a `%` comment line and confirm no caret appears. NOT FSA-masked (pure
schema + serializer), so the check is cheap and real.

#### The row half: a surface answers PER ROW, and a WRAPPER is a container question too

Same family, and the case where the container SSOTs were right, the registry was
right, and the SURFACE asked one row for six types (task 397). The two halves
above give the block and inline atoms a per-NodeType FACTORY each —
`blockInsertApplies` says so in its own docstring — and the lightning grid then
computed ONE `blockAtomsDisabled` from the `example` row and rendered it on six
cells, and ONE `wrappersDisabled` from the `bullet-list` row on three. The GRAB
menu had it right from the start (`row.applies(ctx) === "disabled"`, one call per
row), so the precedent was already in the tree.

Three members, one disease, all measured against the real stack:

- **A shared probe is an assertion that the SCHEMA answers identically for every
  type in the group**, and inside an expex example it does not.
  `exampleBlock` hosts `graphicsBlock | displayMath` and none of the other four
  — the union was widened for exactly that (Feature A2) — so **Display math**
  and **Image** greyed out although each row said `ok`, the schema hosted them,
  and the run worked. The typed `$$` rule at the same caret succeeded, so two
  surfaces routing to one node disagreed. A FALSE REFUSAL of the feature the
  widening was built to serve.
- **The wrapper gate read the block TYPE and never the CONTAINER.**
  `selectionIsListable` asks "is this block a `paragraph`/`listItem`?", which is
  a question about IDENTITY (would the wrap coerce a `titleField` into a
  paragraph?) and says nothing about where the wrapper would GO. So Blockquote
  was lit and inert inside an example, and Bullet/Numbered at a caret inside an
  example ITEM **silently destroyed the item**: `exampleItem`'s union has no
  list, so ProseMirror lifts the paragraph OUT — `\vxid{it1}` gone, fresh uuids
  minted in its place (every card / marginalia marker / sidecar entry anchored to
  it orphans), and because expex numbers items by POSITION, `(1a)` now denotes
  what was the SECOND item, so every `\ref` into that example points at
  different text. Schema-valid, `doc.check()` clean, nothing logged.
- **The five MARK cells were gated on `!canEdit` alone** and sat lit and inert in
  the two markless (`marks: ""`) verbatim blocks — the lowest-severity member and
  the same disease.

> **A surface renders one verdict per ROW, from that row's own `applies()`; a
> row's gate is schema-precise in the row's OWN type; and the wrapper question is
> the THIRD member of the container family — `posHostsBlockInsert` (a block lands
> BESIDE the caret's textblock), `posHostsInlineAtom` (an inline atom lands
> INSIDE it), `selectionHostsWrapper` (a wrapper goes AROUND the blocks the
> selection spans).**

Seven rules it earned:

- **Ask ProseMirror's own predicate, not a restatement of it.**
  `selectionHostsWrapper` calls `findWrapping` — the question `wrapIn` /
  `wrapInList` themselves ask — so the affordance and the commit cannot come to
  disagree about what "wrappable" means. A `container.canReplaceWith(type)` gate
  was the obvious move and is strictly weaker: it asks whether the container
  accepts the WRAPPER and never whether the wrapper accepts the CONTENT, so it
  waves through a `codeBlock` that no `listItem` can hold.
- **…and a toggle is not always a wrap.** A wrapper toggle is SUBTRACTIVE — a
  lift out, or a convert in place — exactly when the caret already sits inside a
  container of the wrapper's own family, and there `findWrapping` answers null
  for a gesture that is not merely legal but ordinary: `listItem`'s content pins
  a leading `(paragraph | graphicsBlock)`, so at index 0 NOTHING can be wrapped,
  while bullet→off and bullet→numbered are the two commonest list gestures there
  are. A `findWrapping`-only gate greys both (measured: 3 legs).
- **The family is DERIVED, never a list of node names.** An ancestor is family to
  the wrapper iff BOTH content models accept the affected block range's own
  parent type. `bulletList` and `orderedList` are family because both host a
  `listItem`; a nested `blockquote` is family to the blockquote row; an
  `exampleItemList` — which hosts only `exampleItem`, a child no wrapper accepts
  — is family to none, which is precisely why a list toggle inside a bullet list
  must stay enabled while the same toggle inside an expex ITEM must grey. The doc
  node is excluded from the walk: the document is not a container anything can be
  lifted out of, and `block+` would make it family to everything.
- **The failure direction is stated and deliberate.** The family test is only
  consulted after `findWrapping` has already said NO, so a wrongly-EXEMPT case
  leaves the pre-397 behaviour (the cell stays enabled) while a wrongly-NON-exempt
  case greys a toggle ProseMirror itself reports it cannot perform.
- **A mark row asks about its OWN mark, over the RANGE, with "any" not "all".**
  `formatApplies` is a per-mark factory reading `allowsMarkType` off the live
  schema — not a list of block names, so a future verbatim kind is covered by
  shipping. A selection running from prose INTO a `codeBlock` still bolds the
  prose half, so the cell greys only when the toggle is inert everywhere it could
  act; and the mark RUN is deliberately unguarded, because unlike the wrappers
  there is nothing to prevent and a guard would have to re-answer the
  mixed-selection question.
- **The row DECLARES what it toggles, as a discriminated union**
  (`{ wrapper: "bulletList" } | { mark: "bold" }`), so "exactly one" is a compile
  error rather than a convention — and the `run()` guard reads the SAME
  `wrapperSafeHere` predicate the affordance does. That guard is what the SLASH
  twins inherit (`\list` / `\enumerate` / `\quote` route through the bridge into
  this same `run()`, and the popup asks no container question of its own).
- **The census is the leg with teeth, and it needs to be — the rows were never
  the part that could misbehave.** Each of the six answered correctly the whole
  time; a consumer that asks one of them for all six type-checks, renders, and is
  invisible to every behavioural test of every row.

CI: [grid-row-applies.test.tsx](src/lib/actions/__tests__/grid-row-applies.test.tsx)
drives the REAL stack, and — the leg the registry legs structurally cannot reach
— mounts the REAL `ActionsMenuPanel` over the REAL editor and reads each cell's
native `disabled` out of the DOM. **No existing fixture could see any of this**:
every block-atom container fixture in the repo is `titleField` / `codeBlock` /
`latexComment` / prose, where all six types AGREE — which is exactly why the
shared probe shipped and survived. The destruction is legible only in the bytes,
so its legs assert the serialized `.tex`.
[grid-cell-applicability-census.test.ts](src/components/__tests__/grid-cell-applicability-census.test.ts)
is the source census: every grid cell's `disabled` must read `gridCellDisabled`
with its OWN literal id, membership DISCOVERED from the file's own JSX, the two
bespoke cells carrying a STATED answer rather than an exemption (a missing `id`
prop must never read as "excused"), allowlist EMPTY — a hit is WIRE-it. It reads
`commentsStripped` and NOT `codeOnly`, since every needle lives inside a quoted
attribute. Measured by neutering each half in turn: the shared block-atom probe
takes 2 legs, the wrapper's container half 9, the subtractive-family half 3, the
mark factory 3, and the wrapper `run()` guard 6. Two legs in
[chip8-format-marks.test.ts](src/lib/actions/__tests__/chip8-format-marks.test.ts)
are RENEGOTIATED in place with the reason at the site: they pinned the defect as
the contract ("the code cell is 'ok' but the inline mark cannot land — the
oracle's stated divergence between an enabled cell and a near-zero effect", and
"wrapper cells STAY 'ok' … on a listItem", which is true of the two list rows and
false of blockquote).

**The residual this filed is CLOSED by task 427** — see "The surface half"
immediately below.

##### The surface half: the SSOT was built and ONE caller adopted it

Same predicate, the three surfaces that never entered the registry (task 427) —
397's own recorded residual. StarterKit's `Mod-Shift-8/7/b` chords, its `- ` /
`1. ` / `> ` markdown input rules and `RichTextField`'s toolbar each reach
`toggleBulletList` / `toggleOrderedList` / `toggleBlockquote` without touching
`VIRGIL_ACTION_REGISTRY`, and the wrapper gate lived INSIDE that registry — a
module the `.extend()` factories and a card-body toolbar cannot import. Measured
on the pre-427 tree through the REAL stack:

- the **chords** destroyed an expex item (`toggleList` LIFTS the paragraph out
  of `exampleItem`; `\vxid` gone, example renumbered) and mangled a heading;
- the **toolbar** coerced a card body's `codeBlock` into `bulletList > listItem >
  paragraph` — its verbatim bytes now prose;
- the **input rules** did NOT destroy anything. Upstream's `wrappingInputRule`
  asks PM's own `findWrapping` first and declines. That half of the filed
  diagnosis is REFUTED and pinned as a CONTROL; the rules are routed through the
  door anyway so every surface answers from one table.

> **The gate lives in a LEAF the lowest surface can reach** —
> [src/lib/tiptap/wrapper-gate.ts](src/lib/tiptap/wrapper-gate.ts)
> (`wrapperSafeInState` = identity half `selectionIsListable` + container half
> `selectionHostsWrapper`, moved out of the two editor-coupled modules that held
> them; `text-object-registry` re-exports the container half). The `.extend()`
> owns the binding and the binding asks the predicate: `guardWrapperShortcuts` /
> `guardWrapperInputRules` wrap the PARENT binding, restating nothing about what
> triggers a wrap. A refused chord is CONSUMED (a disabled control does nothing);
> a refused input-rule match answers `null` (the typed characters stay text).

Three rules it earned:

- **The registry RECORDS the surfaces it does not own.** `assertActionCoverage`
  used to FAIL a format row claiming `typed`/`keyboard` ("its keybindings are
  owned by StarterKit") — true of the marks, false of the wrappers, and a guard
  that says a surface does not exist while it destroys examples is the
  "overstates its reach" class. The partition is renegotiated in place: WRAPPERS
  must claim both and carry `keybinding` + `inputRulePattern` (the latter
  imported from the extension that owns it, never re-spelled); MARKS claim
  neither. The record cannot drift from the binding because the suite presses
  the DECLARED keybinding through the real stack.
- **The card-body toolbar is the grid's twin**, so its buttons take `disabled`
  from the same door AND guard the click, via `useEditorState` with a packed
  primitive selector (O(depth) per transaction, React bails on an unchanged
  verdict).
- **The census discovers by SHAPE.** Every production `toggle*(` call must sit
  in a declaration that spells the door or be a `formatToggleRow` argument
  (whose builder is censused separately); every `.extend()` of the three nodes
  must spell both guard helpers; `findWrapping` may be spelled in ONE file; the
  gate imports nothing from `@/`. Allowlists EMPTY.

CI: [wrapper-surfaces-guard.test.ts](src/lib/tiptap/__tests__/wrapper-surfaces-guard.test.ts)
(real `buildEditorExtensions("main")`, typed one character at a time and keyed
through `handleKeyDown`) and
[rich-text-field-wrapper-guard.test.tsx](src/components/__tests__/rich-text-field-wrapper-guard.test.tsx)
(the REAL `RichTextField`, not the mock every panel suite installs). Measured by
neutering each half in turn: the chords take 6 legs, the toolbar 2, the input
rules the census alone (stated — that half was never destructive).

**Owed, not claimed:** the preview eyeball — caret in an `\ex` item, press
`Mod-Shift-8`, open the code view: `\vxid` still there. Not FSA-masked.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (schema + serializer,
no disk), so the check is cheap and real: put the caret in an `\ex` item, open
the bolt — Bullet/Numbered/Blockquote greyed, Display math and Image lit — then
check the code view.

#### The offer half: a surface that can REFUSE asks before it OFFERS

Same law, the fourth surface (task 398) — and the case where three of the four
action surfaces asked and the fourth committed the user's keystrokes first.

Grab asks per row (`DragHandleMenu`), lightning asks per row (task 397), typed
asks at its input rule (`math.ts`). The slash popup asked **nothing**:
`filterByPrefix` filtered `VIRGIL_COMMAND_NAMES` by typed prefix and rendered
the result, and `executeSelection` dispatched `tr.delete(slashPos, cursor)` as
its OWN transaction and called `cmd.action` afterwards. The action's `applies()`
bail — `runViewOnlyAction` for the pure-PM rows, the bridge's `runAction` for
the rest — then refused, *after* the characters were gone. Caret in a
`latexComment` / `codeBlock` / `titleField`, type `\forest`, press Enter: **seven
characters vanish, nothing is inserted, nothing is said.** The lightning grid's
forest cell is correctly greyed at the same caret, so two surfaces routing to
ONE `run()` disagreed about ONE gate — with the extra cost that this refusal was
**lossy** rather than merely silent.

> **A surface that can refuse ASKS BEFORE IT OFFERS, and asks the SAME question
> it will ask at the commit — so a refusal costs the user NOTHING.** The verdict
> is the registry row's own `applies()`, resolved through
> `SLASH_NAME_TO_ACTION_ID` and published by ONE door
> ([slash-applicability.ts](src/lib/tiptap/slash-applicability.ts)); the COMMIT
> is one door too (`commitSlashCommand`, beside the vocabulary both executors
> read), and it asks before it deletes.

Seven rules it earned:

- **There was a FIFTH surface, and finding it is what made the fix a fix.**
  `latex-command.ts`'s `virgilCommands` plugin is a second Enter-time executor:
  it matches a trailing `\name` and fires when the popup was never opened
  (dismissed with Escape, or suppressed by `isFreshPosition`). It carried its own
  copy of the same three steps and its own copy of the same DEFECT, so a fix to
  the popup alone would have closed the reported case and left this door eating
  characters in the very same containers with every behavioural test of the popup
  green. The door lives beside the vocabulary, not in either caller, for exactly
  that reason.
- **One CONTEXT constructor, or "the same question" is a hope.**
  `buildSlashActionContext` is what `runViewOnlyAction` builds its ctx with too;
  it was inline there, which is precisely why the popup had no way to ask the same
  question without re-deriving it.
- **One POSITION, and the two cannot disagree.** The offer is asked at the caret
  with the typed `\name` still present, the commit after the delete at `slashPos`
  — both inside the SAME textblock, because deleting text never changes a block's
  type or its container. Stated at the door rather than assumed.
- **The verdict is re-derived on every transaction while the popup is open**,
  including on the `tail === value.query` short-circuit: the caret can move and the
  block can change TYPE without one character of the query changing, and a stale
  verdict is the two-tables defect wearing the fix's clothes. It is derived from
  the transaction's NEW state (inside `apply` the view still holds the OLD one),
  with `view.editable` — a view PROP, not state — read off a per-editor captured
  view so CHIP 7b's collab gate reaches the OFFER and not only the run.
- **Greying beats hiding**, the choice both menus already made: a command that
  VANISHES reads as "Virgil doesn't have `\section`". Navigation skips greyed rows
  (initial selection and arrows), so the roving selection can only sit on a
  command Enter can run, and the arrows are inert rather than looping when every
  row is greyed.
- **The two doors END the gesture differently, deliberately.** The popup CONSUMES
  the key on a refusal — activating a disabled control does nothing, and the popup
  closes so the user's next Enter is an ordinary one — where the popup-less door
  returns `false` and lets an ordinary Enter through, because there is no offered
  row there to report a refusal on. Consuming is also what keeps a refusal from
  trading the eaten `\name` for a surprise paragraph split.
- **Keystroke sanctity is unchanged**: the plugin's `apply` returns O(1) while the
  popup is CLOSED, so no verdict work touches ordinary typing; the ~18 verdicts
  are O(depth) each and run only while the popup is open.

CI: [slash-popup-applicability.test.ts](src/lib/tiptap/__tests__/slash-popup-applicability.test.ts)
drives the REAL `SlashPopupExtension` inside the REAL `buildEditorExtensions("main")`
stack — the shipped `handleTextInput` / `handleKeyDown` props, typed one character
at a time, because a single `insertContent` never opens the popup at all. **No
pre-398 suite could see any of this**: every cross-surface suite calls
`COMMAND_MAP.get(name)!.action(view, …)` DIRECTLY, which is the destination the
popup reaches *after* its delete — so the delete, and therefore the whole defect,
is unrepresentable in all of them. The per-container expectation is DERIVED from
`VIRGIL_ACTION_REGISTRY` rather than hand-listed, so a future gate change moves
both sides. The leg with teeth is the CENSUS
([slash-commit-door-census.test.ts](src/lib/tiptap/__tests__/slash-commit-door-census.test.ts)):
the door was never the part that could misbehave, a private executor is, and
membership is DISCOVERED (the production files that IMPORT a runnable
`VirgilCommand`) with every allowlist EMPTY. It reads TWO views of each file —
strings KEPT for the needles that are quoted text, strings BLANKED for the symbol
needles, because `action-registry.ts` names `VIRGIL_COMMANDS` inside error-message
templates and would otherwise be indicted for prose.

Measured by neutering each half in turn: the pre-398 "never asks" surface takes 18
legs, the second door's private executor 2 behavioural + 1 census, the pre-398
navigation 2, the inline slash ctx 1 census, a door that deletes before it asks 1
census (plus every byte-identity leg), and a popup that ignores the verdict 1
census.

**Residual, stated rather than implied.** The delete and the action are still TWO
transactions, so a SUCCESSFUL command is two undo steps (Cmd+Z removes the
inserted block and leaves a document the `\name` has already left). Folding them
into one means threading a pre-built `tr` through every `cmd.action` — including
the bridge-routed rows, whose transaction is built later in React-land — which is
wider than this pass; the LOSSY half is what mattered. And the two bespoke
pre-gates in `commands.ts` (`\cite` / `\footnote`'s `blockKindAllowsAction` +
`posHostsInlineAtom`) stay as defence-in-depth: they cannot diverge from
`applies()` for the containers in play today, and if that coincidence ever breaks
the schema half must move INTO the row's `applies()` where task 396 put its
siblings, not be re-forked at the offer.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture,
no disk), so the check is cheap and real: caret in a `% comment` line, type
`\forest` — the row is greyed — press Enter, and the seven characters are still
there.

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

Known residual, unchanged by this and stated in the affordance half above: a refused position still paints an inviting bar and says nothing on release. Making refused positions unhoverable needs a predicate cheap enough for the per-frame hit-test (the plan is not — it builds transactions), so it is a product decision, not a follow-on. **CLOSED by task 416** — the predicate exists and is rungs 1+2 of the fit, which are pure schema arithmetic; see "The candidate half" immediately below.

#### The candidate half: a ROW is several positions, so resolve a SET

Same gesture, one question earlier (task 416) — and the case where three
special-cased resolvers each answered a slice of ONE question, and the residual
above turned out to be closable by asking that question properly rather than by
a product decision.

Gabriel, from a real paper: *"drag and drop within bullet pointed lists is an
absolute mess. do a full audit of moving things, in, out, over lists. practice
sequences of moves, etc."* Task 351 closed the PERFORMANCE half of the same
gesture; this is where things LAND and what the drag PROMISES.

Hovering the second item of a nested bullet list, every one of these is a legal
place for a dragged block: before/after the inner item, before/after the inner
LIST, before/after the outer item, before/after the outer list. The hit-test
answered "which SINGLE position is nearest?" with a fixed rule — the innermost
anchorable container (`resolveAnchorableBlock` honours `DEFERRING_PARENTS`), a Y
threshold at that block's TOP edge, and X read for nothing — then painted a bar
for whatever it collapsed to, whether or not the commit would accept it.

**And the headline defect was the one the report could not name, because it is
an ABSENCE.** `between-blocks` matches the GAP only (`placement-policy.ts`), and
a list has **no top-level gaps between its items**. The only thing that made a
list draggable at all was the R3 `resolveSubItemPeerBlock` pre-switch resolver,
which fires exclusively when the payload is ITSELF a `listItem`. Measured over
540 cells sampled inside a block's row — where the cursor is for essentially the
whole of a drag — the pre-416 rule offered **a bar in NONE of them**. Dragging a
bullet felt Notion-ish; dragging a paragraph, a heading, a figure or a `texBlock`
over the same rows produced nothing, anywhere.

> **A row is not ONE insert position; it is several. So the hit-test RESOLVES a
> candidate set, FILTERS it for legality against the payload, and CHOOSES from
> it with BOTH axes — Y the boundary at each level's own MIDPOINT, X the LEVEL.
> With the set filtered, a level the commit would refuse is never offered, so
> the false affordance dies by CONSTRUCTION rather than by a warning.**

[src/components/drop-mode/insert-candidates.ts](src/components/drop-mode/insert-candidates.ts)
is the ladder; [block-payload.ts](src/components/drop-mode/block-payload.ts) is
its input. Seven rules it earned:

- **The FILTER is rungs 1 and 2 of the SSOT the COMMIT already reads**
  (`fitNodeInContainer` — the parent accepts the bare node, or a wrapper in
  `buildWrap`'s vocabulary is both valid there and able to hold it). That is
  pure schema arithmetic and O(depth); it is **not** `planDrop`, which builds
  transactions and is exactly why task 321 called this a product decision.
  Reusing the ladder rather than re-deriving it is the whole point: the hover
  answers from the same table the release does, which is the law 258/321/332
  already state.
- **The payload is DECLARED, not inferred** — `DropSpec.blockPayloadFor`, the
  exact twin of task 414's `inlinePayloadFor`, resolved ONCE at
  `beginDropSession`. EMPTY is a legitimate ANSWER and three specs give it with
  a stated reason: a text SLICE merges into the prose (its inline reading is the
  caret, and a block bar over text would steal it), and a CARD anchors to a
  paragraph side. Which is precisely why it has to be declared rather than
  guessed — the reach over TEXT is a per-payload fact, and inferring it would
  have broken the two payloads whose whole design is the caret.
- **The FLOOR of the ladder is `resolveAnchorableBlock`'s answer**, deliberately
  — so "into this item as content" is not a candidate and the default (cursor
  deep in the text ⇒ deepest level) is byte-identical to the level the pre-416
  rule chose. The new reach is everything to the LEFT of that.
- **`snapToMidpoint` was a flag with ONE `true` call site**, which is what made
  a list read as a stack of after-targets for every other payload. It is deleted
  rather than defaulted: the midpoint is now the rule at every level, and on the
  gap-only path it survives — where the cursor is by construction OUTSIDE the
  block's box, the midpoint and the pre-416 top edge give the same answer.
- **X is monotone by construction and its right-hand limit is the old answer.**
  Deeper levels sit further right (a list indents its items by one marker band),
  so the rule is "the deepest candidate whose box the cursor has reached, else
  the shallowest". The bar's WIDTH already encoded the scope the hit-test chose
  (task 007) — so the user was SHOWN the level and could not CHOOSE it; the same
  encoding is now a live affordance.
- **One resolver where three sat.** The ladder SUBSUMES `resolveSubItemPeerBlock`
  (a peer-item boundary is simply the candidate whose container is the list, now
  reached for every payload rather than only a same-kind sub-item drag — which
  is what F4, its `node.type.name === sourceKind` gate, was). `resolveBlockIntoExpex`
  stays AHEAD of it deliberately: a vertical into-item bar with its own geometry
  is a genuinely different affordance, not another rung of the same one.
- **RESIDUAL, stated:** the filter runs rungs 1+2 and NOT rung 3 (the empirical
  `bareInsertIsSafe` probe, which builds a trial transaction and is O(doc) — it
  cannot run per frame). A candidate ONLY rung 3 would accept is therefore not
  offered: the conservative direction (a missing affordance, never a false one),
  and the one shipped rung-3 case is reached here by the WRAP rung instead.

CI: [list-drop-matrix.test.ts](src/components/drop-mode/__tests__/list-drop-matrix.test.ts)
is the audit, committed as an artifact rather than run as a session — **every
other suite in that directory drives ONE cell**, which is exactly how four
independent defects accumulated with all of them green. It drives the REAL
`hitTest` over a synthetic LAYOUT (jsdom answers an all-zero rect for
everything, so a layout model is the only way to ask a geometry question at all)
and then the REAL `planDrop`, over 540 cells = 4 sources × 9 target rows × 5 Y
fractions × 3 cursor X positions, plus four SEQUENCES whose `.tex` must be a
fixed point. Post-fix: **513 correct, 0 mis-landed, 0 corrupting**, and the 27
refusals are all the SELF-DROP (releasing a block back onto its own position,
which every spec declares a no-op and which has its own leg saying so). The
defect leg re-runs the identical sweep with `NO_BLOCK_PAYLOAD`, which IS the
pre-416 rule, and measures 540/540 no-target. The census in
[placement-reachability.test.ts](src/components/drop-mode/__tests__/placement-reachability.test.ts)
is the leg with teeth — the ladder was never the part that could misbehave, a
spec that offers a between-blocks bar and declares no payload is, and it would
type-check perfectly while silently keeping the pre-416 rule. Allowlist EMPTY.

**Found in passing, filed — and then REFUTED (task 426).** The filing reported
that a `bulletList`'s own `%!v:` anchor is emitted after `\end{itemize}` and
never harvested, so a whole-LIST uuid would not survive a save/reload. Measured
against the REAL `parseLatex` / `serializeBodyOnly` pair: **false.** The
`\begin{env}` dispatcher harvests the post-closer anchor unconditionally (task
342) and the list arm applies it. The filing's fixture spelled its ids `%!v:ul1`
/ `%!v:a` / `%!v:b`, which are **not anchors** — the grammar is exactly four hex
characters on BOTH readers — so they were never harvested on either side. No
read-side fix landed; what did is the durable half: a sweep per uuid-bearing
CONTAINER kind, DERIVED from `UUID_BEARING_NODE_TYPES` ∩ the real schema's
container types, two full cycles each, asserting every container-level uuid ATTR
by structural path plus a byte fixed point, with the filing's own fixture pinned
as a CONTROL so it is not re-filed. *A premise is checked before it is fixed.*

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — drag a paragraph into the
middle of a bullet list, drag a bullet out to top level and back, and drag a
bullet over a nested list at three cursor X positions.

##### The identity half: a landing that RENDERS IDENTICALLY is not a landing

Same ladder, the cell it could not represent (task 480) — and the case where
three specs carried the same guard, all three tested the same too-narrow thing,
and the suite's own classifier mirrored the narrow version, so the defect was
unrepresentable twice over.

Gabriel's seed symptom, reproduced live: *"grabbing and then dropping in the
same place — because you decided you didn't want to — should not change
anything."* Grab a bullet item's handle, wiggle ≤10 px, release at the grab
point, and the item was **EXTRACTED** out of its own list into a brand-new
single-item list with a freshly minted uuid. For a `bulletList` the corruption
is pixel-invisible; for an `orderedList` the numbering visibly restarts
(`c.` → `a.`).

Two mechanisms, and neither can reach the other's case:

- **the LEVEL band.** The grab handle sits in the MARGIN, LEFT of every
  candidate box, so `chooseInsertCandidate`'s fall-through hands the drag the
  SHALLOWEST level from the moment it starts — i.e. the band every gesture
  BEGINS in means "extract me to top level". (Pre-416 that same release hit the
  retired `resolveSubItemPeerBlock`, whose peer boundary WAS the item's own, so
  this is a 416 regression for the one X band no gesture can avoid.)
- **the GUARD.** `planDrop`'s self-drop test was `insertPos` inside the
  payload's own `[from, to]` — ONE level of a gap that exists at several. A
  `listItem`'s own visual gap line is also its LIST's boundary, and that list's
  item's, all the way out; every one of those is separated from the item's own
  boundary by nothing but ancestor tokens, so the guard missed, the adapter
  answered `wrap`, and `buildWrap` minted the list.

> **A landing is a NO-OP when it leaves the payload where the reader already
> sees it — which is two separate claims, because a gesture has two separate
> ways of going nowhere.** The MODEL rule: the insert position is the source's
> own GAP LINE (nothing but ancestor open/close tokens between it and the
> source's boundary) **and** the fit says `wrap`. The GESTURE rule: the pointer
> never left the point it was GRABBED at. Both are applied to the AFFORDANCE, so
> the bar is never painted at a landing the release refuses (tasks 258/321/332).

`src/components/drop-mode/self-drop.ts` is the SSOT for both. Seven rules they
earned:

- **The gap-line test is ARITHMETIC, and the arithmetic is exact rather than a
  heuristic.** Every unit step changes `$pos.depth` by at most ±1, so a span of
  N positions whose depth RISES by exactly N can only be N open tokens, and one
  whose depth FALLS by exactly N can only be N close tokens. Nothing else fits —
  and if every step is an open token, the nodes opened are BY CONSTRUCTION the
  ancestor chain containing the source, so there is no separate "are these MY
  ancestors?" question to get wrong.
- **The gap line ALONE is too strong, and the shipped `exampleItem` outdent is
  the proof.** Dragging the last item of a nested example list onto its parent
  item's boundary is the same gap line and is a real, tested, useful move. What
  separates it from the corruption is what the landing has to BUILD: where the
  container accepts the node DIRECTLY the item joins a different, existing
  container and visibly dedents; where nothing accepts it bare, the wrap rung
  FABRICATES the source's own parent KIND at the source's own indent, so the
  page renders identically while the list identity changes and the numbering
  restarts. **Same gap line AND `wrap`** — measured, the gap line alone fails
  that control. (The fit's verdict KIND is independent of the wrap vocabulary's
  ORDER, so this asks the same question `planDrop`'s own fit will, with no
  `prefer` to keep in step.)
- **WHOLE NODES only, and the scoping is load-bearing.** The rule presupposes
  the payload IS the node whose boundary the gap is. A text SLICE is not:
  moving the first three words of a paragraph into the gap immediately above it
  MATERIALIZES a new paragraph, which is a real change even though that gap is
  one open token from the range's `from`. So `text-range-move` declares no
  `sourceRangeFor`, keeps the narrow inside-the-range test, and says why at its
  own site — a false refusal of the commonest outdent-a-fragment gesture would
  be worse than the bug.
- **The MODEL rule cannot reach the reported headline, and no model rule
  could.** A MIDDLE item's list boundary has a real sibling between it and the
  source, so it is a genuine outdent. What is wrong there is the GESTURE, not
  the landing — which is why the dead zone is not a UX nicety bolted on but the
  second half of the law, owned ONCE by the content-drag terminal (the shape
  task 470 chose for the DIVIDER family) rather than restated per spec.
- **The dead zone is measured from the PRESS point, so it is plumbed.** A
  threshold-crossing producer only learns it has a drag at the first sample past
  the threshold, and with a fast pointer that sample can be far from the press —
  so `LiftOptions.grabOrigin` carries the mousedown and `beginDropSession`'s
  `origin` becomes it. Radius 10 px, sized from the producers' own thresholds
  (5 px grab handle, 8 px inline-atom grab): a gesture back inside the radius
  that STARTED it is, by its own producer's definition, no longer a drag.
- **…and it finally gives `DropSession.origin` a READER.** The field was written
  by every producer, documented as "used by ESC / leave logic", and read by
  NOTHING since the controller shipped — the dead-facet shape ("The field half"),
  WIRE-it-or-DELETE-it.
- **The source range is resolved ONCE per session** (`spec.sourceRangeFor`, the
  twin of `blockPayloadFor`), because it walks the document and nothing edits the
  document under a hold gesture. It carries its EDITOR, so a position in another
  document says nothing about this one.

CI: [self-drop-origin.test.ts](src/components/drop-mode/__tests__/self-drop-origin.test.ts)
(the arithmetic over the REAL schema, the wrap conjunction with its DIRECT
control, the dead zone through the REAL controller, and the census) plus a new
source's-own-row sweep in
[list-drop-matrix.test.ts](src/components/drop-mode/__tests__/list-drop-matrix.test.ts).
**That suite could not represent this**: its `TARGET_ROWS` never included the
source's own row, and its `selfDrop` classifier mirrored the same one-level test
`planDrop` carried — so "release at the grab point" was unrepresentable and a
near-self ancestor-boundary landing scored `correct`. Its leg *"the SELF-DROP is
the one no-op that still paints — and it is honest"*, which argued that closing
this "would need the hit-test to know the source's RANGE", is RENEGOTIATED in
place with the reason at the site: the hit-test knows it now. The leg with teeth
is the CENSUS — the predicate was never the part that could misbehave, a
controller that threads `null` where the session's range belongs is, and that
type-checks perfectly. Measured by neutering each half in turn: the pre-480
own-range rule takes 4 legs, the dead zone 3, the wrap conjunction 2 (one of them
the shipped nested-tier outdent control), a `null` threaded from the controller 1,
and a spec that drops its declaration 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — the dev doc's "List Torture"
section: grab `Beta` and `Nested numbered C`, wiggle, release at the grab point,
and nothing may change; then drag each deliberately to another gap and confirm
it still moves.

**Residual, stated.** The LEVEL band itself is untouched: the grab handle for a
level-N item still sits at an X the candidate ladder reads as level N−1 (or, for
a top-level list, left of every box and so "shallowest"), because the handle band
lies OUTSIDE the editor column that the ladder's thresholds are the left edges
of. Calibrating the X axis to the handle band is the deeper fix for *which level
the grab point means* and needs live geometry to size; the dead zone is what
makes the un-calibrated band harmless at the one X where it always bit.


##### The band half: the CONTAINER owns the gap's pixels, and the gap is not its boundary

Same ladder, the pixels BETWEEN the rows (task 481) — and the case where 416's
own harness could not represent the geometry, so a fifth defect sat inside the
fix for the other four with 540 cells green.

Audit 457, Gabriel's seed symptom 2: *"weird gaps behind elements that don't
correctly map the mouse position."* Reproduced live against a 3-level ordered
list at a fixed X inside the content, every band mis-mapped:

| what the cursor is in | what was offered |
|---|---|
| the band between an item's HEAD LINE and its nested list | a full row UP — "above the parent item" |
| the LOWER half of that same head row | still "above the parent item" |
| the band below a nested list, before the next item | past the next item's whole row |
| the band below the last item | the WHOLE-LIST bottom at top level |
| inside an ordinary single-row item | CORRECT — the controls pass |

One mechanism, and both halves of it are in the ladder's opening move.
`resolveAnchorableBlock` is a CONTAINMENT walk, so a boundary between two
`listItem`s is contained by no item and resolves to the LIST, and a boundary
between an item's head paragraph and its nested list resolves to the ITEM. The
ladder then walks OUTWARD only. So at exactly the "put it between these two
things" pixels there was ONE candidate — the container's own boundary — placed
by that container's SUBTREE-inclusive midpoint, which for an item carrying a
130px nested list is nowhere near the gap the cursor is in. No X could rescue
the level, which is why the audit's first reading ("paragraphs can never enter
lists") looked true and was not: the wrap vocabulary accepts
paragraph→`listItem` and `list-drop-matrix`'s own INV5 pins in-list paragraph
landings. The live symptom was entirely this.

> **A gap band's candidates come from the rows FLANKING the gap, not from the
> container that owns the pixels.** The ladder gains a rung BELOW the floor —
> the boundary between the floor's own block children — and it has two readings
> of one question: in a GAP, `posAtCoords` already answered and its index IS the
> boundary; IN TEXT, the boundary is decided by the cursor's own child's
> midpoint, the head ROW's band rather than the container's subtree box.

Six rules it earned:

- **The GAP reading costs no DOM read at all**, and that is what makes the
  offered boundary coincide with the visual gap line *by construction*: it takes
  the position the browser's own hit-test reported rather than re-deriving one
  from a midpoint that might disagree with it.
- **An IN-TEXT cursor is offered INTERIOR boundaries only, and that is task
  416's own decision preserved rather than an exemption.** The floor's leading
  and trailing boundaries ARE the floor's own edges — same gap line, and for the
  commonest shape by far (a `listItem` whose only child is its paragraph, a
  one-paragraph `blockquote`, an `exampleItem`) the same BAR, since
  `resolveContentEdges` descends a container to exactly that first child. They
  are already offered one rung out, where 416 put them. Offering them here would
  win the `rect.left` tie in `chooseInsertCandidate` (which resolves to the
  deeper level) and silently change the default landing of every list and quote
  drag to "inside the item" — from a bar the user cannot tell apart from the one
  they were already being shown. Measured: dropping the restraint fails 6 legs,
  two of them 416's own.
- **A cursor in a genuine GAP has no such twin, so its edge boundaries stay.**
  The outward rung there paints the container's own edge with the container's
  own span — a visibly different bar at a different indent ("a new item at the
  end of this list" versus "a new block after the list"), and X chooses between
  them exactly as it does at every other level. That asymmetry is why the
  tempting single structural rule ("interior only, always") is wrong: it closes
  the reported head-row case and re-loses the trailing band.
- **The interior-only rule is asked BEFORE the rect read**, from the child
  COUNT: a container with one child has no interior boundary whichever side the
  midpoint lands on. The rung therefore costs the commonest floor there is
  nothing — no forced layout per move for an answer already known.
- **The TRAILING boundary's reference row is the child BEFORE the gap.** A
  container's last boundary has no child AT its index, and the ladder's loop
  used to `break` there — so without that case the whole ladder returned nothing
  at the one band the audit's fourth row is about. Only the sub-floor rung can
  start there; an outward step always resolves to a position before an existing
  node.
- **The floor must actually CONTAIN the cursor.** `resolveAnchorableBlock`'s
  top-level-gap fallback picks the nearest block by Y-DISTANCE, which can be a
  block the cursor is nowhere inside; there is no child boundary to speak of
  there, and the doc-level boundary the ladder already starts from is the answer.

CI: [list-drop-matrix.test.ts](src/components/drop-mode/__tests__/list-drop-matrix.test.ts).
**No pre-481 cell could see any of this**, and the reason is the harness rather
than the cells: its synthetic layout stacked children GAPLESS (`BLOCK_GAP`
existed only between top-level blocks) and every cell sampled Y at a fraction of
a text ROW's own height, so a child-boundary probe was unrepresentable — 540
cells green over the whole class. The layout now carries the one band a list
really has (`.tiptap li > ul/ol { margin: 0.3em 0 }`; `li` itself is
`margin: 0 !important`, so plain rows stack gaplessly and there is no band
between them), laid out on BOTH sides of a nested list — which is what puts the
two sides in DIFFERENT containers, since the bottom margin collapses through the
item's zero bottom edge into the LIST's box. A premise leg checks that geometry
exists before any leg asserts a mapping over it. Measured by neutering each half
in turn: the pre-481 ladder start takes 5 legs (each naming the container it
wrongly offered — `bulletList` for the two head-row bands, `doc` for the two
below-nested ones), the interior-only restraint 6, and the pre-read fast path 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — hover-drag an item through
all four transition gaps of the dev doc's 3-level list and watch the bar track
the gap under the cursor.

**Residual, stated.** The rung descends ONE level, from the floor into its own
children, and stops. A gap line that several containers' boundaries coincide at
(the end of a nested list is also the end of its item, and of that item's list,
and so on inward) offers the floor's reading and the outward chain, not the
deeper ones — the conservative direction this file's own fit residual already
takes, a missing affordance rather than a false one. And the geometric twin the
interior-only rule is a structural proxy for is stated rather than computed: two
candidates whose bars are pixel-identical are one offer, and the proxy is exact
for every shape in the schema today.

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

##### The third producer: a terminal is owed to the GESTURE, not to the producer that first needed it

Same icon, the producer 332 did not reach (task 456) — and the case where the
Stack had three capture producers in design and two in code, with the missing
one wearing an accidental affordance that made it read as supported.

Gabriel: *"Dropping items on the stack is still not working. It darkens on
mouse over, but when you let go, the text dragged just pops out (as if you were
dragging to anywhere else outside the page)."* Grab a paragraph / heading /
list item / selection with the in-document grab handle, drag it onto the icon,
release: the text becomes a popped-out float sitting over the icon and nothing
lands on the Stack. `LiftHost.onUp` had exactly TWO terminals — ghost mode →
`commitDropSession()` (a doc move), popout mode → `popOutAtRect(…)` — and never
asked `isOverStackIcon`; `onMove` never called `setStackDropTarget`. A comment
in `StackIcon.tsx` recorded it as a deferred phase (*"Phase E and beyond may
emit MIME_TEXTOBJECT from TextObjectGrabHandle … we'll wire the consumer here
then"*), which is how the gap outlived the two tasks that drained its siblings.

**It darkened anyway, and that is the finding rather than a detail.** The lift
overlay is `pointer-events: none` (the content-drag click-through law), so the
button underneath kept receiving `mouseenter` and painted its ordinary hover
background. The hover OFFERED and the commit REFUSED — the false-affordance
class 258/321/332 each closed — surviving here because the offer was an
**accident of plain hover styling** rather than a deliberate ring. No census
could see it: every guard in this cluster asks about a ring, a capability or a
door, and none asks what a button's REST chrome says while something is being
dragged over it.

> **A capture TERMINAL belongs to the gesture family, not to the producer that
> first needed one: every producer enters ONE terminal, and the terminal
> REPORTS.** And an icon that is a drop target owes the same two-sidedness its
> ring does — during a content drag its ordinary hover chrome says nothing, so
> the only signal it gives is the true one.

Six rules it earned:

- **The terminal moved OUT of the window listener** into
  `EditorPane.captureKeyToStack` — the capability+resolve+serialize door
  (`captureFloatToStack`, 332), the bib-carrying add door (`addStackItem`,
  235), open the strip — and BOTH producers enter it. What each producer does
  NOT share is how it retires its own source surface: the float closes its
  popout, a lift tears down its overlay. That line is why the close stayed at
  the call site.
- **The lift gets a PROP where the float gets a window event, and the
  difference is the REPORT.** `FloatingPanel` is a low-level shell mounted far
  from `EditorPane` with no context path, so its capture has to travel as a
  global `virgil-stack-drop` event and cannot be told whether it landed.
  `LiftHost` is mounted BY `EditorPane`, so `onCaptureToStack` hands the report
  back — which is exactly what lets a REFUSED capture (a source deleted
  mid-gesture) fall through to the popout terminal instead of eating the
  gesture. Fire-and-forget would have forced the pre-332 shape back.
- **ONE capability, ONE geometry predicate, read by both halves.**
  `canCaptureToStack(cardKey)` is resolved ONCE at gesture start (a registry
  read whose answer cannot change mid-gesture — the rule `stack-capture.ts`'s
  own header states, and `resolveSessionPlacements`' reason); the ring in
  `onMove` and the branch in `onUp` then differ only by which event's
  coordinate they pass to `isOverStackIcon`.
- **The stack branch is read FIRST, ahead of both existing terminals, and the
  ORDERING is the hover≡commit guarantee.** Wherever the ring was lit, releasing
  captures — including the narrow-window geometry where the icon overlaps the
  content zone and a content-first read would instead commit a doc move the
  user was never offered.
- **The ring clears in `cleanup()` — the ONE end path every ending funnels
  through** (capture, popout, move-commit, doc-leave, Escape, and the
  missed-release bail, which returns without ever reaching `onUp`). Cleared per
  terminal instead, a swallowed mouseup leaves the ring lit with no gesture left
  to accept it.
- **Scoped to the `"grab"` policy, stated rather than assumed.** A `"float"`
  lift is driven from a float that is ALREADY open, and that surface has its own
  Stack terminal — dragging its HEADER onto the icon, which CONSUMES the float.
  Giving its drop-button ghost a second terminal with COPY semantics would put
  two answers to "what does releasing this float on the Stack do?" in front of
  the user; that is a product question, not a wiring gap.
- **Capture is a COPY**, matching float capture (a captured text-object float
  leaves the doc text in place) and stack-pull's paste-as-new. Cut-to-stack is
  one call at the site if Gabriel wants it.

CI: [lift-stack-capture.test.tsx](src/text-objects/__tests__/lift-stack-capture.test.tsx)
drives the REAL `beginLift` gesture (threshold → move over the icon's published
rect → mouseup) for a paragraph lift and a `linkedRange` selection lift, with
the two CONTROLS that keep it honest — a release away from the icon still pops
out, a release over content still commits the move. **No pre-456 suite could see
any of this**: `stack-capture-affordance` drives the REAL `FloatingPanel`
gesture and is blind to the lift by construction, and every lift suite in the
repo drives a gesture with **no icon rect published at all**, where
`isOverStackIcon` is false everywhere and the terminal is unrepresentable. The
leg with teeth is the CENSUS in `stack-capture-affordance` — the terminal was
never the part that could misbehave, a second private capture site inside
`LiftHost` is, and it would type-check, ask no capability, carry no bib and
report to nobody: `LiftHost` may spell none of `captureFloatToStack` /
`snapshotForStack` / `snapshotTextObject` / `addStackItem`, and the prop must be
handed the shared terminal. Its two pre-456 legs are RENEGOTIATED in place with
the reason at the site (they pinned the handler ITSELF as the one capture site,
true only while the float drag was the only producer with a terminal). Measured
by neutering each half in turn: the `onUp` terminal takes 3 legs, the ring 2,
the `cleanup()` clear 2, the hover suppression 1, and dropping the prop 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live pointer
gesture, a localStorage stack), so the check is cheap and real — lift a
paragraph onto the icon, watch the ring light, release, and see the strip open
with the item; release elsewhere and the popout is unchanged.


#### The vocabulary half: an exemption is scoped to the shape it justifies

Same gesture, and the case where the law was already written, already enforced, and enforced in a place two call sites had a written licence to skip (task 328). Rule 4 of the move half above — *a payload arrives in the target's vocabulary or not at all* — lived **inside** `fitNodesAtInsert`, as a private helper reachable only by going **through** the container fit. Two splices are deliberately exempt from that fit, each carrying a `container-fit-exempt:` marker whose stated reason is *"an open slice merging with the text around a caret… no container is being entered"* — a true statement about **containers** and a false one about **vocabularies**. Because the adoption sat in the same function, the exemption silently bought an exemption from it too.

The cost is the worst outcome this whole section legislates against, and it is silent at every layer. A lifted selection — or a footnote/citation card's marker — released at an inline caret **inside a card body** was spliced with nodes built from the SOURCE schema. Two `Schema` objects built from the same extension list hold **distinct `NodeType`s**, and ProseMirror's `Fitter` compares them by identity: it `dropNode()`s the payload, `replaceStep` returns null, and `Transform.replace` appends **no step at all** — `steps: 0`, `docChanged: false`, no throw. The move's *second* transaction, the unconditional source delete, then ran. Prose gone from the document, nothing in the card, `selectInserted` highlighting a run of the card's own pre-existing text so the drop looked successful. For the atom it also destroys the footnote's **body**, which is the atom's `content` attr and lives nowhere else. This is task 321's "it worked and then vanished" one level deeper: there the document was merely untouched; here it is damaged.

> **Adoption is an obligation SEPARATE from fitting, and so is the report.** Every splice that can receive a payload from another editor re-hydrates it through the TARGET's schema and REFUSES when that schema cannot represent it; and a relocation dispatches its source delete only on **evidence the insert landed**, never on the absence of a throw.

[src/components/drop-mode/schema-adopt.ts](src/components/drop-mode/schema-adopt.ts) is the SSOT — `adoptNodeIntoSchema` / `adoptSliceIntoSchema` (same schema ⇒ the same object by identity, zero cost; foreign ⇒ re-parse or `null`) and `insertLanded`. `fitNodesAtInsert` calls the first, so nothing on the fitting path changed; the exempted splices call it directly. Five rules it earned:

- **An exemption is scoped to the shape it justifies** — task 204's rule, arriving here from the other direction. There the finding was a census exempting a whole category on ergonomic grounds; here it is a marker whose author was right about the question they were answering and silent about the one they weren't. The generalizable half: **when an exemption's reason names a specific mechanism ("no container is entered"), check what ELSE that mechanism happens to gate.** The two questions now carry distinct markers (`container-fit-exempt:` / `schema-adopt-exempt:`, joined in task 414 by `inline-host-exempt:`) precisely so none can answer for another.
- **The two nets are independent, and the second is not a corollary.** `Slice.fromJSON` / `Node.fromJSON` validate the **vocabulary** — an unknown node type or mark throws — and say nothing about the **content expression**, so a payload the target can NAME but cannot HOLD still reaches the fitter and is still swallowed. `insertLanded` (steps > 0 **and** growth ≥ the payload) is the same rule `restoreExcerptAtCaret` earned in "The return half", for the same reason: `replace` / `insert` / `insertContent` all swallow a mismatch, so `void` looks identical for "landed" and "destroyed". It is deliberately redundant — it catches the next swallowed splice even if someone adds one without adopting. Its stated limit: it reads a NET growth, so it is meaningful only for an insert-ONLY transaction, which is exactly the cross-editor shape.
- **Adopt ABOVE the same/cross fork, not inside it.** `text-range-move` resolves the payload once before it asks which editor it is talking to — the same-editor answer is the identical slice by identity — so the obligation is unconditional rather than a branch someone has to remember, and the census's declaration-level region honestly vouches for both splices instead of one branch vouching for its sibling.
- **A refusal only `applyDrop` can see is the task-321 defect.** `inlineAtomMoveSpec` is one of the two specs allowlisted out of the `plannedDropSpec` derivation on the ground that its doors are "symmetric by construction"; adding a refusal to one of them would have retired that ground. Both doors now derive from ONE pure `resolveDrop` (`create` | `move-within` | `move-across`), which is what makes the allowlist entry true rather than merely traditional. The cross-editor insert transaction is BUILT there, where the answer can still be `null`; `commit` only dispatches it and then deletes the source.
- **Moving a transaction onto the CLASSIFY door moves a THROW there with it** — the trap `planned-spec.ts` had described as unreachable, made reachable by this very fix and caught by the adversarial pass on it. `Transform.replace` resolves both positions (`RangeError` on a stale `placement.pos`) and `Transform.step` throws `TransformError` on a step that fails to apply; a hit-test position recorded on the last throttled mousemove can be stale by mouseup if the target card body shrank under it. `applyDrop` is caught by `finishApply`; `classifyDrop` is called BARE inside the controller's `async commitDropSession`, whose callers `void` it with no `.catch` — so an escaped throw becomes a rejected promise that never reaches `endDropSession()`, leaking the window listeners, the `data-drop-mode-active` body attr and the lift overlay past mouseup. So the containment is EXPORTED (`refuseOnThrow`) rather than re-derived, the hand-written spec wraps its RESOLUTION (not each door, so a third door cannot forget), and `planned-spec.ts`'s "no such throw is reachable today" sentence was retired rather than left standing. **An entry on `PERMITTED_HAND_WRITTEN_DECISIONS` is a claim about AGREEMENT between the doors, never about safety** — its allowlist reason now says so, because this fix is what proved the two are different claims.
- **The census is the leg with teeth, and it needs TWO editors to have any.** The primitive was never the part that could misbehave — a call site that doesn't ask it is. So [container-fit-guardrail.test.ts](src/components/drop-mode/__tests__/container-fit-guardrail.test.ts) asks two questions over the same splice-site family (*did you fit?* AND *did you adopt?* — a THIRD, *did you ask the INLINE container?*, joined them in task 414), with the adoption exemptions allowlisted **per LINE** — a file-scoped list would excuse the next splice added beside them, and two of the three entries live in the very file whose cross-editor splice was the defect. Measured on the pre-fix tree, it names all three defect sites. The behavioural half ([cross-editor-adoption.test.ts](src/components/drop-mode/__tests__/cross-editor-adoption.test.ts)) builds **two genuinely distinct `Schema` objects**, which is the reason no existing suite could see any of this: every one of them builds ONE schema and hands the same object to both editors, where the splice is native by construction and the defect is unrepresentable.

**Reachability, stated honestly rather than implied.** Narrow today, and a reason to price it below "urgent" rather than to leave it: the target must be a REGISTERED drop-target editor other than the main one (only `RichTextField` card bodies register — `BorrowedMainText` does not), expanded and editable; it must be hit-testable during a drop session, and `globals.css` makes every `[data-floating-panel="true"]` subtree `pointer-events: none` while one is active, so the reachable surface is the omni column; and the body must contain a node DECLARING a `uuid` attr, since `hitTest` bails when `resolveAnchorableBlock` returns null and card-body `paragraph`/`heading` carry none. A note with display math, or an archived excerpt holding a figure, is enough. The same two lines are also a **latent trap** — anything that registers a second drop-target editor, or gives card bodies uuid'd paragraphs, widens this to every card body at once.

#### The sequence half: a gesture's EXIT STATE is the next gesture's INPUT

Same gesture, the second time you perform it (task 482) — and the case where
every piece behaved as designed and the *composition* of two of them was
nobody's job.

A between-blocks block move ended with `selectInsertedSpan`, "so the user sees
where the payload landed": a non-empty TextSelection over the moved block's own
content. The grab-handle resolver gives a live non-empty TextSelection ABSOLUTE
priority over the hovered block, so the one handle at that row became a
SelectionRef — the block's own handle GONE, replaced within ~6px of where it
was. A SelectionRef lift hydrates a transient `linkedRange`, which
`lookupSpec` routes to `textRangeMoveDropSpec`, whose placements include
`inline-cursor`. So over text the inline caret wins, and that branch splices the
run MID-WORD into the target and deliberately sheds no shell.

Measured live on a flat 4-item bullet list, deterministic: drag Beta below
Delta (a clean reorder, uuid conserved), then grab "Beta" again at the same
visual spot and release it 6px into Gamma's first text line — the natural "put
it back on that row" aim. Beta's TEXT lands inside Gamma's word
(`Gamm⟨Beta flat bullet two.⟩a flat bullet three…`) and Beta's `listItem`
survives as an EMPTY husk still carrying its uuid: an invisible blank bullet
that every anchored card and marker now points at, two undo steps to recover.
**From the baseline state the identical gesture at the identical pixel is a
clean no-op.**

> **A gesture's exit state is read by the NEXT gesture as user intent, so it is
> stated in the vocabulary of what MOVED — and "here is what landed" is a VIEW
> signal, not document state the next gesture should consume** (the transient-
> state law, task 120, arriving in the selection instead of in a mark).
> Beside it, the RESOLVER's own rule: **a text lift is a PARTIAL range.** A
> selection covering exactly one textblock's whole content is a statement about
> that BLOCK, whoever made it.

Two halves, and each closes the reported repro on its own — deliberately, since
the commit is only ONE producer of a whole-block selection:

- **The exit state.** `selectInsertedSpan` → [`placeCaretAtLanding`](src/components/drop-mode/util/mapped-insert.ts):
  a collapsed caret at the start of what landed. Every caller of
  `insertNodesAdvancing` splices whole NODES, so a selection over its span was a
  statement about blocks made in the vocabulary of text. The resolver's rule 1
  requires `from !== to`, so it cannot fire at all.
- **The resolver.** [`resolveSelectionGrab`](src/text-objects/selection-payload.ts)
  — `wholeBlockSelection` first, `SelectionRef` only for a genuinely partial or
  multi-block range. It covers the other producers: a triple-click, a `Cmd+A`
  inside one block, a text-range move that landed as exactly one new block.

Six rules they earned:

- **A `NodeSelection` on the landed node was the obvious "what moved" answer and
  is WRONG here, for a reason worth writing down**: prosemirror-view's base
  stylesheet is not loaded in this app, so `.ProseMirror-selectednode` is
  unstyled for every kind but `latex-comment`/`expex-block` — a node selection
  would be visually INVISIBLE *and* would add `ProseMirror-hideselection`, i.e.
  strictly worse feedback than a blinking caret. `texBlock`/`forestBlock` also
  declare `selectable: false`, so it could not have been uniform anyway. If the
  "here is what landed" flash is wanted back it belongs in a DECORATION with its
  own clear, never in the selection.
- **The contrast is the rule, not an exception.** `text-range-move`'s
  inline-cursor branch keeps its own `selectInserted` text selection: what
  landed there IS text inside an existing block, so a text selection states it
  truthfully — and the next drag at that pixel is then a text drag, which is
  what moved.
- **The owner is the uuid-bearing ancestor, never the textblock itself.** A
  `listItem`'s inner paragraph carries no uuid (`DEFERRING_PARENTS`), so the
  walk that both ladders already ran is what answers — `selectionOwner`, written
  twice before this and read from one place now.
- **The two ladders stay DIFFERENT, and that is stated at both sites.** The grab
  handle resolves a DRAG PAYLOAD; `active-text-object-context`'s
  `resolveFromSelection` resolves an ANCHOR TARGET for the menus. Whether a
  triple-click over a whole paragraph should mint a Mode-B `linkedRange` or a
  Mode-A paragraph anchor is a product question with no reported symptom, so
  only their shared ancestor walk was unified.
- **`from === to`, not `sel.empty`.** Identical on a real `Selection` (`empty` is
  a getter over exactly that comparison) and the spelling both ladders already
  used — which is what a hand-built fixture can satisfy. Measured: switching to
  `sel.empty` crashed three suites whose stub selections are plain objects.
- **The predicate is offset-EXACT at both ends**, so a one-character-short
  selection is still a text lift. A "close enough" rule would silently convert
  deliberate near-whole-block text drags into block moves.

CI: [drag-sequence-payload.test.tsx](src/components/drop-mode/__tests__/drag-sequence-payload.test.tsx)
drives TWO REAL commits back to back through the REAL spec against a REAL
schema, with an editor stub whose `dispatch` APPLIES — **no pre-482 suite drove
two gestures in a row**, because every drop-mode fixture builds one pristine
state, plans one drop and reads the transaction it *would* have dispatched, so
the sequence class is unrepresentable in all of them. Its defect leg
reimplements the RETIRED exit rule locally rather than re-parameterising the
live one, and the component legs read `data-grab-owner-kind` off the REAL
handle. Measured by neutering each half in turn: the retired exit rule takes 4
legs, the whole-block rule 3, and the six control legs (a partial selection, a
two-block selection, a caret, a node selection, both offset ends) pass either
way and say so.

**Residual, stated rather than implied.** Pulling an item to top level MINTS a
`bulletList` around it (content `listItem+`); moving it back cuts that list's
sole child, so ProseMirror keeps an empty `listItem` residue — a visible empty
bullet in a container nothing else occupies. It is NOT the reported class (the
residue carries no uuid, so nothing points at it) and closing it is task 320's
SHED question one level up, where `AGENTS.md` is already explicit that "the
schema permits it" is not "it was residue" — a container-level shed has to
answer for `alignedGlossRow`, `heading` and `titleField` first. Pinned as its
own stated leg rather than left to be rediscovered.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture, no disk), so the check is cheap and real — the dev doc's list torture
fixture, the exact two-move repro.

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
- **A card action is a CONTEXT, not a prop.** [card-restore-actions.tsx](src/panels/_shared/card-restore-actions.tsx) mirrors `card-archive-actions.tsx`: `EditableCard` consumes it directly, so the wiring cannot dead-end in a component that forgot to read it. Types prove a prop was *passed*; nothing proves it was *used*, and the panel that drops it type-checks exactly like the panel that renders it. CI: [dead-panel-prop-guardrail.test.ts](src/panels/__tests__/dead-panel-prop-guardrail.test.ts) flags any `*Props` member with no second occurrence in its own file — `src/panels/**` is drained to EMPTY; the pre-existing host-layer census is pinned so it can only shrink. A hit is WIRE-it or DELETE-it, never an allowlist entry. Its ROOTS are `src/panels` + `src/components` — widened by task 441 to the editor-layout silo and by task 479 to the panel CHROME the whole silo mounts (`panel-primitives.tsx`, `EditorPane.tsx`), which was in neither root although task 182's entire finding was dead props inside it. The walk skips a TYPE-ONLY module (types out, no value export) rather than just a `.d.ts`: a `.ts` type SSOT declares a shape for consumption elsewhere, so the member rule — *does this occur a SECOND time in its own file?* — is not a question it can answer, and allowlisting its members one by one is what this guard's own header calls the wrong answer.
- **The report is the permission.** [`restoreExcerptAtCaret`](src/lib/tiptap/restore-excerpt.ts) validates against the **live** editor schema (the dual of `canMountInCardBody`) and then checks the document actually changed — because `insertContent` swallows a mismatch exactly as `createNodeFromContent` does, so `void` looks identical for "restored" and "destroyed". `useArchive.restoreSnippet(id, land)` **takes** the landing function rather than returning the snippet, so there is no ordering for a caller to get wrong; the two old handlers dropped the entry either side of a call that could silently no-op.
- **AT the caret, never OVER a selection — and only where a split is ordinary.** `insertContent` replaces a non-empty selection, so restoring with prose selected would delete that prose (the same destruction, aimed at a different victim); anchoring at `selection.to` makes it purely additive. And a caret insert *splits the block it sits in*, which is ordinary editing in a top-level `paragraph` and silent corruption everywhere else — inside an `exampleItem` it splits the example in two, inside a `glossCell` it destroys the interlinear alignment, inside a `heading` it mints a phantom section — all of which still change the document, so the landed-test reports SUCCESS and the caller retires the only copy. This door is invisible to `container-fit-guardrail` (which censuses `src/components/drop-mode/`), so it carries its own check: refuse unless the caret is in a plain top-level paragraph. Conservative by choice — a rule verifiable by construction over a probe that must be trusted; the general form is `bareInsertTearsContainer` parameterised by the depth that may split, worth folding onto one primitive at the second caret-shaped splice.
- **Retiring is SET-ASIDE, not delete.** The document insert is an undoable history entry; the sidecar write is not. Delete the entry and the user's next Cmd+Z — the natural key when an excerpt lands somewhere unintended — pulls the prose back out of the document with nothing left in the Archive: gone from both, no undo remaining. So the card flips `archived` (the reversible per-card axis every kind already has). The same choice drains the durability race, since the sidecar's 300 ms write no longer outruns the document's 1500 ms autosave into a window where a crash loses both halves.

**Two doors, one queue** — the persistence half, and the reason the bug had a second life. `usePersistentState` exposes `update()` (coalesced through a 300 ms debounce) and `persist()` (write now), and only the first owned the queue: an immediate write could be OUTLIVED by an older scheduled payload, which flushed afterwards and **resurrected on disk** what had just been removed, with in-memory state and the sidecar permanently disagreeing until the next edit. That is a PRIMITIVE hazard rather than one caller's slip — it is inherent to two write doors where one owns the queue — so `persist()` now cancels the pending timer and drops the stale payload, once, for every caller, and stamps the loader-stomp flag *after* the two guards that can make the write not happen (stamping it for a suppressed or dropped write would hide the sidecar for the whole session). Scope, stated honestly: the sidecar hooks with their own bespoke `persist` (`useFootnotes`, `useExamples`, `useAiRequests`, `useBibReview`, `useStack`, `useEditorUIState`) do **not** go through this door; among this hook's consumers only `useSuggestions.clearSuggestions` still calls it directly. Prefer `update()` regardless; `persist()` is for a read-then-write that needs the computed value back synchronously, and it cancels rather than merges, so its payload must already reflect any `update()` issued before it. Contracts: [archive-restore-contract.test.tsx](src/hooks/__tests__/archive-restore-contract.test.tsx), [restore-excerpt.test.ts](src/lib/tiptap/__tests__/restore-excerpt.test.ts), [card-restore-affordance.test.tsx](src/components/__tests__/card-restore-affordance.test.tsx).

#### The re-parenting half: the NET may state what the STEP already said

Same law, the gesture that produces it most (task 499) — and the case where the
law was written down, was correct, and had ONE consumer.

`node-identity.ts` says *a move conserves identity, a split mints it*, and its
only production reader is the drop-mode text-range move. **No keyboard or menu
structural gesture declared anything.** Shift-Tab is upstream TipTap's
`liftListItem`, reaching the editor unmediated (`tab-indent.ts` deliberately
leaves Shift-Tab alone; task 427's wrapper gate covers only the parents'
`Mod-Shift` chords), so on a lift the `listItem`'s uuid — the text object every
card / todo / report / marginalia marker / sidecar entry was keyed on — simply
LEFT the document. Measured through the real stack, on the shape Gabriel
reported twice:

```
bulletList#L1 > (i1 "A") (i2 "B")     ← the list, minus its last item
paragraph#i3("")                       ← the resurrection guard's EMPTY husk
paragraph#70f2("C")                    ← the user's text, a stranger
```

Three mechanisms compounding, none of which throws: the ITEM's identity leaves,
`BlockUuidBackfill` — which could only MINT — gives the lifted paragraph a fresh
id, `TextObjectOrphanGuard` fires and the hooks permanently strip `links[]`, and
for a margin-anchored item `MarginaliaAnchorGuard` puts the old uuid back on an
empty paragraph above the text (task 367's `resurrectionWouldBeANoOp` stand-down
does not apply — what vanished was content-bearing). Verbatim the report: *"that
text is not properly placed as a text-object."*

> **A NET may state an identity where the STEP already said it.** The blindness
> `node-identity.ts` names — *a net can only tell that two blocks collide, not
> which one the user meant to keep* — is about a delete-HERE / insert-THERE pair
> in two SEPARATE steps, where nothing links them. A `ReplaceAroundStep` links
> them BY CONSTRUCTION: its GAP is content preserved and merely re-PARENTED, and
> its prefix `[from, gapFrom)` is the container tokens stripped off the front of
> it. So the net asks ONE question — **what happened to the gap content's
> PARENT?** — and answers it without guessing.

Two directions, each read where it is visible
([block-uuid-backfill.ts](src/lib/tiptap/block-uuid-backfill.ts)):

- **A container that DISSOLVED hands its identity to its successor** — step-shaped
  (`planReparentTransfer`). *stripped + a FRESH parent inserted* ⇒ **RETYPE**
  (bullet ⇄ numbered: the same list, differently rendered); *stripped + no new
  parent* ⇒ **UNWRAP** (Shift-Tab, the Backspace lift branch, toggle-list-off,
  blockquote-off): the promoted content's FIRST block inherits; *neither* ⇒
  nothing (a mid-container split-lift — the container survives as the head half).
- **A block that STOPPED BEING A TEXT OBJECT hands its identity up** —
  result-shaped, so it needs no step at all: a `paragraph` that is now a DEFERRED
  inner paragraph still carrying a uuid has an identity nothing can reach
  (`anchorableUuidAt` skips it, `assignUuids` strips it on the next save), so if
  its container is BARE the container takes the id and the block is cleared.

Seven rules they earned:

- **Read the STRUCTURE, not the gesture, and one rule covers every surface** —
  the Shift-Tab keymap, the Backspace lift branch, the lightning grid, the slash
  command, the `Mod-Shift` chords, a card-body toolbar and anything added later
  — because the net sees the TRANSACTION. That is also why direction 2 is
  result-shaped rather than step-shaped: `wrapInList` over two paragraphs wraps
  the first in its `ReplaceAroundStep` and mints the SECOND item with a plain
  `tr.split`, which carries no gap to read. A step-shaped wrap rule conserves one
  of the two; the result-shaped one conserves both, with the same line.
- **The retype arm requires a TYPE CHANGE, and that gate is load-bearing.**
  `tr.setNodeMarkup` is itself a `ReplaceAroundStep` of exactly the retype shape
  (`gapFrom = from + 1`, `insert = 1`), so without it every in-place attribute
  write reads as a re-parenting — and a deliberate write of `uuid: null` is
  silently undone by handing the old id straight back. A same-type in-place write
  is the caller's own statement about that node.
- **A PRESERVATION GUARD MAY NOT RESURRECT A CONTAINER THAT DISSOLVED**, and
  that is the half the fix does not work without. `MarginaliaAnchorGuard` gains
  EXCEPTION 3 (`dissolvedByReparent`), the sibling of task 367's EXCEPTION 2:
  there the resurrection reproduced the removal (a silent veto of the gesture),
  here it contradicts it — and *wins*, because the net then sees the id live and
  mints the stranger beside the husk. Both halves are needed: measured, the
  transfer alone fixes only the un-anchored case, which is the case the reported
  one is not.
- **The guard's question is deliberately WEAKER than the transfer's, and that is
  what makes the two consistent BY CONSTRUCTION rather than by agreement.** The
  first cut keyed the stand-down on a planned TRANSFER and was wrong twice, both
  measured (review-caught): a last-item lift dissolves the `listItem` **and** the
  `bulletList`, and one node holds one id — so the list still husked, right above
  the user's lifted text, which is the reported symptom surviving the fix; and a
  transfer whose receiver turns out to be a deferred inner paragraph is PLANNED
  and then dropped at the landing site, so the guard stood down for a transfer
  that never landed. Asking only *did this identity's container dissolve?*
  removes both, because it needs no agreement with the net at all. What a
  declined resurrection costs is stated at the door: the card moves to the pod
  header's "N unanchored" chip (task 410) — the designed home for an anchor-less
  card, and strictly better than an empty line wearing its identity.
- **…and the predicate is computed from the transactions' OWN steps**, never from
  either plugin's output. That is what makes it independent of where each sits in
  ProseMirror's `appendTransaction` chain.
- **Every verification of the MINT half FAILS OPEN** — a receiver that is not a
  bare anchorable node, a donor that no longer holds the id, a freed uuid
  something else in the batch re-created, a mapped position that drifted: each
  falls back to the fresh mint that shipped before. A missed transfer is the
  status quo; a wrong one is a duplicate. Scoped to the mint half deliberately,
  because the GUARD half is not a fallback to pre-499 behaviour and saying so
  would overstate it: a dissolved container is not resurrected at all, and its
  card orphans to the chip.
- **UNDO takes the structure back and not the transfer, so the invariant needs
  one more line — found by driving undo, not by inspection.** The net's own
  writes are `addToHistory: false`, so the inverted lift step re-wraps a
  paragraph that by then carries the item's id inside a restored item that
  carries it too — and a deferred inner paragraph is never a candidate, so the
  duplicate rule cannot see it. *A container and its OWN deferred body paragraph
  can never both answer to one id*, and the container is the text object, so the
  paragraph is cleared. A container holding a DIFFERENT id keeps it and the
  paragraph keeps its unreachable one: nothing bare is there to hand it to, the
  serializer will strip it anyway, and clearing would destroy it a save early.
- **Keystroke sanctity is untouched**: the direction-1 pass sits BEHIND the
  `candidates.length === 0` fast path and bails per step on `instanceof
  ReplaceAroundStep`, which plain typing never produces; direction 2 is a
  two-condition test inside a walk the plugin already does, with its O(depth)
  `resolve` reached only by a paragraph that is deferred AND uuid-bearing — a
  shape that exists only just after something wrapped it.
- **Two bonus members came out of the same rule**, neither reported. `toggleList`
  bullet ⇄ numbered re-types the container in place, and pre-499 the new
  `orderedList` got a stranger's id while every card anchored to the list
  orphaned. And `setBlockType` — the Heading action and the heading-strip demote
  chip — mints a BARE node of a different type around the same content, which is
  the retype shape exactly, so paragraph ⇄ heading now keeps the block's id.
  That second one is *declared* rather than left to be rediscovered: the
  enumerated gestures above are all lists and quotes, and TipTap's own
  `toggleHeading` / `toggleCodeBlock` PRESERVE attrs, so nothing in the list
  vocabulary pointed at that path (review-caught).

CI: [reparent-identity-conservation.test.ts](src/lib/tiptap/__tests__/reparent-identity-conservation.test.ts)
drives the REAL `buildEditorExtensions("main")` stack through `handleKeyDown`
and the shipped command chain — a direct `tr` dispatch cannot see which command
a keymap chooses (task 418's lesson) — over Shift-Tab × {only, first, middle,
last, multi-block item, multi-item selection} plus every other surface, keying
identity by STRUCTURAL PATH (task 348: a steal reads as two changed paths, a
re-mint as one) and asserting the husk and the orphan EVENT as well as the id.
**No pre-499 suite could see any of this**: `block-uuid-backfill.test.ts` covers
the lift through a synthetic two-node blockquote schema and *asserted a fresh id
as the contract* (renegotiated in place there, with the reason at the site);
`listItem` appears in it once, in a comment; and nothing anywhere drove a real
Shift-Tab. The controls are half the contract — `sinkListItem` (Tab) takes
nothing because its gap's first block is a `listItem` and never deferred, a
blockquote around a HEADING leaves the heading anchorable in its own right, a
mid-container split-lift leaves the head half holding the id, and an Enter split
still mints. The leg with teeth is the CENSUS: the population of re-parenting
commands is DISCOVERED from production source as an EXACT SET against what this
suite drives (a member nobody drives is a step shape nobody checked the net
against; a member no file calls any more makes the first leg pass for the wrong
reason), and no file outside the rule may spell the bypass meta, re-derive the
rule, or read a step gap itself. Measured by neutering each half in turn: the
pre-499 mint-only net takes **12** legs, direction 2 **3**, the guard's
EXCEPTION 3 **9**, the retype type-change gate **1**, the liveness gate **1**,
the container-owns-it clear **9** (1 named leg + the uniqueness sweep), keying
the guard on the planned TRANSFER instead of on DISSOLUTION **3**, moving the
pass in front of the keystroke fast path **1**, and a second file spelling the
bypass meta **2**. The sweep is the leg that speaks for the shapes no named
case looks at: 7 document shapes × 6 gestures × {gesture, undo, redo}, asserting
only the invariant the plugin has always owed — no two live nodes answering to
one uuid. One of this
suite's own first-draft legs was VACUOUS and is recorded rather than quietly
fixed: it counted TipTap's `transaction` event as a per-keystroke cost signal,
and that event fires once per DISPATCH, not once per APPENDED transaction —
measured, it passed with a backfill forced on every keystroke. The count lives
where `state.applyTransaction` returns it; what this suite pins is the pass's
PLACEMENT behind the fast path.

**Residuals, stated rather than implied.** A MULTI-item lift merges the items
into one before lifting (`liftOutOfList`'s own `tr.delete(pos-1, pos+1)`
preamble), so only the FIRST item's identity is still available when the lift
runs: the first lifted block conserves and the rest mint — the honest
composition of a join (N text objects became one) and a split (one became N),
pinned as its own leg. Those joined-away items also HUSKED if they were
margin-anchored — the guard's general JOIN behaviour rather than anything this
task introduced, measured on a plain two-paragraph Backspace-join with no list,
lift or transfer involved at all, and pinned here as a stated boundary.
**CLOSED by task 514** — see "The absorption half" immediately below; that
boundary leg is renegotiated in place. A block dropped INTO a
container that ALREADY has an identity is absorbed by it, because nothing bare
is there to hand the id to. And the outer container of a whole-list lift
(`bulletList` around a sole `listItem`) hands its id to nobody — the innermost
container is the one whose content became the paragraph — so its card orphans
to the chip rather than husking.

**Owed, not claimed:** a real-FSA eyeball. The orphan/husk half is the
FSA-masked class (real anchor death reproduces under prod File System Access),
so the durable proof here is the unit contract — anchor a note to a list item,
Shift-Tab it out, and confirm the marker follows the text with no empty line and
no unanchored chip.

#### The absorption half: a JOIN is the THIRD way a block leaves

Same guard, the departure 499 recorded and could not see (task 514) — and the
case where the fix's own predicate, `dissolvedByReparent`, is STRUCTURALLY blind
to it: a join produces no `ReplaceAroundStep` and no gap, so there is nothing for
that reading to look at.

Measured through the real stack with both paragraphs margin-anchored:

```
BEFORE   paragraph#P1("A")   paragraph#P2("B")     ← caret at the start of "B"
AFTER    paragraph#P1("A")   paragraph#P2("")   paragraph#099b("B")
```

The user pressed Backspace to merge two paragraphs and got a blank line holding
one of their identities, with their own text re-minted beside it. The join
produced `<p P1>AB</p>`; `MarginaliaAnchorGuard` then inserted an empty
`paragraph({uuid:"P2"})` at the mapped deletion site — which is INSIDE the merged
textblock — so ProseMirror's fitter split it and `BlockUuidBackfill` minted a
stranger for the half that got split off. Same on a list-item join, and it is
what made a MULTI-item Shift-Tab lift husk once per joined-away item, because
`liftOutOfList`'s own `tr.delete(pos - 1, pos + 1)` preamble IS a join.

> **A block leaves the document in three structurally different ways, and telling
> them apart is the whole of what the two guards need: it was REMOVED (its
> content went with it), its container DISSOLVED (its content was re-parented,
> task 499), or it was ABSORBED (its content MERGED into a surviving sibling).**
> The three are ONE question — *what happened to this block's content?* — so they
> are answered by ONE door, `classifyBlockDepartures`
> ([block-uuid-backfill.ts](src/lib/tiptap/block-uuid-backfill.ts)), read by both
> guards. Two doors is how the resurrection guard and the orphan sweep come to
> disagree about a departure.

**Gabriel's ruling (2026-08-31): the absorbed card FOLLOWS the survivor.** The
join is a merge, not a delete — the words the card is about are still on screen,
inside the survivor — and the archive-displacement precedent (task 491, "the
margin context RE-HOMES onto the surviving neighbour") already chose that answer
for the sibling gesture. So the re-home runs through the SAME 491 door.

Eight rules it earned:

- **Absorption cannot be an identity TRANSFER, which is why the two mechanisms
  differ.** 499's dissolved reading hands a container's id to its SUCCESSOR where
  one exists; a join has none — the survivor already HAS an identity, and one
  node holds one id. So the absorbed identity really does leave the document, and
  the only place the card can follow it is the SIDECAR. That is why this reading
  publishes the SURVIVOR rather than a receiver position, and why the re-homing
  lands in React-land rather than in the net.
- **ONE uuid, ONE verdict.** `TextObjectOrphanGuard` publishes the ABSORBED
  signal INSTEAD of `virgil-textobject-orphaned`, never both — so the sweep that
  STRIPS a link naming a vanished uuid cannot race the re-home. 491 had to order
  those two by hand ("retarget BEFORE the delete"); here they are mutually
  exclusive by construction.
- **The signal is a REF, not a window event.** N `EditorPane`s are mounted at
  once under multi-doc keep-alive, so a window listener registered per pane is
  answered by every pane (the task-329 class). A ref threaded through the
  extension ctx is per-EDITOR by construction — there is no visibility question
  to get wrong. The sibling `virgil-textobject-orphaned` keeps its window channel
  because its consumers (`useArchive` / `useTodos`) are per-doc hooks with no
  editor in hand; a re-home needs the survivor's live paragraph text, so it has
  to be asked of the editor that performed the join.
- **TWO things fail OPEN back to the orphan event**, because a needless orphan is
  the pre-514 behaviour while a re-home onto a dead paragraph is a fresh defect:
  a survivor that did not itself survive the batch (checked against the SETTLED
  doc the sweep already walks), and a surface with no handler wired — only the
  main `EditorPane` mount supplies one.
- **The step reading is `ReplaceStep` ONLY, and that is the true scope rather
  than a shortcut.** A plain join, a Delete at a block end, a range selection
  dragged across a boundary and `liftOutOfList`'s merge preamble are all
  `ReplaceStep`s. The one `ReplaceAroundStep` join `deleteBarrier` uses (pulling
  a paragraph into the last item of a preceding list) RE-PARENTS, so
  `dissolvedByReparent` already answers it and husks nothing; re-classifying it
  as absorption would renegotiate 499's decided orphan outcome for the whole lift
  family inside a task whose ruling is about the JOIN. Stated as a residual.
- **The ancestor walk climbs to the uuid-BEARING node, not merely the anchorable
  one.** A `listItem`'s body paragraph carries no uuid (it defers to the item —
  `DEFERRING_PARENTS`), so stopping at the first anchorable ancestor would answer
  with a node that has no identity to lose. Climbing to the id is also what makes
  two paragraphs joined INSIDE one list item answer with the SAME node, which is
  correct: nothing departed.
- **"They merged" is CHECKED, never inferred from the step's shape.**
  `step.to` lands exactly `slice.size` past `step.from` after the step, so asking
  where those two positions sit in the POST doc asks whether the boundary
  survived — four `resolve`s, no walk — and the surviving node's uuid must be the
  survivor's. Everything unreadable fails CLOSED to today's behaviour.
- **Chains resolve to their END.** A batch that joins three blocks in two steps
  re-homes every absorbed card onto the ONE block that survived it, never onto an
  intermediate that is itself gone. Cycle-guarded; a degenerate self-target is
  dropped rather than published.

CI: [join-absorbed-anchor.test.ts](src/lib/tiptap/__tests__/join-absorbed-anchor.test.ts)
drives the REAL `buildEditorExtensions("main")` stack through `handleKeyDown` and
the shipped command chain — a direct `tr` dispatch cannot see which command a
keymap chooses (task 418's lesson) — over the reported paragraph join, a
list-item join, a range delete across a boundary, the multi-item lift, undo, and
a two-cycle `.tex` fixed point. **No pre-514 suite could see any of this**:
`anchored-block-delete-reinsert.test.ts` characterises this guard thoroughly by
dispatching `tr.delete` DIRECTLY, where a join is unrepresentable, and 499's own
suite PINNED the husk as the contract (renegotiated in place there, with the
reason at the site). Its CONTROLS are half the leg count: a whole-block delete
still resurrects, two paragraphs joined inside ONE list item announce nothing
(one identity, nothing departed), and an intra-block delete announces nothing.
[rehome-absorbed-anchor.test.ts](src/cards/__tests__/rehome-absorbed-anchor.test.ts)
drives the re-home door against a recording `AnchorRetargetApi` — the two things
that can go wrong there (a survivor whose type is not a text-object kind, since
the guard is registry-free by design; a degenerate self-target) are invisible to
any test of `retargetDisplacedAnchors` itself. Measured by neutering each half in
turn: EXCEPTION 4 takes 7 legs, the absorbed notification 3, and a dropped
`onBlockAbsorbedRef` prop 1 (the census).

**Owed, not claimed:** a real-FSA eyeball. Anchor death is the FSA-masked class,
so the durable proof here is the unit contract — anchor notes to two adjacent
paragraphs, Backspace-join them, and confirm no blank line and both markers on
the survivor.

### The schema half: a TYPE contract is blind to the ATTRS the type carries

Same law, the SCHEMA the excerpt body mounts (task 402, DATA LOSS) — and the
case where the reverse-direction guard was complete over the axis it asks about,
silent on the axis that loses, and had written its own blindness into a fixture
comment as a verified fact.

Task 308 gave the excerpt surface the full block VOCABULARY and pinned it with
the direction that has teeth: every node and mark type the main editor can
produce must be mountable in a card body. `EXCERPT_STARTER_KIT_CONFIG` is the
empty override, so an excerpt body mounted StarterKit's PLAIN `heading` /
`paragraph` / `bulletList` / `orderedList` / `listItem` / `blockquote` /
`codeBlock` — while the MAIN editor turns those same StarterKit nodes OFF and
registers its own carrying nine more names across **nineteen node x attr
pairs**: `uuid`, `parTitle`, `label`, `numbered`, `sectionNumber`, `shortTitle`,
`listPreamble`, `listOptions`, `itemLabel`. Type membership was complete and the
two schemas still disagreed about every one of them.

**ProseMirror drops an undeclared attr in SILENCE.** `computeAttrs` iterates the
TYPE's attrs; `Node.fromJSON` does call `checkAttrs`, but on the
already-computed result, which by construction holds no undeclared key. And
TipTap only runs `node.check()` under `enableContentCheck`, which is off. No
throw, no warning, no console line.

**The stripper is the card-body EDIT, not the restore**, which is the whole of
the repro and the reason no leg can be written without typing.
`restoreExcerptAtCaret` strips nothing; `RichTextField`'s `onUpdate` (250 ms
debounce) and its `onBlur` flush both call `onChange(editor.getJSON())` on the
attr-poor mounted schema, and `ArchiveCard`'s `handleEditContent` writes that
straight over `snippet.content`. So: **archive (attrs intact) -> the user edits
ONE character in the card -> `archive.json` holds an attr-less heading ->
restore faithfully hands back the lamed version.** An UNEDITED excerpt restored
whole, which is exactly why it read as flaky.

Measured on the restored `.tex`: `label` / `numbered` / `shortTitle` are the
heading's `\label{}`, its `*` and its `[short]`; `listOptions` / `listPreamble`
are `\begin{itemize}[…]` and its tuning lines; `itemLabel` is `\item[…]`.
`parTitle` has no `.tex` carrier at all — it lives in the sidecar and was simply
gone. And `uuid` is IDENTITY rather than bytes: `BlockUuidBackfill` mints a
FRESH one on restore, so every card, marginalia marker and sidecar entry
anchored to the archived block ORPHANS — from the only surviving copy of prose
already cut from the document.

> **A contract over node TYPES is not a contract over the schema. Where two
> surfaces must agree about a node, the attrs it declares are DECLARED ONCE and
> both surfaces read that declaration — and the reverse-direction guard asks
> about the ATTRS as well as the types.**

[`MAIN_STARTERKIT_NODE_ATTRS`](src/lib/node-attr-sets.ts) is the declaration:
the seven rows, full specs, in the import-free leaf that already holds
`UUID_BEARING_NODE_TYPES` / `TITLED_NODE_TYPES` / `CARD_BODY_BLOCK_ATOMS` — the
placement rule `latex-markers.ts` earned. Six rules it earned:

- **The MAIN editor reads it too, or the table is a second copy of the schema
  rather than its source.** Each builder in `editor-extensions.ts` spreads its
  row; byte-identical to what shipped, and it is what makes the reverse contract
  meaningful rather than tautological — the excerpt gets exactly what the table
  holds, so an attr added INLINE to a main node fails the guard (measured).
- **`UUID_ATTR_SPEC` / `makeUuidAttr` MOVED into the leaf**, with
  `tiptap/uuid-attr.ts` re-exporting them so every importer is unchanged. They
  are two of the nineteen pairs, and the leaf cannot import a module that
  reaches `EditorView`. A spec spelled twice is a spec that can drift.
- **The registration route was tried first and DECLINED, for a stated reason.**
  Re-registering the main builders would drag their machinery — the `+T` title
  strip, the fold chevron, the label handler, and for `heading` a host main
  editor to proxy structural writes to, none of which a card body has — and it
  would pull `editor-extensions.ts` into a module every card surface imports.
  `addGlobalAttributes` adds attributes to a registered node without
  re-registering it, and TipTap ignores a global attribute naming a type the
  schema has not got, so it is inert at the `"card"` scope by construction.
  Mirror the schema, not the machinery.
- **The excerpt takes the attrs DATA-only** (`dataOnlyAttrs`: same `default` and
  `keepOnSplit`, `rendered: false`, no parse/render). `rendered` is a DOM fact —
  `toJSON`/`fromJSON` carry the attr regardless, which is why every already
  non-rendered member round-trips today — and `data-uuid` is a RESOLUTION KEY:
  `resolveDomForUuid`, the grab-handle hover scan and the marginalia registry
  all query it. A card body has none of that chrome, so a second copy of the
  document's identity attributes would have no reader and every opportunity to
  become one. `keepOnSplit` is CARRIED rather than defaulted away: an item split
  in a card body must no more inherit its neighbour's `\item[(b)]` than one in
  the document.
- **`sectionNumber` is in the table although it is not a loss.** The serializer
  never reads it and main's numberer recomputes it, so it is self-healing — but
  excluding it would buy an exemption list on a guard whose whole value is
  being an exact equality. Zero cost, one fewer thing to be wrong about.
- **The fixture comment that waved this through is RENEGOTIATED in place, with
  the reason at the site.** It read: *"main-editor blocks carry their `uuid` /
  `parTitle` / `label` attrs, which the card schemas' plain StarterKit nodes do
  not declare. (Verified tolerated — ProseMirror ignores undeclared attrs on a
  known type; only an unknown TYPE or MARK blanks the doc.)* Both sentences are
  true and the conclusion drawn from them was the defect, asserted as the
  contract — the shape this file's own rule about guards pinning the wrong thing
  is written against.

CI: [excerpt-attr-preservation.test.ts](src/lib/tiptap/__tests__/excerpt-attr-preservation.test.ts)
drives the REAL story per row of the table — `parseLatex` -> the REAL capture
door (`prepareCardBodyCapture` over a real `doc.slice`) -> the REAL card body
composed extension for extension as `RichTextField` composes it -> ONE typed
character -> `normalizeRichContent(getJSON())`, which IS what the archive host
persists -> `restoreExcerptAtCaret` -> the `.tex` bytes AND the node attrs, over
TWO cycles. Every fixture carries an explicit `%!v:` anchor, which is
load-bearing rather than tidy: `assignUuids` mints RANDOM ids, so a fixture
without one makes an identity assertion unfalsifiable in both directions. The
widened reverse contract lives in
[excerpt-schema.test.ts](src/lib/tiptap/__tests__/excerpt-schema.test.ts) (per
node type AND per mark type), the table's own premise — no stale row — in
[node-attr-sets.test.ts](src/lib/__tests__/node-attr-sets.test.ts), and the
census (no attr spec re-declared outside the SSOT; both card surfaces resolve
their StarterKit config and body schema BY SCOPE) beside the round trip.
Measured by neutering each half in turn: the pre-402 excerpt schema takes 10
behavioural legs plus the widened guard, `dataOnlyAttrs` 1, an inline attr on a
main node 1, and a re-declared spec 1 (the census). The two non-regression pins
— an UNEDITED excerpt restores whole, and the narrow `"card"` scope mints no doc
attrs — pass either way, and say so at the site.

**Owed, not claimed:** a real-FSA eyeball. The archive sidecar round trip is
FSA-masked, so the durable proof here is the unit contract — archive a
`\section*[Short]{X}` carrying a `\label`, edit the card, restore, read the
`.tex`.

**Known related gap, stated rather than fixed:** `listItem`'s CONTENT expression
also forks — `"paragraph block*"` (StarterKit) vs `"(paragraph | graphicsBlock)
block*"` (main). `canMountInSchema` is `schema.nodeFromJSON`, which routes to
`NodeType.create` and does NO content-expression check, so a `graphicsBlock`
inside a `listItem` is mountable in the excerpt body by a route the guard does
not model. Real, adjacent, and its own task.

### The attrs half: a gate written in NODE TYPES and TEXT cannot see ATTRS

Same law, the PREDICATE that decides whether a destruction needs a confirm at
all (task 401) — and the case where the guard was correct about the vocabulary
it could see and blind to the one Virgil's payload actually lives in.

`hasJsonContent` recursed looking for `text` nodes and had no `attrs` arm, so
`cardHasContent(kind, rec)` answered **false** for a body that is entirely one
atom: `$\lambda$`, a `citation`, a `\ref`, a nested footnote marker, a
`displayMath`, a `texBlock`, a `forestBlock`, a `graphicsBlock`, a caption-less
`figureBlock`. That is not an exotic body — it is the ordinary shape of a
footnote holding one formula.

**The headline cost was DESTRUCTION, not a missing dialog.** `EditorPane`'s
`handleEditFootnote` marks a new footnote DIRTY only when the predicate says the
body has content, so an atom-only footnote stayed **pristine**; the
document-level capture-phase `pointerdown` watcher in `usePristineCardManager`
then fired the discard, and the discard handler re-asked the SAME blind
predicate before deleting. **Create a footnote, type `$\lambda$`, click anywhere
else: it is gone.** No confirm, no orphan card, no undo affordance — and a
footnote body is by construction the only copy. Four more doors share the
predicate, which is what made the one-function fix total: `EditableCard.tryDelete`
(the trash click AND the task-386 key door), `usePanelCardTryDelete`,
`deleteMarginItem`, and the footnote ORPHAN gate. The ARCHIVE case is the worst
blast radius — the capture dispatches `tr.delete` FIRST, an archive card is born
`title: ""` with no auto-title rescue, so the gate has nothing else to see.

> **A gate written in the vocabulary of NODE TYPES and TEXT cannot see content
> that lives in ATTRS.** So it is inverted: everything carries content EXCEPT
> the empty structural wrappers a blank document is made of
> ([`EMPTY_WRAPPER_NODE_TYPES` / `jsonCarriesContent`](src/lib/node-attr-sets.ts)).
> An allowlist of "nodes that carry nothing by themselves" is CLOSED and small;
> a denylist of atoms can only ever be missing the tenth.

Six rules it earned:

- **The correct-shaped twin already existed two files over, and taking it was
  the fix.** `jsonCarriesContent` (`schema-mount.ts`'s mount-preservation door)
  asked exactly this question and got it right, with a private
  `EMPTY_WRAPPERS = new Set(["doc","paragraph"])`. Two walkers for one question
  is the fork; the set moved to the import-free leaf (the placement rule
  `latex-markers.ts` earned) and both doors read the ONE operation, so the mount
  door and the delete confirms can no longer answer differently about one body.
  `hasJsonContent` is DELETED rather than aliased — it had no caller outside its
  own file, and a second name for one question is a name the next author reaches
  for.
- **A WRAPPER carrying a payload attr is not empty**, which is the same disease
  one level in and would have survived the fix. `parTitle` is the one such attr,
  and the check is DERIVED from `TITLED_NODE_TYPES` rather than re-listed —
  `uuid` is identity (a blank paragraph has one and carries nothing) and
  `collapsed` is view state.
- **A TEXT node's content IS its `text` field**, so it is answered there and
  never falls through to the type rule — otherwise `{type:"text",text:""}`
  reports content because `"text"` is not a wrapper NAME. Unreachable from a
  live ProseMirror doc (PM forbids empty text nodes) and entirely reachable from
  hand-built JSON: an `/editor/*` skill's sidecar write, a legacy blob, a
  fixture. Found by a real-editor fixture, not by inspection.
- **The CONTROLS are half the contract.** A genuinely empty body must still
  answer false, or the fix becomes "confirm on everything" — every blank card
  nagging on delete and no pristine card ever reaped, which is a worse product
  than the bug.
- **The premise is CHECKED against the live schema**, the instrument task 148
  earned: every member is a node type the schema declares, the set IS the node
  types `emptyRichContent()` is made of, every member is a CONTAINER (never an
  atom or a leaf — the category error that would reopen the class), and — the
  direction with the consequences — **every NON-member of the live vocabulary is
  reported as content**, swept over the whole schema so a new node kind is
  covered by shipping rather than by a fixture. Note `doc` is `block+`: "can be
  empty" is NOT the property and asserting it fails, which is why the leg asks
  about containment instead.
- **The flag-ON orphan writer was a second table, closed as a FORK rather than
  as a bug.** `inline-atom-lifecycle-policy` hand-wrote "plainText or title"
  where its flag-OFF twin has asked `cardHasContent` since FN-A1-02. Measured,
  the two AGREE on every shipped body — `richJsonToPlainText` hands each
  attr-carrying block atom a non-empty placeholder (`[figure]`, `[graphic]`,
  `%`) — so this is a hardening and the census is the only leg that can see it.
  Stated that way rather than dressed as a live defect: a display projection is
  the wrong authority for a destruction gate whether or not it currently
  differs, and an arm added later returning `""` would drop a recoverable
  footnote on a flag flip nobody would connect to the loss.

CI: [atom-only-body-content.test.tsx](src/cards/__tests__/atom-only-body-content.test.tsx)
sweeps the blind set per member — DISCOVERED from `ATOM_REGISTRY`'s `nodeName`
column ∪ `CARD_BODY_BLOCK_ATOMS`, so a new atom kind is covered by declaring
itself — and drives a leg per DOOR, because they share the predicate and a leg
per door is what proves the sharing. The pristine reap runs the REAL
`usePristineCardManager` `pointerdown` path with the REAL predicate composed as
EditorPane composes it; the two EditableCard doors drive the REAL component. The
leg with teeth is the CENSUS (EditorPane's two gates and both orphan writers
must spell the shared predicate; no production file may re-declare a wrapper
set, allowlist EMPTY, with a SYNTHETIC canary rather than one standing on the
drained line). The schema premise lives in
[node-attr-sets.test.ts](src/lib/__tests__/node-attr-sets.test.ts). Measured by
neutering each half in turn: the pre-401 text-only walker takes 25 legs, a
has-content that re-forks its own walker 24, the text-node rule 3, the
parTitle-on-wrapper rule 1, and the orphan-writer unification 1 (the census).

**Owed, not claimed:** the preview eyeball. NOT FSA-masked for the headline (it
is a live editor gesture, no disk involved), so the check is cheap and real —
make a footnote, type `$\lambda$`, click away, and it must still be there. The
ARCHIVE half touches sidecars and is partially FSA-masked; the unit contract is
the durable proof there.

### The keyboard half: a destructive key asks ONE door, and a danger confirm cues its SAFEST button

Same law, the KEYBOARD carrier (task 386). Gabriel's repro: archive some text,
click `+T` on the resulting card, type a title, press `Backspace` mid-word — the
whole card is gone. Three defects compound, and any one of them alone would have
prevented the loss:

- **The guard hole.** `EditableCard` kept its own shell-level Delete/Backspace
  handler instead of the shared `useCardDeleteKey` door, and its only field guard
  was `isFocused` — which tracks the BODY rich-text editor and never the title
  `<input>`. So a `Backspace` in the title ran `preventDefault()` (eating the
  character edit) and deleted the card. The shared guard built for exactly this,
  `keyEventFromInteractiveControl`, was not consulted — and its own docstring
  asserted that EditableCard "already encodes this via its `isFocused`
  focus-tracking", true of the body and FALSE of the title. **The
  stated-invariant-with-no-consumer shape, in a docstring that granted the
  exemption.**
- **The keyboard trap.** The confirm a content-bearing card raises mounted with
  its DANGER button `autoFocus`ed, under a user mid-typing. From the keyboard's
  point of view "Backspace, keep typing" WAS "delete the card".
- **The invisible in-flight title.** `CardBodyTitle` is UNCONTROLLED and commits
  on BLUR, so `cardHasContent` read the value from before the user started. A
  card whose only content is the title being typed read as EMPTY and deleted
  instantly, with no dialog at all.

> **Every card-level Delete/Backspace enters `useCardDeleteKey`, so both guards
> (selection + interactive-control bail) hold by construction; a `tone="danger"`
> confirm cues its SAFEST button; and a content gate reads what is ON SCREEN.**

Five rules it earned:

- **The interactive-control match is scoped to a STRICT DESCENDANT of the card
  shell.** A card root is often itself `draggable="true"` (cross-editor anchor
  drags — `CitationCard` ships it, `EditableCard` has the wiring), and
  `[draggable='true']` is in `INTERACTIVE_CONTROL_SELECTOR` — so an unscoped
  `closest()` walks past every nested target and matches the ROOT, and the delete
  key would be dead app-wide with nothing to show for it. `PanelCard`'s own lift
  blocklist scopes the identical query for the identical reason; this was latent
  rather than live, and would have gone live the moment EditableCard gained a drag.
  **It was already LIVE one surface over (task 423):** the omni pin-on-touch blocker
  was written as a "mirror" of the lift blocker and dropped the scoping, so a press
  anywhere on a `CitationCard` (whose ROOT is draggable) matched the root and
  `holdOmniCard` never ran — the card and its whole deck jumped on every
  collapse/expand. The scoping rule now has ONE home,
  [`pressFromInteractiveControl`](src/lib/drag-blocklist.ts) (strict descendant of
  the gesture's own container), read by the lift, the pin, the delete-key guard and
  the float window-drag; and the half the task's own first cut got wrong is stated
  there too — a surface that wraps a card from OUTSIDE cannot scope to itself,
  because the draggable shell is a strict descendant of it, so it resolves the
  `[data-card]` shell first (`cardShellWithin`) and asks against that. CI:
  [interactive-control-scope-census.test.ts](src/lib/__tests__/interactive-control-scope-census.test.ts)
  (no production site spells `closest(<shared selector>)`, allowlist EMPTY) and
  [pin-on-touch-draggable-card.test.tsx](src/panels/Omni/__tests__/pin-on-touch-draggable-card.test.tsx)
  (the REAL omni wrapper around a draggable `[data-card]` root). Measured by
  neutering: 5 legs.
- **The in-flight title is read LIVE, not committed per keystroke.** A title input
  REGISTERS ITS ELEMENT with the enclosing card
  ([panel-primitives.tsx](src/components/panel-primitives.tsx) `CardTitleRegistry`)
  and the gate reads `el.value` when it asks. Committing on change would turn each
  character into a sidecar write (the task-363 cadence doctrine) and retire the
  input's own Escape-reverts affordance; reading the live ELEMENT can never go
  stale, where a mirrored draft is only as fresh as the events someone remembered
  to mirror. A Set, not a slot: a card may render more than one title surface.
- **`autoFocus` marks the CUED DEFAULT, and it must never be destructive.**
  `confirmDialogCuedDefault()` derives it for every caller — Cancel where there is
  one, else the secondary answer, else NOTHING (a single-button danger notice cues
  no button and `SystemDialog` focuses its FRAME, so Escape and Tab still start
  inside the dialog). The danger action stays keyboard-reachable by Tab+Enter,
  which is the right cost for a deliberate destructive choice. Recorded in
  `STYLE_GUIDE.md` beside the "RED means destructive without a net" note.
- **A destructive BARE-KEY shortcut bails on an editable target.** The sweep found
  the same missing guard one layer up and worse: `useMenuKeyboard`'s window-CAPTURE
  handler consumed bare keys with no `e.target` check, and `DragHandleMenu` aliases
  `Backspace`/`Delete` onto its DELETE row — so with a menu open and the caret in
  a field, one Backspace deleted the block before the field ever saw the key.
  `isEditableEventTarget` moved to the import-free `drag-blocklist` leaf (the
  placement rule `latex-markers.ts` earned) so a lean hook can reach it; the
  COMBOBOX source deliberately does not bail, because its handler is wired by the
  caller onto the menu's OWN input — the same `target === currentTarget` line
  `keyEventFromInteractiveControl` draws.
- **Every other title surface was swept and is safe BY CONSTRUCTION**, recorded
  rather than assumed: the document par-title inputs are appended to
  `document.body` (outside the PM DOM) or covered by NodeView `stopEvent`; the
  Outline's rename input has no row-level delete key to reach; `ExampleCard`
  attaches no `onKeyDown` at all; `FloatingPanel` / `FloatHost` / `LiftHost`
  register no keydown listener, so a popped-out card repro'd purely through
  EditableCard; and the margin marker's handler sits on a leaf `<button>` that can
  contain no field.

CI: [card-title-delete-guard.test.tsx](src/components/__tests__/card-title-delete-guard.test.tsx)
drives the REAL components (EditableCard → PanelCard → CardBodyTitle →
ConfirmDialog) per titled kind, because the parts that misbehaved were a call site
that never asked a shared guard and a focus decision made in JSX — neither visible
to any test of the guard or the dialog alone. The leg with teeth is the CENSUS
([card-delete-key-door.test.ts](src/components/__tests__/card-delete-key-door.test.ts)):
no card surface may spell its own Delete/Backspace card-delete handler, with ONE
exemption scoped to the shape that justifies it (the margin marker's leaf
`<button>`) and its own PROOF leg — the handler must still sit on a `<button>`,
and the exemption must still be excusing something. Measured by neutering each
half in turn: the bespoke handler takes 10 legs, the danger cue 2, the live-title
read 2, the strict-descendant scoping 2, and the menu guard 2 (one census, one
behavioural, in the REAL `DragHandleMenu`).

**Owed, not claimed:** the preview eyeball. This class is NOT FSA-masked, so the
check is cheap and real — archive text, `+T`, type, Backspace repeatedly (the
title edits, the card stays), then trash-click the same card and see the confirm
open with Cancel focused.

#### The cue half: a VISIBLE default is a promise the key must keep

Same dialog, one key over (task 389) — and the case where the affordance was
correct, the chrome painted it, and the KEY that presses it was gated on an
implementation accident. Gabriel: in the "Re-anchor this snippet?" dialog,
`Return` does nothing. `Escape` felt fine, which is the whole tell — Escape
closed unconditionally, while Enter ran only while
`document.activeElement === theCuedButton`, and the cue was claimed by a
deferred one-shot `requestAnimationFrame` at open. The button renders as the
accented default whether or not that frame landed, so the VISUAL promise and
the KEYBOARD behaviour diverged with nothing on screen to say so.

> **The cue is what the chrome OFFERS, so it is what the key must ACCEPT.**
> `Enter` in a dialog activates a BUTTON — the focused in-frame button if there
> is one, otherwise the REGISTERED cued default — never gated on where DOM focus
> happens to sit. The exceptions are asked of the TARGET, not of focus.

Six rules it earned:

- **There was no THIEF, which is why the fix could not be "re-assert focus".**
  The filed diagnosis blamed the drag-end teardown for stealing focus, and a
  read-only sweep of every `.focus()` site reachable from the drop-mode commit
  found ZERO: the card producers `preventDefault()` their own mousedown
  specifically to suppress native focus, so focus never left `.ProseMirror` in
  the first place, and the dialog's only claim on it was that one frame. **The
  claim MISSED; nothing took it.** Verify a phenomenon before generalizing its
  cause — the surgical fix aimed at the wrong mechanism entirely.
- **…and the claim missed because it was scheduled from a commit that renders
  NOTHING.** `mounted` starts false (SSR cannot touch `document.body`), so a
  dialog's first commit returns `null` — no portal, no button, every ref null —
  and the focus effect's deps omitted `mounted`, so that was the only commit it
  ever ran in. React schedules the `setMounted(true)` re-render as a Scheduler
  task while the rAF is tied to the FRAME, so on a busy main thread — the end of
  a drag: gesture-end edge, mint transaction, RO settle — the frame arrives first
  and the callback focuses nothing at all. A click-opened dialog wins the same
  race on a quiet thread, which is exactly why this read as "only the drag one is
  broken".
- **The exceptions are a question about the TARGET.** Inside the frame a control
  that owns `Enter` keeps it (textarea, contenteditable, `select`, link,
  `<summary>`, a self-activating input) and so does anything that consumed the
  key by calling `preventDefault()` — the platform's own way of saying "mine",
  and an in-dialog control that consumes Enter must say so (one site,
  `ManageStylesModal`'s rename field, did not, and would have closed the whole
  modal on a rename). A plain single-line `<input>` SUBMITS to the cued default.
  Outside the frame, a MODAL owns the keyboard and answers at window CAPTURE, so
  ProseMirror's own `Enter` — a new paragraph in the user's document, behind an
  open modal — never sees it; a SCRIMLESS window (Preferences, the bug reporter)
  is deliberately not modal and answers nothing from outside itself.
- **Activating a focused in-frame BUTTON ourselves is what makes it ONE rule.**
  `preventDefault()` suppresses the native synthesized click, so the activation
  is exactly-once in every environment, and the pre-389 special case ("the cued
  button is focused, so preventDefault + click") folds INTO the general statement
  instead of sitting beside it.
- **Unconditional Enter needed a STACK, and the stack retired a live Escape bug
  with it.** Dialogs genuinely stack — `ManageStylesModal` stays mounted under
  `StyleEditorModal` / `StyleApplyDialog` / `DocTypeChangeDialog` — and each open
  dialog installs its own window listener, so pre-389 a single `Escape` closed
  BOTH. Making Enter unconditional without an owner would have added the worse
  twin: two cued defaults firing from one press.
  [dialog-stack.ts](src/components/dialog-stack.ts) is a LIFO in mount order and
  only the TOP entry answers a key — the same shape `useMenuKeyboard`'s `isTop`
  already had one subsystem over.
- **`autoFocus` is the CUE first and the initial-focus target second.** The shell
  stands DOWN when the dialog's own body has already claimed focus, so a dialog
  can finally name its Enter default without stealing the caret from its own
  field — which is what let `NewDocumentModal` cue "Create" at all.
- **…and the body's claim is the SHELL's job, because a caller structurally
  cannot make it.** The adversarial pass on this fix found the stand-down branch
  DEAD in all three dialogs it was written for. The shell renders `null` until
  `mounted`, so a caller's `useEffect(…, [])` fires in the commit where the body
  is not in the DOM: React flushes a commit's whole passive-effect list — the
  child's `setMounted(true)` included — before processing the re-render that
  update schedules, so the ref is `null` and the effect (deps `[]`) never runs
  again. `TexFilePickerModal`, `NewDocumentModal` and `StyleEditorModal` all had
  it; measured, focus fell through to the FRAME in every one. Worst of them was
  the picker: no focused row AND (deliberately) no cued default, i.e. **a Return
  that did nothing** — this task's own symptom, which the first cut then PINNED
  as intended by declaring `noCuedDefault` on the strength of a claim about
  focus that was false. `initialFocus` is the door: the shell calls it once the
  portal exists, and falls through to the cue if the claim leaves focus outside
  the frame. *A stand-down rule is worth nothing if nothing can stand up.*

Three more the same adversarial pass earned, each a live regression in the first
cut. The owner is **not** simply the top of the stack: mount order is the right
rule for modals, and `PreferencesModal` and `BugReportWindow` are both
`variant="draggable"`, both rendered side by side, and both openable at once — so
between non-modals the owner is the window CONTAINING focus, with the topmost
MODAL outranking everything (modality IS the claim) and mount order the last
resort. Otherwise Escape closed the window the user was not typing in. **Shift+Enter
and a held (`repeat`) Enter** are not the cue's key — a cue promises what a plain
Return does, and a held Return must not repeat-fire a confirm. And the capture
listener moved from `window` to `document`: it still beats every in-document
keymap, and it no longer silences two window-capture listeners that must not be
silenced — the open-menu controller, and `input-modality`, whose own contract says
a key trap must not be able to hide that the user is typing.

The **radio/checkbox** exclusion was reversed for the same reason: it was written
so a dialog checkbox would answer Return, and measurement showed it bought nothing
(`PrintDialog`'s "checkboxes" are `<button>`s, already covered) while costing a
real one — the single genuine `<input type="radio">` in a dialog is
`ManageStylesModal`'s default-style picker, whose cue is "Done", so Enter on it
would have closed the entire modal from a key that previously did nothing.

Escape is deliberately left UNCONDITIONAL within the owning dialog rather than
gated on `defaultPrevented` like Enter: CodeMirror binds `Escape`
(`simplifySelection`) and `StyleEditorModal` hosts one, so a "the target consumed
it" rule would make Escape stop closing that dialog whenever its preamble editor
has focus. A modal always has a way out.

CI: [dialog-enter-contract.test.tsx](src/components/__tests__/dialog-enter-contract.test.tsx)
drives the REAL components and dispatches a REAL keydown at a REAL target;
[reanchor-confirm-enter.test.tsx](src/components/drop-mode/__tests__/reanchor-confirm-enter.test.tsx)
drives Gabriel's own gesture end to end through the REAL controller, the REAL
`confirm` door and the REAL dialog, and presses exactly one key. The leg with
teeth is the CENSUS
([dialog-cued-default-census.test.ts](src/components/__tests__/dialog-cued-default-census.test.ts))
— the shell was never the part that could misbehave, a dialog that ships a footer
and cues nothing is, and that type-checks perfectly; membership is DISCOVERED
from the tree, and the two deliberate no-cue shapes carry a `noCuedDefault`
DECLARATION so "no cue" can never be read as "someone forgot one". The focus half
is pinned STRUCTURALLY (the frame is scheduled from a commit where the dialog
EXISTS), because the failure it closes is a real-browser timing race a hand-pumped
jsdom rAF queue cannot reproduce — a leg that flushed frames after React settled
passed under its own neuter. Measured by neutering each half in turn: the pre-389
focus-gated Enter takes 10 legs plus the drop-mode leg, the stack 2, the
`mounted` gate 1, the body-claimed-focus stand-down 2, and the two census
declarations 2; of the follow-up, the `initialFocus` door takes 3, the
focus-aware owner 1, the Shift/repeat filter 1, and the radio/checkbox reversal 1.
The census is per ELEMENT rather than per FILE — `ManageStylesModal` renders one
dialog and hosts three, so a file-scoped question lets a sibling's declaration
excuse a drifting dialog — and it reads `commentsStripped`, NOT `codeOnly`,
because its variant needle must match inside a quoted attribute and `codeOnly`
blanks string literals: the exact trap `_source-scan`'s own header documents,
which the first cut walked straight into.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — drag an archive card
onto a different paragraph's side, and press only Return.

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

### The scope half: a question about a CONTAINER is not answered inside a LEAF

Same key, one container over (task 418) — and the case where ONE keymap's two
halves asked the same question from two different scopes, and only the half with
the wrong scope was destructive.

Gabriel, from a real paper: *"if i try to delete the line after 'spatial
relations to the self' it breaks the list. in general there are a lot of issues
with deleting empty lines under lists."* The shape on screen is a list item with
TWO children — `listItem(paragraph("Spatial relations to the self"),
paragraph(""))` — which Virgil's `listItem` content model
(`(paragraph | graphicsBlock) block*`) makes first-class and which arrives **from
ordinary `.tex` with no user gesture**: task 348's `tailSep` rule exists precisely
for a second paragraph in an item, and a stray anchor-only line parses into one
(the task-367 husk class). Upstream TipTap users rarely have multi-paragraph list
items; academic papers do.

Virgil disables StarterKit's `bulletList` / `orderedList` / `listItem` and ships
its own, and it did **not** disable `listKeymap` — so TipTap's `ListKeymap` owned
Backspace and Delete around lists. Its two halves:

- `Delete` → `isAtEndOfNode(state, "listItem")`, which resolves the ENCLOSING
  ITEM and compares `$anchor.pos + 1` against **its** content end. Item-scoped.
  Correct.
- `Backspace` → `isAtStartOfNode(state)`, which compares `$from.parentOffset` —
  the offset inside the **TEXTBLOCK**. A caret at the start of *any* block in the
  item satisfies it.

So Backspace on the empty line took the item-start branch and **destroyed the
item**. The keystroke costs IDENTITY: the merged or lifted item's `uuid` dies, so
every card, marginalia marker and sidecar `parTitle` keyed on it orphans — from a
press the user believes deletes a blank line.

> **A question about a CONTAINER is answered from the container's own boundaries,
> never from an offset inside a LEAF.** `atListItemStart`
> ([list-keymap.ts](src/lib/tiptap/list-keymap.ts)) is the missing twin of
> upstream's item-scoped `isAtEndOfNode(state, name)` — the exact mirror of its
> arithmetic — and `VirgilListKeymap` GATES the key on it before DELEGATING to
> upstream's own `listHelpers.handleBackspace` / `handleDelete`.

Six rules it earned:

- **Delegate; do not vendor.** `@tiptap/extension-list` exports its `listHelpers`
  namespace, so the replacement carries no copy of upstream's branch logic to
  track — the only Virgil code is the gate. That is strictly better than both
  obvious shapes: a higher-priority SHADOW cannot stop `ListKeymap` from running
  when it declines (a handler returning `false` does not block the next one), and
  a vendored ~80-line fork buys a maintenance debt for logic that was never
  wrong.
- **A declined press must cost NOTHING.** The gate `continue`s rather than
  returning true, so every later Backspace owner still runs and the key falls
  through to TipTap's core chain (`undoInputRule` → `deleteSelection` →
  `joinBackward` → `selectNodeBackward`) — plain ProseMirror, which merges the
  block into the one above it *inside the same item*. That fall-through is also
  why the gate needs no `undoInputRule` of its own.
- **Gate the START only; the END half was already right.** Re-deriving an
  item-scoped `atListItemEnd` would have been a FORK of a correct upstream helper
  — this file's own recurring finding, arriving as a tidy-up. The suite asserts
  the SYMMETRY instead (both halves answer `false` at a later block's boundary),
  which is the "two halves, one rule" contract stated as a claim rather than as a
  second implementation.
- **…and the leg that states it needs a NON-EMPTY later block.** In an empty
  paragraph the block's start and its end are the SAME position, so the two
  questions coincide by accident and the leg proves nothing. The fix's own first
  cut asserted it on the reported (empty) shape and failed for that reason.
- **The gate's array slot is not load-bearing, and that is a proof rather than a
  hope.** When it ALLOWS, the caret is by construction inside the item's FIRST
  child, which the content model pins to `paragraph | graphicsBlock` — so it can
  never be inside an `exampleItem`, a `latexComment` or a `codeBlock`, the only
  other blocks in this stack that own Backspace. It sits after
  `DocStructureObserver` + `BlockUuidBackfill` so the observer-first
  keystroke-sanctity invariant (`EXPECTED_MAIN_ORDER` index 1) is untouched.
- **Both surfaces carry it.** `listKeymap: false` is set at the ONE shared
  StarterKit configure site, so a card-body float would otherwise lose list
  Backspace handling entirely.

**Two of the filed diagnosis's predictions are REFUTED by measurement and
recorded rather than assumed** — the fix is the same either way, but a stated
mechanism that is false is how the next reader mis-scopes the next fix:

- the reported case takes the **lift** branch, not `joinItemBackward`. The branch
  selector `hasListItemBefore` probes `$anchor.pos - 2` — the same
  textblock-scoped mistake one helper over — and from a later paragraph that
  lands inside the PREVIOUS PARAGRAPH of the same item, whose `nodeBefore` is
  never a `listItem`. (At a genuine item start it lands on the item boundary and
  answers correctly, which is why gating the START question is sufficient and
  `hasListItemBefore` needs no second fix.)
- **an empty paragraph directly after a list is already deleted correctly** on
  this schema, and a non-empty one still merges into the last item. Both are
  pinned as CONTROLS rather than "fixed".

A third claim, checked and found to be a DESIGN decision rather than a loss: the
empty second paragraph's own `%!v:` anchor does not survive the round trip
(`%!v:bbbb` → the `%!v:blank` sentinel), because `listItem` is a
`DEFERRING_PARENT` — an inner paragraph yields identity to the item
(`assignUuids`). So the only identity at stake in the report was the ITEM's, which
is exactly what the keymap was destroying.

CI: [list-item-boundary-backspace.test.ts](src/lib/tiptap/__tests__/list-item-boundary-backspace.test.ts)
drives the REAL `buildEditorExtensions("main")` stack and dispatches real
`handleKeyDown` at eleven positions plus four Delete positions — a direct `tr`
dispatch cannot see this at all, since the defect lives entirely in which command
the keymap chooses. **No pre-418 suite could see it**: `listKeymap`,
`joinItemBackward` and `liftListItem` appear in no file under `src/`, there is no
list Backspace/Delete suite anywhere, and every list fixture in the repo has
SINGLE-block items, where the textblock-scoped and the item-scoped questions
coincide by construction. The leg with teeth is the CENSUS — the gate was never
the part that could misbehave, a StarterKit config edit that drops
`listKeymap: false` is, and that would silently restore the destruction. Measured
by neutering each half in turn: the pre-418 textblock-scoped gate takes 6 legs,
restoring upstream's `ListKeymap` beside the replacement 6 (five behavioural, one
census). Every control and every Delete leg passes either way, and says so.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live keymap gesture
plus a `.tex` round trip — no disk), so the check is cheap and real: make a bullet
list, produce a second paragraph inside an item, put the caret on the empty line
and press Backspace.

**Residual, stated.** This closes the list keymap's BOUNDARY question. What Enter
at the end of a list item should produce — one candidate producer of the husk —
is untouched, and whether an empty trailing paragraph inside an item should be
normalized away at all is a product call (it is also a legitimate mid-typing
state), deliberately left alone: this task fixes DELETION and leaves the model
alone.

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

### The projection half: a filtered view of a list is not an index space into it

Same law, and the case where the gap is not TIME but FILTERING (task 440). Task
285's Outline renders from a snapshot that can go STALE; the panel strip renders
from a projection that is never complete. `visiblePanels` is
`filterPanelKinds(chrome, …)` — narrowed by `chrome.visiblePanelKinds` — so an
integer counted off the rendered icons is not an integer into
`prefs.placements`, which is what `movePanel` spliced into.

`READER_CHROME.visiblePanelKinds` is the six reading panels and the shipped LEFT
placement order opens with `search`, which is not one of them. So the Library
Reader renders **5 icons over a 6-entry list** and every DOM index k addressed
model index k+1: drag `outline` into the gap between `citations` and
`bibliography` and it lands **before** `citations`, one slot early — every drop
below the first gap wrong by exactly the number of hidden panels above it.
Nothing throws and the placements list stays well-formed.

**The main app was correct by COINCIDENCE, and the coincidence is the finding.**
`FULL_CHROME` sets no whitelist, and the one registry kind with no strip (`omni`,
`defaultStripSide: null`) is dropped from `placements` at load — so the two spaces
happen to agree, and that agreement was the entire defence. It is one whitelist,
one per-doc hide or one search filter away from being false anywhere.

> **A gesture over a filtered view commits the IDENTITY of what it landed
> beside, never a count.** `movePanel(id, side, before?: PanelId | null)` —
> `before` is the panel the icon lands in front of, `null`/omitted appends — and
> the splice resolves it against the LIVE `placements` at apply time.

Four rules it earned:

- **Unrepresentable beats reconciled.** The surgical fix — translate the DOM
  index into a model index at the call site — is correct for today's one
  whitelist and leaves the integer contract standing for the next filter to
  rediscover. Taking an id removes the second index space instead of mapping
  onto it, and it survives ANY future narrowing of the strip with no further
  thought: the gesture then computes only *which rendered button the cursor is
  above*, which is the one thing it can actually observe.
- **This member ships with no grep, and the reason is stated rather than
  assumed.** Every other door law in this file carries a census because a call
  site that never asks it type-checks perfectly. Here it does not: `PanelId` is a
  string union, so an integer at the call site is a COMPILE ERROR, and `movePanel`
  is the only place a GESTURE writes placement order in either silo — checked,
  not assumed; the only other order-writer is the load-time merge that appends
  newly-shipped panels. The compiler is the census.
- **Resolve-or-append, and it is the right ANSWER as well as the safe rung.** An
  id no longer on that side — raced out by a peer window, or a visible-but-unplaced
  tail kind that has no placement row at all — degrades to append, exactly
  `resolveBlockIndex`'s read-degrades posture. It is also *correct*: the unplaced
  tail renders after every placed kind, so appending lands the icon precisely
  where dropping in front of that tail means.
- **The "which buttons count" rule stays spelled ONCE.** Task 439 moved it into
  the gesture's one geometry snapshot; the index survives only as indicator
  geometry and never leaves the module, while `beforeId` is what crosses the
  boundary. Hover and release read the same slot, so the line the user sees and
  the slot the drop takes cannot disagree (tasks 258/321/332).

CI: [strip-drop-identity.test.tsx](src/hooks/__tests__/strip-drop-identity.test.tsx)
drives the REAL `useViewPrefs` engine (ephemeral — the same engine the Reader
mounts) over the REAL shipped defaults and the REAL Reader whitelist, and SWEEPS
every gap on both sides rather than pinning one. **No pre-440 fixture could see
this**: every one drives the FULL placement list, where the projection and the
model are the same list by construction. Each case ASSERTS its own divergence
(the strip is shorter, and its first icon is not the model's first entry) so no
leg can pass by the two lists being trivially equal, and the defect leg
reimplements the RETIRED integer rule locally — measured, it is wrong at every
gap below the first, for every icon. The gesture half is in
[strip-button-drag-teardown.test.tsx](src/components/editor-layout/__tests__/strip-button-drag-teardown.test.tsx),
where the hover≡release leg derives the offered id from the PAINTED bar rather
than hard-coding it on both sides. Measured by neutering each half in turn: the
pre-440 integer commit takes 3 gesture legs, an always-append resolution 5 model
legs, and the non-regression sweep (no whitelist, both sides, every gap) is
byte-identical to the retired path either way — which is the point.

**Owed, not claimed:** the preview eyeball, which needs a real Library paper
open — in the Reader, drag `outline` between `citations` and `bibliography` and
confirm it lands there.

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

#### The derived-column half: 205's ladder reached two surfaces out of three

Same law, same question, one surface further (task 381) — and the case where the
derivation existed, was correct, and had exactly one consumer: the chrome that
decorates the answer, never the thing being placed.

A panel has ONE side. Task 205 established the ladder for MARGIN chrome
(`placements[].side ?? defaultStripSide`) and two other surfaces kept their own
answers. The strip-item filter inlined the ladder verbatim (harmless, a third
copy). The OMNI COLUMN did not derive at all: which column a category's cards
rendered in came from `prefs.omniCategories[side]` — stored per-side
enabled-category lists, seeded once from a `registry.omniSide` column and
re-derived by nothing. So dragging a panel's strip icon across moved its markers
and its rail (205's ladder) and left its omni cards in the old column, which in
Gabriel's own stored state additionally hides all cards, so they vanished
outright.

**The derivation that answers the right question already existed.**
`deriveCategorySides(placements)` shipped with the filter menu and its ONLY
consumer was the menu's chip list: it decided which rows a strip's filter
offered while the CARDS beside it read the stored table. A half-consumed SSOT —
the task-273 "a helper only SOME siblings call is not an SSOT" shape, in the
form where the sibling that skipped it is the one the user looks at.

> **One side fact per panel: `defaultStripSide` is the default,
> `placements[].side` is the user's live choice, and everything downstream —
> strip icon, margin marker, anchor rail, omni COLUMN, filter chips — DERIVES
> from [`@/lib/panel-side`](src/lib/panel-side.ts) (`resolvePanelSide` /
> `panelSidesFromPlacements`). `margin-side` is the card-chrome DOOR onto that
> leaf, not a second ladder.**

Six rules it earned:

- **The stored copy is DELETED, not merely aligned** (205's own rule, applied to
  its remaining surface). `registry.omniSide` and `DEFAULT_OMNI_CATEGORIES` are
  gone; `prefs.omniCategories` — a pair of per-side lists carrying BOTH side and
  visibility — became `omniHiddenCategories`, side-free. Leaving the side half
  written-but-unread is how the next reader concludes the column is stored.
- **Stored as HIDDEN, not enabled**, so a newly omni-eligible panel is visible by
  DECLARATION: no default list to keep in step with the registry, and nothing to
  migrate when one ships. The two facts are combined in exactly one place
  (`omniCategoriesForSide`), read by both hosts — the main app and the Reader,
  whose own `READER_CATEGORY_SIDES` was a third hand-built map of registry
  defaults sitting beside cards that read the stored lists.
- **A side-free fact takes no `side` argument.** `toggleOmniCategory(cat)` lost
  its side parameter rather than keeping it and ignoring it — a defaulted or
  vestigial argument is a decision nobody made, and the filter menu only ever
  lists categories the side already owns. `resetOmniSide(side)` keeps its side
  because the AFFORDANCE is per-menu; what it resets is visibility, since side
  membership is derived and has no default to restore.
- **`omniHideAllCards` stays per-SIDE, and the suite says why.** It describes a
  COLUMN ("show nothing in this gutter"), not a category, so it has no panel
  whose placement it could derive from — pinned so a later sweep does not fold it
  into the side-free set by symmetry.
- **A shipped default change is INERT without a migration, and worse than inert
  with the cron.** `loadPrefs` merges `DEFAULT_PREFS.placements` only for ids the
  blob is MISSING, so flipping `reports` to RIGHT (Gabriel's ask) reaches nobody
  who has ever opened the app — and the Tue/Fri promote-defaults cron folds the
  personal snapshot's `placements` back over the shipped JSON, so a
  defaults-only flip is UNDONE on the next tick (task 326's aiMarker shape).
  [`PANEL_SIDE_MIGRATIONS`](src/hooks/panel-side-migrations.ts) is the one-shot
  that makes it durable: once the stored value says right, the snapshot folds
  right and the cron converges.
- **A side flip is not idempotent by construction, so it carries an ID.** A
  RENAME is self-cancelling (the retired id is gone); a side flip is not — the
  user may deliberately drag the panel back, and a migration that re-applied
  every load would silently undo that forever. The id is recorded in
  `appliedPrefMigrations`, a GLOBAL pref (because `placements` is global — a
  per-window marker lets every other window re-apply the flip), and the
  no-stored-state branch records every migration as applied, or the newest user
  is the one "a deliberate drag sticks" fails for. The `from` side is part of the
  match, so a user who had already moved the panel is untouched.

The legacy per-side blob folds once at load (`hiddenFromLegacySides`: absent from
BOTH stored sides ⇒ hidden) and the key is then `delete`d, so it cannot
round-trip and re-fold over a hide/show made in between. `rename-panel-id` gained
a `LEGACY_ID_CARRIERS` list for it — a carrier the live `ViewPrefs` type no
longer has, which the type-derived census structurally cannot name, the same
reason `LEGACY_ACTIVE_PANEL_KEYS` exists — so a pre-381 blob's `comments`
becomes `revisions` BEFORE the fold reads it, rather than folding to "revisions
was never enabled". `filterOmniCategories` went with the carrier: it had no
production caller once the fold landed, and a suite is not a consumer (task 202).

CI: [card-side-derivation.test.ts](src/lib/__tests__/card-side-derivation.test.ts)
sweeps every omni panel × {all-left, all-right, unplaced} and asserts the strip,
the rail, the marker and the omni column give ONE answer — with a counter proving
the sweep crossed configurations where the RETIRED stored rule genuinely
disagrees, so it cannot pass by the two answers being trivially equal. Its defect
legs reimplement the retired rule locally rather than re-parameterising the live
one. The leg with teeth is the CENSUS: the derivation was never the part that
could misbehave — a surface reading a stored per-side list is, and
`prefs.omniCategories[side]` type-checked perfectly — so `omniSide` and
`DEFAULT_OMNI_CATEGORIES` are pinned dead, the surviving `omniCategories`
mentions are allowlisted per NAME with their reason (both halves asserted, so a
stale entry cannot pre-authorize a real read), and every omni HOST is DISCOVERED
from its own `getOmniEnabled` derivation and required to enter the shared door.
[view-prefs-side-migration.test.ts](src/hooks/__tests__/view-prefs-side-migration.test.ts)
drives the REAL `loadPrefs` for the halves neither can see: that the loader
applies the migration BEFORE the default merge, and folds the legacy key exactly
once. Measured by neutering each half in turn — restoring the stored-list column
takes 2 legs, restoring the pre-381 FORK (chips derive, cards do not) 2 more,
dropping the loader's migration 3, dropping the legacy fold 1, reverting the
registry flip 4 and the defaults-JSON flip 2, and hand-intersecting in one host 1.

**Owed, not claimed:** the preview eyeball. This class is NOT FSA-masked (view
prefs work in the dev preview), so the check is cheap and real — Reports on the
right rail by default, its markers and rail on the right, its omni cards in the
right column, and dragging ANY panel's strip icon across moving its cards with it.

#### The subscription half: every RENDERER of a live value subscribes

Same law, the half 205 and 381 both PRESUPPOSE (task 493) — and the case where
the read was live, the derivation was right, the comment said "override-aware",
and the subscription did not exist.

A card kind's accent is painted by FIVE renderers. Four re-derive the moment the
user picks a colour in a panel's picker: the docked card (`useCardTheme` →
`useSyncExternalStore`), the margin marker, the in-text anchor (an effect keyed
on `getPanelColorVersion`), and the highlight band (pure CSS off the anchor
accent var). The fifth — a popped-out card float — did not. `cardFloatable`
computed `headerTint` / `accentTint` with
`themeFromAccent(getPanelColor(CARD_REGISTRY[kind].themeKey))` and BAKED the
hexes onto the `Floatable`, and nothing in
`FloatHost → FloatWindow → FloatChrome → FloatingPanel` subscribed to the store.
`EditorPane` is `memo()`'d with no prop derived from panel colours, so a swatch
click caused **no render anywhere in that subtree**: the open float kept the old
header strip and the old window ring while everything else re-tinted — two
colours for one card in one window. It self-healed on the next unrelated
`EditorPane` render (a keystroke, a selection change), which is why it read as
intermittent rather than broken.

**This corrects a claim task 175 made and never verified.** 175's write-up listed
the float among the surfaces that already followed; its verification step was a
preview eyeball owed and never run, which is why the false claim survived.

> **A value that is a live function of app state is resolved at READ time from
> one authority (205) — and every RENDERER of it SUBSCRIBES. A live READ with no
> subscription is not a consumer; it is a value frozen at whatever moment its
> holder was last built.** So the colour leaves the value object entirely: a
> `Floatable` declares `themeKey` and the WINDOW resolves the paint.

Six rules it earned:

- **The fix is a RESHAPE, not a hook call.** Adding `useThemeVersion()` to
  `FloatWindow` closes M1 and M2 in two lines and leaves the hex on the
  `Floatable`, where the next reader takes it as a resolved value again. A
  `Floatable` is a DESCRIPTION of what to render, re-derived once per float-map
  rebuild; a colour that can change under it does not belong frozen inside one.
  What crosses the contract is the KEY — a fact about the float that cannot go
  stale.
- **The chrome stays card-blind.** `FloatChrome` receives a resolved tint, never
  a kind, exactly as its own comment requires; `PanelThemeKey` is a generic
  theme-registry name, not card vocabulary, so `src/floats/` naming one crosses
  no ontology.
- **The subscription is UNCONDITIONAL and the key is OPTIONAL**, which is why
  `useThemeVersion` is exported rather than the keyed `useCardTheme` being
  reused: a text-object float declares no key, a hook may not be conditional, and
  the cost of the neutral case is one version-counter compare.
- **The pure derivation is exported for the TEST and censused OUT of
  production.** `resolveFloatAccent` exists so the producer contract ("a note
  float's declared key resolves to the note theme's `headerDefault`") can be
  stated without the suite restating the accent → theme derivation — which is the
  fork this task closes. A production caller of it would be the pre-493 defect
  under a new name, so the census pins its readers to the hook alone.
- **M3 — the two halves of one identity read from ONE table.** `cardFloatable`
  DERIVED its theme key while every docked card RESTATED it as a literal
  (`useCardTheme("note")`, … — 15 sites). They agree today, so this was latent
  drift rather than a live defect: re-theme a kind in `CARD_REGISTRY` and the
  float follows while the docked card does not. `useCardKindTheme(kind)`
  ([src/cards/use-card-kind-theme.ts](src/cards/use-card-kind-theme.ts)) is the
  one door; the KIND literal stays at the call site (a `NoteCard` IS the note
  kind, and there is no second table there), and the THEME KEY leaves it.
- **Do NOT solve this by re-rendering `EditorPane` on a colour change.** That
  re-renders the whole pane — editor included — on every swatch click, for a 24px
  header strip.

The same pass deleted three DEAD props on `AppliedRecordBody`
(`cardKind` / `panelKey` / `themeKey`), declared and destructured by nothing, two
of which restated the accent binding as literals at their two call sites — the
task-227 WIRE-it-or-DELETE-it rule, and two fewer copies of the fact M3 unifies.

CI: [float-accent-follows-override.test.tsx](src/floats/__tests__/float-accent-follows-override.test.tsx)
renders the REAL chain (`FloatHost` → real `FloatWindow` → real `FloatChrome` →
real `FloatingPanel`) for a real note card inside `PoppedCardsContext`, reads the
painted `backgroundColor` off **`document.body`** — the panel PORTALS, so RTL's
`container` is empty and a leg reading it passes vacuously — then does the ONE
thing that happens (`act(() => setPanelColor("note", …))`) and asserts BOTH the
header strip and the float root's `--link-anchor-color` moved. Two controls keep
it honest: a docked `useCardKindTheme` reader re-renders and repaints in the same
harness, and an override on ANOTHER kind leaves this float alone. **No pre-493
suite could see any of this**: `card-floatable-header-tint` asks the BUILDER for
its hex (which was always live — rebuilding the floatable after an override
yields the new colour), and every chrome suite hands `FloatChrome` a
hand-supplied tint, so a RENDERED float failing to follow a store change is
unrepresentable in all of them. Its legs 1-2 are RENEGOTIATED in place with the
reason at the site, as is `card-theme-override-guardrail`'s task-175
`useCardTheme("todo")` pin — both stated the retired shape, and the contract each
asserts is unchanged. The leg with teeth is the CENSUS: the hook was never the
part that could misbehave, a chain that stops asking it is — so
`resolveFloatAccent` has exactly one production reader, the `Floatable` contract
carries a key and neither retired hex field, no float-chain file spells
`getPanelColor`/`themeFromAccent`, and no card component hands ANY panel-theme
hook a literal key. Measured by neutering each half in turn: dropping the
subscription takes 3 legs, and a docked card reverted to a literal 1.

**Owed, not claimed:** the preview eyeball, and it is exactly the check 175 never
got. NOT FSA-masked (localStorage + CSS + React state), so the unit contract is
durable proof and the eyeball is cheap: pop a todo out, set Todo → Purple, and
watch the float's header strip and window ring move with the docked card.

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
boundary** was still resolved by a raw `indexOf("\begin{document}")` at five sites — **closed by
task 375**, which found it was five sites in `src/` plus two more in the Python skills and worse
than this note recorded (see "The boundary half" below); `StyleApplyDialog.diffPreambles` counts
commented-out packages as things a style swap will destroy; and `compile-service`'s `hasBiblatex`
probe scans unprojected while its own neighbour `reference-resolution.ts` projects.

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

### The component half: an IMPORT is a claim that the file renders it

Same law, one medium over (task 495) — and the case where the dead export was a
whole FEATURE, its architecture doc opened by asserting the render that did not
happen, and the only instrument that could have seen it was drowned in its own
noise.

"Preference mode" is the ctrl+click-a-token-to-edit-it feature: turn the mode
on, `<body>` gains `data-pref-mode="on"`, every element carrying `data-prefs` /
`data-panel-theme` lights up, and ctrl+clicking one opens a picker for the
tokens it names. **None of it was reachable.** `EditorLayout` imported
`PreferenceModePicker` and never rendered it — and that picker was the only
place `usePreferenceMode`'s `on` was ever read, while its `toggle` had NO reader
anywhere (`EditorLayout` destructured both and used neither). So no button, menu
row or shortcut could flip the mode, the hook's body-attribute effect could only
ever REMOVE the attribute, the two rulesets gated on it (four selectors) were
unreachable, and four components went on stamping `data-prefs=` for a walker
that never mounted. `data-panel-theme` was consumer-ONLY — read by the picker
and by those rules, produced by nothing, while `panel-primitives` promised "the
header `<div>` below gets its own `data-panel-theme` annotation".

**And the docs asserted the opposite**, which is the load-bearing half.
`PreferenceModePicker.tsx`'s own Lifecycle contract opened with *"1. Host
(EditorLayout) renders `<PreferenceModePicker />` unconditionally"*, and
`usePreferenceMode.ts`'s threading map put a *"[top-bar button]"* under
`EditorLayout.tsx` that *"renders the toggle button; uses isOn & toggle()"* —
two files, two false claims, and the second went on to give a step-by-step guide
to EXTENDING the feature, so the next agent asked to make something
ctrl-clickable would have followed it and shipped a stamping site into a void.
The class this file names repeatedly ("a comment describing a retired mechanism
is how the next reader concludes the invariant is held"; task 395's "the prose
outlived the mechanism"), with the guide attached.

It was **superseded, not abandoned mid-build**: the render site was removed in
the same commit that introduced `SmartPreferences`, which IS mounted, DOES read
`usePanelColor`, and covers the same tokens through a modal. So the picker's job
was being done by a live surface and what remained was its corpse — which is why
the answer is DELETE (task 202's rule: *WIRE-it-or-DELETE-it, and a dead SSOT is
worse than none*) rather than a re-wire.

> **A component IMPORT is a claim that this file renders it.** A PascalCase
> value binding imported into a production module and never mentioned again is
> either a feature that does not render or a stale trace of one that moved —
> the same lie either way, and invisible: `tsconfig.json` sets no
> `noUnusedLocals`, so the compiler is silent BY CONFIGURATION.

Six rules it earned:

- **The census asks the BINDING, not the file.** The obvious form — *does a
  `<Name` tag exist somewhere in the repo?* — is VACUOUS on this very defect:
  `PreferenceModePicker` is a real component whose module really is imported, so
  a question keyed on the FILE passes while the binding is dead.
- **"Used a second time AT ALL", not "appears in JSX".** A JSX-only needle flags
  every legitimate non-JSX use of a component value (`React.createElement(Foo)`,
  a `Foo` handed to a registry, a `typeof Foo`), trading an EMPTY allowlist for
  a list of exemptions. The permissive form still catches the reported shape,
  because a dead import is dead in every spelling. Stated reach, the other
  direction: a binding MENTIONED but not actually rendered satisfies it — the
  same limit the dead-PROP sibling states about a prop destructured and dropped.
- **SCREAMING_SNAKE is out of scope, and that is what keeps the allowlist
  empty.** A constant is not a claim about rendering, it is eslint's question,
  and including it would put ~10 pre-existing hits into a list this census needs
  empty to be worth anything. A component name is PascalCase — at least one
  lowercase letter — which is the test React itself uses. That cannot separate a
  component from a PascalCase TYPE imported without the `type` keyword, and the
  census found one on its first run (`Side`, unused, deleted with the rest):
  recorded rather than narrowed, since the over-collection costs nothing while
  the allowlist is empty and narrowing it is a compiler's job.
- **M5 is DELETE and NOT "wire it", and the reason is the interesting one.**
  `useLoadPanelColors` was an exported hook with zero consumers whose docstring
  said "Load overrides on first client mount" — and moving the override load
  into its effect would REINTRODUCE the defaults-then-override flash that audit
  tick 33 refuted on the strength of the current shape: `loadPanelColors()` is
  read **synchronously in `EditorLayout`'s render body**, so the very first
  paint already carries the user's override. It is the tidier-looking
  implementation that would be WRONG, which is precisely why leaving it exported
  was a trap.
- **The half-alive third state is worse than either resolution.** Restoring the
  feature was a live option and the state was wrong under EVERY answer, so the
  docs half could have landed regardless — but with a live successor there is no
  capability to lose, and a feature reachable only by editing source is not
  reachable.
- **`findLeafByKey` went with it.** Alive only for the picker, in a module
  (`preferences-tree.ts`) that stays because five other consumers do read it —
  the file survives, the export does not.

**The noise IS the finding.** The census named EIGHTEEN bindings on the pre-495
tree and every one of them was in `EditorLayout.tsx` — no other production
`.tsx` in either silo had a hit. Seventeen besides the picker: `VirgilEditor`,
`FloatingPanel`, `DockOutline`, `CardLiftOutline`, `OmniFilterMenu`,
`ExamplesPanel`, `Side` and all ten panel `*Host`s, every one residue of the
extraction that moved it into `EditorPane` or an `editor-layout/` submodule.
`npm run lint` reported 89 warnings on that one file (69 after this), so an
unused import was ambient noise rather than a signal: the warning that would
have caught the eighteenth was buried under seventeen.

**Deleting an import can remove a module LOAD, so each one was checked for an
import-time side effect** — and one had a real one. `Editor.tsx` opens with a
bare `import "@/text-objects/floats";`, a registration barrel whose body runs
eleven `registerFloatBody` calls; `VirgilEditor`'s import statement SURVIVES the
edit but now binds only the `EditorHandle` interface, and under `isolatedModules`
a type-only-used binding is ELIDED, so `EditorLayout` genuinely stops loading it.
Safe because `EditorPane` value-imports the same module and `EditorLayout`
statically imports `EditorPane` — but the surviving statement is a false comfort,
and the ordering shift it causes is only harmless because every read of that
registry is render-time (`text-object-floatable.tsx`), never a module-scope
const, which is the invariant `stack-capture.ts` already records ("an affordance
must not depend on import order").

CI: [dead-component-import-guardrail.test.ts](src/__tests__/dead-component-import-guardrail.test.ts)
— the sibling of [dead-panel-prop-guardrail.test.ts](src/panels/__tests__/dead-panel-prop-guardrail.test.ts),
which asks the same question one level in (a declared PROP nobody reads).
Population DISCOVERED from what the repo ships (`trackedFiles`, both silos,
production `.tsx`) and pinned PER SILO — the two roots collapse independently,
and a library pin written as a path SUBSTRING answers true in any checkout that
happens to live under a directory called `library`. Allowlist EMPTY, with a
SYNTHETIC can-see canary spelling every shape that must and must not flag —
including a component named only in the comment above its own import, which is
exactly the disguise the reported defect wore. Beside it a retirement leg pins
ten needles dead in both silos, reading COMMENT-STRIPPED source on purpose: this
repo's convention is to renegotiate a retired claim in place with the reason at
the site, and a raw-source needle would make writing that sentence a test
failure — outlawing the very prose the fix is made of.

**And it carries the swallow self-check `_source-scan.ts`'s own header asks
every caller for**, because this census needs it more than a `toContain`-shaped
one does: 61% of its collected bindings sit at exactly TWO occurrences (the
import plus one use), so ONE swallowed line is a spurious failure with no
diagnostic. The obvious form of that check has no teeth and was MEASURED to have
none — a swallow eats to end of LINE, so counting surviving `import` lines sees
nothing, and planting a real JSX apostrophe leaves them all intact. So the
question is asked of the scanner itself: `swallowedLines` (exported from
`_source-scan.ts`, one implementation rather than one per caller, for the reason
`strip` has one) reports every line on which a quoted string opened and met a
newline. Measured by planting `Loading… it's almost ready` in a real component:
the leg fails and names `LoadingScreen.tsx:8`.

Measured by neutering back to the pre-495 tree: both legs fail, naming all 18
dead imports and every retired file; re-adding the `dataPrefs` prop alone fails
the retirement leg.

**Residual, stated rather than swept: the deletion ORPHANED a capability of a
shared primitive.** `PreferenceModePicker` was the only production consumer of
`SystemDialog`'s `variant="anchored"` — and of the `at={{x,y}}` and
`outsideClickGuard` props that serve it — so all three now have zero callers,
pinned only by `system-dialog-variants.test.tsx`, and a suite is not a consumer.
Neither census can see it: this one asks about IMPORTS, and the dead-PROP sibling
asks whether a prop is read in its OWN declaring file, which `outsideClickGuard`
is. Deleting an unused VARIANT of a shell every dialog in the app mounts is a
decision about the dialog system rather than a consequence of retiring a picker,
so what landed here is the half that is unarguable: the false prose. Both the
component's docstring and `STYLE_GUIDE.md` now SAY the variant has no consumer
and name WIRE-it-or-DELETE-it, instead of citing the deleted picker as its worked
example. A capability honestly labelled untaken is not the half-alive third state
— a capability whose docs still name a deleted exemplar is.

**Owed, not claimed:** nothing. This is pure module wiring plus CSS — not
FSA-masked, and the deletion is type-checked. The one visible change is a
`cursor: help` and a hover outline that could never appear.

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

##### The boundary half: the scan whose answer moves a SPLICE

Same rule, and the one the two sections above each recorded as an open residual
and neither could close from where it stood (task 375). A detector that believes
inert bytes reads the wrong ANSWER; the preamble/body boundary is a scan whose
answer decides where the document is CUT and where a splice LANDS, so the same
mistake writes a broken `.tex` instead of merely misreporting one.

Every reader located it with an exact-literal
`indexOf("\begin{document}")` / `indexOf("\end{document}")` over RAW bytes,
searched from index 0. Five members follow from that one decision. All five are
silent, all five are FIXED POINTS, and all five land on **OPEN** —
`readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad`
unconditionally, before the user has typed anything. Measured through the real
save cycle:

- **M1 — a preamble that merely MENTIONS `\end{document}` empties the whole
  body.** `endDoc` searched from 0 lands BEFORE `beginDoc`, so the body is
  ejected into the postamble: the editor shows one blank paragraph and the saved
  `.tex` carries two `\begin{document}` with a `\usepackage` after the first. A
  comment, a `\verb`, or a `\newcommand{\stopnow}{\end{document}}` all reach it.
- **M2 — a commented-out `% \end{document}` in the body is severed from its `%`
  and goes LIVE.** The cut lands inside the comment; the rest of the paper is now
  after `\end{document}` and never prints. Commenting out an early
  `\end{document}` to truncate a compile is one of the most ordinary things an
  author does.
- **M3 — a commented-out `% \begin{document}` is UN-COMMENTED by the requirement
  injector.** The splice lands between the `%` and the token, leaving the `%`
  alone on its own line and the token live — so the user's real `\usepackage`
  lines end up *after* `\begin{document}`, a hard LaTeX error, with the real
  begin following as a second one.
- **M4 — a verbatim-quoted `\end{document}` cuts the body mid-verbatim.** A paper
  that DOCUMENTS LaTeX loses everything from that line into the postamble, and a
  `%!v:` anchor is written into what remains of the block, where it prints
  literally in the PDF.
- **M5 — `\begin {document}` is read as "brand-new document".** TeX skips spaces
  while scanning the argument, so that is the same token; an exact literal misses
  it, `extractPreambleAndPostamble` answers null, and the null was read as *the
  file is new*. The whole file went through the body fallback while a style seed
  wrote a **different** `\documentclass` above the user's own.

**And no gate could catch any of it**, because `tex-preservation`'s `splitRegions`
used the SAME exact literal: a cut document measures with everything under body
on both sides and reports a shortfall of **0** in both regions. The word-measure
gates (350-D / 357) are structurally blind to a boundary that MOVED.

> **The preamble/body boundary is a question about LIVE bytes, asked at ONE door
> — [`findDocumentBoundary`](src/lib/latex-lexer.ts) — and the end is searched
> FROM the end of the begin token, never from 0.** A splice needs an offset into
> the RAW string, so the projection behind it BLANKS rather than deletes.

Seven rules it earned:

- **The design's own premise was FALSE, and checking it is what made the fix
  real.** The filed task said `projectDetectableLatex` "blanks bytes, so offsets
  are already preserved — confirm that and state it, since the whole design rests
  on it". It does not: it DELETES them and re-joins the lines, so an index into
  it is not an index into the source, and every injector that spliced at one
  would have spliced at the wrong place. `projectLiveLatex` gained a
  `preserveOffsets` mode — the ONE difference between the two forms is what an
  inert span BECOMES (a space, not a hole), so the two can never drift on WHICH
  bytes are inert, which is what every detector in the app depends on.
- **The family is FULL here and NARROW for detectors, and that asymmetry is
  deliberate.** A detector stays narrow for byte-compatibility of package
  injection (the P3 fork F1); a boundary is a structural question — the one
  `findSectioningCommands` asks — and an `\end{document}` inside a `lstlisting`
  or a `\verb|…|` is not a boundary by any reading. That is M4.
- **The token is a GRAMMAR, not a literal.** `\begin[ \t]*\{[ \t]*document[ \t]*\}`
  — horizontal whitespace only, deliberately, because `\s*` would let the token
  span a blank line, which is a `\par` and not a continuation. A `\begin%\n{document}`
  comment continuation is still not matched: a stated residual, and exactly
  today's behaviour, so no regression rides on it.
- **The user's own SPELLING is carried, never re-canonicalized.** For the
  ordinary token the preserved slice IS the literal byte for byte, which is what
  makes carrying the spaced form free; rewriting it would be a silent edit of a
  line nobody asked us to touch.
- **`null` from the boundary means "I cannot say", never "this file is new".**
  [`resolveWriteDelimiters`](src/lib/latex-parser.ts) is the door every save path
  enters, and it has three answers: an EMPTY file seeds from the style (the
  brand-new case the seed was written for), a located boundary gives the user's
  verbatim delimiters, and **bytes with no locatable boundary** — a fragment a
  master file `\input`s, a preamble-only file, a mid-edit `.tex` — gives
  `{ preamble: "", postamble: "" }`: the whole file is body, so it is written
  back as body with nothing prepended. **A `.tex` with bytes in it must never have
  its preamble replaced by a write nobody asked for**; where we cannot say where
  the preamble ends, the honest answer is to add none. `assembleLatex` reads
  `??` rather than `||` for exactly that: an explicit empty preamble is an
  ANSWER, where `undefined` (a caller that stated nothing) still falls back.
- **The generic primitive earns its keep in ONE silo and is not exported in the
  other.** Python gets `first_live_index_of`, because `region-replace`'s
  `endMarker` is caller-supplied; TypeScript does not, because over there every
  boundary question IS the document boundary and an export with no caller is the
  dead-SSOT shape (task 202). Stated at the Python site rather than mirrored for
  symmetry.
- **The gate must split the document the way the parser does**, or it stays blind
  to the very thing it guards — so `tex-preservation`, `write-preservation` and
  `_common.py`'s `split_regions` all take the same rule. The Python port is held
  to the TS one by a second GOLDEN section in the shared corpus
  (`preservation-corpus.json`'s `boundaryCases`, generated from the shipped TS
  implementation) plus a membership leg pinning `VERBATIM_ENVS_FULL` — which
  caught this task's own port carrying an extra `alltt` the TS family
  deliberately excludes.
- **Unterminated ⇒ TRANSPARENT, and the adversarial pass on this fix is what
  found it.** The projection's default swallows an unclosed verbatim open to the
  end of the source, matching how TeX lexes it — right for a detector, which
  should fail toward not-detecting, and wrong for a boundary: a half-typed
  `\begin{comment}` in a preamble is an ordinary mid-edit state in the code pane,
  and swallowing to EOF erases the `\begin{document}` under it, so the boundary
  vanishes and the save writes the whole file back as body with a `%!v:` anchor
  on every preamble line. That is this repo's own 350/356 rule one layer down.
  `unterminatedIsLive` is OPT-IN, so no detector's answer moved, and a CLOSED
  open is still opaque — which is M4, and the control that keeps the rule from
  reopening it.

Converted: both parser sites, `stripPreamble`, `ensurePreambleRequirements`,
`injectTitleFieldsIntoPreamble`, `mergeTitlesIntoStylePreamble`,
`applyRequirementsToFile`, both preservation gates, `useDocumentStyle.setStyle`
(the whole-preamble style swap — the most destructive splice Virgil makes),
`StyleEditorModal`'s validator (whose two private regex copies rejected a style
blob for a token the compiler never sees), `bib-family`'s and `livePreamble`'s
own splits, and on the Python side `split_regions`, `apply_response.py`'s
`region-replace` splice and its one-`\begin{document}` structural invariant. The
dev backend's three hand copies of the seed rule folded into one
`buildDevSerializeOpts`, the twin of `storage-fsa`'s.

CI: [preamble-boundary-liveness.test.ts](src/lib/__tests__/preamble-boundary-liveness.test.ts).
**No pre-375 suite could see any of this**: every `.tex` fixture in the repo
spells its boundary the one way the code happened to handle, exactly once, live —
so a boundary that MOVES is unrepresentable in all of them, which is how five
members shipped with 7 860 tests green. Each leg drives the REAL save pipeline
over TWO cycles with controls through the identical harness, and asserts content
is inside the printed BODY rather than merely present in the FILE — presence is
what a moved boundary preserves, and asserting it is how such a leg passes
vacuously. The leg with teeth is the CENSUS: no production file may pair a
boundary token with a search verb or a regex (allowlist EMPTY — a hit is
MIGRATE-it), and every file that merely SPELLS one must be a declared EMITTER,
so a new file has to say whether it writes a token or looks for one. Measured by
neutering each half in turn: the live projection takes 7 legs, the token grammar
3, the from-bodyStart ordering 1 (the `\newcommand` shape — M1's comment form is
closed by EITHER half, which is why that leg exists), and the seed rule 1.

**Residuals, stated.** The projection's own over-strip is inherited whole (the 345
residual): a raw `%` inside a `\verb|100%|` or a `\url{…a%20b}` truncates the rest
of that LINE, so a `\begin{document}` SHARING such a line is not found and the
file is written back as body-only. Measured, the write gate REFUSES that write —
the regions disagree across the two sides — so the failure direction is a banner
the user must acknowledge rather than a silent loss, and `\begin{document}` shares
its line with nothing in any real paper. The comment-continuation spelling
`\begin%\n{document}` is likewise not matched, which is exactly today's behaviour.
Neither is closed here, because both belong to the projection's own residual list
rather than to the boundary.

**Owed, not claimed:** a real-FSA open of a paper with a commented-out
`\end{document}`. Nothing here is FSA-masked — it is all `.tex` bytes through the
real save cycle — but the class lands on OPEN, so one eyeball is worth having.

#### The reader half: a LINK resolves where the READER is, not where the author sat

Same law, the other end of the same deployment (task 506) — and the case where a
stated limit was right about one layer and wrong about the one an agent reads
from.

A skill is authored in the repo and READ on a user's synced folder, and the two
layouts are not the same shape:

```
repo                        synced folder
editor/skills/X.md     →    .claude/commands/editor/X.md
editor/scripts/Y.py    →    .virgil/scripts/editor/Y.py
docs/workspace/Z.md    →    .claude/virgil/Z.md
```

In the repo `editor/skills/` and `editor/scripts/` are siblings; on disk
`.claude/commands/editor/` and `.virgil/scripts/editor/` are not. Task 461's
`skill-include-links.test.ts` asserted only the REPO half and named the bundle
half as a stated limit — but its reasoning ("both builders map `<silo>/skills/*`
→ `claude-commands/*` and `<silo>/scripts/*` → `scripts/*`, so the relative shape
survives") is true of the BUNDLE path, where those two ARE siblings under
`public/skill-bundle/<silo>/`, and FALSE of the DISK path. So the 25 links
spelled `../scripts/<helper>.py` were counted as safe while landing at
`.claude/commands/scripts/…`, which exists nowhere; and the 13 spelled
`../../docs/workspace/<doc>.md` landed at `.claude/docs/workspace/…` while the
file itself sat two directories away at `.claude/virgil/<doc>.md`. **Thirty-eight
dead pointers in shipped skills** — a responder skill following one on a real
paper folder gets nothing.

> **A relative link in shipped markdown is re-spelled at the bundle boundary as
> the target's SHIPPED path relative to the linking file's own SHIPPED path —
> both halves read out of ONE map, so they cannot disagree by construction.**
> [`library/build/bundle-sources.mjs`](library/build/bundle-sources.mjs) is that
> map (`shippedPathMap` / `shippedBytes`), and it is also the ONE answer to
> "which files ship?" — four builders and two guards used to hold six
> hand-written copies of that filter.

Seven rules it earned:

- **The rewrite is DERIVED, not a prefix table.** `rewriteScriptPathsForPaper`
  (the pre-existing prose-prefix rewrite, which fixes `python3
  editor/scripts/X.py` INVOCATIONS and is editor-only for a stated reason) is a
  hand-kept pair list. The LINK rewrite reads the map, so a link family nobody
  has written yet is correct for free — and the manifest docs' own pointers into
  the skill set (`.claude/virgil/cards.md` → `../commands/editor/…`) came right
  with no rule about them at all.
- **A link whose target does NOT ship is left exactly as authored**, and whether
  such a pointer belongs in a shipped SKILL is a separate question the guard asks
  separately. Rewriting it would be inventing a path; deleting it would be losing
  a pointer a maintainer reading the repo wants.
- **A repo-only SKILL is declared by a property the corpus already reads.**
  `dream`, `reflect`, `iterate-virgil-editor` and `iterate-skill` open their
  `description` with `Developer-only` — exactly what `virgil/skills/start.md`
  rule 1 routes on ("Do not offer one to an end user"). The builders read the
  SAME declaration and do not ship them, which turns that rule from advisory into
  structural (a skill that is not there cannot be offered) and removes ~72 KB of
  no-op prompt from every paper folder. Discovered, never a name list. They stay
  MIRRORED into `.claude/commands/<silo>/`, because that mirror is the repo's own
  developer surface.
- **The freshness guard needs TWO populations, and they are the same fact.** A
  paper-shaped mirror carries what the bundle SHIPS in the bytes it ships them
  with; the repo's dev mirror carries every non-underscore skill from unrewritten
  source. One `paper` flag decides both, because the shipped SET and the shipped
  BYTES both come from the same module.
- **A drift check asks the bundle what it BUILT FROM rather than re-deriving the
  transforms.** Markdown does not ship verbatim, so a check that DIFFS shipped
  bytes against the SSOT must know every transform — and the day one is added and
  that side has not learned it, every command markdown reports as drifted, every
  night, which is the fastest way to make a check ignorable. `dream.py`'s §1
  preflight used to parse the builder's `PAPER_SCRIPT_PREFIXES` out of the `.mjs`
  source and went quietly `None` for three days when task 374 changed that
  constant's shape. Each sub-manifest now records `sourceDigests` — per shipped
  file, its `repoPath` plus the sha256 of the bytes it was built FROM — and the
  drift check knows no transform at all. Sixty lines of parser and four tests
  deleted; fail-closed on a bundle with no digests, because an empty list there
  would read as "clean" for the whole silo.
- **The census asks the QUESTION, not the mechanism** (task 404's rule). Leg 2
  sweeps every shipped `.md` in every subsystem — the manifest docs included —
  and is satisfied BY CONSTRUCTION, so what it pins is that the rewrite is WIRED,
  which is the part that can silently stop happening.
- **Leg 3's population is SKILL markdown, and the exclusion is stated rather than
  allowlisted.** The operational manifest carries ~200 pointers into `src/**` and
  `docs/architecture/` — provenance notes for a maintainer reading the doc in the
  repo, not navigation an agent performs — and whether a reference doc should
  carry them at all is a product question about that doc's audience. Leg 2 still
  covers its links whose targets DO ship, which is the half that was silently
  broken.

CI: [skill-include-links.test.ts](library/lib/__tests__/skill-include-links.test.ts)
(461's repo leg, plus the two above, both allowlists EMPTY),
[build-editor-bundle.test.ts](editor/build/__tests__/build-editor-bundle.test.ts)
(which transforms a given file takes), and
[skill-bundle-freshness.test.ts](editor/skills/__tests__/skill-bundle-freshness.test.ts)
(the two populations). Measured by neutering each half in turn: dropping the link
rewrite takes 1 leg naming all 38 dead pointers, a shipped skill pointing at a
non-shipping file 1, and reverting `dream.py` to the prefix parse 1. **No pre-506
suite could see any of this**: 461's leg resolves against the REPO tree, where
every one of the 38 links is perfectly valid.

**Verified on a REAL synced layout** rather than only structurally: after a
rebuild, `library-data/`'s `.claude/commands/**` holds **zero** unresolved
relative links (326 resolve); the 204 that do not all sit in `.claude/virgil/`
and are exactly the manifest-doc residual named above.

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

##### The reach half: a census that discovers by MECHANISM cannot see a reader that only asks the QUESTION

Same set, and the case where the SSOT was right, the write side was right, the
round trip was right, and the guard that would have caught the rest had a
POPULATION scoped to the write side's silo (task 404).

343 gave `parTitle` its declaration and pinned it with a census whose scope is
DISCOVERED rather than hand-listed — the rule this file states everywhere, and
correctly applied. What it discovered by was the sidecar `paragraphs` MAP: the
mechanism the WRITE side uses. So its population was the parser and the
serializer, and **five UI READERS each hand-listed THREE of the set's six
members**, none of them ever in the population:

| reader | what it costs |
|---|---|
| `section-path.ts` — the shipped breadcrumb primary | the breadcrumb omits the titled block you are standing in |
| `OutlinePanel.tsx` | no Outline row at all: nothing shows the title, renames it, or folds it |
| `SearchPanel.tsx` | a hit inside the block breadcrumbs to the section instead |
| `EditorLayout.tsx` — the section tracker's legacy fallback | a fast-path/fallback divergence |
| `reader-view-prefs.ts` — the Reader's twin | the same, one surface over |

A title typed on a `texBlock`, a `forestBlock` or an `exampleBlock` was written,
persisted, reloaded onto the node — and invisible on every surface that could
have shown it. Nothing threw; the round trip that 343 pinned was intact the
whole time. **The suite's third layer was even NAMED "the round-trip layer holds
no second hand list" — the scope sentence IS the defect.**

> **Discover a census's population by the QUESTION, not by the MECHANISM.** The
> question here is the ATTR NAME; the mechanism is one silo's way of touching
> it. A file that only ASKS ("is this block titled?") writes no sidecar map,
> spells no write-side API, and is invisible to any predicate written about how
> the answer gets to disk.

Six rules it earned:

- **The defect is a partial READER, not a missing affordance**, and the framing
  is what scopes the fix. Nothing in the Outline can CREATE a title; the Outline
  could only fail to show one that already existed. So the fix is five call
  sites, not a new surface.
- **It must LEAD with the shipped primary.** `computeSectionPathAt` is the path
  that actually runs; the `EditorLayout` / `reader-view-prefs` walks are its
  FALLBACKS. Converting the fallbacks alone is a no-op that introduces a
  fast-path/fallback divergence — the thing each fallback exists not to be.
- **A written decision is renegotiated in place, never silently contradicted.**
  `section-path.ts` carried one — *"tex/expex par-titles are deliberately not
  breadcrumb entries"* — which read as a bug-compatible port of the fallback's
  vocabulary rather than independent product judgment. It is retired with its
  reason at the site: a breadcrumb that omits the block you are standing in is
  the invisibility bug by another name.
- **Where the derived flag is TOTAL, the flag IS the membership test.**
  `BlockEntry.parTitled` is `deriveParTitled(attrs)`, and ProseMirror drops an
  undeclared attr — so only a member can carry one and there is no second
  vocabulary to drift. `section-path` reads the flag alone; the four JSON/PM
  walkers, which see raw nodes, ask `TITLED_NODE_TYPES.has(...)`.
- **The MUTATOR's domain is the set too, and a NEGATIVE guard is not a domain.**
  `renameParTitleByUuid` guarded `node.type.name !== "heading"` — right about the
  one type it names (`OUT-F8-04`) and wrong at both ends: it admits every titled
  kind by luck, and it admits every type that declares no `parTitle` at all,
  where PM drops the attr, `setAttrs` reports success, and the rename is a
  mis-write that silently did nothing. The positive test refuses a heading for
  exactly the same reason it refuses a `figureBlock` — neither is a member.
- **The IMPORT leg stays narrow while the HAND-LIST leg widens**, and that
  asymmetry is deliberate: "does the file that must enumerate node types read the
  SSOT?" is a claim about the round-trip layer, and a NodeView that declares
  `parTitle` on ONE node type answers no set question and owes no import. Two
  populations, two questions — widening both would be a census demanding a
  dependency nothing needs.
- **The DECLARATION is not a copy of itself.** The pre-404 predicate excluded the
  leaf by accident (it touches no `paragraphs` map); the attr-name predicate has
  to STATE the exclusion, and states it by PATH rather than by segment content —
  an allowlisted segment goes stale the moment a member is added, and would
  excuse the same literal appearing elsewhere.

**Deliberately NOT generalized to `COLLAPSIBLE_NODE_TYPES` /
`UUID_BEARING_NODE_TYPES` / `CARD_BODY_BLOCK_ATOMS`** — checked, and none has a
partial reader. The phenomenon is specific to `parTitle`'s UI silo, and widening
here would be the "broadest blast radius" mistake the central principle warns
against.

**DISPLAY is undifferentiated, stated at the site:** every titled kind's Outline
row takes the one `--par-title-color-dense` ink, because that is what the set
already means. Typing the rows by kind is a `STYLE_GUIDE` decision worth its own
pass.

CI: the widened census in
[node-attr-sets.test.ts](src/lib/__tests__/node-attr-sets.test.ts) is the leg
with teeth, and its membership assertion names all five readers plus the mutator
— reverting ANY ONE of them to its three-name chain can only fail the hand-list
leg while that file is in the population at all. Beside it, the behavioural
halves are swept FROM the set, so a seventh titled kind arrives with no fixture
and fails before it can ship: `renameParTitleByUuid` is driven per member in
[structural-edit.test.ts](src/lib/tiptap/__tests__/structural-edit.test.ts) with
`figureBlock` as the control the negative guard admitted, and `extractHeadings`
per member in
[outline-fold-by-uuid.test.ts](src/panels/Outline/__tests__/outline-fold-by-uuid.test.ts)
— a row exists, and its uuid is INSERT-STABLE, so the persisted fold bucket still
holds the same string after a block is added above. Measured by neutering each
half in turn: each of the five readers takes the census (measured per reader, not
assumed), the negative mutator guard takes 1, and the pre-404 OutlinePanel chain
takes 6 — three missing kinds × two legs, with the three working kinds passing as
controls.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture
plus a JSON walk — no disk), so the check is cheap and real: give a `texBlock` a
title from its pod's `+T`, and the Outline shows it, renames it, and folds it.


#### The multiplicity half: a scan that recognizes a CONSTRUCT must recognize how MANY

Same round trip, and the case where the model held exactly one of something a
figure may carry several of — so the extras strip cut EVERY occurrence while the
emitter re-wrote ONE (task 379). Three members, all silent, all landing on OPEN
via `readDocBundle`'s unconditional load-writeback, and none of them visible to
the write gate (the shortfall is 3 word tokens against
`PRESERVATION_SLACK_WORDS = 4`):

- **A second figure-depth `\label` was DELETED, and the WRONG one survived.**
  `extractFigureAttrs` kept `labels[0]` — the first in source order — while the
  strip cut them all. `\caption` calls `\refstepcounter{figure}`, so a `\label`
  written after the caption is the key that names the figure and one written
  before it names whatever was stepped last (normally the section). So
  `\includegraphics{a}\label{fig:one}` + `\caption{c}\label{fig:two}` came back
  with `fig:two` gone and `fig:one` silently PROMOTED from naming nothing to
  naming the figure: every `\ref{fig:two}` in the paper became `??`, and every
  `\ref{fig:one}` started resolving to a number it had never had.
- **A caption-carried label plus a body-level one looked fine for ONE cycle.**
  Cycle 1 kept both (the attr held `fig:out`, the caption's own bytes held
  `fig:in`); cycle 2 read `labels[0]` as the in-caption `fig:in`, suppressed the
  figure-level emit as a duplicate declaration, and cut `fig:out` out of extras —
  so the body-level key vanished on the SECOND save. Not a fixed point, which is
  the one thing the corpus invariant could have caught if any fixture had had the
  shape.
- **Two figure-depth `\caption`s OSCILLATED forever.** The scan takes the first
  and the strip cut only that one, so the leftover was re-emitted from `extras` —
  i.e. AHEAD of the caption the model kept. The two traded places on every save
  of a document nobody was editing, moving the `.tex` under the disk ledger, the
  DiskWatcher and git.

> **The model holds ONE caption and ONE label, so the strip cuts exactly those
> two and everything else survives — on the SIDE OF THE CAPTION it was written
> on.** `extras` is the body before the caption and `trailingExtras` the body
> after it; the emitter writes `extras + \caption + \label + trailingExtras`.
> And the label the model keeps is the one LaTeX would resolve `\ref` to: the
> FIRST at or after the caption, falling back to the first when there is none.

Four rules it earned:

- **The position is the whole of it, and a plain `extras` is not enough.** The
  site's pre-379 note said leaving extras in `extras` "would move it ahead of the
  caption on re-emit and oscillate", and measurement confirmed that for the
  no-caption pair. But oscillation is the lesser half: a label re-emitted on the
  wrong side of the caption **stops naming the figure**, silently. So the carry
  is position-aware — task 342/356's "carry what you cannot model, in the
  position it was in", read one axis in.
- **No cut can straddle the pivot, which is what makes the split arithmetic
  honest.** The pivot is the caption's start (or the binding label's, or the end
  of the body), the caption cut begins exactly there, and a binding label outside
  the caption lies wholly on one side of it. Stated at the site rather than left
  to be re-derived.
- **The second caption cost nothing extra.** Nothing in the split is
  label-specific — it cuts the two commands the model holds and carries the rest
  — so the caption oscillation closed by construction rather than by a second
  rule. That is the test of whether a fix is at the right altitude.
- **`extractLabel` was DELETED rather than corrected.** An exported helper with
  ZERO callers anywhere (task 202's dead-SSOT shape) that stated the RETIRED rule
  — the next reader reaching for it would have re-introduced the defect with a
  name that looked authoritative.

**Stated normalizations, both one-time and idempotent.** A `\caption` written
INSIDE a transparent box env (`\begin{center}…\caption{C}…\end{center}`, a very
common idiom) now stays inside it, where pre-379 the whole box was extras and the
caption was re-emitted after `\end{center}`. And a trailing comment after the
caption stays after it rather than being hoisted above. Both are improvements in
fidelity and both are fixed points from cycle 1.

CI: [figure-multi-label-roundtrip.test.ts](src/lib/__tests__/figure-multi-label-roundtrip.test.ts).
Its shape is the point: `figure-roundtrip.test.ts` has asserted "every `\label`
survives EXACTLY once" over a corpus since task 245 and was **green on the
pre-379 tree**, because no fixture in the repo had ever carried two figure-depth
labels — a vacuous invariant, which is the same blindness the `\caption*` star
(376 M4) and the `parTitle` write-set (343) each shipped behind. Every leg runs
TWO cycles (cycle 1 is where a loss lands, cycle 2 is where an oscillation shows)
and asserts bytes, survivor and fixed point together, with four single-label
fixtures as passing CONTROLS. The corpus gains four entries so its own invariants
speak for the shape at all. Measured by neutering each half in turn: reverting to
`labels[0]` takes 4 legs, reverting to the cut-every-label strip takes 10.

**Residual, stated.** The DECLARATION scan (`declareFromRawLatex`) reads the two
halves as ONE joined string rather than twice, because the projection is stateful
over what it is given and a `\begin{verbatim}` opened in `extras` and closed in
`trailingExtras` must be seen as the pair it is — which also keeps task 345's
census at its deliberately brittle "exactly two callers".

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

- **Promotion needs a WRITER — and so does DEMOTION** (the symmetric half, task
  390, below). The carrier marks only a construct the transaction's own changed
  ranges TOUCH, and un-marks only a run they touched that the scanner no longer
  claims. Merely existing is not evidence in either direction: a literal
  backslash that arrived from a source `\textbackslash{}` is byte-identical to a
  typed command, so promoting it on an unrelated keystroke elsewhere in the
  paragraph would re-create the very corruption this closes — and the parse rung
  carries constructs this scanner deliberately declines, so demoting one on an
  unrelated keystroke is that corruption's mirror image. That the correctness
  rule and the keystroke-sanctity rule turn out to be the SAME rule — *look only
  at what the edit did* — is what makes the cheap implementation the correct one
  rather than a compromise.
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

##### The other direction: deleting what made a run LaTeX is a WRITER too

Same carrier, and the case where the derivation was true on the way UP and a
one-way ratchet on the way down (task 390). 360 states that the mark IS derived
from the text; its fourth rule then declared the plugin **ADDITIVE only**, on the
sound ground that the parse rung carries constructs this scanner deliberately
declines (the braces of a source `{a, b}` group, 349 M6), so a re-derivation that
also removed would strip them on the next keystroke in that paragraph. That
ground argues for SCOPING the removal, not for refusing it — and refusing it left
two things wrong at once:

- **The mark could never come off.** Type `\` in front of a word, delete the `\`,
  and the word stays grey **forever** (Gabriel's screenshot: `Overall`,
  `Scenario`, rendered as raw-LaTeX runs with no backslash in sight). No
  affordance short of deleting and retyping the word; for a bare word, only a
  full reload's re-parse healed it. And the block gate compounded it — the scan
  ran only where the text still held a `\` or a `{`, so the one block a deletion
  had just emptied of both leads was the one block a demotion-aware scan would
  never have looked at.
- **…and a stale carrier is a BYTE hazard, not cosmetics.** The mark's serializer
  contract is EMIT RAW. Type `x \% y`, delete the `\`, and the `%` sits under the
  mark and reaches the `.tex` **live**, commenting out the rest of that source
  line — which post-347 the next parse reads back as a comment tail. Same story
  for `&`, `_`, `#`. The gap silently flipped the emission semantics of whatever
  the user left behind.

> **One scanner, two texts, the same question.** Promotion asks *did this edit
> WRITE this construct?* of the NEW text. Demotion asks it of the OLD text —
> because a construct the user has just dismantled leaves nothing in the new text
> to gate on. The mark then comes off exactly the touched runs the scanner no
> longer claims, and off nothing else.

Five rules it earned:

- **The old text is not a convenience, it is the only thing that can answer.**
  Deleting the `{` of `{\bf hi}` orphans its `}` six characters away: the
  deletion's own changed range is ZERO-WIDTH at the start of the block, `\bf hi}`
  says nothing about the pair, and the old scan says everything — both braces
  carry the group's own extent, which is the field `RawLatexSpan` already had for
  promotion's sake. Gating on the changed ranges alone closes the reported bug
  and leaves its group twin live, which is how a surgical "backspace removed a
  `\`" fix would have shipped.
- **Adjacency has to count, and it is the SAME predicate promotion uses.** A
  deletion's changed range is zero-width in the new document, so a
  strict-overlap test makes the commonest demotion there is invisible. One
  `touches`, both directions, so the two halves cannot come to disagree about
  what "the edit reached this" means.
- **Protect broadly, demote narrowly.** Every span the new scan produces
  protects, whether or not this edit touched it and whether or not promotion
  declined it for an OPAQUE crossing. A missed demotion is the status quo; a
  wrong one changes the bytes. The OPAQUE disjunct is the one with no other
  witness: mirroring promotion's own guard four lines above reads as a tidy-up
  and destroys `\foobar{<citation chip>}` — measured, that one-line change
  passed every other leg in the file, so it has a leg of its own.
- **A BRACE IS NOT A CONSTRUCT ON ITS OWN, so an INTACT marked pair never
  demotes.** The carrier marks a `{`/`}` only as a group's DELIMITERS —
  promotion gives the pair one shared extent and marks them together — so a
  demotion that takes one and leaves the other emits *unbalanced* LaTeX: the
  demoted brace goes through the escape rung to `\}`, the next parse reads it
  as the literal character it now is, and the surviving `{` has no partner. The
  paper stops compiling, and the 357 write gate cannot see it (`\}` against `}`
  moves zero word tokens). The shape that reaches it is ordinary: the two braces
  of a SOURCE bare group are permanently stale here (349 M6 carries them, this
  scanner declines them), they are two SEPARATE marked runs, and the adjacency
  rule reaches exactly one of them for a keystroke immediately before the `{`,
  immediately before the `}`, or immediately after it — all three of which
  emitted unbalanced braces, MEASURED. **Both-or-neither was the first fix and
  is not the right one**: it keeps the output balanced and still escapes a pair
  when the edit reaches both sides, which for `caf{\'e}s` means deleting the
  accented letter silently turns a grouping into printed braces. A brace demotes
  only when its matching marked partner is GONE, which is strictly better on
  every case — the group twin (`{\bf hi}` minus its `{`) still demotes its
  orphan, and `\emph{hi}` minus its lead now saves as `emph{hi}`, exactly what a
  re-parse of those bytes produces, where escaping the pair diverged from it.
- **The block gate gains its third disjunct, and most of the demotion it opens
  is FREE.** Scan the block when it still CARRIES the mark even with no lead
  left — and then skip the scan, because with no `\` and no `{` it is provably
  empty. The marked-run walk costs nothing extra either: it rides the walk that
  already had to happen to build the text. Measured: a stranded bare word costs
  ZERO scans, a keystroke beside a settled command still costs ONE, and the
  broken-construct recovery costs a second — of that one block's prior text.
  **What is NOT free, stated because the first draft of this section said it
  was:** a block holding a run this scanner permanently declines while the parse
  rung carries it — again the source bare group — has a "stale" run forever, so
  every keystroke anywhere in that block pays the recovery. Block-bounded, never
  document-bounded, so the law holds; roughly 2x the carrier's per-keystroke
  work in that one paragraph, and pinned by its own leg rather than described.
  **And the trigger class is RARER than that reads**, measured rather than
  guessed: swept over every `.tex` in the repo, essentially every bare-looking
  group inside `\begin{document}` is a `]{…}` command argument, which the
  scanner CLAIMS (so it is covered and never pending); the only genuinely bare
  groups sit inside a `texBlock`, which `allowsMarkType` skips before any of
  this runs; and the `{\'e}` → `{é}` idiom the docstring names appears in the
  `.bib` files and in ZERO document bodies. Stated so the next reader prices it
  correctly — it is a real per-keystroke doubling in a paragraph that has the
  shape, and almost no paragraph does.
- **The result is parse-consistent, so nothing oscillates.** `\emph{\bf hi}`
  minus its lead demotes `emph` and the group's prose and keeps the braces and
  the `\bf` — which is exactly what parsing `emph{\bf hi}` produces. Where the
  two answers differ they differ for the reason 349 M6 already records (a typed
  group is not a source group), and both sides are fixed points.

**Residuals, stated.** A PASTE is a writer in both directions, symmetrically with
360's own rule, so a pasted run's non-brace bytes demote; its brace pairs do not,
by the rule above. And the recovery is not free on every block — see the cost
rule. Both are the standing typed-vs-source group asymmetry, touch-scoped, and
the mirror of the residual promotion already carries (an edit INSIDE a literal
backslash promotes it).

CI: the same [typed-raw-latex-carrier.test.ts](src/lib/tiptap/__tests__/typed-raw-latex-carrier.test.ts),
in its own shape — a REAL editor, typed character by character, then the real
deletion. The leg with teeth is the SCOPE leg, and it needs a block holding BOTH
a source-minted bare group and an unmodeled command, because the divergence is
unrepresentable with either alone. Measured by neutering each half in turn: the
pre-390 promotion-only plugin takes 10 legs, the block gate 5, the touch scoping
2, the old-text recovery 2, narrowing the protective cover to touched spans 3,
dropping the brace rule entirely 6, weakening it to both-or-neither 3, dropping
the OPAQUE disjunct from the cover 1, and scanning every block instead of the
touched ones 2.
**Owed, not claimed:** the preview eyeball — type `\Overall`, backspace the `\`
(the word returns to prose immediately); type `\%`, backspace the `\`, save and
reload (the `%` is still prose and the line is intact).

###### The family half: the law was about CARRIERS, and one of three had it

Same law, and the case where it was written down for a MARK and owed by a
FAMILY (task 407). 390 gave `latexCommand` both directions. Its two siblings
were left one-way for five weeks, and the reason the gap was invisible is
structural: the only re-derivation plugin in the family is keyed to
`markType = this.type`, so a reader looking for "where does the mark come off?"
finds an answer that is complete about the one mark it names.

- **The comment tail was the SILENT leg.** The parser pushes a whole tail
  INCLUDING its `%` as ONE text node; ProseMirror rebuilds a backspaced text
  node as `text.slice(1)` carrying the same marks array (`inclusive: false` is
  consulted only for insertion at a boundary, never for deletion), and nothing
  anywhere removed the mark. The serializer's arm then emits the run's bytes
  VERBATIM with **no `%` re-prefix anywhere** — it assumes `raw` already begins
  with one, which is precisely the assumption a demotion-less carrier breaks.
  So `x % TODO cite` minus its `%` reached the `.tex` as LIVE BODY TEXT and the
  user's annotation started TYPESETTING in the PDF, in all three of the
  serializer's line shapes, as a FIXED POINT — the next parse reads unmarked
  prose and the `%` is gone for good.
- **The inline `\verb` twin is LOUD.** Delete its lead and `verb|100% sure|`
  reaches the `.tex` with a live `%` that comments out the rest of that source
  line. Delete a delimiter and the paper stops compiling, and on re-parse
  `matchInlineVerbAt` returns -1, so the bytes are not verbatim to the parser
  either.
- **Neither is caught by anything.** `write-preservation`'s gate does not run at
  all after an UNDOABLE edit, and Backspace is one.

> **The unit of the law is the CARRIER, and the axis it is stated on is
> `(mark, FORM)` — not `mark`.** Each row asks ONE anchored question of a run's
> own text: *does this run still SPELL what its carrier says it is?* A row whose
> answer is `null` is a REFUSAL carrier — arbitrary bytes with no grammar, which
> no edit can break and which must NEVER demote.

The table is [`CARRIER_ROWS`](src/lib/latex-lexer.ts), in the TipTap-free leaf
both the `.tex` layers and the TipTap layer already read for this vocabulary.
Six rules it earned:

- **`latexVerbatim` wears TWO opposite claims, and the axis correction is the
  whole fix.** The inline `\verb` form is a CONSTRUCT with a spelling; the other
  four push sites are the schema's REFUSAL — an unmodeled environment, a
  `\begingl…` gloss, an example child, a `verbatim` env inside an example. At
  demotion time a run's own text cannot tell a DAMAGED inline `\verb` from an
  arbitrary carrier: both fail every lexer door. **A text-shape predicate is
  therefore a blacklist and it LEAKS** — it would demote all four carrier
  shapes, and a demoted carrier leaves through the escape rung
  (`\`→`\textbackslash{}`, `{`→`\{`), destroying a screenful of the user's
  source on ONE keystroke. Strictly worse than the stale mark being fixed.
- **So the row is PROVENANCE, recorded where it is known.**
  `verbatimMark(form)` takes a REQUIRED argument — a defaulted one would be a
  decision nobody made, and the two answers are opposite claims — and the attr
  travels with the mark across every later split. It is the JSON-shape change
  `latexVerbatim`'s own header gives as its reason for NOT being an attr on
  `latexCommand`, and it is affordable here for a reason that does not
  generalize: this repo controls both producers (the parser emits the attrs key
  unconditionally, exactly as `Mark.toJSON()` does) and the mark is rare, where
  `latexCommand` is on every raw run in every document.
- **Every unrecognized answer is the REFUSAL row.** A card body persisted before
  the attr existed carries no attrs at all, and a clipboard round trip through a
  DOM that never rendered it carries none either. A missed demotion is the
  status quo; a wrong one escapes the user's source, so `verbatimFormOf` reads
  anything but `"inline"` as `"carrier"`.
- **The rows are WHOLE-RUN, which is what makes the sibling half CHEAPER than
  the arm it sits beside** — one anchored match per marked run in a touched
  block, no `subtractCover`/`mergeRanges`, no `markedBracePairs` (a brace inside
  a `\verb` run was never a group delimiter) and no `brokenConstructs` old-text
  pass. The run IS the construct, so an edit that can break it lies inside it or
  is adjacent to its boundary, which `touches` already counts in both
  directions. It rides `readBlock`'s existing walk, so a block carrying no
  sibling mark pays one `Set.has` per child and nothing else.
- **Merged by ROW, not by mark-set identity.** ProseMirror merges adjacent text
  nodes only on identical mark ARRAYS, so another mark landing inside a `\verb`
  run splits it into three; asking each third whether it spells a `\verb` run
  answers no three times and demotes all three.
- **The comment row is NEWLINE-TOLERANT**, because `closeCommentTail`
  explicitly documents an interior newline as reachable by EDITING and
  re-comments its continuation lines. A claim written as "the whole run is one
  comment line" would demote exactly the shape the serializer has an arm for.
- **`isOpaqueRun` no longer hand-lists the siblings** — it reads
  `CARRIER_MARK_NAMES`, derived from the rows, so the family census exists in
  one place. That predicate is what keeps a `latexCommand` scan out of a
  sibling's bytes, and a fourth carrier would have been invisible to it while
  being perfectly visible to the table.

**Stated collateral, pinned rather than discovered:** a demoted tail that
CARRIED LaTeX prints it — `% see \cite{a}` → ` see \textbackslash{}cite\{a\}`.
Law-consistent (the bytes ARE prose now) and a fixed point, but surprising.

**And the card fork's missing comment arm is the RIGHT answer, not the inverse
inconsistency it reads as.** `footnote-content.ts` has a verbatim arm and no
comment-tail arm while `borrowed-schema.ts` REGISTERS the mark on card
surfaces — but everything that fork emits lands inside `\footnote{…}`, so a raw
`%` would comment out the closing brace. The main serializer can emit one raw
only because `serializeInlineSequence` discharges the carrier's LINE obligation,
and a braced argument has nowhere to put that newline.

CI: [carrier-family-demotion.test.ts](src/lib/tiptap/__tests__/carrier-family-demotion.test.ts)
drives the REAL `buildEditorExtensions("main")` stack over the REAL parse and
then serializes, with a two-cycle fixed-point check on every red leg. **No
pre-407 suite could see any of this**: grepping `removeMark|Backspace|
deleteRange` across the four carrier suites returns ZERO — every one of them
drives PARSE → SERIALIZE over source the parser produced, where a carrier run
always spells its own construct and the divergence is unrepresentable. Measured
by neutering each half in turn: the pre-407 one-way plugin takes 11 legs, a
text-shape blacklist over the refusal row 7, a form-less `verbatimMark` 8, the
whole-run merge 1, a whole-run comment claim 1, the touch scoping 1 (and it
needs an ALREADY-BROKEN run, which no intact fixture can represent), an
unrendered `form` attr 1, and the hand-listed `isOpaqueRun` 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — type
`x % TODO cite`, backspace the `%`, and open the code view: the annotation must
be escaped prose, not a live comment.

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

#### The arity half: the door that answers "what are this command's arguments?" was read by the CARRIER only

Same round trip, and the case where the SSOT existed, was correct, was bounded
three ways, and was adopted by exactly one of its two kinds of caller (task
376). Task 349 built `matchCommandArgumentRun` for one question — *what are this
command's arguments?* — and it answers it for any arity, any order, star
included. **Only the CARRIER path adopted it.** Every matcher for a construct
Virgil actually MODELS still hand-wrote `name` + a literal `{`.

So a legal spelling the hand regex did not accept had one of two outcomes, and
the first is the quiet one: the construct was **DEMOTED** to the raw carrier
(bytes safe, model gone, every feature derived from the node silently dead), or
it was **CLAIMED and re-emitted without the part the matcher could not see**
(bytes changed). Six members, all fixed points, all landing on OPEN via
`readDocBundle`'s unconditional load-writeback:

- **M1 — `\section[Intro]{Introduction}` was a PARAGRAPH.** For all seven
  commands, starred and unstarred, plus the `\section {X}` / `\section\n{X}`
  spellings TeX accepts. The bytes round-tripped (349/360's carrier did its job)
  and the whole heading apparatus was dead for an ordinary construct: no Outline
  row, no folding, no section number, no `\label`/`\ref` resolution, no
  `\partitle`, no focus band, no heading word counts, and grey monospace where a
  styled heading belongs.
- **M2 — the level↔command vocabulary was spelled FOUR times** (the parser's
  regex, the serializer's level-indexed array, `HEADING_TYPES`, and
  `document-class.findSectioningCommands`) **and only the copy that decides
  nothing got the grammar right** — the compat checker accepted the bracket AND
  the whitespace, so it correctly saw a `\chapter[Short]{X}` the parser had
  already thrown away. `headingTypeCommand` had zero callers anywhere: a dead
  SSOT (task 202's class).
- **M3 — a list's `[options]` were DELETED.** `\begin{enumerate}[label=(\roman*)]`
  came back bare, so the list reverted from (i)/(ii) to 1./2. in the PDF. Three
  word tokens, under `PRESERVATION_SLACK_WORDS = 4`, so the write gate was
  silent. `figure` kept its `[htbp]` and the unmodeled-env carrier re-emitted its
  bracket; this branch was the outlier, and task 340 had fixed the identical
  defect one level down for the per-ITEM `\item[label]`.
- **M4 — `\caption*` lost its star**, so the figure began consuming a figure
  number and a List-of-Figures row and **every later figure renumbered**, with
  every `\ref` to them printing a different number. One byte, zero word tokens —
  invisible to every gate.
- **M5 / M6 — `\footnote[3]{…}` was not a footnote** (no node, no `\vfid`
  marker, no card, no panel row) and **`\title[Short]{Long}` was not a title
  field** (not hoisted, not editable in the title strip).

> **A MODELED construct reads the same argument door the carrier does — and
> consumes its OWN declared arity, not the maximal run.** The door is
> [`matchStarOptBraceAt`](src/lib/latex-lexer.ts) (`*`, `[opt]`, the one `{req}`
> the model holds) over `matchCommandArgumentRun`'s PARTS, and
> `matchSectioningCommandAt` over that, derived from `HEADING_TYPES`. A
> construct whose spelling carries a fact the model cannot hold is REFUSED to
> the carrier, never claimed and re-emitted incomplete.

Six rules it earned:

- **One scanner, two arities, and the difference is load-bearing.**
  `matchCommandArgumentRun` is deliberately MAXIMAL — every abutting group up to
  nine — which is right for the CARRIER (whose job is to keep bytes together)
  and wrong for a modeled construct: `\footnote{a}{b}` is a footnote whose body
  is `a` followed by a bare prose group, and a maximal read would swallow `{b}`
  into the note. So the modeled door reads the run's GROUPS and stops at the
  first brace. Extending the run to publish its parts is what makes that
  possible without a second scanner.
- **The gap before the FIRST argument is skipped and gaps between groups are
  not.** TeX skips spaces while scanning for an argument, so `\section {X}` is
  the same document as `\section{X}`; a gap spanning a BLANK LINE is refused,
  because a `\par` cannot appear inside an argument scan and refusing there
  keeps a bare `\section` at the end of a paragraph from reaching into the next
  block. The between-groups rule is `matchCommandArgumentRun`'s existing one and
  this door does not renegotiate it.
- **A star the model cannot carry is a REFUSAL, not a swallow.** There is no
  `\footnote*` or `\title*` in LaTeX, so those doors decline a starred spelling
  and the carrier keeps the bytes — task 356's rule, and precisely the failure
  M4 was: a star claimed and then dropped.
- **M4 reads the star into the fact it already IS.** In LaTeX `\caption*` means
  *unnumbered float*, which is what `figureBlock.numbered` means — so the parser
  sets `numbered: !captionStarred` and the emitter writes the star back from it,
  rather than a second parallel `captionStarred` attr the two could disagree
  about. That also gives the `numbered` toggle the persistence it never had:
  nothing serialized it before, so it did not survive a save.
- **Put the vocabulary where the layer that needs it can reach it.**
  `heading-types.ts` is now an import-free LEAF owning `SectioningCommand`
  (`document-class.ts` re-exports it), because the lexer is itself a leaf every
  low-level consumer takes — the placement rule `latex-markers.ts` and
  `node-attr-sets.ts` earned. `headingTypeCommand` is wired rather than deleted:
  it is the serializer's level→command lookup now.
- **A carried-raw fact rides the NODE, not a re-read of the source.**
  `heading.shortTitle`, `listOptions` and `footnote.numberOverride` are opaque
  attrs with `keepOnSplit: false` — the `listItem.itemLabel` shape (340): a
  heading split at Enter must not mint a sibling carrying a running head the
  user never typed, on a section it does not name.

The same pass took the `[^\]]*` env-option capture to `extractBracketed` (which
is brace-depth aware, so `[label={[\arabic*]}]` is captured whole rather than
truncated mid-option) — a shape that was survivable only while the options were
being deleted anyway.

**Stated residuals, two.** `\footnote[3]`'s override is carried and deliberately
NOT fed to `numberFootnotes`: in LaTeX the optional form also does not STEP the
counter, so honouring it in Virgil's own chrome means renegotiating every
following footnote's number — a bigger change than carrying the byte, and one
the bytes do not depend on. And the EXCERPT body schema mounts StarterKit's
plain `Heading`, which declares none of `label` / `numbered` / `uuid`, so an
archived section already loses those on capture and now loses `shortTitle` with
them — a PRE-EXISTING attr-level gap in the capture/schema-symmetry law (whose
guard asserts node and mark TYPES, not attrs), widened by one field here rather
than introduced.

CI: [optional-argument-matchers.test.ts](src/lib/__tests__/optional-argument-matchers.test.ts).
Every pre-376 fixture in the repo spells these constructs the one way the code
happens to handle, so an optional argument or a star reaching a modeled matcher
was **unrepresentable** in all of them. Each leg drives the REAL save pipeline
over TWO cycles with its plain-form CONTROL through the identical harness, and
asserts the node TYPE as well as the bytes — a heading that round-trips as a
carrier IS the defect, and a byte assertion alone cannot see it. The sectioning
legs are swept FROM `HEADING_TYPES`, so an eighth level is covered by
declaration alone. The leg with teeth is the CENSUS — the door was never the
part that could misbehave, a call site that spells the vocabulary itself is —
with its one exemption keyed to the per-class capability TABLE (a different
question: which commands does this class DEFINE?) rather than to the file, and a
second leg asserting that exemption still covers something. Measured by
neutering each half in turn: the sectioning door takes 18 legs, the list options
4, the caption star 3, the title door 3, the footnote door 2, the brace-aware
bracket scanner 1 — and the serializer's level-indexed array takes exactly ONE,
the census, because it emits byte-identical output.

#### The two-homes half: a datum with two homes, and every reader picking by convention

Same law, twelfth tense (task 403) — and the case where the SSOT was not dead,
not stale, not half-consolidated, but **doubled**: a citation's
`[prenote][postnote]` existed BOTH top-level on `ParsedCiteCommand` and per-entry
on `entries[]`, and each of the three consumers guessed which home was
authoritative, with three DIFFERENT guesses.

- `parseNatbibCommand` put the notes at the top level (natbib's brackets govern
  the WHOLE citation) and left `entries[]` note-less;
- `parseBiblatexCommand` put them per-entry **and mirrored `entries[0]`'s onto
  the top level**;
- `serializeCiteCommand` read `entries[]` only, so a natbib
  `\citep[p.~22]{k}` round-tripped as `\citep{k}` — the note silently DROPPED;
- the panel's `rowsFromCommand` mirrored `entries[0]`'s note onto EVERY row;
- the display formatter guessed a third way, from the command NAME plus the
  document's package — and it was the only one of the three that was RIGHT.

The panel's guess is the one that writes bytes. For a biblatex
`\cites[p. 1]{a}{b}` — which the UI itself emits — row `b` inherited `"p. 1"`,
and the next `persist()` wrote `\cites[p. 1]{a}[p. 1]{b}` into the user's
`.tex`: **a page range invented on a citation that never had one**, permanent
from then on, reachable with no package flip and no unusual gesture (any fresh
mount re-derives the rows — a reload, or the same citation rendered as a float
or in omni).

> **The tell for this class is always a COMMENT asserting which home is
> authoritative next to code that does not check.** The fix is not to make the
> readers agree; it is to make the second home UNREPRESENTABLE — a discriminated
> union whose WHOLE arm's entries carry no note field and whose PER-KEY arm
> carries no top-level note — and then to publish the ONE projection every
> reader actually wants.

[src/lib/cite-command-model.ts](src/lib/cite-command-model.ts) is that model.
Six rules it earned:

- **The discriminant is the SYNTAX, not the package.** One bracket group before
  one brace group is WHOLE — natbib always, and biblatex's singular forms too
  (`\parencite[p. 1]{a,b}`); a repeated `[…]{…}` is PER-KEY, which is the only
  thing biblatex's plural `\xxxs` forms buy. Keying on the package instead is
  what made `\parencite[p. 1]{a,b}` re-serialize as
  `\parencites[p. 1][]{a}[p. 1][]{b}` — the same invention one command shape
  over, and it fell out of the model with no second rule.
- **ONE projection, read by both renderers.** `resolveCiteNoteRows` places a
  whole-citation note where LaTeX itself renders it — prenote before the FIRST
  key, postnote after the LAST — and nowhere else. The display formatter and
  the panel's editable rows are the same question asked twice, so they read the
  same answer instead of each deriving it. That is what makes the two agree BY
  CONSTRUCTION rather than by two implementations staying in step.
- **The discriminant is REQUIRED and undefaulted at the serializer.** Every
  call site had to name its arm, which is the point: a defaulted `noteScope`
  is a decision nobody made, and the compiler naming the four sites is what a
  comment saying "For natbib" could never do.
- **A lossy user action WARNS before it writes, once, at the altitude the
  decision is made.** natbib cannot represent divergent per-key notes, so a
  biblatex→natbib flip really does drop one — and the confirm lives at the
  Package control (ONE decision the user makes once) rather than in each card's
  flip effect, which would ask N times and still miss the archived cards. The
  predicate `citeNotesDroppedByPackage` is DERIVED by running the REAL
  serializer and reading the answer back through the REAL parser, never by
  restating the flatten rule — a second statement of the rule is the thing this
  whole section is about.
- **…and the same-package click still WRITES.** Picking the package the view
  already shows is how a user confirms a DETECTED seed as their own choice
  (task 344 made the stored family optional), so the gate's early return is
  "nothing can be lost", not "nothing happens".
- **The Library silo's whole-file copy stops being a fourth copy of the
  ANSWER.** `library/lib/bib-parser.ts` had re-typed the entire model and had
  already diverged (the empty-key filter and the `matchedGroup` guard never
  landed there), while its serialize half had no caller at all. It reads the
  leaf now — the placement rule `latex-markers.ts` and `node-attr-sets.ts` each
  earned — and its dead half is deleted rather than re-exported. Visible in the
  task-341 census, whose allowlist went from two entries to one.

**Declared normalization, stated rather than claimed away:** a biblatex
`\parencite[p. 1]{a,b}` is re-spelled `\parencites{a}[p. 1]{b}` by the card's
next save, because the card's rows ARE per-key (each row owns a `+range`
input). One-time, idempotent, and the single note stays on the single key that
owns it — where pre-403 the same save DUPLICATED it onto both.

CI: [cite-note-homes.test.ts](src/lib/__tests__/cite-note-homes.test.ts) runs
every byte leg over TWO cycles (this class's fixed points are what make an
invention permanent) with controls through the identical harness, and
[citation-note-mirroring.test.tsx](src/panels/Citations/__tests__/citation-note-mirroring.test.tsx)
drives the REAL card and edits a DIFFERENT row — the invention's whole cost is
in what `onUpdateCitation` receives, and a rows-only assertion passes on an
implementation that renders right and writes wrong. The leg with teeth is the
CENSUS: the model was never the part that could misbehave, a call site that
places the note by its own convention is, and `parsed.prenote` type-checks
perfectly on the arm that has it. So no production file outside the SSOT may
re-declare the parse/serialize model, every file that parses a command AND
touches a note must ask `resolveCiteNoteRows` (allowlist EMPTY), and the
Package control must ask before it writes. Measured by neutering each half in
turn: the pre-403 mirroring takes 8 legs, the entries-only serialize read 3,
and the package gate 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — this is `.tex`
bytes through the real save cycle — so the check is cheap and real: make a
multi-key biblatex cite with a range on the first key only, reload, and look at
the other key's row and the source.

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

**A file that RENDERS the control is not a witness that the control works.** Channel 3 excludes the two vocabulary files AND every prefs control surface (`FontsDialog`, `PreferencesModal`, `PreferenceTree`, `SmartPreferences`; `PreferenceModePicker` was a member until task 495 retired it) — because an inert picker's own dialog names its key, and a bare-name grep would otherwise exonerate it off exactly the surface whose emptiness IS the bug. That exclusion is also what covers the second control surface leg B cannot see: `PREFERENCES_TREE` is not the only labelled-row source (`FontsDialog` binds its own `<FieldRow>`s straight to prefs), so a Fonts-dialog pref reaching no token now falls to leg C as an ORPHAN rather than passing everything. It is a pure tightening — measured when it landed, the inert set does not move, since every real font pref reaches pixels through its own `--font-*` token or a derived one.

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

#### The display half: a fragment shown to a READER is projected, not printed

Same vocabulary, other DIRECTION (task 368) — and the case where every rung was
correct, shared and censused, and a whole family of surfaces never entered any
of them.

A `.tex` document reaches the screen through one of the two inline PARSERS. A
great deal of LaTeX never takes that road: a citation's `[prenote][postnote]`
lives on the atom as raw command BYTES, and a `.bib` entry's `author` / `title` /
`year` are raw field bytes read straight out of the file. Both are then rendered
as DISPLAY TEXT, and `formatInlineCitation` — the ONE formatter every citation
surface reads (the inline chip, the Citations panel preview and card meta, the
card-body surfaces live and static, the float bodies, the footnote hover preview,
the drag ghosts) — interpolated them into its output with no projection at all.
So Gabriel's chip rendered `(Kehler, 2002, ex.\textasciitilde{}38,
p.\textasciitilde{}22)`: the four literal words `textasciitilde`, shown to the
reader, from valid source. Nothing threw, the `.tex` was correct, and the body
text one line away showed the same bytes correctly.

> **A raw-LaTeX fragment shown as DISPLAY TEXT is projected through ONE door —
> [`latexToDisplayText`](src/lib/latex-typography.ts) — derived from the same
> tables the parse rungs read, and it is TOTAL by PASSING BYTES THROUGH rather
> than by guessing: a construct the tables do not know arrives at the reader
> exactly as it sits in the file. DISPLAY ONLY — nothing it returns is ever
> written back.**

Five rules it earned:

- **Project the OUTPUT once, not the ten interpolations.** `formatInlineCitation`
  is now a two-line wrapper over a module-PRIVATE `formatInlineCitationRaw`, so
  every command branch is covered — including the ones a future dispatch case
  adds — and there is no per-branch decision for anyone to forget. The raw
  dispatch stays private because an exported one is a SECOND display door, and
  the one a caller reaches for is the one that skips the projection.
- **The branch order MIRRORS `parseInlineContent`**, so a fragment that could
  have been body text projects to the characters body text would have shown.
  That agreement is the whole point — two surfaces rendering one vocabulary two
  ways is the class — and it is pinned as a leg rather than asserted.
- **The reachability set is DERIVED from all four tables**, and that is the rule
  that was measured rather than assumed: the first cut's hand-written character
  class held the "interesting" leads (backslash, brace, tilde, quote) and bailed
  on `15--20`, so the en dash was never folded with every other leg green. The
  LITERAL rung has no interesting lead at all.
- **No vocabulary is invented.** `\emph{x}` displays as `\emph{x}` and a BibTeX
  grouping brace survives (`L{ó}pez`), because going further needs two SSOTs this
  codebase does not have — which commands are formatting wrappers whose argument
  should survive, and what a bare `{…}` means in each medium (task 349 M6 decided
  a `.tex` group's braces are CARRIED; BibTeX says a field's braces are pure
  grouping and never print). Hand-listing either inside a display helper is the
  drift every census here exists to prevent. Recorded as a residual, with the
  question routed to Gabriel rather than answered alone.
- **A projection is a VIEW.** The stored `command` attr and the `.bib` bytes are
  untouched, pinned over two full save cycles — this fix must not become the
  one-directional rewrite the whole vocabulary exists to prevent.

Same pass drained the two remaining **twin forks** across the inline parsers
(341's rule), because the display door would otherwise have been a THIRD copy of
each: the `\ldots|\dots|\LaTeX|\TeX` alternation, hand-written in both and
whose ellipsis half was a second spelling of `LITERAL_TABLE`'s own `latexForms`
(now `matchTextMacroAt`, with the ellipsis entries DERIVED from that table); and
the `` `` ``/`''` quote-pair test, hand-written in both with the serialize half
spelled a fourth time inside `smartenStraightQuotes` (now `QUOTE_PAIR_TABLE` +
`matchQuotePairAt` + a derived `QUOTE_PAIR_LEADS`, read by all four). Both
conversions are byte-identical, which is exactly why they were worth doing before
the next vocabulary change landed in one half only.

CI: [citation-display-projection.test.ts](src/lib/__tests__/citation-display-projection.test.ts).
The leg with teeth is the CENSUS — the door was never the part that could
misbehave, a formatter that interpolates without asking it is, and that
type-checks perfectly. Membership is DISCOVERED (`export function format*` in
BOTH bib-parsers, since `library/lib/bib-parser.ts` is a whole-file copy and a
projection landed on one side only is a Library app that still shows
`\textasciitilde{}`), each member must call the door inside its own declaration
region, and the one exemption — `formatBibliography`, which returns citation-js
HTML behind its own sanitizer — is keyed by NAME with its reason. Measured by
neutering each half in turn: stubbing the door takes 11 legs, reverting the ONE
call site 5 (the census among them), and re-forking either parser vocabulary 1.

**Residual, CLOSED by task 409** — the bib ROW surfaces; see "The row half"
immediately below. One unrelated asymmetry found in passing was routed to the
catcher with the brace question:
`serializeCiteCommand` reads pre/post from `entries[]` while `parseNatbibCommand`
deliberately stores them top-level, so the round trip through those two functions
drops a natbib annotation (no shipped path is known to reach it — the atom keeps
its raw bytes — but the shape is how a silent drop ships).

##### The row half: a census discovers by MECHANISM, so the surface that reads the FIELD is invisible to it

Same door, the surface family it could not see (task 409) — and the case where
the projection was right, its census was right, and the census's POPULATION was
derived from the one mechanism the offending surfaces do not use.

368's census discovers its members from the bib-parsers' `format*` EXPORTS.
That is the correct population for a formatter and structurally blind to a
COMPONENT that reads `entry.fields.title` into JSX itself — which is the whole
bib ROW family: the Library list row (the most-viewed bib surface in the app),
the entry picker, the two bib cards, the Citations per-key rows, the paper
detail header. Every one of them printed `L{\'o}pez` and `\&` verbatim beside
body text that rendered the same bytes correctly. The sharpest single piece of
evidence: ONE picker row already projected its AUTHOR
(`formatAuthorsTruncated` has projected since 368) beside a RAW title.

> **A raw `.bib` field reaching a reader goes through ONE per-field accessor —
> [`bibFieldDisplay(entry, name)`](src/lib/bib-parser.ts) — and the census that
> polices it asks the QUESTION (who reads a field?) rather than the MECHANISM
> (who exports a formatter?).**

Seven rules it earned:

- **Per-FIELD, never a record.** A `bibEntryDisplayFields(entry) → Record<…>`
  over a hand-listed 17-field set is a new SSOT-of-field-names — the drift this
  file legislates against everywhere — and it allocates a whole record for a
  caller that wants one. Every field is projectable (the door cheap-bails on
  ASCII), so the field name is the caller's own.
- **Presence is PRESERVED**, and that is load-bearing rather than tidy. The
  accessor answers `undefined` iff the field is ABSENT, so every converted site
  keeps its `?? catalogValue` chain byte-for-byte; a door that coalesced absent
  and empty to `""` would let an empty bib title shadow a real catalog title.
- **The name logic runs on PROJECTED text.** Five surname formatters split on
  `" and "` and a comma, and the projection can neither create nor destroy
  either — so the field is projected at the READ and the helpers are untouched.
  That is what keeps the projection ONE accessor instead of a call at fifteen
  JSX sites, which is the shape that goes raw again with the sixteenth.
- **The write-back hazard is REFUTED, and checking it is what made the fix
  cheap.** Not one input in either silo is seeded from a rendered string —
  every editor seeds from `entry.fields` — so a projection at the JSX sites
  cannot round-trip into the `.bib`. Pinned as a leg (the field editor's input
  values must hold the BYTES), because it is the premise the whole fix rests on.
- **A projected header above a RAW source pod, in one card, is CORRECT**
  (Gabriel, decision 2): a rendered view above its source, the same
  relationship the editor has to the code pane. `BibEntryCard`'s "BibTeX
  Fields" pod, `BibCard`'s `ExpandedFields` grid and the whole of
  `BibEditModal` stay raw and say why at the site. Projecting the third is the
  one change in this family that WOULD write a rendering into the file.
- **The SORT keys project too** (decision 3), and the case took measurement to
  state honestly: `L{\'o}pez` does NOT sort wrong — ICU treats the interior
  braces as punctuation and collates it under "l" either way. What moves is a
  field whose FIRST character is the escape, since ICU's default collation is
  `alternate: non-ignorable`: a leading `\` or `{` sorts before every letter
  and files the entry at the TOP of the list. `\'Alvarez` is the ordinary shape
  of that. `BibliographyPanel`'s list and its cited-EXPORT share ONE comparator
  (two is how the exported byte order drifts from what the user was looking
  at), and the accepted cost is stated: the first `cited.bib` export after this
  is a one-time deterministic re-ordering — a diff, not a loss.
- **The exemptions are in-place MARKERS, not a table.** `bib-display-exempt:`
  (governing its line and the next 12) and `bib-display-exempt-file:`, each
  stating one of three declared reasons — and the third is the one the obvious
  display/edit split misses: a NON-DISPLAY read reaches no reader at all (field
  equality, a numeric-sort `parseInt`, a synthetic catalog record, a BibTeX
  block emitted into an AI-request note, the fuzzy-search haystack). A naive
  `.fields.<name>` regex fires on all of them.

The census's own population is the finding one level up: it found
`library/components/PaperHeader.tsx` — the paper detail header, absent from the
task's hand-built census, and the one production caller of the leaf-pure
`BibEntryChrome` whose raw read was always one level up in it. Two of the
task's census entries were WRONG and are recorded as such rather than "fixed":
`bib-entry-chrome.tsx` never touches `entry.fields` at all, and `BibEditModal`
is the edit surface. The dead `formatMediumCitationParts` (a 3-field record
helper with test-only callers, in BOTH silos) was DELETED rather than converted
— a suite is not a consumer.

CI: [bib-row-display-projection.test.tsx](src/lib/__tests__/bib-row-display-projection.test.tsx)
(the accessor's contract, the two DECIDED behaviours a later reader would file
as bugs — the grouping braces survive, absence is `undefined` — the sort, and
the CENSUS) and [bib-row-raw-vs-projected.test.tsx](src/components/__tests__/bib-row-raw-vs-projected.test.tsx),
which drives the REAL `BibEntryCard` and asserts BOTH directions in one card:
the header projects, the fields pod does not, and the editor seeds from bytes.
The 368 census's discovery widened to cover the new accessor, so it is
auto-enforced there too. Measured by neutering the card's three field reads:
2 behavioural legs and the census fail; the raw-pod legs stay green, which is
exactly the pre-409 tree.

**Residuals, stated.** The projection is PARTIAL by decision: BibTeX's grouping
braces survive (`L{ó}pez`), because a full BibTeX-semantics projection needs a
vocabulary this codebase has no SSOT for and hand-listing one is the drift
every census here exists to prevent. The fuzzy-search HAYSTACK
(`catalog-search.ts`, `bib-searcher.ts`'s Fuse keys) is deliberately unprojected
— whether typing "López" should match `L{\'o}pez`, and whether typing `\'o`
should stop matching, is a decision about MATCHING semantics rather than about
what a reader sees. And the Library list's sort keys are projected for the same
reason the Bibliography panel's are, but feed no export, so they carry no
one-time diff.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — open the Library
list with an accented-surname entry.

##### The passage half: a CAPTURE that flattens is a loss no RENDERER can undo

Same door, the QUOTE a card keeps of the paper (task 488) — and the case where
the fix has to be in two places because the phenomenon is in two places.

Gabriel, from a real paper: *"when you make an AI request for revision, the
original is rendered as plain text without formatting — should be more like an
archive card."* The "Original" a revision / cutter card shows had FOUR
renderers and THREE answers: `useExcerptCue` and the read-only `original_text`
field painted the raw STRING in a `whitespace-pre-wrap` block (so a
skill-authored original — real `.tex` — showed `\emph{...}` / `$x$` /
`\cite{k}` as SOURCE), the two pending-change foldouts each HAND-SPELLED
`richLatexToJson(...)` → `BorrowedMainText`, and the collapsed cues showed
`text.replace(/\s+/g, " ")`.

**And the render fork was only half of it.** A Mode-B anchor's capture is
`doc.textBetween(from, to, " ")`, which drops every MARK and — because
ProseMirror's default `leafText` is empty — every inline ATOM outright: a
citation, a `$x$` or a `\ref` inside the selection contributes NOTHING to that
string. So for the case Gabriel actually reported the formatting was gone
BEFORE any surface saw it, and a render-time parse recovers exactly nothing.
The catcher's recommended surgical fix (project at display time) would have
fixed the skill-authored originals and left the reported one flattened.

> **A captured passage has ONE door
> ([captured-passage.tsx](src/panels/_shared/captured-passage.tsx)) with a
> two-rung ladder — the RICH capture taken at anchor time, else the BYTES
> parsed at display time — and it is rendered as borrowed main text on every
> surface, because a captured passage IS main text.** The string stays the
> currency: the apply path splices `user_text || suggested_text` as BYTES, the
> copy button copies bytes, and nothing the door produces is written back.

Seven rules it earned:

- **The capture is a SECOND field, not a change to the first.** `anchorText` is
  the RELOCATION currency — the `textSnapshot` a Mode-B anchor is re-found by
  on reload (`reapply-mode-b-anchors`) — so it must stay plain doc text.
  Re-spelling it as `.tex` bytes would have unified the currency and broken
  anchor recovery, which is why `LinkedAnchorRecord.content` /
  `AnchorRef.anchorContent` / `card.selectedContent` sit BESIDE the string
  rather than replacing it. Optional at every rung, so there is no migration:
  every pre-488 card takes the parse rung.
- **The display capture does NOT enter `prepareCardBodyCapture`, and the reason
  is the import graph as much as the semantics.** That door exists to prove a
  DESTRUCTIVE capture's destination can hold the payload; nothing is deleted
  here, and a passage the render surface cannot represent already falls back to
  plain text through `StaticBorrowedText`'s own refusal contract. Asking it
  would also drag the resolved card-body schema — and so the whole extension
  stack — into `links.ts`, a module every card surface pulls in (measured: it
  broke eleven suites with `Cannot find module '@/lib/storage-fsa'`). So the
  slice→JSON conversion moved to a LEAF
  ([slice-capture.ts](src/lib/tiptap/slice-capture.ts)) that both doors read,
  which is what keeps the payload the destructive door VALIDATES byte-identical
  to the one the display capture takes.
- **STATIC, not `BorrowedMainText`.** Nothing here is editable, so an editor
  buys nothing and costs a mount (the card-presence-tier doctrine). Converting
  the two pending-change foldouts onto the door RETIRES two live editors as
  well as unifying the answer — `BorrowedMainText` stays right for a card's OWN
  body (`ExampleCard`), which is the one scoped exemption on the census.
- **The one-line cue reads the SAME resolution.** A collapsed card projects the
  door's own JSON through `richJsonToPlainText`, so the cue and the expanded
  excerpt cannot disagree about what the passage says. `suggested_text`
  deliberately stays raw and says so at the site: it is EDITABLE currency the
  user is composing, and its cue must show the bytes they typed.
- **The door drops `color` from the panel body style.** `.rtf-content-footnote`
  sets a hard ink, so a passage that wrote its own colour would win over the red
  "Original" cue the field vocabulary assigns; the CSS rule hands the ink back
  (`color: inherit`) and drops the 2.5rem min-height and padding
  `.rtf-content` reserves for a caret. An excerpt is a QUOTE inside a card, not
  a body.
- **The parse is MEMOIZED on `(latex, content)`.** The rung mints a fresh object
  per call and `StaticBorrowedText` memoizes its HTML on `value` IDENTITY, so
  without it the passage re-parses and re-serializes on every render of the host
  card. O(passage), never O(doc), and off the keystroke path either way — but a
  card re-renders for plenty of reasons that have nothing to do with it.
- **The rich twin travels with the string it is the twin of.** The morphs carry
  it (a morph is not a re-capture), the sidecar migrate carries it through
  UNCHANGED with no snapshot fallback (the link's `textSnapshot` is the plain
  relocation string — synthesising a body from it would put a second, lossier
  answer where the parse rung already gives the right one), and `pull-seed`
  lists it as a per-doc BINDING beside `selectedText`.

CI: [captured-passage.test.tsx](src/panels/_shared/__tests__/captured-passage.test.tsx)
drives the REAL `createLinkedAnchor` over a fixture carrying an inline ATOM
beside marked text — the atom is what makes the capture leg falsifiable, since
`textBetween` cannot represent it at all — plus the ladder, the REAL render
surface, and the CENSUS. The two rich-render legs live in the renegotiated
[RevisionRequestCard-excerpt.test.tsx](src/panels/Revisions/__tests__/RevisionRequestCard-excerpt.test.tsx),
which stubs only `BorrowedMainText`, so the passage renders for real. **No
pre-488 suite could see any of this**: that suite asserted the excerpt string
was PRESENT (which the flat block satisfied perfectly) and every pending-change
suite `vi.mock`s the rendering surface away — what was never asked is whether
the passage arrives with its marks and atoms at all. The leg with teeth is the
CENSUS (no panel file parses a captured passage itself, renders one through a
live editor surface, or spells the borrowed static surface outside the door; the
capture is taken at the ONE anchor minter; the slice→JSON conversion has ONE
implementation). Measured by neutering each half in turn: dropping the capture
takes 2 legs, a ladder that ignores it 3, the pre-488 plain excerpt block 2, and
a re-forked parse in a panel 1.

**Owed, not claimed:** a real-FSA eyeball. Anchor capture is the FSA-masked
class, so the durable proof here is the unit contract — select a passage with
italics and a citation, make an AI revision request, and open the card.

#### The composition half: a CARRIER says how a run's bytes are made, not what wraps them

Same round trip, one question up (task 377) — and the case where the carrier
doctrine was right about the bytes it was defending and silently discarded their
CONTEXT.

A text run's marks answer two different questions. The three CARRIERS answer
*how are this run's own bytes produced?* — byte-literal (`latexVerbatim`),
raw-LaTeX-with-smart-quotes (`latexCommand`), not-typeset-at-all
(`latexCommentTail`). The WRAPPERS answer *what encloses it?* — `bold`,
`italic`, `underline`, `code`, `textColor`. `serializeMarks` decided the first
with three early `return`s sitting **above** its wrapper loop, so a run wearing
both kinds emitted only its carrier and **the wrapper was DELETED**. The parser
APPENDS a formatting mark onto whatever its recursion returned, so that
combination is not exotic; `\textsc` is unmodeled and is the standard small-caps
/ gloss-abbreviation command, which makes this ordinary linguistics and
philosophy prose. The card/footnote fork had the identical two returns above the
identical loop (341's twin rule). Five members, every one a FIXED POINT from
cycle 1, all landing on OPEN:

- **M1** `\textbf{\textsc{Smith}}` → `\textsc{Smith}`; `\textcolor[HTML]{…}{\textsc{x}}`
  → the colour gone; `\textbf{\verb|a|}` → the bold gone; and the RUN form
  `\emph{a \textsc{b} c}` → `\emph{a }\textsc{b}\emph{ c}`, one wrapper split
  into two with the middle piece bare.
- **M2** the same in the card/footnote fork.
- **M3** a mark around an inline ATOM: `\emph{\citep{x}}` → `\vcid{…}\citep{x}`,
  because the sequence walker emitted the atom and discarded its marks.
- **M4** `inCode` was not propagated: only the `\texttt` branch passed anything,
  so a command nested INSIDE a code span had its body typographied and a raw
  U+2013 / U+00E9 was written into the `.tex` — `\texttt{\textbf{x--y}}` came
  back `\texttt{\textbf{x–y}}`, where the source's two hyphens must PRINT as two
  hyphens. `\texttt{x--y}` (one level) was always right, which is why it read as
  latent. Both parsers had the gap.
- **M5** `\texttt{caf\'e}` → `\texttt{caf}\'\texttt{e}` — the split re-binds the
  accent, which now takes `\texttt` as its argument.

> **Two stages, stated once: PRODUCE the run's inner bytes (the carriers decide
> this), then WRAP them. And the unit of wrapping is the RUN — the maximal
> adjacent span sharing one wrapper signature — never the node.**

[src/lib/mark-composition.ts](src/lib/mark-composition.ts) is the SSOT
(`WRAPPER_MARK_TYPES`, `markWrapSignature`, `applyWrapperMarks`,
`composeInlineRun`), an import-free leaf for the reason `latex-markers.ts` and
`node-attr-sets.ts` each earned. Five rules it earned:

- **The RUN, not the node, and M5 is the proof.** Per-node wrapping is correct
  about each node's own bytes and wrong about their neighbours: it splits one
  `\texttt{…}` into three, and a split landing between an argument-taking control
  symbol and its argument CHANGES WHAT THE COMMAND TAKES. A rule stated as "wrap
  each node" cannot express that; a rule stated as "wrap the run" fixes M1's
  split form and M5 with the same line.
- **`code` is a WRAPPER that is nonetheless read at stage 1**, and that is not an
  exception to the split — it is the one wrapper that changes how the inner bytes
  are PRODUCED (typography suppressed). Stated at the site so the next reader
  does not "tidy" it into stage 2.
- **What must sit OUTSIDE a wrapper breaks the run.** The `\vlid` / `\vlidend`
  anchor transitions are an `outerPrefix`, and a non-empty prefix flushes the
  group — so a marker can never land inside one set of braces, structurally
  rather than incidentally. The comment carrier is `standalone` for the stronger
  reason: it owns the rest of its LINE, so anything merged after it inside
  `\textbf{…}` — the closing brace included — would be commented out.
- **An ATOM's marks are the run's business.** The walker's non-text arm emits the
  node and the RUN wraps it, so `\emph{\vcid{…}\citep{x}}` round-trips. The atom
  keeps its marks in the parsed JSON already; nothing had to be re-derived.
- **`inCode` is INHERITED by every mark recursion**, in both parsers. The emit
  side always read the fact correctly; the two rungs simply read it at different
  depths, which is the whole of M4.

**Declared normalization:** two adjacent nodes the model happens to keep apart
with identical wrapper marks now merge (`\textbf{a}\textbf{b}` → `\textbf{ab}`).
One-time, idempotent, and it typesets identically — the same class of one-time
canonicalization the serializer already performs for author layout.

**Stated residual:** a NESTED formatting mark still splits its parent's run —
`\textbf{a \emph{x} b}` normalizes once to
`\textbf{a }\textbf{\emph{x}}\textbf{ b}`, because the two signatures differ.
Sharing a common wrapper SUFFIX would restore byte-identity there, and it is
deliberately not done here: the phenomenon this task closes is DELETION, the
split form loses nothing and is idempotent, and suffix-sharing turns a linear
fold into a hierarchical build over interleaved mark orders — more risk than the
verbosity is worth.

CI: [carrier-mark-composition.test.ts](src/lib/__tests__/carrier-mark-composition.test.ts).
Every leg drives the REAL save pipeline over TWO cycles and over BOTH surfaces
(main body, the fork's own doors, and a real `\footnote{}` body in a real
document), with `\textbf{plain bold}` / `\textbf{\emph{both}}` / `\texttt{x--y}`
as CONTROLS through the identical harness — the defect needs a CARRIER or an
ATOM as the child, so a suite whose fixtures are plain prose cannot represent it,
which is exactly why every pre-377 round-trip suite was green. **No gate could
see any of it**: `\textbf` is not a content word, `x--y` and `x–y` both tokenize
to `{x, y}` under `WORD_RE`, and the accent case is a 1-token shortfall under the
4-word floor. The leg with teeth is the CENSUS — the composition was never the
part that could misbehave, a THIRD file spelling the five commands is, and that
is literally what shipped: no production file outside the SSOT may emit a wrapper
command, both inline serializers must enter `composeInlineRun`, and the needles
are DERIVED from `WRAPPER_MARK_TYPES` so a sixth wrapper joins by declaring
itself. Measured by neutering each half in turn: the pre-377 carrier return takes
14 legs, the discarded atom marks 5, the main parser's `inCode` 3, the fork's 1,
and a third speller 1.

#### The splitter half: a comment is inert to EVERY scan on the surface, or to none

Same round trip, and the case where the rule had been written down, shared, and
adopted by every scanner on the surface EXCEPT the three that decide where a
construct's parts begin (task 378). `scanLive`, `findPreambleTitleFields` (356),
`scanFigureBody` and `readParagraph`'s block-boundary test had all been taught
that a line-leading `%` is inert. The **body splitters** had not — so a construct
the author had deliberately commented OUT was PROMOTED into the printed document.
Six members, every one a FIXED POINT (no later save healed it), all landing on
OPEN via `readDocBundle`'s unconditional load-writeback:

- **M1 `splitListItems`.** `% \item Draft alternative.` became a **live, printed
  bullet**, with the orphaned `%` stranded alone on its own line.
- **M2 `splitPexBody`.** `% \a Draft alternative.` became a live example part —
  and expex computes each part's printed label from POSITION, so a phantom part
  **renumbers every part after it** and every `\ref` that names one.
- **M3 the gloss `tierPattern`**, a bare `/g` regex over the raw body: a
  `% \glb old //` minted a spurious live tier AND the orphaned `%` was tokenized
  into the row above as extra `glossCell`s, silently changing the column
  alignment the tier notation exists to express. Not even a fixed point.
- **M4 the same builder DELETED everything before its first tier marker.**
  Segments are built marker-to-marker, so `[0, markers[0].start)` was read by
  nothing and the node carried no field for it: a `% Mandarin, adapted from Li
  (2005)` note — or a `\setlength` tuning line — was simply GONE on the first
  save. The asymmetry that makes it unarguable: the same comment SURVIVES one
  line above the gloss, where `parseExampleBodyAsBlocks` explicitly carries it.
- **M4b …and a gloss body with CONTENT but NO tier marker was destroyed
  outright** — `\begingl\nsome text\n\endgl` → `\begingl\n\gla  //\n\endgl`.
  The `splitListItems` shape task 356 closed for lists, still live here, on
  WELL-FORMED input.
- **M5 `splitLinguexBody` was correct only BY ACCIDENT** (the `%` itself cleared
  its `lineStart` flag) — and its SERIALIZER twin then emitted a blank line after
  a carried comment, which in linguex is the example's **TERMINATOR**: on the
  next save every part after the comment fell OUT of the example, `\vxid`
  identity and all.

**No gate could see any of it.** M1–M3 MOVE words rather than losing them, so the
write gate's multiset measure scores a shortfall of ZERO; M4 costs four word
tokens in this fixture and fewer in the common shorter forms, at or under
`PRESERVATION_SLACK_WORDS = 4`.

> **A line-leading `%` is inert to every scan that walks raw bytes, read through
> ONE primitive — [`skipLineCommentAt`](src/lib/latex-lexer.ts). A REGEX scan,
> which cannot use a byte walk, gets the projection instead: SCAN PROJECTED,
> SLICE RAW. And a segment that is TOKENIZED rather than carried must hold no
> inert bytes at all — a construct whose body carries some is REFUSED whole.**

Six rules it earned:

- **The primitive is the NARROW rule, deliberately.** `startsLineComment`, not
  TeX's own any-unescaped-`%`, for the reason task 338 records: a terminator scan
  reading the wider rule calls a LIVE `\end{env}` inert and swallows the rest of
  the document. The mid-line `%` therefore stays exactly as task 347 left it, and
  the suite pins that so a later widening is a decision rather than a slip.
- **The failure direction is what makes the narrow rule safe here.** A splitter
  that skips a line it should not have skipped keeps those bytes inside the slice
  it is currently building — nothing is dropped, only unsplit — while one that
  fails to skip PROMOTES a comment into live output. Only one of those costs the
  user's document.
- **Declining to mint the tier was only half of M3.** A tier's segment is
  tokenized into CELLS, so inert bytes left inside one come back as columns. A
  row node has no slot for what it does not model, and inventing one per row
  would be guessing which tier a free-standing comment belongs to — so the gloss
  REFUSES (task 356's rule) when the projection diverges from the raw body at or
  after the first marker. One test covers a comment, a `\verb` run and a
  verbatim body instead of three.
- **A refusal is carried BYTE-LITERALLY, not through the prose fall-through.**
  `\endgl` is a block boundary, so `readParagraph` ends the paragraph before it
  and the two are rejoined with a BLANK LINE — a `\par` inside a construct we
  have just declined to model. The carrier also re-absorbs its own trailing
  `%!v:` anchor, exactly as the `\begin{env}` carrier does, or the anchor is
  re-read as a standalone empty block: one stray line per save, unbounded.
- **The pre-marker region is the one place that DOES have a slot**, so M4 keeps
  the model rather than refusing: `glossPreamble` on `exampleGloss`, raw and
  opaque, the `listPreamble` / `rawOptions` shape one construct over, with
  `keepOnSplit: false` for `itemLabel`'s reason.
- **The join owns the separator, so no assembly piece may end with a newline of
  its own.** The comment carrier's serializer appends one (task 347's "a comment
  owns its line"), and both example assemblies joined pieces with another. For
  expex that is a `\par` in a construct that does not take one; for linguex it is
  the terminator, which is where it was measured.

CI: [comment-blind-splitters.test.ts](src/lib/__tests__/comment-blind-splitters.test.ts).
Every list / example / gloss fixture in the repo is spelled the one way the code
happens to handle — with no comment in it — so each member is **unrepresentable**
in all of them, which is how they shipped green. Each leg drives the REAL save
pipeline over TWO cycles (cycle 1 is where the loss happens; cycle 2 proves
nothing accumulates) with the same fixture minus its `%` as a CONTROL through the
identical harness, so no leg can pass by making everything inert. The leg with
teeth is the CENSUS, and its membership is DISCOVERED rather than listed: the
population is every byte-walking scan that steps over an opaque construct,
because a scan that has to know a `\verb` run is not its business has to know a
comment is not either. Measured by neutering each half in turn: M1 takes 2 legs,
M2 2, the projected tier scan 2, the gloss preamble 2, the no-marker refusal 1,
the assembly join 1 — and removing the linguex comment skip fails ONLY the
census, which is precisely the "correct by accident" claim, stated.

**Residual, stated.** Non-comment unmodeled bytes AFTER the last tier's `//` are
still tokenized into that tier's cells; only the pre-marker region has a carrier.
Pre-existing and independent of comments (which the divergence test now refuses),
so it is recorded rather than fixed under an unmeasured guess.

#### The direction half: a table that CONVERTS must be able to convert back

Same round trip, and the case where the SSOT was one table, correct in one
direction, and read by nobody who could tell (task 380). `TEXT_MACRO_TABLE` maps
a backslash-led macro whose whole output is literal text onto that text. Two of
its four members had **no reverse direction at all**, and the two halves of the
defect were mirror images of each other — one lossy on PARSE, one lossy on EMIT:

- **M1 `\LaTeX` / `\LaTeX{}` / `\TeX` were DELETED from the user's only copy on
  OPEN**, with no edit — `Written in \LaTeX{} by hand.` came back
  `Written in LaTeX{} by hand.`, a fixed point from cycle 1, on both inline
  surfaces and inside headings. In the PDF `\LaTeX` typesets the stylized logo
  and the plain word does not, so the paper's rendering changed and the command
  was unrecoverable — the user could not even type it back, because task 360's
  type-time carrier marks a typed `\LaTeX` and the next parse converted it to
  text again. The `{}` left behind became a stray empty group.
- **M2 is the mirror image: the emit was the lossy direction.** The glyph → LaTeX
  map wrote `\ldots` with **no `{}` token break**, and TeX gobbles every space
  after a control word — so `So on… and so forth.` printed "So on…and so forth.",
  a space the user typed deleted IN THE PDF ONLY, for every ellipsis followed by
  a word. The `.tex` round trip was perfectly stable, so nothing downstream
  noticed.

- **M3 was found by probing the fix and is the same fork one member over.** A
  text macro inside a `\texttt{}` CODE SPAN was converted on the parse rung
  while the EMIT rung suppresses typography under a `code` wrapper — so
  `\texttt{a\ldots b}` came back `\texttt{a… b}`, a raw U+2026 written into the
  `.tex` on the first save. Task 377 M4 closed exactly this asymmetry for `--`
  and the accents and left the text macro out; the branch is `inCode`-gated now,
  in BOTH parsers, and the macro takes the raw-LaTeX carrier there like every
  other command.

**No gate could see any of it**: the `\LaTeX`→`LaTeX` conversion changes zero
word tokens under `WORD_RE = [A-Za-z0-9]+`, and M2 and M3 change no words at all.

> **A macro may join the PARSERS' vocabulary only if it stands for a GLYPH the
> document model holds — because that glyph is the only thing the serialize rung
> can restore it from.** A macro whose output is a typeset LOGO has no such
> character, so it is not a text macro: it is an ordinary unmodelled
> zero-argument command and belongs to the raw-LaTeX carrier, like every other
> one. And the mirror: **a glyph that leaves as LaTeX must leave as LaTeX that
> MEANS THE SAME THING**, which for a control word includes not eating what
> follows it.

Five rules it earned:

- **The parse table is DERIVED WHOLE from `LITERAL_TABLE`**, so "what the parser
  converts, the serializer restores" is structural rather than a property of who
  remembered to write a reverse map. Nothing may be stated in it; a new
  command-shaped literal joins by declaring itself where its glyph lives.
- **A reverse map was the wrong fix, and rejecting it is the interesting half.**
  `LaTeX` → `\LaTeX` would rewrite every literal occurrence of the word the user
  typed as PROSE into a command — worse than the bug. When a one-directional
  table cannot be made bidirectional, the answer is to stop converting, not to
  guess an inverse.
- **A DISPLAY projection may read the wider vocabulary, because a view never
  writes back** (task 368's rule, from the other side). So the logos live in a
  display-only table and `matchDisplayMacroAt` is module-PRIVATE: a name that can
  travel is a name a document writer can reach, and the destruction comes back.
- **The token break is DERIVED from the token CLASS, not declared per member.**
  `{}` iff the canonical form is a CONTROL WORD — a backslash plus a letter run,
  exactly the class TeX gobbles after — so a character run (`--`, `---`), where
  `{}` would print as a stray group, cannot pick one up, and a control symbol
  (which terminates itself) cannot either.
- **An emit-side token break is only safe if the PARSE side consumes it.**
  Without that, `\ldots{}` reads back as the glyph plus a raw-carried empty group
  (task 349 M6's bare-group carrier) and re-emits as `\ldots{}{}` — two more
  bytes on every save, forever. A SECOND group is content and is left alone.

**Declared normalizations, both one-time and idempotent:** a bare `\ldots` gains
its `{}` on the first save, and the accepted alias `\dots` settles on the
canonical `\ldots{}`. The second is PRE-EXISTING and worth stating precisely,
because the task text asserted the opposite — measured on the pre-380 tree,
`\dots` already normalized to `\ldots`. The glyph is what the model holds, so the
alias has nowhere to live and `latexForms[0]` is what "canonical" means.

CI: [text-macro-round-trip.test.ts](src/lib/__tests__/text-macro-round-trip.test.ts).
Every leg runs TWO cycles over BOTH inline surfaces and inside a heading, swept
FROM the tables so a new member is covered by declaration alone, with live
CONTROLS through the identical harness (the word "LaTeX" typed as prose, and a
character-run literal). **No pre-380 suite could see this**: every round-trip
fixture in the repo spells its typography the one way the code happens to handle,
and the two legs that named the macros at all pinned the CONVERSION as intended
behaviour — the defect asserted as the contract, renegotiated in place here. The
leg with teeth is the CENSUS: the door was never the part that could misbehave, a
writer that spells a logo macro itself or reaches the wider vocabulary is, and
neither is visible to any behavioural test of the shared door. Measured by
neutering each half in turn: restoring the logos to the parse vocabulary takes 6
legs, dropping the emit token break 5, dropping the parse-side consumption 7,
hand-writing one member into the derived table 6, and dropping the `inCode` gate
2 (1 per parser — the twin rule, measured per fork).

**Residual, stated.** A `latexCommand`-carried run is projected for a READER by
`latexToDisplayText` (the citation and bibliography surfaces) but not by
`richJsonToPlainText`, so a card preview / drag ghost / search projection of a
body holding `\LaTeX` now shows the command rather than the word — exactly as it
already does for `\emph{x}` and every other carried command. Routing that
projection through the display door is task 368's law applied to a second
surface, with its own census, and is out of scope here.

#### The carrier half, declared: a node whose model IS its bytes says so

Same round trip, and the case where the rule was right and the mechanism that
enforced it had to RECOGNIZE its own output after the fact (task 383).

`collapseBlankRuns` is the one pass entitled to tidy generated `.tex`, and it
must never touch bytes the serializer CARRIED. It decided which was which by
matching `\begin{env}…\end{env}` out of the finished string — a heuristic
recovery of information the emitter had and threw away, and it can only see two
things: an environment, and one whose opener arguments close on the opener's own
line. Two shipped nodes carry bytes it can see neither way. `texBlock`'s body
sits between `%!vtex:` sentinels, so a 3+ newline run inside it lost a blank line
on the FIRST save — silently, idempotently, in the node whose whole contract is
passthrough. `forestBlock`'s `source` may open `\begin{forest}[Root` across a
line break, which defeats the argument matcher and the tail alike.

> **A node whose model IS its bytes KNOWS they are carried, so it SAYS so.**
> `carriedSource(bytes)` wraps an emitted verbatim span in a sentinel pair that
> `collapseBlankRuns` stashes before it collapses anything and strips on the way
> out. For attr-carried source the property is then structural; the recognizer
> survives only for the generic env CARRIER, whose bytes no emitter declares.

Three rules it earned:

- **Declared spans are stashed BEFORE recognized ones.** A `\begin{…}` inside
  carried source is then already a placeholder, so it cannot confuse the
  recognizer — which is a second, free correctness win over the pre-383 order.
- **The sentinels never escape, and that is stated rather than hoped.** Every
  path that emits them ends at `collapseBlankRuns` (`assembleLatex` for the
  per-block pipeline, `serializeToLatex`/`serializeBodyOnly` for the whole-doc
  walk); `serializeParagraphInline` is the one export that skips the collapse
  and it serializes a PARAGRAPH, where no block atom can appear. The restore
  also strips an unpaired sentinel defensively.
- **`forestBlock` is the model this makes cheap.** Task 383 claims
  `\begin{forest}…\end{forest}` whole — `source` holds the entire environment
  verbatim, the serializer emits it plus `uuidAnchorSuffix(uuid)`, and the
  renderer (task 384) is a pure derivation that cannot subtract from it. So the
  342/356 refuse-whole law is satisfied trivially: there is no structured tree at
  the document layer to lose anything from. Its one parser subtlety is that a
  forest's leading `[` is the TREE, not an option — the dispatcher's bracket
  scanner is skipped for that env, or on a body whose brackets do not balance
  the terminator search starts past the real `\end{forest}` and two trees fold
  into one.

The pod both wearers render through is shared too — `SourcePodNodeView`
in place, `source-pod-body` popped out, `.source-pod*` in CSS with only the HOST
class naming a node (`STYLE_GUIDE.md` → "Source pods"). CI:
[forest-block-roundtrip.test.ts](src/lib/__tests__/forest-block-roundtrip.test.ts)
drives the REAL save pipeline over TWO cycles per shape, with the generic
carrier and an UNTERMINATED opener as controls; measured by neutering each half
in turn, the parser claim takes 13 legs, the declared carry 2 (one of them the
shipped texBlock defect) and the bracket-scanner guard 1.

#### The view half: a derived VIEW may refuse freely, and must do so LOUDLY

Same node, the other direction (task 384) — and the case where the vocabulary
laws above (342/355/356: *model a subset, refuse WHOLE outside it, never guess*)
apply to something that is not a parse at all.

`forestBlock`'s model is its bytes, so a RENDERER over those bytes cannot lose
anything: a refusal costs the user a picture, never a byte. That asymmetry is
the whole design, and it inverts the usual cost of refusing. Where a parser's
refusal means carried source in place of a modelled node — a real loss of
affordance — a view's refusal means a badge instead of a drawing, over an
untouched document. So the subset can be small and honest rather than wide and
hopeful.

> **A VIEW derived from bytes renders exactly what it understands and BADGES
> everything else — LOUDLY, VISIBLY, ATTACHED to the object, and NAMING the
> construct it refused.** A drawing produced by ignoring a layout option the
> author wrote is a MISRENDER wearing a feature's clothes: it is well-formed,
> plausible, and the user has no way to detect it. A badge naming `for tree` is
> a limitation they can see, work around and file.

Seven rules it earned:

- **Render and refusal come from ONE parse.** They are two halves of a single
  verdict, and a surface that asked twice could paint a badge over a tree.
  `deriveForestPod` answers both, and both pod surfaces read it — the same
  "one implementation, per surface" rule the pod chrome itself follows, for the
  same reason: a float that badged differently from the docked block would make
  a lift change the diagnosis. The SEAM is generic and the BADGE is not, which
  is the line "deep ≠ broadest blast radius" draws: `SourcePodConfig.derive`
  returns `{ preview, banner }` and the pod styles neither, so the next kind
  whose bytes can be drawn inherits the chrome, the toggle, the print rules and
  the memo — while `.forest-refusal-badge` stays named after its one wearer
  until there is a second.
- **The refusal is SPECIFIC or it is nothing.** A closed `ForestRefusalKind`
  union, one sentence per kind composed in ONE function (`describeForestRefusal`)
  that the badge and the suite both read, and a byte offset. The suite has a leg
  PER unsupported construct class asserting the kind AND the echoed token,
  because a refusal that fires for the wrong reason is a wrong message — it
  sends the user to change a byte that was never the problem — and every such
  leg would pass on a parser that refused everything.
- **It is a WARNING, not an alarm** (STYLE_GUIDE → "RED means an action would
  destroy content WITHOUT a net"). Amber, over intact bytes, with the source
  right under it.
- **Nothing derived is persisted.** No `renderable` attr, no sidecar note, no
  cached parse — which is what makes growing the whitelist additive with no
  migration: each new key moves inputs from the badge to the render.
  [forest-render-derived.test.ts](src/lib/__tests__/forest-render-derived.test.ts)
  drives two save cycles over accepted and refused sources and asserts the two
  are indistinguishable downstream, with the node's attr key set asserted as a
  CLOSED set rather than as "does not contain X" — a future "just cache it on
  the node" must be a failing test, not a name someone forgot to add to a
  denylist.
- **The geometry is PURE and its invariants are swept, not pinned.**
  [layout.ts](src/lib/forest/layout.ts) is a contour-based tidy tree (variable
  widths; a sibling is pushed right by exactly what clears every shared depth),
  DOM-free for the reason the marginalia grid packer is: a pinned pixel is a fact
  about the last commit, where "no two labels overlap", "a parent is centered
  over its children's span" and "a roof spans the box it claims" are true of
  every tree or of none. Measured by neutering the contour to depth 0 — three
  overlap legs fail.
- **`roof` resolves to ONE box, and which box is not obvious.** A roofed
  INTERNAL node keeps its label and gains a synthesized child holding its
  descendants' leaf text under the triangle (forest's own semantics — the
  internals genuinely disappear); a roofed LEAF wears the triangle itself, the
  `[{the dog},roof]` idiom. A roof INSIDE a roofed subtree is refused rather than
  silently swallowed: two interacting triangles are exactly the guess this
  grammar exists not to make.
- **It reads TeX's OWN comment rule, and that is the one place this grammar
  deliberately parts from the parser.** Every byte-walking scan in the parser
  reads the NARROW line-leading `startsLineComment`, because a construct-
  TERMINATOR scan that believes a mid-line `%` calls a live `\end{env}` inert
  and swallows the rest of the document (task 338). Nothing here terminates a
  construct — the source is already claimed and its ends are fixed — and the
  narrow rule would MISRENDER: `[S %draft` is a node labelled "S" in forest and
  would have rendered as one labelled "S %draft", which is precisely the
  silently-wrong picture the whole design refuses. Where a mid-line comment does
  eat a delimiter, the refusal that follows is the one forest's own compiler
  gives.
- **A view that parses whatever is PASTED into it states its bounds — on EVERY
  recursive axis, not the obvious one.** The scanner, the roof flattening and
  the layout's three walks all recurse, so a pasted `[`×10 000 would not refuse:
  it would throw a `RangeError` out of a React render, and this app has no error
  boundary anywhere. `MAX_FOREST_DEPTH` (64) and `MAX_FOREST_NODES` (512) are
  refusals instead, far past any real syntax tree and far short of anything that
  hurts. The half worth remembering is that the first cut bounded only the axis
  it was thinking about: a LABEL's `{}` nesting is its own recursion, and a
  single node with a deeply braced label costs depth 0 and one node, so neither
  cap could see it — measured, a balanced 10 000-level group overflows the stack
  and a 4 000-level one costs 50 ms of superlinear re-scanning synchronously in
  render. A bound whose failure mode is a badge is a bound worth having; one
  whose failure mode is a crash is a latent trap, and "I bounded the recursion"
  is a claim per axis.
- **A comment rule adopted for a scan is adopted for every scan that scan
  DEPENDS on.** Reading TeX's rule in `skipInert` / `scanLabel` / `scanOptions`
  and then resolving a label's `{…}` group with the shared, comment-BLIND
  `findMatchingBrace` fails in both directions at once: a `}` inside a `% …`
  line closes the group early and the real `}` falls through as ink (a
  well-formed tree carrying a brace forest never prints — the silently-wrong
  picture again), while a `{` inside a comment produces a spurious `unbalanced`
  refusal on source TeX reads as balanced. The same shape one field over: the
  option scan STEPPED OVER comments to find its terminator and then sliced its
  token RAW from that span, so `[NP,roof % triangle]` refused with "node option
  `roof % triangle`" — an option the user never wrote, with `roof` visible
  inside the thing it called unsupported. Both were found by the adversarial
  pass, both are the module contradicting its own stated subset, and both are
  now assembled from the LIVE spans.
- **…and a primitive that publishes HALF an operation is how the fourth scanner
  gets it wrong** (task 406, the residual of the residual). `matchCommentTailAt`
  answers a REPRESENTATION question — *which bytes are the comment* — and stops
  short of the newline; every caller assembling TEXT also needs the READING
  answer — *where does TeX RESUME*, past the newline TeX discards and past the
  continuation line's leading indent (state N). That second half was re-derived
  per scanner, correctly in `scanLabel` and nowhere else, so `scanOptions`
  spliced the continuation's bytes into its token and refused LOUDLY with
  `node option \`ro\nof\`` on `[NP,ro%\nof]` — a user breaking forest's only
  legal option across a `%` continuation, which TeX reads as `roof`. It ships as
  a documented PAIR now (`skipCommentContinuationAt`, immediately below its
  sibling), because a caller genuinely has to CHOOSE — and the half that proves
  it is the NEGATIVE one, stated at both ends: the byte carrier in
  `parseInlineContent` must NOT call the door, since the newline is the USER's
  byte and is carried into the `latexCommentTail` node. **A cleanup that made
  the two "consistent" would silently eat a line break out of the source on
  every save.** Task 273's rule ("publish whole OPERATIONS, never the pieces")
  in its mildest form — and note the census here was worth almost nothing: five
  of six callers were already right, two of them *precisely because* they do not
  skip. The value was the door and the two sentences beside it, not the sweep.
- **A view measured with NO BOX must be told when it gets one.** A `forestBlock`
  inside a folded section stays MOUNTED — `.section-folded` is a node
  DECORATION, not an unmount — so its first layout runs with every rect at 0×0
  and is placed from canvas estimates, and NOTHING in the effect's dependency
  list changes when the section is unfolded. Fold state is persisted per doc and
  restored on open, so that is an ordinary starting condition rather than a
  race, and the failure is permanent and silent: edges converging beside their
  labels, a roof spanning the wrong width. Un-hiding is not an event a component
  can see, so the 0 → non-zero BOX is the signal — ONE app-wide
  `ResizeObserver` ([measure-watch.ts](src/lib/forest/measure-watch.ts), the
  `card-near-zone` shape), whose callback is a width compare plus a
  `degraded()` read and which bumps nothing for a tree that measured cleanly.
  The companion half is that the two measurement rungs must be
  INTERCHANGEABLE: the DOM reports a border box and the canvas reports text, so
  the fallback adds the label's own padding back or a canvas-measured tree draws
  every label off-centre from where it was placed — and the canvas rung is
  exactly the one a hidden first render takes, so the two compound.
- **Keystroke sanctity for a derived view is a question about the CALLBACK, not
  the subscription.** This NodeView never sees the editor, which proves nothing
  on its own: a React NodeView is re-rendered by its host for reasons it does not
  control, and a re-render that re-parses, re-measures and re-lays-out is O(tree)
  per keystroke however innocent its subscription list looks — the `float-sync`
  shape. So the pod memoizes the derivation on `(derive, source)` (which is why
  the config is a module-scope CONSTANT: a per-render literal is a new memo key
  every render), the view memoizes on tree identity, and
  `window.__forestRenderStats()` counts parse / measure / layout / render
  SEPARATELY so a regression names itself.

**The cost suite's own shape is the lesson.** Its burst legs — type twenty
characters three paragraphs away, assert every counter flat — prove the
user-visible contract and are worth having, and they were MEASURED to stay green
with the pod's memo deleted, because ProseMirror does not re-render a NodeView
whose node did not change. An invariant with no leg is a habit (task 334), so
each bail got a leg that can actually see it: the pod's memo is driven by a
parent that re-renders for its own reasons, and the view's `memo` comparator is
visible only to a RENDER counter (the effect deps already stop the measure and
the layout, so an unbailed re-render reconciles every label element and re-runs
no effect — cheap enough to be invisible to the other three counters, and
O(nodes) all the same). Both fail when neutered; without those two legs, both
bails were deletable in silence.

**Six of the seven findings the adversarial pass confirmed were in this
cluster's own seams rather than in its algorithms**, which is worth recording as
a pattern: the grammar's three were each the module disagreeing with a rule it
had just written down, and the chrome's three were a per-kind inline style
becoming a shared class (a wrapper that started catching clicks the pod used to
pass through; a scroll box that positioned the pod's own corner against its
CONTENT, so the one control that reaches the source slid out of reach on exactly
the trees that need it; a print rule that reset the frame and left the clipping).
None was visible to any behavioural test of the piece it lived in.

CI: [forest-grammar.test.ts](src/lib/forest/__tests__/forest-grammar.test.ts),
[forest-layout.test.ts](src/lib/forest/__tests__/forest-layout.test.ts),
[forest-render-cost.test.tsx](src/components/__tests__/forest-render-cost.test.tsx),
[forest-render-derived.test.ts](src/lib/__tests__/forest-render-derived.test.ts),
[forest-chrome-contract.test.ts](src/lib/forest/__tests__/forest-chrome-contract.test.ts)
(the ink, the amber tier and the print rules in BOTH directions — the tree
prints, the frame / corner / badge do not).

**Owed, not claimed:** the preview eyeball. Nothing here is FSA-masked — it is a
render over bytes — so pasting two or three real trees from a paper (subset
members and a `for tree=` refusal) and looking at both states is a cheap, real
check that a worktree cannot run.

##### The tail half: an anchor appended after USER-EDITABLE bytes needs those bytes to END where the reader looks

Same node, and the case where task 348's position law was correct, was cited by
the arm that broke it, and held only by an accident the source pod removed (task
387, the cluster's DATA-SAFETY adversarial pass).

348 says a construct's `%!v:` anchor is APPENDED to the end of its serialized
body and DETACHED from the end of that body — one rule, so the two ends cannot
disagree. For every other construct the emitter BUILDS the body, so they are the
same place by construction. `forestBlock`'s body is a user-editable ATTR, and
both pod write doors (`SourcePodNodeView.setSource`, the float's write-back)
store CodeMirror's buffer verbatim, with no normalizer on the node spec. So the
two ends coincided only while nobody put a byte after `\end{forest}`.

> **The renderer accepts `\s*` after the closer and the anchor reader accepts
> `[ \t]*`. A source in that gap renders perfectly and DE-ANCHORS silently.**

One press of Enter after the closer — or a paste, since every editor line-copies
with a trailing newline — put the anchor on its own line, where
`NODE_UUID_ANCHOR` cannot see it. Measured through the real save pipeline: the
tree came back uuid-less, `assignUuids` minted a fresh id, and the stranded
` %!v:ab12` line took the parser's standalone-anchor branch and became an EMPTY
PARAGRAPH holding the old identity. Every card, marginalia marker and
sidecar-only `parTitle` keyed on that uuid followed it onto a blank line;
`collapsed` was dropped outright (a `paragraph` is in `TITLED_NODE_TYPES` and not
in `COLLAPSIBLE_NODE_TYPES`). A fixed point after one cycle, with no edit to the
document itself — **the task-342 class verbatim**, and invisible to every gate:
the write gate's multiset word measure is unchanged, and 384's `END_RE` tolerates
`\s*$`, so the refusal badge stayed green for exactly this shape.

Three rules it earned:

- **Normalize at the EMIT site, not at the doors.** The serializer's arm trims
  the source's trailing whitespace before appending the anchor, so the append
  point and the detach point coincide *by construction* rather than by two write
  doors remembering to agree. The shipped siblings show both shapes and are the
  reason this is forest-specific: `texBlock` is immune because its anchor rides a
  `%!vtex:begin` SENTINEL LINE, and `graphicsBlock` — the only other
  `${bytes}${anchor}` emitter — is immune only because its edit door happens to
  `.trim()`. `forestBlock` was the one emitter of that shape whose every write
  door wrote raw.
- **It is a whitespace normalization, and idempotent.** Whitespace before the
  closer's own line end is not content and the arm appends `\n\n` regardless,
  so cycle 1 canonicalizes and cycle 2 is byte-identical.
- **Residual, stated: NON-whitespace after the closer is left alone because it
  is already LOUD.** A trailing `% note` or a second pasted environment makes
  `END_RE` refuse, and 384's badge names it. A fix that made the quiet case loud
  and the loud case quiet would be the wrong trade.

**A bookkeeping SENTINEL is invisible to every predicate the serializer asks
about its own output.** The same pass found 383's `carriedSource` marker leaking
into a question one arm over: `listItem` chooses its head/tail separator with
`startsBlockBoundary(tailText…)`, which is anchored `^\\(…|begin|…)` and
therefore answered *false* for a `forestBlock` tail child whose true first bytes
are `\begin{forest}` but whose emitted first bytes are the NUL-led sentinel
(stripped only later, in `collapseBlankRuns`). The item gained a blank line — a
LaTeX `\par` inside `\item`, typesetting the tree as a fresh indented paragraph
— while a nested `\begin{itemize}` in the identical slot was correct. That makes
it the cluster's own regression rather than a shared property: forestBlock is the
one node whose real first bytes ARE a boundary and are hidden behind the
sentinel. The predicate now reads `withoutCarrySentinels(…)`, a named helper
beside `carriedSource` so the next such question inherits it.

**And the renderer painted text the source does not say.** TeX's end-of-line `%`
is the standard CONTINUATION idiom — the `%` discards the rest of its line
INCLUDING the newline, and the next line is entered in state N so its leading
spaces are eaten — so `[{Deter%\nmine}]` typesets `Determine`. `matchCommentTailAt`
returns the newline's INDEX rather than a position past it, so `scanLabel`'s
`i = c.end` landed ON the `\n`: the branch pushed a space, the next iteration
pushed the newline as text, and the whitespace collapse turned the pair into ONE
space where TeX yields none. The parse answered `ok`, the badge stayed silent,
and the tree read `Deter mine` — the silently-wrong picture 384's whole design
exists to refuse. The site's own comment asserted the opposite ("the whitespace
collapse below makes that difference invisible in a label") and is corrected
there rather than left standing. Only `scanLabel` was affected: `skipInert`, the
brace matcher and the option scan all skip whitespace anyway.

CI: [forest-source-tail-integrity.test.ts](src/lib/__tests__/forest-source-tail-integrity.test.ts).
**No pre-387 suite could see any of the three.** Every `source` fixture in the
repo ends EXACTLY at `\end{forest}` (they all come from a parse, which slices to
the closer), so a trailing byte is unrepresentable in all of them; the cluster's
one list fixture asserts the MODEL SHAPE (`paragraph` head + `forestBlock` tail)
and never the bytes; and every grammar fixture spells its labels without the `%`
continuation. Each leg carries its control through the identical harness — an
untouched tree is byte-identical, a nested list keeps its single newline, a
second PARAGRAPH keeps its `\par`, an ordinary line break inside a label is still
one space, and an escaped `\%` is still ink. Measured by neutering each half in
turn: the trailing trim takes 4 legs, the sentinel strip 1, and the label
continuation 3.

**Owed, not claimed:** the preview eyeball — open a tree's source pod, press
Enter after `\end{forest}`, save and reload with a note card anchored to it. This
class is not FSA-masked (it is `.tex` bytes through the real save cycle), so the
check is cheap and real.

###### The tail's other half: an exemption is scoped to the shape it JUSTIFIES

Same emit site, same law, and the case where the fix above was right about the
bytes it examined and was then read as covering the tail (task 405). 387 trimmed
trailing WHITESPACE before the append and recorded NON-whitespace as a residual
on one stated ground: *"that shape is already LOUD, because `END_RE` refuses it
and the 384 badge names it."*

**The badge is loud BEFORE the save and gone AFTER it, and the transition is
exactly the save that does the damage.** Two shapes, both reachable by one
ordinary gesture in a surface the user TYPES in:

- **A trailing `% note`.** `uuidAnchorSuffix` always prepends a space, so the
  emitted line is `% note %!v:ab12`. `NODE_UUID_ANCHOR` is `^[ \t]*`-anchored
  and the dispatcher tries it right after `\end{forest}` — a miss — so the tree
  comes back uuid-less and `assignUuids` mints a fresh one, while the stranded
  line becomes a **`latexComment` holding the old id**. That comment is in
  `UUID_BEARING_NODE_TYPES` and in NEITHER `TITLED_NODE_TYPES` nor
  `COLLAPSIBLE_NODE_TYPES`, so `mergeSidecarTitles` **DESTROYS the pod's
  `parTitle` and its `collapsed` state** on the way past — task 343's read sets,
  arriving as a loss rather than as a refusal.
- **A second pasted `\begin{forest}`.** The anchor lands after tree B's closer,
  so tree B harvests it and the title and the collapse migrate with it.

Only the IDENTITY is silent — unlike tasks 342/348 the user must first type
bytes the pod visibly refuses, and the document visibly restructures. That is
why this was `normal` and not `high`, and it is also why the "already loud"
argument was so nearly right.

> **Where the emitter does NOT own the body, the end of the ATTR and the end of
> the CONSTRUCT are different places, and the anchor goes at the CONSTRUCT's.**
> [`anchorCarriedBody`](src/lib/uuid.ts) is the rule, beside the 348 pair;
> [`carriedEnvEnd`](src/lib/latex-lexer.ts) and
> [`graphicsCommandEnd`](src/lib/figures/parse-attrs.ts) are the two scanners,
> each the SAME primitive the node's own parser branch reads. The bytes the
> reader will not claim follow the anchor, where they round-trip as themselves.

Six rules it earned:

- **The scanner is INJECTED, not dispatched on.** Only the emitter knows which
  construct it is writing, and the whole invariant is that its answer comes from
  the scanner the READER uses — `matchBeginEnvAt` + `findMatchingEnv` for an
  env, `matchIncludegraphics` for the command. A two-entry dispatch table inside
  the door would be a hand list that has to stay in step with the two emitters,
  which is the drift this file legislates against everywhere else.
- **`null` OMITS the anchor.** Bytes that open no recognizable construct are
  bytes whose node is not coming back as itself, so appending only decides WHO
  steals the identity. Omitting re-mints on reload and orphans the cards
  LOUDLY, which is a fact the user can see. That is design option (b) applied
  exactly where option (a) has nothing to hold on to.
- **The sentinel was weighed and declined.** `texBlock` is immune to this whole
  class because its anchor rides a `%!vtex:begin <uuid>` LINE rather than the
  body's last byte, and generalizing that shape would have been the safest
  possible fix — at the price of changing the emitted bytes of every well-formed
  tree in every paper. Its arm now carries the `carried-anchor-exempt:` marker
  that says so, rather than being immune by an accident nothing states.
- **`graphicsBlock` stops being immune by ACCIDENT.** Its edit door happens to
  route through `extractGraphicsAttrs`, which returns the MATCHED substring and
  drops a tail outright — true, pinned, and not a property of the emit site. Its
  `attrs === null` fallback stores raw text verbatim, and there the door now
  omits rather than handing the id to the paragraph those bytes become.
- **Two carried spans, not one.** The head and the tail are each wrapped in the
  383 carry sentinel with the anchor between them, so an interior blank run in
  either half still survives `collapseBlankRuns`.
- **The third door had to agree too, and that is what made the badge honest.**
  `END_RE` is `\end{forest}\s*$` — it resolves to the LAST closer in the string,
  where the parser and the emitter stop at the FIRST properly-matched one. That
  gap is why BOTH messages were wrong: a trailing note refused as "not a
  `\begin{forest}…\end{forest}` environment" (it is one, plus a note), and a
  second tree refused as "content after the tree", naming tree A's own closer as
  the offending content. The renderer reads `carriedEnvEnd` now and names the
  tail for what it is (`after-environment` / `second-environment`), so the
  writer, the reader and the renderer hold ONE view of that boundary.

**Decided, stated at the site: no commit-time refusal at the pod.** It is a
surface the user types in, and refusing a commit mid-edit would be Virgil's only
such refusal. What the pod does with the extra bytes is LOSE them, one block
over, as themselves — which it already did; what changed is that the first tree
keeps its uuid, its title and its collapse instead of handing all three away.

CI: [carried-body-anchor-position.test.ts](src/lib/__tests__/carried-body-anchor-position.test.ts).
Every leg drives the REAL save pipeline over TWO cycles carrying the SIDECAR
(nothing serializes `parTitle` or `collapsed` into the `.tex`, so a round trip
that drops it cannot see the loss at all) and asserts the parsed node's `uuid`
ATTR, never a `%!v:` grep of the emitted bytes — a dead marker stranded inside a
comment still matches the grep, the trap that sank the first draft of 387's own
M4 leg. The FIXED POINT is cycle 3, not cycle 2, and the leg says why: the
displaced bytes come back as a block with no id, so `assignUuids` mints one for
them on the next open — the ordinary path for any new block, and precisely the
settle the pre-405 emitter never reached, where the TREE was the block being
re-minted every cycle forever. The leg with teeth is the CENSUS: membership is
DISCOVERED from the serializer's own arms (a `case` spelling `carriedSource(` or
`anchorCarriedBody(` is a node whose model IS its bytes), each must enter the
door or carry the marker, the allowlist is EMPTY, and the retired
`${attr}${anchor}` shape is pinned to its two legitimate non-members by REPORT
rather than excluded by name. Measured by neutering each half in turn: the
pre-405 append takes 9 legs, the omit-on-`null` rule 3, the badge half 3 (one of
them 387's own renegotiated leg), and the dropped exempt marker 1.

**Owed, not claimed:** the preview eyeball — paste a tree, press Enter after
`\end{forest}`, type `% note`, save and reload with a note card anchored to it.
Not FSA-masked (`.tex` bytes through the real save cycle), so the check is cheap
and real.

##### The projection half: a schema's vocabulary is every PROJECTION's vocabulary

Same pass, and the case where two hand-written tables had a comment telling the
next author to keep them aligned, and `forestBlock` was added and they were not.

A card body's schema admits six BLOCK ATOMS (`CARD_BODY_BLOCK_ATOMS`, now
declared in the import-free leaf [node-attr-sets.ts](src/lib/node-attr-sets.ts)
and re-exported by `borrowed-schema.ts` as `BORROWED_BLOCK_ATOM_NAMES`, whose own
contract test pins it against the REAL card and main-editor extension lists in
both directions). A block atom keeps its content in ATTRS, so a walker with no
arm for it does not degrade — it falls through to `if (node.content) …` and
returns `""`.

> **Every PROJECTION of a card body is TOTAL over the block-atom vocabulary that
> body's SCHEMA registers.**

`richJsonToPlainText` losing an arm costs a blank preview. `richJsonToLatex` is
what a `\footnote{}` body is SERIALIZED with, so losing one costs the user's
bytes: a forest tree dropped or pasted into a footnote/note body mounted happily,
rendered, and was DELETED from the `.tex` on the next save — no throw, no
warning, the rest of the body intact, while its shipped sibling `texBlock`, whose
arm sat four lines away, kept its bytes. Both tables are now
`Record<CardBodyBlockAtom, …>`, so a new block atom is a COMPILE ERROR rather
than a silent deletion.

Two rules it earned:

- **The vocabulary lives where the layer that needs it can REACH it** — the
  placement rule `latex-markers.ts` and `node-attr-sets.ts` each earned.
  `footnote-content.ts` is on the TipTap-free `.tex` side and cannot import the
  extension list, which is exactly why it re-typed the vocabulary and exactly how
  the re-typed copy came to be missing a member.
- **An INLINE-registered atom keeps its own arm.** `displayMath` is in
  `BORROWED_INLINE_ATOM_NAMES`, not the block table, and is still an attr-carrier
  the fall-through would erase — so it is handled beside the table with the
  reason at the site, rather than smuggled into a set it is not a member of.

CI: [card-body-block-atom-projection.test.ts](src/lib/__tests__/card-body-block-atom-projection.test.ts),
swept FROM the vocabulary so a new kind arrives with no fixture and the coverage
leg fails first. **No pre-387 suite could see this**: the footnote-content suites
drive bodies of prose plus inline atoms — the shape a footnote body normally has
— so a block atom reaching either walker is unrepresentable in all of them, and
the borrowed-schema contract asks only whether the two SCHEMAS agree, never
whether anything downstream can represent what they admit. The leg with teeth is
the CENSUS, and its membership is DISCOVERED by the SHAPE the defect had — a
walker dispatching on `node.type === "<atom>"` for two or more block atoms —
because a bare "names ≥2 atoms" needle indicts ten files that merely carry a
union, a registry key or a kind list, and answers a different question
(measured). Measured by neutering each half: dropping the forest arms takes 3
legs, restoring the pre-387 if-chain 5.

**Residual, stated.** `richJsonToLatex` collapses whitespace — a footnote body is
INLINE — so a tree projected into one arrives on a single line. That is the
shipped `texBlock` behaviour and it is what forest's own whitespace-insensitive
grammar tolerates; the contract this closes is that no byte is lost, not that the
layout survives an inline flattening.

##### The display half: a label a READER looks at enters the display DOOR

Same node, the UX/PERF/GUARD-INTEGRITY pass (task 388, adversarial run 2) — and
the case where the design's own headline rule was applied to every construct the
grammar REFUSES and to none of the bytes it ACCEPTS.

A forest node label is a raw-LaTeX fragment shown to a human. Task 368 built one
door for exactly that question (`latexToDisplayText`) and gave it a census that
discovers members from the bib-parsers' `format*` exports — so it is
structurally blind to a scanner in `src/lib/forest/`. `scanLabel` pushed every
non-escape byte into the label verbatim (its whole vocabulary was a private
seven-entry `LABEL_CHAR_ESCAPES`) and the view put it straight into a span. So
`` [{``the dog''}] `` — the universal gloss-quoting convention for tree labels —
is ACCEPTED, no badge fires, and the pod paints eight ASCII characters where the
compiled PDF shows curly quotes. Same for `S--O` (two hyphens, not an en dash)
and `Fig.~1` (a literal tilde, not a tie). **An accepted source drawn as a
picture it does not say, which is the one outcome task 384's design exists to
refuse** — and the user has no way to detect it.

> **A raw-LaTeX fragment shown as DISPLAY TEXT enters the door wherever it
> lives**, including inside a renderer's own scanner. The projection is about
> what accepted bytes LOOK like; it never widens what is accepted.

Three rules it earned:

- **Project the ASSEMBLED run, after the structural branches have taken their
  bytes.** Math, groups, comments and the delimiters are consumed first, so the
  door only ever sees prose plus the char escapes the scanner already resolved,
  and it passes anything it does not know straight through. A `\command` in a
  label still refuses at the backslash branch, BEFORE any of this — pinned by
  its own leg, because the tempting reading of "enter the door" is "accept what
  the door accepts".
- **The flat `labelText` is rebuilt from the PROJECTED segments**, not from a
  raw accumulator kept beside them. It is the canvas measurement rung and the
  a11y string: `` ``x'' `` is six bytes and `“x”` is three, so a raw flat string
  hands the two measurement rungs different widths — the exact contract
  `borderBoxFromTextWidth` exists for.
- **The whitespace collapse runs BEFORE the projection and never after.** `\s`
  matches U+00A0, so a second pass flattens the `~` TIE the door has just
  produced back into an ordinary space — measured, that was the fix's own first
  cut.

The same pass closed two more, both of which were BLANK rather than wrong:

- **The T1 static card tier painted NOTHING for a source pod.** A block atom
  keeps its payload in ATTRS, so a `renderHTML` that emits only a wrapper `<div>`
  projects to an empty element wherever the NodeView is not what renders —
  `renderBorrowedHtml`'s static tier (whose own doctrine is that it paints
  "visually identical" to the live tier, and the live tier here is the pod's
  card-context `<pre>`) and the CLIPBOARD, since ProseMirror serializes a copied
  slice through the node spec's `toDOM`. `sourcePodStaticBody`
  ([src/lib/tiptap/source-pod-static.ts](src/lib/tiptap/source-pod-static.ts))
  is the shared child spec both source-pod nodes now emit — a bare string child
  becomes a TEXT node, so the bytes are escaped by the serializer, and the node
  stays `atom: true`, so `parseHTML` still reads the source off the ATTRIBUTE
  and ignores the child. This is task 387's projection law with a THIRD member:
  `richJsonToLatex`, `richJsonToPlainText`, and the static HTML tier.
- **The RO's `degraded()` gate had no leg**, which the run measured: deleting
  `if (!waiter.degraded()) continue;` from `measure-watch.ts` left all 212 legs
  of the cluster green. The gate is what the module's whole docstring rests on
  ("a tree measured from real boxes ignores every fire"), and jsdom reports 0×0
  for everything — so a NON-degraded first measure is unrepresentable without
  stubbing the rect read, which is exactly why the hidden-case leg could ship
  while its complement could not be seen. **And the harness that drives it was
  itself fragile in a way worth carrying forward:** the suite mounts a real
  CodeMirror (every refused pod pins to its source surface) and CodeMirror
  constructs a `ResizeObserver` of its own, so a single shared `deliver` binding
  is whichever observer was built LAST. The stub records observers
  PER INSTANCE and delivers to the one that actually observed the host.

CI: the projection legs live in
[forest-grammar.test.ts](src/lib/forest/__tests__/forest-grammar.test.ts) and are
asserted AGAINST THE DOOR rather than against hand-written glyphs — the contract
is that the two agree, so a vocabulary change moves both or neither — with a
plain-prose control, since a leg comparing two calls of one function passes on a
projection that mangles everything. The static tier is the third sweep in
[card-body-block-atom-projection.test.ts](src/lib/__tests__/card-body-block-atom-projection.test.ts),
matched against the markup with every ATTRIBUTE stripped: the payload is already
in the markup as `source="…"`, so a raw `toContain` passes on the very output
the leg exists to indict. Measured by neutering each half: the label projection
takes 6 legs, the static body 2, the `degraded()` gate 1.

**Residuals, filed rather than fixed** (`inbox/2026-08-20-from-worker-388-…`):
the slash popup DELETES the typed text before it discovers the action is
disabled — lossy, and shared by every view-only slash command, in a file this
cluster never touched; a COLLAPSED source pod prints a two-line truncated
preview, which is neither of Virgil's two existing postures (a folded section
prints nothing, an expanded pod prints its body) and needs a render change plus
a product call; `figureBlock` and `graphicsBlock` still project to nothing in the
static tier, each named with its reason in the sweep's own
`NO_STATIC_PROJECTION`. **Owed, not claimed:** the preview eyeball — this run was
unattended and could not start a dev server.

**The fourth residual is now a DECIDED posture rather than an open one (task
412): an edge to an outer child MAY cross a roofed middle sibling's triangle,
and that is accepted and pinned.** Edges and roofs are built from the placed
boxes in two loops that do not know about each other, so where a parent has ≥3
children and a NON-OUTER one is a roofed LEAF, an outer sibling's edge clips the
triangle's flank. Gabriel's ruling: the reading is a line clipping a triangle
tip rather than a misread tree, and routing edges around obstacles is a real
layout feature with its own failure modes — it would either move labels
(renegotiating every pin the placement already carries) or bend edges, a look
nobody asked for. Three things make the acceptance honest rather than silent, and
the second is the one that took the measuring:

- **The comment is at the roof-building loop**, because silence there is how the
  next reader concludes the engine considered it — and it says the upstream
  `forest` question is **UNVERIFIED** rather than borrowing authority it has not
  checked.
- **The obvious fixture is a FALSE ALL-CLEAR, so it ships as a passing control.**
  A roofed INTERNAL middle child — which is what the filing memo proposed — puts
  no roof on the sibling row at all: `flattenRoofs` gives it a synthesized
  roofed ONLY-child one row down, and an only child can never be a middle
  sibling. The crossing needs the `[{x},roof]` LEAF spelling AND a left sibling
  label wide enough (~46 characters under the suite's own width metric) to swing
  the parent's centre past the triangle. A worker following the memo would have
  measured a clean tree and concluded the engine already routes.
- **The sweep is an EXACT SET over the corpus, not a fixture.** Every shape is
  asked which of its edges cross a roof, and the set that does must be exactly
  the member that DECLARES it — so a future layout change that introduces a
  crossing in some other shape fails rather than shipping quietly. Beside it, the
  declared crosser's numbers are pinned outright, and a property leg says an edge
  can never enter its OWN child's roof (the triangle's interior lies strictly
  below the apex, where that edge terminates).

The intersection test is exact convex clipping, deliberately not point sampling:
a sampled probe reports a grazing clip as a miss, or a real one as a hairline,
from where its samples happened to land — and it did, during this task's own
diagnosis, before the analytic form replaced it. **A pin decided by sampling
density is not a pin.** CI:
[forest-layout.test.ts](src/lib/forest/__tests__/forest-layout.test.ts) ("edges
vs roofs"). Measured by neutering each half in turn: the memo's fixture as the
corpus member takes 3 legs, a roof-height drift 1, and a hypothetical routing
change 4.

## The prose index: "which characters are prose, and where"

> **One question, one owner.** `src/lib/prose-index.ts` yields the PROSE
> character runs of a document with their ProseMirror positions — every
> carrier run, every markless block and every atom excluded — and the
> exclusion vocabulary is DERIVED from the SSOTs and from the live schema,
> never hand-listed.

This is the "searching `emph` finds command names" class (task 517, subsuming
the retired 513), and the finding is that three parts of Virgil each held HALF
of one answer and none of them knew both:

- the **word counter** (`word-count-core.ts`) sorts characters into categories
  — main text / headings / footnotes / captions / math / comments — and throws
  every POSITION away;
- the **raw-LaTeX highlighter** (`scanRawLatexSpans` + the carrier marks) keeps
  positions exactly, because it has to paint over them — and tracks only
  LATEX, never prose;
- the **Search index** kept positions and knew nothing about LaTeX at all. Its
  `buildMainTextIndex` took every text node in every textblock with no carrier
  filtering, so `emph` matched command names and a query matched inside a `%`
  comment block.

A spellchecker needs both halves at once, which is why the foundation was built
before it (the approved program's phase 1 of 3; phase 2 is Virgil's own
checker, phase 3 the curated autocorrect list).

Seven rules it earned:

- **The vocabulary is three DERIVED rules, not a list of node names.** A TEXT
  node is prose unless it wears a raw-LaTeX mark; a BLOCK carries prose only
  if it is a textblock that ADMITS MARKS; anything that is not a text node
  contributes no prose characters. That covers every carrier, every verbatim
  container and every atom — including ones nobody has written yet.
- **`RAW_LATEX_MARK_NAMES` is a THIRD census, deliberately distinct from
  `CARRIER_MARK_NAMES`.** The carrier table answers the DEMOTION question
  ("does this run still spell what its carrier says it is?", task 407) and is
  the STRICTER set — the marks whose bytes are literal or inert — which is
  exactly what `isOpaqueRun` must keep reading, because a `latexCommand`
  scanner has to look INSIDE a command run. "Is this prose?" is the wider
  question, so it gets its own derived export (`CARRIER_MARK_NAMES` plus
  `LATEX_COMMAND_MARK`) rather than a fourth hand list. `latexCommand`'s name
  finally has a constant too, and `latex-command.ts` now spells NO mark-name
  literal of its own.
- **The markless test is asked of the LIVE SCHEMA** (`type.markSet`), which is
  the derivation `text-object-registry.ts` asks for in place beside its own
  `MARKLESS_BLOCK_ACTIONS` hand-assignment: a node declaring `marks: ""` can
  never wear a carrier, so Virgil has no way to say which of its characters
  are raw LaTeX — which is what verbatim MEANS. `latexComment` and `codeBlock`
  fall out; a third such kind is covered by shipping.
- **`figureBlock` is the one shape that needed a decision rather than a rule,
  and the rules get it right anyway.** It is not a schema atom, it holds a
  `figureCaption`, and that caption IS the user's words — so it is walked like
  any other textblock while its siblings (`texBlock`, `forestBlock`,
  `graphicsBlock`, `displayMath`) are excluded by the atom rule.
- **The run table was already the right shape, and that is why the fix is
  small.** `buildMainTextIndex` kept per-text-node runs precisely so an inline
  ATOM — zero characters, one PM slot — could not skew char → PM conversion. A
  SKIPPED CARRIER is the identical shape, so the whole `spanAtOffset` /
  `proseOffsetToPos` machinery carries the new gaps for free. Consecutive runs
  are char-contiguous and PM-DISJOINT, and that gap is the contract a consumer
  that must not span an excluded thing (a spell squiggle, task 518) reads.
- **It does NOT extract `\caption{…}` payloads the way the word counter does.**
  That extraction is a REGEX REWRITE of a string — it strips commands and
  braces — so it cannot say WHERE the surviving characters are, and this
  index's whole contract is positions. A payload the index cannot place is one
  it must not claim.
- **The word counter is a stated NON-GOAL, not an oversight.** Its bucketing
  laws (tasks 112 / 121 / 122) are settled, its buckets need the three marks
  named INDIVIDUALLY and IN ORDER (a comment tail goes to `comments` and must
  be tested BEFORE the pair whose `\caption{…}` payloads go to `captions`), so
  a single "is this raw LaTeX" predicate cannot express it. It remains the
  third half-answer and MAY migrate later — deliberately, not in passing. It
  is the census's one exemption, scoped to that reason.

**Cost class.** `buildProseIndex` is O(doc) and is a DERIVED PRODUCT: a
consumer re-derives EVENT-DRIVEN (the `DocStructureBus` counters, a
`doc-products` tier, or — like Search — once per user-initiated query), never
on the keystroke path. `collectProseRuns` is the per-BLOCK entry point for a
consumer holding a touched block from the typed structural diff.

CI: [prose-index.test.ts](src/lib/__tests__/prose-index.test.ts) drives the
REAL `buildEditorExtensions("main")` stack over the REAL parse — so the marks
under test are the ones the parser produces rather than ones a fixture asserts
into existence — and its legs with teeth are the SWEEPS (every `ATOM_REGISTRY`
kind, every `RAW_LATEX_MARK_NAMES` member, every markless textblock the schema
declares) plus the CENSUS. **No pre-517 suite could see any of this**: every
search fixture in the repo is plain prose plus inline atoms — the one non-prose
shape the old index already handled — so a carrier run reaching the index is
unrepresentable in all of them.
[search-prose-only.test.ts](src/panels/Search/__tests__/search-prose-only.test.ts)
is the 513 acceptance, each red leg carrying its PROSE control through the
identical harness (a suite that only proved "emph is not found" would pass on
an index that finds nothing at all). Measured by neutering the two predicates:
**13 legs fail**, and the 17 that pass are the controls — plain prose, a
MODELED command's payload (an `\emph{…}` is an italic MARK, not a carrier, so
its words survive and only the name is gone), the offset round-trip, and the
derivation pins.

**Residual, stated.** The joined text still concatenates ACROSS a skipped
thing, so `a\foobar{x}c` reads as `ac` to a whole-string matcher — exactly as
`doc.textBetween(0, size, "\n")` has always joined across an inline atom. That
is preserved deliberately: changing it would move Search's behaviour, and the
consumer that must not join (the squiggle) reads the RUNS, which is what they
are for.

### The switch half: native spellcheck becomes deliberate

Same task, the memo's Tier A. Chrome spellchecks any editable text unless told
not to, and Virgil said "don't" in ELEVEN places that had never been collected
into a rule — two CodeMirror source pods, the read-only branch of the main
editor, and eight discrete form inputs (citekey, label key, two hex-colour
fields, the math and figure LaTeX textareas, the bib picker, the raw-BibTeX
textarea). Every decision was right and none was STATED, so from outside the
pattern read as arbitrary, and there was no way to turn the thing off.

> **The switch is ONE inherited `spellcheck` attribute on `<body>`, written
> from one `VIEW_PREF_REGISTRY` row — not a prop threaded into every prose
> surface.**

Four rules it earned:

- **Twelve threads are twelve chances to forget the thirteenth.** There are
  twelve `editorProps.attributes` blocks that would each need a
  `checkSpelling` prop (the main editor, `RichTextField`, `BorrowedMainText`,
  nine float bodies, `ExampleCard`) and NONE of them sets `spellcheck` today.
  The body attribute covers every surface that exists and every surface that
  will, by construction — the same mechanism and the same reasoning as
  `EditorLayout`'s `.hide-card-titles` / `.card-outline-chrome` body classes,
  whose own comment gives the reason ("cards render in the panel strips, the
  omni host, AND body-portaled float popouts").
- **ON is the ABSENCE of the attribute, not `"true"`.** The default state IS
  on, so the pref's default position leaves the DOM byte-identical to what
  shipped before the switch existed.
- **The deliberate opt-outs need no knowledge of the pref.** They are
  DESCENDANT `false`s, which win over an inherited value — so they survive
  either position, and the read-only rule in `Editor.tsx` stays a rule of its
  own ABOVE the preference: a read-only document is never squiggled whatever
  the pref says. Both compose without either knowing about the other.
- **They spell it through the door** (`NEVER_SPELLCHECK_ATTRS` /
  `NEVER_SPELLCHECK_PROPS`, [spellcheck-policy.ts](src/lib/spellcheck-policy.ts))
  rather than a bare literal, which is what makes "the surfaces deliberately
  left out" a checkable list instead of eleven scattered literals. Two more
  CodeMirror surfaces (the code view, the style/preamble editor) set nothing
  and are always off regardless: CodeMirror 6 hardcodes `spellcheck: "false"`
  in its own default content attributes.

A stale claim went with it: `library/styles/library.css` said its
`caret-color: transparent` rule suppressed "red-squiggle spellcheck
underlines", which CSS cannot do — the suppression was always `Editor.tsx`'s
read-only branch. Corrected in place with the reason at the site.

CI: [spellcheck-policy.test.ts](src/lib/__tests__/spellcheck-policy.test.ts).
The leg with teeth is the CENSUS — the door was never the part that could
misbehave, a surface that opts out with a bare literal is, and it renders
perfectly while leaving the list unstated: no production file outside the door
may spell `spellCheck={false}` or `spellcheck: "false"` (allowlist EMPTY), the
door must have real consumers of BOTH shapes, and the policy must have exactly
ONE mount (two writers of one attribute is how they come to disagree, and the
effect's cleanup restores ON). Measured: a planted literal takes the census, a
dropped mount takes the mount leg.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a schema walk plus
a body attribute, no disk), so the check is cheap and real — search `emph` in
the dev doc and get prose hits only, then toggle View › Check spelling and
watch the squiggles go.

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

### The memory half: when a write cannot land, memory is the ONLY copy

Same path, and the half every gate above PRESUPPOSES (task 391). The disk-side
laws are complete and they were RIGHT on 2026-08-19: a sync daemon reverted the
paper's `.tex`, the DiskWatcher detected it, the 364 clobber guard PAUSED
autosave rather than overwrite the external edit, and the file on disk stayed
protected. Gabriel then wrote for ~70 minutes with every edit in memory alone
behind a quiet pill, the overnight deploy's service-worker "Update available"
banner appeared, he clicked it, and the page reloaded. Everything since 12:16
was gone.

> **A refusal or a pause makes the editor's memory the only copy of the user's
> work — and every door that DROPS memory (a service-worker reload, a badge
> reload, a tab close, a crash) stays fully armed.** So the state "this document
> holds work that has not reached disk" is published to ONE channel, a durable
> MIRROR is armed from it, and no door that drops memory opens before the work
> is either landed or mirrored.

Four pieces, in the order a byte travels:

- **The channel.** [src/lib/unsaved-work.ts](src/lib/unsaved-work.ts) —
  `dirtySince` / `lastLandedAt` / `reason` per doc. Not
  `saveTimerRef.current !== null`, which is unsound in BOTH directions for this
  question and is exactly what went quiet in the incident: the debounce callback
  nulls its handle BEFORE calling `save`, so a REFUSED write leaves the document
  dirty with the flag already cleared, and a re-armed pause keeps it non-null
  forever, saying "a write is coming" when the truth is "no write can land".
  Cleared by nothing but a write that ACTUALLY LANDED, read off the 357 refusal
  channel rather than from the absence of a throw.
- **The mirror.** [src/lib/emergency-mirror.ts](src/lib/emergency-mirror.ts) — a
  rolling per-doc snapshot of the live model in IndexedDB (the SAME `virgil`/`kv`
  store `doc-index` and `tex-assets` use), on a 5-second wall clock, armed
  whenever the doc is unlanded and either BLOCKED (arm at once — the incident's
  state) or merely AGING past `MIRROR_ARM_AFTER_MS` (a sustained typing burst
  keeps resetting the 1500 ms debounce, so memory is the only copy there too;
  the hazard there is a crash rather than a gate). It stores a MODEL, not
  `.tex` bytes, so a restore goes back through the same mount and preservation
  gates any load does rather than around them.
- **The doors.** [src/lib/reload-door.ts](src/lib/reload-door.ts) — flush every
  doc, RE-READ the channel (a refused write resolves normally, so the flush
  resolving proves nothing), force-mirror what still has not landed, and only
  then report. `prepareForReload` is what the update banner asks before it
  posts `SKIP_WAITING`; `reloadNow` is what the `controllerchange` handler —
  which is armed unconditionally and reachable without the banner at all —
  enters instead of calling `location.reload()` bare.
- **The recovery.** [src/lib/mirror-recovery.ts](src/lib/mirror-recovery.ts) +
  `MirrorRecoveryBadge`. A mirror is cleared by exactly one thing, so a mirror
  that SURVIVES to the next open is by construction work that never reached
  disk. Restore archives BOTH sides into one `virgil/.history/` slot first
  (reversible either way, which is what lets the badge offer a decision with no
  preview surface), writes as `userResolvedConflict`, and reloads — and reports
  whether it landed, so a refused restore leaves the offer standing.

Six rules it earned:

- **A door reads the CHANNEL, never the absence of a throw.** The incident's
  unload flushes all ran and all "succeeded" as refusals. This is the same rule
  the 357 cluster states for `save()`, applied to every consumer downstream of
  it — including `ConflictPorts.keepMine`, which was reporting `applied: true`
  for a write that never happened and clearing the badge over unsaved work.
- **`beforeunload` PROMPTS off the channel.** The mirror makes the loss small;
  the prompt makes it CHOSEN. And the handler no longer disarms the debounce: it
  runs on a leave the user can still CANCEL, and clearing the timer unconditionally
  left a "Stay" with no retry armed until the next keystroke. The duplicate write
  that risks is a no-op — `writeDocBundle`'s byte-equality gate skips it.
- **The arming predicate is pure and shared** (`shouldMirror`), and `force`
  bypasses AGING but never the DIRTY test: a door may not mirror clean work.
- **A failed mirror is a NET failing, never a gate.** A quota error, a
  private-mode block, a closed database — all warn and retry on the next tick.
  Nothing here may disturb editing, and the banner SAYS when no copy was taken
  rather than repeating a promise it could not keep.
- **KEYSTROKE SANCTITY.** `noteUnsavedEdit` runs on the typing path and emits
  only on the clean→dirty EDGE, so a 50-character burst notifies subscribers
  ONCE; the mirror adds no editor subscription at all (one 5-second interval per
  open doc, reference-first equality bail, so a quiet armed tick costs one
  compare); and the AGE surfaces render from a per-minute ticker in the
  component, never from a store write.
- **The pause gets a CLOCK.** A conflict badge that says the same words at
  minute 1 and minute 70 is how a warning becomes furniture, and that was the
  incident's second act. It names the age and, while a mirror is being kept,
  says so.

CI: [emergency-mirror.test.ts](src/lib/__tests__/emergency-mirror.test.ts) (the
channel's edges + the ticker's arm/bail/failure contract),
[reload-door.test.ts](src/lib/__tests__/reload-door.test.ts),
[mirror-recovery.test.ts](src/lib/__tests__/mirror-recovery.test.ts), and
[useDocument.unsaved-mirror.test.ts](src/hooks/__tests__/useDocument.unsaved-mirror.test.ts)
— the WIRING, which is the half no test of the mirror or the door can see,
driving the REAL hook for each blocking reason, the unload prompt, the restore
ORDER, and the conflict net carrying the LIVE unsaved side. **The legs with
teeth are the censuses**: the door was never the part that could misbehave, a
call site that never asks it is, and that is literally what shipped — so no
production file may call `location.reload()` outside the door (`reloadNow`'s
`reload` argument is REQUIRED rather than defaulted precisely so the module
itself is not a speller and the census has exactly one legitimate entry), and
`applyUpdate` has exactly two mentions in `src/`: its declaration and the gated
banner. Measured by neutering each half in turn: the pre-391 `beforeunload`
predicate takes 1 leg, a `save()` that publishes nothing 4, a door that reports
before it flushes 5, a bare reload + ungated banner 2, a restore that writes
before it nets 1, and a restore that ignores its report 1.

**Owed, not claimed:** the live drill. Block saves (a forced conflict), type for
two minutes, hard-reload → the offer restores within seconds of the last tick;
and a real-Dropbox eyeball of the aged pause badge. This class masks in the dev
preview, so the durable proof here is the unit contracts.

### The honesty half: a gate that stops writing SAYS SO, in one voice

Same path, and the half the incident of 2026-08-19 turned on (task 392).
Gabriel's ask afterwards was *"verify that auto-save is working properly, and
consider adding a save button"* — and the honest answer to the first half is
that it **was** working properly. It was deliberately paused by the 364 clobber
guard, correctly, for seventy minutes, and the user could not tell. Task 391
gave that state a durable second copy; this half gives it a VOICE.

The reason it needed a law rather than a pill is that each silencing path
decided for itself whether to speak, and they had settled on different answers:
the conflict pause spoke through the external-change badge (which sat inside
BOTH the collapse and zen gates, so a layout preference could hide it), a
preservation refusal through its own badge, an FSA throw through
`console.error`, a stale-pipeline drop through `console.warn` — and the
destroyed-editor drops in `debouncedSave` / `flushNow` / `flushAnchorCommit`
through nothing at all. `useDocument` did export a `saveStatus`, and **nothing
in the app read it**: declared, written at six sites, consumed by no pixel — the
task-202 dead-export shape, in the hook whose subject is telling the user what
is happening.

> **Every path that declines to write REPORTS on the ONE channel, and the
> topbar renders the ONE tier ladder derived from it. A gate with no voice is
> the incident; a second vocabulary is how the voices come to disagree.**

[src/lib/save-state.ts](src/lib/save-state.ts) is the vocabulary over task 391's
channel — the four tiers (`clean` / `pending` / `unsaved` / `blocked`), their
thresholds, `isSaveTierProtected`, and `describeBlockReason`, which is the one
table that says what a reason MEANS and **which flow can resolve it**.
[src/lib/save-request.ts](src/lib/save-request.ts) is the manual door.
Seven rules they earned:

- **The report is the CHANNEL, and that is the whole reason the surgical
  version of this feature is wrong.** A Save button wired to `flushPending`
  would have reported success throughout the incident, because a refused write
  resolves normally. `SaveDoor` returns a `SaveAttemptOutcome` read off
  `unsaved-work` AFTER the attempt — the rule `keepMineOverDisk` and the reload
  door already follow, now stated for the user-facing door too.
- **A Save that cannot land ROUTES; it never re-refuses.** A blocked write is
  held by a flow that belongs to another surface (the 364 conflict doors, the
  357 acknowledge dialog), and answering it is a decision only the user can
  make. So the button asks that surface to open itself
  (`requestBlockingFlow`), keyed by `describeBlockReason(...).flow` so the
  button and the opener cannot disagree about which dialog a reason leads to.
  A Save that silently re-refuses is this incident's silence with a button on
  it. The one reason that names no flow is `error` — it has a next attempt
  rather than a dialog, so its button says "Try again".
- **…and it respects the guard it is asking about.** The manual door consults
  `shouldPauseAutosave` and reports `conflict` rather than writing. A Save
  button that walked past the clobber guard would do the one thing every
  automatic path in `useDocument` refuses to do — overwrite the external edit —
  and it would do it on a gesture the user thinks is safe.
- **ONE dirty predicate.** `saveTimerRef.current !== null` was the de-facto
  answer on three flush paths, and task 391 had already recorded why it is
  unsound in both directions: the debounce callback nulls the handle BEFORE
  calling `save`, so a REFUSED write leaves the document dirty with the flag
  already cleared. 391 migrated `beforeunload`; the other three stayed, which
  meant `flushAllPendingDocs` — the reload door's first move — was a **no-op on
  exactly the documents it exists for**. `hasWorkToWrite` is the one predicate
  now, and the census forbids the comparison anywhere else.
- **A tier decides its own hideability, once.** The two reassurance tiers may be
  collapsed away; the two data-integrity tiers may not — the task-357 rule,
  lifted out of one badge's placement into `isSaveTierProtected` so the whole
  ladder inherits it. That is also what forced the external-change badge out of
  both gates, where it had sat since it shipped: the pill for the pause is
  precisely what the save badge's "Resolve…" button routes to, so a collapsed
  toolbar made the way out unreachable. Its now-unused `externalChangeActive`
  lift (state + prop + a whole reporter component) was DELETED rather than left
  written-and-unread.
- **No button in the `pending` tier, and the keyboard door is always open.**
  An affordance whose only effect is to do what is already happening is dead
  chrome, and one that blinks in and out on every typing pause is the fastest
  way to teach someone to stop seeing it. Cmd/Ctrl+S (previously unbound — the
  browser's "Save Page As…", which for a PWA whose document is on the user's
  own disk is exactly the wrong thing) enters the SAME door in every tier,
  because a shortcut costs no pixels and so has no reason to hide.
- **Retiring `saveStatus` is part of the fix, not a tidy-up.** Keeping a second,
  unread status vocabulary beside the channel is how the next surface comes to
  render the wrong one — and the state had a live defect nobody could see: the
  stale-pipeline arm returned without resetting it, so a dropped write left the
  status stuck at `"saving"` forever. WIRE-it or DELETE-it.

**The census is the deliverable, and it is what makes "verify autosave works" a
permanent answer instead of an afternoon's.**
[save-state-census.test.ts](src/lib/__tests__/save-state-census.test.ts)
DISCOVERS the write doors from `useDocument.ts` itself (the declarations that
reach `save(` / `writeDocBundle(` — never a hand list, which could only be
missing the door that drifted) and fails any early return inside one that
neither publishes a reason nor carries an in-place `save-silent-ok: <why>`
marker; the allowlist is EMPTY. Beside it: every `catch` in a door reports, the
retired dead state stays retired, every caller of `requestSaveNow` also spells
`requestBlockingFlow`, only `useDocument` publishes a door, and the two loud
badges render BEFORE the collapse gate. The behavioural halves are
[save-state-view.test.ts](src/lib/__tests__/save-state-view.test.ts) (the
ladder), [useDocument.manual-save.test.ts](src/hooks/__tests__/useDocument.manual-save.test.ts)
(the door against the REAL hook — including the leg that asserts a conflicted
manual save writes NOTHING) and
[save-state-badge.test.tsx](src/components/__tests__/save-state-badge.test.tsx)
(the four tiers, the collapse rule, both click behaviours, and the ticker,
which arms no timer at all while the document is clean and schedules the next
tier BOUNDARY rather than polling). Measured by neutering each half in turn:
restoring one silent gate takes 1 census leg, restoring the debounce-handle
predicate 2, moving the badge inside the collapse gate 1, dropping the manual
door's clobber guard 1, reporting from the absence of a throw 1, collapsing
every tier 1, and re-attempting instead of routing 2.

**Owed, not claimed:** the preview eyeball, and a real-conflict pass. The
conflict tier is FSA-masked (the dev preview's `virgil-data/` has no external
writer), so the durable proof there is the unit contract; the amber tier and the
button are not masked and are worth watching once — type, wait past the warn
threshold, click **Save now**, see the pill go green with a timestamp.

**Residuals, stated.** The `pending` tier says "Saving…" from the fact that a
write is ARMED, not from one being in flight — `writeDocBundle` has no
in-progress channel and inventing one for a label would be a second status
vocabulary, which is what this task deletes. The escalated tier grows inside the
32 px bar rather than becoming a real banner: a taller surface is a layout
decision this task did not take, and the sentence beside the pill is what the
incident actually needed. And the census reads `useDocument.ts` only — a save
path added in another module would be invisible to it, which is honest rather
than complete: every write door lives in that hook today, and the door census's
`registerSaveDoor` leg is what would notice a second one trying to publish.

### The redundancy half: a write of bytes already on disk has zero information and all of the risk

Same path, one question earlier (task 415). Every gate above answers *may this
write land?* This one asks the cheaper question underneath it: **should this
write happen at all?** Gabriel, from a real Dropbox folder: *"the conflicted
copies keep coming at a constant and fast rate."*

Measured over `~/Dropbox/Apps/Overleaf` on 2026-08-21, the report is not
evidence that task 363 failed — the two post-363 days are 10 and 6 forks against
the pre-fix day's 92, roughly the 10x cut 363 predicted. What it is, is the
residue, and its distribution is the finding: of the sixteen post-fix forks
**`virgil.json` is the LOUDEST base at 8** — a file holding paragraph titles,
collapsed state and a per-block 80-character content fingerprint, whose bytes
barely move while you write.

Two sites, one disease. `writeDocBundle`'s byte-equality skip was
**ALL-OR-NOTHING** — it returned only when BOTH outputs matched what this
session last put on disk, so the moment the `.tex` moved by one character the
byte-identical `virgil.json` was rewritten beside it, once per autosave, for the
whole session. And `persistSidecarInLock` had **no equality gate at all**, while
the guard above it (`usePersistentState.update`) bails only on REFERENTIAL
equality — so any hook that rebuilds a structurally-equal array re-writes the
identical bytes. Chrome's FSA has no in-place write mode: `createWritable()`
mints a `<name>.crswap` sibling and renames it over the target, so each of those
is two filesystem events a sync daemon watches.

> **No FSA write of a file whose bytes are already on disk.** The test lives at
> the write FUNNEL — [`writeTrackedText`](src/lib/storage-fsa.ts) /
> `putTrackedText` — so every writer inherits it: the two bundle files, the
> `.tex`, `references.bib`, the figure index, and every `writeSidecar` /
> `mutateSidecar` caller. 363 shrank the race window by CADENCE, which is a
> heuristic; byte-equality is a proof.

Seven rules it earned:

- **The skip STATS, because the ledger is a belief about disk and not disk.**
  The pre-415 gate compared its serialized `.tex` against the ledger fingerprint
  and returned — and the `.tex`/`.bib` fingerprint is never re-baselined on a
  genuine external change: the `DiskWatcher` deliberately KEEPS the stale one
  and flags (that is how the badge stays lit across polls). The sidecar
  fingerprints ARE re-baselined by the `SidecarWatcher` — but only on its ~3 s
  poll, so a window remains. (415 recorded that watcher as "not mounted
  anywhere in production"; that was FALSE, see "The grep half" below.) So a
  hash-only gate can decline to write over an external edit, silently, which is
  the one failure this whole subsystem exists to prevent. A skip is taken only when the file is PROVABLY
  the one we stamped: the content hash matches AND the live `{mtimeMs, size}`
  still match the fingerprint — the DiskWatcher's own cheap-path predicate, read
  off the SAME handle the write would have used, so the gate and the watcher can
  never disagree about whether a file moved. **The task's own premise ("the
  DiskWatcher already invalidates the ledger fingerprint on a genuine
  divergence") is FALSE and is corrected here rather than left standing** — it
  is exactly why the stat is needed.
- **Everything unprovable FAILS OPEN and writes.** No fingerprint (a page reload
  starts with an empty ledger), a stat that throws, any drift. A needless write
  is the pre-415 behaviour; a wrongly-skipped write leaves the user's state
  unpersisted, which is the direction that costs.
- **The stat makes a skip CHEAPER, not dearer.** One metadata read replaces an
  entire `createWritable` + rename + the post-write stat `stampLedger` would
  have done anyway.
- **The funnel owns the STAMP as well as the write**, because "what is on disk"
  and "who may skip writing it" are one fact. A writer that could stamp without
  writing — or write without stamping — is how the gate would come to believe
  something the disk does not say.
- **READS stamp too, which is what makes the gate effective from a session's
  FIRST save.** The ledger's contract has always been *"what Virgil last put on
  **or read from** disk"* (both watchers' PRIME passes stamp exactly this way)
  and only the `.tex` load path was doing it, so every sidecar's first write of
  a session landed however unchanged its bytes. `readTrackedText` takes the
  fingerprint off the `getFile()` the read already does — free, and guaranteed
  to describe the same revision. Inside `mutateSidecar` it is stronger still:
  the read runs in the same critical section as the write, so a mutation
  producing structurally-equal JSON is proven a no-op microseconds later. **That
  closes `usePersistentState`'s referential-equality hole from underneath rather
  than auditing ~20 hooks for structural equality.**
- **A stamp may never change what a READ returns.** The dev twin's first cut
  wrapped the header reads and the fetch in ONE `try`, so a response with no
  `content-length` returned `null` — which for `mutateSidecar` is an EMPTY base,
  i.e. a merge that silently drops everything on disk. Found by the existing
  `mutate-sidecar-primitive` suite, and worth stating as a rule: best-effort
  bookkeeping gets its own `try`, always.
- **The forensic snapshot rides `beforeWrite`.** A `.history/` slot is itself
  sync traffic, and there is nothing forensic about archiving bytes no write is
  about to replace. `onceBeforeWrite` latches it so a bundle takes at most ONE
  snapshot however many of its files move — and which file moves first is now a
  per-file verdict rather than something the caller knows in advance.
- **`userResolvedConflict` FORCES past the gate** (task 364's keep-mine door),
  and `force` is not an optimisation escape hatch: the gate's whole
  justification is that the bytes are already there, so a caller that disagrees
  says why at its own site.

The `lastSidecarHashByDoc` module cache is **retired**, not merely aligned: the
ledger holds the same fact keyed on the relPath the watchers stat, confirmed
against a live stat, where a module Map keyed on the doc was invalidated by
nothing. **This is not a decoupling** — 411's decision 3 stands: the bundle's two
files are still computed together and committed inside ONE serialized critical
section making ONE coherent decision. Declining to rewrite a file with the bytes
it already has is not letting it drift out of the bundle.

**Both backends move together** (the twin rule): the fork risk is a daemon
watching the paper folder, which the dev backend's local `virgil-data/` has
none of, but a write count that differs between backends is a difference someone
eventually debugs in the wrong one.

CI: [per-file-write-gate.test.ts](src/lib/__tests__/per-file-write-gate.test.ts).
**No pre-415 suite could see any of this**: the defect is a RATE and every one of
them (`write-tex-forensic-snapshot`, `mutate-sidecar-primitive`,
`sidecar-bundle`, `conflict-net`, `storage-fsa-load-writeback`) drives ONE write
and asserts its PAYLOAD, which the pre-fix code satisfies perfectly. The shape
here is `editor-state-write-cadence`'s: drive a simulated session and COUNT. Its
fake disk models real `mtime`/`size` — every other FSA fake in the repo reports a
constant `lastModified: 1`, so the confirm-stat would answer for reasons
unrelated to what the legs assert. The leg with teeth is the CENSUS, sharing ONE
`writeSites()` extraction with `tex-write-accountability` (which asks a DIFFERENT
question of the same population, so the two cannot come to disagree about who the
writers are): every RAW primitive call is inside the funnel or carries a
`write-gate-exempt: <reason>`, and `diskAlreadyHas` has exactly one caller per
backend — a second is a partial gate. Measured by neutering each half in turn:
the pre-415 ungated sidecar write takes 4 legs, the all-or-nothing bundle gate 2,
the stat-confirm 1 (the external-write masking leg), read-stamping 1, `force` 1,
and a dropped exemption marker 1 (the census).

**That census was nearly DRAINED by this fix, which is the other half worth
recording.** `tex-write-accountability`'s needle was exactly `writeTextToHandle(`
/ `putText(`, and every real writer moved behind the new door: measured on this
tree with the old needle it fell from eleven sites to TWO — the funnel's own —
and its `.tex`-writer leg to ZERO, while four of its five legs kept passing. So
the needle is renegotiated in place to the FAMILY (raw primitives AND gated
doors), which keeps the population identical to the pre-415 one. **A wrapper
relocates an obligation to its callers; it never absorbs one** — task 331's rule,
arriving at a census instead of a splice site.

**A correction the task itself needs, recorded rather than left to be
rediscovered:** `virgil.json` does NOT hold only titles and collapsed state — it
also holds a per-block first-80-character content FINGERPRINT
(`extractSidecarData`). So an edit inside a block's opening 80 characters really
does move its bytes, and the gate correctly writes there. What is true, and what
the cost leg models, is that essentially all typing in a real paragraph lands
past that window, so the sidecar's bytes hold still through a writing session.

**Residual, and the honest ceiling.** With the doc open on two machines at once
some conflicts are inherent: no write-rate reduction reaches zero, it only
shrinks the window proportionally. And the dev backend's stat is an HTTP HEAD, so
`Last-Modified` has one-second resolution — an external write inside the same
second at the same byte length would not move the confirm there, where FSA's
`File.lastModified` is millisecond-resolution. Nothing watches that folder, so
the exposure is a fixture one.

**Owed, not claimed:** a real-Dropbox eyeball. This class is both FSA-masked and
SYNC-masked — the dev preview's `virgil-data/` is local and nothing watches it —
so the durable proof here is the write-COUNT contract. The check is cheap and
exact: after a few days of ordinary writing, count new `virgil.json` forks, and
the expectation is ZERO rather than fewer, because its bytes genuinely do not
move during a session.
`find ~/Dropbox/Apps/Overleaf -name "*conflicted copy*" | grep -oE 'conflicted copy [0-9-]{10}' | sort | uniq -c | tail`

### The grep half: a census can only see the files its grep can READ

Same path, and the case where the watcher was right, the provider was right,
the prose was wrong, and a DECISION was routed to Gabriel about a mechanism
that had been live for seven weeks (task 432). The 415 worker grepped both
silos for `createSidecarWatcher`, found only its own file and a `vi.mock`, and
filed *"built, tested, and MOUNTED NOWHERE"*. This file then repeated it as a
fact in the section above. Gabriel ruled "MOUNT it."

It was mounted — in `DiskWatcherProvider`, since 2026-06-30. The provider's
file held a raw **NUL BYTE** inside a string literal (`live.join("<NUL>")`, a
composite-key separator typed as the byte rather than the `"\0"` escape), and
one byte below 0x20 makes `grep` classify the whole file as BINARY: every match
becomes `Binary file … matches`, and the zsh `grep` wrapper every worker,
auditor and catcher reaches for suppresses those lines entirely. `git diff`
showed the same files as `Bin`. The repo's OWN censuses — `_source-scan.ts` and
forty guardrail suites — read through Node and were never fooled, which is
exactly why nothing noticed: the instruments that could see the file agreed
with each other, and the one that could not is the one humans use. Four
production files carried the idiom (`disk-watcher.tsx`, `predicates.ts`,
`parse-tex-log.ts`, `cross-window-storage.ts`).

> **A text source file is TEXT to every reader, or a shell census is lying
> about it.** No control byte other than TAB / LF / CR; a NUL separator is
> spelled `"\0"`. And a filing that names an ABSENCE ("mounted nowhere",
> "zero callers") is checked with a second instrument before it becomes a
> decision — a grep's silence is not evidence.

Three rules it earned:

- **The runtime string is identical either way**, so the fix is a four-file
  byte swap with no behavioural change — and a census, because the next
  `join("\0")` typed as a byte is one keystroke away.
- **Every prior suite drove ONE piece.** `sidecar-watcher.test.ts` the poller,
  `usePersistentState.test.tsx` the consumer on a HAND-DISPATCHED event,
  `disk-watcher-multidoc.test.tsx` the provider with the watcher MOCKED OUT —
  so "an external sidecar edit re-hydrates the panel" was pinned by nothing,
  and a filing claiming it could not happen had no leg to contradict it.
- **The decision that was routed is RECORDED as moot, not silently closed.**
  Gabriel's "MOUNT it" ruling described the tree as it already stood; 220's
  "The sidecar half" was true the whole time.

CI: [source-text-hygiene.test.ts](src/__tests__/source-text-hygiene.test.ts)
sweeps every tracked text file (population from `git ls-files`, allowlist
EMPTY) for a control byte, naming the file and line; measured, it fails on any
one of the four pre-432 files. [sidecar-watcher-wiring.test.tsx](src/components/editor-layout/contexts/__tests__/sidecar-watcher-wiring.test.tsx)
drives the REAL provider → REAL `createSidecarWatcher` → REAL
`usePersistentState` over a fake disk with real mtimes: an out-of-band write
re-hydrates on the next poll with no hand-dispatched event, and a removal
empties the panel. Measured by neutering the provider's `start()`: 2 legs fail.

### The other-writer half: the AI is a PEN-HOLDER, and the app honours the pen

Same path, the writer the lock cannot reach (task 489). Gabriel: *"When Virgil
is editing from cowork, can it flip a switch that makes the doc read only (with
some loud indicator to show what is hapenning?). i feel like this might help
with conlifcted copies too — i think they may be creeping in when cowork
edits."*

The mechanism existed and the app could see half of it. `/editor/*` skills have
committed **under the pen** since the apply_response chip shipped —
`_common.commit_under_pen` is acquire → atomic write → release — and that
acquire writes the pen in TWO places: `.virgil/pen-context.json` **always**
(holder `"claude"`, carrying an `expires_at` ≈ +30 s so a crashed skill cannot
wedge the lock), and `virgil/collab.json`'s `pen` **only if that file already
exists** (holder `"Claude"`, `enabled` flipped true for the duration). The app
read only the second, and only while `sidecar.enabled` — i.e. only on a paper
the user had already turned collaborator mode on for. On the ordinary SOLO
paper the skill's pen meant nothing to the UI at all: the user kept typing while
the skill spliced the `.tex`, and the 1500 ms autosave then raced the skill's
write. Two writers, one folder, a sync daemon watching — which is the
conflicted-copy seed the 363/415 cluster narrowed from the Virgil side and could
not close from the cowork side.

> **"Who holds this document's pen right now?" is ONE question with ONE answer,
> resolved by [cowork-pen.ts](src/lib/cowork-pen.ts) from every record that can
> carry it.** The two on-disk records are two RUNGS of one ladder, not two
> facts: the pen-context record (always written, self-expiring) first, the
> collab sidecar's pen second. Every consumer — the read-only gate
> (`canEditMainText`), the autosave pause, the topbar banner, the save-state
> reason — reads the answer there.

Seven rules it earned:

- **No new file, and no skill-side change at all.** The obvious alternative was
  to make `acquire_pen` CREATE `collab.json` on a solo paper, so the one record
  the app already polled would always carry the answer. Declined for the reason
  this whole report is about: that is a file created and then rewritten in the
  user's synced folder on EVERY commit — new write traffic in exactly the folder
  whose write traffic tasks 363 and 415 spent two passes reducing. Reading a
  record the skill already writes unconditionally costs nothing, and it is the
  record that carries the TTL.
- **Fail toward RELEASING.** Every unreadable, unparseable, foreign-holder or
  over-aged record resolves to "no pen held", and a far-future `expires_at`
  (clock skew, a hand-edited file, a future skill with a longer TTL) is CLAMPED
  to the app's own `COWORK_PEN_MAX_AGE_MS`. The asymmetry is the opposite of the
  preservation gate's and is deliberate: a document wedged read-only behind a
  banner nobody can dismiss is worse than a brief window in which the user could
  have typed over a commit, because that commit is atomic and sub-second and the
  disk-side gates (the doc lock, the byte-equality gate, the clobber guard)
  still stand behind it.
- **The AI's staleness window is SHORT, and that is derived rather than
  borrowed.** `COLLAB_TIMINGS.penStaleMs` is 5 minutes because a HUMAN holder
  heartbeats and can be asked to hand over; the AI never heartbeats — its whole
  hold is one atomic commit — so its `lastHeartbeat` is frozen at the acquire
  and a 5-minute window would leave a crashed skill holding the paper for five
  minutes. 60 s: double the skill's own 30 s TTL, so honest clock skew cannot
  release a live pen.
- **ONE pause door, and it returns the REASON.** Pre-489 every call site asked
  `shouldPauseAutosave(watcher)` and hard-coded `noteSaveBlocked(docId,
  "conflict")` on the next line — four copies of one mapping, and the shape in
  which a second pause SOURCE gets a wrong voice on the save-state channel.
  `autosavePauseReason(watcher, docId)` answers `"cowork" | "conflict" | null`
  and the caller quotes it. **`cowork` outranks `conflict` while the pen is
  held**, and the ordering is the honest one rather than a preference: the two
  routinely coincide (a skill's own write IS the kind of external change the
  watcher detects), and while the pen is held the transient, self-clearing
  statement is the truer thing to say — the standing conflict is still there to
  say once it releases.
- **The cowork rung is keyed on `docId`, so it reaches a WARM pane.** The
  watcher is null for every doc but the ACTIVE one (multi-doc keep-alive), so a
  skill committing against a background paper had no way to pause that paper's
  autosave through the conflict rung at all.
- **The banner is a WARNING, not an alarm, and it BREATHES.** Nothing here is
  destructive or even wrong (STYLE_GUIDE → "the destructive / alarm family": a
  merely unexpected state takes the warm family), so it is amber; what makes it
  loud is that it is present, that it names the cause, and that it is the only
  badge in the bar reporting something happening RIGHT NOW rather than something
  that has happened. It sits BEFORE the `topbarRightCollapsed` gate with the
  four data-integrity badges — a notice explaining why the editor stopped
  accepting your typing must not be hideable by a layout preference — and offers
  no dismiss, because a dismiss would hide the explanation while the read-only
  posture stood.
- **Poll latency is STATED rather than engineered around.** The signal rides
  `useCollab`'s existing 5 s clock, so a fast commit can begin and end between
  two polls and the UI never notices. Accepted: the window this closes is not
  the sub-second commit, it is the SESSION — a skill drafts, splices, drafts
  again, and a user typing through it never learns that anything else is holding
  the file.

CI: [cowork-pen.test.ts](src/lib/__tests__/cowork-pen.test.ts) (both rungs, the
ladder, the store's idempotence, the save-state reason, the CENSUS, and the
PARITY leg against `editor/scripts/_common.py` — Python cannot import the TS
vocabulary, so a rename on either side is otherwise silent: the skill keeps
taking a pen the app stops recognising and the document stops going read-only
with nothing failing anywhere), [cowork-pen-wiring.test.tsx](src/hooks/__tests__/cowork-pen-wiring.test.tsx)
(the REAL `useCollab` + REAL `useDocument` over a fake disk — the half no test of
the authority can see) and [cowork-pen-badge.test.tsx](src/components/__tests__/cowork-pen-badge.test.tsx)
(WHICH WORDS reach the user, a render fact). **No pre-489 suite could see any of
this**: there is no `useCollab` suite in the repo at all,
`autosave-pause.test.ts` drove the watcher alone (a boolean with no document in
it, so a per-document pause source is unrepresentable in it), and the save-state
suites sweep `UnsavedBlockReason` — a union `"cowork"` was not a member of. The
leg with teeth is the CENSUS: the ladder was never the part that could
misbehave, a consumer that re-derives "is the AI editing?" from a hand-spelled
holder string is (`pen.holder === "Claude"` type-checks perfectly), and so is a
write door that hard-codes its own pause reason. Allowlists EMPTY. Measured by
neutering each half in turn: the pre-489 collab-only gate takes 3 legs (2
wiring + the census), the hard-coded `"conflict"` mapping 3 (2 wiring + the
census), and a badge moved inside the collapse gate 1.

**Owed, not claimed:** the real end-to-end eyeball — run an `/editor/*` skill
against a real paper with the doc open and watch the banner appear, typing get
refused, the save badge name the reason, and everything release. That is the
FSA-masked class twice over (real File System Access AND a real out-of-process
skill), so the durable proof here is the unit contracts.

**Residual, stated.** The pen is held for the COMMIT, not for the skill's
thinking phase, so a long drafting session shows nothing until the write lands.
Widening that means the skill holding the pen across its whole run — a
skill-side design change with its own crash-recovery question (a 30 s TTL is
right for a sub-second hold and wrong for a five-minute one), routed rather than
made here.

#### The release half: a teardown that needs a capability the transport may not grant

Same pen, the other edge (task 496) — and the case where the app-side posture
was written down (*"fail toward RELEASING"*, `cowork-pen.ts`) and the skill-side
teardown did the opposite: it required a DELETE.

`release_pen` ended every skill commit by removing `.virgil/pen-context.json`,
and it did so through `atomic_write`'s write-set, whose `content is None` arm
was a bare `os.remove`. A cloud (Dropbox) mount refuses `unlink` on a file it
will happily let you REWRITE — the reported machine — and the raise then
cascaded three ways, only the last of which the report could see:

- **The collab restore was ROLLED BACK.** The release's own restore of
  `collab.json` had already committed when the delete threw, so `atomic_write`'s
  rollback rewrote it to the ACQUIRE-time state: `enabled: true`, pen held by
  Claude. Past the app's 60 s pen-context ceiling `canEditMainText` is still
  false, because rung 2 reads `sidecar.enabled` — **the paper is wedged
  read-only**, recoverable only through the 5-minute take-the-pen affordance.
  And the next `acquire_pen` snapshots the poisoned state as its own
  `prior_pen` / `prior_collab_enabled`, so even a later SUCCESSFUL release
  restores a locked collab: sticky across runs.
- **A durable write reported failure.** The exception escaped
  `commit_under_pen`'s unguarded `finally` and was caught only at the CLI top
  (`die` → exit 2), so the result JSON was never printed although the whole
  write-set — `.tex`, sidecars, version bump — was already on disk. The calling
  skill reads that as a failed writeback: **a double-apply retry hazard on a
  write that already landed.**
- **The stale pen file was the CHEAP third.** It self-expires in ≤60 s app-side
  and `acquire_pen` never reads it. That harmless third is what the report saw.

> **A DELETE is the one filesystem capability a transport may not grant, and
> every delete in these two silos is CLEANUP — a `.tmp` sibling, a retired lock,
> a superseded `.done`, a spent temp file. So a refusal is a TIDINESS failure,
> never a correctness one, and no delete may raise out of the operation it
> cleans up for. And a release RELEASES BY REWRITE: a `holder: null` record,
> not an absent file.**

Two halves — `unlink_tolerant` / `rmtree_tolerant`
([_common.py](editor/scripts/_common.py), mirrored in
[_tools.py](library/scripts/_tools.py)), and the released record. Seven rules
they earned:

- **Release by REWRITE is strictly better than delete-then-TTL, not merely
  safer.** `coworkPenFromContext` bails on a non-cowork holder BEFORE any clock
  arithmetic, so a `holder: null` record reads as released **instantly** — where
  a delete leaves the 60 s window in which a released pen still reads as live.
  The safety property comes free with a UX improvement.
- **…and it costs the sync daemon nothing**, which is what made it available at
  all. A delete is already one filesystem event; an ~80-byte rewrite of a
  `.virgil/` file is one too (the write-traffic doctrine, tasks 363/415). This is
  precisely the trade task 489 DECLINED for `collab.json` — fabricating that file
  on a solo paper would have been NEW traffic in the folder whose traffic those
  two passes spent themselves reducing.
- **The two halves are independently sufficient for the reported symptom, and
  both ship anyway.** The rewrite removes the delete, so nothing can throw after
  the collab restore commits; the tolerant unlink swallows a refusal one layer
  down. Keeping only one leaves the other's class live — (1) alone leaves the
  exit-code hazard for every OTHER release-time IO error, and the `finally` wrap
  alone leaves the rollback latch, since the raise fires INSIDE `atomic_write`
  and undoes the restore before any caller can see it.
- **…which is exactly why the wrap needs its OWN leg.** With both halves in
  place the wrap has nothing observable to do, so it is deletable in silence —
  the shape "The tag half" records one subsystem over. The leg makes
  `release_pen` itself raise (`ENOSPC` on the collab restore) and requires the
  commit to return normally with its result printed.
- **The warning goes to STDERR.** Stdout carries the writeback-contract JSON,
  and a warning there would corrupt the very contract this protects.
- **A released record carries NOTHING from the acquire.** Its `prior_*` snapshot
  has just been spent; keeping it would let a later release re-restore a collab
  state the user has since changed. Releasing an already-released record is a
  no-op — no second filesystem event.
- **`_mark_done`'s unlink is tidiness, and saying so is what makes tolerating it
  correct.** The `.done` sibling WRITE is what retires a queue entry
  (`_list_pending` skips a queue file whose same-kind `.done` exists), so a
  refused unlink leaves an inert file behind rather than the infinite re-drain a
  glance at the site suggests. Stated at the site, because the tolerant answer
  is only right given that fact.

**The helper is MIRRORED, not shared, and that is a constraint rather than a
preference:** the two script trees ship as independent skill bundles synced into
a paper folder and a library folder, so neither may import the other. What holds
them together is a byte-identity PARITY leg over a marker-delimited block — the
instrument the preservation measure and the marker census already use for code
they cannot reach.

**Two exemptions, each scoped to the shape it justifies** (task 204's rule) and
each carrying an in-place `unlink-exempt:` marker: `sync_skills.py` is the bundle
BOOTSTRAP and is deliberately import-free — it must not depend on `_common.py`,
which is one of the files it is replacing; and `triage_apply.py`'s source-`.bib`
disposition has a STRONGER policy than the helper's warning, reporting a refusal
to the library's own inbox, which routing it through the helper would downgrade.
The census verifies an exempt site is genuinely hand-tolerant (a `try` whose
`except` does not re-raise), so the marker cannot become a standing licence.

CI: [test_unlink_tolerant.py](editor/scripts/tests/test_unlink_tolerant.py) and
its [library twin](library/scripts/tests/test_unlink_tolerant.py), each wrapped
by a vitest leg so `npm test` has teeth on them (nothing in CI runs the library's
python at all). **No pre-496 suite could see any of this**: every pen fixture in
the repo asserts released-ness as *the file is GONE*, in nine places across six
suites, so a delete that FAILS is unrepresentable in all of them — and four of
those legs were pinning the defect as the contract. They are renegotiated in
place with the reason at the site, onto ONE predicate
([_pen_state.py](editor/scripts/tests/_pen_state.py): absent OR `holder: null`),
which a census then keeps from being re-forked. The leg with teeth is the CENSUS:
the helper was never the part that could misbehave, a delete site that never asks
it is, and it runs perfectly until the day the mount says no — so every raw
delete verb in either silo is inside the helper or carries a marker, allowlist
otherwise EMPTY. Measured by neutering each half in turn: the pre-496 delete
release takes 7 editor legs plus `test_pen_atomic` plus a `cowork-pen` parity
leg, the unguarded `finally` 2 plus a parity leg, the raw `os.remove` in
`atomic_write`'s content-None arm 4, a drifted mirror block 1, a new raw delete
site 1 per silo, and `_mark_done`'s raw unlink 2.

**Owed, not claimed:** a real cowork-session run on the reporting machine — one
skill commit there should exit 0 with a result JSON and no pen warning left
behind. The trigger environment (a cloud workspace's Dropbox mount) cannot be
reproduced locally; the monkeypatched `PermissionError` is the delete-blocked
mount in miniature and is the durable proof.

**Residual, stated.** The pen record now PERSISTS between commits rather than
appearing and vanishing, so a paper folder carries one small `.virgil/`
file it did not before. Inert by construction — the app's ladder reads
`holder: null` as no hold, `acquire_pen` overwrites it unconditionally, and
nothing else reads it.

### CI, and the limits stated rather than implied

Suites: [save-state-census](src/lib/__tests__/save-state-census.test.ts),
[save-state-view](src/lib/__tests__/save-state-view.test.ts),
[save-state-badge](src/components/__tests__/save-state-badge.test.tsx),
[useDocument.manual-save](src/hooks/__tests__/useDocument.manual-save.test.ts),
[write-preservation-gate](src/lib/__tests__/write-preservation-gate.test.ts),
[preservation-refusal-posture](src/lib/__tests__/preservation-refusal-posture.test.ts),
[preservation-notice-badge](src/components/__tests__/preservation-notice-badge.test.tsx),
[mount-preservation-gate](src/lib/__tests__/mount-preservation-gate.test.ts),
[code-pane-preservation-gate](src/lib/__tests__/code-pane-preservation-gate.test.ts),
[serializer-node-coverage](src/lib/__tests__/serializer-node-coverage.test.ts),
[tex-write-accountability](src/lib/__tests__/tex-write-accountability.test.ts),
[write-tex-forensic-snapshot](src/lib/__tests__/write-tex-forensic-snapshot.test.ts),
[preservation-measure-parity](src/lib/__tests__/preservation-measure-parity.test.ts),
[preservation-measure-python](src/lib/__tests__/preservation-measure-python.test.ts),
[per-file-write-gate](src/lib/__tests__/per-file-write-gate.test.ts)
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

## The compile path: downloaded work is DURABLE, and a slow compile SAYS SO

> **A compile that cannot finish inside one budget must still make PROGRESS, and
> every phase it spends minutes in must reach a pixel.** Virgil compiles in the
> browser: a first compile of a paper using tikz/pgf pulls 60–100 files from a
> third-party mirror over SERIAL SYNCHRONOUS XHR, one blocking round trip each.
> That is the app's single longest operation, and until task 454 it was also the
> only one with neither durability nor a voice.

This is the "Compile produces nothing after two minutes, with no error, no
indicator and an empty dark PDF pane" class (task 454, Gabriel's own dev doc).
Two independent defects, and the first is the one that made it unfixable by
clicking again:

- **A timed-out compile DISCARDED every package it had downloaded.** The bytes
  lived only in the worker's in-memory `texlive200_cache`; the write-through to
  IndexedDB rides `dumpNewCache`, which is a **request/response round trip** and
  therefore cannot run while the worker is blocked inside a synchronous pass —
  the one moment the bytes matter most is the one moment the worker can never
  answer. `captureNewAssets` was reachable only *after* a pass RESOLVED, and the
  timeout path went straight to `recover()` → `closeWorker()` → `self.close()`,
  tearing the whole worker scope down. So each retry restarted from the same
  fixed baseline (the vendored core bundle + whatever earlier *completed* passes
  had persisted), re-fetched the identical set, and timed out at the same point.
  **No forward progress between attempts, ever.**
- **Nothing said anything.** The compile's only moving pixel was a 16px spinner
  in the top bar — not on screen while the user watches the PDF pane, which is
  the surface they are waiting on and which rendered a bare dark surface. So
  "two minutes into downloading pgf" and "broken" were the same picture. Task
  392's law (*a gate that stops working SAYS SO, in one voice*) in the one
  subsystem that pass never reached.

Four mechanisms, and the first two are one idea:

- **STREAMING DURABILITY.** The worker posts each asset the instant it caches it
  (`__virgilStreamAsset` → `assetfetched`), and `attachAssetStream` writes it
  through immediately. A compile that times out now keeps 100% of what it
  fetched. **The channel had to be a second listener**: every per-call method in
  `PdfTeXEngine` swaps `latexWorker.onmessage`, and the compile handler
  early-returns on any `cmd !== "compile"`, so a message posted DURING a compile
  is dropped by that channel *by construction*. `installStreamChannel` uses
  `addEventListener("message", …)` once at boot, which no `onmessage` swap can
  clobber.
- **CONTINUATION.** A timeout that DOWNLOADED something is continued against the
  now-warmer cache rather than dead-ended; one that downloaded NOTHING is a real
  hang (a crashed worker, a stuck pass) and is reported at once, because
  continuing it would spend the whole budget re-hanging in silence. Bounded
  twice — `MAX_COLD_ATTEMPTS` and `TOTAL_COMPILE_BUDGET_MS` — since "keep going
  while it looks productive" with no ceiling is a hang wearing a retry's clothes.
- **A VOICE.** [compile-progress.ts](src/lib/compile/compile-progress.ts) is the
  `useSyncExternalStore` store (the `unsaved-work` / `preservation-notice`
  shape), keyed **per document** because the service is a module singleton shared
  by every mounted `EditorPane` ("Per-doc services under multi-pane keep-alive").
  [CompilePaneStatus](src/components/CompilePaneStatus.tsx) renders it: the live
  phase (naming the package and how many so far), or the last compile's FAILURE
  in the user's terms, or the honest "nothing yet" prompt. **"There is no
  pdfBlobUrl" is the same fact in all three states; only the record tells them
  apart.**
- **kpse HARDENING**, and its status is stated honestly rather than promoted:
  upstream negative-caches a miss only on status **301** — its own dead CDN's
  sentinel — so a 404, a 429, a 5xx, a network error or the per-file timeout
  fell through UNCACHED and kpse re-issued a full blocking XHR every time it
  probed that name. Measured live, the shipped TeXlyre mirror *does* answer 301
  for a miss, so on the everyday path this was latent; what it covers is exactly
  the shape the report describes (an endless stream of non-200s that never
  terminates), and a worktree cannot determine which status Chrome surfaces for
  a 301 carrying no `Location`. Every non-200 is negative-cached now, a mirror
  circuit breaker (`__mirrorDown`) turns an unreachable mirror into a FAST NAMED
  failure instead of a grind, the per-file timeout drops from 150 s to 30 s, and
  `kpse_find_pk_impl` gains the offline short-circuit its sibling has had all
  along — found by the independent diagnosis, not by the report.

Five rules they earned:

- **Durability rides the channel the blocked side can still USE.** A worker
  parked in a synchronous frame can `postMessage` and cannot `onmessage`. Any
  design that asks it a question during its slowest phase is designed to fail
  exactly there.
- **`closeWorker` does not `terminate()`** — it posts `grace` and drops our
  reference, so a worker blocked mid-compile keeps running as an ORPHAN,
  still fetching, until its pass unwinds. So the teardown **keeps** the
  DURABILITY sink (those late bytes are precisely what the next attempt would
  re-download) and **drops** the PROGRESS sink (per-attempt bookkeeping — an
  orphan's fetches counted against the next attempt would make a dead hang look
  productive and keep the continuation loop running).
- **`dumpNewCache` is BOUNDED.** It cannot resolve while the worker is blocked,
  so an unbounded await wedges its caller on precisely the path — a hang — where
  someone is most likely to reach for it. No live caller does today; that is what
  makes it a latent trap rather than a defect.
- **A timeout message must not imply the work was thrown away**, because after
  this fix it wasn't. A productive timeout says how many packages are cached and
  that pressing Compile again carries on from there.
- **The progress channel reaches a terminal state on EVERY path out of the
  hook**, or the pane says "Compiling…" forever for a compile that has ended —
  including the throw path, the cancelled documentclass prompt and the
  stale-pipeline abort, none of which the service can see.

CI: [compile-convergence.test.ts](src/lib/compile/__tests__/compile-convergence.test.ts)
drives the REAL `CompileService` against a fake engine that DOWNLOADS and then
hangs. **No pre-454 suite could see any of this**: `compile-service.test.ts`
drives one attempt and asserts its RESULT, and its fake engine has no download
channel at all, so "did the packages this attempt fetched survive?" is
unrepresentable in every one of its legs — which is exactly how a compile that
could never converge shipped green.
[worker-kpse-contract.test.ts](src/lib/compile/__tests__/worker-kpse-contract.test.ts)
is the SOURCE census over the vendored worker and its wrapper, and it is the only
instrument that can see them: nothing in the repo can DRIVE that code (it needs a
real `Worker`, real WASM and a real synchronous cross-origin XHR), and every
behavioural suite mocks `@/lib/swiftlatex` — so a `git checkout` of the upstream
file would silently drop every patch with the whole suite still green.
[compile-pane-status.test.tsx](src/components/__tests__/compile-pane-status.test.tsx)
pins WHICH WORDS reach the pane, which is a render fact no service or store test
can reach. Measured by neutering each half in turn: the pre-454 dead end takes 3
legs, the progress channel 4, and the pre-454 one-message pane 4.

**Residuals, stated.** The pgf/tikz family is still NOT in the vendored offline
bundle (`public/swiftlatex/texbundle/` — 82 entries, every package the dev doc
needs except that one), so a first compile of any paper using it still streams
60–100 files. Vendoring it would END the wait rather than making it survivable,
and it is **sized**: measured against the shipped mirror, the 60-file core
closure (pgf + pgfkeys + pgfmath + pgfsys + pgfcore + the two auto-loaded tikz
libraries, plus `forest.sty` at 350 KB) is **1.50 MB**, against a 10 MB `.fmt`
and ~1.5 MB of packages today — so it roughly doubles the package half and adds
~13 % to the engine payload, and it lands in the service worker's precache.
Two reasons it is a routed DECISION rather than a fix made here: the closure is
an ESTIMATE (the real set comes from a live-compile capture, which a worktree
cannot run, so a wrong guess ships bundle bytes nobody asks for — it fails open,
never wrong, just wasted), and pgf is one package family among many a paper
might want, so "vendor what this doc needs" is a policy question about the
offline story rather than a bug. Left to Gabriel. And the per-file XHR timeout's effectiveness is unverified — the
vendored file's own patch comment records that a synchronous cross-origin XHR
*ignores* its timeout, which is an empirical claim someone hit and wrote down,
and which a worktree cannot re-check.

**Owed, not claimed:** the preview acceptance. Compile behaviour is NOT
FSA-masked — it runs in the dev preview — but a worktree cannot start the dev
server (Turbopack panics on the symlinked `node_modules`) and this run was
unattended, so `virgil-dev` → `doc_devtest` → Compile → a rendered PDF is owed
against clean `main`. What is proven here is the STRUCTURE: durability across a
timeout, bounded convergence, and the words that reach the pane.


## Vendored viewers: the WRAPPER owns the defaults, and the dist gets a CENSUS

> **A vendored third-party viewer's own defaults are not Virgil's.** Every
> Virgil-side preference about how it BEHAVES is stated ONCE at the wrapper's own
> open door and applied PER OPEN — never patched into the dist. And the vendored
> tree carries a **patch census**, because its hand edits are otherwise held
> together by prose telling a human to re-apply them after the next `unzip -o`.

This is the "the Library PDF viewer's outline sidebar opens by default" class
(task 498, Gabriel's own report). Virgil supplies configuration to two vendored
trees, and only one of them was censused.

Three rules it earned:

- **Per OPEN, not per MOUNT — because the iframe is WARM.** `PdfView` keeps ONE
  viewer iframe across paper switches, and nothing in pdf.js closes an open
  sidebar on a re-open: `reset()` switches to THUMBS without `forceOpen` and
  `setInitialView(NONE)` early-returns. So a sidebar opened on paper A stayed
  open on B, C, D… for the life of the tab — a fourth path, invisible to any
  reading of the vendored resolution ladder alone. The door therefore does two
  things ([`applyViewerDefaults`](library/components/PdfView.tsx)): it un-defaults
  the option that would OPEN one, and it CLOSES one carried over. The two halves
  are guarded separately, because they answer different paths and a renamed
  vendored surface under one must not take the other down.
- **Un-default; do not bypass.** pdf.js resolves "sidebar view on load" in three
  tiers, and its stock `sidebarViewOnLoad` of `-1` (UNKNOWN) is precisely what
  unlocks the other two — a per-fingerprint `localStorage` restore and the PDF's
  own `/PageMode` (academic-publisher scans routinely carry `/UseOutlines`).
  Setting the option to `SidebarView.NONE` short-circuits both by their OWN
  conditions, so no vendored behaviour is bypassed and the page/zoom/scroll half
  of that same stored restore — read outside the `sidebarView === UNKNOWN` guard
  — is untouched. **Deliberately NOT generalized** to `scrollModeOnLoad` /
  `spreadModeOnLoad`, which ride the same tiers: nothing reports them and they
  restore a reading mode the user set on purpose (*match the fix to the true
  scope of the phenomenon*).
- **The census is what makes "wrapper-side" a checkable claim rather than an
  assertion.** [`PdfView.viewerDefaults.test.ts`](library/components/__tests__/PdfView.viewerDefaults.test.ts)
  is the pdf.js sibling of `worker-kpse-contract` (task 454), and it is the only
  instrument that can see any of it — nothing here can DRIVE the viewer, and
  every behavioural test fakes the window. It pins the vendored tree at EXACTLY
  the three files `VIRGIL_VENDOR_NOTE.md` declares (allowlist = that set; a hit
  is re-apply-it or declare-it), that `viewer.mjs` carries no Virgil patch at
  all, and the runtime surface the door reaches for — `PDFViewerApplicationOptions`,
  the option and its `-1` default, the UNKNOWN gates on both later tiers,
  `pdfSidebar.close()`, and the fact that nothing upstream closes a sidebar on
  re-open. Measured by neutering each half in turn: the pre-498 absent door takes
  7 legs, the option half 4, the close half 4, folding the two guards into one
  try 1, a simulated re-vendor that drops the `<link>` line 2, a third vendored
  patch 3, and an un-gated `/PageMode` tier 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — the Library PDF tab
works in the dev preview — so the check is cheap and real: open a paper whose PDF
carries `/PageMode /UseOutlines` (or open the sidebar by hand and switch papers)
and confirm it is closed on every open, and that the toggle still opens it.


## Style

[src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) is the design-system reference. Check it before building new UI. Update it when a UI decision feels generalizable.

## Sample paper for the dev doc

[samples/annotation-history/](samples/annotation-history/) is a frozen reference paper that exercises every card panel and most of the formatting vocabulary (footnotes, citations, bibliography, reports, examples with expex glosses, notes, todos, archive, cuts, revisions with multi-turn dialogue, suggestions, AI requests, bib reviews). The essay is on the history of annotation — self-referential, so the apparatus around the text mirrors what the text describes.

Use it to refresh `virgil-data/doc_devtest/` whenever it gets choppy from testing:

```
rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest
```

If the sample itself needs updating (new card kind, schema change), edit `virgil-data/doc_devtest/` live in the dev preview and copy back: `cp -R virgil-data/doc_devtest/. samples/annotation-history/`.
