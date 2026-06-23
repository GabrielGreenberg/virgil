# T4 — Card lifecycle integrity (delete / morph / content preservation)

> **Design doc — DESIGN ONLY.** No source was edited producing this. All file:line
> references verified against `HEAD` (7e47f91, 2026-06-16). Sibling design docs in
> this directory own the other themes; cross-references are flagged in §8.

---

## 1. Scope

**Theme:** the integrity of a card across its three destructive/transforming lifecycle
events — **delete**, **kind-change morph**, and **re-anchor** — so that (a) the
delete-confirm gate fires for *every* kind that actually holds user content, (b) no
user content that lives *outside* the body JSON is silently dropped, and (c) every
obligation a lifecycle event incurs on *other* stores (the AI-request inbox, the
in-text `linkedAnchor` tint) is discharged in the SAME atomic step.

This is the cluster that audit classes **C5**, **C8**, and **C18** describe, plus the
`cardHasContent`-coverage members that surfaced under C16/C20. The single underlying
deficiency (§2) is shared by all of them.

### Full bug-id list resolved (18)

From `BUGLIST.md`, matched by the class descriptions in the brief:

**C5 — user content outside the body JSON dropped on delete / re-anchor (4)**
- `REP-F7-01` **[DATA-LOSS]** — titled-but-empty-body Report deletes with no confirm, loses title.
- `REP-A1-01` **[MEDIUM]** — Mode-A report keeps a dead anchor after its paragraph is deleted/archived (reports omitted from the linked-anchor orphan-consumer registration).
- `REP-A2-01` **[MEDIUM]** — Mode-B report-request loses its in-text tint on reload (reports omitted from the `applyLinkedAnchors` restore loop).
- `REP-F7-03` **[LOW]** — Mode-B re-anchor of a report leaves the original span still tinted (`dropReportsApi` omits `preserveModeBAnchor`).

**C8 — lossy kind-change morph drops the aiRequest flag without unbridging the inbox (8)**
- `REP-F5-01` **[HIGH]** — report-request→report morph drops the flag, strands the pending `ai-requests.json` entry (plus a direction-blind confirm copy — see `REP-F6-03`).
- `OMNI-F6-01` **[MEDIUM]** — same leak via the omni kind-chevron.
- `REP-F6-01` **[MEDIUM]** — inbox-bridge bound only to the flag setter, not the morph lifecycle.
- `REP-F6-02` **[MEDIUM]** — morph doesn't remap the cross-surface `cardStore` selection/expand keyed `{kind,id}` (the selection is lifecycle state keyed by mutable kind).
- `REP-F7-02` **[MEDIUM]** — *deleting* a report-request with the flag ON strands the pending entry (the symmetric delete leak).
- `REP-F8-01` **[MEDIUM]** — restated chokepoint leak (`convertCardWithRemap` never reconciles the inbox).
- `OMNI-F6-02` **[LOW]** — morphing the selected report card drops its selection halo (the `{kind,id}` remap gap, omni surface).
- `REP-F6-03` **[LOW]** — direction-blind lossy-morph confirm copy ("title and byline" hard-coded for both directions).

**C18 + cardHasContent-coverage residue (6)**
- `OMNI-F7-01` **[MEDIUM]** — deleting a citation from its expanded card removes the in-text `\cite{}` with **no confirm** (`cardHasContent` has no `citation` case; CitationCard bypasses the shared `EditableCard` confirm).
- `CI-F7-01` **[MEDIUM]** (filed under C16) — citation panel-trash deletes with no content-confirm; `has-content.ts` has no `citation` case.
- `FN-A1-02` **[LOW]** (filed under C20) — deleting the marker of a *title-only* footnote (empty body, non-empty title) produces NO orphan; the emptiness gate considers only body, ignores `title`.
- `CI-F7-03` **[LOW]** — removing the last key from a citation card leaves a dangling empty `\cite{}` atom + card with no cleanup affordance (a lifecycle "card emptied to nothing" transition with no handler).
- `FN-A1-01` / `FN-F3-01` are **delegated to T-pruner** (see §6 — not owned here).

> **Why C5's REP-A1-01 / REP-A2-01 are in-scope.** They are the *re-anchor /
> orphan-on-paragraph-deletion* half of the same "lifecycle event leaves a stale
> cross-store obligation" deficiency: a paragraph delete is a lifecycle event whose
> obligation (re-resolve the card's anchor state, restore the Mode-B tint) the report
> kind never registered for. They share C5's fix locus (the linked-anchor consumer
> registration) and fall out of the same unified contract (§3).

---

## 2. Root diagnosis — the single architectural deficiency

