# INV-2 — Paragraph UUID lifecycle & persistence

**Scope:** Determine whether a paragraph uuid (`textObjectId`) is STABLE across reload, whether a
drop-MINTED uuid persists, and what keeps margin-card anchors alive across reload.
**Mode:** read-only code trace + read-only inspection of the live dev-doc sidecar/.tex.
**HEAD at trace:** `97d8614` (main). Rework merge under suspicion: `12bad05` (Chip H — the fold),
with `79ccdad` (PHASE 2 — fold gutter-pin re-anchor onto the controller) the load-bearing commit.

---

## TL;DR (the integrated answer)

1. **Paragraph uuids ARE persisted — in the `.tex` itself**, as trailing `%!v:<uuid>` comment
   anchors (and `\vexid{}`/`\vxid{}`/`%!vtex:begin` for block kinds). They are NOT in a separate
   sidecar and NOT regenerated-from-scratch on every load. The serializer writes them
   (`latex-serializer.ts:217-219` for paragraphs); the parser reads them back
   (`latex-parser.ts:1672` via `stripUuidAnchor`). A uuid that reached the `.tex` round-trips
   byte-identically.

2. **`assignUuids` (run on BOTH load and save) PRESERVES existing uuids** and mints fresh ones ONLY
   for blocks that lack one (`latex-serializer.ts:855-912`). So a paragraph whose uuid is in the
   `.tex` keeps that exact uuid across reload → its anchored cards stay anchored.

3. **A minted uuid is durable ONLY after the `.tex` has been re-saved with it.** Minting
   (`resolveAnchorableBlock` / `ensureAnchorUuid` / `BlockUuidBackfill`) writes the uuid into live
   ProseMirror node attrs and dispatches with `addToHistory:false`. That dispatch DOES fire TipTap's
   `update` event (only `preventUpdate` suppresses it, not `addToHistory:false` —
   `@tiptap/core` index.js:5092), so the 1500 ms `.tex` autosave is scheduled. Until that autosave
   actually lands the bytes, the minted uuid is **in-memory only**. `readDocBundle` does NOT write
   back on load (`storage-fsa.ts:283-287`).

4. **How anchors survive reload is uuid-stable, NOT text-rematch — for Mode A (paragraph-anchored)
   cards.** `reanchorByText` (links.ts:910) is wired ONLY for Mode B records that carry an
   `anchorId` + text snapshot (`Editor.tsx:1526-1530` `applyLinkedAnchors`). A pure Mode A margin
   note has no text snapshot and no rescue path: if its paragraph's uuid changes on reload, it is
   silently dropped from the margin (no rescue, no error).

5. **The "card vanishes from the margin" failure is a SILENT POSITION MISS, not a link deletion.**
   `isUnanchored` (links.ts:1093) only checks `links.length === 0`, so a Mode A card with a stale
   uuid still reports "anchored" — but `getParagraphAnchorPositions`
   (useInTextPositions.ts:25-46) builds a `uuid→pos` map from the LIVE doc and **drops any card
   whose `textObjectIds[0]` is not in that map**. Stale-uuid cards therefore disappear from the
   gutter entirely while still occupying the panel as a link-bearing card.

6. **THE RACE (root cause of symptom a).** Two independent persistence paths with DIFFERENT debounces:
   - card link → sidecar (`usePersistentState`, **300 ms** default debounce; `useNotes.ts:85-90`)
   - paragraph minted-uuid → `.tex` (`useDocument`, **1500 ms** debounce; `useDocument.ts:261-275`)

   A reload **between ~300 ms and ~1500 ms** after the drop persists the card-link→minted-uuid X
   but NOT the paragraph→X. On load, the paragraph (uuid-less in the `.tex`) gets a FRESH uuid Y
   from `assignUuids`. Card points at X, doc has Y → **unanchored, permanently.** Both
   pagehide/beforeunload flushes are **fire-and-forget `void save(...)`** (useDocument.ts:224,243),
   so a fast reload can also lose the `.tex` write even inside the debounce window.

