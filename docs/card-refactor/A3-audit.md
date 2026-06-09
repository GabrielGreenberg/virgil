<!-- arena: A3 — Creation & lifecycle | re-pinned to HEAD 588ae7e (2026-06-09) -->

# A3-audit — Creation & lifecycle

## 0. TL;DR

A3 owns **how a card is born and how its clone/delete/anchor lifecycle is wired**. Against the
landed foundations (A0 `CARD_REGISTRY` + `CardMeta.lifecycle` + `assertLifecycleCoverage`; AF
`float:card:<kind>:<id>` + `cardPopKey`), the surface splits cleanly:

- **Creation is *almost* one pipeline already, but there are TWO parallel ones.** The good one is
  `useCardCreation` ([card-creation.ts](../../src/components/editor-layout/card-actions/card-creation.ts)) —
  every "+"/toolbar/drop path AND the drag-handle action menu funnel through its 14 `create*`
  factories, each doing the same 4 chores (delegate to the hook's `add*` → set selection → pin →
  pop-or-activate). **But `useSelectionToCardActions`
  ([selection-to-card.ts](../../src/components/editor-layout/card-actions/selection-to-card.ts)) is a
  second, older creation path** that re-implements note + cutter-comment + footnote creation **outside**
  `useCardCreation` — it calls `addNote`/`addCutterComment` directly, hand-rolls the panel-activation
  switch, **never `pin`s, never marks pristine, and never routes through the registry**. This is the
  central creation fragmentation: **fold `selection-to-card` into `useCardCreation` and delete it.**

- **There are THREE pristine mechanisms and TWO live managers.**
  (1) `usePristineCardManager` ([usePristineCardManager.ts](../../src/hooks/usePristineCardManager.ts))
  — the unified click-away discarder (global `pointerdown` + `data-pristine-card-id`), the one the
  refactor wants. (2) `usePristineTracker` ([usePristineTracker.ts](../../src/hooks/usePristineTracker.ts))
  — an **older per-hook fallback** (`localPristine`), used only when no manager is injected
  (`pristine = externalPristine ?? localPristine`, `useNotes.ts:87`), with a **separate panel-close
  discard trigger** (`discardPristine*` → `takePristine`). (3) The manager is **instantiated TWICE** —
  once in `EditorLayout.tsx:582` and once in `EditorPane.tsx:752` — each with its own `forKind`
  slices and its own `registerDiscard` effects against (partly) the same hooks. EditorLayout's is
  largely **vestigial parity** (its `useReports` mount at `:617` is explicitly commented
  "Vestigial parity mount"). **Two redundant discard triggers + a duplicate manager + a dead
  per-hook tracker** = the lifecycle-of-blank-cards is the most fragmented sub-surface in A3.

- **`usePristineCardManager`'s own `CardKind` union is a 6-token DRIFT enum** (`note | cut | report
  | todo | footnote | citation`, `usePristineCardManager.ts:23-29`) — it shadows the real `CardKind`,
  uses the legacy `cut` token, and omits 10 kinds. This is exactly the "parallel kind-enum" class
  A0 set out to kill; it survived because A0 scoped itself to the spine, not the pristine manager.

- **The 5 declared lifecycle gaps (todo/archive/example/report/report-request, all
  `{clone:false,delete:false,bindAnchor:false}`) are CORRECTLY gaps — but for a subtle reason worth
  pinning, not "fill them all."** `CardMeta.lifecycle` does NOT mean "can this card be cloned/deleted
  by its own UI button" (every kind already has a panel-hook `deleteX`/clone where relevant). It means
  **"when the user duplicates/deletes the anchoring TEXT, does that cascade to this card via the
  registry-driven walker"** (`duplicateSlice` / `cleanupLinksInRange`,
  [duplicate-slice.ts](../../src/text-objects/duplicate-slice.ts) /
  [delete-range.ts:117](../../src/text-objects/delete-range.ts)). Those walkers dispatch via
  `lifecycle.get(kind)?.clone/.delete` to exactly two anchor mechanisms: **inline-atom cards**
  (footnote/citation, the 2-entry `INLINE_ATOM_CARDS` table) and **Mode-B `linkedAnchor`-mark cards**
  (note/highlight/revision-*/cutter-*). The 5 gap kinds are **Mode-A paragraph-anchored or
  doc-derived** — they carry no inline atom and no `linkedAnchor` mark, so the walker never reaches
  them, so wiring `clone`/`delete` would be **dead code the assertion would then demand**. The correct
  A3 ruling per kind is below (§4); the short version: **todo/report/report-request stay {false,false,
  false}; archive's delete-cascade is the one real candidate to wire; example must stay all-false
  (it's a TextObject mirror).** The gaps are intentional and mostly *correct* — A3's job is to
  **ratify and document the criterion**, not blindly fill.

- **`popCardAtAnchor` is string-typed and round-trips through the legacy-key canonicalizer**
  (`EditorPane.tsx:1116`, `migrateLegacyKeyToFloat(\`${cardKind}:${cardId}\`)`), and the 14 callers
  in `card-creation.ts` pass **legacy prefix tokens** (`"revision"`, `"revision-suggestion"`,
  `"cutter-comment"`, …) not typed `CardKind`. The SSOT flagged this (Session 10 → "A1 gardening"),
  but it is squarely a **creation-pipeline** wart: it should take a `CardKind` and call
  `cardPopKey(kind, id)` directly, dropping the string round-trip.

**Findings: 9.** **Confidence: high** on the creation/pristine fragmentation map and the lifecycle-gap
criterion (every walker dispatch + every pristine site re-verified against `588ae7e`); **medium** on
the archive-delete-cascade ruling and on whether EditorLayout's vestigial pristine mounts are 100%
dead (they share `deleteNote`/`deleteCutterCard` identities with the live hooks — needs the impl chip
to confirm the EditorLayout `useNotes`/`useCutter` mount renders nothing).