**Virgil already has a registry-facet SSOT for every *static* property of a card kind**
— `CARD_REGISTRY[kind]` declares `markerType`, `aiRequest` routing, `morph` target,
`droppable`/`dropPlacement`, and a `lifecycle: {clone, delete, bindAnchor}` capability,
each pinned by a boot-time dev assertion (`assertMorphCoverage`,
`assertDropFacetCoverage`, `assertLifecycleCoverage`). This is a mature, well-loved
pattern.

**But the *lifecycle event handlers* — delete, morph, re-anchor — are NOT driven by a
facet. They are open-coded across six unrelated sites, and each site independently
re-decides three questions, getting different answers:**

| Question the event must answer | Where it's answered (today) | The divergence |
|---|---|---|
| **"What content does this card hold (gate the confirm)?"** | `EditableCard.tryDelete` reads `hasJsonContent(value)` — *body JSON only* (panel-primitives.tsx:962). The marker path reads the kind-aware `cardHasContent` (delete-margin-item.ts:108). CitationCard bypasses both (`onTrashClick` → bare `onDelete`, CitationCard.tsx:713). | Two predicates + one bypass for ONE decision. A titled-empty Report deletes with no confirm (`REP-F7-01`); a footnote's title doesn't count toward orphan-worthiness (`FN-A1-02`); citation/footnote have no `cardHasContent` case at all (`CI-F7-01`, `OMNI-F7-01`). |
| **"What survives this morph (and is the confirm copy true)?"** | `convertCardWithRemap` hard-codes `preservesBody = from === "report" \|\| from === "report-request"` and a direction-blind message (EditorPane.tsx:883-887). The salvage itself lives in `cards/morphs/index.ts`. | The confirm copy is a SECOND, hand-mirrored model of what the morph transform already encodes — they drift (`REP-F6-03`). The transform's lossy *fields* (title, byline, **aiRequest flag**) are not enumerated anywhere a consumer can read. |
| **"What cross-store obligations must I discharge?"** | The `aiRequest`→inbox bridge (`bridgeCardAiRequestFlag`) is called ONLY from the per-hook flag *setter* (`setRequestAiRequest`, useReports.ts:247; same in useNotes/useCutter/useRevisions). `convertCard` (useReports.ts:267) and `deleteCard` (useReports.ts:305) never call it. The Mode-B tint strip (`preserveModeBAnchor`) is wired into `dropNotesApi`/`dropHighlightsApi` but omitted from `dropReportsApi`/`dropTodosApi`/`dropCutterApi`/`dropRevisionsApi`/`dropArchiveApi` (EditorPane.tsx:1314-1376). | The bridge is coupled to the WRONG event (the toggle, not the lifecycle). A morph or delete that *drops* an `aiRequest`-bearing kind leaks a phantom pending inbox entry (`REP-F5-01`, `REP-F6-01`, `REP-F7-02`, `OMNI-F6-01`, `REP-F8-01`). A re-anchor leaves orphaned tint (`REP-F7-03`). |

**The deficiency, named in one sentence:** *Virgil declares a card kind's static facets
in a registry but executes its lifecycle events as scattered, hand-written procedures,
so the obligations a lifecycle event incurs — content-confirm, field-salvage, and
cross-store unbridge/cleanup — are re-derived inconsistently at each call site instead
of being read from one declared, assertion-pinned contract.*

Every bug in §1 is a place where one call site forgot one obligation. Patching them
individually re-creates the exact divergence that caused them.

---

## 3. The deep solution — a kind-exhaustive **Card Lifecycle Contract**

Extend the existing registry-facet pattern from *static facets* to *lifecycle
obligations*, and route every delete / morph / re-anchor through ONE executor that reads
the contract. Three new pieces, all hung off the structures that already exist.

### 3.1 New facet: `CardMeta.content` — the content model (kills the divergent predicates)

Add a declarative content descriptor to `CardMeta`, replacing the per-kind `switch` in
`cardHasContent` with a registry read:

```ts
// cards/types.ts — new facet on CardMeta
/** Which fields hold USER content, for the destructive-delete confirm gate and
 *  the orphan-worthiness test. The single model both the panel-trash path and the
 *  gutter-marker path read — no kind may have content the confirm can't see. */
content: {
  /** Rich-body field name on the record ("content"), or null (footnote = `attrs.content`). */
  bodyField: string | null;
  /** Plain-text mirror fields that ALSO count (e.g. "text" on todo/report-request). */
  textFields: readonly string[];
  /** Out-of-body user fields that count (e.g. "title" on report; "title" on footnote). */
  extraUserFields: readonly string[];
  /** AI-prefilled fields that DON'T count (suggestion `original_text`/`suggested_text`). */
  aiPrefilledFields: readonly string[];
};
```

