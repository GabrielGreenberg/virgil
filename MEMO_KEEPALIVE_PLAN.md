# Tab-switch keep-alive — IMPLEMENTATION PLAN

Companion to `MEMO_TABSWITCH_DIAGNOSIS.md` (read that first). The diagnosis
established that parse / index / editor-build are individually cheap (~1ms each
on a representative paper) and that the felt cost of a tab switch is two things:

1. **~17 uncoalesced sidecar reads per mount** — each `usePersistentState` hook
   independently re-acquires the doc dir handle, re-enters `virgil/`, and reads
   one file. No coalescing, no cache.
2. **Full editor teardown + rebuild on every tab activation** — the
   `activePane` ternary at `EditorLayout.tsx:4306` and the
   `DocPipeline key={docId}` walls unmount the whole editor subtree on
   paper↔Library bounce even when `currentDocId` never changed.

The fix is three independent layers, sequenced so each one is a shippable win on
its own:

- **L1** — coalesce the ~17 sidecar reads into ONE bundled read per doc, cached
  at the storage boundary.
- **L2** — keep the MAIN doc editor mounted-but-hidden during the paper↔Library
  bounce (same `currentDocId`, so no full remount and the autosave wall is
  satisfied trivially).
- **L3** — LRU keep-alive of the last ~3–5 Library reader papers so inner-tab
  switches are instant.

Each layer preserves two hard invariants from `AGENTS.md`:

- **The autosave wall** — `DocPipeline`'s per-docId pipeline registry
  (`src/lib/multi-window/doc-pipeline.ts`) must continue to guarantee that no
  write authored under one doc's closure can land in another doc's file.
- **Keystroke sanctity** — no new per-keystroke, doc-size-proportional work; no
  new `editor.on('update'|'transaction')` subscriber that isn't O(1).

---

## L1 — COALESCE SIDECAR READS INTO ONE BUNDLED READ

### Goal
Replace ~17 independent `readSidecarIfExists(docId, filename)` disk hits per
mount with ONE directory acquire + a parallel batch read, served from a
per-docId cache so a second consumer (or a remount within the same doc session)
is free.

### Files to change
| Path | Role |
|---|---|
| `src/lib/storage-fsa.ts` | impl — add `readSidecarBundle` + `invalidateSidecarBundle`; route `readSidecarIfExists`/`writeSidecar` through the cache |
| `src/lib/storage-dev.ts` | impl — dev mirror (parallel `fetch`, not a waterfall) |
| `src/lib/storage.ts` | facade — re-export the two new functions |
| `src/hooks/usePersistentState.ts` | caller — read from the bundle instead of issuing a bare per-file read |
| `src/lib/disk-watcher.ts` | invalidation — call `invalidateSidecarBundle(docId)` when an external change is confirmed (`:469`, `:481`) |
| `src/lib/storage-fsa.ts:265-271`, `storage-dev.ts:219-231` | invalidation — `writeSidecar` invalidates the cached entry for that filename |

### The seam

**New module-scoped cache (in EACH backend, kept private):**
```ts
// A per-docId snapshot of the `virgil/` directory's sidecar files. `files`
// maps filename → the parsed JSON (or null = confirmed-absent). `inflight`
// dedupes concurrent bundle reads. `version` bumps on every write/invalidation
// so a late .then() from a stale read can detect it was superseded and drop.
interface SidecarBundle {
  files: Map<string, unknown | null>;
  inflight: Promise<void> | null;
  version: number;
}
const sidecarCache = new Map<string, SidecarBundle>(); // key: docId
```

**New public read (FSA):**
```ts
/**
 * Read ALL sidecars for a doc in one directory acquire + parallel file reads.
 * Returns a map filename → parsed JSON or null (confirmed-absent). Served from
 * the per-docId cache when warm. The cache is invalidated by writeSidecar and
 * by the disk-watcher on a confirmed external change.
 */
export async function readSidecarBundle(
  docId: string,
  filenames: readonly string[],
): Promise<Record<string, unknown | null>>;
```
Implementation outline (FSA):
1. Look up `sidecarCache.get(docId)`. If present AND every requested filename is
   already in `files`, return synchronously-resolved values (no disk).
2. Else acquire the dir ONCE: `requireDocHandle(docId)` → `getVirgilSubdir(...)`
   (`storage-fsa.ts:107`, `:138`).
