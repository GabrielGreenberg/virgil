# PLAN — Reconciled implementation plan for the LHS-panel fix sweep

> Integration-architect reconciliation of the six theme designs (T1–T6) in this directory.
> DESIGN ONLY — no source edited. Verified against `HEAD` 7e47f91 (2026-06-16); shared
> chokepoints confirmed in live source (see §9).
>
> Read the six theme docs first. This document does NOT restate their internals — it
> decides the **one canonical data model** where they overlap, **sequences** them, draws
> the **conflict graph**, names what **parallelizes**, fixes the **per-theme merge gates**,
> and isolates the **genuine product/architecture forks** for Gabriel.

---

## 0. The one deficiency under all six themes

Gabriel's non-negotiable: name the single underlying architectural deficiency and fix
*that* so the cluster falls out. All six theme root-diagnoses are the **same disease worn
six ways**:

> **Virgil built two canonical spines — the `DocStructureBus` (the live, per-transaction-
> mapped structural truth) and the registry-facet-with-boot-assertion pattern (the declared
> per-kind contract) — but the panel/card/identity surfaces were migrated onto them only
> partially. Every bug in this sweep is a surface that re-derives a fact from a frozen or
> lossy projection (a baked position, a citekey-as-identity, a title's shape, a `pos==null`
> guess, a mount-time snapshot, an open-coded lifecycle procedure) instead of consuming the
> live diff or reading the declared contract.**

The six themes are the six unmigrated surfaces:

| Theme | The frozen/lossy projection it replaces | The spine it migrates onto |
|---|---|---|
| **T1** identity | citekey-as-identity; regen id; positional fold key | durable `uid` + one `IdentityCascade` writer + bus `regenIds` |
| **T2** anchor/orphan | `pos==null` anchor guess; 5 stores mirror liveness via ad-hoc events | one `resolveAnchorState` + one bus-driven `useInlineAtomLifecycle` reconciler + durable orphan sidecar |
| **T3** structural-edit | flattened-text heading edit; descendants-only traversal | one atom-aware `inline-content` reader + one UUID-anchored `structural-edit` writer |
| **T4** card-lifecycle | open-coded delete/morph/reanchor procedures | `CardMeta.content`/`morph.drops` facets + one `runCardLifecycleEvent` executor |
| **T5** position/wiring | baked `from/to`; dead EditorLayout state copies; mount-only resync; optional props | one `useLivePosResolver` + `PaneState` ownership + bus resync + required-prop discipline |
| **T6** autotitle/misc | title-*shape* heuristic; multiply-sourced selection; one-way mutation; `\b` | recorded `titleAuto` provenance + `useCycle`/`derivePlural`/`wholeWordPattern` single helpers |

This is why the sequencing matters: **the bus-consumer and the inline-atom identity model
are shared infrastructure that four themes (T1, T2, T3, T5) all build on.** Land that
foundation once, in one place, and the four themes register against it rather than each
inventing its own subscriber. Anything else re-creates the exact "remember to wire surface
N" divergence that caused the bugs.

---

## 1. Canonical data-model decisions (stated ONCE — binding on all themes)

These resolve the overlaps the theme docs each flagged "for the PLAN." They are now
**decided**; theme implementers MUST NOT re-litigate or re-invent them.

### D1 — Inline-atom identity (the T1↔T2↔T3↔T5 crux)

There are **two distinct identity axes** for an inline atom (citation/footnote), and the
themes split cleanly along them. The confusion in the docs is that all four touch
`useCitations.syncFromEditor` and the citation/card id — but they want *different* things
from it.

- **Axis A — the atom's own durable in-session id** (`citationId` / `footnoteId`, round-
  tripped via `\vcid`/`\vfid`). This already exists and is stable for any Virgil-saved doc.
  The only gap is the **markerless re-parse** case where ids regenerate (T1's `regenIds`).
- **Axis B — the bibliography *entry* surrogate id** (`BibEntry.uid`). This is **new** and
  is T1's keystone. It is **not** the same as the citation atom id: a `\cite{key}` atom
  references an entry by citekey; the entry now has a durable `uid` decoupled from the
  renameable citekey.

**Decision D1 (canonical):**

1. **T1 owns Axis B in full** — `BibEntry.uid`, the `\vbid{}` round-trip, the parser
   returning a uid-keyed array (not `Record<citekey>`), and `IdentityCascade` as the
   **single writer** for any identity-changing op (citekey rename, retype, merge/replace,
   regen reconciliation).
2. **T1 owns the Axis-A regen primitive** — the **single bus-diff consumer** that detects a
   markerless re-parse (`addedCitations.length && removedCitations.length` on the *same*
   transaction), matches dropped↔added by `command`, and emits a `regenIds` remap. This is
   *infrastructure*, not a citation-only feature.
3. **The card / inbox / selection / float lifecycle key is the persisted card `id`** (for
   sidecar-backed kinds) and the **atom id** (`citationId`/`footnoteId`) for the inline
   kinds — **unchanged by re-parse once T1's `regenIds` remap runs**. T4's `AiRequestLink.
   cardId`, T2's `cardStore`/float prune key, T5's `@N` jump key, and T6's selection key all
   resolve to **this** id. **No theme introduces a *second* surrogate id for cards.** The
   only new surrogate is `BibEntry.uid`, and it lives strictly inside the bib subsystem
   (annotations/bib-review/bib-float/bib-selection), never on cards or atoms.
4. **There is exactly ONE bus consumer for the citation/footnote add/remove diff.** T1 lands
   it (as the `regenIds`/identity reconciler). T2's `useInlineAtomLifecycle` (orphan + cardStore
   + float prune) and T5's citation `syncFromEditor` resync **register as handlers/policies on
   that one consumer** — they do **not** add their own `onCitations*`/`onFootnotes*`
   subscriptions. This keeps the keystroke-sanctity subscriber count at +1, not +3, and makes
   the `regenIds` remap available to T2/T5 for free.