7. **(a) is NEW, caused by the fold rework.** The OLD gutter re-anchor (`Marginalia.tsx`
   pre-`79ccdad`) hit-tested via `elementFromPoint().closest("[data-uuid]")` and read the existing
   `data-uuid` attribute — which `UuidAttrDecorator` emits ONLY for a NON-null uuid. So the OLD
   path could re-anchor a card ONLY onto a paragraph that **already had a stable, `.tex`-persisted
   uuid**; it physically could not target a uuid-less paragraph. The NEW path
   (`resolveAnchorableBlock`, hit-test.ts:144-157) MINTS a uuid on a uuid-less target — a strictly
   new capability that is exactly the fragile one. **(b) is mostly pre-existing** (the uuid-stable
   contract + 4-char id space + Mode-A-has-no-text-rescue have always been true); the rework merely
   widened how often a fresh/unpersisted uuid becomes an anchor target.

---

## The uuid lifecycle, end to end (with evidence)

### Where the uuid lives
- Schema attr on every anchorable node, `default: null`, **`parseHTML: () => null`** (never carried
  across copy-paste) — `uuid-attr.ts:35-49`. `isAnchorableNode` = "schema declares a uuid attr"
  (`marginalia.ts:48-50`), so `paragraph`, `heading`, lists, `listItem`, `blockquote`, `codeBlock`,
  `displayMath`, `latexComment`, `titleField`, `texBlock`, `figureBlock`, `graphicsBlock`,
  `exampleBlock`, `exampleItem` all qualify (`latex-serializer.ts:15-31`).
- The live DOM `data-uuid` is painted by a Decoration (`UuidAttrDecorator`, uuid-attr.ts:101-170),
  **only for non-null uuids** (uuid-attr.ts:62-63). This is what the OLD gutter hit-test depended on.

### Serialize → `.tex` (uuids ARE written)
- Paragraph: `inner + " %!v:<uuid>" + "\n\n"` (`latex-serializer.ts:217-219`); empty paragraph keeps
  `%!v:<uuid>` or `%!v:blank` (`:212-213`).
- Heading/title/maketitle/codeBlock/displayMath/etc. each append ` %!v:<uuid>` or an id-marker
  command (`latex-serializer.ts:226-398`, `:474-475` `\vexid`, `:557-558` `\vxid`, `:266-269`
  `%!vtex:begin/end`).
- Container-inner paragraphs (inside listItem/blockquote/codeBlock) serialize with
  `suppressChildUuids` → NO `%!v:` emitted (`:208`, `:216`). **Their identity defers to the parent.**

### Parse `.tex` → doc (uuids ARE read back)
- `stripUuidAnchor` pulls a trailing `%!v:xxxx` off a paragraph and restores it to attrs
  (`latex-parser.ts:1683-1695`, used at `:1652`/`:1672`). Headings/math/envs use `NODE_UUID_ANCHOR`
  (`:1186`,`:1272`,`:1461`). Id-marker commands `\vexid`/`\vxid`/`%!vtex` recovered by match.

### `assignUuids` — runs on load AND save, preserves identity
- `readDocBundle` → `parseLatex(latex, sidecar)` → **`assignUuids(content)`** (storage-fsa.ts:283-286;
  storage-dev.ts:241-250) — in MEMORY ONLY, no write-back on load.
- `writeDocBundle` → `assignUuids(content)` → `serializeToLatex` → write file
  (storage-fsa.ts:308-341).
- Behavior: pass 1 dedups genuine collisions (second occurrence of a duplicate uuid → cleared);
  pass 2 mints `generateShortId(existing)` ONLY for blocks lacking a uuid; container-inner
  paragraph uuids are STRIPPED (`:866-867`). Existing top-level uuids are untouched
  (`latex-serializer.ts:831-912`). Verified by `assign-uuids-dedup.test.ts`.