---

## 1. Current reality (code-derived, EXACT file:line)

### 1.1 The creation pipeline — `useCardCreation`

[`card-creation.ts:262`](../../src/components/editor-layout/card-actions/card-creation.ts) —
`useCardCreation(deps): CardCreationApi`. 14 factories: `createNote`, `createHighlight`,
`addNoteForHighlight`, `deleteHighlightOrNote`, `createCutterComment`, `createCutterSuggestion`,
`createReport`, `createReportRequest`, `createRevisionComment`, `createRevisionSuggestion`,
`createTodo`, `createFootnote`, `createCitation`, `createArchiveSnippet` (`:620-636`).

Each factory's shape (e.g. `createNote`, `:327-338`):
1. `const card = addX(...)` — delegate to the per-doc hook's `add*` (which marks pristine internally
   for blank creates, `:329`).
2. `setSelectedXId(card.id)` — set the panel selection slot (`:330`).
3. `pin("note", card.id)` — `recentlyAdded.markAdded` (`:331`, top-of-panel pin).
4. `if (opts.mode === "omni") return` — omni path leaves the panel as-is (`:332`).
5. `if (fromToolbar(opts)) popCardAtAnchor("note", id, anchorRect!)` else `ensurePanelActive("notes")`
   (`:333-334`). `fromToolbar` = `opts.anchorRect !== undefined` (`:325`).

The mode taxonomy (`CardCreateMode = "float" | "omni"`, `:143`): **float** = pop a floating window at
the trigger rect (Actions toolbar); **omni** = select+pin only, caller ensures omni is visible (the
drag-handle action menu, `mode:"omni"`).

**Consumers (the single funnel):**
- The 6 panel hosts (`notes-host.tsx:42`, `citations-host.tsx:58`, `cutter-host.tsx:73`,
  `todo-host.tsx:32`, `reports-host.tsx:29`, `revisions-host.tsx:76`) via
  `useCardCreationContext()` ([contexts/card-creation.tsx:25](../../src/components/editor-layout/contexts/card-creation.tsx)).
- The drag-handle action menu — `useDragHandleActions`
  ([drag-handle-actions.ts](../../src/components/editor-layout/card-actions/drag-handle-actions.ts)),
  taking `cardCreation: CardCreationApi` (`:75`) and calling `createFootnote`/`createCitation`/
  `createNote`/`createHighlight`/`createTodo`/`createRevisionComment`/`createCutterComment`/
  `createReportRequest`/`createArchiveSnippet` (`:261-553`), all `mode:"omni"`.
- Wired once in `EditorPane.tsx:1768` (`useCardCreation({...})`), provided to the tree via
  `CardCreationProvider`.

### 1.2 The SECOND creation path — `useSelectionToCardActions`

[`selection-to-card.ts:36`](../../src/components/editor-layout/card-actions/selection-to-card.ts) —
re-implements **note**, **cutter-comment**, **footnote** creation from the live editor *selection*,
plus `handleAct` (apply-an-AI-suggestion to the editor). Wired in `EditorLayout.tsx:2348`.

