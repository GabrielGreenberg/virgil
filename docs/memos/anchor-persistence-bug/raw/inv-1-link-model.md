# INV-1 — The Anchor / Link Data Model

**Question:** What does a margin card's anchor store, and does a (re)anchor capture
everything the reload-reconcile needs? Is symptom (a) [drop re-anchor lost on reload]
the same root cause as symptom (b) [normally-anchored margin cards not surviving
reload], and is either caused by the drop-button/fold rework?

**Verdict (one line):** The Mode-A paragraph anchor stores **only a paragraph UUID and
NO text snapshot**, and the reload reconcile has **NO text-fallback for Mode A** — so a
Mode-A margin card survives reload **iff its target paragraph's UUID is in the `.tex` at
reload**. Both symptoms are the SAME class: a freshly (re)anchored card points at a UUID
that was minted in the live doc but **may not have reached the `.tex` before reload**.
The drop rework did not introduce the gap; it **widened the surface** that mints fresh
UUIDs and re-anchors through it.

---

## 1. The anchor schema (exact shape)

`Link` (`src/links/_shared/types.ts:77-84`):

```ts
interface Link { id: string; kind: LinkKind; anchor: LinkAnchor; target: LinkTarget; createdAt: string }
```

`LinkAnchor` for a margin card is the `textObject` variant
(`src/links/_shared/types.ts:45-70`):

```ts
{ type: "textObject";
  targetKind: TextObjectKind;              // "paragraph" = Mode A, "linkedRange" = Mode B
  textObjectIds: string[];                 // paragraph UUID(s) — the ONLY anchor for Mode A
  margin: { side: "left" | "right" };
  textRange?: { anchorId: string; textSnapshot: string };  // PRESENT IFF targetKind === "linkedRange"
}
```

The decisive fact, in the type itself: **`textSnapshot` lives ONLY on `textRange`, and
`textRange` is present ONLY for Mode B (`targetKind === "linkedRange"`)**. A Mode A
paragraph anchor has `targetKind: "paragraph"`, no `textRange`, no snapshot. The doc
comment on the field even says the snapshot is "used for re-anchoring if the mark is lost
across a parse" — i.e. it is a Mode-B-only recovery affordance.

This matches the live on-disk data (`virgil-data/doc_devtest/virgil/notes.json`): every
**note** is Mode A with `targetKind:"paragraph"`, `textObjectIds:["2201"]` and **no
snapshot**; the one **highlight** is Mode B with `targetKind:"linkedRange"` + a
`textRange.textSnapshot`.

---

## 2. What each write path captures

### `addTextObjectLink` (`src/links/links.ts:1147-1183`)
- Signature: `addTextObjectLink(card, cardKind, textObjectId, targetKind = "paragraph")`.
- If the card already has a Mode B link → folds the new uuid into its `textObjectIds`,
  keeping the existing `textRange` (links.ts:1162-1175).
- **Otherwise → appends a fresh Mode A link via `makeAnchorLink(cardKind, card.id,
  "paragraph", [textObjectId])`** (links.ts:1179-1182). `makeAnchorLink`
  (links.ts:1113-1133) writes `targetKind`, `textObjectIds`, `margin` and **NO
  `textRange` unless one is passed** — none is passed on this path. **So a Mode-A add
  writes the paragraph UUID and captures NO text snapshot of the target paragraph,
  ever.**

### `removeTextObjectLink` (`src/links/links.ts:1186-1213`)
- Filters `textObjectId` out of each link's `textObjectIds`. A Mode A link that loses its
  last id is **dropped** (`remaining.length === 0 && !link.anchor.textRange` → `continue`,
  links.ts:1206). A Mode B link is kept even when it loses all paragraph ids (the
  text-range is the primary binding). The remove does NOT wipe a snapshot the add needs —
  Mode A has no snapshot to wipe.

### The drop re-anchor composition (`textObjectSideReanchorSpec.applyDrop`,
`src/components/drop-mode/util/text-object-side-reanchor.ts:54-85`)
The spec does exactly `remove(old) + add(new)`:
1. `preserveModeBAnchor?.(id)` snapshots + strips any Mode B mark (Mode A: no-op,
   returns null — text-object-side-reanchor.ts:68; useNotes.ts:347-369).
2. For each `pid !== placement.paragraphId` → `api.removeTextObjectLink(id, pid)`.
3. If `!current.includes(placement.paragraphId)` → `api.addTextObjectLink(id,
   placement.paragraphId)`.

`placement.paragraphId` is `block.uuid` produced by the hit-test's
`resolveAnchorableBlock` (`hit-test.ts:622-646` → `makeParagraphSidePlacement`). For a
Mode A note the result is: **the card now holds a Mode A link to the new paragraph UUID,
with no snapshot of that new paragraph's text** — identical to the normal-anchor path.
There is no stale/wrong snapshot left behind (because Mode A never had one); the link is
simply uuid-only.

