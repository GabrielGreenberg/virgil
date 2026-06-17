# INV-3 — The reload restore / reconcile path

**Question:** trace what happens to a margin card's anchor ON LOAD, and pin EXACTLY
what turns it "unanchored". Distinguish symptom (a) re-anchor-doesn't-survive-reload
from (b) properly-anchored markers don't survive reload (anchor-loss vs marker-non-render).

READ-ONLY investigation. Evidence is file:line + a live dev-preview / on-disk
sidecar↔.tex cross-check.

---

## 0. TL;DR

A margin card (note/cut/report/todo/archive) anchors to a **paragraph UUID**
(`card.links[].anchor.textObjectIds[0]`). The gutter marker renders **iff** that
UUID matches a **live block in the reloaded doc**. Paragraph UUIDs are NOT in the
`.tex` source by default — they round-trip only via a trailing `%!v:<uuid>`
comment anchor that the **serializer writes on save** and the **parser reads on
load**. `generateShortId` is `Math.random()` (`src/lib/uuid.ts:24`), so a paragraph
whose `%!v:` anchor never reached the `.tex` gets a **fresh, different** UUID on
every load → the card's stored `paragraphId` matches nothing → **no marker, no
in-text highlight**, even though `isUnanchored()` returns **false** (the
`links[]` array is still non-empty).

- **The unanchored-on-reload condition that actually bites is NOT `isUnanchored`.**
  `isUnanchored` (links.ts:1093) is `links.length === 0` (or the citation
  `unanchored` flag). A re-anchored / anchored card always has a non-empty
  `links[]`, so `isUnanchored` stays **false**. The card is "logically anchored"
  but **points at a UUID that no longer exists**, so the marker silently doesn't
  render.
- **Symptom (b) is therefore marker-NON-RENDER caused by anchor-UUID drift, not
  anchor-DATA loss.** The card keeps its `paragraphId`; the *paragraph* lost (or
  never persisted) that UUID.
- **Symptom (a) is the same class**, surfaced by the re-anchor mint: the new
  paragraph's freshly-minted UUID has to reach the `.tex` (1500 ms tex-autosave /
  flush) for the card's new `paragraphId` to resolve after reload. The card side
  persists faster (300 ms sidecar) and more reliably (flush-on-unmount), so there
  is a structural **split-brain**: the card link can be durable while the
  paragraph UUID is not.
- The re-anchor card-mutation path is **byte-for-byte the same** before and after
  Chip H (both call `addNoteTextObjectId → addTextObjectLink`), so **(a)/(b) are
  PRE-EXISTING**, exposed-not-introduced by H. One genuinely-new H divergence
  exists but is an edge case (list-item / blockquote re-anchor, §6).

---

## 1. How a margin marker is built and rendered (the render contract)

### 1a. Marker build — `marginaliaMarkers` (EditorPane.tsx:1669-1880)

For note/archive/cutter/report/todo the builder does, per card:

```
const pids = getLinkedTextObjectIds(n);   // = card.links[].anchor.textObjectIds
if (pids.length === 0) continue;
for (const pid of pids) result.push({ ..., textObjectId: pid, ... });
```

(`EditorPane.tsx:1681-1690` notes; identical shape for archive :1704, cutter
:1771, report :1799, todo :1825). The marker's `textObjectId` **is the card's
stored paragraph UUID**, taken straight from `links` — NOT from any live mark or
live walk. Revisions are the exception: they live-resolve the paragraph from the
`linkedAnchor` **mark** by walking the doc for `m.attrs.anchorId === anchorId`
(:1730-1746).

### 1b. Marker render — Marginalia.tsx + useMarginaliaRegistry

`Marginalia` (Marginalia.tsx:111-116) calls
`computeMarkerPositions(registry.getMetrics, markers, panelSides)`.
`registry.getMetrics(uuid)` (useMarginaliaRegistry.ts:206) is
`stateRef.current.cache.get(uuid) ?? null`. The cache is keyed by the
**live block UUID** (`data-uuid` from `UuidAttrDecorator`,
uuid-attr.ts:104-130 / measured in useMarginaliaRegistry.ts `measureBlock`).
A marker with no matching live UUID gets `getMetrics → null` → it is **skipped**
(Marginalia.tsx:107-110 "registry returns null … those markers are skipped").