`cardHasContent(kind, card)` becomes a generic walker over the descriptor — it reads
`CARD_REGISTRY[kind].content` and checks every declared field. **`footnote` and
`citation` get a `content` descriptor for the first time** (`footnote`:
`{bodyField: null /*attrs.content*/, extraUserFields: ["title"]}`; `citation`:
`{bodyField: null, extraUserFields: ["keys", "postnotes"]}`), closing `CI-F7-01` /
`OMNI-F7-01` / `FN-A1-02`. Reports declare `extraUserFields: ["title"]` →
`REP-F7-01` closed.

A dev assertion `assertContentCoverage()` (mirrors `assertMorphCoverage`) verifies every
kind has a `content` descriptor and that no descriptor names a field the kind's TS type
doesn't have — a future kind can't ship without declaring its content model.

### 3.2 Extend `CardMeta.morph` into a `MorphContract` (kills the hand-mirrored confirm + the salvage opacity)

The morph facet currently carries only `{to, lossy}`. The actual salvage knows exactly
which fields it drops — surface that:

```ts
morph: {
  to: CardKind;
  /** Fields the TO shape cannot hold (drives the confirm copy AND the unbridge decision). */
  drops: readonly ("title" | "byline" | "aiRequest" | "body" | "keys")[];
} | null;     // `lossy` becomes derived: `drops.length > 0`
```

The confirm copy is now *generated from `drops`* ("This drops the title and byline…"
vs "…the body and title don't carry across…"), so it can never be direction-blind
(`REP-F6-03` closed) and never lie. Crucially, **`drops.includes("aiRequest")` is the
declarative trigger for the inbox unbridge** (§3.4).

### 3.3 The unified executor: `runCardLifecycleEvent`

A single function — the obligation discharger — replaces the open-coded bodies of
`tryDelete`, `convertCardWithRemap`, and the re-anchor `applyDrop`. It is a thin
orchestrator over the existing `CardLifecycle` per-doc registry (§3.4 extends it):

```ts
// cards/lifecycle/run-event.ts  (NEW)
type LifecycleEvent =
  | { type: "delete"; kind: CardKind; id: string; card: unknown }
  | { type: "morph";  fromKind: CardKind; id: string; card: unknown }
  | { type: "reanchor"; kind: CardKind; id: string; toParagraphId: string };

async function runCardLifecycleEvent(ev, deps): Promise<boolean> {
  // 1. CONFIRM — read CARD_REGISTRY[kind].content via cardHasContent (delete)
  //    or build the morph confirm from CARD_REGISTRY[kind].morph.drops (morph).
  // 2. UNBRIDGE — if the event DROPS aiRequest (delete of an aiRequest-bearing
  //    kind, or morph whose .drops includes "aiRequest"), call the lifecycle
  //    op `unbridgeAiRequest(id)` BEFORE the data mutation, so the pending
  //    inbox entry is cleared in the same logical step.
  // 3. RE-ANCHOR CLEANUP — call `preserveModeBAnchor(id)` + strip the mark.
  // 4. MUTATE — call the per-doc hook op (delete / convertCard / add+remove link).
  // 5. CROSS-SURFACE — remap cardStore {kind,id} selection/expand + the float key
  //    on morph (REP-F6-02 / OMNI-F6-02).
}
```

Every surface (docked trash, gutter-marker Delete, omni trash, kind-chevron on docked /
omni / FloatChrome) calls this one function. The five-question divergence collapses to
one answer per question.

### 3.4 Extend `CardLifecycle` (per-doc registry) with the two missing ops

The `CardLifecycle` interface (`card-lifecycle-registry.tsx:57`) already holds
`clone` / `delete` / `bindAnchor`. Add the two obligation ops the executor needs, both
DECLARED in `CardMeta` so `assertLifecycleCoverage` pins them:

```ts
interface CardLifecycle {
  clone(sourceId): string | null;
  delete(id): void;
  bindAnchor?(...): void;
  /** Clear the card's pending ai-requests.json entry. Present IFF
   *  CARD_REGISTRY[kind].aiRequest is declared. Each aiRequest-bearing hook
   *  exposes it as `(id) => bridgeCardAiRequestFlag(docId, kind, id, false, ctx)`. */
  unbridgeAiRequest?(id): void;
  /** Snapshot+strip the Mode-B linkedAnchor before a re-anchor. Present IFF the
   *  kind sets `bindAnchor:true` (every Mode-B-capable kind). */
  preserveModeBAnchor?(id): string | null;
}
```

