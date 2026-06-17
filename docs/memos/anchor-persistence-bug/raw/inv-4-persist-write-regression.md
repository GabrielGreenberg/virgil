# INV-4 — Does the mutation reach disk, and did the rework change it?

**Scope:** the WRITE path + flush timing for a margin card's anchor; an
OLD-vs-NEW behavioral diff of the re-anchor path; a new-vs-preexisting verdict
per symptom. Read-only investigation. Repo `HEAD` = `97d8614`; the drop-button /
fold rework merge is `12bad05` ("Merge Chip H: the fold"), pre-rework tip is
`874f5ff`, the chip-H tip is `02e6b7f`.

---

## TL;DR

There are **two independent persistence stores** that must agree for a margin
card to survive reload, and they are written on **two different debounce
clocks**:

1. **The card sidecar** (`notes.json` etc.) stores the card's link →
   `paragraphId` (a 4-char UUID). Written by `usePersistentState.update()`,
   **300 ms** debounce, flushed on unmount/docId-change.
2. **The paragraph UUID itself** lives only in the editor doc, and is persisted
   to disk by being serialized into the `.tex` as a `%!v:<uuid>` comment marker
   during the **doc-bundle autosave**, **1500 ms** debounce
   (`useDocument.debouncedSave`). On reload the parser re-attaches the marker to
   the paragraph; that is the ONLY way a paragraph UUID round-trips.

The re-anchor drop's mutation **does** go through the same persisting `update()`
as a normal anchor edit — `dropNotesApi.addTextObjectLink === notesHook.addNoteTextObjectId`
(`EditorPane.tsx:1294`). The card-sidecar half is **not** the bug.

The bug is on the **paragraph-UUID half**. The drop hit-test **mints a brand-new
4-char UUID** for the target paragraph (`hit-test.ts:145-157`) and dispatches it
with `addToHistory:false`. That mint only reaches disk via the **1500 ms** doc
bundle autosave. **The two clocks race:** if the doc bundle hasn't flushed the
new UUID into the `.tex` before reload, then on reload `parseLatex` produces a
paragraph with **no** `%!v:` marker, `assignUuids` stamps it a **different**
fresh UUID, and the card's sidecar link now points at a UUID that **no longer
exists in the doc**. `getParagraphAnchorPositions` (`useInTextPositions.ts:25-46`)
emits **no position** for an unresolvable UUID and the card silently vanishes
from the margin → "becomes UNANCHORED." There is **no Mode-A text-snapshot
fallback** to recover it.

**OLD-vs-NEW:** the OLD gutter-DnD path minted the UUID with `ensureAnchorUuid`
(`anchor-uuid.ts`), which is **byte-for-byte the same dispatch** —
`setNodeMarkup(...uuid) + setMeta("addToHistory", false) + view.dispatch`. The
re-anchor mutators were **identical** (`anchor-rebind.ts` called the very same
`addNoteTextObjectId` / `removeNoteTextObjectId`). The new path added **no extra
flush, no snapshot capture, no doc-side write the old one skips**, and removed
none. **The class is PRE-EXISTING.** The rework changed only *which paragraphs
get a freshly-minted (not-yet-persisted) UUID and how often* — see "What the
rework actually changed" below.

---

## The write path, traced end to end

### Card-sidecar half (this half is healthy)

```
drop release
  controller.commit (controller.ts:290) → spec.classifyDrop → spec.applyDrop
    text-object-side-reanchor.ts:83  api.addTextObjectLink(id, placement.paragraphId)
      = dropNotesApi.addTextObjectLink              (EditorPane.tsx:1294)
      = notesHook.addNoteTextObjectId               (useNotes.ts:287)
        → update(prev ⇒ … addTextObjectLink(c,"note",paragraphId))  (useNotes.ts:289)
          = usePersistentState.update                (usePersistentState.ts:176)
            setState(next) + schedule debounced persist
              persist(next) → writeSidecar(handle, "notes.json", next)
```

- `usePersistentState.update` (`usePersistentState.ts:176-199`): sets React
  state immediately, and schedules the disk write on a **300 ms** debounce
  (`debounceMs = 300` default, `:80`). The payload is held in `pendingRef`.
- **Flush guarantees:** the pending write is fired synchronously on **unmount**
  and on **docId change** via `flushPending()` (`:166-174`, wired in the cleanup
  effect `:207-211`). So a doc-switch or component-unmount cannot lose the
  card-sidecar write.