**So the render contract is: marker renders ⇔ a live block whose
`data-uuid === card.paragraphId` exists in the doc near-zone.** Nothing in the
render path repairs a UUID mismatch; it silently no-renders.

### 1c. In-text accent highlight — same contract

`useAnchorHighlightReconciler` (useAnchorHighlightReconciler.ts:188-209) resolves
a card's link via `resolveLink(editor, link)` and paints `data-card-selected` /
`data-paragraph-kind` on the resolved DOM element. For a Mode-A (paragraph) link
that resolution is also UUID→live-block; a stale UUID resolves to nothing →
no accent rail either. Same root dependence on UUID match.

### 1d. `useInTextPositions` — same contract

`getParagraphAnchorPositions` (useInTextPositions.ts:31-45) builds
`uuidToPos` from the live doc and looks up `uuidToPos.get(pids[0])`; a stale
`pid` returns `undefined` → the card gets **no position** → it doesn't lay out
next to its paragraph. Same dependence.

---

## 2. The paragraph-UUID lifecycle — where it can and can't survive reload

### 2a. UUIDs are NOT inherent to the `.tex`; they ride a `%!v:` comment anchor

- `UUID_ATTR_SPEC.parseHTML: () => null` (uuid-attr.ts) — UUIDs never survive
  copy-paste / HTML.
- The serializer appends ` %!v:<uuid>` to a paragraph line
  (latex-serializer.ts:217-219) and similar anchors for headings (:235),
  maketitle (:249), code (:256), math (:582), figures (:289), list items via
  `\vxid{}` (parser side latex-parser.ts:1297), examples via `\vexid{}`, etc.
- The parser strips the trailing `%!v:` back into `attrs.uuid`
  (latex-parser.ts:1683-1690 `stripTrailingUuidAnchor`; block-line form at
  :1603-1615; heading/label/math/env forms at :1186, :1251, :1272, :1461).

**Verified on disk** (dev-test doc): every one of the 70 `%!v:` anchors in
`virgil-data/doc_devtest/document.tex` round-trips, and ALL card `paragraphId`s
across notes/archive/cutter/reports/revisions/todos/examples match a `%!v:`
anchor (cross-check script in §5). So in steady state the round-trip is sound —
the bug is a **timing / first-persist** problem, not a steady-state corruption.

### 2b. `generateShortId` is RANDOM

`src/lib/uuid.ts:21-26`:
```
id = Math.random().toString(16).slice(2, 6);
```
A paragraph that lacks a `%!v:` anchor in the `.tex` is assigned a fresh **random**
4-hex UUID by `assignUuids` on every load. There is **no content-derived /
fingerprint re-attachment** — `recoverOrphanedUuids` exists
(latex-serializer.ts:1017) but is **DISABLED** at both call sites
("fingerprint matching causes UUID collisions" — storage-fsa.ts:306,
storage-dev.ts:288). So once a paragraph's `%!v:` is missing, its UUID is
**non-deterministic across reloads** and any card pointing at the prior value
orphans.

### 2c. The load sequence — and the FSA-vs-dev asymmetry (KEY)

- **`assignUuids`** (latex-serializer.ts:831-912) runs on every load. Pass 1
  dedups existing UUIDs; pass 2 mints (random) UUIDs for paragraphs/headings/atoms
  lacking one; it **strips** UUIDs on paragraphs nested inside a container
  (listItem/blockquote/codeBlock) — `insideContainer && paragraph → uuid=null`
  (:866-869).
- **Production (FSA) load — `readDocBundle` (storage-fsa.ts:283-287):**
  ```
  const content = parseLatex(latex, sidecar);
  assignUuids(content);
  return { content, editorState };   // ← NO writeback to .tex
  ```
  The load-time mints live **only in memory**. They reach the `.tex` only when a
  later `writeDocBundle` (autosave / flush) fires.
- **Dev load — `readDocBundle` (storage-dev.ts:241-270):** does an *opportunistic*
  fire-and-forget writeback of the re-serialized `.tex` + sidecar after
  `assignUuids`, gated on `getActiveHandle(docId)` + `isActive`. So **dev** stamps
  load-time mints back to disk; **production FSA does not**.