### The note hook entry points (`src/hooks/useNotes.ts`)
- Normal create: `addNote(paragraphId, …)` → `addTextObjectLink(newNote, "note",
  paragraphId, targetKind)` (useNotes.ts:122). Mode A → uuid-only, no snapshot.
- Drop re-anchor: `addNoteTextObjectId(id, paragraphId)` → `addTextObjectLink(c, "note",
  paragraphId)` (useNotes.ts:287-298). Same uuid-only write.

**Both the create path and the drop path capture the SAME thing — a paragraph UUID and
no snapshot.** There is no asymmetry between them in what is persisted onto the card. So
the drop path does not write a "more broken" link than a normal anchor; the gap is shared.

---

## 3. What the reload-reconcile needs vs. what it gets

### Mode A resolution is pure-UUID (no snapshot anywhere in the loop)
`resolveLink` for a `textObject` anchor with no `textRange` iterates `textObjectIds` and
calls `findParagraphByUuid(editor, paragraphId)` (`links.ts:470-486`, `665-676`). If no
live node carries that uuid, it returns `null` → the card paints/reconciles as having no
in-doc anchor. `isUnanchored` (`links.ts:1093-1100`) for a link-bearing card is purely
`links.length === 0`, so the card is technically still "anchored" in the sidecar but its
anchor **resolves to nothing** — the on-screen "unanchored" symptom.

### The reload reconcile has NO Mode-A text fallback
On document open, `EditorLayout.tsx:3163-3214` builds the `applyLinkedAnchors` record set
**only from `getTextAnchor(card)`** — i.e. only cards with a Mode B `textRange` +
`anchorText` contribute a record (notes.ts loop at 3168-3173 guards `if (ta &&
ta.anchorText)`). `getTextAnchor` (`links.ts:1014-1031`) returns non-null only for a
`linkedRange` link. **A Mode-A note returns null → contributes NO reconcile record.**
`applyLinkedAnchors` → `reanchorByText` (`links.ts:910`) is therefore a Mode-B-only
recovery path. **Mode A has zero text-snapshot safety net on reload.**

### Therefore Mode A's ONLY survival mechanism is the paragraph UUID round-trip
UUIDs DO round-trip to disk: the serializer writes each block's uuid as a `%!v:<id>`
comment anchor (`latex-serializer.ts:153-154, 212-219, …`), and the parser reads it back
via `NODE_UUID_ANCHOR = /^[ \t]*%!v:([0-9a-f]{4})/` (`uuid.ts:33`;
`latex-parser.ts:132-136`, `1186-1193`, etc.). On load `assignUuids` (`latex-serializer.ts:
831-…`) **preserves** existing uuids and only fills/ dedups missing ones. Verified in the
live frozen sample: notes anchor `2201/3302/5503/6602` and each appears exactly once in
`document.tex` — a properly-persisted Mode A note round-trips and survives reload cleanly.

**Conclusion:** a Mode A margin card survives reload **iff the target paragraph carried
its UUID in the `.tex` at the moment of reload.** Nothing else can save it.

---

## 4. Where the UUID can fail to reach the `.tex` — the actual break

Every anchor-mint path mints a fresh 4-hex id and dispatches `setNodeMarkup(pos, …, {…,
uuid}) ; tr.setMeta("addToHistory", false)` onto the LIVE editor:
- normal note/marginalia anchoring: `ensureAnchorUuid` (`anchor-uuid.ts:68-92`),
- the drop / gutter-pin re-anchor hit-test: `resolveAnchorableBlock`
  (`hit-test.ts:144-157` and the gap-fallback `:187-200`),
- `collapseAllSections` headings (`Editor.tsx:1540-1554`).

`addToHistory:false` affects undo only — the transaction is `docChanged`, so it DOES fire
`editor.on('update')` → `EditorPane:4388 docHook.onUpdate(editor)` → `debouncedSave()`
(`useDocument.ts:261-275`). So the mint is normally captured. The break is a **two-writer
write-ordering / flush gap**, not a missing-onUpdate:

1. **Two independent debounced writers, asymmetric delays.**
   - The **card sidecar** (`useNotes` → `usePersistentState`) uses the **default 300 ms**
     debounce (`usePersistentState.ts:80`, `debounceMs = 300`; `useNotes.ts:84-90` passes
     no override). The card-link write (new uuid reference) lands fast.
   - The **doc autosave** (`useDocument`) uses a **1500 ms** debounce
     (`useDocument.ts:265`). The `.tex` write of the new `%!v:` anchor lands slow.
   These two are not coordinated; the drop's `applyDrop` writes the sidecar via `update()`
   and never forces a doc flush.

   ⇒ There is a ~1.2 s window where **the card already references the new uuid but the
   `.tex` does not contain it**. A reload in that window: parser produces a paragraph with
   no `%!v:` for that text → `assignUuids` mints a *different* fresh uuid → the card's
   stored uuid resolves to nothing → **UNANCHORED**. This is the prime mechanism for
   symptom (a) AND (b) (any fresh anchor, drop or not).

