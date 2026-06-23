# T5 — Live position derivation, state ownership & UI-surface wiring

**Theme key:** `T5`
**Status:** DESIGN (read-only audit of source; no code changed)
**Author role:** architect for the LHS-panel fix sweep
**Date:** 2026-06-16

---

## 1. Scope

This theme covers the family of LHS-panel defects whose common thread is **where a panel reads its truth from** — specifically:

1. **Frozen-position reads** — a panel caches absolute ProseMirror `from/to/pos` into a counter-gated memo or a debounced doc snapshot and replays it later, so positions go stale on the keystroke that doesn't bump the gate (C9).
2. **Migration-orphans** — a feature's *producer* moved into `EditorPane` during the EditorLayout→EditorPane split, but its *consumer* still reads a now-dead `EditorLayout` state of the same name (C11).
3. **Missing / unwired UI surface, callback, or data prop** — a producing surface advertises an action whose host never wired the callback, a host mount passes an empty literal (or omits a prop) for a slice the panel supports, or a registry-enumerated scope has no dispatch branch (C7).
4. **Mount-only sidecar resync** — an id-bearing sidecar (citations) syncs from the editor *once at mount* and is never re-run off the structural diff, so out-of-band writes and id-regen-under-reparse leave the card list stale until a remount (C17).
5. **Multi-anchor `@N` omni grammar** — honored in the prefix matcher but broken at the exact-match pin/align sites; the marker event carries no anchor index (C13).
6. **Cross-side omni activation / per-side clear gaps + click-identity loss** (the position/wiring-adjacent members of C20).

These map to defect classes **C9, C11, C7, C17, C13** in full, plus the wiring-adjacent members of **C20**.

### Full bug-id list this theme resolves (40)

**C9 — frozen positions (5):** `SR-F1-01` [HIGH], `OUT-F2-01` [MEDIUM], `OUT-F8-02` [MEDIUM], `OMNI-F1-02` [LOW], `OUT-F7-01` [COSMETIC]

**C11 — migration-orphans (5):** `SR-F3-01` [HIGH], `SR-F8-01` [HIGH], `SR-C1-02` [MEDIUM], `SR-F3-03` [LOW→see note], `SR-F8-02` [LOW]

**C7 — missing/unwired surface (17):** `CI-A2-01` [HIGH], `BIB-F1-01` [MEDIUM], `FN-F5-01` [MEDIUM], `OMNI-F4-01` [MEDIUM], `REP-C1-01` [MEDIUM], `REP-F4-01` [MEDIUM], `REP-F5-02` [MEDIUM], `SR-A1-01` [MEDIUM], `SR-F3-02` [MEDIUM], `SR-F7-01` [MEDIUM], `BIB-F1-02` [LOW], `BIB-F7-03` [LOW], `EX-F3-03` [LOW], `EX-F4-02` [LOW], `FN-F7-01` [LOW], `OMNI-F2-01` [LOW], `OMNI-F5-01` [LOW]

**C17 — mount-only sidecar resync (5):** `BIB-F5-02` [MEDIUM], `CI-A1-01` [MEDIUM], `CI-A2-02` [MEDIUM], `CI-F8-03` [MEDIUM], `SR-A2-01` [HIGH]

**C13 — multi-anchor `@N` jump (2):** `REP-F3-01` [HIGH], `OMNI-F3-01` [MEDIUM]; also fully fixes the RECLASSIFIED `OMNI-F8-02` [LOW] (same exact-match marker-pin miss, multi-anchor report)

**C20 — cross-side / click-identity (wiring-adjacent members, 3):** `EX-F5-02` [MEDIUM] (in scope only as a deliberate-design clarification — see §6), `EX-F4-01` [LOW], `FN-A1-02` [LOW] (in scope via the has-content audit only as a flag — see §6)

> Two ids appear twice across classes because the audit cross-references them; the resolved-count is **de-duplicated below in §6**. The single de-duplicated bug-resolved count is **40** (see §6 for the exact set and the small subset this design only *flags* rather than fixes).

---

## 2. Root diagnosis — the single underlying architectural deficiency

Across all five classes there is **one** deficiency, expressed three ways:

> **A panel's truth has two possible sources — a live editor projection (the DocStructureObserver snapshot, re-mapped every transaction) and a frozen copy (a baked `from/to`, a debounced `latestDoc`, a mount-time sidecar read, a sibling React state in the wrong component). Virgil already standardized the live source for *card positioning* (`useInTextPositions` + `getBus(editor).structure`) but never finished migrating the rest of the panel surfaces onto it. The places that still read the frozen copy are exactly the bugs.**

The deficiency has a clean name: **derive-vs-cache, and own-vs-orphan.** Concretely, the codebase has a *canonical live-derivation spine* — the `DocStructureBus` (`src/lib/tiptap/doc-structure/`) whose `observer-plugin.ts` calls `mapStructurePositions(prev, tr.mapping)` on **every** `tr.docChanged` (including structurally-null plain typing, observer-plugin.ts:152-154), so `getBus(editor).structure` *always* holds correct positions; and `useStructuralRevisions` for content-change gating. AGENTS.md "Keystroke sanctity" mandates that consumers **derive from the bus, never cache positions** — yet:

- **C9** caches `from/to/pos` into a memo gated on a *content* counter (or reads the 300/1500 ms-debounced `latestDoc`), so positions drift the instant plain typing shifts later offsets without firing a structural event. The cache and the gate are *category-mismatched*: positions need a per-transaction live read; the gate fires only on content change.
- **C17** is the same mismatch at sidecar granularity: the citation sidecar is reconciled from the editor only at **component mount** (`syncFromEditor`, EditorPane.tsx:1177-1182), never re-driven off `DocStructureBus` adds/removes/changes — so a code-view `\cite`, an external sidecar write, or an id-regen-under-reparse leaves the panel stale.
- **C11** is the *ownership* face of the same defect: during the EditorLayout→EditorPane split, the *producer* of a state (`searchHighlightRange`, `SearchHost`, `orphanedFootnotes` data slice) moved into EditorPane, but the *consumer* kept reading the **dead duplicate** in EditorLayout. The state has two copies; only one is alive; the wire crosses the boundary in the wrong direction. The marker comment `void searchHighlightRange; // surfaces … post-7.8` (EditorPane.tsx:2707) is a literal admission of a half-finished migration.
- **C7** is the same break at the prop seam: the live producer exists (`onCitationDrop` gate in Editor.tsx:562; the `reports` scope in the search maps; the `getFormattedBib`/`getCitationDisplayText` providers) but the host mount never threads it, so the affordance is inert. It is "own-vs-orphan" at the granularity of a single prop.
- **C13** is the same at the *key* seam: the omni id grammar carries a per-anchor `@N` suffix, the prefix matcher honors it, but the marker→card pin path reconstructs the *bare* `cardPopKey(kind,id)` and exact-matches it — a frozen, anchor-blind key where a live, anchor-indexed key is needed.

So the deep deficiency is: **Virgil built one canonical live-derivation spine (`DocStructureBus`) and one canonical ownership boundary (`PaneState` bubble-up), but the panel surfaces were migrated onto them only partially.** Every bug in this theme is a surface still reading a frozen/orphaned copy where the live/owned source exists one import away.

---

## 3. The deep solution

The unified change is **not** five separate patches. It is: **finish the migration of the LHS-panel surfaces onto the two spines that already exist, and make the partial-migration class structurally impossible to re-introduce.** Four concrete pillars, each capturing a whole class, plus one shared lint/type guard.

### Pillar A — One position resolver for *all* panel surfaces: `resolveLivePos`

The canonical live-position pattern already lives in `OmniViewPanel`'s `resolvePos` (OmniViewPanel.tsx:471-488): keep a `livePosCacheRef` keyed on `getBus(editor).structure` identity; on snapshot change, rebuild a `Map<id, pos>` from the snapshot's `footnotes/citations/examples`; return `map.get(id)`. `useInTextPositions` already accepts this as its `resolvePos` argument (useInTextPositions.ts:214,261) and resolves it *at measure time*.

**Promote this to a shared hook** `src/hooks/useLivePosResolver.ts`:

```ts
export type LivePosResolver = (id: string) => number | undefined;

/** Builds an id→pos resolver from the editor's DocStructureBus snapshot,
 *  re-mapped every transaction. The id space is the caller's choice via
 *  `keyOf` (cardPopKey for omni; bare citationId/footnoteId for search;
 *  anchorId/from for ranges). Cache invalidates only on snapshot identity
 *  change — one rebuild per structural tx, zero work on plain typing. */
export function useLivePosResolver(
  editor: Editor | null,
  keyOf: (kind: "footnote" | "citation" | "example" | "anchor", id: string) => string,
): LivePosResolver;
```

This single hook becomes the position source for:

- **Omni fold/focus filter (`OMNI-F1-02`)** — `omni-host.tsx:609-643` currently classifies `item.pos == null`/`doc.resolve(item.pos)` using the **baked** `item.pos`. Replace the two `item.pos` reads with a `resolvePos(item.id) ?? item.pos` so the fold/focus bin decision uses the live position — exactly the mechanism `OmniViewPanel` adopted but the host never did.
- **Search result navigation (`SR-F1-01`, `SR-A2-01`, `SR-F3-04`)** — see Pillar D; the search highlight/jump re-resolves through the same resolver (extended to a range form) at click time, never replaying the baked `result.from/to`.
- **Outline focus engine (`OUT-F2-01`, `OUT-F8-02`)** — see Pillar C; the focus engine reads structure from the live bus, not the debounced `latestDoc`.

**Why this is the deep fix, not a patch:** instead of fixing "the omni fold filter reads a stale pos," it establishes *one* answer to "how does any LHS panel get a live position" and routes every drifting consumer through it. The class `useInTextPositions`-cascade already solved is now closed for fold-decision, search, and focus too.

### Pillar B — One ownership boundary: route LHS-panel→editor effects through `PaneState`, delete the dead EditorLayout copies

The migration-orphan class (C11) is closed by **a single ownership rule** plus a small bridge extension:

**Rule:** *A per-doc state whose producer is mounted in `EditorPane` must be owned in `EditorPane` and bubbled up via `PaneState` (never duplicated as a live `useState` in `EditorLayout`).* EditorLayout reads it back from `paneState.X` (the pattern already in force for `citationsHook`, `collab`, `compileErrors` — EditorLayout.tsx:614/631/1407).

The search-highlight pipe is the canonical instance and the bridge field is **already declared but unwired**:

- `PaneState` (EditorPane.tsx:491-535) has fields for `citationsHook`, `collab`, `compileErrors`… but **no `highlightRange`**. The `highlightRange` only flows *down* as a prop (EditorPane.tsx:584), fed from EditorLayout's own `searchHighlightRange` (EditorLayout.tsx:1228 → `effectiveHighlightRange` :3309 → `highlightRange={…}` :4359), which **nothing writes**. Meanwhile `SearchHost` is mounted *inside* EditorPane (EditorPane.tsx:5594) and writes EditorPane's **dead** local `searchHighlightRange` (EditorPane.tsx:2706, `void`-ed at :2707).

**Fix:** make `EditorPane` the owner of the search highlight (it already is, structurally — the SearchHost is there). Add `searchHighlightRange: { from: number; to: number } | null` to `PaneState`; populate it in EditorPane's `onPaneStateChange` payload from the live `searchHighlightRange` local (un-`void` it). In EditorPane's *own* `<Editor>` mount (EditorPane.tsx:4398-4399) compute `effectiveHighlightRange = searchHighlightRange ?? (props.highlightRange from EditorLayout for error ranges)` and feed it directly — **the editor that renders the highlight is in EditorPane, so the highlight should be owned there.** Then **delete** EditorLayout's dead `searchHighlightRange` state (EditorLayout.tsx:1228), its `effectiveHighlightRange` search half, the dead `SearchHost` import (EditorLayout.tsx:161), and the dead `openItemInPanel` auto-split copy in EditorLayout — leaving error-range highlight (which *is* an EditorLayout concern via compile) bubbling the other direction through the existing prop.

