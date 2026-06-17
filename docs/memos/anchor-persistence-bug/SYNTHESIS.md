# Margin-card anchor-persistence bug — integrated synthesis

Synthesis lead, 2026-06-16. Integrates INV-1 (link/anchor data model), INV-2
(uuid lifecycle), INV-3 (reload reconcile), INV-4 (persist write + regression).
All four converged independently on the same structural fault. Their digests are
consistent; the few claims any one of them rated "medium" are resolved below
against directly-read code.

---

## TL;DR

Both symptoms are **ONE class**: a margin card's anchor is a bare paragraph UUID
(Mode A), and that UUID is persisted on a **different, slower clock** than the
card link that references it — with **no reload reconciliation** to repair a
mismatch. The card link lands fast and reliably (300 ms sidecar + guaranteed
unmount flush); the paragraph UUID lands slowly and unreliably (1500 ms `.tex`
autosave, only path that writes the `%!v:<uuid>` anchor). Any reload in the gap
re-mints the paragraph a fresh UUID, the card's stored UUID now resolves to
nothing, and the card silently vanishes from the margin (`isUnanchored` still
returns false, so nothing even surfaces the dangling state).

- **(a) re-anchor doesn't survive reload** — same class, **exposed/amplified by
  the drop-button + fold rework** (Chip H, `12bad05`).
- **(b) properly-anchored margin cards don't survive reload** — same class,
  **pre-existing**.

**Deepest unified fix** — make a paragraph's anchor identity durable and
self-healing, derived from the SSOTs:

1. **Give Mode A a text snapshot + a Mode-A reload reconciler** (UUID-first,
   text-snapshot-fallback), symmetric with the Mode-B `reanchorByText` path. This
   is the load-bearing lever: it makes anchors survive **any** UUID-persistence
   failure, present or future.
2. **Close the write-ordering race at the source** — persist the paragraph UUID
   on the *same* transaction/clock as the card link (flush the doc bundle, or at
   minimum write the minted UUID into a fast store, when an anchor-mint
   transaction dispatches), and write load-stamped UUIDs back to the `.tex` in
   FSA mode (as the dev backend already does).

Either alone narrows the bug; together they close the class.

---

## The data model (SSOT) and the single invariant

A margin card (note / todo / report / report-request / comment / cutter- /
revision-card / archive) anchors via a `Link` whose `anchor` is
`{ type: "textObject", targetKind, textObjectIds, margin, textRange? }`
(`src/links/_shared/types.ts:45-70`).

- **Mode A** (`targetKind: "paragraph"`, and every non-`linkedRange` kind):
  carries **only** `textObjectIds: [paragraphUuid]`. **No `textRange`, no text
  snapshot — ever.** `textRange` is "present iff `targetKind === 'linkedRange'`"
  (types.ts:60-69). Verified live: every note in
  `virgil-data/doc_devtest/virgil/notes.json` is Mode A, `textObjectIds:["2201"]`,
  no snapshot.
- **Mode B** (`targetKind: "linkedRange"`): carries `textRange.textSnapshot` +
  an `anchorId` mark.

**The one invariant that governs both symptoms:**

> A Mode-A margin card renders in the gutter **iff** a live block in the reloaded
> doc has `data-uuid === card.links[].anchor.textObjectIds[0]`.

Render contract (INV-3): `getParagraphAnchorPositions` builds a `uuid → pos` map
and emits a position **only** when the card's UUID resolves
(`useInTextPositions.ts:25-46`, pushes only when `uuidToPos.get(pids[0]) !==
undefined`); the marginalia registry's `getMetrics(uuid)` returns null for a
missing UUID and the marker is skipped. There is **no text fallback** on this
path.

Paragraph UUIDs are **not inherent to the `.tex`**. They round-trip *only* as a
trailing `%!v:<uuid>` comment the serializer writes on save
(`latex-serializer.ts:206-219`) and the parser reads back
(`latex-parser.ts:1683-1695`, regex `^[ \t]*%!v:([0-9a-f]{4})`). On load,
`assignUuids` (`latex-serializer.ts:831-912`) **preserves** existing UUIDs and
**mints a fresh random one** (`generateShortId = Math.random`, `uuid.ts:21-33`)
for any block lacking a `%!v:` anchor. `recoverOrphanedUuids` is **disabled**
(storage-fsa.ts:306-308: "Lost UUIDs get fresh ones via assignUuids instead").

So: lose the `%!v:` anchor → `assignUuids` mints a **different** UUID → the
card's stored UUID matches nothing → the card silently disappears. There is no
fingerprint re-attach and (for Mode A) no text re-attach.

