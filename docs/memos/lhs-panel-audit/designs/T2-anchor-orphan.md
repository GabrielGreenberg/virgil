# T2 — Anchor & orphan lifecycle + cross-surface reconciliation

> Deep-fix design for one theme of the LHS-panel fix sweep. Design only — no source edits.
> Author: T2 architect · 2026-06-16 · against `HEAD` 7e47f91.

---

## 1. Scope

**Theme.** The lifecycle and cross-surface reconciliation of *inline-atom anchor state* — the question "for a footnote / citation (and, by extension, example) card, where does it live: anchored in the doc, deliberately free, or orphaned (its marker is gone)?" — and the integrity of every store that mirrors that fact (the editor doc, the per-kind sidecar, the orphan-recovery collection, the global `cardStore` selection/hover/expand slots, and the `poppedOutCards` float store).

Four sub-clusters from `CLASSES.md`, plus one new finding:

- **C14** — Inline-atom prune-exemption leaves a dangling `cardStore` / float ref after delete (10 bugs).
- **C3** (orphan subset) — Shell-state-with-no-sidecar: `orphanedFootnotes` lost on reload, bleeds across docs (3 bugs in scope; the 2 example-sidecar members are out of scope, §6).
- **C19** — Anchor-state inferred from position alone, ignoring the card's intent flag → *free* and *orphaned* conflated (4 bugs).
- **FN-A1-03** (NEW, introduced by this design) — undo restoring a deleted footnote atom does **not** clear its orphan record, so the atom is simultaneously anchored *and* orphan → repeated React duplicate-key (`f007`) errors.

**Full list of bug ids this theme resolves (18):**

| Class | Bug ids |
|---|---|
| C14 | CI-F8-01, FN-F8-01, OMNI-F8-01, CI-F2-02, CI-F7-03, CI-F8-02, EX-F8-01, FN-A1-01, FN-F3-01, OMNI-F7-02 |
| C3 (orphan subset) | FN-A2-01 (DATA-LOSS), FN-A2-03, FN-F5-02 |
| C19 | EX-F3-01, CI-A1-02, EX-A1-01, OMNI-A2-01 |
| New | FN-A1-03 |

Adjacent ids that fall out for free or are explicitly deferred are catalogued in §6.

---

## 2. Root diagnosis — the single underlying architectural deficiency

> **There is no single owner of inline-atom liveness, and no single derivation of anchor-state.** Five stores each independently *mirror* "does this footnote/citation/example exist and where" — the editor doc, the per-kind sidecar (`footnotes.json` / citations state), the `orphanedFootnotes` shell collection, the global `cardStore` (selection/hover/expand), and the `poppedOutCards` float store — and they are reconciled (if at all) by **ad-hoc, per-trigger, per-store event seams** rather than from the one authoritative liveness signal the codebase already publishes: the `DocStructureObserver`'s per-transaction `addedFootnotes` / `removedFootnotes` / `addedCitations` / `removedCitations` diff.

The deficiency has two faces, and every bug in the theme is one of them:

### 2a. Liveness has no owner → stores drift out of sync

The dangling-ref pruner ([`useAnchorHighlightReconciler.ts:84-90`](../../../src/links/_shared/useAnchorHighlightReconciler.ts)) **explicitly opts inline atoms out** of its liveness check:

```ts
function entityExists(ref: AnchoredCardRef, c: EntityCollectionSlots): boolean {
  if (isInlineAtomCardKind(ref.kind)) return true; // ← footnote/citation: never pruned
  return findEntity(ref, c) !== undefined;
}
```

The exemption is *defensible in isolation* — footnotes/citations aren't in `collections`, so `findEntity` can't see them, and a transient re-parse gap must not drop a valid selection (`predicates.ts:113-117`). But the consequence is that the pruner — the one component whose job is "clear `cardStore` refs to cards that no longer exist" — is structurally blind to the exact two kinds whose existence is most volatile (the user backspaces over a marker). So:

- A hard-deleted footnote/citation leaves a dangling `cardStore.selected` / `hover` / `expandedSet` ref → stale halo on an unrelated card, and an id-reuse mis-paint window (**CI-F2-02, CI-F8-02, FN-A1-01, FN-F3-01, OMNI-F8-01, OMNI-F7-02, CI-F7-03**).
- The `poppedOutCards` float store has *no pruner at all* for inline atoms (only `useTransientAnchorCleanup` handles `linkedRange`), so a popped float whose atom is deleted leaks its key and silently blanks (**CI-F8-01, FN-F8-01, EX-F8-01**).