Consequence: in production a paragraph that has never been part of a *save* (its
`%!v:` was never written) has a **volatile** UUID. If a card is anchored to it and
the doc is reloaded before the next tex-save lands, the paragraph re-mints a
different UUID → orphan.

---

## 3. The re-anchor path (symptom a) — exact trace

1. **Hover/move during drop session.** `controller.handleMove` →
   `hitTest(x,y,…, activeCtx.mainEditor)` (controller.ts:225-231) →
   `resolveAnchorableBlock(editor, pos)` (hit-test.ts:93,132).
2. **UUID mint.** If the target block has no UUID, `resolveAnchorableBlock` mints
   one and dispatches it onto the **main editor**:
   ```
   uuid = generateShortId(existing);
   const tr = editor.state.tr.setNodeMarkup(blockPos, undefined, {...node.attrs, uuid});
   tr.setMeta("addToHistory", false);
   editor.view.dispatch(tr);     // hit-test.ts:150-156 (and :193-199 for the gap case)
   ```
   This is `docChanged`, so TipTap's `onUpdate` fires
   (Editor.tsx:679-681 → EditorPane.tsx:4387-4388 `docHook.onUpdate(editor)` →
   useDocument.ts:282-288) → `debouncedSave()` schedules the **1500 ms** tex save
   (useDocument.ts:261-275). `addToHistory:false` does NOT suppress `onUpdate`.
3. **The placement carries `block.uuid`** (`makeParagraphSidePlacement`,
   hit-test.ts:642).
4. **Commit.** mouseup → `commitDropSession` → `finishApply` →
   `spec.applyDrop(placement, cardKey, ctx)` (controller.ts:286-336).
   `textObjectSideReanchorSpec.applyDrop` (text-object-side-reanchor.ts:54-85)
   removes the old link and calls `api.addTextObjectLink(id, placement.paragraphId)`.
   **`applyDrop` dispatches NO editor transaction** — it only mutates the card
   sidecar.
5. **Card persists.** `dropNotesApi.addTextObjectLink = notesHook.addNoteTextObjectId`
   (EditorPane.tsx:1294) → `update(...) → addTextObjectLink(c,"note",pid)`
   (useNotes.ts:287-298, links.ts:1147) → `usePersistentState.update`
   (usePersistentState.ts:176-199): React state immediately, disk write
   **300 ms** debounce, flush on unmount / docId-change (usePersistentState.ts:207-211).

**The split-brain:** the *paragraph UUID* (the thing the card now points at) is
saved on the editor's **1500 ms** tex-autosave (scheduled back at hover, step 2),
while the *card link* is saved on the sidecar's **300 ms** debounce + a guaranteed
unmount flush. The commit itself touches only the card. So it is entirely possible
for the card link (`paragraphId = X`) to be durably on disk while the paragraph's
`%!v:X` anchor never reached the `.tex` — exactly the orphan condition of §2b.

**Why a reload can drop the tex write while keeping the card write:**
- The card sidecar has a flush-on-unmount/docId-change in `usePersistentState`
  (always runs on React unmount). The tex save's flush rides
  `pagehide`/`beforeunload`/`drainDoc→flushPendingForDoc` (useDocument.ts:199-253,
  162-164). On an *orderly* reload both should fire; on a hard refresh, a
  storage-clear, a crash, a dev hot-reload, or any path that unmounts the React
  tree (card flush) without firing pagehide on the editor flusher, the card link
  survives and the tex UUID does not. The two persisters are **independent
  mechanisms on different clocks**, which is the architectural defect.

---

## 4. Symptom (b) — "properly anchored markers don't survive, widespread"

This is the **same root cause without the re-anchor mint**, and it is
**marker-NON-RENDER, not anchor-data-loss**:

- The card's `links[].anchor.textObjectIds` is intact on disk (so
  `isUnanchored → false`, links.ts:1098).
- The marker fails to render because `registry.getMetrics(card.paragraphId)`
  returns `null` — no live block has that UUID (Marginalia §1b).
- That happens whenever the paragraph's `%!v:` anchor is **absent or different**
  in the reloaded `.tex`:
  - the paragraph's UUID was minted (lazily, on some interaction, or at load)
    but never tex-saved before a reload (§2c, §3);
  - or an external `.tex` edit / a style-merge / a save that stripped the
    paragraph's trailing comment dropped the `%!v:` (no fingerprint recovery to
    re-attach — §2b);
  - or the paragraph became container-nested and `assignUuids` stripped its UUID
    on save (latex-serializer.ts:866-869), so the card's `pid` (an inner-paragraph
    UUID) now resolves to nothing.