---

## Root cause of (b) — properly-anchored cards vanish on reload  [PRE-EXISTING]

A Mode-A card survives reload **only** if its paragraph's `%!v:` UUID is present
in the reloaded `.tex`. Two structural facts make this fragile and unrecoverable:

1. **Split-brain persistence on two clocks.** The card→UUID link persists via the
   300 ms sidecar (`usePersistentState` default; `useNotes` passes no override),
   flushed synchronously on unmount/docId-change — fast and reliable. The
   paragraph→UUID `%!v:` anchor persists **only** via the 1500 ms doc-bundle
   autosave (`useDocument.ts:261-275`), flushed only via pagehide/beforeunload
   (fire-and-forget `void save()`) or the doc-switch drain barrier. The marker is
   resolvable only if **both** halves landed; the fast half almost always wins,
   so any reload where the `.tex` write loses the race leaves the card pointing at
   a UUID the `.tex` never recorded.

2. **No Mode-A reload reconciliation.** The load reconcile
   (`EditorLayout.tsx:3163-3214` → `applyLinkedAnchors` → `reanchorByText`,
   `links.ts:910-963`) is built **purely** from `getTextAnchor(card)`, which
   returns non-null **only** for Mode B (`links.ts:1014-1031`, requires
   `targetKind === "linkedRange"` + `textRange`). **A Mode-A card contributes ZERO
   reconcile records.** Combined with disabled orphan recovery and random
   `generateShortId`, once a paragraph's `%!v:` is missing there is no fallback to
   re-attach the card — the orphan is **permanent**.

Three structural amplifiers, all pre-existing:

- **FSA load does not write minted UUIDs back to the `.tex`.** `readDocBundle`
  (storage-fsa.ts:283-287) runs `assignUuids` and returns — **no writeback**.
  Contrast the **dev** backend (storage-dev.ts:241-270), which writes the
  re-stamped `.tex` + sidecar back on every load. **This is why every investigator
  who tested the live dev preview found "0 dangling anchors": the dev backend
  masks the bug by persisting load-minted UUIDs immediately. The bug bites in
  production FSA mode**, where a load-minted UUID stays volatile until the user
  happens to trigger a 1500 ms autosave.
- **`isUnanchored` only checks `links.length === 0`** (`links.ts:1093-1100`). A
  dangling-UUID card has a non-empty `links` array, so it reports **anchored** —
  it lingers in the panel while vanishing from the gutter, and no "unanchored"
  affordance ever surfaces it. The failure is invisible, not loud.
- **4-char UUID space (65,536) + load-time dedup-reassign.** `assignUuids` clears
  and reassigns one node of any 4-char collision pair on every load
  (`latex-serializer.ts:840-859`), dangling any card anchored to the loser; and a
  sub-4-char `generateShortId` won't match the strict `[0-9a-f]{4}` read-back.
  Both are low-frequency members of the same class.

---

## Root cause of (a) — re-anchor (drop / fold pin) doesn't survive  [SAME CLASS, EXPOSED BY THE REWORK]

The re-anchor is **the same invariant** broken at the same place, made trivially
hittable by the rework:

- The card-link write is **healthy and unchanged.** `applyDrop`
  (`text-object-side-reanchor.ts:54-85`) does remove(old)+add(new) through
  `dropNotesApi.addTextObjectLink === notesHook.addNoteTextObjectId`
  (`EditorPane.tsx:1287-1299`) — the **same persisting `update()`** as a normal
  edit, the **same mutator** the deleted pre-H anchor-rebind bridge used. For a
  Mode-A note `preserveModeBAnchor` is a no-op (no snapshot to preserve, none to
  wipe). The drop writes a coherent UUID-only Mode-A link, byte-shape-identical to
  a normal anchor. **There is no per-path asymmetry in what's captured.**

- The fragile half is **the minted paragraph UUID.** The drop hit-test
  `resolveAnchorableBlock` (`hit-test.ts:144-157`) **mints a fresh 4-char UUID on
  an unpersisted target paragraph** via `setNodeMarkup` + `addToHistory:false` +
  `dispatch`, at **hover** time (`controller.ts:225`, runs in `updatePlacement`).
  That UUID reaches disk **only** via the 1500 ms autosave. (Confirmed
  `addToHistory:false` still fires TipTap's `update` → the autosave IS armed;
  `@tiptap/core/dist/index.js:5092` emits on `docChanged && !prevDoc.eq(doc)`,
  only `preventUpdate` suppresses it.) Reload before the autosave → paragraph
  parses without `%!v:` → `assignUuids` mints a **different** UUID → the just-saved
  card link dangles.