- `handleAddNoteFromSelection` (`:88-110`): `createLinkedAnchor(ed,"note")` → `addNote(pid, undefined,
  anchor)` → `updateLinkedAnchorCard` → `setSelectedNoteId` → hand-rolled panel-activation switch.
  **Does NOT** call `pin`, **does NOT** route through `useCardCreation`, **does NOT** mark pristine
  (it always passes an anchor, so it's never blank — but the omission means the code path diverges).
- `handleCutSelection` (`:112-134`): same shape for `cutter-comment`.
- `handleCreateFootnote` (`:74-86`): `createFootnoteFromSelection` + `renumberFootnotes` +
  hand-rolled panel switch + `setSelectedFootnoteId`. **Parallel to** `cardCreation.createFootnote({
  fromSelection:true })` (`card-creation.ts:552-571`) which does the *same* thing plus pin + pop.

This is **duplicate logic** for note/cutter/footnote creation that predates `useCardCreation` and was
never folded in. The panel-activation switch (`:104-109`, `:128-133`, `:79-84`) is a hand-inlined copy
of `ensurePanelActive` (`card-creation.ts:306-317`).

### 1.3 Pristine-card auto-discard

**Manager** — [`usePristineCardManager.ts:43`](../../src/hooks/usePristineCardManager.ts):
- A global `pointerdown` capture listener (`:56-84`). For every `(kind,id)` in the marked sets, it
  `querySelectorAll('[data-pristine-card-id="<id>"]')` and, if **no** matched node `.contains(target)`,
  calls the kind's registered `discard(id)` (`:76-80`). So a blank card the user clicks away from is
  dropped. Multiple mount points (docked row + floating copy) are both "inside" (`:67-72`).
- `forKind(kind)` (`:86-113`) → `{ markNew, markDirty, isPristine, registerDiscard, discardAll }`.
- `CardKind` here is a **local 6-token union** (`:23-29`): `note | cut | report | todo | footnote |
  citation`. **Drift from the real `CardKind`** — uses legacy `cut`, omits highlight/revision-*/
  archive/example/bib/ai/error.

**`markNew` call sites** (blank-only gating — "no content, no anchor, no paragraph"):
- `useNotes.ts:122`, `useCutter.ts:219` (comment) + `:256` (suggestion), `useRevisions.ts:185` +
  `:221`, `useReports.ts:150` + `:179`, `useTodos.ts:58` (always — a todo is blank by birth),
  `useCitations.ts:174` (`ref.keys.length === 0`), and footnote via the explicit
  `markFootnotePristine` callback (`EditorPane.tsx:1100`, called from `card-creation.ts:562` only when
  `!opts.fromSelection`).

**`registerDiscard` sites — DUPLICATED across both managers:**
- EditorPane (`:1808-1834`): note→`notesHook.deleteNote`, cut→`cutterHook.deleteCard`,
  report→`reportsHook.deleteCard`, todo→`todosHook.deleteItem`, citation→`citationsHook.deleteCitation`,
  footnote→`innerRef.current.deleteFootnote`.
- EditorLayout (`:2782-2790`): note→`deleteNote`, cut→`deleteCutterCard`, todo→`deleteTodo`,
  footnote→`handleDeleteFootnote`. (Citation discard "Removed from here", comment `:2786-2789`.)

**The fallback tracker** — [`usePristineTracker.ts:23`](../../src/hooks/usePristineTracker.ts):
each card hook does `const localPristine = usePristineTracker(); const pristine = externalPristine ??
localPristine;` (`useNotes.ts:86-87`, identical in useCutter/useReports/useRevisions/useTodos). When
the manager IS injected, `localPristine` is **never marked** (dead). The hook also exposes
`discardPristineNotes`/`discardPristineCards`/`discardPristineTodos` (`useNotes.ts:443`,
`useCutter.ts:461`, `useReports.ts:332`, `useRevisions.ts:476`, `useTodos.ts:173`) — a **panel-close**
discard trigger that, when the manager is present, just calls `externalPristine.discardAll()`
(`useNotes.ts:444-447`), else `localPristine.takePristine()`. Threaded to the panel hosts as
`discardPristine` props (`EditorPane.tsx:5354/5371/5404/5419/5437`; host refs in
`notes-host.tsx:49`, `cutter-host.tsx:76`, etc.).

### 1.4 Lifecycle registry + the walker dispatch

[`card-lifecycle-registry.tsx`](../../src/panels/card-lifecycle-registry.tsx): `CardLifecycle =
{ clone, delete, bindAnchor? }` (`:57-66`); `CardLifecycleProvider` (`:86`) + `useCardLifecycleApi`
(`:111`) hold a per-doc registry in a ref (identity-stable `get`); `assertLifecycleCoverage` (`:128`)
dev-asserts the provider's wired ops == `CARD_REGISTRY[k].lifecycle` for all 16 kinds.

Provider wired in `EditorPane.tsx:1852-1894` (`cardLifecycleRegistry` useMemo) — **8 kinds wired**:
footnote {clone,delete}, citation {clone,delete}, note {clone,delete,bindAnchor},
highlight {clone,delete,bindAnchor}, revision-comment {…,bindAnchor}, revision-suggestion {…,bindAnchor},
cutter-comment {…,bindAnchor}, cutter-suggestion {…,bindAnchor}. `assertLifecycleCoverage` called at
`:1898`. This matches `CARD_REGISTRY` exactly (the 8 lifecycle-true kinds + the 5 declared gaps + the 3
system kinds all-false).

**The walkers (the ONLY consumers of `lifecycle.clone/.delete`):**
- `duplicateSlice(slice, cardLifecycle, diag)` (`drag-handle-actions.ts:429` → `duplicate-slice.ts:103`):
  walks the cloned fragment; for inline atoms uses `INLINE_ATOM_CARDS` (footnote/citation,
  `duplicate-slice.ts:46-48`); for `linkedAnchor` marks `parseLinkCardKey(linkCard)` →
  `lifecycle.get(parsed.kind)?.clone(parsed.id)` (`:146`). `rewireClonedAnchors(…, cardLifecycle)`
  then calls `bindAnchor` on the clones (`:474`).
- `cleanupLinksInRange(doc, from, to, cardLifecycle)` (`drag-handle-actions.ts:544/577` →
  `delete-range.ts:117`): same two mechanisms — atoms (`:129-135`) + `linkedAnchor` marks
  (`:138-148`) → `lifecycle.get(parsed.kind)?.delete(parsed.id)`. This fires when the user
  **archives or deletes the anchoring text range**, dropping the orphaned sidecar entry.

So `CardMeta.lifecycle.{clone,delete}` ≙ **"does deleting/duplicating the anchor text cascade to this
card's sidecar"**, NOT "is the card user-deletable." Every kind already has a direct panel-hook delete
(`deleteNote`/`deleteCard`/`deleteItem`/`deleteSnippet`/`deleteExample`/`deleteRequest`), independent
of the registry.

### 1.5 `popCardAtAnchor`

[`EditorPane.tsx:1116-1133`](../../src/components/EditorPane.tsx): `(cardKind: string, cardId: string,
anchorRect)` → `migrateLegacyKeyToFloat(\`${cardKind}:${cardId}\`)` → `computeSpawnPosition` →
`setCardFloatPosition` + `toggleCardPopout`. The 14 `card-creation.ts` callers pass **legacy prefix
strings** (`"note"`, `"revision"`, `"revision-suggestion"`, `"cutter-comment"`, `"report"`,
`"report-request"`, `"archive"`, …, e.g. `:333,498,524,402,452,471,588`) — the `keyPrefix`/legacy
tokens, NOT `CardKind` values (note `"revision"` ≠ the kind `"revision-comment"`). Also called
directly from EditorPane for the revision/archive selection paths (`:2297`, `:2378`).

---

## 2. Finding — TWO parallel creation pipelines (`selection-to-card` bypasses `useCardCreation`)

**WHAT.** `useSelectionToCardActions` re-creates note/cutter-comment/footnote outside the unified
factory, missing `pin`, pristine-marking, the `popCardAtAnchor` handoff, and reusing none of
`ensurePanelActive`.
**WHERE.** [selection-to-card.ts:74-134](../../src/components/editor-layout/card-actions/selection-to-card.ts)
(create paths); wired `EditorLayout.tsx:2348`. Duplicates `card-creation.ts:327` (createNote),
`:390` (createCutterComment), `:552` (createFootnote).
**WHY wrong.** Two pipelines = two places the post-create chore list drifts. A future "every new card
gets X" change has to be made twice; today, selection-born notes already differ (no recently-added
pin, no float option). It also re-encodes the panel-activation switch three times.
**DEEPEST FIX.** Fold the three handlers into `useCardCreation` as thin wrappers that compute the
anchor from the selection and call `createNote`/`createCutterComment`/`createFootnote({fromSelection})`.
`handleAct` (apply-suggestion-to-editor) is **not** a creation path — relocate it to the suggestions
accept flow (A10/responder territory), not card-creation. Then delete `selection-to-card.ts`. One
pipeline; every birth gesture (toolbar, drag-handle, selection) ends in a `create*` factory.

