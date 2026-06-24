# Tab-switch slowness — DIAGNOSIS (analysis only, no fix yet)

**Headline:** Yes — every tab activation rebuilds the paper from scratch. Switching tabs
unmounts the entire editor subtree and mounts a fresh one, so each switch pays the full cold
cost: re-read the `.tex` from disk, re-parse LaTeX into a TipTap doc, spin up a new Editor
instance with ~60 extensions, walk the whole doc once for the structure index, and fire ~17
separate sidecar-file reads. Nothing about a previously-viewed paper is cached or kept alive.
A repeat visit to a paper you opened five seconds ago repeats 100% of that work.

---

## 1. Direct answer: "Is each paper reloaded fresh each time I hit the tab?"

**Yes, fully.** There is no keep-alive and no document cache. The mechanism is a mutually-
exclusive `activePane` ternary at `src/components/EditorLayout.tsx:4306`. Only ONE branch is
ever mounted:

- `activePane === "paper"` → `<PaperOuterView citekey=…>` (line 4308)
- `activePane === "library-outer"` (root) → `<LibraryTabView key={currentDocId}>` (line 4313)
- `activePane === "library-outer"` (custom lib) → `<LibraryOuterView>` (line 4331)
- else (the doc you're writing) → `<DocPipeline key={currentDocId}>` … `<EditorPane>` (line 4393)

Because the branches are alternatives in one ternary, the moment `activePane` flips, React
unmounts the entire old branch and mounts the new one. There is no `display:none` hidden
branch, no Suspense cache, no pooled editor. When you come back, React renders the branch
"from first paint." The only thing persisted across the round-trip is **scroll position**
(via `view-session-store`, keyed by scope/panel/citekey) — not the parsed document, not the
editor, not the sidecar state.

The same is true *inside* the Library tab when you switch between papers: the synthetic docId
`library-paper:<citekey>` changes, and the `<DocPipeline key={docId}>` boundary inside
`PaperRender` (`library/components/PaperRender.tsx:370`) forces a full remount of `EditorPane`
on every citekey change.

---

## 2. The lifecycle — what unmounts/remounts on each switch

Two distinct switches, same underlying cost:

### A. Outer tab switch (paper ↔ Library)
`activePane` flips at `EditorLayout.tsx:4306`. The losing branch unmounts **completely**;
the winning branch mounts cold.

```
paper tab  ──click Library──▶  activePane = "library-outer"
   │                                  │
   ▼ UNMOUNT                          ▼ MOUNT
PaperOuterView                   LibraryTabView (key=currentDocId)
  PaperFileBody                    └ whole Library catalog UI builds
    RightDetail
      PaperRender   ◀── all of this torn down: editor GC'd, parse AST dropped,
        PaperReader      17 sidecar hooks reset to defaults, structure index dropped
          DocPipeline
            EditorPane (the real editor + ~60 extensions)
```

Click back to the paper and the whole right column rebuilds from `PaperOuterView` down.

### B. Inner Library paper switch (paper ↔ paper)
`PaperFileBody`/`RightDetail` have **no `key`**, so React reuses those shells — but the work
they trigger reloads anyway because their children are keyed on the paper:

1. `PaperRender` effect keyed on `[handle, citekey, isIndexed]`
   (`PaperRender.tsx:78`) resets `tex` to `null` and re-reads
   `papers/<citekey>/main.tex` from disk (`readTextFile`, line 90).
2. `PaperReader` effect keyed on `[tex]` (`PaperRender.tsx:289`) re-runs `parseLatex(tex)` +
   `assignUuids(doc)` and resets `content`.
3. `docId = library-paper:<citekey>` changes, so `<DocPipeline key={docId}>`
   (`PaperRender.tsx:370`) **force-remounts** the whole `EditorPane` underneath.
4. `PaperFileBody` re-fetches the full bib block for the new citekey
   (`getFullLibraryBibEntry`, `PaperFileBody.tsx:65-74`).

### The architectural wall (intentional, but it's the cost driver)
The `key={currentDocId}` / `key={docId}` on `DocPipeline` is deliberate — its comment at
`EditorLayout.tsx:4383-4392` calls it "the architectural wall against the cross-doc autosave
bug": a full remount on doc switch guarantees no stale closure carries the prior doc's content
into the next doc's save. Correctness was prioritized over reuse. That's a defensible choice —
but it means *every* doc switch is a cold mount by construction, and it doesn't distinguish
"switching to a genuinely different doc" from "returning to a doc I just had open."

---

## 3. Where the time actually goes — ranked cost of one cold mount

For the **paper you're writing** (the `DocPipeline`→`EditorPane` branch), one mount runs:

| # | Cost | Where | O(?) | Notes |
|---|------|-------|------|-------|
| 1 | **TipTap Editor construction + ~60 extensions** | `Editor.tsx` `useEditor(...)`; extensions from `buildEditorExtensions` | O(schema) fixed but **large** | Full schema compilation + plugin/NodeView wiring on the main thread, blocks first paint. Usually the single biggest blocking chunk. |
| 2 | **`parseLatex(latex, sidecar)`** | `src/lib/latex-parser.ts:663` | **O(doc-size)** | Recursive `parseBody` + SEVEN post-passes that each walk the doc: `applyLinkedAnchorBoundaries`, `hoistTitleFieldsToTop`, `numberFootnotes`, `numberHeadings`, `numberExamples`, `numberFigures`, `resolveRefs`, then `mergeSidecarTitles`. Scales with paper length. |
| 3 | **17 sidecar FSA reads** | `EditorPane.tsx:946-1385` (useNotes, useAiRequests, useCutter, useReports, useRevisions, useTodos, useArchive, useFootnotes, useSuggestions, useCitations, useAnnotations, useExamples, useBibReview, useBibSettings, useCollab, useDocumentStyle, useEditorUIState) | O(#sidecars) I/O | Each hook's `[docId]` effect calls `readSidecarIfExists` → a fresh `getFile().text()` (`usePersistentState.ts:169-220`). **No coalescing, no dedup** — ~17 independent disk hits per mount, each blocking its own hook's "loaded" gate. |
| 4 | **`buildInitial(doc)` structure index** | `observer-plugin.ts:133` → `structure-index.ts:38` | **O(doc-size)** | One full `doc.descendants` walk at editor init to seed the DocStructureBus (headings/footnotes/citations/examples/figures/labels/blocks). Runs before any keystroke, so nothing is incremental yet. |
| 5 | **`readDocBundle` .tex + sidecar reads** | `storage-fsa.ts:321` | O(file) I/O | Reads `.tex` + `virgil.json` + `editor-state.json`, stamps the disk ledger, then (in the main app) does a fire-and-forget UUID-restamp writeback. |
| 6 | **`assignUuids(doc)`** | called in `readDocBundle` / `PaperRender.tsx:296` | **O(doc-size)** | Walks every anchorable node. |
| 7 | **Decoration/NodeView first layout** | Marginalia, panel widths, in-text position measures | O(visible) | All reset on unmount; recomputed on the new mount's first frames. |

**Dominant cost:** the combination of (1) editor + extension construction and (3) the ~17
sequentialish sidecar reads. (1) is a fixed-but-heavy main-thread block; (3) is N independent
disk round-trips that don't start warm. (2), (4), (6) are the **O(doc-size)** terms — they're
what makes a *long* paper feel worse than a short one.

**Paper-you're-writing vs. Library reader paper — the difference:**

- **Main paper** loads through `useDocument` → `readDocBundle` (`useDocument.ts:159`,
  `storage-fsa.ts:321`): the `.tex`, `virgil.json`, and `editor-state.json` come as one
  bundle, parse happens inside `readDocBundle`, and there's a load-time UUID writeback.
- **Library reader** loads through `PaperRender`: it reads `main.tex` itself
  (`PaperRender.tsx:90`), then parses in a separate `PaperReader` effect
  (`PaperRender.tsx:291`), and mounts `EditorPane` read-only (`editable={false}`,
  `READER_CHROME`). It is **read-only**, so the sidecar hooks mostly don't write back, and the
  chrome whitelists only 6 panel kinds — so its mount is somewhat lighter than the main
  editor's, but it still pays parse + editor-construction + buildInitial + the sidecar *reads*
  in full. Plus an extra full-bib-block fetch per selection (`PaperFileBody.tsx:65`).

---

## 4. What's cached vs. cold

| Thing | Cached across a tab round-trip? |
|-------|-------------------------------|
| Parsed JSONContent / TipTap doc | **No.** No doc-level parse cache anywhere. |
| TipTap Editor instance | **No.** GC'd on unmount, rebuilt on return. |
| DocStructure index (`buildInitial`) | **No.** Rebuilt every editor mount. |
| 17 sidecar states | **No.** Each `usePersistentState` resets to its default and re-reads from disk on `[docId]`. |
| FSA file reads | **No memo layer.** `readTex`/`readDocBundle` hit disk every call (`storage-fsa.ts:286, 321`); the disk-ledger is stamped, not a content cache. |
| Layout measures (marginalia, panel widths) | **No.** Reset on unmount. |
| **Scroll position** | **Yes** — the one exception, via `view-session-store` keyed by (scope, panel, citekey). But scroll alone doesn't avoid any of the re-parse/re-mount cost. |
| Bib parsing | A real cache exists (`bib-parser.ts` `PARSE_CACHE`, LRU size 4) — but it's **bib-only**, not used for document `.tex`. There is no analogous doc cache. |

**Bottom line for the user's mental model:** a repeat visit is indistinguishable from a
first visit, cost-wise. The system has no notion of "this paper was just open."

---

## 5. The shape of the fix space (directions, NOT a committed plan)

Three architectural directions, each a different point on the memory↔correctness↔complexity
triangle:

1. **Keep-alive / hide-don't-unmount.** Render the inactive branch(es) with `display:none`
   instead of unmounting, so the editor + parsed doc + sidecar state stay live in the
   background. *Tradeoff:* instant switch-back, but you pay RAM for every kept-alive editor
   (each TipTap instance + ~60 plugins + decorations is heavy), and you'd have to decide how
   many to keep (LRU of N) and confront the very autosave/stale-closure correctness the
   `DocPipeline key=` wall was built to prevent — kept-alive editors are still "live" and could
   race a save.

2. **Parsed-doc cache (cheap-mount, not zero-mount).** Keep a small LRU `Map<docId,
   {content, sidecars, mtime}>` so a return visit skips `readTex` + `parseLatex` +
   `assignUuids` + the 17 sidecar reads, but still constructs a fresh Editor from the cached
   content. *Tradeoff:* much lower memory than #1 (just JSON, not live editors) and preserves
   the remount wall, but the editor-construction cost (#1 in the table) remains, and you must
   solve **cache staleness vs. disk** — invalidate on the external-change ledger / mtime so a
   cached doc never shadows an out-of-band edit (this dovetails with the existing DiskWatcher
   fingerprint).

3. **Editor pooling.** Maintain a small pool of pre-warmed Editor instances and rebind content
   on switch rather than constructing per mount. *Tradeoff:* attacks the dominant
   editor-construction cost directly, but it's the most invasive — TipTap isn't designed for
   doc-swapping a live instance, and it collides hardest with the autosave wall (the whole
   reason for `key={docId}` is to *forbid* one instance seeing two docs).

**Open questions to settle before choosing:**
- What's the real per-mount wall-clock breakdown on a *representative* paper (instrument the
  branches above)? We have the structure; we don't yet have measured ms — the table's relative
  ranking is from code shape, not a profile.
- Memory budget: how many editors can we afford to keep mounted (#1/#3) before the tab itself
  bloats? Is N=1 (just the last paper) enough to make the paper↔Library bounce feel instant?
- Staleness contract (#2): is "trust cache until the DiskWatcher fingerprint changes" correct
  given Library papers can be rewritten by skills out-of-band?
- Does the autosave wall actually need a *full unmount*, or would a lighter "freeze writes +
  swap content" satisfy the same invariant? That answer gates whether #1/#3 are even on the
  table.

---

### Evidence index (verified against current code)
- `src/components/EditorLayout.tsx:4306-4393` — the `activePane` ternary + `DocPipeline key={currentDocId}` wall (comment at 4383-4392).
- `src/components/library/PaperOuterView.tsx:24-87` — outer paper view, no key/keep-alive.
- `library/components/PaperFileBody.tsx:36-87` — per-citekey full-bib fetch effect.
- `library/components/PaperRender.tsx:78-105` — re-read `main.tex` on citekey change; `:289-303` re-parse on `[tex]`; `:370` `DocPipeline key={docId}` remount; `:382-390` fresh `EditorPane` mount.
- `src/hooks/useDocument.ts:159-177` — `[docId]` load via `readDocBundle`, no cache reuse.
- `src/lib/storage-fsa.ts:286-294, 321-377` — `readTex` / `readDocBundle`: fresh FSA reads + `parseLatex` + `assignUuids` every call.
- `src/lib/latex-parser.ts:663-732` — `parseLatex` + the seven O(doc-size) post-passes.
- `src/lib/tiptap/doc-structure/observer-plugin.ts:133` + `structure-index.ts:38` — `buildInitial` full-doc walk at editor init.
- `src/components/EditorPane.tsx:946-1385` — the ~17 sidecar hooks; `src/hooks/usePersistentState.ts:169-220` — per-hook `[docId]` `readSidecarIfExists`, no coalescing.
- `src/lib/bib-parser.ts` `PARSE_CACHE` — the ONLY parse cache, bib-only.