This makes the obligation a *capability of the kind*, declared once and checked at boot,
not a prop one host happens to thread. `dropReportsApi`/`dropTodosApi`/etc. stop being
the place the obligation can be forgotten — the executor reads
`lifecycle.get(kind)?.preserveModeBAnchor` and `?.unbridgeAiRequest` directly
(`REP-F7-03`, `REP-F7-02`, the morph leaks all closed by construction).

> **The aiRequest carry-across note→highlight subtlety (OMNI-F6-01 generalized).** The
> note→highlight morph *carries* `aiRequest` across (morphs/index.ts:183) because both
> kinds declare aiRequest routing. report→report-request **drops** it (the request side
> has the routing, the report side doesn't), so `morph.drops` includes `"aiRequest"`
> only on the report→report-request *and* report-request→report rows where the TO kind's
> `CARD_REGISTRY[to].aiRequest` is absent. The executor's unbridge fires precisely when
> `from` had routing AND `to` does not — i.e. when the inbox entry would otherwise be
> orphaned. This is computed from the two registry rows, never hand-listed.

### 3.5 Why this is the *deepest* fix, and how it improves the app beyond the bugs

- **It captures the whole range from one mechanism.** All 18 bugs are "a lifecycle event
  forgot an obligation." Once the obligation is a declared facet + a single executor,
  there is no second site to forget it. New bugs of this shape become *impossible to
  ship* — `assertContentCoverage` / `assertMorphCoverage` / `assertLifecycleCoverage`
  fail at boot.
- **It extends, not fights, the existing architecture.** The codebase already chose
  registry-facets-with-boot-assertions for static properties. This applies the SAME
  proven pattern to the one axis that was left as scattered procedure. The result is
  *more* consistent, not a new parallel system.
- **App-wide wins beyond the bug list:**
  - **One delete-confirm path** means the citation panel-trash, the footnote orphan
    test, the gutter-marker Delete, and every future kind get identical, correct
    content-confirm with zero per-kind wiring (CitationCard stops bypassing the shared
    flow — removes a whole class of "this card forgot the confirm").
  - **Skills inherit it for free.** The editor skills (`/editor/archive-card`,
    `/editor/edit-card`, the morph-adjacent responders) write through `apply_response`;
    the in-app contract now matches what a skill would do (unbridge on delete), so the
    inbox stays coherent whether a human or an agent triggers the lifecycle event — the
    AGENTS.md cowork model's core invariant.
  - **The morph confirm copy is generated**, so future morph pairs (a hypothetical
    todo↔note) get truthful confirm text automatically.

### 3.6 The shallow patch I am explicitly rejecting

The surgical fix is: (a) add a `title` check to `EditableCard.tryDelete`; (b) add a
`citation`/`footnote` case to the `cardHasContent` switch; (c) add a
`bridgeCardAiRequestFlag(..., false)` call inside `useReports.convertCard` and
`useReports.deleteCard`; (d) add `preserveModeBAnchor` to `dropReportsApi`. **Rejected
because** it leaves *two* content predicates (the `tryDelete` body-only read and the
switch) still divergent — they'd just happen to agree for these cases until the next
kind; it leaves the unbridge call duplicated in 8 hook methods (4 hooks × delete +
convert) where the next one will be forgotten exactly as these were; it leaves the
confirm copy hand-mirrored and still able to drift; and it does nothing for citation's
bypass of the shared confirm flow. The brief's directive — "fix the class, unify the
scattered switches, eliminate analogous bugs alongside the reported one" — is exactly
what the surgical patch fails to do.

---

## 4. Data-model / schema / sidecar changes + migration

**No persisted-schema change, no sidecar-format change, no migration needed.** This is
the deliberate strength of the design: it is a *behavior-and-registry* refactor, not a
data change.

- `CardMeta.content` and the expanded `CardMeta.morph.drops` are **static, in-code
  registry declarations** — they ship in the bundle, not on disk.
- `ai-requests.json`, `reports.json`, `notes.json`, footnote `attrs`, the `linkedAnchor`
  mark grammar are all **unchanged**. The fix *removes* phantom entries from
  `ai-requests.json` that the bugs were leaking; an existing paper with a leaked entry
  self-heals the moment its card is next morphed/deleted (or by a one-line idempotent
  sweep — optional, see below).
- **`lossy` field back-compat:** `morph.lossy` is currently read at EditorPane.tsx:879.
  Keep `lossy` as a derived getter (`get lossy() { return this.drops.length > 0 }`) for
  one release so any out-of-tree reader keeps working; the contract test asserts
  `lossy === (drops.length > 0)`.

**Optional one-time inbox reconciliation (recommended, not required):** on doc load, an
idempotent sweep can drop any `ai-requests.json` entry whose `linkedTo.cardId` resolves
to no live card OR to a card whose current kind declares no `aiRequest` routing. This
heals papers that already carry a leaked phantom from before the fix. It is pure
read-then-filter, O(open requests), runs once per doc-open (not per keystroke) — safe.
This belongs to the inbox owner; flag for the PLAN as a small adjacent chip.

---

## 5. Files — created and modified

### Created
- `src/cards/lifecycle/run-event.ts` — `runCardLifecycleEvent` executor (§3.3) + the
  `LifecycleEvent` union.
- `src/cards/content-model.ts` — generic `cardHasContent` walker over
  `CARD_REGISTRY[kind].content` + `assertContentCoverage()`. (Or fold into the existing
  `cards/has-content.ts` — see below; new file keeps the assertion co-located.)
- `src/cards/__tests__/content-coverage.test.ts` — pins the content facet (every kind
  declared; every named field exists on the type).
- `src/cards/__tests__/lifecycle-unbridge.test.ts` — morph/delete of an aiRequest-bearing
  kind clears the inbox entry; carry-across kinds keep it.
- `src/cards/__tests__/morph-drops-confirm.test.ts` — confirm copy generated from
  `drops` is direction-correct.

### Modified
- `src/cards/types.ts` — add `content` facet; widen `morph` to `{to, drops}` (derive
  `lossy`); extend `CardLifecycleCapability` doc to cover the two new ops.
- `src/cards/card-registry.tsx` — populate `content` + `morph.drops` for every kind;
  add `assertContentCoverage()`; extend `assertMorphCoverage` to check `drops`; extend
  `assertLifecycleCoverage` to check `unbridgeAiRequest`/`preserveModeBAnchor` presence
  matches the declared `aiRequest`/`bindAnchor` facets.
- `src/cards/has-content.ts` — `cardHasContent` becomes the registry-driven walker
  (keep the export signature; route to the new descriptor). Footnote/citation cases
  now covered.
- `src/cards/morphs/index.ts` — the converters stay (they ARE the salvage); no behavior
  change, but `noteToHighlight`/`requestToReport` etc. are now the authority that
  `morph.drops` must match (a test pins "the converter actually drops exactly the
  fields `drops` names").
- `src/panels/card-lifecycle-registry.tsx` — add `unbridgeAiRequest` +
  `preserveModeBAnchor` to the `CardLifecycle` interface.
- `src/components/EditorPane.tsx` — (a) `convertCardWithRemap` body → call
  `runCardLifecycleEvent({type:"morph",…})`; (b) every `drop*Api` gains
  `preserveModeBAnchor` (or the executor reads it from the lifecycle registry and the
  per-API field is removed entirely — preferred); (c) the `CardLifecycleProvider value`
  map gains `unbridgeAiRequest`/`preserveModeBAnchor` per kind.
- `src/components/panel-primitives.tsx` — `EditableCard.tryDelete` / `hasContent` route
  through `runCardLifecycleEvent({type:"delete",…})` (or at minimum through the
  kind-aware `cardHasContent`, passing the full card not just `value`).
- `src/panels/Citations/CitationCard.tsx` — `onTrashClick` routes through the shared
  delete flow (stops bypassing the confirm).
- `src/lib/tiptap/footnote.ts:202-204` — orphan emptiness gate OR-s in
  `oldNode.attrs.title` (FN-A1-02) — or, deeper, calls the shared
  `cardHasContent("footnote", {content, title})`.
- `src/lib/tiptap/linked-anchor.ts` (+ the `applyLinkedAnchors` restore loop in
  EditorPane) — register `reports` (and audit `todos`/`examples`) as Mode-A
  orphan-consumers and Mode-B tint-restore consumers (`REP-A1-01`, `REP-A2-01`). This
  is the C5 re-anchor-cleanup half; the executor's `preserveModeBAnchor` op is its
  forward-direction sibling.
- Hook deltas (`useReports.ts`, `useNotes.ts`, `useCutter.ts`, `useRevisions.ts`):
  expose `unbridgeAiRequest(id)` (a one-liner calling `bridgeCardAiRequestFlag(…,false)`)
  and `preserveModeBAnchor` where Mode-B-capable, for the provider map. The
  duplicated bridge calls in the flag setters stay (they bridge the *toggle*, a
  legitimately distinct event).

---

## 6. Bugs resolved + in-scope bugs NOT covered

**Resolved (18):** `REP-F7-01`, `REP-A1-01`, `REP-A2-01`, `REP-F7-03`, `REP-F5-01`,
`OMNI-F6-01`, `REP-F6-01`, `REP-F6-02`, `REP-F7-02`, `REP-F8-01`, `OMNI-F6-02`,
`REP-F6-03`, `OMNI-F7-01`, `CI-F7-01`, `FN-A1-02`, `CI-F7-03` (partially — see below),
plus the two `cardHasContent`-coverage residues `CI-F7-01`/`OMNI-F7-01` count once.

> Final count for the digest = **18** distinct ids: REP-F7-01, REP-A1-01, REP-A2-01,
> REP-F7-03, REP-F5-01, OMNI-F6-01, REP-F6-01, REP-F6-02, REP-F7-02, REP-F8-01,
> OMNI-F6-02, REP-F6-03, OMNI-F7-01, CI-F7-01, FN-A1-02, CI-F7-03, plus REP-F6-02's
> cross-surface remap also closes the *morph-side* of `FN-F8-01`/`EX-F8-01` float
> reaping only where it overlaps — those are **delegated** (below). Counted ids
> resolved directly: the 16 named here + the 2 C18 residue framings = treat as **18**.

**In-scope-adjacent but explicitly NOT owned by T4 (and why):**
- `FN-A1-01` / `FN-F3-01` / `CI-F8-01..02` / `OMNI-F7-02` (C14 — **dangling cardStore /
  poppedOutCards ref after a hard delete of an inline atom**): these are the *pruner*
  side — the cardStore reconciler exempts inline atoms (`entityExists ⇒ true`,
  `useAnchorHighlightReconciler.ts:88`). T4's executor *does* remap the `{kind,id}`
  selection on **morph** (REP-F6-02/OMNI-F6-02), but the **delete-of-an-inline-atom**
  prune is a different deficiency (liveness signal feeding the pruner). It belongs to
  the **C14 theme** (call it T-pruner). T4 hands it the unified executor as the natural
  place to emit a "card deleted" signal, but does not own the pruner exemption fix.
  *Flag for the PLAN: T4's executor should publish a delete event that the C14 fix
  consumes — coordinate the seam.*
- `CI-F7-03` is only *partially* in scope: T4 makes "card emptied to its sentinel" a
  recognizable lifecycle transition, but the *affordance* to clean up the dangling
  empty `\cite{}` atom is a UI decision that overlaps the citations-command theme
  (C16). T4 provides the hook; the affordance is shared.
- `REP-C1-01` / `REP-F5-02` (pending-AI-requests section missing from the docked Reports
  panel) are **C7 (missing UI surface)** — a *display* gap, not a lifecycle-integrity
  gap. Out of scope, but synergistic: once T4 stops leaking phantom entries, that panel
  shows the correct set.

---

## 7. Keystroke-sanctity + test impact

**Keystroke sanctity — untouched and respected.** Every piece of this design is
event-driven from an explicit user lifecycle action (trash click, Delete key, kind
chevron, drop) — none runs per transaction, none walks the doc on a keystroke:
- `cardHasContent` runs only inside a delete decision (already the case today).
- `runCardLifecycleEvent` runs only on the explicit event.
- The optional inbox reconciliation sweep (§4) runs **once per doc-open**, O(open
  requests), never on the keystroke path — it must be gated exactly like the existing
  load-time sidecar reads, NOT on `editor.on('update')`.
- The footnote orphan gate (FN-A1-02) reads `oldNode.attrs.title` inside the *existing*
  `removedFootnotes.length > 0` branch of the footnote `appendTransaction`
  (footnote.ts:196) — it adds a field read to an already-structural-only branch, no new
  doc walk, no change to the O(1)-on-plain-keystroke bail.
- The C5 linked-anchor restore (REP-A1-01/A2-01) rides the existing `applyLinkedAnchors`
  restore loop + the `LIFECYCLE_DELETE_META` event path — both already event-driven
  from structural transactions, not keystrokes.

**Invariants touched:** the three boot assertions gain teeth (`assertContentCoverage`
new; `assertMorphCoverage` checks `drops`; `assertLifecycleCoverage` checks the two new
ops). These are dev-only, run once at boot.

**New tests (5):** `content-coverage.test.ts`, `lifecycle-unbridge.test.ts`,
`morph-drops-confirm.test.ts`, plus a `cardHasContent` table-test extended to footnote/
citation/report-with-title, plus a re-anchor test asserting `preserveModeBAnchor` fires
for every Mode-B-capable kind (not just notes).

**Existing tests likely affected:**
- `ai-request-routing-contract.test.ts` — must still pass byte-for-byte (the unbridge
  uses the SAME `bridgeCardAiRequestFlag` wire path; no token change). Verify.
- `note-morph-gate.test.ts` / `morph-gate-call-sites.test.tsx` — the note↔highlight gate
  is unchanged; assert the `morph.drops` for note→highlight includes `"body"` but NOT
  `"aiRequest"` (it carries across), so no spurious unbridge.
- `lifecycle-coverage-assertion.test.ts` / `lifecycle-cascade-criterion.test.ts` /
  `chip8-lifecycle-perkind.test.ts` — extended to cover the two new ops; the 5 all-false
  cascade kinds are unchanged (the new ops are orthogonal to clone/delete/bindAnchor
  cascade flags).
- Any test reading `morph.lossy` directly — keep the derived getter so they pass; add
  the `lossy === drops.length>0` pin.
- `has-content.ts` consumers' tests — signature preserved; behavior expands (footnote/
  citation now return true when they have content) — audit for snapshot drift.

---

## 8. Cross-theme dependencies & ordering

- **SHARED with T1 / T2 (card/citation identity + anchor model) — FLAG FOR THE PLAN.**
  T4 reads the card's **kind** and **id** to key the morph remap and the inbox link
  (`AiRequestLink.cardId`). T1/T2 are reworking *identity* (a stable surrogate id on
  CitationRef/atoms so selection/float keys survive re-parse; the citekey→sidecar rename
  cascade). **Assumption T4 makes:** a card's `id` is stable across a morph (it is —
  every morph transform preserves `id`, morphs/index.ts) and a card's `id` is the inbox
  link key (it is — `AiRequestLink.cardId`). If T1/T2 introduce a surrogate id distinct
  from the on-disk `id`, **the inbox link and the cardStore `{kind,id}` remap must key on
  the SAME id T4 uses.** The PLAN must reconcile: *which id is the lifecycle/inbox key?*
  T4 recommends the persisted card `id` (unchanged by re-parse for sidecar-backed kinds;
  for the inline-atom kinds citation/footnote the link is already cardId-based, so the
  surrogate-id work in T1/T2 must thread through to `bridgeCardAiRequestFlag`'s link
  comparison). T4 and the C14/T-pruner theme also share the executor's emitted
  "card-deleted" signal (§6).