## 3. Finding — pristine system is triple-redundant (2 managers + a dead per-hook tracker)

**WHAT.** Three mechanisms cover "discard a blank card": (a) the manager's click-away
(`usePristineCardManager`), (b) the per-hook `usePristineTracker` fallback, (c) the panel-close
`discardPristine*` trigger. And the manager is instantiated **twice** (EditorLayout + EditorPane),
each with its own `forKind` slices and `registerDiscard` effects.
**WHERE.** Managers: `EditorLayout.tsx:582-587` + `:2782-2790`; `EditorPane.tsx:752-758` + `:1808-1834`.
Fallback: `usePristineTracker.ts`; `const pristine = externalPristine ?? localPristine`
(`useNotes.ts:87`, `useCutter.ts` ~`:190`, `useReports.ts:122`, `useRevisions.ts:157`, `useTodos.ts:45`).
Panel-close: `discardPristineNotes` etc. (`useNotes.ts:443` + 4 siblings) → host `discardPristine`
props (`EditorPane.tsx:5354/5371/5404/5419/5437`).
**WHY wrong.** Two managers means two global `pointerdown` listeners and two `registerDiscard` chains
racing on (partly) the same hooks — the EditorLayout one is "vestigial parity" (`EditorLayout.tsx:617`)
but still installs a live listener and discard effects. The fallback tracker is **dead whenever the
manager is wired** (the live editor case is *always* wired) yet ships in every card hook. The
panel-close trigger is a *second* discard path for the same pristine set.
**DEEPEST FIX.** One manager, instantiated once at the EditorPane (the live owner) and threaded down;
EditorLayout's pristine manager + its `useNotes`/`useCutter`/`useReports`/`useTodos` *parity mounts*
deleted if confirmed render-dead (medium-confidence — verify the EditorLayout mounts don't feed a
live panel). Collapse (b)+(c): the click-away manager already covers the discard intent; keep
`discardPristine*` ONLY as the manager's `discardAll()` shim for panel-close (it already is when the
manager is present) and **remove `usePristineTracker` + the `?? localPristine` fallback** once every
card hook is guaranteed a manager (inject a no-op manager for the inert/reader case instead of a second
tracker type). Net: one pristine type, one listener, two intentional triggers (click-away + panel-close)
sharing one set.

## 4. Finding — `usePristineCardManager`'s 6-token `CardKind` is a drift enum

**WHAT.** A local `CardKind = note | cut | report | todo | footnote | citation`
(`usePristineCardManager.ts:23-29`) shadows the real 16-kind `CardKind`, uses the **legacy `cut`**
token (the spine renamed the panel concept; `cutter-*` are the kinds), and omits 10 kinds.
**WHERE.** [usePristineCardManager.ts:23-29](../../src/hooks/usePristineCardManager.ts);
consumed `forKind("cut")` (`EditorLayout.tsx:585`, `EditorPane.tsx:754`).
**WHY wrong.** It is precisely the "parallel kind-enum drift" A0 set out to kill — a 7th parallel
enum that A0 missed because it scoped to the spine. `cut` vs `cutter-comment`/`cutter-suggestion` is
the exact naming wart the refactor is resolving; here the *pristine slice* groups both cutter kinds
under one `cut` bucket (which is actually correct — both delete via `cutterHook.deleteCard`), but the
token should be a declared *pristine-group*, not an ad-hoc string.
**DEEPEST FIX.** Replace the local union with a registry-derived **pristine grouping**. Most cards
share a panel-level discard (cutter-comment + cutter-suggestion → one cutter slice; note + highlight →
note slice). Declare the grouping as `panelForCardKind` (the panel IS the discard bucket) or add a
tiny `pristineGroup` derivation. Either way the manager keys on a registry-derived value, not a
hand-typed `cut`. Keystroke-irrelevant (static).

## 5. Finding — the 5 lifecycle gaps: ratify the criterion, fill only `archive` delete-cascade

**WHAT / WHY.** A0 declared todo/archive/example/report/report-request `{false,false,false}` as
"A3 fills." But the gap is *not* "these can't be cloned/deleted" — it's "the anchor-text
duplicate/delete walker doesn't cascade to them," and for **4 of the 5 that is correct by
construction** (they carry no inline atom and no `linkedAnchor` mark — the only two things the walker
sees). Per-kind ruling:

