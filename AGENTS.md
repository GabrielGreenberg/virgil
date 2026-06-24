<!-- last-verified: a7b0a41a 2026-06-24 -->
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

The keystroke-sanctity sweep allows these direct subscriptions, because each is O(1) per transaction (debounced timer reset, counter bump, or RAF-coalesced layout read):

- `useDocument.ts` autosaver (1500 ms debounce; subscribes via TipTap's `onUpdate` option through the `EditorPane` wrapper)
- `useEditorUIState.ts` (transaction subscriber persists section folds, gated via the shared `transactionTouchesFold` predicate — fold-meta or docChanged; the last-paragraph saver rides `selectionUpdate`, 400 ms debounce)
- `useWordCount.ts` (300 ms debounce, then full doc walk)
- `EditorLayout.tsx` activity-presence bumper (`:917`, docChanged-gated counter increment)
- `EditorLayout.tsx` + `EditorPane.tsx` PDF-stale bump (O(1): stamp a timestamp ref, flip `pdfStale` at most once per compile cycle)
- `EditorLayout.tsx` section-path recompute, main pane (`:2147`, `on('update')`; the handler only `cancelAnimationFrame`+`requestAnimationFrame` — the doc-walk/`coordsAtPos` is RAF-coalesced to one frame, plus a perf-flag gate)
- `EditorLayout.tsx` section-path recompute, mirror pane (`:2251`, same RAF-coalesced pattern scoped to the mirror view)
- `SelectionActionsMenu.tsx` margin-bolt reposition (`:236`, `on('update')`; suppression check + RAF-already-scheduled bail — the single `coordsAtPos` placement math is RAF-coalesced and short-circuits on a placement-equality bail)
- `src/components/editor-layout/panels/omni-host.tsx` fold-aware OmniHost tick (`:184`, `on('transaction')`; a single `getMeta(sectionFoldingPluginKey)` check — bumps ONLY on a fold-meta tx, returns immediately on a plain keystroke)
- `lib/code-pane-bridge.ts` TipTap→code sync (`:431`, `on('transaction')`; docChanged-gated + own-write (`syncing`) filtered, then a debounced serialize — O(1) per tx)
- `lib/section-folding.ts` shared fold-chevron refresher (the `sectionFoldingPlugin` `view()`; ONE plugin-view per editor, not N per-heading subscribers — #29 nit-3). Its `update(view, prevState)` does an O(1) reference-compare of the `SectionFoldingState` (`sectionFoldingPluginKey.getState` old vs new) and bails on a plain keystroke — the apply reducer returns the SAME object on a structurally-null tx. Only on a real fold change does it `querySelectorAll('.heading-fold-chevron')` and resync each from live state via `closest('[data-uuid]')`, off the keystroke path. The per-NodeView `refreshFoldBtn()` at construction + in `update()` (editor-extensions.ts) is retained and is O(1)-per-affected-node — it is NOT an `on('transaction')` subscriber, so needs no list entry.
- `SlashCommandPopup.tsx` (mounted only while the popup is open; RAF-coalesced reposition)
- `TextObjectGrabHandle.tsx` (docChanged-gated, cheap)
- `EditorMirror.tsx` (RAF-deferred replay)
- `Marginalia.tsx` (RAF-coalesced host-element notify)
- `float-sync.tsx` (docChanged-gated + own-write meta filter)
- `src/lib/identity/useIdentityBusConsumer.ts` — the SINGLE inline-atom bus consumer (PLAN D1.2/D1.4; behind `virgil:identity-cascade`, default OFF). NOT an `editor.on(...)` subscriber: it opens exactly ONE `DocStructureBus.onAnyChange` subscription (`onAnyChange` is `emitCount`-gated, so it never fires on a plain keystroke), then bails O(1) when no citation/footnote entered or left the transaction. Only on a markerless re-parse (same-tx add+remove of atoms whose ids regenerated) does it run `detectRegenRemap` — O(addedAtoms+removedAtoms) = edit size, never doc size — and route the `oldId→newId` remap through the `IdentityCascade` so selection/float/pin survive (OMNI-F3-02, CI-A3-01, the CI-F1-02 id-survival class). This is the **+1, not +3** consumer: Wave-2 T2 (inline-atom lifecycle) and T5 (citation add-resync) register as ordered POLICIES on this one dispatcher (`registerPolicy`) rather than opening their own `onCitations*`/`onFootnotes*` subscriptions. Typing N plain chars leaves `__virgilBusStats().emitCount` flat and runs zero consumer code.

Anything else added to that list needs a comment explaining why it's O(1).

**Wall-clock services are exempt from this list** (they are not `editor.on(...)` subscribers and do no per-keystroke work). The **`DiskWatcher`** ([src/lib/disk-watcher.ts](src/lib/disk-watcher.ts), mounted by `DiskWatcherProvider`) is one: a per-doc `setInterval` poller (~3 s, paused while `document.hidden`, immediate on tab-focus) that detects out-of-band edits to the `.tex`/`.bib` on disk (the external-change badge). It *pulls* the `saveTimerRef.current !== null` dirty flag at poll time — never subscribes to the editor — so typing leaves `__virgilBusStats().emitCount` flat. False positives are killed by the `diskLedger` ([src/lib/disk-ledger.ts](src/lib/disk-ledger.ts)), stamped only on load + writes, never on plain reads.

### Card-source derivation: no raw update counters

Panel/card data (footnotes, citations, examples, archive order, marginalia markers) is derived from the live editor on demand. **Gate those memos on the per-category counters from [`useStructuralRevisions`](src/hooks/useStructuralRevisions.ts) (built on the `DocStructureBus`) — never on a `docVersion`-style counter bumped from `editor.on('update')`.** A structurally-null keystroke (typing inside a paragraph) fires no structural event, so nothing re-derives and no card re-renders or shifts. Live in-text positions come from the observer's per-transaction-mapped snapshot (`getBus(editor).structure`), resolved at measure time in [`useInTextPositions`](src/hooks/useInTextPositions.ts) — not from re-walked arrays, which would drift on the keystroke that wraps a line. The observer tracks blocks, headings, footnotes, **citations** (`CitationEntry` — including footnote-nested cites, tagged `nestedInFootnoteId`, surfaced load-only by `buildInitial`), anchors, examples, figures, and labels. Verify with `window.__virgilBusStats()` in the dev preview: typing N plain characters must leave `emitCount` unchanged.

**Initial population:** the `useStructuralRevisions` counters start at 0 and bump only on *changes* — `buildInitial` emits nothing, so none fire on doc load. A card-source memo must therefore also depend on the reactive **editor instance** (`editor`/`editorInstance` state), not a counter alone, so it computes once the editor mounts. Never gate a `ref`-based derivation (`editorRef.current?.getX()`) on a counter alone — the ref identity never changes and the counter is silent on load, so it reads the not-yet-ready ref once and never refreshes. Derive from the reactive `editor` and thread the result down as a prop (e.g. `footnoteInfos` / `examples` in `EditorPane`).

### Why this exists

Memo: [docs/perf/keystroke-sanctity-findings.md](docs/perf/keystroke-sanctity-findings.md). Predecessor sweeps in [docs/perf/cursor-selection-reactor-audit.md](docs/perf/cursor-selection-reactor-audit.md) and [docs/perf/reactor-sweep-followup-findings.md](docs/perf/reactor-sweep-followup-findings.md).

## Style

[src/STYLE_GUIDE.md](src/STYLE_GUIDE.md) is the design-system reference. Check it before building new UI. Update it when a UI decision feels generalizable.

## Sample paper for the dev doc

[samples/annotation-history/](samples/annotation-history/) is a frozen reference paper that exercises every card panel and most of the formatting vocabulary (footnotes, citations, bibliography, reports, examples with expex glosses, notes, todos, archive, cuts, revisions with multi-turn dialogue, suggestions, AI requests, bib reviews). The essay is on the history of annotation — self-referential, so the apparatus around the text mirrors what the text describes.

Use it to refresh `virgil-data/doc_devtest/` whenever it gets choppy from testing:

```
rm -rf virgil-data/doc_devtest && cp -R samples/annotation-history virgil-data/doc_devtest
```

If the sample itself needs updating (new card kind, schema change), edit `virgil-data/doc_devtest/` live in the dev preview and copy back: `cp -R virgil-data/doc_devtest/. samples/annotation-history/`.