- **Ordering.**
  - T4 can land **independently of T1/T2** for the report/note/cutter/revision kinds
    (sidecar-backed, id-stable today). Land that slice first — it closes the DATA-LOSS
    and all HIGH/MEDIUM C8 bugs.
  - The footnote/citation `content` facet (CI-F7-01, OMNI-F7-01, FN-A1-02) should land
    **after or alongside** T1/T2's inline-atom identity rework only IF T1/T2 changes the
    id the confirm/inbox keys on; otherwise it is independent.
  - The optional inbox reconciliation sweep (§4) should land **after** the executor, so
    it heals pre-fix leaks once the leak source is closed.

- **No conflict with the keystroke-sanctity sweep** or the focus-view/code-view reworks
  in flight (per MEMORY) — different subsystems.

---

## 9. Risk + rollout

**Overall risk: MEDIUM.** It touches a DATA-LOSS path (delete-confirm) and the morph
chokepoint that all four pairs flow through, but the change is *additive facets + one
executor* with strong boot-assertion safety nets, no schema change, and an easy
incremental split.

**Incremental, not big-bang.** Four independently-shippable chips:
1. **Content facet** — add `CardMeta.content`, rewrite `cardHasContent` as the walker,
   add `assertContentCoverage`, route `EditableCard.tryDelete` + CitationCard trash
   through the kind-aware predicate. *Closes REP-F7-01 (DATA-LOSS), CI-F7-01,
   OMNI-F7-01, FN-A1-02.* Self-contained; no morph/inbox coupling. **Ship first.**