| Kind | Anchor mode | Clone (dup-text cascade)? | Delete (del-text cascade)? | bindAnchor? | Ruling |
|---|---|---|---|---|---|
| **todo** | Mode-A paragraph link | No mark to clone | No mark to delete | n/a | **Stay {false,false,false}.** A todo is a paper-level task incidentally pinned to a paragraph; duplicating the paragraph should NOT spawn a duplicate todo, and deleting the paragraph should leave the todo (it survives as an orphan, by design). Its own `deleteItem` button handles user delete. |
| **report** / **report-request** | Mode-A paragraph link | No mark | No mark | n/a | **Stay {false,false,false}.** Reports are apparatus authored *about* a passage; they should outlive an anchor-text edit, not cascade. Own `deleteCard` handles user delete. |
| **example** | TextObject mirror (`exampleBlock` in the doc) | **Must stay false** | **Must stay false** | n/a | **Stay {false,false,false}, PERMANENTLY.** `example` is `origin:"derived"` — its lifecycle IS the underlying `exampleBlock` TextObject's (duplicate/delete the block → `useExamples.syncFromEditor` reconciles the card). Wiring a card-level clone/delete would double-act with the TextObject. This is a "two kinds, never merge" boundary — flag it as a *permanent* declared gap, not an A3 todo. |
| **archive** | Mode-A paragraph link | No (an archive is a *deliberate extraction*, never auto-duplicated) | **CANDIDATE** | n/a | **Clone:false. Delete: ratification needed.** When the user deletes the anchor paragraph, should the archive snippet (which *holds the extracted text*) be dropped too? Arguably NO — the archive's whole purpose is to survive deletion. So likely **stay {false,false,false}** as well, but this is the one genuine decision (Open Q). |

**DEEPEST FIX.** Do **not** mechanically fill the gaps. Instead: (1) keep all 5 declared as-is unless
the archive-delete decision flips; (2) **document the criterion in `CardMeta.lifecycle`'s doc-comment**
("these flags drive the anchor-text duplicate/delete *cascade*, not the card's own UI delete; Mode-A &
derived kinds correctly opt out"); (3) for `example`, add an explicit `// permanent gap — lifecycle is
the exampleBlock TextObject's (origin:derived)` so a future chip doesn't "fill" it; (4) if archive's
delete-cascade is wanted, wire `archive: { delete: archiveHook.deleteSnippet }` AND flip the registry
flag AND ensure `cleanupLinksInRange` can reach it — which it **can't today** (archive has no
linkedAnchor mark), so cascade-delete-archive would need the walker to also consult **Mode-A paragraph
links** (a real new mechanism — see §6). That scope makes the likely ruling "stay all-false."

## 6. Finding — the walker only cascades Mode-B + inline-atom; Mode-A cards are uncovered

**WHAT.** `duplicateSlice` / `cleanupLinksInRange` dispatch lifecycle **only** for inline-atom cards
and `linkedAnchor`-mark (Mode-B) cards. **Mode-A** (paragraph-uuid-linked) cards — todo, archive,
report, report-request — are invisible to the cascade: deleting their anchor paragraph does NOT call
their `delete`, and duplicating it does NOT clone them.
**WHERE.** `duplicate-slice.ts:127-152` (marks + atoms only); `delete-range.ts:127-150` (same).
**WHY it matters (and is mostly *correct*).** For todo/report/report-request the non-cascade is the
desired behavior (§5). The finding is a **scope boundary to make explicit**, not a bug: A3 should
state that the registry-driven cascade is a **Mode-B/atom mechanism**, and Mode-A cards are
intentionally cascade-exempt. *If* a future kind needs Mode-A cascade, the walker must grow a
paragraph-link consultation (walk deleted paragraph uuids → find Mode-A cards pinned to them → call
`delete`). That is the only way archive-delete-cascade (§5) could be implemented, which is itself why
the likely ruling is to leave archive all-false.
**DEEPEST FIX.** No code change — a documented invariant: "lifecycle cascade is Mode-B + inline-atom;
Mode-A kinds opt out and their registry flags reflect that." Encodes the §5 criterion structurally.

## 7. Finding — `popCardAtAnchor` is `kind: string`, round-trips legacy keys

**WHAT.** Signature `(cardKind: string, …)` builds the float key by **string-concatenating the legacy
prefix and re-canonicalizing** (`migrateLegacyKeyToFloat(\`${cardKind}:${cardId}\`)`) instead of
calling the AF SSOT `cardPopKey(kind, id)`. Callers pass legacy prefix tokens, not `CardKind`.
**WHERE.** [EditorPane.tsx:1116-1133](../../src/components/EditorPane.tsx); 14 call sites in
`card-creation.ts` (`:333,347,402,428,452,471,498,524,545,566,588,613`) + 2 in EditorPane
(`:2297,2378`).
**WHY wrong.** It defeats the AF type-safe key SSOT: the legacy-string detour means a typo in a caller
("revsion") fails silently at runtime instead of at `tsc`, and the value passed (`"revision"`) is a
*prefix*, not a kind, so the function is the last place the prefix-vs-kind ambiguity AF tried to kill
still lives. The SSOT parks this in "A1 gardening," but it is a **creation-pipeline** concern (it's
*how a card pops on birth*) and belongs to A3's "one creation pipeline."
**DEEPEST FIX.** Re-type `popCardAtAnchor(kind: CardKind, id, rect)` and build the key with
`cardPopKey(kind, id)` directly. Update the 16 callers to pass the real `CardKind`
(`"revision-comment"` not `"revision"`, `"revision-suggestion"` stays). Drop the
`migrateLegacyKeyToFloat` round-trip. `tsc` then enforces the kind set. Coordinate with the
`create*` factories so each passes its declared kind (the factory already *knows* its kind).

## 8. Finding — `createX` factories hard-code the kind string in 3 places each