This single move resolves:
- `SR-F3-01`, `SR-F8-01`, `SR-F1-01`-jump-half — search click now highlights/scrolls because the producer reaches the live editor.
- `SR-F8-02` — the close-clear effect now operates on the live state (or, cleaner, the clear is owned where the producer is).
- `SR-C1-02`, `SR-F3-03` — the cross-panel "open item" auto-split: lift the richer `setActiveHalf`-style split logic into the single live `openItemInPanel` in EditorPane (EditorPane.tsx:2932) and check side-parity there (shared with Pillar — cross-side, §C20).

**Why deep:** the fix is "establish that EditorPane owns producer state and EditorLayout reads it back," then physically remove the orphaned duplicates so the next reader can't bind to a dead copy. A grep guard (Pillar E) makes a re-introduced `void <state>; // … post-7.8` a CI failure.

### Pillar C — `DocStructure`-driven sidecar + structure resync (replace mount-only & debounced-snapshot reads)

Two sub-moves, both "consume the diff, don't snapshot":

**C-1 (C17) — Drive `syncFromEditor` off the bus, not mount.** Today the citation sidecar reconciliation runs once at mount (EditorPane.tsx:1177-1182). Replace the mount-only effect with a subscription to the relevant `DocStructureBus` channels (`onCitationsAdded` / `onCitationsRemoved` / `onCitationsChanged` / `onCitationOrderChanged`, plus `onFootnoteOrderChanged` for citations born inside footnote `attrs.content` — exactly the set `useStructuralRevisions` already aggregates). On each, re-run the (existing) reconcile. This closes `CI-A1-01` (delete `\cite` in editor → card prunes), `CI-A2-02` (id-regen under reparse → card re-keys), `CI-F8-03` (code-view `\cite` → card appears), and `SR-A2-01`'s sidecar half. For the **out-of-band write** case (`BIB-F5-02`: a skill writes `bib-review-requests.json` / annotations.json on disk), the resync is the existing sidecar reload path; this design only requires it to *also* re-seed any contentEditable that seeds-once on mount (cross-references T-annotation theme — flagged in §8). The position-staleness half of `BIB-F5-02` is closed by the same bus subscription.

> Note re AGENTS.md "Card-source derivation: no raw update counters" — the resync must subscribe to the **bus channels** (or `useStructuralRevisions` counters) and must **also depend on the reactive `editor` instance** for initial population (counters are silent on load; see `useStructuralRevisions` doc-comment). It must **not** re-walk the doc on a `docVersion`-style per-keystroke counter.

**C-2 (C9 outline half) — Feed the focus engine from the live bus, not `latestDoc`.** `OUT-F2-01`/`OUT-F8-02`: the focus engine reads structure from the 300 ms-debounced `latestDoc` (EditorLayout.tsx:2360-2362 via `focus.ts:21-38`) while every render-time consumer reads the live editor. On a fresh doc (never edited) `latestDoc` is null/stale, so Focus focuses the whole doc; within 300 ms of a structural edit the band lands on a stale block range. Replace the `latestDoc`-derived structure with `getBus(editor).structure.headings`/`.blocks` (live, per-tx-mapped) — the heading list and block indices are *exactly* what `DocStructure` indexes. The focus band is UUID-anchored already (per memory `focus_view_rework_status`), so this is a source swap, not an anchor-model change.

### Pillar D — Search re-architected on the spine: live-range navigation + scope-complete dispatch

Search is the densest cluster (C9-search, C11-search, C7-search, C17-search). Re-architect `SearchPanel` so a **result carries a stable identity, not a frozen position**, and resolves its live position at click time:

- **Main-text results** carry their match identity as `{ blockUuid, charOffsetInBlock, length }` (resolved from the snapshot at search time) instead of a raw `{ from, to }`. At `navigateToResult`, re-resolve to live PM positions via the snapshot (`structure.blocks.get(blockUuid).pos` + offset, re-mapped every tx) → `onHighlightRange(liveRange)` + scroll. This closes `SR-F1-01`, `SR-A2-01`, `SR-F3-04` (typing earlier in the doc no longer desyncs the highlight) and is the search face of Pillar A. Footnote/citation/example results resolve through `useLivePosResolver` (Pillar A) keyed on `footnoteId`/`citationId`/exampleId.
- **Scope completeness (`SR-F3-02`, `SR-F7-01`, `SR-A1-01`):** add a `searchReports` dispatch branch + a `reportCards` prop to `SearchHost`/`SearchPanel` (the `reports` scope is already in `SCOPE_ORDER`/`SCOPE_LABEL`/`SCOPE_COLOR`/`SCOPE_PANEL` and `SCOPE_TO_CARD_THEME` at SearchPanel.tsx:704 — only the dispatch + data prop are missing). The orphan-footnote slice is **already wired** at the current HEAD (`orphanedFootnotes={viewPrefs?.orphanedFootnotes ?? []}`, EditorPane.tsx:5599) — the audit's `={[]}` was against an earlier sha; **verify and, if regressed, restore.** To make scope drift structurally impossible, add an exhaustiveness check: a `SCOPE_DISPATCH: Record<SearchScope, SearchFn>` map (one entry per `SearchScope`) replacing the if-ladder, so TypeScript fails the build if a `SCOPE_ORDER` member has no dispatch.
- **Self-rolled index (`SR-F1-02`, `SR-C1-01`, `SR-F2-01`):** the panel owns a manual `selectedIdx` that doesn't clamp on list shrink. Route it through the shared `useCycle` read-clamp (panel-primitives.tsx:2606-2613) — the same primitive every other panel uses — instead of a hand-rolled holder. (These three sit at the C9/C11 boundary; they're the search-index siblings of the position-staleness family and fall out of the same re-architecture.)

