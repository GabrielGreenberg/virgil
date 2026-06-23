# T1 — Durable identity & the rename/regen cascade

> Design doc for the **C1** defect class (+ the C6 export-via-raw drop and the C16 merge-vs-replace updater that share C1's chokepoint). DESIGN ONLY — no source edits.
> Shares the card/citation identity+anchor model with **T2**; see §8 for the reconciliation contract the PLAN must honor.

---

## 1. Scope

**Theme:** A persisted/UI/float/join key is a value that *changes out from under the data that points at it* — either because the **user renames a `.bib` citekey** (the dominant, DATA-LOSS case) or because the **editor regenerates an inline-atom id on a markerless re-parse** (the legacy/external-edit case) or because a key is **positional** (block index). Renames/regens don't cascade, so annotations, AI-review requests, selection, occurrence cursors, floats, omni pins, and bib export all strand on the stale key.

**Bug ids this theme resolves (the full C1 set = 15, plus the two cross-class members C1 owns the chokepoint for):**

C1 (15): **BIB-A2-01** [DATA-LOSS], **BIB-A2-03** [HIGH], **BIB-A2-04** [HIGH], BIB-A2-02 [MED], BIB-A3-01 [MED], OMNI-F3-02 [MED], OUT-A2-01 [MED], BIB-F2-01 [LOW], BIB-F3-02 [LOW], BIB-F7-02 [LOW], CI-A3-01 [LOW], OMNI-A1-01 [LOW], OMNI-F8-02 [LOW], OMNI-F8-03 [LOW], SR-F3-04 [LOW].

C6 owned-by-C1-chokepoint (3): **BIB-F7-01** [DATA-LOSS], BIB-F8-04 [MED], BIB-F1-04 [LOW] — these are the *same* "a bib entry has no durable record, only a citekey + a possibly-empty `raw`" deficiency, surfacing on export rather than on rename. Resolving them is one line *once the entry has a record*, so they belong with this theme.

C16 owned-by-C1-chokepoint (1): BIB-A3-02 [MED] / BIB-F5-04 [MED] merge-vs-replace — the `updateBibEntry` primitive is the bib-entry mutator that the rename cascade also re-routes; splitting it merge/replace is in-scope because the cascade service becomes the single writer. (The plural-command toggle half of C16 — CI-F5-01/CI-F7-02 etc. — is **out of scope**, see §6.)

**Total bugs resolved by this design: 19** (15 + 3 + 1 net of the BIB-F5-04 pairing).

---

## 2. Root diagnosis — the single architectural deficiency

**Virgil has no durable internal identity for a bibliography entry, and no cascade owner for any identity change.**

Unpack the one mechanism three ways — all the same disease:

1. **A `.bib` entry IS its citekey.** `BibEntry` has no surrogate id (`src/lib/types.ts:305`). Every sidecar that annotates an entry keys *directly on the citekey string*:
   - `annotations.json` is `Record<citekey, html>` (`useAnnotations.ts:22,29`) — **the DATA-LOSS surface (BIB-A2-01)**.
   - `bib-review-requests.json` rows carry `bibKey` (`useBibReview.ts:70`) — BIB-A2-02.
   - the float key is `float:card:bib:<citekey>` and the floatable resolves `ctx.bibEntries.find(e => e.key === id)` (`cards/floats/index.tsx:461`) — BIB-A2-04.
   - panel selection is `selectedBibKey === e.key` (`BibliographyPanel.tsx:295`) and occurrence cursors live in `keyOccurrenceIdx: Record<citekey, number>` (`:99`) — BIB-A2-03, BIB-F2-01, BIB-F3-02.
   - `parseBibFile`/`extractRawEntries` collapse the entry set into `Record<citekey.toLowerCase(), …>` (`bib-parser.ts:898`), and the panel runs a `seen.has(e.key)` dedup (`BibliographyPanel.tsx:225,352`) — so two distinct entries that share a key become one (BIB-A3-01, BIB-F1-04, BIB-F7-02).

   The **only** mutation chokepoint, `updateBibKeyAndType` (`useCitations.ts:283-315`), migrates exactly two of these (bibEntries + citation refs). The rest strand. There is no place that *knows the full set of citekey-keyed state*, so every new sidecar silently re-opens the wound.

2. **An inline atom's id is durable only when a `\vcid{}`/`\vfid{}` marker survives.** The serializer emits these markers (`latex-serializer.ts:403,699`) and declares the no-op commands in the preamble (`:74-75`), so for any *Virgil-saved* doc the `citationId` round-trips — this is why CI-F1-02 was **refuted**. But a **legacy/externally-edited/markerless** `.tex`, or a code-view `setContent(parseLatex(text))` that re-parses without remounting (`code-pane-bridge.ts:202`), hits the `pendingCitationId || generateShortId()` fallback (`latex-parser.ts:481,509`) and **mints fresh ids**. The mount-gated `syncFromEditor` (`EditorPane.tsx:1177`) then can't reconcile, and anything keyed on the old id (selection, omni pos cache, float, pin) strands — OMNI-F3-02, CI-A3-01, OMNI-A1-01.

3. **Fold/occurrence state keyed positionally.** The outline persists `foldedSections` as uuids but renders/resolves the collapse Set through index-based ids `heading-${idx}` (`OutlinePanel.tsx:322`), which drift when a block is inserted above (OUT-A2-01). `keyOccurrenceIdx` is a position-cursor with no read-time clamp against the live id list (BIB-F3-02). The omni fold/pos cache freezes absolute positions (OMNI-F8-02/F8-03, SR-F3-04). Same disease: an *unstable address used as a stable key.*

The unifying statement: **identity in Virgil is whatever string was convenient at the call site — the natural key, the convenient index, or a regenerable id — and there is no service that owns "this thing changed identity; cascade it."** Every member bug is a sidecar/UI surface that pointed at one of those unstable addresses and was never told it moved.

---

## 3. The deep solution

### 3.1 The one idea

Introduce a **durable internal id for a bibliography entry** (decoupled from the renameable citekey), and a **single `IdentityCascade` service** that is the *only* writer for any identity-changing operation (citekey rename, bib type change, id-regen reconciliation, entry merge/replace). Every per-entity sidecar registers a **migrator** with the cascade; the cascade fans the change out atomically. No call site mutates a key in isolation again.

This is the inverse of the rejected shallow patch (§3.4): instead of teaching `updateBibKeyAndType` to remember to touch annotations *and* bib-review *and* the float *and* selection *and* the occurrence cursor (a list that grows every release and that already missed five surfaces), we make the surfaces *declare themselves* to one owner.

### 3.2 New abstractions / types / services

**(a) `BibEntry.uid` — a durable surrogate (the keystone).**
```ts
export interface BibEntry {
  uid: string;        // NEW — stable internal id, minted once, never user-visible
  key: string;        // the citekey: now a *renameable attribute*, not the identity
  type: string;
  fields: Record<string, string>;
  raw: string;
}
```
- Minted by `parseBibFile` (one `generateShortId()` per parsed block) and **round-tripped** via a new no-op `\vbid{uid}` line emitted by `serializeBibFile` inside each entry's comment header (mirrors the `\vcid`/`\vfid` pattern — `latex-serializer.ts:38-75`). On a markerless `.bib`, `uid` is minted on first parse and persisted on first save, exactly like `\vcid`.
- Because the `uid` is in the `.bib`, **two entries that share a citekey now have distinct uids** — the parser stops collapsing them into a `Record` (it returns an array keyed by uid), and the panel `seen` dedup drops away. That alone resolves BIB-A3-01 / BIB-F1-04 / BIB-F7-02.

**(b) Sidecars re-key on `uid`, with a migration (see §4).** `annotations.json` becomes `Record<uid, html>`; `bib-review-requests.json` rows carry `entryUid`. Selection (`selectedBibUid`), occurrence cursor (`occurrenceIdxByUid`), and the float key (`float:card:bib:<uid>`) all switch to uid. A citekey rename now touches **nothing** in these sidecars — they were never pointing at the mutable thing.

**(c) `IdentityCascade` — the single rename/regen owner.** New module `src/lib/identity/identity-cascade.ts`:
```ts
type IdentityKind = "bibEntry" | "inlineAtom";
interface IdentityChange {
  kind: IdentityKind;
  // citekey rename: the entry uid is stable; cascade rewrites the natural key + the editor \cite{}s
  renameCitekey?: { uid: string; oldKey: string; newKey: string };
  // type change (no identity move, but the same atomic writer)
  retype?: { uid: string; newType: string };
  // id-regen reconciliation after a markerless re-parse (the inlineAtom case)
  regenIds?: { remap: ReadonlyMap<string /*oldId*/, string /*newId*/> };
}
// Migrators register here; the cascade calls each one inside one batched commit.
registerIdentityMigrator(kind, (change) => void);
runIdentityChange(change): Promise<void>;  // the ONLY public mutator
```
- **Citekey rename** routes through `runIdentityChange({ renameCitekey })`, which: (1) updates the `BibEntry.key`; (2) **rewrites every `\cite{oldKey}` in the editor doc via a single ProseMirror transaction** (the deep half the audit calls out under BIB-F5-03 — the panel must not patch only the sidecar and let `syncFromEditor` revert it); (3) invokes each registered migrator (annotations/bib-review re-key by uid are *no-ops* now, but the citation-refs `keys[]` rewrite and any future citekey-bearing sidecar run here); (4) re-points `selectedBibUid` (no-op — uid stable) and the float key (no-op — uid stable). Because annotations/review/float/selection are uid-keyed, the rename cascade is *small* — it's mostly the doc rewrite + the `.bib` write.
- **The `\cite{}` rewrite uses the C26 boundary-class matcher**, not bare `\b` (resolves BIB-F7-04's sibling corruption — though BIB-F7-04 itself is C26's locus; we consume the shared builder).
- **Id-regen reconciliation** is driven off the **DocStructureBus**, not a mount gate (see §7): when a markerless re-parse mints new `citationId`s, the observer's `addedCitations`/`removedCitations` diff is *the remap evidence*. The cascade matches dropped↔added by `command` equality within the same transaction and emits a `regenIds` remap; migrators (the citations sidecar, the omni pos cache, selection, the float store) re-point. This generalizes the existing `\vcid` round-trip to the case where the marker was absent.

**(d) `replaceBibEntry` vs `updateBibEntry` (C16 merge-vs-replace).** Split the one ambiguous primitive: `updateBibEntry(uid, partialFields)` *merges*; `replaceBibEntry(uid, fields, type)` *replaces wholesale* (honors deletions — clearing a field removes it). The bib edit Save and the conflict-strip "Replace with library" route to `replace`; incremental field edits route to `merge`. The cascade is the single writer for both.

**(e) `serializeBibForExport(entries)` replaces the raw-read export.** `handleExportCited` (`BibliographyPanel.tsx:363`) drops `cited.map(e => e.raw).filter(Boolean)` and calls `serializeBibFile` (which already reconstructs from `fields` when `raw===''`, `bib-parser.ts:135-138`). Resolves BIB-F7-01 / BIB-F8-04 — an in-memory "Save under new citekey" entry with `raw:''` now exports its reconstructed block instead of vanishing.

### 3.3 How it captures the whole range

| Surface that stranded | Why it strands today | Why the design closes it |
|---|---|---|
| annotations (DATA-LOSS) | keyed on citekey | uid-keyed → rename is a no-op |
| bib-review requests | keyed on bibKey | uid-keyed (entryUid) |
| bib float blanks/dies | float id = citekey | float id = uid (stable) |
| selection collapses | `selectedBibKey===key` | `selectedBibUid` |
| occurrence cursor 3/2 | `keyOccurrenceIdx[key]`, no clamp | `occurrenceIdxByUid` + read-time clamp vs live id list |
| dup-citekey entries vanish | `Record<key>` collapse + `seen.has(key)` | uid-keyed array, no dedup |
| export drops in-memory entry | reads `.raw`, skips empty | `serializeBibFile` fallback |
| markerless re-parse strands ids | mount-gated sync | bus-driven `regenIds` cascade |
| outline fold drifts on insert | index-based `heading-${idx}` | resolve fold Set by uuid (reuse focus-view's UUID anchoring) |
| editor `\cite{}` reverts rename | panel patches sidecar only | cascade rewrites the doc in one tx |

Every C1 member maps to exactly one row.

### 3.4 How it improves the app beyond fixing bugs

- **A bib entry becomes a first-class, addressable object.** Today you cannot reference "this entry" across a rename; with `uid` you can — which unblocks future features the roadmap wants: stable cross-paper library matching (the `sync-bib-to-library` skill currently matches by fuzzy citekey), per-entry provenance, and an undo-able rename.
- **One auditable writer for identity.** New sidecars get rename-safety *for free* by registering a migrator; the "did we remember surface N?" class of regression is structurally eliminated. This is the same lesson the focus-view rework banked when it moved bands to UUID anchoring.
- **The id-regen path stops being a latent corruption.** Generalizing `\vcid` round-trip into a bus-driven reconciliation means legacy/external `.tex` files and code-view round-trips become first-class, not "works only if the marker happened to survive."
- **Merge/replace clarity** removes a whole genre of "I cleared the field but it came back" confusion and lets the manual UI do what only the `answer-bib-review --library-sync` skill could before.

### 3.5 The shallow patch we are rejecting

> "Extend `updateBibKeyAndType` to also iterate `annotations`, `bib-review-requests`, `keyOccurrenceIdx`, re-point `selectedBibKey`, and call `remapCardPopKey(float:card:bib:<old>, …<new>)`."

Rejected because: (a) it leaves the **citekey as the identity**, so the *next* citekey-keyed sidecar (and the cross-paper library work) re-opens BIB-A2-01; (b) it leaves the dup-citekey collapse (BIB-A3-01) and the export/raw drop (BIB-F7-01) untouched — those aren't rename bugs, they're "no durable record" bugs the shallow patch can't see; (c) it does nothing for the id-regen sub-class (OMNI-F3-02); (d) it grows `updateBibKeyAndType` into the exact "remember every surface" list that already missed five. The shallow patch fixes ~3 of 19 and guarantees the 4th surface is forgotten.

---

## 4. Data-model / schema / sidecar changes + migration

All sidecars are versioned via each hook's `migrate(raw)` in `usePersistentState`; bump a `v` discriminator and keep a back-compat read. **No write happens until the user (or the cascade) mutates** — so an unopened paper is never rewritten.

1. **`BibEntry.uid`** (`src/lib/types.ts`). `parseBibFile` mints `uid` per block. `serializeBibFile` emits `\vbid{<uid>}` per entry (new no-op preamble cmd, guarded like `\vcid`). Read-back: a `.bib` without `\vbid` mints on parse; first save anchors it. **Two same-citekey entries → two uids** (parser returns array, not Record).
2. **`annotations.json`: `Record<citekey, html>` → `{ v: 2, byUid: Record<uid, html> }`.** Migration: on first load, map each legacy citekey → the uid of the entry that currently carries that key (resolved against freshly-parsed `bibEntries`); unmatched legacy keys are **kept under a `orphanByKey` bucket** (never dropped — a renamed-before-upgrade annotation is recoverable, not lost). Same shape transform for **`bib-review-requests.json`** (`bibKey` → `entryUid`, with an `orphanBibKey` fallback row field).
3. **`bib-settings.json` / panel state:** `selectedBibKey`→`selectedBibUid`, `keyOccurrenceIdx`→`occurrenceIdxByUid` (these are volatile/prefs, migrate-by-drop is acceptable; selection is re-derivable).
4. **Float keys:** `float:card:bib:<citekey>` → `float:card:bib:<uid>`. Reuse the existing `migrateFloatKeys` lockstep helper (`float-key.ts:169`) with a `mapKey` that resolves citekey→uid; an unresolvable old key is **dropped** (closing the dead-float-key leak BIB-A2-04 mentions — the localStorage residue with no dismiss UI).
5. **`citations.json`:** unchanged shape; `CitationRef.id` already durable via `\vcid`. (Adds an optional `entryUid?` cross-link on refs only if T2 needs it — see §8; not required for C1.)
6. **Outline fold:** resolve the persisted uuid `foldedSections` Set directly (drop the `heading-${idx}` translation in `OutlinePanel.tsx:322`); no schema change, the sidecar is already uuid-keyed — the bug is purely in the resolve layer.

Back-compat guarantee: every migration is **additive + non-destructive** (orphan buckets, not deletes), gated behind a version bump, and idempotent.

---

## 5. Files

**Created**
- `src/lib/identity/identity-cascade.ts` — the cascade service + migrator registry + the single `runIdentityChange`.
- `src/lib/identity/bib-uid.ts` — uid mint/round-trip helpers (parse `\vbid`, serialize `\vbid`, mint-on-missing), tested in isolation.
- `src/lib/identity/__tests__/identity-cascade.test.ts`, `bib-uid.test.ts`.
- (doc) `docs/architecture/identity.md` — the "durable id" spine entry the AGENTS index links.

**Modified**
- `src/lib/types.ts` — `BibEntry.uid`; `AnnotationsState` v2; `BibReviewRequest.entryUid`.
- `src/lib/bib-parser.ts` — `parseBibFile`/`extractRawEntries` return uid-bearing array (stop `Record<key>` collapse); `serializeBibFile`/`reconstructBibtex` emit `\vbid`; **export consumers via `serializeBibFile` fallback**.
- `src/lib/latex-serializer.ts` — `\vbid` preamble guard (mirrors `\vcid`).
- `src/hooks/useCitations.ts` — `updateBibKeyAndType` becomes a thin caller of `runIdentityChange`; split `updateBibEntry`/`replaceBibEntry`; `syncFromEditor` reconciles via bus `regenIds` (see §7); registers the citation-refs migrator.
- `src/hooks/useAnnotations.ts` — uid keying + v2 migrate; registers its migrator (no-op on rename, but registered so the contract holds).
- `src/hooks/useBibReview.ts` — `entryUid` keying; latest-not-first read (this also closes BIB-F8-03's C22 sibling, but that's C22's locus — we only re-key here).
- `src/components/BibEntryCard.tsx` — `commitEditBib` routes rename through the cascade; uid-based `popKey`; `replaceBibEntry` on Save.
- `src/panels/Bibliography/BibliographyPanel.tsx` — `selectedBibUid`; `occurrenceIdxByUid` + read-time clamp; drop `seen.has(key)` dedup; export via `serializeBibFile`.
- `src/cards/floats/index.tsx` — `registerCardFloatable("bib", uid => bibEntries.find(e => e.uid === uid))`.
- `src/components/EditorLayout.tsx` / `EditorPane.tsx` — wire the cascade's float-key remap into `remapCardPopKey` for the bib-rename path (generalize the morph-only wiring at `EditorPane.tsx:926`); register the float/pin migrators.
- `src/panels/Omni/OmniViewPanel.tsx` + `omni-host.tsx` — omni pin/pos cache re-point on `regenIds`; uid float keys.
- `src/components/OutlinePanel.tsx` — resolve fold Set by uuid (OUT-A2-01).
- `src/lib/section-folding.ts` — accept uuid-addressed hidden set (companion to the outline change).

---

## 6. Bugs resolved + out-of-scope

**Resolved (19):** BIB-A2-01, BIB-A2-02, BIB-A2-03, BIB-A2-04, BIB-A3-01, BIB-F2-01, BIB-F3-02, BIB-F7-02, OMNI-F3-02, OMNI-A1-01, OMNI-F8-02, OMNI-F8-03, OUT-A2-01, CI-A3-01, SR-F3-04, BIB-F7-01, BIB-F8-04, BIB-F1-04, BIB-F5-04 (the merge/replace half) + BIB-A3-02 (replace-not-merge).

**In-scope-by-class but NOT covered here (flag for the PLAN):**
- **SR-F3-04 / SR-F1-01 / SR-A2-01 (C9/C1 overlap):** the search position-cache staleness. C1 *touches* SR-F3-04 because it's an unstable-key symptom, but the actual fix is **C9's** "resolve at measure time via `getBus(editor).structure` / `useInTextPositions`." This design supplies the bus-driven `regenIds` plumbing search can lean on, but the search-panel memo rewrite itself is C9's locus. **Recommend the PLAN assigns SR-F3-04 to whichever theme owns C9** and treats T1 as the dependency.
- **C16 plural-command toggle** (CI-F5-01, CI-F7-02, CI-F5-02 …): the singular↔plural / biblatex round-trip is a *command-shape* inverse, unrelated to identity. Out of scope; belongs with the citation-command theme.
- **C26 `\b` matcher** (BIB-F7-04): we *consume* the boundary-class builder for the cascade's `\cite{}` rewrite, but the builder itself is C26's deliverable. T1 depends on it landing.
- **BIB-F5-03** (editor `\cite{}` not rewritten on rename) was adjudicated **refuted** as a standalone but is the *correct deep behavior* — the cascade's doc-rewrite step implements it. No separate bug credit; it's the mechanism, not a fix target.

---

## 7. Keystroke-sanctity + test impact

**Invariants touched / honored:**
- The id-regen reconciliation MUST be **event-driven from the structural diff**, never a doc walk. The observer already emits `addedCitations`/`removedCitations`/`changedCitations` keyed by `citationId` (`doc-structure/structure-index.ts:285-301`, `types.ts:48`). The cascade's `regenIds` matcher runs **only inside the appendTransaction/diff consumer** when `addedCitations.length && removedCitations.length` on the *same* transaction (the signature of a markerless re-parse), matching dropped↔added by `command`. A plain keystroke produces neither → zero work. This replaces the mount-gated `syncFromEditor`, which is the C17 sibling — but we do NOT add an `editor.on('update')` subscriber; we ride the existing bus consumer.
- `__virgilBusStats()` invariant unchanged: typing N plain chars must leave `emitCount` flat. The cascade subscribes to **structural** events only.
- Card-source memos that gain a uid dependency must still gate on the **per-category structural counters** from `useStructuralRevisions` + the reactive `editor` instance (per AGENTS card-source rule), never a `docVersion` from `on('update')`. The annotations/review hooks are pure sidecar state (no editor walk) so they're unaffected.

**New tests:**
- `bib-uid.test.ts`: mint-on-missing, `\vbid` round-trip survives parse→serialize→parse, two same-citekey blocks get distinct uids.
- `identity-cascade.test.ts`: rename cascades to all registered migrators in one batch; rename rewrites every `\cite{oldKey}` in a doc fixture (incl. a cite **inside a footnote** — guard against the C10 descend blind spot); rename with a punctuation citekey uses the boundary matcher; `regenIds` remap re-points selection/float/pin given a synthetic add+remove diff.
- Migration tests: legacy `annotations.json` (citekey-keyed) → uid-keyed with orphan bucket; renamed-before-upgrade annotation lands in `orphanByKey`, not lost.
- `migrateFloatKeys` bib citekey→uid lockstep (keys + positions), unresolvable key dropped.
- Outline: collapse a section, insert a block above, assert the *same* section stays collapsed (OUT-A2-01 regression).
- A `step-inspector`/`structure-index` test asserting a markerless re-parse yields the expected add+remove diff the cascade keys on.

**Existing tests likely affected:** `auto-title.test.ts` (static source-grep guards — unaffected unless a string moves); any `bib-parser` test asserting `Record<key>` parse output (must update to array+uid); `useCitations` rename tests; float-key migration tests. The `usePersistentState` migrate-path tests for annotations/bib-review need v2 fixtures.

---

## 8. Cross-theme dependencies & ordering

**Shared model with T2 — the explicit assumption + flag for the PLAN:**

> **Assumption:** T2 (the card/anchor identity+lifecycle theme) and T1 share the **inline-atom identity spine** — `citationId`/`footnoteId`, the `\vcid`/`\vfid` round-trip, the `DocStructureBus` `CitationEntry`/`FootnoteEntry` diffs, and the float-key/`cardStore`/pruner reconciliation. T1 OWNS: the **bib-entry `uid`**, the **citekey-rename cascade**, and the **bus-driven `regenIds` reconciliation primitive**. T2 OWNS: the dangling-ref pruner exemption (C14), the orphan-recovery lifecycle (C3/C21), and the selection/float reconciliation on hard delete.

The risk of collision: both themes want to react to the observer's citation/footnote add/remove diff. **They must use ONE consumer, not two.** T1's `regenIds` matcher and T2's pruner-reconciliation are two *policies* over the same diff. Proposal for the PLAN: T1 lands the **`IdentityCascade` + the single bus-diff consumer** (the mechanism); T2 registers its pruner/float-reconciliation **as migrators/handlers on that consumer** rather than adding its own subscription. This keeps the keystroke-sanctity subscriber count at one and makes the id-regen remap available to T2's float/selection reconciliation for free.

**Ordering:**
- **Before T1:** C26 boundary-class matcher (the cascade's `\cite{}` rewrite consumes it) — small, can be folded in or stubbed.
- **T1 before T2:** T2's hard-delete float/selection reconciliation should build on T1's `regenIds`/cascade consumer, not predate it.
- **T1 supplies, C9 consumes:** the bus-driven position primitive for SR-F3-04/SR-F1-01.
- **Independent:** OUT-A2-01 (outline fold) can land first — it's self-contained (reuse focus-view UUID anchoring) and de-risks the larger change.

---

## 9. Risk + rollout

**Overall risk: MEDIUM-HIGH** (touches the `.bib` parse/serialize round-trip + a DATA-LOSS sidecar migration), de-risked to MEDIUM by sequencing.

**Incremental, behind a staged rollout — not big-bang:**
1. **Stage 0 (no behavior change):** add `BibEntry.uid` mint + `\vbid` round-trip + parser array-not-Record. Pure plumbing; uid unused by UI. Ship + soak — verify the showcase sample (`samples/annotation-history`) round-trips byte-stable except the new `\vbid` lines.
2. **Stage 1:** sidecar uid re-key + non-destructive migrations (orphan buckets). Annotations/review now uid-keyed; rename still goes through the old path. Verify no annotation loss on a rename across the migration boundary.
3. **Stage 2:** introduce `IdentityCascade`; route `commitEditBib` rename + the editor `\cite{}` rewrite through it. This is the DATA-LOSS fix landing.
4. **Stage 3:** bus-driven `regenIds` (the markerless-reparse case) + float/pin/omni re-point.
5. **Stage 4:** export-via-serializer, merge/replace split, outline fold-by-uuid (each independently shippable).

**De-risking:**
- **Feature flag** the cascade routing (`virgil:identity-cascade`) so Stage 2/3 can fall back to the old `updateBibKeyAndType` if a regression surfaces.
- **Non-destructive migrations only** — orphan buckets mean a wrong uid-match is recoverable, never a silent delete (this is the DATA-LOSS class; the bar is "never lose prose").
- **Byte-diff the showcase sample** `.bib`/`.tex` at each stage; refresh `virgil-data/doc_devtest` from `samples/annotation-history` per AGENTS and smoke-test a rename live (FSA picker caveat: load the dev doc via the forced-dev-storage flag).
- Keep `\vbid` a `\providecommand{\vbid}[1]{}` no-op so a paper opened in raw LaTeX never breaks.

---

## 10. Implementation checklist (ordered, individually verifiable)

1. **C26 dep:** confirm/land the boundary-class whole-word builder; expose it for the cascade. *Verify:* unit test `+foo`/`foo!` citekey rewrite.
2. `bib-uid.ts`: mint + `\vbid` parse/serialize + `\providecommand` guard. *Verify:* `bib-uid.test.ts` round-trip + same-citekey-distinct-uid.
3. `parseBibFile`/`extractRawEntries` → uid-bearing array; drop `Record<key>` collapse. *Verify:* dup-citekey fixture yields 2 entries (BIB-A3-01/F1-04/F7-02 regression).
4. `serializeBibFile` emits `\vbid`; `serializeBibForExport` fallback; rewire `handleExportCited`. *Verify:* in-memory `raw:''` entry exports reconstructed block (BIB-F7-01/F8-04).
5. `BibEntry.uid` in types; thread uid through `bibEntryMap`/`getBibEntry`. *Verify:* typecheck + existing citation tests green.
6. `AnnotationsState` v2 + `useAnnotations` uid keying + non-destructive migrate (orphan bucket). *Verify:* migration test; annotation survives a citekey rename across upgrade (BIB-A2-01).
7. `bib-review-requests` `entryUid` + migrate. *Verify:* pending review survives rename (BIB-A2-02).
8. `IdentityCascade` service + migrator registry; register annotations/review/citation-refs migrators. *Verify:* `identity-cascade.test.ts` fan-out batch.
9. Cascade rename rewrites editor `\cite{}` in one tx, descending into footnotes (C10-safe). *Verify:* doc fixture incl. in-footnote cite; assert no `syncFromEditor` revert.
10. Route `commitEditBib` rename + Save(replace) through cascade; `replaceBibEntry`/`updateBibEntry` split. *Verify:* clear-a-field deletes it (BIB-F5-04); replace-not-merge (BIB-A3-02).
11. `selectedBibUid` + `occurrenceIdxByUid` + read-time clamp. *Verify:* rename keeps selection (BIB-A2-03/F2-01); cycle past delete doesn't read 3/2 (BIB-F3-02).
12. Float key citekey→uid; `registerCardFloatable("bib", uid)`; lockstep `migrateFloatKeys`; cascade wires `remapCardPopKey` for rename. *Verify:* popped bib float survives rename, dead key dropped (BIB-A2-04).
13. Bus-driven `regenIds` consumer (single subscriber); citations sidecar reconciles via remap, not mount. *Verify:* markerless re-parse fixture re-points cards (OMNI-F3-02, CI-A3-01); `__virgilBusStats` flat on plain typing.
14. Omni pin/pos + selection re-point on `regenIds`. *Verify:* OMNI-A1-01/F8-02/F8-03.
15. Outline fold resolve-by-uuid; drop `heading-${idx}`. *Verify:* insert-above keeps section collapsed (OUT-A2-01).
16. Feature-flag gate + showcase byte-diff + live rename smoke-test. *Verify:* full suite (1100+ tests) green; sample refresh clean.