**Why the rework exposed it (new-from-rework for (a)):** the **OLD** gutter
re-anchor hit-tested via `elementFromPoint().closest("[data-uuid]")`, and
`data-uuid` is painted **only** for a non-null (already-`.tex`-persisted) UUID. It
**physically could not** target an unpersisted paragraph — it could only re-anchor
onto a paragraph whose UUID was already durable. The new `resolveAnchorableBlock`
**mints on uuid-less targets**, which is exactly the new fragile capability. The
fold also made **report / report-request / revision** pins re-anchorable (they
were silent no-ops in the old `{todo, note, archive, cut}` table), and the mint
now happens at hover over a wider/deeper target set — so the pre-existing race is
hit **far more often**. The schema (UUID-only Mode A), the Mode-B-only reconcile,
and the debounce split all **predate** the rework; Chip H widened *reachability*,
not the data model.

**One genuinely-new Chip-H defect (deterministic, timing-independent):**
`resolveAnchorableBlock` does **not** check `DEFERRING_PARENTS`
(`hit-test.ts:140-142`), unlike the normal `resolveAnchorableNode`
(`anchor-uuid.ts:46-48`, which skips a container-nested paragraph and defers to
the parent listItem/blockquote). So re-anchoring **into a list-item / blockquote /
code / expex paragraph** mints on the **inner** paragraph — and `assignUuids`
**strips inner-container-paragraph UUIDs on the very next save**
(`latex-serializer.ts:866-869`). That anchor is **guaranteed stale on reload**
regardless of timing. Verified both resolvers directly.

---

## Are (a) and (b) the same root cause?

**Yes — one class.** Identical write path (`addTextObjectLink`), identical reload
dependency (the paragraph UUID present in the `.tex` as `%!v:`), identical absence
of a Mode-A text fallback, identical split-clock persistence. (a) is the
re-anchor-shaped instance, made common by the rework's hover-time mint over a
wider target set; (b) is every other instance where a paragraph's UUID is
lazily-minted / not-yet-persisted / lost. The static dev doc is steady-state
consistent (70 `%!v:` anchors, every card paragraphId matches, 7 markers render),
so this is a **first-persist / drift-window phenomenon**, not steady-state
corruption — confirming "race, not structural mismatch."

| Symptom | Root cause | New vs pre-existing | Evidence |
|---|---|---|---|
| (a) re-anchor | Mint of an unpersisted paragraph UUID on the 1500 ms clock while the card link lands on the 300 ms clock; no Mode-A reconcile | **Exposed/amplified by rework** (mint-on-uuid-less target is new; mint-at-hover + more re-anchorable kinds widen frequency). Plus a **new deterministic** container-paragraph mis-mint (no DEFERRING_PARENTS check) | OLD path `closest('[data-uuid]')` could only target persisted UUIDs (`Marginalia.tsx` @79ccdad^:186-189); NEW `resolveAnchorableBlock` mints (`hit-test.ts:144-157`); identical mutator before/after (`EditorPane.tsx:1294`) |
| (b) normal anchors | Split-clock persistence + no Mode-A text reconcile + disabled orphan recovery + FSA no-load-writeback | **Pre-existing** | Mode-B-only reconcile (`EditorLayout.tsx:3163-3214`, `getTextAnchor` `links.ts:1014-1031`); FSA no writeback (storage-fsa.ts:283-287) vs dev (storage-dev.ts:241-270); all predate `12bad05` |

---

## THE DEEPEST UNIFIED FIX

Derived from the three SSOTs (link/anchor model, UUID lifecycle, reconcile). Two
levers; ship both. **Lever 1 is the architectural lever that captures the whole
class** (it makes anchoring durable even if every timing problem persists); Lever
2 removes the race that makes Lever 1's fallback fire in the first place.

### Lever 1 — Make Mode-A anchors self-healing (the class-capturing fix)

Give Mode-A paragraph anchors a **text snapshot** and a **Mode-A reload
reconciler**, mirroring Mode B — so a missing/changed paragraph UUID is repaired
by content match instead of silently dropping the card.