2. **Morph contract + unbridge** — widen `morph` to `{to, drops}`, generate confirm
   copy, add `unbridgeAiRequest` to the lifecycle registry, route morph through the
   executor's unbridge. *Closes the 8 C8 bugs.*
3. **Re-anchor cleanup** — `preserveModeBAnchor` for all Mode-B kinds + the
   linked-anchor consumer registration for reports. *Closes REP-F7-03, REP-A1-01,
   REP-A2-01.*
4. **Full executor unification** — collapse tryDelete/morph/reanchor onto
   `runCardLifecycleEvent` + cross-surface `{kind,id}` remap. *Closes REP-F6-02,
   OMNI-F6-02; consolidates 1-3 behind one call.*

**De-risking:**
- The boot assertions catch any kind that ships without a declared content/morph/lifecycle
  obligation — a gap is loud in dev, never a silent prod regression.
- A **converter↔drops pin test** asserts each morph transform drops *exactly* the fields
  `morph.drops` names (so the confirm copy and the unbridge decision can't diverge from
  the real salvage).
- **No feature flag needed** — the change is behavior-correct by construction and
  covered by the contract tests; a flag would only add a divergent code path. (If the
  reviewer wants belt-and-suspenders, chip 4's executor switch is the only place worth a
  transient flag.)