### Minting in the live editor (three sites, all `addToHistory:false`)
- `resolveAnchorableBlock` — drop hit-test, mints on the target paragraph during hover
  (`hit-test.ts:144-157` walk-up branch, `:187-200` gap branch). The minted uuid is captured into
  the placement (`hit-test.ts:642 paragraphId: block.uuid`).
- `ensureAnchorUuid` — lazy belt-and-suspenders, on first interaction (`anchor-uuid.ts:68-92`).
- `BlockUuidBackfill` — `appendTransaction`, backfills any inserted block lacking a uuid
  (`block-uuid-backfill.ts:214-230`); preserves moved uuids, re-mints only genuine duplicates.
- ALL THREE dispatch with `setMeta("addToHistory", false)` and NOT `preventUpdate`, so TipTap's
  `update` fires (`@tiptap/core` index.js:5092) → `EditorPane` `onUpdate` → `docHook.onUpdate`
  (EditorPane.tsx:4374-4388) → `debouncedSave()` → 1500 ms `.tex` autosave (useDocument.ts:282-288).

---

## The drop re-anchor flow (symptom a), step by step

1. User grabs a gutter pin (`Marginalia` MarkerButton, post-`79ccdad`) → `beginCardDropGesture`
   with `float:card:<kind>:<id>`.
2. On each mousemove the controller runs `hitTest(...)` against `activeCtx.mainEditor`
   (controller.ts:216-244). `resolveAnchorableBlock` **mints a uuid X** on the hovered paragraph if
   it lacks one and dispatches the `setNodeMarkup` tr to the MAIN editor (hit-test.ts:151-156).
   → `.tex` autosave (1500 ms) scheduled for X.
3. `makeParagraphSidePlacement` captures `paragraphId: X` (hit-test.ts:622-642).
4. On mouseup `commitDropSession` → `textObjectSideReanchorSpec.applyDrop`
   (text-object-side-reanchor.ts:54-85): removes old links, calls
   `api.addTextObjectLink(id, X)` = `notesHook.addNoteTextObjectId`
   (EditorPane.tsx:1294) → `addTextObjectLink(c, "note", X)` (links.ts:1147) →
   `usePersistentState.update` → **sidecar write (300 ms)** for card→X.
5. **Reload window 300–1500 ms:** sidecar(card→X) landed; `.tex`(para→X) NOT landed.
6. On load `assignUuids` finds the para uuid-less → mints **Y ≠ X**. Card link → X. Doc → Y.
   `getParagraphAnchorPositions` can't find X → card silently dropped from the gutter.
   No `reanchorByText` rescue (Mode A, no snapshot).

**Why the OLD path was immune:** it read `data-uuid` off the DOM
(`Marginalia.tsx` pre-`79ccdad` lines 186-189), present ONLY for a non-null uuid, which (by the
serialize/parse contract) means the uuid was already in or destined for the `.tex`. The OLD path
literally could not anchor to an unpersisted paragraph. Mutation-equivalence of the link write was
preserved across the rework (both bottom out in `links.ts addTextObjectLink`); the divergence is
ONLY in how the target `paragraphId` is obtained — read-existing (old) vs mint-if-absent (new).

---

## Symptom (b) — the broader class (mostly pre-existing)

Every Mode-A margin card's reload survival = "does my `textObjectIds[0]` still name a live paragraph
uuid?". This is fragile for several pre-existing reasons, all exposed (not caused) by the rework:

- **No text-snapshot rescue for Mode A.** `applyLinkedAnchors`/`reanchorByText` only rescue records
  with `anchorId` + `text` (Editor.tsx:1526-1530). A paragraph-anchored note has neither.
- **`recoverOrphanedUuids` is DISABLED** ("fingerprint matching causes UUID collisions" —
  storage-fsa.ts:306-308, storage-dev.ts:289-290). So the ONLY load-time recovery for a lost
  paragraph uuid is `assignUuids` minting a *fresh, non-matching* one — which is precisely what
  breaks the anchor.