- This is the **same** `update()` a normal note-anchor edit uses — there is no
  ref-only / non-persisting / stale-closure shortcut. `dropNotesApi` is memoized
  on the live hook callbacks (`EditorPane.tsx:1287-1299`), so it never closes
  over a stale mutator.

**Conclusion:** the card-sidecar mutation reaches disk reliably. The
`ParagraphAnchorApi` sub-bag wired at `EditorPane.tsx:~1283` routes through the
real persisting hook, not a ref.

### Paragraph-UUID half (this half is the bug)

```
drag HOVER over a paragraph
  controller.updatePlacement → hitTest(...)          (controller.ts:225)
    hit-test.ts:93  resolveAnchorableBlock(editor, pos)
      hit-test.ts:144  uuid = node.attrs?.uuid
      hit-test.ts:145-157  if (!uuid) { mint 4-char id; setNodeMarkup(...uuid);
                                        tr.setMeta("addToHistory", false);
                                        editor.view.dispatch(tr) }
    hit-test.ts:640-642  placement.paragraphId = block.uuid
  → that paragraphId is what applyDrop stores in the card link

UUID reaches disk ONLY via the doc-bundle autosave:
  editor docChanged (the setNodeMarkup tx) fires TipTap onUpdate
    (verified: @tiptap/core/dist/index.js:5092 — update emits on docChanged &&
     !prevDoc.eq(doc); addToHistory:false does NOT suppress it; only
     getMeta("preventUpdate") would)
  → EditorPane onUpdate wrapper → useDocument.onUpdate (useDocument.ts:282)
    → debouncedSave() (useDocument.ts:261) — 1500 ms timer
      → editor.getJSON() → save(doc) → writeDocBundle(handle, doc)
        → serializeToLatex(content) emits "%!v:<uuid>" markers
          (latex-serializer.ts:153-154, 217-218, …)
        → writeTextToHandle(texFh, latex)   (storage-fsa.ts:341 / storage-dev.ts:318)
```

On reload:

```
readDocBundle (storage-fsa.ts:266 / storage-dev.ts:230)
  parseLatex(latex, sidecar)  — re-attaches "%!v:xxxx" to nodes
    (latex-parser.ts:132-153, 1184-1193, NODE_UUID_ANCHOR = /^[ \t]*%!v:([0-9a-f]{4})/)
  assignUuids(content)        — assigns a FRESH uuid to any node lacking one,
                                and reassigns one of any DUPLICATE pair
    (latex-serializer.ts:831-912; dedup pass :840-853, assign pass :861-911)
```

**The race:** the card sidecar (300 ms + unmount-flush) almost always lands; the
UUID-in-`.tex` (1500 ms) often does NOT before a quick reload. When it doesn't,
the paragraph re-loads WITHOUT the minted marker, `assignUuids` gives it a new
UUID, and the card link is now dangling.

---

## Why a dangling Mode-A link makes the card disappear (not just "unanchored")

- `isUnanchored` (`links.ts:1093-1100`) returns **false** when `card.links.length
  > 0`. A re-anchored note DOES have a link (pointing at the dead UUID), so the
  data layer does **not** classify it as unanchored.
- But rendering goes through `getParagraphAnchorPositions`
  (`useInTextPositions.ts:25-46`): it builds a `uuidToPos` map from the **live
  doc** (`:31-36`) and pushes a position **only if** `uuidToPos.get(pids[0]) !==
  undefined` (`:41-42`). A dead UUID ⇒ **no position ⇒ the card is never placed
  in the margin.** It is effectively gone.
- There is **no Mode-A text-snapshot re-match** anywhere in this path.
  `reanchorByText` (`links.ts:910-963`) exists but is wired only for **Mode-B**
  mark-anchored cards whose `linkedAnchor` mark was lost across a parse — it is
  not consulted for a Mode-A paragraph link that points at a missing UUID.
- `useAnchorHighlightReconciler` (the reload reconciler this investigation was
  pointed at) only repaints selection/hover halos via `resolveLink`
  (`useAnchorHighlightReconciler.ts:193-208`). It does **not** repair or
  re-anchor dangling links; a card with no resolvable element is simply skipped
  (`:196 continue`).

So the user's phrasing "the card becomes UNANCHORED" is, mechanically, "the
card's link survives but points at a UUID the reloaded doc no longer contains,
so it renders nowhere."

---