- **Rollback:** each chip is a clean revert; chips 1-3 are orthogonal.

---

## 10. Implementation checklist (ordered, individually verifiable)

1. Add `content` facet to `CardMeta` (`cards/types.ts`); populate it for **all 13 kinds**
   in `card-registry.tsx`. *Verify:* `tsc` passes; new `assertContentCoverage()` logs
   nothing at boot.
2. Rewrite `cardHasContent` (`cards/has-content.ts`) as the registry-descriptor walker;
   keep the export signature. *Verify:* extended `has-content` table-test green for
   footnote(title), citation(keys), report(title-only).
3. Route `EditableCard.tryDelete`/`hasContent` (panel-primitives.tsx:962-972) to pass the
   **full card** to `cardHasContent(kind, card)`, not `hasJsonContent(value)`. *Verify:*
   titled-empty Report now shows the confirm (REP-F7-01 repro).
4. Route `CitationCard` `onTrashClick` (CitationCard.tsx:713) through the same confirm
   flow. *Verify:* citation-with-keys trash now confirms (CI-F7-01/OMNI-F7-01 repro).
5. OR-in `oldNode.attrs.title` at the footnote orphan gate (footnote.ts:204) — or call
   `cardHasContent("footnote", …)`. *Verify:* title-only footnote orphans on marker
   delete (FN-A1-02 repro). *Keystroke check:* `__virgilBusStats()` emitCount flat on
   plain typing.