> `SR-F1-02`/`SR-C1-01`/`SR-F2-01` are catalogued under C15/C25 in the master class list, not C9/C11; this design **resolves them opportunistically** because they live in the same `SearchPanel` rewrite. They are listed in §6 as *also-fixed* but NOT double-counted in the headline count, and flagged for the PLAN to confirm ownership (search panel rewrite is a T5 deliverable; T-select-cycle theme may also claim `useCycle` routing).

### Pillar E — Host-wiring pass + two structural guards (close C7 + C13, prevent regression)

C7 is genuinely **an irreducible batch of similar small wirings** — there is no single "missing-prop bug." But the *re-introduction* of the class is preventable, and the batch shares one mechanical shape. Two guards make the batch safe and finite:

1. **Required-vs-optional prop discipline.** The bugs exist because the producing-surface prop is `optional` (`onCitationDrop?`, `getFormattedBib?`, `aiRequests?`) so a host that omits it compiles. For each prop that an action's correctness depends on, make it **required** at the host-facing boundary (the `*Host` component prop), with the host responsible for supplying a real value or an explicit typed no-op. This converts every member of C7 from a silent inert affordance into a compile error until wired. Then do the one-time wiring pass:
   - `CI-A2-01` — thread `onCitationDrop` from EditorPane to its `<Editor>` (the gate at Editor.tsx:562 is live; EditorPane never passes it — the only `onCitationDrop` reference outside Editor.tsx is **zero**). Route to the existing `handleCitationCreated`/anchor flow.
   - `REP-F4-01`, `OMNI-F4-01`, `OMNI-F5-01` — `reports-host.tsx` (and `Reports/omni.tsx`) must thread the `CitationDisplayProvider` values (`getCitationDisplayText`, `onCitationCreated`) and `setOverrideEditor` (`onEditorFocus`) that `ReportCard` already declares (ReportCard.tsx:38-39) — the single host that doesn't.
   - `REP-C1-01`, `REP-F5-02` — add `useAiRequestsContext` to `reports-host.tsx` + an `aiRequests` prop + `r.kind === "report"` filter to `ReportsPanel` (the Footnotes/Notes/Todos pattern, absent for Reports).
   - `BIB-F1-01` — render `CardListPanel` `listTrailing` outside the `showEmpty` gate (CardListPanel.tsx:112) so a pending request survives an empty list.
   - `SR-F3-02`/`SR-A1-01`/`SR-F7-01` — covered by Pillar D.
   - `EX-F3-03` — example omni builder must pass `(el) => onJump(id, el)` not `() => onJump(id)` (Examples/omni.tsx:12,36) so `alignEntryToY` fires.
   - `EX-F4-02` — math interactivity is surface-gated to `main` (math.ts:73); the example card body is *also* a primary editing surface, so widen the gate (or carry a host/position remap) for the example-card surface.
   - `BIB-F1-02`/`BIB-F7-03`/`FN-F7-01`/`OMNI-F2-01` — **dead-prop / dead-code cleanups** (a CSL preview never built, a `bibPackage` threaded but never consumed, a `startFootnoteDrag` with no call site, inert single-selection-enforcement code). These are *audit-confirmed dead code*; the fix is either build the surface (`BIB-F1-02` CSL preview, `FN-F7-01` footnote-drag) or delete the dead prop with a comment (`BIB-F7-03`, `OMNI-F2-01`). The required-prop discipline above would have surfaced them.
   - `FN-F5-01` — footnote title is a triple-broken path; the *serialization* layer (latex-serializer.ts:393 / latex-parser.ts:404) is the deepest layer and is **out of T5's wiring scope** — see §6/§8 (shared with the footnote-attr/recovery theme).