> **Practical wiring of D1.4:** the single consumer is a small dispatcher mounted once per
> pane that fans the typed bus events to an ordered list of registered policies:
> `[identityRegen (T1), inlineAtomLifecycle (T2), citationSidecarResync (T5)]`. Order matters
> — regen-remap runs **first** so downstream policies see post-remap ids. T2 and T5 expose
> their reconcile logic as functions the consumer calls; they own the *logic*, T1 owns the
> *subscription*.

### D2 — Anchor-state (the T2-owned model, consumed by T1/T5/T6)

**Decision D2 (canonical):** anchor-state is a **three-value derivation owned by T2's
`resolveAnchorState(pos, intent)`** in `src/links/anchor-state.ts`:

- `anchored` — live marker present (`pos != null`).
- `free` — no live marker **and** the card declares deliberate-free intent (`unanchored`).
- `orphaned` — no live marker **and** no free intent (a genuinely lost marker).

The `OmniItem.anchorState` union (`"anchored" | "free" | "orphaned"`) and its binning/badging
**already exist**; T2 supplies the missing *single derivation*. Every site that branches on
`pos == null ? "orphaned" : "anchored"` is replaced by `resolveAnchorState`. T1's float/
selection re-point and T5's omni fold/focus filter consume this state; they do not re-derive it.

### D3 — `BibEntry` mutation primitives (T1↔T6 split of C16's merge-vs-replace)

Both T1 and T6 propose splitting `updateBibEntry` into merge vs replace. **Decision D3:**
**T1 owns the split** (`updateBibEntry`=merge, `replaceBibEntry`=set-all), because T1 is
already rewriting `updateBibKeyAndType` into a thin `IdentityCascade` caller and the cascade
becomes the single writer for both. T6's C16 work consumes `replaceBibEntry` for "Replace with
library" and field-delete; it does **not** re-define the primitive. (T6's *command-shape*
`derivePlural` work — the singular↔plural toggle — is fully T6's and untouched by T1.)

### D4 — Sidecar versioning convention (T2 establishes, T6 conforms)

T2 introduces `orphaned-footnotes.json` with an explicit `"version": 1`; T6 adds `titleAuto?`
to five existing sidecars with a self-stamping forward-only migration (no version counter).
**Decision D4:** the family standard is **(a) explicit `version` integer on any *new* sidecar
file** (T2's orphan store, and `BibEntry`'s on-disk form is the `.tex`/`.bib` so it uses the
`\vbid` no-op-command convention, not a JSON version); **(b) self-stamping additive migration
with `persistMigrationOnLoad` for *existing* sidecars** (T6's pattern, T1's annotations/bib-
review orphan-bucket pattern). New files get a version key; additive fields on existing files
get a self-stamping migrator. **Non-destructive always** — T1's orphan buckets and T6's
no-worse-than-today fallback are the bar; never a silent delete on a DATA-LOSS-class sidecar.

### D5 — `CitationEntry` type (the T1↔T3 type-collision)

Both T1 (no field add, but reads it) and T3 (`nestedInFootnoteId?`) edit
`doc-structure/types.ts:48 CitationEntry` and bump the structure `version`. **Decision D5:**
**T3 owns the `CitationEntry.nestedInFootnoteId?` field add and the `version 1→2` bump**; T1's
`regenIds` matcher keys on `command` equality (not on the nested field), so T1 has **no field
add** on `CitationEntry` — only T3 does. They must land in a defined order on this one file
(see §3) to avoid a textual merge collision, but there is **no semantic conflict**: T1 reads,
T3 extends.

### D6 — The lifecycle/identity key for cross-store obligations (T4 anchor)

**Decision D6:** restating D1.3 from the lifecycle side — the inbox link
(`AiRequestLink.cardId`), the `cardStore {kind,id}` selection/expand, and the float key all
key on the **persisted card `id` / atom id**, post-`regenIds`. T4's executor publishes a
single "card-deleted" / "card-morphed" signal that T2's pruner consumes (the seam both docs
flag). T4 does not own the pruner; T2 does. T4 owns the *emission*.