3. `Promise.all(filenames.map(readOneInto(virgil, files)))` — each reads
   `getFileHandle(name)` + `.text()` + `JSON.parse`; `NotFoundError` → store
   `null` (mirrors `readSidecarIfExists`'s null contract at `:251-254`). Other
   errors → leave the key UNSET (so the per-file fallback re-throws for the
   `loadError` path — see invariants).
4. Stamp `files`, clear `inflight`, return the snapshot.
5. Dedup: if `inflight` is non-null when called, `await` it then re-read the
   cache (so 13 hooks calling concurrently issue ONE directory walk).

**`readSidecarIfExists` becomes a cache-first single-file read:**
```ts
export async function readSidecarIfExists<T>(
  docId: string, filename: string,
): Promise<T | null> {
  const bundle = sidecarCache.get(docId);
  if (bundle && bundle.files.has(filename)) {
    return (bundle.files.get(filename) ?? null) as T | null;
  }
  // … existing direct-disk body unchanged (the per-file fallback) …
}
```
This keeps every existing single-file caller (e.g. non-`usePersistentState`
readers) correct and backward-compatible while letting the bundle pre-warm.

**`writeSidecar` invalidates the written key (NOT the whole doc):**
inside the `enqueueDocWrite` task (`storage-fsa.ts:265-270`), after the file is
written, update the cache entry for that one filename to the just-written `data`
and bump `version`. (Updating in place rather than dropping it keeps the bundle
warm — the write IS the freshest value, so there's no staleness risk.)

**`invalidateSidecarBundle(docId)`:** drop the docId entry entirely and bump a
detached generation counter so any in-flight `.then()` from the pre-invalidation
read can self-cancel. Called by the disk-watcher when it confirms an external
change to that doc's `virgil/` (the watcher already distinguishes a confirmed
external change from Virgil's own writes via the `diskLedger` — wire the
invalidation in alongside `clearDiskFingerprint`/`stampDiskFingerprint` at
`disk-watcher.ts:469`, `:481`).

**Dev backend (`storage-dev.ts`):** same cache shape; `readSidecarBundle` does
`Promise.all(filenames.map(name => fetchJsonIfExists(docFileUrl(docId, \`virgil/${name}\`))))`
— PARALLEL fetches (the existing `fetchJsonIfExists` at `:127` already returns
null-on-absent, so it slots straight in). Do NOT sequentialize — a waterfall of
13 awaits would defeat the layer.

**Caller (`usePersistentState.ts:186`):** The mount effect currently calls
`readSidecarIfExists<S>(docId, filename)`. Keep that call shape — it now hits the
warm cache for free once the bundle is primed. Prime the bundle ONCE per doc
from the editor-pane boot path (a single `readSidecarBundle(docId, ALL_SIDECAR_FILENAMES)`
fired when the doc's pipeline opens). Define `ALL_SIDECAR_FILENAMES` as a
module-level constant listing the 13 sidecar files
(annotations / archive / bib-settings / citations / cutter /
document-settings / focus / notes / orphaned-footnotes / reports /
revisions / suggestions / todos — confirmed via grep). The cleanest prime point
is inside `DocPipeline` (it already brackets the doc lifecycle and runs once per
docId): fire-and-forget `void readSidecarBundle(docId, ALL_SIDECAR_FILENAMES)`
in the same `useMemo`/effect that calls `beginDocPipeline` (`DocPipeline.tsx:43`,
`:60`). The 13 hooks then read from the warm cache.

> Note: `usePersistentState` reads do NOT all use the same default; the bundle
> stores the *raw parsed JSON or null*, and each hook applies its own `migrate`
> over the raw value exactly as today (`usePersistentState.ts:196`). The cache
> is a raw-bytes layer, not a typed-state layer — keep it dumb.

### Invariants to preserve
- **`loadError` semantics (`usePersistentState.ts:139`, `:205-211`).** A read
  that THREW (corrupt/truncated JSON, transient FSA error) must still flip
  `loadError`, because the destructive orphan reaper stands down on it. In the
  bundle, a *parse/IO error for one file* must NOT be silently coerced to
  `null` (which reads as "absent" → empty default → reaper fires). Solution:
  leave the key UNSET in the bundle on a non-NotFound error so
  `readSidecarIfExists`'s `bundle.files.has(filename)` check is false and it
  falls through to the direct-disk read, which re-throws and drives the existing
  `.catch` → `loadError = true`. Only a confirmed `NotFoundError` stores `null`.
- **Write-then-read coherence.** After `writeSidecar`, a subsequent
  `readSidecarIfExists` for the same file must see the new value. The in-place
  cache update in `writeSidecar` guarantees this. After an EXTERNAL change, the
  disk-watcher's `invalidateSidecarBundle` guarantees the next read re-hits disk.
- **Library-paper read-only.** Reads bypass `enqueueDocWrite`
  (`storage-fsa.ts:195-199`) — bundling is read-side only, so the read-only
  invariant is untouched. The write-side library-paper guard
  (`storage-fsa.ts:200`, `storage-dev.ts:228`) is unchanged.
- **Keystroke sanctity.** The cache lives at the storage layer, fired once per
  doc-open from `DocPipeline`. It is NOT an `editor.on(...)` subscriber and does
  zero per-keystroke work. `__virgilBusStats().emitCount` must stay flat —
  verify in the dev preview.

### Test strategy
- **Unit (vitest, both backends).** `readSidecarBundle` returns a map; a second
  call is served from cache (assert one `requireDocHandle`/`fetch` via a spy);
  `writeSidecar` makes the next read return the new value; `invalidateSidecarBundle`
  forces a re-read; a NotFound file resolves to `null`; a malformed-JSON file is
  left UNSET so the per-file fallback re-throws (the `loadError` path).
- **Concurrency.** 13 concurrent `readSidecarIfExists` after one prime issue
  ONE directory walk (spy on `getVirgilSubdir`).
- **Regression.** Existing `usePersistentState` + sidecar-hook tests must stay
  green with no behavior change. Run the full suite.
- **Live (dev preview).** Open `doc_devtest`, confirm cards/notes/footnotes load
  identically; `window.__virgilBusStats()` `emitCount` flat while typing.

### Risks + de-risking
- **Stale cache shadows an out-of-band skill rewrite of a sidecar.** De-risk:
  wire `invalidateSidecarBundle` into the disk-watcher's confirmed-change branch
  (`disk-watcher.ts:469`, `:481`) — it already fingerprints Virgil's own writes
  via the `diskLedger` so it won't false-invalidate on self-writes.
- **A bundle read that loses the race to a `writeSidecar`.** De-risk: the
  `version` counter — a `.then()` that sees a bumped version drops its stale
  snapshot rather than overwriting the fresher in-place write.
- **Error-as-absent collapsing the `loadError` guard (data-loss class).** This
  is the one to watch. De-risk: the UNSET-on-error rule above + a dedicated unit
  test that a malformed sidecar still surfaces `loadError` end-to-end.

### ▶ STOP-HERE-IS-A-WIN
L1 alone removes the ~17 redundant disk round-trips from every cold mount —
including every current tab switch (which still remounts). Tab switches get
measurably faster with ZERO change to the mount/unmount lifecycle and ZERO
exposure to the autosave-wall interaction. Ship L1 independently.

---

## L2 — KEEP THE MAIN DOC EDITOR MOUNTED-BUT-HIDDEN

### Goal
During a paper→Library→same-paper bounce, `currentDocId` never changes
(verified: `openPaperTab` `useFiles.ts:736-744`, `activatePaperPane` `:762-766`,
`activateLibraryOuterPane` `:808-812` all set `currentPaperCitekey` /
`currentLibraryOuterId` + `setActivePaneState(...)` and NEVER touch
`setCurrentDocId`). Yet the editor subtree unmounts because the `activePane`
ternary (`EditorLayout.tsx:4306-4527`) is mutually exclusive. Keep the doc
editor mounted, toggling `display:none`, so the bounce is instant and the
`DocPipeline key={currentDocId}` boundary is never torn down.

### Files to change
| Path | Role |
|---|---|
| `src/components/EditorLayout.tsx:4306-4527` | hoist the doc-editor branch OUT of the ternary into an always-mounted, visibility-toggled wrapper |
| `src/components/EditorPane.tsx` | add `isVisible` prop; gate measurement/RAF paths on it |
| `src/components/SelectionActionsMenu.tsx` | visibility guard before `coordsAtPos` placement |
| `src/hooks/useInTextPositions.ts` | bail `measure()` when hidden |
| `src/hooks/useMarginaliaRegistry.ts` | skip RAF retry loop when hidden |

### The seam

**Lift the doc-editor branch out of the ternary.** Today the doc editor is the
last `else` arm of the ternary (`:4381` `currentDocId ? (...)`), so it unmounts
whenever any earlier arm wins. Restructure so the doc editor is ALWAYS mounted
when `currentDocId` is set, with `display` driven by `activePane === 'doc'`:

```jsx
{/* Always-mounted doc editor — visibility, not mount, toggles on tab switch.
    Same currentDocId across a paper↔Library bounce ⇒ DocPipeline key is
    stable ⇒ no remount ⇒ autosave wall satisfied trivially. */}
{currentDocId && (
  <div
    style={{ display: activePane === 'doc' ? 'flex' : 'none' }}
    className="flex flex-1 min-h-0 overflow-hidden"
  >
    <div data-virgil-row-scroll className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto">
      <DocPipeline key={currentDocId} docId={currentDocId}>
        {/* SplitWithCode + EditorPane — unchanged, plus isVisible={activePane === 'doc'} */}
      </DocPipeline>
    </div>
  </div>
)}

{/* Ternary now selects only the NON-doc panes (paper / library-outer / pdf /
    empty). The doc arm is removed from it. */}
{activePane === "paper" && currentPaperCitekey ? (
  <div className="flex flex-1 overflow-hidden bg-[var(--background)]"><PaperOuterView … /></div>
) : activePane === "library-outer" && currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID ? (
  …LibraryTabView…
) : activePane === "library-outer" && currentLibraryOuterId ? (
  …LibraryOuterView…
) : currentDoc && docPermState !== "granted" ? null
  : pdfView && currentDocId ? (…PDF iframe…)
  : activePane === 'doc' ? null   /* doc handled by the always-mounted block above */
  : (…empty state…)}
```

**Critical CSS requirement:** the hidden wrapper MUST use `display:none`, NOT
`visibility:hidden`. `display:none` removes it from flex flow so it doesn't steal
space or push the visible pane down; `visibility:hidden` would still reserve
layout. Keep `pdfView` as today (the PDF iframe replaces the editor view for the
SAME doc — that path already lives inside the doc context; either leave PDF in
the ternary as the doc-mode's alternate render, or fold the `pdfView` check into
the always-mounted wrapper's inner switch. Prefer the latter so the editor stays
warm behind the PDF too, but that is optional polish — keep PDF in the ternary
for the first cut).

**Thread `isVisible` into EditorPane and the measurement consumers.** Pass
`isVisible={activePane === 'doc'}` to `<EditorPane>` (`EditorLayout.tsx:4415`).
EditorPane forwards it to the measurement/RAF paths:

- `SelectionActionsMenu.tsx:203-210` — before scheduling the RAF placement
  compute, bail if `!isVisible` OR `editor.view.dom.offsetHeight === 0`.
  `coordsAtPos` returns `{0,0,0,0}` on a `display:none` editor, which would
  jitter the margin bolt. (The `placement.visible` guard at `:350` is a
  post-compute check; add the PRE-compute guard.)
- `useInTextPositions.ts:278` — bail at the top of `measure()` when `!isVisible`
  (already try/catch-guarded at `:277-282`, but bailing avoids wasted work AND
  avoids caching `naturalTop = 0` for every card).
- `useMarginaliaRegistry.ts:71-143` — skip/short-circuit the RAF retry loop when
  the editor is hidden (`getBoundingClientRect` → 0 dims fill the cache with
  garbage).
- `EditorLayout.tsx` breadcrumb section-path compute (`:2025` region,
  RAF-coalesced per `AGENTS.md`) — add `if (editorEl.offsetHeight === 0) return;`
  at the top so the hidden editor doesn't keep recomputing a stale 0-coord
  breadcrumb.

These guards are NOT new keystroke work — they're EARLY-OUTS that make existing
per-tx/per-RAF work cheaper while hidden. They strictly reduce work.

### Invariants to preserve
- **Autosave wall — satisfied by construction.** Because `currentDocId` is
  unchanged across the bounce, `DocPipeline key={currentDocId}`
  (`EditorLayout.tsx:4393`) never remounts; the SAME `pipelineId` stays in the
  registry (`doc-pipeline.ts:129-141`); the editor stays alive and keeps
  autosaving in the background (this is intended — write in doc, flip to
  Library, return, no duplicated/lost edits). NO change to the pipeline
  registry is needed for L2.
- **No two pipelines for the same docId.** L2 keeps exactly ONE doc editor
  (the main one) alive. It does NOT introduce a second editor for the same
  docId, so `assertNotSuperseded` (`doc-pipeline.ts:187-192`) is never exercised
  by L2. (That risk is L3-adjacent — see below.)
- **Keystroke sanctity.** The hidden editor's `on('update')`/`on('transaction')`
  subscribers are the same O(1)-per-tx subscribers `AGENTS.md` already permits.
  They keep firing while hidden, but each is O(1). The `isVisible` guards make
  the RAF/measurement followers cheaper, not more expensive. Net: keystroke cost
  in the VISIBLE doc is unchanged; the hidden doc isn't being typed into.
- **ProseMirror stability under `display:none`.** TipTap's view tolerates
  `display:none` (DOM stays in tree, just unrendered). Re-show is a pure
  visibility flip — no re-layout assumption is broken. Verify with a regression
  test (type → hide → show → assert doc content + selection intact).

### Test strategy
- **Unit / component.** Render EditorLayout with `currentDocId` set, flip
  `activePane` doc→paper→doc, assert the `DocPipeline` instance identity is
  preserved (no remount): e.g. assert `beginDocPipeline` is called once, the
  editor's `view` reference is stable, and a sentinel ref inside EditorPane is
  not reset.
- **Autosave end-to-end.** Type in doc, flip to Library, return, flip away
  again; assert the autosave debounce fired exactly the expected writes and the
  on-disk `.tex`/bundle has the edits (no dupes, no loss). Use the
  `doc-pipeline` registry spies.
- **Measurement guards.** With `isVisible=false`, assert `measure()` /
  marginalia RAF / breadcrumb compute early-out (spy on `coordsAtPos`: zero
  calls while hidden).
- **Layout.** Assert the hidden wrapper is `display:none` and the visible pane
  occupies full flex height (no pushed-down layout) — a jsdom style assertion
  plus a live dev-preview visual check.
- **Rapid bounce.** Flip doc↔Library many times fast; assert no pipeline churn,
  no `StalePipelineError`, no leaked RAFs.

### Risks + de-risking
- **`coordsAtPos` returns 0 while hidden → jittered chrome.** De-risk: the
  `isVisible`/`offsetHeight` guards above. The investigator audit confirms
  `useInTextPositions`, breadcrumb, `TextObjectGrabHandle`, marginalia
  `measureMetrics` are ALREADY try/catch-guarded; the guards turn graceful-
  degradation into don't-run-at-all.
- **A non-EditorPane listener/focus-trap assuming the editor DOM is unmounted
  during a Library flip.** De-risk: grep for any global focus/keymap/
  outside-click handler keyed on the editor being absent; verify none assumes
  unmount. The bounce now leaves the editor DOM present-but-hidden.
- **Memory: one always-mounted editor.** This is +0 editors vs. today's steady
  state when you're ON the doc, and +1 editor when you're on Library with a doc
  also open. Negligible — one editor. (The multi-editor memory question is L3.)
- **PDF view interaction.** First cut: leave `pdfView` in the ternary. Confirm
  toggling PDF still works and doesn't double-mount the editor.

### ⚠ ADVERSARIAL REVIEW REQUIRED
The hidden-editor-keeps-autosaving behavior is the highest-risk change. Even
though the autosave wall is satisfied by the stable `key`, request an
adversarial review specifically targeting: (a) does any background autosave from
the hidden-but-live editor race the disk-watcher's external-change detection?
(b) does the `flushPending`-on-docId-change path in `usePersistentState.ts:294`
behave correctly when docId DOESN'T change across the bounce (it shouldn't fire —
confirm)? (c) rapid hide/show under React StrictMode + the `pendingEnd`
deferred-delete (`doc-pipeline.ts:159-163`).

### ▶ STOP-HERE-IS-A-WIN
With L1 + L2, the paper↔Library↔paper bounce — the most common tab switch — is
instant: the doc editor is never rebuilt, and even a genuinely-new doc open is
cheaper thanks to L1's bundled reads. This is the headline user-facing win. L3 is
purely additive for the in-Library reader experience.

---

## L3 — LRU KEEP-ALIVE OF THE LAST N LIBRARY READER PAPERS

### Goal
Inside the Library reader, switching inner tabs changes the synthetic docId
`library-paper:<citekey>`, and `DocPipeline key={docId}` in `PaperRender.tsx:370`
force-remounts the whole `EditorPane`. Keep the last N (default 4: 1 visible +
3 hidden) reader papers mounted-but-hidden under their own per-docId pipelines,
evicting the oldest on overflow.

### Files to change
| Path | Role |
|---|---|
| `library/components/TabbedLibraryPanel.tsx:478-487` | replace the single `<PaperFileBody>` mount with an LRU host |
| `library/components/ReaderLRU.tsx` (NEW) | renders N keep-alive `PaperFileBody` instances, one visible |
| `library/hooks/useReaderLRU.ts` (NEW) | access-order tracker + eviction |
| `library/components/PaperFileBody.tsx` | accept `isVisible`; otherwise unchanged |
| `library/components/PaperRender.tsx:370` | unchanged — each keep-alive child still wraps `<DocPipeline key={docId}>`, just remounts far less often |

### The seam

**`useReaderLRU(activeDocId, capacity)`** — pure access-order state:
```ts
interface ReaderLRUEntry { docId: string; citekey: string; isVisible: boolean; }
function useReaderLRU(
  activeCitekey: string | null,
  capacity = READER_LRU_CAPACITY,  // const, default 4
): ReaderLRUEntry[];
```
Maintains an ordered list (most-recently-active first), promotes `activeCitekey`
to the front on change, and slices to `capacity` (the dropped tail is unmounted).
Each entry's `isVisible = (citekey === activeCitekey)`.

**`ReaderLRU`** renders the list:
```jsx
{entries.map(e => (
  <div key={e.docId} style={{ display: e.isVisible ? 'flex' : 'none' }}
       className="flex flex-1 min-h-0 overflow-hidden">
    <PaperFileBody
      handle={handle}
      citekey={e.citekey}
      entries={entries…} bibByKey={…} onBibChanged={…} scope={scope} panel={panel}
      isVisible={e.isVisible}
    />
  </div>
))}
```
At the mount point (`TabbedLibraryPanel.tsx:478`), replace the single
`<PaperFileBody citekey={activeLibrary.citekey ?? null} … />` with
`<ReaderLRU activeCitekey={activeLibrary.citekey ?? null} capacity={READER_LRU_CAPACITY} … />`.

**Eviction = true React unmount.** When the LRU slices past `capacity`, the
evicted entry is removed from the array → React unmounts its `PaperFileBody` →
its `DocPipeline key={docId}` cleanup runs `endDocPipeline` (`DocPipeline.tsx:62`)
→ `PaperRender`'s `setDocHandle` cleanup (`PaperRender.tsx:101-104`) deletes the
docId from the doc-index. Visibility toggles between visible↔hidden cost NOTHING
(no remount); only eviction tears down.

**`isVisible` threading** mirrors L2: `PaperFileBody` → `PaperRender` →
`EditorPane`, gating the same measurement/RAF early-outs so hidden readers don't
thrash `coordsAtPos`. (Reader is read-only, so there's no autosave thrash — only
measurement.)

### Invariants to preserve
- **Per-doc autosave boundary (notes only).** The Reader whitelists
  `editableCardKinds=["note"]` (READER_CHROME). Each keep-alive `PaperFileBody`
  has its OWN `<DocPipeline key={docId}>` with its own `pipelineId`, so a note
  edit in one reader can't cross into another's file (`usePersistentState`'s
  write-guard + the pipeline registry both hold per-docId).
- **No two pipelines for the SAME docId.** The LRU keys entries by docId, so a
  given `library-paper:<citekey>` appears AT MOST once in the list. This is the
  load-bearing invariant for `assertNotSuperseded` — if a citekey alias ever
  produced two different docIds for the same paper, two pipelines could fight.
  De-risk: derive docId canonically (`LIBRARY_PAPER_PREFIX + citekey`) and dedup
  the LRU on docId, not on the citekey prop object.
- **Keystroke sanctity.** Reader is read-only; the hidden readers' subscribers
  are O(1)-per-tx (and the visible one is the only one being scrolled). The
  `isVisible` guards keep hidden-reader measurement from running. But note the
  multiplied baseline: N readers each hold a live TipTap + plugins. Profile.
- **Library Reader never persists card sidecars** except notes — the write-side
  library-paper guard (`storage-fsa.ts:200`, `storage-dev.ts:228`) already
  enforces this and is unchanged.

### Test strategy
- **Unit (`useReaderLRU`).** Access order promotes the active to front; capacity
  slices the tail; re-visiting a kept-alive paper does NOT change list identity
  for the survivors (so no remount); eviction removes exactly the oldest.
- **Component.** Switch among 5 papers with capacity 4; assert the 5th evicts
  the 1st (its `DocPipeline`/doc-index entry is cleaned up) and that switching
  back to a kept-alive paper does NOT re-run `PaperRender`'s `readTextFile`
  (`PaperRender.tsx:90`) or `parseLatex`.
- **DocId dedup.** Assert the same citekey never lands twice in the LRU.
- **Notes edit isolation.** Edit a note in a hidden reader, switch back, assert
  it persisted to the right paper's sidecar.
- **Memory.** Instrument peak heap across an eviction cycle at capacity 4; verify
  it plateaus (no leak) and stays within budget (~12–16 MB for 4 readers per the
  investigator estimate). Add a `READER_LRU_CAPACITY` const so it's tunable.
- **Live.** Per `library/CLAUDE.md`, drive the Reader in the dev preview
  (`localStorage["virgil:force-dev-storage"]="1"`, open `genette1997` /
  `bringhurst1992` from `library-data/`), switch inner tabs, confirm instant
  switch-back and no cold re-parse.

### Risks + de-risking
- **Memory bloat on low-end devices (N live TipTap instances).** De-risk: the
  `READER_LRU_CAPACITY` const (default 4; allow 2 on low-end). Profile peak heap.
- **Citekey-alias double-keying wastes slots / risks dual pipelines.** De-risk:
  canonical docId derivation + docId-keyed dedup (above).
- **Unsaved hidden-reader note lost on eviction.** Reader notes autosave (no
  manual save), so a 300ms-debounced write is in flight. De-risk: on eviction,
  the `usePersistentState` unmount `flushPending` (`usePersistentState.ts:294-298`)
  fires the pending write synchronously before the pipeline ends — confirm this
  path runs for the evicted reader, and log a dev warning if an unflushed change
  is detected at eviction.
- **`PaperFileBody`'s per-citekey bib fetch (`PaperFileBody.tsx:65`) on a hidden
  instance.** Idempotent; a late `setState` on a hidden instance is harmless.
  Memoize `RightDetail`/`PaperFileBody` on docId so visibility-only flips don't
  re-run expensive setup.

### ⚠ ADVERSARIAL REVIEW REQUIRED
Same class as L2 but multiplied: N live editors under N pipelines. Request an
adversarial review of: the docId-dedup invariant (the one thing standing between
L3 and a same-docId dual-pipeline corruption), eviction-time note-flush
correctness, and the memory ceiling under rapid tab churn.

### ▶ STOP-HERE-IS-A-WIN
L3 is the last increment and purely improves the in-Library reading experience.
If memory profiling at capacity 4 is unfavorable on target hardware, ship L3 at
capacity 2 (1 visible + 1 hidden — enough to make a back-and-forth between two
papers instant) — still a win, lower memory.

---

## Cross-layer notes

- **Sequence is L1 → L2 → L3** and each is independently shippable (see the
  STOP-HERE notes). L1 has no lifecycle change and no autosave exposure — land
  it first and measure. L2 is the headline win and the first autosave-wall
  interaction (adversarial review). L3 reuses L2's `isVisible` plumbing.
- **Shared `isVisible` plumbing.** Build it once in L2 (EditorPane + the four
  measurement consumers) and reuse verbatim in L3. Define a single
  `isVisible?: boolean` prop on `EditorPane` (default `true` so every existing
  caller is unaffected).
- **Verification gate for every layer:** `npx tsc --noEmit` = 0, full vitest
  green, `eslint` 0-new, and `window.__virgilBusStats().emitCount` flat while
  typing in the dev preview (the keystroke-sanctity smoke test).
- **Items flagged for adversarial review:** (L2) hidden-editor-keeps-autosaving
  vs. disk-watcher + StrictMode deferred-delete; (L3) docId-dedup as the
  dual-pipeline guard + eviction note-flush + N-editor memory ceiling.