## OLD vs NEW behavioral diff (precise)

### The re-anchor mutators are identical

Deleted `anchor-rebind.ts` (read at `874f5ff`) dispatched the SAME mutators the
new path uses:

```js
note: { remove: removeNoteTextObjectId, add: addNoteTextObjectId }
…
m.remove(entityId, oldParagraphId);
m.add(entityId, newParagraphId);
```

`addNoteTextObjectId` / `removeNoteTextObjectId` are the exact same persisting
`update()` callbacks the new `dropNotesApi` wraps. **No mutator difference.**

### The UUID-mint is identical

OLD path (`Marginalia.tsx` onDrop @ `874f5ff`): it first read the target's
**existing** `data-uuid` via `el.closest("[data-uuid]")` (line ~193); only for a
synthetic `_pos:NNN` target (a node that genuinely had no UUID) did it call
`ensureAnchorUuid(editor.view, rawPos)` (`anchor-uuid.ts`):

```js
const tr = view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, uuid: newUuid });
tr.setMeta("addToHistory", false);
view.dispatch(tr);
```

NEW path (`hit-test.ts:151-156`):

```js
const tr = editor.state.tr.setNodeMarkup(blockPos, undefined, { ...node.attrs, uuid });
tr.setMeta("addToHistory", false);
editor.view.dispatch(tr);
```

These are the **same transaction shape, same meta, same persistence
consequence** (both rely on the 1500 ms doc-bundle autosave to write the
marker). The OLD path did **NOT** do an extra flush, snapshot capture, different
mutator, or a doc-side write that the NEW path skips. There is **no behavioral
regression in the write/flush of the re-anchor**.

### What the rework actually changed (the real delta)

1. **More paragraphs now get a fresh (un-persisted) UUID, more often.** The OLD
   gutter-drag resolved the target by reading the existing `data-uuid` off the
   hovered block and only minted for the rare `_pos:` case. The NEW
   `resolveAnchorableBlock` mints during **hover hit-testing** (`controller.ts:225`
   → every placement update), for any anchorable block lacking a uuid — and it
   mints into deeper / "gap" targets via its depth-walk + nearest-child fallback
   (`hit-test.ts:140-180`). So the rework **widens the population of
   freshly-minted, not-yet-persisted UUIDs that a card can be anchored to**,
   which makes the pre-existing 1500 ms race **more reachable**. (Note: on a
   freshly-loaded doc every visible paragraph already carries a UUID from the
   load-time `assignUuids`, so in practice the mint fires mainly for brand-new /
   never-before-anchored blocks or container-internal targets.)
2. **The fold made MORE pin kinds re-anchorable.** The merge message itself
   notes report / report-request / revision-comment / revision-suggestion pins
   were **silent no-ops** in the old `anchor-rebind` table `{todo,note,archive,cut}`
   and the fold makes ALL margin pins re-anchorable. So those kinds can now be
   dropped onto a freshly-minted UUID and hit the same race — an EXPANSION of
   surface, not a new persistence path.
3. **No change to marker build / persistence for normally-anchored cards.** The
   `marginalia.ts` diff (`874f5ff…02e6b7f`) only deletes the old DnD MIME
   constants + the native gutter dragover/drop/indicator machinery; it does NOT
   touch how `MarginaliaMarker`s are derived from card links or how cards are
   persisted. Symptom (b) is therefore **not** caused by a Chip-H marker-build
   change.

---

## Live / on-disk evidence

- The dev doc (`virgil-data/doc_devtest`) is currently in a **healthy steady
  state**: `.tex` has 70 `%!v:` markers (+ vexid/vxid → 80 total UUIDs); every
  anchored card across notes/todos/archive/reports/revisions/cutter resolves to
  a UUID present in the `.tex`. A scripted cross-check found **0 dangling
  anchors**. (The doc was reset recently, so the race window had no chance to
  fire.) This corroborates that the data **model** is sound — the bug is a
  **timing race**, not a structural mismatch.
- Live editor (preview, main editable PM view): 89 four-char UUIDs, all
  resolvable, including hand-authored `1100`/`2200` (valid 4-char hex). No
  duplicates observed. Confirms the round-trip works when the save lands.
- UUID space is **4-char hex = 65 536 values** (`uuid.ts:21-24`, regex
  `/[0-9a-f]{4}/`). `assignUuids` avoids collisions at mint time via the
  `existing` set, but the **load-time dedup pass** (`latex-serializer.ts:840-853`)
  *clears and reassigns* one node of any duplicate pair — a secondary,
  lower-likelihood route to a dangling link (independent of the rework).