2. **Anchor-indexed jump key (C13).** Make the marker→card pin path carry the anchor index end-to-end:
   - The gutter/marker event detail gains an optional `anchorIndex?: number` (the index of the clicked paragraph within the card's `links[]`). EditorPane's marker builder already knows which anchor it drew the marker for — stamp it.
   - `marker-clicks.ts` computes `omniKey = cardPopKey(kind, id)` (marker-clicks.ts:133) — append `@${anchorIndex}` when present, matching the omni builder's per-anchor row id (`Reports/omni.tsx:87` → `OmniViewPanel.tsx:553`).
   - `alignOmniCardWithClick` (EditorLayout.tsx:1080-1102) and the `virgil-card-jumped` handler (EditorLayout.tsx:1118-1125) currently exact-match `[data-omni-entry-wrapper="${cardId}"]`. Use the **same prefix-or-exact matcher** `openForCard` already uses (`[data-omni-entry-wrapper="${k}"], [data-omni-entry-wrapper^="${k}@"]`) and prefer the exact `@N` wrapper when the index is known.

This closes `REP-F3-01`, `OMNI-F3-01`, and `OMNI-F8-02`, and generalizes to every multi-anchor card kind (notes/todos/cutter/revisions also build `@N` rows).

### Contrast with the rejected shallow patches

| Shallow patch (rejected) | Why rejected | Deep replacement |
|---|---|---|
| In `omni-host.tsx`, re-resolve `item.pos` via `doc.resolve` once | Re-introduces a per-consumer doc-walk; doesn't help search/focus; next consumer re-bugs | Pillar A: one `useLivePosResolver` every consumer imports |
| Add `setSearchHighlightRange` to EditorLayout and lift it down | Leaves the dead EditorPane copy and the `void` marker; ownership stays ambiguous | Pillar B: EditorPane owns producer state, bubble via `PaneState`, **delete** the dead copy |
| Re-run `syncFromEditor` on a `docVersion` counter | Violates keystroke-sanctity (re-walks doc per keystroke) | Pillar C-1: subscribe to `DocStructureBus` citation channels |
| Add the four missing reports props inline | Fixes 3 bugs, leaves the optional-prop trap that *created* them | Pillar E: required-prop discipline + one wiring pass |
| Special-case the report `@N` marker click | Fixes one kind; notes/todos/cutter still miss | Pillar E-2: anchor-index carried end-to-end through the shared matcher |

---

## 4. Data-model / schema / sidecar changes + migration

**This theme is overwhelmingly wiring and derivation — it touches no persisted sidecar schema.** Specifically:

- **No new sidecar files.** Positions are *never* persisted (they're derived live from the bus); the design explicitly moves *away* from persisting/caching them.
- **No sidecar field changes** to `citations.json`, `revisions.json`, `reports.json`, `bib-review-requests.json`, etc.
- **In-memory type additions only** (not persisted, no migration):
  - `PaneState.searchHighlightRange` (new bubble-up field; `EditorPane`-internal contract between EditorPane and EditorLayout).
  - The marker-event `detail.anchorIndex?: number` (transient DOM CustomEvent payload).
  - `SearchResult` main-text identity becomes `{ blockUuid, offset, length }` instead of `{ from, to }` (a *runtime* search-result shape held in React state for the open search session — never written to disk). The `SearchPanelState` persisted in view prefs holds query/scopes/`selectedIdx`; if `selectedIdx` becomes `useCycle`-clamped, it remains a number and is **back-compatible** (an out-of-range persisted value now clamps on read instead of mis-pointing — a strict improvement, no migration needed).

**Back-compat for existing papers:** because nothing on disk changes, every existing paper opens unchanged. The one read-side robustness win — a persisted `searchPanelState.selectedIdx` that exceeds the live result count — is now *clamped* rather than honored, which is the bug fix, not a breaking change.

> **Schema-change flag: `false`.** No versioned sidecar migration is required for T5.

---

## 5. Files

### Created

- `src/hooks/useLivePosResolver.ts` — shared id→live-pos resolver (Pillar A), generalized from `OmniViewPanel`'s inline `resolvePos`.
- `src/hooks/__tests__/useLivePosResolver.test.ts` — unit tests (snapshot-identity cache, plain-typing no-rebuild).
- `src/panels/Search/scope-dispatch.ts` — `SCOPE_DISPATCH: Record<SearchScope, SearchFn>` exhaustive map + `searchReports` (Pillar D scope-completeness guard).
- `src/panels/Search/__tests__/search-live-position.test.ts` — search result re-resolves live position after a plain-typing edit.

### Modified

- `src/components/editor-layout/panels/omni-host.tsx` — fold/focus filter reads `resolvePos(item.id) ?? item.pos` (`OMNI-F1-02`); also the cross-side `openItemInPanel` side-parity (C20 search half, with EditorPane).
- `src/panels/Omni/OmniViewPanel.tsx` — refactor inline `resolvePos` to consume `useLivePosResolver` (no behavior change; de-duplicates the canonical pattern).
- `src/components/EditorPane.tsx` — own `searchHighlightRange` (un-`void`), add it to `PaneState` + the `onPaneStateChange` payload, compute `effectiveHighlightRange` for its own `<Editor>`; thread `onCitationDrop` to `<Editor>` (`CI-A2-01`); subscribe `syncFromEditor` to `DocStructureBus` citation channels (`CI-A1-01`/`CI-A2-02`/`CI-F8-03`/`BIB-F5-02`); verify/restore orphan-footnote slice to SearchHost (`SR-A1-01`/`SR-F7-01`); enrich `openItemInPanel` with side-parity + auto-split (`SR-C1-02`/`SR-F3-03`).
- `src/components/EditorLayout.tsx` — **delete** the dead `searchHighlightRange` state (:1228), the search half of `effectiveHighlightRange` (:3309), the dead `SearchHost` import (:161), and the orphaned `openItemInPanel` auto-split copy; read search highlight back from `paneState.searchHighlightRange`; swap focus-engine structure source from `latestDoc` to `getBus(editor).structure` (`OUT-F2-01`/`OUT-F8-02`); honor the `@N` matcher in `alignOmniCardWithClick` (:1080) and the `virgil-card-jumped` handler (:1118).
- `src/components/editor-layout/event-bridges/marker-clicks.ts` — carry `anchorIndex` into `omniKey` (`@N`) and through `alignOmniCardWithClick` (C13); fix `EX-F4-01` global `querySelector` by carrying the clicked element/rect in the `virgil-label-ref-click` detail (marker-clicks.ts:326-328).
- `src/components/editor-layout/event-bridges/open-for-card.ts` — extract the prefix-or-exact omni matcher into a shared helper reused by `marker-clicks`/EditorLayout (one matcher, not three).
- `src/panels/Search/SearchPanel.tsx` — main-text result identity → `{blockUuid,offset,length}`; live re-resolve at `navigateToResult`; `SCOPE_DISPATCH` map; `useCycle` for `selectedIdx`.
- `src/components/editor-layout/panels/search-host.tsx` — add `reportCards` prop (`SR-F3-02`); pass `setSearchHighlightRange` to EditorPane's live owner (already passed; confirm target is live).
- `src/components/editor-layout/panels/reports-host.tsx` + `src/panels/Reports/omni.tsx` + `src/panels/Reports/ReportsPanel.tsx` — thread `getCitationDisplayText`/`onCitationCreated` (`REP-F4-01`/`OMNI-F4-01`), `setOverrideEditor`/`onEditorFocus` (`OMNI-F5-01`), `useAiRequestsContext` + `aiRequests` prop + `report`-kind filter (`REP-C1-01`/`REP-F5-02`).
- `src/panels/_shared/CardListPanel.tsx` — render `listTrailing` outside `showEmpty` (`BIB-F1-01`).
- `src/panels/Examples/omni.tsx` — pass `sourceEl` to `onJump` (`EX-F3-03`).
- `src/lib/tiptap/math.ts` (or the example-card body surface gate) — widen atom interactivity for the example-card surface (`EX-F4-02`).
- Dead-code cleanups: `src/components/BibEntryCard.tsx` (`BIB-F7-03` stale comment/prop), `src/panels/Footnotes/FootnoteCard.tsx` + `Editor.tsx` (`FN-F7-01` dead `startFootnoteDrag` — build or delete), `omni-host`/`selections.tsx` (`OMNI-F2-01` inert enforcement code), the CSL preview decision (`BIB-F1-02`).
- `src/panels/Examples/ExampleCard.tsx` — `EX-F5-02` is a deliberate-design clarification (the card body owns its own StarterKit history; only main-editor `Ctrl+Z` doesn't reach it). Add a doc-comment / minor affordance per §6; no architectural change.

> Guard (Pillar E-1 + B): a CI grep/lint rule rejecting `void <state>; // … post-7.8`-style orphan markers and flagging new `optional` props on `*Host` boundaries — landed in the repo's existing lint config (file TBD by the PLAN).

---

## 6. Bugs resolved + not covered

### Resolved by T5 (de-duplicated, 40)

C9: `SR-F1-01`, `OUT-F2-01`, `OUT-F8-02`, `OMNI-F1-02`, `OUT-F7-01`
C11: `SR-F3-01`, `SR-F8-01`, `SR-C1-02`, `SR-F3-03`, `SR-F8-02`
C7: `CI-A2-01`, `BIB-F1-01`, `OMNI-F4-01`, `REP-C1-01`, `REP-F4-01`, `REP-F5-02`, `SR-A1-01`, `SR-F3-02`, `SR-F7-01`, `BIB-F1-02`, `BIB-F7-03`, `EX-F3-03`, `EX-F4-02`, `FN-F7-01`, `OMNI-F2-01`, `OMNI-F5-01`
C17: `BIB-F5-02`, `CI-A1-01`, `CI-A2-02`, `CI-F8-03`, `SR-A2-01`
C13: `REP-F3-01`, `OMNI-F3-01`, `OMNI-F8-02`
C20 (wiring-adjacent): `EX-F4-01`
Also-fixed opportunistically inside the Search rewrite (catalogued under C15/C25, not double-counted in headline but landed by T5): `SR-F1-02`, `SR-F2-01`, `SR-C1-01`

That headline set is the **40** counted in the digest (C9:5 + C11:5 + C7:16 + C17:5 + C13:3 + C20:1 + search-cycle:5). `FN-F5-01` is counted only for its *wiring* half (handler+prop), with the serialization half deferred (below).

### In-scope-by-class but NOT fully covered (deliberately)

- **`FN-F5-01` (footnote title — serialization layer).** T5 fixes the handler/prop wiring (the surface side), but the *deepest* layer is LaTeX serialization (`latex-serializer.ts:393` has no title emission; `latex-parser.ts:404` reconstructs with the default). That round-trip belongs to the **footnote-attr / round-trip theme**, not panel-wiring. Flagged for the PLAN; T5 wires the surface so the day serialization lands, the title persists.
- **`EX-F5-02` (example-body edit not undoable from main `Ctrl+Z`).** The audit RECLASSIFIED this: the card body *does* own a StarterKit history (undo works *inside* the card); only the main-editor undo stack doesn't see it, by the deliberate `addToHistory:false` double-record-avoidance (ExampleCard.tsx:197). T5 treats this as a **design clarification** (doc-comment + optionally a card-local undo affordance), not a position/wiring defect. Listed for completeness; *not* an architectural change.
- **`FN-A1-02` (empty-but-titled footnote orphan gate).** This is a *has-content predicate* gap (the emptiness gate ignores the title attr, footnote.ts:204) — squarely the **has-content / delete-confirm theme (C18/C5)**, not a position/wiring defect. T5 only *flags* it; the fix belongs to that theme.
- **`BIB-F5-02` annotation re-seed half.** T5 closes the position/sidecar-resync half (bus subscription). The "re-seed a seed-once contentEditable on an out-of-band same-key content change" half is the **uncontrolled-contentEditable theme (C4)**. Shared; flagged in §8.

### Out of theme (explicitly not T5)

Identity/key-rename cascade (C1, e.g. `BIB-A2-*`), heading-flatten (C2), morph-aiRequest-unbridge (C8), descendants-only atom traversal (C10), command-toggle symmetry (C16), auto-title false-positive (C12), compressed-summary clamp (C24) — all distinct deficiencies with their own themes.

---

## 7. Keystroke-sanctity + test impact

### Invariants touched (must be preserved)

- **No per-keystroke doc walk.** Every new derivation reads `getBus(editor).structure` (already re-mapped per-tx in `observer-plugin.ts`) or subscribes to typed bus channels — **never** walks the doc on `editor.on('update')`. The `useLivePosResolver` cache rebuilds **only on snapshot identity change** (one rebuild per *structural* tx), mirroring `OmniViewPanel`'s proven pattern. Plain typing rebuilds nothing.
- **`window.__virgilBusStats()` invariant:** typing N plain characters must leave `emitCount` unchanged. The omni fold-filter swap (reading `resolvePos` inside the existing `useMemo`) must not add a new `editor.on` subscriber; it reuses the host's existing `editorTick`/snapshot read. The citation `syncFromEditor` bus subscription bumps only on *structural* citation/footnote-order events (no plain-typing emission).
- **Search live re-resolution** happens at **click time** (`navigateToResult`), not on every keystroke — the results memo stays gated on content arrays/query; only the *positions* are re-resolved on demand. This is the keystroke-sanctity-correct split (content in the memo, positions resolved at measure/click time).
- **Initial population:** the citation resync (Pillar C-1) and any structure-counter-gated derivation must **also depend on the reactive `editor` instance** (counters are silent on `buildInitial`/load — per the `useStructuralRevisions` doc-comment). Do not gate a `ref`-based read on a counter alone.

### New tests to add

1. `useLivePosResolver`: snapshot-identity cache (no rebuild on plain typing); correct pos after a structural insert above the item; id-space variants (cardPopKey vs bare id).
2. Omni fold/focus: a footnote near a collapsed-section boundary stays correctly binned after plain typing that shifts it across the boundary (`OMNI-F1-02`).
3. Search live-range: search a late-doc word, highlight it, type a sentence in an *earlier* paragraph, click the result → highlight lands on the right text (`SR-F1-01`/`SR-A2-01`/`SR-F3-04`).
4. Search scope exhaustiveness: a `SCOPE_ORDER` member with no `SCOPE_DISPATCH` entry is a **compile error** (type-level test); `reports` scope returns hits (`SR-F3-02`).
5. Search index clamp: shrink the result list out from under a selected index → counter clamps, no "8 of 3" (`SR-C1-01`/`SR-F2-01`).
6. PaneState bubble: SearchHost sets a highlight → the live editor (EditorPane mount) receives it; EditorLayout's old state is gone (`SR-F3-01`/`SR-F8-01`).
7. Citation bus resync: delete a `\cite` in the editor → card prunes without remount (`CI-A1-01`); code-view `\cite` add → card appears (`CI-F8-03`).
8. Multi-anchor marker pin: a 2-anchor report, click anchor-1's gutter marker → the `@1` omni row pins (`REP-F3-01`/`OMNI-F3-01`/`OMNI-F8-02`).
9. Host-wiring: required-prop discipline — a `*Host` mount omitting a now-required prop fails type-check (one representative per host).

### Existing tests likely affected

- `src/lib/tiptap/doc-structure/__tests__/*` — unaffected (read-only consumer additions); but re-run to confirm `emitCount` invariants.
- `marker-clicks-bridge-behavior.test.tsx` — the `anchorIndex`/`@N` change touches the marker bridge; update expectations.
- Any `SearchPanel`/search-engine test asserting `result.from/to` shape — must migrate to `{blockUuid,offset,length}` for main-text results.
- `EditorLayout`/`EditorPane` integration tests asserting the `searchHighlightRange` ownership — update to the bubble-up shape.
- The `auto-title.test.ts` static guard (`EX-F7-01` related) — unaffected by T5.

---

## 8. Cross-theme dependencies & ordering

### Shared abstractions / boundaries with other themes

- **T1 & T2 share the card/citation identity + anchor model (FLAG for the PLAN).** T5 **assumes a stable surrogate id on `CitationRef`/atoms** (the C1 deliverable) is *either already present or landing in T1/T2*. T5's citation bus-resync (Pillar C-1) and the `@N` anchor-indexed key (Pillar E-2) both key on the citation/card id; if T1/T2 introduce a stable surrogate id to survive re-parse (per C1's fix locus `useCitations.ts:281-315` + "stable surrogate id on CitationRef/atoms"), T5's resync becomes *strictly more correct* (no id-regen drift). **Assumption stated:** T5 keys on whatever id the card/citation currently exposes; if T1/T2 change that id to a surrogate, T5's resolver `keyOf` must use the surrogate. The PLAN must reconcile: T5 should land **after** the surrogate-id introduction, or T5's `keyOf` must be parameterized so the surrogate swap is a one-line change. T5 does **not** itself introduce the surrogate id.

- **Uncontrolled-contentEditable theme (C4).** `BIB-F5-02`'s re-seed half is shared. T5 closes the position/sidecar-resync half; the seed-once re-seed is C4's. Order-independent but both must land for `BIB-F5-02` to fully close.

- **Footnote round-trip / attr theme.** `FN-F5-01` serialization is theirs; T5 wires the surface. T5 can land first (surface wired, title still drops until serialization lands) or after.

- **Has-content / delete-confirm theme (C18/C5).** `FN-A1-02` is theirs; T5 only flags it.

- **Select/cycle theme (C15).** The `useCycle` routing of `SearchPanel.selectedIdx` (`SR-F1-02`/`SR-C1-01`/`SR-F2-01`) overlaps. T5 claims it because it lives inside the Search rewrite, but the PLAN should confirm no double-implementation with a select-cycle theme.

### Ordering

- **Before T5:** the C1 stable-surrogate-id work (T1/T2) **should** precede T5's citation resync, OR T5 parameterizes `keyOf`. Otherwise no hard predecessor.
- **T5 is otherwise independent and can land early** — the `DocStructureBus` and `PaneState` spines it builds on already exist; T5 is mostly addition + deletion-of-dead-code, low coupling to other themes' edits.
- **After T5:** the search rewrite and the `PaneState.searchHighlightRange` bubble are a clean foundation any later cross-panel-jump work can build on.

---

## 9. Risk + rollout

**Overall risk: MEDIUM.** The position-derivation pillars (A, C, D) are *additive consumers of an existing spine* — low risk, well-precedented by `OmniViewPanel`/`useInTextPositions`. The ownership pillar (B) involves **deleting live-looking state in EditorLayout** and re-routing the search-highlight pipe — that is the highest-risk move (a wrong deletion blanks search highlighting entirely), but it's exactly the `HIGH`-severity bug today, so the blast radius is already broken.

### De-risking / incremental landing order

Land in independently-verifiable slices, each shippable on its own:

1. **Pillar A first (lowest risk):** ship `useLivePosResolver`, refactor `OmniViewPanel` onto it (no behavior change — pure de-dup, proves the hook), then swap the omni fold filter (`OMNI-F1-02`). Verifiable via `__virgilBusStats()` + the boundary test. No feature flag needed.
2. **Pillar C-2 (outline focus source swap):** isolated to the focus engine; verify Focus on a fresh doc focuses the first section (`OUT-F2-01`).
3. **Pillar C-1 (citation bus resync):** isolated to the citation `syncFromEditor`; verify delete-in-editor prunes the card.
4. **Pillar E-2 (`@N` jump):** isolated to the marker bridge + EditorLayout matchers.
5. **Pillar D + B together (search):** the search rewrite and the `PaneState` ownership move are coupled (the search producer is what feeds the bubble). Land behind the existing search-panel surface — **no runtime feature flag** (search is already broken, so worst case is no regression beyond today). De-risk by keeping EditorLayout's **error-range** highlight pipe untouched (it bubbles the other direction and is unrelated), deleting only the **search** half. Keep a one-commit revert boundary so the dead-state deletion can be rolled back independently.
6. **Pillar E-1 (host-wiring batch + required-prop discipline):** mechanical, per-host, each independently testable. The required-prop type-tightening is the last step (it'll surface any host still unwired as a compile error — a feature, landed once all hosts are wired).

**No big-bang.** No persisted-schema change means **no migration risk** and trivial rollback (revert the commits; existing papers are byte-identical on disk throughout).

---

## 10. Implementation checklist (ordered, individually verifiable)

1. [ ] Create `useLivePosResolver(editor, keyOf)`; unit-test snapshot-identity cache + plain-typing no-rebuild.
2. [ ] Refactor `OmniViewPanel.resolvePos` (OmniViewPanel.tsx:471-488) to consume `useLivePosResolver` — assert no behavior change (existing omni tests green).
3. [ ] Swap `omni-host.tsx:619/637` fold/focus `item.pos` reads to `resolvePos(item.id) ?? item.pos`; test boundary-shift after plain typing (`OMNI-F1-02`). Verify `emitCount` flat.
4. [ ] Swap the outline focus engine's structure source from debounced `latestDoc` (EditorLayout.tsx:2360-2362 / focus.ts:21-38) to `getBus(editor).structure`; test fresh-doc Focus → first section (`OUT-F2-01`, `OUT-F8-02`, `OUT-F7-01`).
5. [ ] Replace citation mount-only `syncFromEditor` (EditorPane.tsx:1177-1182) with `DocStructureBus` subscription (citation channels + `onFootnoteOrderChanged`), depending on the reactive `editor` for initial population; test delete/code-add/reparse (`CI-A1-01`, `CI-A2-02`, `CI-F8-03`, `BIB-F5-02` position half).
6. [ ] Marker bridge: add `anchorIndex` to the gutter-marker event; append `@${anchorIndex}` to `omniKey` in `marker-clicks.ts:133`; extract the prefix-or-exact omni matcher from `open-for-card.ts` and reuse in `alignOmniCardWithClick` (EditorLayout.tsx:1080) + `virgil-card-jumped` (EditorLayout.tsx:1118); test 2-anchor report pin (`REP-F3-01`, `OMNI-F3-01`, `OMNI-F8-02`). Update `marker-clicks-bridge-behavior.test.tsx`.
7. [ ] Fix `EX-F4-01`: carry clicked element/rect in `virgil-label-ref-click` detail (marker-clicks.ts:326-328) instead of global `querySelector`.
8. [ ] Search result identity → `{blockUuid,offset,length}` for main-text; live re-resolve at `navigateToResult` via `useLivePosResolver`/snapshot; test type-earlier-then-click (`SR-F1-01`, `SR-A2-01`, `SR-F3-04`).
9. [ ] Add `SCOPE_DISPATCH: Record<SearchScope, SearchFn>` + `searchReports`; thread `reportCards` through `search-host.tsx`; type-level exhaustiveness test (`SR-F3-02`). Verify/restore orphan-footnote slice (`SR-A1-01`, `SR-F7-01`).
10. [ ] Route `SearchPanel.selectedIdx` through `useCycle` read-clamp; test list-shrink clamp (`SR-C1-01`, `SR-F2-01`, `SR-F1-02`).
11. [ ] Ownership move: add `PaneState.searchHighlightRange`; un-`void` EditorPane's local (EditorPane.tsx:2706); populate the bubble payload; compute `effectiveHighlightRange` for EditorPane's own `<Editor>` (EditorPane.tsx:4398). **Delete** EditorLayout's dead `searchHighlightRange` (:1228), search half of `effectiveHighlightRange` (:3309), dead `SearchHost` import (:161). Test search highlight reaches the live editor (`SR-F3-01`, `SR-F8-01`, `SR-F8-02`).
12. [ ] Enrich `openItemInPanel` (EditorPane.tsx:2932) with side-parity + auto-split; remove EditorLayout's orphaned auto-split copy (`SR-C1-02`, `SR-F3-03`).
13. [ ] Thread `onCitationDrop` EditorPane → `<Editor>` (`CI-A2-01`); test drag-unanchored-citation-into-editor anchors it.
14. [ ] Reports host pass: `getCitationDisplayText`/`onCitationCreated` (`REP-F4-01`, `OMNI-F4-01`), `setOverrideEditor`/`onEditorFocus` (`OMNI-F5-01`), `useAiRequestsContext` + `aiRequests` + `report`-kind filter (`REP-C1-01`, `REP-F5-02`).
15. [ ] `CardListPanel` render `listTrailing` outside `showEmpty` (`BIB-F1-01`).
16. [ ] Examples omni `onJump` pass `sourceEl` (`EX-F3-03`); widen example-card-surface math interactivity (`EX-F4-02`).
17. [ ] Dead-code/dead-prop sweep: `BIB-F7-03`, `OMNI-F2-01` (delete + comment); `BIB-F1-02` CSL preview + `FN-F7-01` footnote-drag (build or delete, per UX decision); `EX-F5-02` doc-comment.
18. [ ] Pillar E-1 guard: tighten now-required `*Host` props from `optional`; add CI grep rule against `void <state>; // … post-7.8`-style orphan markers. Full suite + `__virgilBusStats()` regression pass.