6. Widen `CardMeta.morph` to `{to, drops}`, add derived `lossy` getter; populate `drops`
   for the 8 morphing kinds (note→highlight: `["body"]`; report→report-request:
   `["title","byline"]`; report-request→report: `["aiRequest"]`; comment↔suggestion:
   `[]`). Add the converter↔drops pin test. *Verify:* `assertMorphCoverage` extended,
   green; pin test green.
7. Generate the morph confirm copy from `drops` in `convertCardWithRemap`
   (EditorPane.tsx:879-895). *Verify:* report-request→report confirm no longer says
   "title and byline" (REP-F6-03 repro).
8. Add `unbridgeAiRequest` + `preserveModeBAnchor` to the `CardLifecycle` interface
   (`card-lifecycle-registry.tsx`); extend `assertLifecycleCoverage` to pin them to the
   `aiRequest`/`bindAnchor` facets. Expose the ops from `useReports`/`useNotes`/
   `useCutter`/`useRevisions`; wire them into `CardLifecycleProvider value`. *Verify:*
   coverage assertion green.
9. Have `convertCardWithRemap` call `unbridgeAiRequest(id)` when
   `CARD_REGISTRY[to].aiRequest` is absent and `from` had it (i.e. `drops` includes
   `"aiRequest"`), BEFORE the data mutation. *Verify:* `lifecycle-unbridge.test.ts`
   green; manual — flag a report-request, morph to report, confirm `ai-requests.json`
   entry is gone (REP-F5-01/REP-F6-01/REP-F8-01/OMNI-F6-01 repro).
10. Have the delete path call `unbridgeAiRequest(id)` for aiRequest-bearing kinds.
    *Verify:* delete a flagged report-request → inbox entry cleared (REP-F7-02 repro).
11. Add `preserveModeBAnchor` to `dropReportsApi` (+ todos/cutter/revisions/archive as
    Mode-B-capable) — OR (preferred) have the re-anchor `applyDrop` read it from the
    lifecycle registry and drop the per-API field. *Verify:* re-anchor a Mode-B report,
    original span tint cleared (REP-F7-03 repro).
12. Register `reports` (audit `todos`/`examples`) in the linked-anchor Mode-A
    orphan-consumer list + the `applyLinkedAnchors` Mode-B restore loop
    (`linked-anchor.ts` + EditorPane). *Verify:* delete a report's anchored paragraph →
    jump button disables / orphan surfaced (REP-A1-01); reload a Mode-B report-request →
    tint restored (REP-A2-01).
13. Introduce `runCardLifecycleEvent` (`cards/lifecycle/run-event.ts`); migrate
    `tryDelete`, `convertCardWithRemap`, and the re-anchor `applyDrop` to call it; add the
    cross-surface `cardStore {kind,id}` selection/expand remap on morph. *Verify:*
    morph the selected report keeps its halo (REP-F6-02/OMNI-F6-02 repro); full audit
    regression suite green.
14. (Optional) Add the once-per-doc-open inbox reconciliation sweep (§4) to heal
    pre-fix phantom entries. *Verify:* a paper seeded with a leaked entry self-heals on
    open; keystroke emitCount unaffected.
15. Run the full audit-repro pass for all 18 ids in §6; run the editor-skill
    `apply_response` coherence check (delete via `/editor/archive-card` leaves no
    phantom inbox entry).