---

## 2. Conflict graph — which themes share files (→ must serialize)

Verified against live source. A shared file means the two themes **cannot land in independent
worktrees simultaneously**; they serialize on a shared branch (or land in a fixed order with a
rebase). Edges are labeled with the file and whether the conflict is **semantic** (shared
model — must co-design, D-decisions above) or **textual** (same file, different lines — order +
rebase suffices).

```
                 ┌──────────────────────── SEMANTIC (shared model) ───────────────────────┐
                 │                                                                          │
   T1 ◄──────────┼── inline-atom identity / single bus consumer (D1) ──┬──► T2             │
   (identity)    │                                                       ├──► T5 (cite resync)
                 │                                                       └──► T3 (atom id input)
                 │                                                                          │
   T1 ◄── BibEntry merge/replace (D3) ──► T6                                                │
   T1 ◄── useCitations.ts:308 \b rewrite (D? textual) ──► T6 (C26)                          │
   T2 ◄── resolveAnchorState model (D2) ──► T5, T6, T1                                      │
   T3 ◄── CitationEntry type + version (D5) ──► T1                                          │
   T4 ◄── card-deleted signal seam (D6) ──► T2 (pruner)                                     │
                                                                                            │
                 └─────────────────────── TEXTUAL (same file, co-edit) ────────────────────┘

   useCitations.ts        : T1 (cascade, split, resync-stub) · T5 (bus resync) · T6 (C16, C26) · T2 (cloneCitation)
   useAnchorHighlightReconciler.ts : T2 (entityExists) · T3 (inherits resolveLink, no logic)
   EditorPane.tsx         : T1 (float remap) · T2 (mount lifecycle) · T4 (morph executor) · T5 (PaneState/resync/wiring)
   EditorLayout.tsx       : T1 (float migrators) · T2 (drop shell orphan state) · T3 (rename UUID wiring) · T4 (linked-anchor) · T5 (delete dead state, focus source, @N matcher)
   panel-primitives.tsx   : T4 (tryDelete) · T6 (C15 select, C24 clamp)
   omni-host.tsx          : T1 (uid float, regen re-point) · T5 (fold/focus resolvePos)
   FootnotePanel.tsx      : T2 (de-dup merge) · T6 (C25 count/cycle)
   SearchPanel.tsx        : T5 (live-range, scope, useCycle) · T6 (C15 selectedIdx, C26 mark/breadcrumb)
   doc-structure/types.ts : T1 (reads) · T3 (nestedInFootnoteId + version)
   has-content.ts / footnote.ts orphan gate : T4 (content facet) · T2 (orphan empty-gate) · T6 flags FN-A1-02
```

**The heavily-contended files** (≥3 themes): `useCitations.ts`, `EditorPane.tsx`,
`EditorLayout.tsx`. These three are the spine of the sweep and force most of the serialization.

---

## 3. Dependency-ordered implementation SEQUENCE

The ordering is driven by the conflict graph + the D-decisions. Five **waves**. Within a
wave, the listed items can run in **parallel worktrees** (§4); across waves they **serialize**.

### WAVE 0 — Foundations with no dependents (parallel, land first)

These have no upstream dependency and de-risk the big changes. Run in parallel:

- **W0a · T6-C26 `wholeWordPattern`** (`src/lib/whole-word.ts`). Tiny, self-contained.
  **T1 depends on this** (the cascade's `\cite{}` rewrite consumes the boundary matcher) and
  so does T6's own C16/C26. Land it first as a shared helper. *(Resolves the C26 dependency
  T1 §8 flags as "before T1".)*
- **W0b · T1 Stage 0 — `BibEntry.uid` plumbing** (`bib-uid.ts`, parser array-not-Record,
  `\vbid` round-trip, `\providecommand` guard). **Pure plumbing, uid unused by UI.** No
  behavior change; byte-stable except new `\vbid` lines. This is T1's own Stage 0 and gates
  everything else in T1.
- **W0c · T2 `anchor-state.ts`** (`resolveAnchorState` + truth-table test). Pure, additive,
  no dependents. **This is D2.** Land it standalone so T1/T5/T6 can import it.
- **W0d · T3 read-side: `inline-content.ts`** (`inlineAtoms`/`flattenInlineText`/
  `findInlineAtomPosDeep`; absorb `atom-text.ts` + `citation-doc-ops.ts` walkers; rewrite
  `findInlineAtomPos`/`resolveLink` with top-level fast-path). **No identity dependency** —
  this is the C10 traversal fix; a top-level atom resolves identically. Land early; it's the
  lowest-coupling half of T3.