It is "widespread" because it is **structural**: *any* margin card whose target
paragraph's UUID is not currently materialized as a `%!v:` anchor in the on-disk
`.tex` will lose its marker on reload, regardless of how it was anchored. The
dev-test doc doesn't reproduce it only because that doc has been saved enough
times that every anchored paragraph already carries its `%!v:` (verified §5).

### Is (b) anchor-loss or marker-non-render? — marker-NON-RENDER

There is **no load-time reconciler that prunes a card's `links[]`** for a missing
UUID. The pruners that exist are **event-driven on live editing transactions**,
not on load:
- `TextObjectOrphanGuard` (linked-anchor.ts:162-187) fires
  `virgil-textobject-orphaned` from `diff.removedBlocks` — only on a transaction
  that *removes* a block. Initial `setContent` on load produces no
  `removedBlocks` diff, so no prune fires on load.
- `LinkedAnchorGuard` (linked-anchor.ts:87-132) fires `virgil-anchor-orphaned`
  from `diff.removedAnchors` — Mode-B mark removal, live edits only.
- The hooks' listeners (`useNotes`/`useTodos`/`useArchive`/… `removeTextObjectLink`)
  only run in response to those live events.

So on reload the card's `links[]` is **not** mutated — it just resolves to nothing.
The data is intact; the *rendering* is empty. (If the user then *edits* near the
orphaned area, a live `removedBlocks` could finally prune the link and flip
`isUnanchored → true`, but that's a downstream consequence, not the load itself.)

---

## 5. On-disk evidence (dev-test, read-only)

- 70 distinct `%!v:` anchors in `document.tex`.
- All five note `paragraphId`s (`2201,3302,5503,6602,1101`) → each `1` match in
  `.tex`.
- Cross-check of notes/archive/cutter/reports/revisions/todos/examples: **zero**
  unmatched `paragraphId`s.
- Live preview: 96 `[data-uuid]` nodes; 7 gutter markers rendering, e.g.
  `note:ea4d5253…:2201`, `archive:c48fc95b…:3301`, `cut:582f061d…:2202` — all
  resolving. List-item / expex-item UUIDs (`ea01`, `eb01`) confirmed in `.tex`
  via `\vxid{…}` (latex-parser.ts:1297; document.tex:132,137).

Interpretation: the steady-state doc is fully consistent → the bug is the
**first-persist / drift window**, not steady-state corruption. To reproduce one
must create the inconsistent state (re-anchor to a never-saved paragraph, then
reload before the 1500 ms tex save / flush lands; or hand-edit the `.tex` to drop
a `%!v:`).

---

## 6. Chip H delta — what is and isn't new

**Card-mutation path: identical.** Old `useAnchorRebindBridge`
(deleted `event-bridges/anchor-rebind.ts`) dispatched `virgil-marginalia-reanchor`
→ `m.add(entityId, newParagraphId)` → `addNoteTextObjectId` → `addTextObjectLink`.
New path: `MarkerButton` mousedown → `beginCardDropGesture` → controller →
`textObjectSideReanchorSpec.applyDrop` → `api.addTextObjectLink =
notesHook.addNoteTextObjectId` (EditorPane.tsx:1294) → the SAME
`addTextObjectLink`. The new `dropNotesApi` is wired to the SAME `notesHook`
instance that `marginaliaMarkers` reads, so the old "wrong-hook-instance / frozen
marker" hazard (called out in the deleted bridge's comment) is NOT reintroduced —
the in-session re-anchor updates correctly.

**UUID-mint path: functionally identical.** Old `ensureAnchorUuid`
(anchor-uuid.ts:68-87) and new `resolveAnchorableBlock` (hit-test.ts:132-200)
both `setNodeMarkup(... uuid ...)` + `setMeta("addToHistory", false)` +
`view.dispatch`. Same autosave trigger, same 1500 ms tex debounce.

⇒ **Symptoms (a) and (b) are PRE-EXISTING.** Chip H only made re-anchoring far
easier to invoke (every margin pin is now uniformly re-anchorable via the
drop-button UX), so it *exposes* the latent split-brain more often.

**One genuinely-new H divergence (edge case, flag it):**
`resolveAnchorableBlock` (hit-test.ts:140-142) stops at the **first**
`isAnchorableNode` while walking up `$pos.depth` and does **NOT** apply the
`DEFERRING_PARENTS` rule that `resolveAnchorableNode` (anchor-uuid.ts:46-49)
applies. So re-anchoring onto a paragraph nested inside a `listItem` /
`blockquote` / `codeBlock` / `exampleItem` can mint a UUID on the **inner
paragraph** and store that as the card's `paragraphId`. On the next save,
`assignUuids` **strips** inner-container-paragraph UUIDs
(latex-serializer.ts:866-869) → the card's `pid` is guaranteed to never
round-trip → orphan-on-reload, deterministically, for that shape. The old
`ensureAnchorUuid` path anchored to the **container** instead, which does
round-trip. This is a real, new, container-only regression; the common
top-level-paragraph case is unaffected (both resolve the same node).

---

## 7. Root-cause hypotheses (ranked)

1. **(both, preexisting) Split-brain persistence: the card anchor (paragraphId)
   and the paragraph's UUID are saved by two independent mechanisms on different
   clocks (sidecar 300 ms + guaranteed unmount-flush vs tex 1500 ms +
   pagehide/beforeunload-flush), and the paragraph UUID is the *only* thing that
   makes the card's `paragraphId` resolvable after reload.** When the card link
   persists but the `%!v:` anchor doesn't (any non-orderly reload, or simply a
   reload inside the tex debounce window where the editor flusher didn't fire but
   the React-unmount card flush did), the paragraph re-mints a **random**
   (`Math.random`, uuid.ts:24) UUID → marker non-renders. **Highest likelihood;
   explains both (a) and (b).**