**WHAT.** Each `create*` factory hard-codes its kind as a string literal in 2-3 spots: the `pin(kind)`
call, the `popCardAtAnchor(kind)` call, and the `ensurePanelActive(panel)` call — none registry-derived.
E.g. `createRevisionComment` (`:484-509`) hard-codes `pin("revision",…)`, `popCardAtAnchor("revision",
…)`, `ensurePanelActive("revisions")`.
**WHERE.** `card-creation.ts` — every factory `:327-618`.
**WHY wrong.** Adding a card kind means hand-writing a new factory with 3 hard-coded strings that must
agree with the registry's `keyPrefix`/`panel`/`themeKey`. It's the same "scattered kind tokens" class,
just inside the (otherwise good) unified factory. The `pin` kind (`RecentlyAddedKind`) is yet another
parallel token set.
**DEEPEST FIX.** The factories are structurally identical (call `add*`, set selection, pin, pop/activate).
A registry-driven `createCard(kind, opts)` could derive panel via `panelForCardKind(kind)`, key via
`cardPopKey(kind, id)`, and dispatch `add*`/`setSelectedXId` via a per-kind registered closure (mirror
the `registerCardFloatable` / lifecycle-provider pattern). Not all factories collapse cleanly
(footnote lives in the editor; highlight needs a mandatory anchor; archive is post-extraction) — so the
realistic deepest fix is a **shared `finishCreate(kind, id, opts)` helper** that does steps 2-5
registry-derived, leaving each factory only its kind-specific `add*` call. Kills the per-factory token
triplication; keeps the kind-specific birth logic.

## 9. Finding — `useExamples` takes a `pristine` param it can only `markDirty`

**WHAT.** `useExamples(docId, pristine?)` accepts a `PristineKindApi` (`useExamples.ts:24`) and calls
`pristine?.markDirty` in `updateExampleTitle`/`deleteExample` (`:66,83`) — but **never `markNew`**,
because examples are *derived* (born as doc blocks, not via a "+"). So the pristine param is inert for
examples (nothing is ever marked, so nothing is ever dirtied).
**WHERE.** [useExamples.ts:24,66,83](../../src/hooks/useExamples.ts). No `forKind("example")` exists in
either manager (the local enum doesn't even have `example`).
**WHY wrong.** Dead parameter + dead `markDirty` calls — a derived card can't be pristine (there's no
blank-create gesture). It's vestigial wiring from when examples were imagined as user-created cards.
**DEEPEST FIX.** Drop the `pristine` param from `useExamples` entirely (and the two `markDirty` calls).
Confirms `example` is outside the pristine model (consistent with §5's "lifecycle is the TextObject's").

---

## Target design — the deepest-fix shape

**ONE creation pipeline.** `useCardCreation` is the funnel; `selection-to-card`'s three create paths
fold into it as selection→anchor wrappers and the file is deleted (§2). `handleAct` relocates out of
creation entirely. Every birth gesture (toolbar "+", drag-handle action, editor selection) terminates
in a `create*` factory; the only non-app birth is the editor-skill **sidecar write** (apply_response),
which surfaces on the next hook read — out of A3's app scope but noted as the "programmatic" entry.

**Registry-derived factory tail.** A shared `finishCreate(kind: CardKind, id, opts)` does
select→pin→pop/activate using `panelForCardKind(kind)` + `cardPopKey(kind, id)` (§7, §8), so each
factory shrinks to its kind-specific `add*` call. `popCardAtAnchor` re-typed to `CardKind` + built via
`cardPopKey` — the legacy-string round-trip dies, `tsc` enforces the kind set.

**ONE pristine system.** A single `usePristineCardManager` instance (EditorPane), keyed on a
registry-derived bucket (panel or `pristineGroup`), not the 6-token drift enum (§4). `usePristineTracker`
+ the `?? localPristine` fallback removed in favor of injecting a no-op manager for inert/reader (§3);
EditorLayout's duplicate manager + parity mounts deleted (pending render-dead confirmation). Two
discard *triggers* (click-away + panel-close `discardAll`) share one set; `useExamples` drops its inert
pristine param (§9).

**Lifecycle = ratified, documented criterion (not blind fill).** All 5 declared gaps stay (§5); the
`CardMeta.lifecycle` doc-comment states the cascade-vs-UI-delete distinction and the Mode-B/atom-only
walker scope (§6); `example` gets a `permanent gap` annotation. The one open decision is
archive-delete-cascade (Open Q). `assertLifecycleCoverage` keeps the provider honest — no new wiring
unless archive flips.

**How it consumes the foundations.** `cardPopKey`/`cardDomSelector` (AF SSOT) replace the
`popCardAtAnchor` string detour; `panelForCardKind`/`cardKeyPrefix` (A0 predicates) replace the
hard-coded factory tokens; `CardMeta.lifecycle` + `assertLifecycleCoverage` (A0) already gate the
lifecycle and need only documentation, not new ops. No new registry field is strictly required for A3,
though a `pristineGroup` (or reuse of `panel`) makes §4 clean.

---

## Keystroke sanctity

**No per-keystroke risk introduced; one latent risk to preserve.**

- Card creation, pristine marking, and lifecycle dispatch are **all action-time** (a click, a
  drag-handle dispatch, a delete). None run on `update`/`transaction`. The pristine manager's only
  listener is a **`pointerdown`** capture handler (`usePristineCardManager.ts:82`), not an editor
  subscription — it does a bounded `querySelectorAll` per *click*, not per keystroke. Fine.
- The clone/delete walkers (`duplicateSlice` / `cleanupLinksInRange`) walk a **slice/range** at
  action time only (`drag-handle-actions.ts:429/544/577`), bounded by the duplicated/deleted region —
  not the doc, not per keystroke. Fine.
- **`useExamples.syncFromEditor`** (`useExamples.ts:98`) is the one doc-proportional walk in A3's
  surface, but it is **NOT** a keystroke subscriber — it's called on **parse** (the LaTeX lint /
  structural reparse), with a change-gated write-through (`:122-135`). A3 must not move example-card
  derivation onto an `update` counter. Per the AGENTS card-source rule, example-card derivation must
  stay gated on `useStructuralRevisions` (the example/figure category counter) + the reactive editor,
  threaded down as a prop — **not** a `docVersion` bump. The current `syncFromEditor`-on-parse model
  already respects this; the impl chip must preserve it when folding example creation.