- **4-char hex id space (65536).** `generateShortId` = `Math.random().toString(16).slice(2,6)`
  (uuid.ts:21-27). Collision-avoidance is only against the LIVE doc at mint time, so it's locally
  safe, but the space is small; also `.slice(2,6)` can occasionally yield <4 chars when the hex
  fraction has trailing zeros, which would not round-trip through the strict `%!v:[0-9a-f]{4}`
  regex (latent edge bug, not the main cause).
- **`MarginaliaAnchorGuard` (linked-anchor.ts:204-323)** protects a uuid only while it's in
  `anchoredUuidsRef.current` (built from `marginaliaMarkers` via a `useMemo`,
  EditorPane.tsx:1904-1909) OR hosts a live `linkedAnchor` mark. After a fresh drop re-anchor there
  is a React-update window before the ref includes the new target uuid; a delete/edit of the new
  host in that window is unguarded. Narrow, but a real edge of the same class.
- **Container-inner paragraphs never persist a uuid.** If a drop re-anchors onto a paragraph nested
  in a listItem/blockquote/codeBlock, `resolveAnchorableBlock` mints on the inner paragraph, but
  `assignUuids`/serializer STRIP that uuid on the next save (`:866-867`, `suppressChildUuids`).
  Guaranteed-stale on reload regardless of timing. (The drop target is usually a top-level para, so
  this is a secondary leg.)

---

## Live evidence (dev doc, read-only)

- `virgil-data/doc_devtest/document.tex` (modified today 21:08) has **70 `%!v:` anchors**; the
  tracked sample `samples/annotation-history/document.tex` also has 70, and a diff of the sorted
  uuid sets is **empty** — the normal round-trip preserves every paragraph uuid byte-for-byte.
- Cross-referencing `virgil/notes.json` link `textObjectIds` against the `.tex` uuids: all 4 notes
  + 1 highlight resolve **IN_TEX** (`2201`,`3302`,`5503`,`6602`,`1101`). The clean sample is fully
  anchored — consistent with "anchors survive when the uuid is in the `.tex`," and confirms the bug
  is a *transient-uuid* problem, not a steady-state serialize problem.

---

## Distinguishing (a) vs (b)

- **Same underlying invariant**: a Mode-A card stays anchored across reload **iff** its
  `textObjectId` is a uuid that is present in the reloaded `.tex`.
- **(a) re-anchor failure** = a NEW way to violate that invariant introduced by the fold rework:
  anchor a card to a paragraph whose uuid has not (yet/ever) reached the `.tex`, amplified by the
  300 ms-vs-1500 ms debounce race and fire-and-forget pagehide flushes.
- **(b) "widespread" failure** = the SAME invariant being violated by any other transient-uuid path
  (fast reload after typing a new paragraph that a card was just anchored to; container-inner
  targets; the disabled orphan-recovery leaving fresh uuids on any paragraph whose `%!v:` was lost
  to an external/code-pane edit). Pre-existing; the rework made the re-anchor entry point a frequent
  trigger.

---

## Where the deep, unified fix lives (for the planner — not implemented here)

The class is "a card anchor names a paragraph uuid that the `.tex` does not (yet) carry." Candidate
root-cause levers, deepest first:

1. **Make minting a uuid for an anchor target imply `.tex` durability before the card link is
   committed.** At drop-commit, force-flush the `.tex` (await `saveNow`/`flushPending`) BEFORE — or
   atomically with — the sidecar link write, so the two can never land out of order. Removes the
   300/1500 race for the deliberate re-anchor path.
2. **Give Mode A cards a text snapshot + reanchorByText rescue** (the same safety net Mode B
   already has), so a lost/changed uuid degrades to text re-match instead of silent disappearance.
   Generalizes beyond drop to ALL transient-uuid losses.
3. **Re-enable a *correct* orphan-uuid recovery** (the disabled `recoverOrphanedUuids`) or have
   `assignUuids` prefer a card-referenced uuid when minting onto a uuid-less paragraph whose text
   matches a card's snapshot — closing the load-time leg.
4. **Refuse to anchor onto an unpersisted/deferring paragraph** (mirror the old `data-uuid`-only
   contract) — narrowest, but reintroduces the "can't re-anchor a brand-new paragraph" limitation.