2. **(both, preexisting) No deterministic / recoverable paragraph identity.**
   UUIDs are random and `recoverOrphanedUuids` is disabled, so there is no
   text-fingerprint fallback to re-attach a card to its paragraph when the `%!v:`
   anchor is missing or changed. Any drop of the anchor (external `.tex` edit,
   style-merge, a save that didn't emit it) is unrecoverable. Amplifies #1 into
   "widespread."

3. **(b, preexisting) Production FSA load does not write minted UUIDs back to the
   `.tex` (storage-fsa.ts:283-287), unlike dev (storage-dev.ts:241-270).** So
   lazily/load-minted UUIDs are volatile until the user happens to save, widening
   the window in which a properly-"anchored" card has a non-persistent target.

4. **(a, NEW from H) `resolveAnchorableBlock` ignores `DEFERRING_PARENTS`
   (hit-test.ts:140-142 vs anchor-uuid.ts:46-49).** Re-anchoring into a
   list-item / blockquote / code / expex-item mints on the inner paragraph;
   `assignUuids` strips it on save (latex-serializer.ts:866-869) → deterministic
   orphan for that shape. Container-only; smaller blast radius than #1.

## 8. Where a unified fix lives (for the synthesis agent, not implemented here)

The class is "a margin card's paragraph anchor is only as durable as the weakest,
slowest, most-conditional of two independent persisters, and the paragraph
identity it points at is non-deterministic if that persister loses a race." A deep
fix tackles **paragraph identity durability**, not the marker render:
- make the card-link write and the paragraph-`%!v:` write **atomic / co-scheduled**
  (when a card anchors to paragraph X, guarantee X's `%!v:` is flushed on the same
  (or faster) clock as the card sidecar — e.g. force a tex flush on
  `addTextObjectLink`, or stamp the `%!v:` synchronously at mint with an immediate
  tex write), and/or
- make FSA load write back load-minted UUIDs like dev does (storage-fsa.ts), so a
  paragraph's identity is durable from first open, and/or
- restore a **deterministic / fingerprint** re-attach so a card survives a missing
  `%!v:` (re-enable a collision-safe `recoverOrphanedUuids`), and
- fix the Chip-H `DEFERRING_PARENTS` divergence in `resolveAnchorableBlock` so
  it anchors to the same node `assignUuids` keeps.

All four derive from the same SSOTs: the `%!v:` round-trip (latex-serializer /
latex-parser), `assignUuids`, `usePersistentState` vs `useDocument` clocks, and
`generateShortId`.