The orphan-recovery collection has the *mirror-image* version of the same disease. `orphanedFootnotes` is reconciled by a hand-wired tangle of four `window` CustomEvents (`footnote-sync.ts`): added on `virgil-footnote-orphaned`, cleared on `virgil-footnote-panel-dropped`, suppressed via a `suppressOrphanRef` latch armed by `virgil-footnote-suppress-orphan`. This event web covers exactly the paths someone remembered to wire:

- It does **not** cover undo. The orphan detector ([`footnote.ts:196-214`](../../../src/lib/tiptap/footnote.ts)) fires `virgil-footnote-orphaned` only on `diff.removedFootnotes`. **Undo re-inserts the atom — `diff.addedFootnotes` — and nothing listens for that to clear the orphan record.** The atom is back (anchored, in `footnotes`) while the orphan record persists (in `orphanedFootnotes`); `FootnotePanel` merges the two lists keyed by `footnoteId` with no de-dup ([`FootnotePanel.tsx:112-126`](../../../src/panels/Footnotes/FootnotePanel.tsx)) → **two cards with key `f007` → React duplicate-key crash (FN-A1-03)**. Pre-fix this was confined to the Omni column (read live list); post the card-source-counter work it now also surfaces in the docked Footnotes panel.
- `orphanedFootnotes` lives at the `EditorLayout` shell (`EditorLayout.tsx:1064`), **above** the `<DocPipeline key={currentDocId}>` per-doc remount boundary, with **no sidecar and no docId-reset effect** → lost on reload (**FN-A2-01, DATA-LOSS**), bled across documents (**FN-A2-03**), and orphan body/title edits are volatile (**FN-F5-02**).

Citations have *no orphan model at all*: `deleteCitation` is a sidecar filter, and a marker deleted in-text leaves a dead dashed card the mount-only `syncFromEditor` won't reconcile until reload — the same liveness-has-no-owner gap, just with the recovery half missing entirely.

### 2b. Anchor-state has no single derivation → free vs orphaned conflated

Every omni/panel builder *re-derives* anchor-state locally, from position resolution alone:

```ts
// src/panels/Citations/omni.tsx:49
anchorState: pos == null ? "orphaned" : "anchored",
```

It never consults the card's own intent. `CitationRef.unanchored` ([`types.ts:325`](../../../src/lib/types.ts)) records "the user made this in the panel and hasn't placed it yet" — a deliberately **free** card — but the builder collapses it into the red-error **orphaned** bin alongside a genuinely lost marker (**CI-A1-02, OMNI-A2-01**). Examples carry the dual sin: `card-registry` marks them `anchored:true` but they have neither a Mode-A/Mode-B link nor a synthesized inline-atom link the reconciler can resolve, so selecting one paints nothing in-text (**EX-F3-01**), and because examples are derived purely from live nodes with no sidecar that outlives the block, an example can never even *be* an orphan (**EX-A1-01**).

The `OmniItem.anchorState` union **already declares all three states** — `"anchored" | "free" | "orphaned"` — and `OmniViewPanel` **already bins and badges them differently** (free → plain card, orphaned → red `BadgeOrphaned`; `OmniViewPanel.tsx:405-428`). The model exists at the type and render layers; only the *derivation* is missing and duplicated. That is the smoking gun that this is a one-owner problem, not N builder bugs.

**Both faces share one missing abstraction: a single function that, given a card ref and the live structure, returns its anchor-state — and a single reconciler that fires off the `DocStructureBus` to keep every mirror store consistent with that answer.**

---

## 3. The deep solution

One explicit **anchor-state model** owned in one place, fed by the **one authoritative liveness signal** (the `DocStructureBus`), driving **one reconciler** that keeps every mirror store (sidecar, orphan record, `cardStore`, `poppedOutCards`) consistent — and a **durable home** for orphan state.

### 3a. The `AnchorState` model — one type, one resolver (new: `src/links/anchor-state.ts`)

```ts
export type AnchorState = "anchored" | "free" | "orphaned";

/** The SSOT anchor-state derivation. `pos` is the resolved live doc position
 *  (null ⇒ no live marker); `intent` is the card's own declared intent
 *  (unanchored flag / "never placed"). Replaces every inline
 *  `pos == null ? "orphaned" : "anchored"` site. */
export function resolveAnchorState(
  pos: number | null | undefined,
  intent: { unanchored?: boolean } | null | undefined,
): AnchorState {
  if (pos != null) return "anchored";
  return intent?.unanchored ? "free" : "orphaned";
}
```