- **None of A3's surface touches the sanctioned `editor.on('update')` subscriber list.** The
  pristine manager, card-creation factories, and lifecycle registry are all event/action-driven.
- Verification gate for the impl chip: `window.__virgilBusStats().emitCount` flat on plain typing
  with a freshly-created (pristine) card open and a popped card present.

---

## Fragmentation table

| Surface | File(s) (file:line) | Disposition |
|---|---|---|
| Unified creation factory | `card-actions/card-creation.ts:262` (14 `create*`) | **Keep** — the SSOT funnel; tighten its tail (§7,§8) |
| Second creation path (note/cutter/footnote from selection) | `card-actions/selection-to-card.ts:74-134`; wired `EditorLayout.tsx:2348` | **Fold into `useCardCreation` + delete** (§2) |
| Apply-suggestion-to-editor (`handleAct`) | `selection-to-card.ts:63-72` | **Relocate** out of creation (A10/responder) |
| Pristine click-away manager | `usePristineCardManager.ts:43` | **Keep, single instance** (§3) |
| Pristine 6-token `CardKind` drift enum | `usePristineCardManager.ts:23-29` | **Replace with registry-derived bucket** (§4) |
| Per-hook fallback tracker | `usePristineTracker.ts`; `?? localPristine` (`useNotes.ts:87` +4) | **Remove** (inject no-op manager) (§3) |
| Duplicate pristine manager + parity mounts | `EditorLayout.tsx:582-587,2782-2790,608-617` | **Delete if render-dead** (§3, medium-confidence) |
| Panel-close discard trigger | `discardPristine*` (`useNotes.ts:443` +4 hooks; hosts) | **Collapse to manager `discardAll` shim** (§3) |
| Lifecycle registry + provider + assertion | `card-lifecycle-registry.tsx`; wired `EditorPane.tsx:1852-1898` | **Keep** — document criterion (§5,§6) |
| 5 declared lifecycle gaps | `card-registry.tsx:125,139,241,255,269` | **Keep all 5**; annotate `example` permanent; archive = Open Q (§5) |
| Cascade walkers (Mode-B + atom only) | `duplicate-slice.ts:127-152`, `delete-range.ts:127-150` | **Keep**; document Mode-A exemption invariant (§6) |
| `popCardAtAnchor` (`kind: string`, legacy round-trip) | `EditorPane.tsx:1116-1133`; 16 callers | **Re-type `CardKind` + `cardPopKey`** (§7) |
| Per-factory hard-coded kind/panel/prefix tokens | `card-creation.ts` (every factory) | **`finishCreate` helper, registry-derived** (§8) |
| `useExamples` inert `pristine` param | `useExamples.ts:24,66,83` | **Drop the param** (§9) |

---

## Definition of Done for this arena

1. **One creation pipeline.** `useSelectionToCardActions`'s create paths folded into `useCardCreation`;
   the file (minus relocated `handleAct`) deleted. Every in-app birth ends in a `create*` factory.
2. **`popCardAtAnchor` is `CardKind`-typed** and builds keys via `cardPopKey` — no legacy-string
   round-trip; all 16 callers pass the real kind; `tsc` enforces.
3. **One pristine system.** A single manager instance; `usePristineTracker` + `?? localPristine` +
   the EditorLayout duplicate manager/parity-mounts removed; the 6-token drift enum replaced by a
   registry-derived bucket; `useExamples`'s inert pristine param dropped.
4. **Lifecycle ratified + documented.** All 5 declared gaps confirmed correct (archive-delete decided
   by Gabriel); `CardMeta.lifecycle` doc-comment states the cascade-vs-UI-delete criterion and the
   Mode-B/atom-only walker scope; `example` annotated permanent-gap; `assertLifecycleCoverage` green.
5. **Factory tail registry-derived.** Per-factory hard-coded panel/prefix/pin tokens replaced by a
   shared `finishCreate(kind,…)` using `panelForCardKind` + `cardPopKey`.
6. **Keystroke sanctity intact** — `__virgilBusStats().emitCount` flat on plain typing with a pristine
   card open + a popped card; example-card derivation still gated on `useStructuralRevisions` + the
   reactive editor (never an `update` counter).
7. **No data loss** — folding selection-to-card preserves the existing linkedAnchor/anchorId behavior;
   pristine consolidation never drops a *dirtied* card (only blank-on-create ones); dev-walk every kind
   through create → click-away-discard → clone-via-dup-text → delete-via-del-text.

---

## Open questions for the human

1. **Archive delete-cascade (the one real lifecycle gap decision).** When the user deletes the anchor
   paragraph of an archive snippet, should the snippet be dropped too? A3's lean is **NO** (an archive's
   purpose is to survive deletion of its source) → archive stays `{false,false,false}`. Implementing
   "yes" requires a brand-new Mode-A cascade in the walker (§6). **Ratify: leave archive all-false?**
2. **`example` as a permanent declared gap.** Confirm `example` lifecycle stays `{false,false,false}`
   *forever* (it's an `origin:"derived"` mirror of the `exampleBlock` TextObject; card-level
   clone/delete would double-act). A3 wants to annotate it permanent so no future chip "fills" it.
3. **Body-click create vs selection-create UX parity.** Folding `selection-to-card` means
   selection-born notes/cutters gain the recently-added pin + the float-pop option they lack today.
   Acceptable behavior change, or keep selection-create deliberately bare?