- **Capture a paragraph text snapshot when a Mode-A link is written.** In
  `makeAnchorLink` / `addTextObjectLink` (`links.ts:1113-1183`), for the
  `"paragraph"` path also record a snapshot (e.g. extend the anchor with an
  optional `paragraphSnapshot`, or reuse `textRange.textSnapshot` populated from
  the anchored paragraph's text at write time). Both the normal-anchor path and
  the drop re-anchor flow through `addTextObjectLink`, so **one change covers both
  symptoms**.
- **Add a Mode-A pass to the reload reconcile.** Extend
  `EditorLayout.tsx:3163-3214` to also collect Mode-A cards and, for each whose
  stored `textObjectIds[0]` does **not** resolve to a live block, run a
  **UUID-first / snapshot-fallback** rebind: re-find the paragraph by snapshot
  (reusing/generalizing `reanchorByText`'s doc walk, which already returns the
  resolved `paragraphId`), then **rewrite the card's `textObjectIds[0]` to the
  live UUID** and persist. Ordering matters — resolve by UUID first; only fall
  back to text when the UUID is absent, to avoid mis-matching duplicated text
  (`reanchorByText` uses `indexOf`, first-match-wins).
- **Optionally surface the un-resolvable residue.** When neither UUID nor snapshot
  resolves, treat the card as unanchored at the *render/derivation* layer (do not
  rely on `isUnanchored`, which only counts links). This converts silent
  disappearance into a recoverable "unanchored card" the user can re-pin.

This single change means: **any** UUID-persistence failure — lost `%!v:`, fresh
mint, external/code-pane edit, 4-char collision, container-strip — is **repaired
on load** instead of orphaning the card.

### Lever 2 — Remove the write-ordering race at the source

Make the minted paragraph UUID durable **before** (or atomically with) the card
binding to it, so Lever 1's fallback rarely needs to fire.

- **Flush the doc bundle when an anchor-mint transaction dispatches.** Gate
  strictly to genuine UUID-mint transactions (the `setNodeMarkup(... uuid)` +
  `addToHistory:false` dispatch in `hit-test.ts` / `anchor-uuid.ts`) — NOT every
  `addToHistory:false` tx, and never per-keystroke (keystroke-sanctity). On a mint
  tx, either force `debouncedSave` to fire immediately (cancel the 1500 ms timer
  and `save(getJSON())` now) or write the single paragraph's UUID into a fast
  store. The cleanest framing: a paragraph anchor mint is a **commit point** for
  the card that will reference it, so it should persist on the card's clock, not
  the doc's.
- **Write load-stamped UUIDs back to the `.tex` in FSA mode.** Bring
  `readDocBundle` (storage-fsa.ts:283-287) to parity with the dev backend
  (storage-dev.ts:241-270): after `assignUuids` on load, opportunistically write
  the re-stamped `.tex` back (guarded by the active-handle / pipeline check the
  dev path already models). This eliminates the production-only volatility window
  for every lazily-minted UUID and removes the dev-vs-prod masking.
- **Fix the container-paragraph mis-mint (new Chip-H defect).** Make
  `resolveAnchorableBlock` (`hit-test.ts:140-142`) honor `DEFERRING_PARENTS`
  exactly as `resolveAnchorableNode` does (`anchor-uuid.ts:46-48`) — defer to the
  enclosing listItem/blockquote so the minted UUID is one `assignUuids` will not
  strip. Best: have the drop path call the **same** `ensureAnchorUuid` /
  `resolveAnchorableNode` the normal anchor path uses, collapsing the two
  divergent resolvers into one SSOT.

### Why this is the deepest fix, not a patch

- It removes the **structural** fault (Mode-A anchors with no recovery + two
  uncoordinated clocks), not just the re-anchor symptom.
- It restores **symmetry** between Mode A and Mode B (both get a snapshot + a
  reconcile), which is where the model drifted.
- It collapses **two divergent anchor resolvers** (`hit-test` vs `anchor-uuid`)
  into one, and brings **two divergent backends** (FSA vs dev) to parity —
  eliminating the dev-masking that hid this from every live investigation.
- Every low-frequency member of the class (4-char collision, container-strip,
  external edit, code-pane round-trip) is covered by Lever 1's snapshot fallback
  without bespoke handling.

---

## Open verifications (make-or-break, confirm before implementing)

1. **The race, live and timed.** In **production FSA mode** (not the dev backend,
   which masks it): re-anchor a margin card onto a brand-new paragraph; dump the
   card's persisted anchor JSON (`virgil/notes.json` `textObjectIds[0]`); reload
   **fast** (~700 ms, before the 1500 ms autosave); confirm (i) the `.tex` lacks a
   `%!v:` for that paragraph, (ii) `assignUuids` minted a different UUID on load,
   (iii) the card's stored UUID now matches nothing and the marker is gone. This
   is the single make-or-break confirmation — every digest rated it
   high-confidence-but-not-reproduced (dev masking is the reason).
2. **FSA-vs-dev masking is the reason the bug "didn't reproduce."** Confirm
   `readDocBundle` in `storage-fsa.ts:283-287` has no writeback while
   `storage-dev.ts:241-270` does. (Read directly during synthesis — both
   confirmed. Re-confirm there is no other FSA writeback path on load before
   relying on it.)
3. **Symptom (b) on a card the user did NOT re-anchor.** Capture a properly
   Mode-A-anchored card's UUID before reload, and confirm after a fast reload in
   FSA mode that the *original* paragraph's UUID changed (i.e. its `%!v:` was
   never persisted because the block was never autosaved after lazy minting). This
   distinguishes (b) = first-persist race from (b) = some other loss.