Levers 1+2 together capture the whole class durably; 1 alone fixes (a), 2 alone makes (b)
self-healing.

---

## File:line index (load-bearing)

- `src/lib/tiptap/uuid-attr.ts:35-49` — UUID_ATTR_SPEC (`default:null`, `parseHTML:()=>null`).
- `src/lib/tiptap/uuid-attr.ts:62-63,101-170` — `data-uuid` painted only for non-null uuids.
- `src/lib/marginalia.ts:48-50` — `isAnchorableNode` = schema-declares-uuid.
- `src/lib/latex-serializer.ts:15-31` — UUID_BEARING_NODE_TYPES.
- `src/lib/latex-serializer.ts:206-219` — paragraph `%!v:` emit (and `:208,:216` suppress for
  container-inner).
- `src/lib/latex-serializer.ts:831-912` — `assignUuids` preserve-existing / mint-missing / strip
  container-inner.
- `src/lib/latex-parser.ts:1683-1695` — `stripUuidAnchor` (read `%!v:` back).
- `src/lib/uuid.ts:21-33` — `generateShortId`, `NODE_UUID_REGEX` (4-char hex).
- `src/lib/storage-fsa.ts:283-287` — load: parse + `assignUuids`, NO write-back.
- `src/lib/storage-fsa.ts:306-341` — save: `recoverOrphanedUuids` DISABLED, `assignUuids` + serialize
  + write `.tex`.
- `src/components/drop-mode/hit-test.ts:132-203` — `resolveAnchorableBlock` mints (`:151-156`,
  `:194-199`), `addToHistory:false`.
- `src/components/drop-mode/hit-test.ts:622-642` — `makeParagraphSidePlacement` → `paragraphId:
  block.uuid`.
- `src/components/drop-mode/util/text-object-side-reanchor.ts:54-85` — `applyDrop` →
  `addTextObjectLink`.
- `src/components/EditorPane.tsx:1287-1299` — `dropNotesApi.addTextObjectLink =
  notesHook.addNoteTextObjectId`.
- `src/hooks/useNotes.ts:287-298` — `addNoteTextObjectId` → `update` → `addTextObjectLink` (sidecar).
- `src/hooks/useNotes.ts:85-90` — notes sidecar uses DEFAULT 300 ms debounce.
- `src/hooks/usePersistentState.ts:80,176-211` — 300 ms default debounce; flush on unmount/docId.
- `src/links/links.ts:1147` — `addTextObjectLink` (Mode A link write).
- `src/links/links.ts:1093-1100` — `isUnanchored` = `links.length===0` (uuid-validity NOT checked).
- `src/links/links.ts:910-963` — `reanchorByText` (Mode B only).
- `src/components/Editor.tsx:1513-1531` — `applyLinkedAnchors` calls `reanchorByText` only for
  `anchorId+text` records.
- `src/hooks/useInTextPositions.ts:25-46` — `getParagraphAnchorPositions`: silent-drop on missing
  uuid.
- `src/hooks/useDocument.ts:64-100` — `save` → `writeDocBundle`.
- `src/hooks/useDocument.ts:261-288` — `debouncedSave` (1500 ms), `onUpdate`.
- `src/hooks/useDocument.ts:204-244` — pagehide/beforeunload flush, **fire-and-forget `void
  save(...)`**.
- `node_modules/@tiptap/core/dist/index.js:5092` — `update` fires unless `preventUpdate`/no
  docChanged.
- `src/lib/tiptap/linked-anchor.ts:204-323` — `MarginaliaAnchorGuard` (uuid preservation on delete).
- `src/lib/tiptap/block-uuid-backfill.ts:214-242` — `BlockUuidBackfill`.
- Rework: `79ccdad` (PHASE 2 fold), deleted `anchor-rebind.ts`; OLD hit-test
  `git show 79ccdad^:src/components/Marginalia.tsx` lines 186-189 (`closest("[data-uuid]")`).