- **W0e · T6 Phase A leaf consolidations** (C24 empty-sentinel `??`→`||`, C25 footnote count/
  cycle, SR-F1-03/F1-05 snippet/breadcrumb). These touch `panel-primitives.tsx`,
  `FootnotePanel.tsx`, `SearchPanel.tsx` — **all contended later**, so land the *non-selection*
  parts of T6 Phase A early while those files are quiet, OR defer to Wave 4 (see fork note).
  **Recommendation: land C24/C25/C26 leaf parts in Wave 0; defer C15 selection + Search
  `useCycle` to Wave 4** (after T5's search rewrite). See §3 note on T6 split.

> **T6 is split across waves by decision:** its leaf consolidations (C24/C25/C26) are Wave 0;
> its C16 command/field semantics are Wave 1 (alongside T1's bib work, sharing `useCitations`);
> its C15 selection + Search `useCycle` are Wave 4 (after T5's search rewrite lands a working
> jump and after T1/T2 settle the selection key). This matches T6 §8's own ordering
> recommendation (T1 → T2 → search → T6).

### WAVE 1 — Identity core + the single bus consumer (the keystone; serialize)

This wave lands the shared infrastructure D1 mandates. **Mostly serial on a shared branch**
because it's all T1 spine plus the type edits T3/T6 need to coordinate.

- **W1a · T1 Stages 1–2 — sidecar uid re-key + `IdentityCascade`.** Annotations/bib-review re-
  key on `uid` (non-destructive orphan buckets, D4); `IdentityCascade` service + migrator
  registry; route `commitEditBib` rename + the editor `\cite{}` rewrite (using W0a's
  `wholeWordPattern`, descending into footnotes via W0d's `inline-content`) through the
  cascade. **This is the DATA-LOSS fix (BIB-A2-01) landing.** Behind the `virgil:identity-
  cascade` flag.
- **W1b · T1 Stage 3 — the single bus-diff consumer + `regenIds`.** **This is D1.2/D1.4 — the
  shared dispatcher.** Lands the one `onCitations*`/`onFootnotes*` subscription with the
  regen-remap policy registered first. **Exposes the registration API** T2 and T5 plug into.
- **W1c · T1 Stage 4 + D3 — export-via-serializer, `updateBibEntry`/`replaceBibEntry` split,
  outline fold-by-uuid (OUT-A2-01).** The merge/replace split (D3) lands here so T6-C16 (Wave
  1, parallel) can consume `replaceBibEntry`.
- **W1d · T6-C16 (command/field semantics)** — `derivePlural` + wire "Replace with library" to
  T1's `replaceBibEntry`. **Shares `useCitations.ts` and `BibEntryCard`/`BibliographyPanel`
  with T1 → serialize after W1a/W1c on the same branch** (T6 rebases the C16 edits onto T1's
  expanded migrator, per T6 §8).
- **W1e · T3 type edit (D5)** — `CitationEntry.nestedInFootnoteId?` + `version 1→2` +
  `buildInitial` `descendInto` pass. **Shares `doc-structure/types.ts` with T1's reads →
  land after W1b** so T1's consumer is keying on the stable id T3's nested field assumes.

> **Why Wave 1 is the chokepoint:** D1.4 ("one bus consumer") means T2 and T5 literally cannot
> land their reconcilers until T1's dispatcher + registration API exist. This is the single
> most important sequencing constraint in the sweep.

### WAVE 2 — Lifecycle reconciliation (registers on Wave 1's consumer; serialize the shared files)

- **W2a · T2 `useOrphanedFootnotes` sidecar** (durable orphan store, D4). **No dependency on
  Wave 1** (footnote ids are sidecar-stable) — could even ride Wave 0, but kept here to land
  beside its consumer. Fixes C3 (reload-loss, cross-doc bleed).
- **W2b · T2 `useInlineAtomLifecycle`** — registers as a **policy on Wave 1's consumer** (D1.4),
  NOT a new subscription. Orphan upsert/clear, `cardStore` prune (`entityExists` consults live
  atom set), `poppedOutCards` prune/re-point. **Keys on the post-`regenIds` id from W1b.**
  Behind `virgil:inline-atom-lifecycle` flag.
- **W2c · T5 citation `syncFromEditor` bus resync** — registers as a **policy on Wave 1's
  consumer** (D1.4). The *remove/orphan* half is T2's (W2b); this is the *add/resync* half
  (C17). **T2 and T5 must not double-own the citation resync** — W2b handles removal-prune,
  W2c handles add-resync, both on the one consumer.
- **W2d · T4 Wave (content facet + morph contract + executor + linked-anchor).** T4 is largely
  **independent of T1/T2 for the report/note/cutter/revision kinds** (sidecar-backed, id-
  stable). Its footnote/citation `content` facet (CI-F7-01, OMNI-F7-01, FN-A1-02) coordinates
  with T2's orphan empty-gate and T1's id — land **after** W1b/W2b on shared `EditorPane`/
  `has-content`/`footnote.ts`. T4's executor publishes the "card-deleted" signal D6/T2 consume.

> **Heavy `EditorPane.tsx` / `EditorLayout.tsx` contention here:** T2 (mount reconciler, drop
> shell orphan state), T4 (morph executor, linked-anchor), and T5's resync all edit these two
> files. **Wave 2 runs on ONE shared branch** for these three; do not parallelize T2/T4/T5 in
> separate worktrees against `EditorPane`/`EditorLayout`.

### WAVE 3 — Structural-edit write side + traversal completion (mostly parallel)

- **W3a · T3 write side — `structural-edit.ts` + UUID-anchored `editor-ops.ts`.** The C2
  DATA-LOSS heading-rename atom-preservation. **No identity dependency** (T3 §8). Touches
  `editor-ops.ts`, `OutlinePanel.tsx`, `EditorLayout.tsx` rename wiring. **`EditorLayout.tsx`
  contended** with T5's focus-source swap and `@N` matcher → coordinate or serialize the
  EditorLayout hunks.
- **W3b · T5 Pillars A + C-2 + E-2** — `useLivePosResolver` (Pillar A, refactor OmniViewPanel,
  swap omni fold filter), outline focus source swap (C-2, `EditorLayout` focus engine),
  `@N` anchor-indexed jump (E-2, `marker-clicks`/`EditorLayout` matcher). **Independent of
  identity** (T5 §8) — can land early but shares `EditorLayout.tsx` + `omni-host.tsx` with T1
  (W1c omni uid) and T3 (W3a) → serialize the `EditorLayout`/`omni-host` hunks.

### WAVE 4 — Search rewrite + ownership move + wiring batch + T6 tail (serialize search file)

- **W4a · T5 Pillars B + D** — the `PaneState.searchHighlightRange` ownership move (delete dead
  EditorLayout state) + search re-architecture (live-range navigation, `SCOPE_DISPATCH`,
  scope-completeness). **Highest-risk** (deleting live-looking state). Lands after Wave 2/3
  settle `EditorPane`/`EditorLayout`.
- **W4b · T5 Pillar E-1** — host-wiring batch + required-prop discipline + CI guard. Mechanical,
  per-host. Land last in T5 (the prop-tightening surfaces any still-unwired host as a compile
  error).
- **W4c · T6 Phase C — C15 selection unification + Search `useCycle`.** **Serializes after
  W4a** (T6 §8: "C9/C11 search lands first, then T6's `useCycle` rebases on the working jump").
  Shares `SearchPanel.tsx` + `panel-primitives.tsx` with T5. Selection key per D1.3 (no new
  surrogate).
- **W4d · T6 Phase D — `titleAuto` schema change (C12).** The one approved schema change.
  **Lands LAST** (T6 §9: schema change after the test harness is proven on cheaper classes).
  No file conflict with anyone (its sidecars — reports/notes/todos/archive/examples — are
  T6-exclusive). Could technically parallelize with W4a–c, but kept last for the migration-
  soak discipline.

---

## 4. What parallelizes (separate worktrees) vs what serializes

**Parallel worktrees (no shared file, no shared model in that window):**

- **Wave 0** is maximally parallel: W0a (whole-word), W0b (uid plumbing), W0c (anchor-state),
  W0d (inline-content read side), W0e (T6 leaf C24/C25/C26) are **five independent worktrees** —
  they touch disjoint files (`whole-word.ts`, `bib-uid.ts`+parser, `anchor-state.ts`,
  `inline-content.ts`+`links.ts`, `panel-primitives`/`FootnotePanel`/`SearchPanel` leaf hunks).
  The only watch-item: W0e's `SearchPanel`/`panel-primitives` leaf edits must avoid the lines
  W4a/W4c will rewrite — keep W0e to the empty-sentinel/count/breadcrumb hunks only.
- **T4's report/note/cutter/revision slice (W2d Chips 1–3, 6–12)** is **independent of T1/T2/T5**
  for the sidecar-backed kinds and can run in its **own worktree** *until* it touches the shared
  `EditorPane`/`has-content`/`footnote.ts` for the footnote/citation content facet — at which
  point it serializes into the Wave 2 shared branch.
- **W4d (T6 `titleAuto`)** is **fully independent** (T6-exclusive sidecars) and can run in its
  own worktree any time after Wave 0, landing whenever the migration soak completes.

**Must serialize on a shared branch (shared file or shared model):**

- **The identity keystone (Wave 1, all of T1 + T6-C16 + T3-type-edit)** — shared `useCitations.ts`,
  `doc-structure/types.ts`, and the D1 model. One branch, ordered W1a→W1b→W1c→W1d→W1e.
- **The lifecycle reconcilers (Wave 2, T2 + T5-resync + T4-footnote-facet)** — shared
  `EditorPane.tsx`/`EditorLayout.tsx` and the **one bus consumer** (D1.4). One branch.
- **The `EditorLayout.tsx`/`omni-host.tsx` hunks across T1/T3/T5** — these three themes all edit
  `EditorLayout`; their hunks must be merged on a shared integration branch, not raced.
- **The search files (Wave 4, T5 + T6-C15)** — shared `SearchPanel.tsx`/`panel-primitives.tsx`.

**Rule of thumb for the integration manager:** a worktree is safe to parallelize iff its file
set is disjoint from every concurrently-open worktree's file set **and** it does not consume a
D-decision artifact (the bus consumer, `replaceBibEntry`, `resolveAnchorState`, `BibEntry.uid`)
that has not yet landed. The three spine files (`useCitations`, `EditorPane`, `EditorLayout`)
are the serialization bottleneck — schedule around them.

---

## 5. Per-theme verification gate (must pass before merge)

Every gate includes the **keystroke-sanctity invariant**: `window.__virgilBusStats()` —
typing N plain characters leaves `emitCount` flat and `version` advancing — and the rule that
any new bus reactivity is a **registered policy on the one consumer (D1.4)**, never a fresh
`editor.on('update')` subscriber. Card-source memos gate on `useStructuralRevisions` counters
**plus the reactive `editor` instance** (counters silent on load), never a `docVersion`.

| Theme/Wave | Tests that must be green | Keystroke-sanctity / load check | Live smoke (dev doc) |
|---|---|---|---|
| **W0a T6-C26** | `whole-word` unit (`+foo`,`foo!`,`a:b`,`foo`) | n/a (pure string) | rename citekey `+foo`→`bar` rewrites in-text |
| **W0b T1 Stage0** | `bib-uid.test.ts` (round-trip, dup-citekey→2 uids); bib-parser tests updated to array+uid | n/a | `samples/annotation-history` `.bib`/`.tex` byte-stable except `\vbid` lines |
| **W0c T2 anchor-state** | `anchor-state.test.ts` truth table | n/a | n/a |
| **W0d T3 read** | `inline-content.test.ts`; `footnote-nested-citation-delete.test.ts` green unchanged; new jump test (`BIB-F3-01`/`CI-F3-01` → host marker) | `__virgilBusStats` flat (top-level fast-path unchanged) | jump arrow on in-footnote cite scrolls to footnote marker |
| **W0e T6 leaf** | C24 empty-sentinel snapshot; C25 footnote count==rendered, cycle visits orphans; SR-F1-03/05 | `emitCount` flat after FootnotePanel widen | empty footnote shows "empty"; badge==count with orphans |
| **W1a–c T1 core** | `identity-cascade.test.ts` (fan-out batch; `\cite` rewrite incl. in-footnote; punctuation citekey via boundary matcher); annotations/bib-review migration (orphan bucket, no loss); float-key uid lockstep; export reconstructed block; merge/replace split | cascade subscribes structural-only; `emitCount` flat | rename citekey across migration boundary — **no annotation loss** (DATA-LOSS pin); popped bib float survives rename |
| **W1b T1 consumer** | markerless-reparse fixture → `regenIds` re-points selection/float/pin; structure-index add+remove diff test | **the +1 consumer; `emitCount` flat on plain typing** | code-view `\cite` re-parse re-points cards (OMNI-F3-02, CI-A3-01) |
| **W1d T6-C16** | `derivePlural` promote/demote/package-toggle; `replaceBibEntry` honors field-delete | n/a | promote then equalize → demotes; package toggle re-derives |
| **W1e T3 type** | structure test: footnote-nested cite in `structure.citations` with host id; `version` bump | **`buildInitial` descend is load-only O(doc)-once; per-tx stays O(edit)** | n/a |
| **W2a T2 orphan sidecar** | `useOrphanedFootnotes.test.ts` (persist/reload, docId reset, read-only no-op, absent-file migrate) | sidecar state, no editor walk | reload keeps orphans; doc-switch resets (FN-A2-01/A2-03) |
| **W2b T2 lifecycle** | `useInlineAtomLifecycle.test.tsx` (FN-A1-03 delete→undo→one card; hard-delete clears `cardStore.selected`; popped float closes/re-points; id-reuse no stale halo); cardStore prune tests flip ("inline never pruned" → pruned) | **registered policy, not new subscription; `emitCount` flat** | delete→undo footnote (no duplicate-key crash); pop-float→delete atom |
| **W2c T5 resync** | citation bus-resync: delete `\cite`→card prunes w/o remount (CI-A1-01); code-view add→appears (CI-F8-03) | **policy on the one consumer; structural-only bump** | delete `\cite` in editor prunes card live |
| **W2d T4 lifecycle** | `content-coverage.test.ts`, `lifecycle-unbridge.test.ts`, `morph-drops-confirm.test.ts`; converter↔drops pin; `ai-request-routing-contract.test.ts` byte-stable | orphan gate read in existing structural branch (no new walk); inbox sweep load-only | titled-empty report confirms (REP-F7-01); morph report-request→report clears inbox entry |
| **W3a T3 write** | `structural-edit.test.ts` (`OUT-F5-01` `\section{The $G$-action on \citet{foo}}` pin; parTitle drift no-op; dup-label blocked); rename-then-serialize e2e | `flattenInlineText` in structural-counter-gated memo only | rename heading with `$math$`+`\citet` — atoms survive; outline shows new title |
| **W3b T5 pos/jump** | `useLivePosResolver` (snapshot-identity cache, no rebuild on typing); omni boundary-shift after typing (OMNI-F1-02); 2-anchor marker pin (REP-F3-01) | **cache rebuilds only on snapshot identity change; `emitCount` flat** | omni fold bin correct after typing shifts item; `@1` row pins |
| **W4a T5 search/ownership** | search live-range (type-earlier-then-click lands right text); `SCOPE_DISPATCH` exhaustiveness (compile-error test); PaneState bubble reaches live editor; EditorLayout dead state gone | positions resolved at click time, not per-keystroke | search highlight after typing in earlier para lands correctly |
| **W4b T5 wiring** | required-prop type-check (a `*Host` omitting a required prop fails build); per-host wiring repros | n/a | drag unanchored citation into editor anchors it (CI-A2-01) |
| **W4c T6-C15** | re-click idempotence (halo stays, no double-jump); Search counter never exceeds total | `emitCount` flat (memo gating unchanged) | re-click footnote — halo stays |
| **W4d T6 titleAuto** | `auto-title.test.ts` (resolveLoadedTitle truth table; create→rename "Report 8"→reload keeps; migration idempotence + self-stamp) | sidecar load/create/edit only, off keystroke path | type numbered title in each kind, reload, survives |

**Global final gate (before the sweep ships):** full suite (1100+ tests) green; the audit-repro
pass for all bug ids across the six themes; `__virgilBusStats()` flat on plain typing with **all
flags on**; showcase `samples/annotation-history` round-trips byte-stable except `\vbid`;
AGENTS.md keystroke-sanctity permitted-consumer list updated to add **exactly one** new entry
(the single inline-atom bus consumer of D1.4) with its O(diff) rationale — not three.

---

## 6. Feature-flag posture

Per theme self-assessment, the staged flags are: `virgil:identity-cascade` (T1 Stages 2–3),
`virgil:inline-atom-lifecycle` (T2 W2b reconciler). T3/T4/T5/T6 ship without runtime flags
(behavior-correct-by-construction + contract tests; T6's `titleAuto` is no-worse-than-today by
design). **Decision:** keep the two flags through Wave 2 so the bus-consumer cutover (the
riskiest move — it replaces the mount-only `syncFromEditor` and the orphan event web at once)
can A/B against the old paths in the preview before the event web is deleted (T2 step 9 /
`footnote-sync.ts` removal is gated behind the flag being proven on). Remove both flags after
the Wave 2 live smoke-test passes.

---

## 7. GENUINE FORKS for Gabriel (product/architecture decisions only)

Most cross-theme questions are resolved by D1–D6 above (routine architecture). The following
are **genuine forks** — a real product or architecture choice where either branch is defensible
and the decision is not mine to make:

1. **FORK-1 (product, T6-C12): does a freshly-created card show its generated label as a faded
   placeholder, or stay blank?** Now that `titleAuto:true` makes a generated title safely
   strippable, a new report could display "Report 8" (faded, `titleAuto`) instead of blank.
   T6 defaults to **blank (`title:""`)** to minimize churn. This is a visible UX change either
   way — Gabriel's call. *(Default if no answer: keep blank.)*

2. **FORK-2 (product, T5 Pillar E-1): build vs delete the audit-confirmed dead surfaces.**
   `BIB-F1-02` (a CSL bibliography preview that was never built) and `FN-F7-01` (a
   `startFootnoteDrag` with no call site) are dead code. The fix is *either* build the surface
   *or* delete the dead prop. Building is a new feature; deleting is cleanup. Gabriel decides
   per-surface whether either is a wanted feature. *(Default if no answer: delete with a
   comment; file a backlog item if the feature is wanted.)*

3. **FORK-3 (architecture, T1↔T2 overlap, the one I most want confirmed): is the "single bus
   consumer" (D1.4) acceptable as a hard architectural constraint?** I have decided T1 owns the
   one `onCitations*`/`onFootnotes*` subscription and T2/T5 register as policies on it. This is
   the deepest, most keystroke-sanctity-aligned choice and both T1 §8 and T2 §8 propose it — but
   it **couples T2's and T5's landing to T1's consumer existing first** (the Wave 1→2 hard
   edge). The alternative (each theme owns its own subscription, +3 consumers) is looser-coupled
   and parallelizable but re-introduces the multi-subscriber drift the whole sweep is fighting
   and grows the permitted-consumer list. I strongly recommend the single consumer; flagging
   because it is the one decision that, if Gabriel prefers parallelism over depth, reshapes the
   wave structure. *(Default: single consumer, as planned.)*

4. **FORK-4 (scope, shared CI-F7-01 / FN-A1-02 / FN-F5-01 splits): confirm the cross-theme
   ownership splits.** Three bug ids are deliberately split across themes: **CI-F7-01** (T6 owns
   command-demote half; T4 owns delete-confirm half), **FN-A1-02** (T4 owns the content-facet
   empty-gate; T2 folds it into the orphan-upsert; T5/T6 only flag), **FN-F5-01** (T5 wires the
   surface; the footnote-title *serialization* round-trip — `latex-serializer.ts:393` /
   `latex-parser.ts:404` — is **not owned by any of the six themes**). FN-F5-01's serialization
   half is a genuine **coverage gap**: no theme fixes it. Gabriel should confirm whether to (a)
   add it to T3's scope (it's atom/round-trip-adjacent), (b) spin a small follow-up chip, or (c)
   accept the title-drops-on-reload behavior until later. *(Default: spin a follow-up chip;
   T5 wires the surface so it lights up the day serialization lands.)*

Everything else the theme docs flagged "for the PLAN" is resolved by D1–D6 and is **not** a
fork — it was a routine model-ownership choice now decided.

---

## 8. Total bug coverage

| Theme | Bugs resolved (per doc) | DATA-LOSS in set |
|---|---|---|
| T1 identity | 19 | BIB-A2-01, BIB-F7-01 |
| T2 anchor/orphan | 18 | FN-A2-01 |
| T3 structural-edit | 15 (+OUT-F7-01 free) | OUT-F5-01 |
| T4 card-lifecycle | 18 | REP-F7-01 |
| T5 position/wiring | 40 | (HIGH cluster: SR/CI/REP) |
| T6 autotitle/misc | 30 | (C12 strip = silent loss) |

**Gross ≈ 140 bug-id mentions; net distinct ids are fewer** because the audit cross-references
several ids across classes (e.g. `OUT-F7-01` in T3 *and* T5/C9; `FN-A1-02` in T2/T4/T5/T6;
`CI-F7-01` in T4/T6; `BIB-A3-02`/`BIB-F5-04` in T1/T6; `SR-F3-04`/`SR-A2-01` in T1/T5;
`OMNI-F8-02` in T1/T5; `CI-A3-01` in T1/T2; `BIB-F5-02` in T5/T6-flag). The D-decisions assign
each shared id a **single owning theme** (§7 FORK-4 + D-decisions) so it is fixed once and
counted once. **Net distinct bugs covered by the sweep: the full LHS-panel audit set**, with
exactly **one named coverage gap (FN-F5-01 serialization, FORK-4)** that no theme owns.

---

## 9. Verification of shared chokepoints (grounding the conflict graph)

Confirmed in live source at `HEAD` 7e47f91:

- `useCitations.ts`: `cloneCitation:229`, `updateBibEntry:262`, `updateBibKeyAndType:283`,
  `syncFromEditor:382` — the four T1/T2/T5/T6 contention points all in one file. ✔ (matches all
  four docs)
- `useAnchorHighlightReconciler.ts:88` — `if (isInlineAtomCardKind(ref.kind)) return true;` — the
  exact pruner exemption T2 rewires; `entityExists` used at `:157/:160/:164`. ✔
- `doc-structure/bus.ts:75–85` — the full `onFootnotesAdded/Removed/OrderChanged` +
  `onCitationsAdded/Removed/Changed/OrderChanged` channel set exists; the **single consumer of
  D1.4 has real channels to subscribe to**. ✔
- `doc-structure/types.ts:48 CitationEntry`, `:107 version`, `:118 citations[]`,
  `:194 addedCitations`/`:195 removedCitations` — the type T1 reads and T3 extends (D5), and the
  add/remove diff T1's `regenIds` matcher keys on. `structure-index.ts:203 version:1`,
  `:358 prev.version+1`. ✔

---

## 10. One-paragraph sequencing summary

Land **Wave 0** (five parallel worktrees: whole-word helper, `BibEntry.uid` plumbing,
`anchor-state`, `inline-content` read side, T6 leaf consolidations) — all low-risk, no
dependents. Then the **Wave 1 keystone** on one serial branch: T1's identity core +
`IdentityCascade` + the **single bus consumer** (D1.4), with T6-C16 and T3's `CitationEntry`
type edit folded in (D3/D5). **Wave 2** on one serial branch (shared `EditorPane`/`EditorLayout`):
T2's lifecycle reconciler + orphan sidecar, T5's citation resync, T4's lifecycle executor — all
**registering on Wave 1's one consumer, not adding their own**. **Wave 3** (mostly parallel):
T3's structural-edit write side, T5's position resolver + `@N` jump. **Wave 4** (serialize the
search files): T5's search rewrite + ownership move + wiring batch, then T6's C15 selection +
`useCycle`, and last the T6 `titleAuto` schema change after its migration soak. The three spine
files (`useCitations`, `EditorPane`, `EditorLayout`) are the serialization bottleneck; schedule
every worktree around them.