2. **Refresh-time flush is best-effort and can be cut off.** `useDocument`'s
   `pagehide`/`beforeunload` handlers (`useDocument.ts:199-253`) do fire the pending doc
   write, but (a) they early-return when `saveTimerRef.current === null`, and (b) the
   underlying write is async/fire-and-forget against the backend. The FSA *load* path does
   NOT write stamped uuids back to disk (`storage-fsa.ts:286` runs `assignUuids` but only
   the dev backend has the opportunistic writeback, `storage-dev.ts:254-270`), so in FSA
   mode a paragraph that first received its uuid at load also depends entirely on the next
   autosave landing.

3. **Secondary, lower-likelihood:** `generateShortId` =
   `Math.random().toString(16).slice(2,6)` (`uuid.ts:21-27`) is not guaranteed to be 4
   chars (trailing-zero fractions yield <4-char ids), and the parser only reads back ids
   matching `[0-9a-f]{4}`. A short/odd id would fail to round-trip. Rare, but it
   compounds the same class (uuid in card, not recoverable from `.tex`).

---

## 5. Symptom (a) vs (b): same root, different exposure

- **(a) drop re-anchor lost on reload** — the drop mints/binds a brand-new uuid via
  `resolveAnchorableBlock` and writes a uuid-only Mode A link. If the `.tex` write of that
  uuid loses the race (or the user re-anchors then reloads quickly), it's gone. The drop
  is *especially* exposed because re-anchoring to a not-yet-UUID'd paragraph is the common
  case, and the gesture is fast (drop → look → reload).
- **(b) normally-anchored margin cards not surviving reload** — the SAME uuid-only Mode A
  model with the SAME no-snapshot reload reconcile. Any note created on a freshly-minted
  paragraph uuid, then reloaded before the 1500 ms doc autosave + `.tex` write lands, is
  lost identically. Already-persisted notes (uuid already in `.tex`) survive — which is
  why the frozen sample looks healthy and the bug feels intermittent / "widespread but not
  total."

**They are one class.** The unifying invariant that is violated:

> A margin card's anchor is durable only if the *editor doc* (and thus the `.tex`) is
> guaranteed to persist the anchored paragraph's UUID **before or atomically with** the
> card sidecar that references it — and/or the card carries a text snapshot that the
> reload reconcile can use for Mode A. **Today neither guarantee holds for Mode A.**

---

## 6. Caused by the rework, or pre-existing?

**Pre-existing data-model gap, merely widened by the rework.**
- The uuid-only Mode A schema, the no-snapshot `addTextObjectLink`, the Mode-B-only
  `applyLinkedAnchors`, and the two-writer debounce asymmetry all predate Chip H (they're
  the D8/D9 link model + the long-standing `usePersistentState`/`useDocument` split).
- Chip H (`12bad05`) removed the old `anchor-rebind.ts` bridge and folded the gutter-pin +
  drop-button onto `beginCardDropGesture` → `textObjectSideReanchorSpec.applyDrop` →
  `addTextObjectLink`. It made **all** margin pins uniformly re-anchorable through the
  fresh-uuid-minting hit-test (`resolveAnchorableBlock`), where previously only
  `{todo,note,archive,cut}` re-anchored and via a different path. So the rework **routes
  more kinds through the fresh-uuid mint + uuid-only write**, increasing the population of
  cards exposed to the persistence race — but it did not create the underlying gap.

---

## 7. Direction for the deep, unified fix (for the synthesis to weigh)

A surgical "snapshot the new paragraph text on drop" patch would only paper over (a). The
class-level fixes, derived from the SSOTs, are:

1. **Give Mode A a text-snapshot + a reload reconcile (symmetry with Mode B).** Capture
   the anchored paragraph's text on every `addTextObjectLink` Mode-A write, and extend the
   reload reconcile (`EditorLayout:3163` / a new Mode-A pass) to re-resolve a Mode A link
   by paragraph-text match when its uuid is absent — i.e. make `reanchorByText`'s recovery
   available to paragraph anchors, keyed on `textObjectIds`/snapshot. This makes anchors
   survive even when the uuid round-trip is lost.
2. **Close the write-ordering race at the source.** Guarantee the doc autosave (the `%!v:`
   anchor) lands before/with the card sidecar that references a freshly-minted uuid —
   e.g. force a doc flush when a mint dispatches an `addToHistory:false` uuid transaction,
   or persist the mint into the `.tex`/sidecar synchronously, or have the mint paths stamp
   the uuid into a durable uuid-sidecar that the parser consults (so a uuid is never
   "live in the doc but absent from disk").
3. **Make `assignUuids` on load write back stamped uuids in FSA mode too** (parity with
   `storage-dev`), so a load-minted uuid is immediately durable.

Fix #1 (Mode-A snapshot + reconcile) is the deepest single lever: it makes the anchor
robust to *any* uuid-persistence failure, which is the true common cause behind (a) and
(b). #2/#3 remove the race that triggers it.