This is the single derivation §2b was missing. Builders stop branching on `pos` and call `resolveAnchorState(pos, cit)`. It composes with the existing `isUnanchored(card)` predicate in `links.ts` (which already reads `unanchored` + empty-`links`), so the *intent* half has one reader too.

For **examples** (EX-F3-01 / EX-A1-01): an example's intent is "always in-text" (no free mode) and its liveness is the live `exampleBlock` node. The example builder synthesizes an inline-atom-style link (mirroring `linkForInlineAtom`) so the reconciler can paint its in-text block on select, and `resolveAnchorState(pos, null)` yields `anchored` (block present) or `orphaned` (block gone) — giving examples the orphan affordance they structurally lacked, *once examples gain a sidecar* (that sidecar is T-other's `useExamples` revival; this design only consumes it — see §6/§8).

### 3b. `useInlineAtomLifecycle` — the one reconciler (new: `src/links/_shared/useInlineAtomLifecycle.ts`)

A single hook mounted once per pane (in `EditorPane`, beside `useAnchorHighlightReconciler`). It subscribes to the `DocStructureBus` liveness events — `onFootnotesAdded` / `onFootnotesRemoved` / `onCitationsAdded` / `onCitationsRemoved` — and on each event reconciles **all four mirror stores** against the live atom-id set. This is the owner §2a was missing. Per fire it is O(added+removed atoms), never O(doc) — keystroke-safe by construction (a plain keystroke emits none of these events; verified via `window.__virgilBusStats()`).

Responsibilities, all driven from the same diff:

1. **Orphan record reconciliation (kills FN-A1-03 by construction).**
   - `onFootnotesRemoved` → for each removed id whose dying node had non-empty body/title, *upsert* an orphan record (replacing the deferred `virgil-footnote-orphaned` event path and the `setTimeout(0)` in `footnote.ts`).
   - **`onFootnotesAdded` (and re-anchor) → delete any orphan record whose `footnoteId` is now present in the live doc.** This is the missing edge. Undo, redo, panel re-drop, drag-re-anchor, and code-view re-insert *all* route through `addedFootnotes`, so *one* subscription closes every "atom came back" path at once — the orphan record can never coexist with a live atom. The `suppressOrphanRef` latch and the `virgil-footnote-panel-dropped` / `virgil-footnote-suppress-orphan` events are **deleted**: a deliberate trash-delete no longer needs a latch because the orphan record is gated on the *body-has-content* test at upsert time, and the re-anchor clear is now unconditional from `addedFootnotes`. (Deliberate delete of an empty footnote → no orphan; deliberate delete of a footnote with content → orphan record, which is the correct recoverable behavior, matching FN-A1-02's fix that emptiness must also count the `title` attr.)
   - The orphan-upsert clones the **full attr set** (not just `content`) — folding in **FN-A2-02**: title + `thanks` survive orphaning. `OrphanedFootnote` gains a `thanks?: boolean` field.

2. **`cardStore` dangling-ref prune for inline atoms (kills C14's selection half).** The reconciler now knows the live atom-id set, so `entityExists` for a footnote/citation is answerable: `liveAtomIds.has(ref.id)`. On `onFootnotesRemoved` / `onCitationsRemoved`, if `cardStore.selected` / `hover` / an `expandedSet` entry points at a removed inline atom **and** that id is *not* an orphan record (i.e. it's a genuine vanish, not a recoverable orphan), clear it. Because the prune is event-driven off the *real* removal — not a collection-identity change the inline kinds never participate in — the §2a exemption is no longer needed as a blanket `return true`. `isInlineAtomCardKind` stays (it's a legitimate registry predicate) but the reconciler's `entityExists` consults the live atom set for those kinds instead of short-circuiting.

3. **`poppedOutCards` float prune for inline atoms (kills C14's float half — CI-F8-01, FN-F8-01, EX-F8-01).** On removal of an atom whose float key (`float:card:footnote:<id>` / `…:citation:<id>` / `…:example:<id>`) is open, close the float — *unless* the kind has a recoverable orphan record, in which case the float is re-pointed to render the orphan body (so a popped footnote that becomes an orphan keeps showing its text rather than blanking — the `EX-A1-02` / `OMNI-A1-01` "missing-state banner" UX, generalized). This is the float-store analogue of `useTransientAnchorCleanup`, and is implemented in the same shape (diff the prev/next open-key set against liveness).

4. **Citation sidecar liveness (closes the citation orphan gap, CI-A1-01-adjacent).** On `onCitationsRemoved`, mark the matching `CitationRef` as `unanchored`-cleared / pruned per the sidecar's contract, so a marker deleted in-text doesn't strand a dead dashed *anchored* card. (This is the resync the mount-only `syncFromEditor` never re-ran; it's also where T1's id model lands — see §8.) Combined with `resolveAnchorState`, a deleted-marker citation now shows correctly as orphaned, and a panel-created one as free.

### 3c. Durable orphan state (kills C3 orphan subset)

`orphanedFootnotes` moves from the `EditorLayout` shell into a **per-doc sidecar hook**, `useOrphanedFootnotes(docId)` (new: `src/hooks/useOrphanedFootnotes.ts`), persisted to `virgil/orphaned-footnotes.json`, modelled exactly on `useFootnotes` (load-on-docId, debounced `writeSidecar`, stale-pipeline-guarded `persist`). Because it keys on `docId` and lives under the `<DocPipeline>` boundary, reload-loss (**FN-A2-01**) and cross-doc bleed (**FN-A2-03**) both vanish, and orphan body/title edits persist (**FN-F5-02**). The `useOrphanActions` handlers (`orphans.ts`) re-target this hook's setters instead of the shell `useState`.

> **Why a sidecar, not "lower the state under the key":** the audit's fix-locus offered either option. A sidecar is the deeper choice because it makes orphaned footnotes *searchable and AI-addressable* (SR-A1-01/SR-F7-01, a sibling theme, want exactly this data source on disk), and it lets a skill recover a lost footnote — consistent with Virgil's "agents read the same files" principle. Lowering to volatile per-doc state would fix reload-loss but leave the data invisible to everything outside the React tree.

### 3d. How it captures the whole range

Every bug reduces to one of the two faces, and each face now has exactly one owner:

- All C14 selection/float ghosts (10) ← the reconciler prunes `cardStore` + `poppedOutCards` from the *real* removal event (§3b.2, §3b.3).
- All C3 orphan losses (3) ← durable sidecar (§3c).
- All C19 conflations (4) ← `resolveAnchorState` + the example synthesized link (§3a).
- FN-A1-03 ← `onFootnotesAdded`-driven orphan clear (§3b.1) makes "anchored + orphan simultaneously" *unrepresentable*: the reconciler runs in the same `appendTransaction`-adjacent tick, so the orphan record is gone before the panel re-derives.

### 3e. How it improves the app beyond fixing bugs

- **Collapses an event web into one subscription.** Three `window` CustomEvents + a cross-component ref latch (`virgil-footnote-orphaned`, `-suppress-orphan`, `-panel-dropped`, `suppressOrphanRef`) are deleted, replaced by one bus-driven hook. The decoupling seam those events existed to bridge (detector in PM-land, state in EditorLayout) is exactly what the `DocStructureBus` is *for* — this removes a parallel, ad-hoc event bus.
- **Symmetry for citations.** Citations gain the orphan/liveness model footnotes had piecemeal, so the two intrinsically-in-text kinds finally behave identically — eliminating a whole row of "footnote does X but citation doesn't" audit siblings.
- **One place to reason about anchor-state.** Future kinds (any inline atom) get correct free/orphaned/anchored binning and float pruning by registering with the reconciler, not by re-implementing `pos == null ? …` and forgetting the float store.
- **Aligns with keystroke-sanctity doctrine.** It converts the last big "liveness via remember-to-fire-an-event" tangle into a "consume the structural diff" consumer, the pattern AGENTS.md mandates.

### 3f. The shallow patches being rejected

- *FN-A1-03 quick patch:* "de-dup the merged list in `FootnotePanel`." Hides the crash but leaves the orphan record permanently stale (it'll resurface in Omni, search, and any future consumer; the record is still wrong on disk-to-be). Rejected — treats the symptom (duplicate key) not the cause (no clear-on-re-anchor owner).
- *C14 quick patch:* "add `clearSelection()` calls into each per-kind delete handler." Re-introduces the per-kind delete-knows-about-cardStore coupling the reconciler was *built to remove* (its own doc-comment, lines 28-33), misses the float store entirely, and misses non-handler removals (undo, code-view, multi-step moves — see the `atom_drag_and_observer_move_bug` memo). Rejected.
- *C19 quick patch:* "change the one line in `omni.tsx` to read `cit.unanchored`." Fixes citations only; examples (EX-F3-01) and the next inline kind stay broken, and the derivation stays duplicated. Rejected in favor of the shared resolver.
- *C3 quick patch:* "lower `orphanedFootnotes` under the DocPipeline key." Fixes reload-loss but not the durability/search/AI-recovery goals, and leaves the undo/clear bug untouched. Rejected for the sidecar.

---

## 4. Data-model / schema / sidecar changes + migration

All additive and back-compatible.

### 4.1 New sidecar: `virgil/orphaned-footnotes.json`
```jsonc
{ "version": 1,
  "orphans": [
    { "footnoteId": "f007", "content": {/* TipTap JSON */},
      "title": "Methodology note", "thanks": false,
      "orphanedAt": "2026-06-16T…Z" } ] }
```
- **Migration / back-compat:** absent file ⇒ `{ version: 1, orphans: [] }` (existing papers just start empty — orphans were never durable before, so there's nothing to migrate *from*; no data regresses). Reader (Library) opens read-only ⇒ hook no-ops its writes (same `getActiveHandle` / stale-pipeline guard as `useFootnotes`).

### 4.2 `OrphanedFootnote` type (`src/lib/types.ts:564`)
Add `thanks?: boolean` (folds FN-A2-02). Existing fields unchanged; `title?` already present.

### 4.3 `OmniItem.anchorState` — **no schema change needed**
The `"anchored" | "free" | "orphaned"` union and the binning/badging already exist (`panels/_shared/types.ts:54`, `OmniViewPanel.tsx:405-428`). This design is the *first consumer* to emit `"free"` for citations/examples — the approved "first-class free citation anchor-state + theme" is realized by **using** the existing slot, not adding one. (If a distinct *visual theme* for free-vs-orphaned is desired beyond "plain card vs red badge", that's a `CARD_THEMES.free` token addition in `panel-primitives` — a one-line theme add, flagged for the PLAN as the cosmetic half of the approved schema change.)

### 4.4 `CitationRef` (`types.ts:312`)
No field change. `cloneCitation` is corrected to set `unanchored: true` on the clone (folds **CI-A3-01**) so a cloned-without-atom citation is a *free* card, not a phantom GC'd on reload.

> **Versioning note for the PLAN:** `orphaned-footnotes.json` carries an explicit `version: 1`. The `findings-index` shows no existing versioned-sidecar convention here, so this establishes one for the orphan store; reconcile the `version` key name with whatever T-other sidecars (examples) adopt so the family is uniform.

---

## 5. Files

### Created
- `src/links/anchor-state.ts` — `AnchorState` type + `resolveAnchorState()` resolver (§3a).
- `src/links/_shared/useInlineAtomLifecycle.ts` — the one bus-driven reconciler (§3b).
- `src/hooks/useOrphanedFootnotes.ts` — per-doc durable orphan sidecar hook (§3c).
- `src/links/_shared/__tests__/useInlineAtomLifecycle.test.tsx` — reconciler unit/integration tests (§7).
- `src/hooks/__tests__/useOrphanedFootnotes.test.ts` — persistence + docId-reset tests.

### Modified
- `src/links/_shared/useAnchorHighlightReconciler.ts` — `entityExists` consults the live atom-id set for inline kinds instead of `return true` (§3b.2); the dangling-prune `useEffect` either delegates to or is merged with `useInlineAtomLifecycle`.
- `src/components/editor-layout/event-bridges/footnote-sync.ts` — **delete** the orphan/suppress/panel-dropped CustomEvent web; keep only `virgil-footnote-consumed-archive` (unrelated). Or delete the hook and re-home the archive bridge.
- `src/components/editor-layout/card-actions/orphans.ts` — `useOrphanActions` re-targets the sidecar hook setters.
- `src/lib/tiptap/footnote.ts:196-214` — remove the `setTimeout(0)` `virgil-footnote-orphaned` dispatch (the reconciler now derives orphan upserts from the bus diff directly); the orphan detector logic moves to the reconciler.
- `src/components/EditorLayout.tsx:1064-1065,2438,2522,2779,2849` — remove shell `orphanedFootnotes` `useState` + `suppressOrphanRef`; source from the per-doc hook under the `<DocPipeline>` boundary; drop the `useFootnoteSyncBridges` orphan args.
- `src/components/EditorPane.tsx:1188-1193,2788-2802,5075,5429,5599` — mount `useInlineAtomLifecycle`; remove the `virgil-footnote-suppress-orphan` dispatch in `handleDeleteFootnote`; thread the durable orphan list from the hook; citation `syncFromEditor` resync (already partly counter-gated work — coordinate with T1/C17).
- `src/panels/Citations/omni.tsx:49` — `anchorState: resolveAnchorState(pos, cit)`; pass `isAnchored`/`anchorState` consistently.
- `src/panels/Examples/omni.tsx` (+ `ExampleCard` synthesized link) — emit `anchorState` via the resolver; synthesize the inline-atom-style link so EX-F3-01 paints in-text (consumes T-other's example sidecar for EX-A1-01).
- `src/lib/types.ts:564` — `OrphanedFootnote.thanks?`.
- `src/hooks/useCitations.ts:229-246` — `cloneCitation` sets `unanchored: true` (CI-A3-01).
- `src/panels/Footnotes/FootnotePanel.tsx:112-126` — keep the merge but it's now provably duplicate-free; add a dev-assert de-dup guard as a belt-and-suspenders + count fix coordination (C25 sibling, FN-C1-01 noted §6).

---

## 6. Bugs resolved + not covered

**Resolved (18):**
`CI-F8-01, FN-F8-01, OMNI-F8-01, CI-F2-02, CI-F7-03, CI-F8-02, EX-F8-01, FN-A1-01, FN-F3-01, OMNI-F7-02` (C14) · `FN-A2-01, FN-A2-03, FN-F5-02` (C3 orphan subset) · `EX-F3-01, CI-A1-02, EX-A1-01, OMNI-A2-01` (C19) · `FN-A1-03` (new).

**Falls out for free (bonus, fold in):** **FN-A2-02** (full-attr orphan clone — §3b.1/§4.2), **CI-A3-01** (clone marks unanchored — §4.4), **FN-A1-02** (empty-gate counts title — the orphan-upsert content test, §3b.1).

**In-scope-adjacent but NOT covered here (and why):**
- **CI-A1-01 / CI-A2-02 / CI-F8-03 (C17 — mount-only citation `syncFromEditor`).** This design *consumes* a bus-driven citation resync (§3b.4) but the canonical fix locus is C17's `syncFromEditor` rewiring. **Shared boundary with C17 — flag to PLAN; T2 must not double-own the citation resync.** I'll land the liveness-prune; C17 lands the add/resync.
- **EX-A1-01 / EX-F5-01 / EX-F7-01 (examples sidecar revival, C3 example subset).** EX-A1-01's orphan affordance is *unlocked* by this design's reconciler but *requires* the dead `useExamples` sidecar to be wired (a different theme owns that hook revival). T2 provides the anchor-state + reconciler hooks; the sidecar wiring is a dependency (§8).
- **FN-C1-01 / FN-F1-03 / FN-F2-02 (C25/C15 — header count + keyboard cycle over orphans).** The duplicate-key fix touches the same `FootnotePanel` merge site; the count/cycle bugs are a separate class (count the union, route orphans through `useCycle`). Coordinate the edit but they're owned by C25/C15.
- **OMNI-A1-01 (orphan halo missing `data-card-key` on the orphan render path).** A `FootnoteCard` render-attr omission, not a lifecycle bug; out of scope (C14-adjacent but a missing attribute, not a dangling ref).

---

## 7. Keystroke-sanctity + test impact

**Invariants touched / preserved:**
- **Keystroke sanctity is strengthened.** The reconciler is a *new* `DocStructureBus` consumer, O(added+removed atoms) per fire, zero on a structurally-null keystroke. It must NOT be an `editor.on('update')` subscriber — it subscribes to the bus's typed `onFootnotes*`/`onCitations*` events only. Verify with `window.__virgilBusStats()`: typing N plain chars leaves `emitCount` flat and triggers no orphan-store / cardStore / float write. Add this to the keystroke-sanctity sweep list in AGENTS.md (one new permitted consumer, with the O(diff) justification).
- **Initial-population rule (`useStructuralRevisions` doctrine):** the reconciler must also key its initial reconcile on the reactive `editor` instance, not a counter alone (counters are silent on load). On editor mount it does one reconcile pass against the live atom set to clear any orphan record whose atom is present from the loaded doc (catches a doc saved mid-orphan-then-re-anchored externally).

**New tests:**
- `useInlineAtomLifecycle.test.tsx`: (a) **FN-A1-03 regression** — delete footnote `f007` (orphan record created) → `editor.commands.undo()` → assert orphan record cleared, panel renders exactly one `f007` card, no duplicate-key warning; (b) hard-delete footnote/citation → `cardStore.selected` cleared; (c) popped float of a deleted atom closes / re-points to orphan; (d) id-reuse: delete `c1`, add new `c1` → no stale halo; (e) plain keystroke → no reconcile (bus emitCount flat).
- `useOrphanedFootnotes.test.ts`: persist+reload round-trip; docId switch resets; read-only/Reader no-op; legacy absent-file migration.
- `anchor-state.test.ts`: `resolveAnchorState` truth table (pos×unanchored → 3 states); example/citation builders emit `"free"` for unanchored, `"orphaned"` for lost marker.

**Existing tests likely affected:**
- `footnote-orphan-suppress.test.tsx`, `footnote-orphan-suppress-integration.test.tsx` — the suppression-latch mechanism is deleted; these must be rewritten against the bus-driven model (the *behavior* — deliberate delete doesn't resurrect as orphan — must still pass, via the body-content gate, not a latch).
- `lifecycle-cascade-criterion.test.ts`, `chip8-lifecycle-perkind.test.ts`, `drop-facet-contract.test.ts` — touch `isInlineAtomCardKind` / lifecycle; verify the predicate's continued meaning (it stays; only the reconciler's *use* of it changes).
- `anchored-card-store.test.ts`, `orphan-expansion.test.tsx` — cardStore prune now reaches inline kinds; assertions about "inline atoms never pruned" must flip.

---

## 8. Cross-theme dependencies & ordering

- **SHARED with T1 — the card/citation identity + anchor model.** T1 and T2 both touch `CitationRef` identity (T1: stable surrogate id so selection/float keys survive re-parse) and anchor-state (T2: free/orphaned). **Assumption I am making, flagged for the PLAN:** T1 owns the *identity* axis (what is this card's stable key), T2 owns the *anchor-state* axis (where does it live). They meet at `useCitations.syncFromEditor` and at the `cardStore`/float keys. My reconciler's prune keys on the atom id; if T1 introduces a surrogate id, the reconciler must prune on the surrogate, not the regenerated parse id. **PLAN must reconcile: land T1's stable-id first (or co-design the key), then T2 prunes/recovers on that stable key.** If T1 does not land first, T2's float/selection prune is still correct for footnotes (their ids are sidecar-stable) but fragile for citations under re-parse — same caveat the audit already records on the citation kind.
- **DEPENDS on C17 (mount-only sync rewiring)** for the citation *add/resync* half (§6); T2 provides the *remove/orphan* half. These must not both own `syncFromEditor`.
- **DEPENDS on the examples-sidecar revival theme** for EX-A1-01's orphan record (T2 gives it the reconciler + anchor-state; the sidecar is elsewhere).
- **Independent of** the morph/aiRequest-bridge theme (C8), the contentEditable/sanitize theme (C4), and the descendants-traversal theme (C10) — though C10's recursive `findInlineAtomPos` *improves* the reconciler's in-footnote atom resolution (a nested `\cite`'s liveness); land order doesn't matter but note the synergy.
- **Ordering:** (1) T1 stable id (or co-design) → (2) T2 `anchor-state.ts` + `useOrphanedFootnotes.ts` (no dependents) → (3) T2 `useInlineAtomLifecycle` (depends on 1,2) → (4) delete the event web + EditorLayout/Pane rewire → (5) C17 citation add-resync alongside.

---

## 9. Risk + rollout

**Overall risk: MEDIUM.** Touches a hot path (per-transaction reconcile) and deletes a load-bearing event web, but every change is event-driven off an existing, well-tested bus, and the new sidecar is additive.

De-risking, incremental landing (each step independently shippable + green):

1. **`anchor-state.ts` + builder migration (LOW).** Pure, additive; flip citation/example builders to `resolveAnchorState`. Fixes C19 alone, no behavior risk (the union/binning already exist). Ship first — immediate value.
2. **`useOrphanedFootnotes` sidecar (LOW).** Re-home the existing shell state to a per-doc hook *without* changing the event web yet. Fixes C3 (reload-loss, cross-doc bleed). Verify via reload + doc-switch in the dev doc.
3. **`useInlineAtomLifecycle` reconciler (MEDIUM)** — the core. Land behind a perf-flag-style gate (`virgil:inline-atom-lifecycle`, default on in dev) so it can be A/B'd against the old event web in the preview before the web is deleted. This is where FN-A1-03 + C14 are fixed. Validate keystroke sanctity (`__virgilBusStats`) and the FN-A1-03 undo repro live (the preview can drive `editor.commands.undo()` via `preview_eval` per the editor-internals memo).
4. **Delete the event web + suppress latch (MEDIUM→LOW once 3 is proven).** Remove `virgil-footnote-orphaned/-suppress-orphan/-panel-dropped` and `suppressOrphanRef`. Gated behind 3 being on; the rewritten suppress tests pin behavior.

No big-bang. Each step is a separate commit/worktree; the gate in step 3 lets the deletion in step 4 be reverted independently if the live smoke-test (which the harness MCP can't always do — manual owed) finds a regression.

---

## 10. Implementation checklist

1. **`src/links/anchor-state.ts`** — add `AnchorState` + `resolveAnchorState`; unit test the truth table. *(verify: `anchor-state.test.ts` green)*
2. **`omni.tsx` (Citations)** — `anchorState: resolveAnchorState(pos, cit)`; **`omni.tsx` (Examples)** + `ExampleCard` synthesized link. *(verify: CI-A1-02/OMNI-A2-01 free citation renders in plain bin no red badge; EX-F3-01 example paints in-text on select)*
3. **`useCitations.cloneCitation`** — set `unanchored: true`. *(verify: clone-without-atom survives reload as free — CI-A3-01)*
4. **`src/hooks/useOrphanedFootnotes.ts`** + test — load/persist/docId-reset/read-only-noop, `version: 1`, absent-file migration. *(verify: FN-A2-01 reload round-trip; FN-A2-03 doc-switch reset; FN-F5-02 edit persists)*
5. **`OrphanedFootnote.thanks?`** (`types.ts`) + full-attr orphan clone in the reconciler. *(verify: FN-A2-02 title+thanks survive orphaning)*
6. **`src/links/_shared/useInlineAtomLifecycle.ts`** behind the gate — subscribe `onFootnotes*`/`onCitations*`; (a) orphan upsert-on-remove with body/title content gate (folds FN-A1-02), (b) **orphan clear-on-add** (FN-A1-03), (c) `cardStore` prune, (d) `poppedOutCards` prune/re-point, (e) initial mount reconcile keyed on `editor`. *(verify: full reconciler test suite green; `__virgilBusStats` flat on plain typing)*
7. **`useAnchorHighlightReconciler.entityExists`** — consult live atom set for inline kinds. *(verify: C14 selection-ghost tests flip green; halo clears on inline delete)*
8. **Mount the reconciler in `EditorPane`**, thread the durable orphan list; remove the `virgil-footnote-suppress-orphan` dispatch in `handleDeleteFootnote`. *(verify: FN-A1-03 undo repro clean in preview)*
9. **Delete the event web** — `footnote-sync.ts` orphan/suppress/panel-dropped handlers, `suppressOrphanRef`, the `footnote.ts` `setTimeout(0)` dispatch. Re-home `virgil-footnote-consumed-archive` if it survives. *(verify: rewritten suppress tests green)*
10. **`EditorLayout`** — drop shell `orphanedFootnotes`/`suppressOrphanRef`; source from the per-doc hook under `<DocPipeline>`. *(verify: no cross-doc bleed; reload-loss gone)*
11. **`FootnotePanel` merge** — keep, add dev-assert de-dup guard; coordinate count fix with C25 (FN-C1-01) if same commit. *(verify: no duplicate-key warning under undo/redo/re-drop storm)*
12. **Keystroke-sanctity sweep** — add `useInlineAtomLifecycle` to the AGENTS.md permitted-consumer list with the O(diff) rationale. *(verify: doc updated; `__virgilBusStats` evidence captured)*
13. **Remove the gate** once step 3's live smoke-test passes; manual preview walk of: delete→undo footnote, delete→re-drop footnote, pop-float→delete atom, panel-create free citation, delete-marker citation→orphaned. *(manual smoke-test owed — harness MCP cwd-drift caveat per memory.)*