---

## Flush-timing caveats (secondary exposure beyond the 1500 ms race)

`useDocument` flushes the pending doc-bundle save on `pagehide` /
`beforeunload` / unmount (`useDocument.ts:199-253`), gated on
`saveTimerRef.current !== null` (the canonical "dirty" signal, set by every
`onUpdate`). Two residual gaps:

1. **Async write on teardown.** The flush calls `void save(pending)` —
   fire-and-forget. `save → writeDocBundle` is async; in the **dev backend** it
   is an HTTP `PUT` (`storage-dev.ts:318` `putText`). On a hard reload the
   browser may cancel an in-flight `fetch` before it completes, so even the
   pagehide flush can lose the just-minted UUID. (FSA backend writes to an
   OPFS/disk handle — also async, same teardown risk.)
2. **The card sidecar (300 ms) and the doc bundle (1500 ms) are written by two
   different hooks to two different files on two different clocks with no
   ordering barrier between them.** Nothing guarantees the `.tex` UUID write and
   the `notes.json` link write land atomically (or both, or neither). A crash /
   reload between them leaves the two stores disagreeing — which is exactly the
   dangling-link state.

---

## Root-cause synthesis (for the unified fix)

The deepest root cause is a **split-brain anchor identity with no durable
binding and no reload reconciliation**:

- A card's anchor is a **paragraph UUID** that lives in the editor doc and is
  persisted on a **separate, slower clock** (1500 ms `.tex` autosave) than the
  card link that references it (300 ms sidecar). The two can desync across a
  reload.
- A freshly **minted** UUID (drop hit-test, drag-handle, action button — any
  `ensureAnchorUuid`-style path) is anchored to **before** it is durable.
- On reload there is **no Mode-A reconciliation**: a card link whose UUID is
  missing is neither repaired (no text-snapshot re-match) nor surfaced as
  unanchored — it silently fails to render.

A unified fix would (a) make a minted anchor durable **before** a card can bind
to it (e.g. flush/commit the UUID synchronously into the persisted bundle at
mint time, or write paragraph UUIDs to a uuid-sidecar on the same 300 ms clock
as the card link), AND (b) add a **Mode-A reload reconciler** that, when a
card's `paragraphId` is absent from the reloaded doc, re-matches by a stored
text snapshot (the link already carries / could carry `anchorText`) and rebinds
to the surviving paragraph's UUID — mirroring what `reanchorByText` does for
Mode B. Either alone narrows the bug; both together make ALL margin-card
anchoring durable regardless of save timing.

---

## New-vs-preexisting verdict

- **Symptom (a) — re-anchor doesn't survive reload:** the failure MODE
  (mint-then-reload-before-1500 ms autosave ⇒ dangling Mode-A link ⇒ card
  vanishes) is **PRE-EXISTING** — the old gutter-DnD minted UUIDs the identical
  way (`ensureAnchorUuid`, same `setNodeMarkup`/`addToHistory:false`/dispatch,
  same identical mutators via `anchor-rebind.ts`) and relied on the same 1500 ms
  autosave. The rework **did not** change the write/flush. What the rework
  changed is **reachability**: it mints fresh UUIDs at hover hit-test time over a
  wider set of targets, and the fold made more pin kinds re-anchorable — so the
  pre-existing race is hit far more often now. Net: **pre-existing class,
  newly-exposed by the rework.**
- **Symptom (b) — even properly-anchored cards not surviving reload:**
  **PRE-EXISTING**, and *not* caused by a Chip-H marker-build/persistence change
  (the `marginalia.ts` diff touches no persistence). It is the SAME class as (a):
  any path that anchors to a UUID not yet flushed to `.tex` (or whose UUID gets
  reassigned by the load-time dedup pass on a 4-char collision) produces a
  dangling Mode-A link that renders nowhere. The static on-disk dev doc shows 0
  dangling anchors, confirming (b) is a timing/race phenomenon, not a structural
  regression. If (b) is observed even for cards the user did **not** re-anchor,
  the most likely additional contributors are: the 1500 ms autosave race on the
  card's ORIGINAL anchor when that paragraph's UUID was itself minted lazily
  (never typed-into, so never autosaved), and/or the load-time dedup
  reassignment on UUID-space collisions. Both are independent of the rework.