4. **EditorLayout's duplicate pristine manager + parity hook mounts** (`useNotes`/`useCutter`/
   `useReports`/`useTodos`) — confirmed deletable, or do any feed a still-live shell-side surface
   (the margin-item delete bundle at `:617` suggests at least the *delete* handlers are consumed)?
   This is the one medium-confidence demolition; the impl chip should verify render-dead before deleting.

---

## Cross-arena seams

| Arena | Shared surface | Where (file:line) |
|---|---|---|
| **A0 (landed)** | `CardMeta.lifecycle` + `assertLifecycleCoverage` are A3's lifecycle SSOT; the 5 declared gaps are A0→A3 hand-offs; predicates (`panelForCardKind`, `cardKeyPrefix`) feed the factory-tail fix | `cards/card-registry.tsx:125,139,241,255,269`; `card-lifecycle-registry.tsx:128`; `predicates.ts:34,31` |
| **AF (landed)** | `cardPopKey`/`cardDomSelector` are the float-key SSOT A3's `popCardAtAnchor` must adopt; the `popCardAtAnchor`→float-pop handoff is AF Seam-1 ("subsystem owns the float, domain owns the birth gesture") | `panel-registry.ts:248,257`; `EditorPane.tsx:1116`; `floats/float-key.ts:134` |
| **A1 (Gardening)** | A1 already claims the `popCardAtAnchor` `kind:string` tightening (Session 10 backlog) + the dual example-key; **deconflict** — A3 owns the *creation-pipeline* re-typing of `popCardAtAnchor`, A1 owns leaf deletions. The dead `usePristineTracker` removal overlaps A1's "vestigial" sweep | `EditorPane.tsx:1116` (shared); `usePristineTracker.ts` |
| **A2 (Anchoring)** | `bindAnchor` (the Mode-B re-anchor-after-clone lifecycle op) + `createLinkedAnchor` are the anchor seam both arenas touch; A2 owns the anchor model, A3 owns the clone-time `rewireClonedAnchors`/`bindAnchor` *wiring*; the Mode-A-cascade-exemption (§6) is an anchoring fact | `card-lifecycle-registry.tsx:60`; `duplicate-slice.ts:474`; `selection-to-card.ts:94,118` |
| **A4 (Selection/focus)** | Every `create*` factory ends in `setSelectedXId` + `pin` — A4 owns the selection axis the factory writes; the `finishCreate` tail (§8) must call A4's new `select`/`focus` primitive, not the welded `toggleSelection`, once A4 splits the axes | `card-creation.ts:330,331` (+13 sites); A4 `anchored-card-store.ts:129` |
| **A5 (Omni)** | `CardCreateMode = "omni"` is A5's surface; the drag-handle `mode:"omni"` path + `ensureOmniActiveForPanel` are how a newly-created card lands in omni | `card-creation.ts:143`; `drag-handle-actions.ts` (omni activation) |
| **A9 (Typography/morph)** | The morph chevron (A9) *converts* a card kind in place — that is a **creation-adjacent lifecycle op** (`convertCard` remaps the key via `remapCardPopKey`); A3's `popCardAtAnchor`/`finishCreate` and A9's morph both write float keys, must agree on `cardPopKey` | `useRevisions.ts:325` (convertCard); `panel-registry.ts:248` |
| **A10 (AI/collab/persistence)** | The "programmatic" creation entry = editor-skill sidecar writes (apply_response) that A3 doesn't call but that birth the same card kinds; `handleAct` (apply-suggestion) relocates here; pristine/persistence integrity (`usePersistentState` debounce) is A10's | `useNotes.ts:80` (persist); `selection-to-card.ts:63` (handleAct→A10) |

---

## Stale-ref corrections

- **SSOT §7 A3 row** lists `[card-lifecycle-registry.tsx]` and the three key files — all still current
  at `588ae7e`, but the SSOT's "3 creation entry points" framing maps to: (1) `useCardCreation`
  toolbar/panel; (2) drag-handle action menu (`drag-handle-actions.ts`, via `useCardCreation`) **plus
  the un-folded `selection-to-card.ts`**; (3) programmatic = editor-skill sidecar writes (no in-app
  `useCardCreation` call). The SSOT did not name `selection-to-card.ts` — it is the un-mapped second
  pipeline (§2).
- **SSOT Session-10 backlog** ("tighten `popCardAtAnchor` / `card-creation.ts` `kind:string`→`CardKind`")
  is filed under "A1 gardening" but is a **creation-pipeline** concern owned by A3 (§7). Current
  location confirmed: `EditorPane.tsx:1116` (not a standalone file).
- **A0 §4 / SSOT "lifecycle gaps"** frames the 5 as "A3 fills." Corrected: 4 of 5 are correctly
  *permanent* gaps (Mode-A / derived); only archive-delete is a live decision (§5). The framing
  "A3 fills" overstates the work — A3 mostly *ratifies + documents the criterion*.
- **Pristine cheat-sheet absence:** the SSOT's "6 parallel kind-enums" list (`pristine 6`,
  line ~103) names the pristine enum but does NOT call out that it uses the **legacy `cut` token** or
  that the **manager is double-instantiated** — both verified here (`usePristineCardManager.ts:23-29`;
  `EditorLayout.tsx:582` + `EditorPane.tsx:752`).
- **A0 declared `report` lifecycle gap** — confirmed present at `card-registry.tsx:241` (the cheat-sheet
  in earlier sessions had once *missed* report/report-request; the registry is now correct).
- `card-creation.ts` is **22025 bytes / 655 lines** at `588ae7e` (the older recon under-counted the
  factory set as fewer; current count is 14 `create*` factories).