4. **Mode A really has no reconcile record.** Confirm `getTextAnchor` returns null
   for a Mode-A card so the `EditorLayout.tsx:3163-3214` loop skips it. (Read
   directly — confirmed: `getTextAnchor` gates on `targetKind === "linkedRange"` +
   `textRange`, `links.ts:1014-1031`.)
5. **`addToHistory:false` mint arms the autosave (so the bug is purely the race,
   not a missing event).** Confirm in the live preview via `__virgilBusStats()` /
   the doc-version counter that an anchor-mint tx advances the doc version and
   schedules a save. (Static-confirmed via `@tiptap/core` 5092 + the EditorPane
   forward; live-confirm before assuming the autosave fires for the hover mint.)
6. **Container-paragraph mis-mint is real and deterministic.** Re-anchor a card
   into a list item / blockquote in FSA mode, save, reload; confirm the inner
   paragraph's minted UUID was stripped by `assignUuids`
   (`latex-serializer.ts:866-869`) and the card dangles independent of timing.
7. **Snapshot fallback won't mis-match duplicated text.** Before shipping Lever 1,
   confirm the UUID-first / snapshot-second ordering and that `reanchorByText`'s
   `indexOf` first-match is acceptable (or add a disambiguator) for papers with
   repeated paragraph text.

---

## Risks

- **Forcing a doc flush on every mint could regress keystroke-sanctity/perf** if
  not gated to genuine UUID-mint transactions only. Gate narrowly; never flush on
  a plain keystroke.
- **Snapshot fallback mis-match** on duplicated paragraph text (`indexOf`
  first-match). Require UUID-first ordering; consider position/context
  disambiguation.
- **FSA load-writeback** must respect the active-handle / pipeline guard (model it
  on `storage-dev.ts`) so a read during a doc switch can't write stale content to
  the wrong file.
- **The pagehide/beforeunload flush is fire-and-forget** (`void save()` → async
  PUT/FSA write); a hard reload can cancel the in-flight write even inside the
  debounce window. Lever 1's snapshot reconcile is the safety net that makes this
  non-fatal regardless of teardown timing.
- **Multi-step structural transactions** (cf. MEMORY `atom_drag_and_observer_move_bug`):
  re-verify the exact set of kinds newly routed through the fresh-UUID mint
  (report / report-request / revision) and that a node MOVE that re-inserts an
  anchored block doesn't re-mint and drop the anchor — the observer's per-step
  mapping has bitten this before.
- **Schema migration.** Adding a Mode-A snapshot field is additive (old links lack
  it and fall back to UUID-only resolution), but the reconcile must tolerate
  snapshot-less legacy Mode-A links — they keep today's behavior until re-written.

---

## Where to make the changes (fix sites)

- `src/links/links.ts` — `makeAnchorLink` / `addTextObjectLink` (`:1113-1183`):
  capture a paragraph text snapshot on the Mode-A path. `getTextAnchor`
  (`:1014-1031`) / add a Mode-A snapshot accessor for the reconcile.
- `src/components/EditorLayout.tsx` (`:3163-3214`): add a Mode-A reconcile pass
  (UUID-first, snapshot-fallback rebind + persist).
- `src/links/links.ts` `reanchorByText` (`:910-963`): generalize / reuse its
  snapshot→`{from,to,paragraphId}` resolution for the Mode-A rebind.
- `src/components/drop-mode/hit-test.ts` (`:140-157`): honor `DEFERRING_PARENTS`
  (or delegate to `anchor-uuid.ts:resolveAnchorableNode`); force a doc flush on
  the mint dispatch.
- `src/hooks/useDocument.ts` (`:261-288`): expose an immediate-flush entry point
  for anchor-mint transactions.
- `src/lib/storage-fsa.ts` (`:283-308`): write load-stamped UUIDs back to the
  `.tex` (parity with `storage-dev.ts:241-270`), guarded by the active-handle
  check.
- `src/links/links.ts` `isUnanchored` (`:1093-1100`) / `useInTextPositions.ts`
  (`:25-46`): surface an un-resolvable Mode-A card as unanchored instead of
  silently dropping it.
