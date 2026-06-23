# Action-menu anchor bugs — IMPLEMENTATION PLAN (BUG1 + BUG2)

<!-- synthesis-lead implementation plan; merges 4 design plans; every file:line re-verified against HEAD 932251c (v0.1.57). DESIGN ONLY — no source edited. -->

This plan implements the verified fix in `DIAGNOSIS.md`. Both bugs are **one
architectural gap**: a `linkedAnchor`'s KIND and TARGET are never authoritatively
owned — re-derived late + lossily on reload (BUG1) and flattened to a fake
`{kind:"paragraph"}` ref on create (BUG2). The fix makes anchor identity
authoritative (sidecar-sourced kind wins over the parser default) and unifies the
create-time resolve-target policy so the lightning surface speaks the same real
node kind the grab-handle surface already speaks.

All claims in the 4 design plans were re-verified against live code (see the
"Verification log" at the end). The diagnosis is correct everywhere it was
checked.

---

## 1. FINAL ARCHITECTURE DECISIONS (open choices resolved)

- **BUG2 ref policy → Path A (emit the REAL node kind), NOT a new `CursorRef`.**
  The menu already resolves the anchorable node and its kind inside
  `ensureAnchorUuid`→`resolveAnchorableNode` and throws the kind away
  (`anchor-uuid.ts:73-76`). The fix is to *stop discarding the kind*: resolve
  `{uuid, kind}` once at menu-open and have `runAction` emit `{kind:<realKind>, id}`
  for the cursor case. `resolveRefRange` already resolves every resulting block
  kind (heading→line `:1011-1020`; listItem/blockquote/codeBlock/exampleItem/
  paragraph→content range via the generic walk `:1024-1048`), and the grab-handle
  surface (`TextObjectGrabHandle`) ALREADY emits `{kind:"heading"|"listItem", id}`
  successfully — proving the whole resolve+create chain is correct and the
  lightning surface is the *sole* divergent producer. *Rationale:* Path A removes a
  ref vocabulary instead of adding a third resolver branch, converges the two
  create surfaces on ONE `resolveRefRange`, and leaves `DragHandleRef` + its ~10
  consumers + the dispatcher untouched. A bare `CursorRef` is provably insufficient
  (a cursor ref resolves zero-width through `cardResolveScope`, `action-registry.ts:961-963`)
  so Path B would still have to derive the kind — just in a wider type.

- **BUG1 kind authority → reconcile-not-skip (variant i.b), NOT encode-kind-in-marker (i.a).**
  Make the reload reconcile (`applyLinkedAnchors`) AUTHORITATIVE over the parser's
  hardcoded `kind:"note"`: a present mark whose kind/linkCard/tintColor disagrees
  with its owning sidecar card's record is **re-stamped in place** (range resolved
  by anchorId — the parser already placed it by `\vlid` boundaries), not skipped.
  *Rationale:* the kind is a property of the owning CARD, not the document text;
  putting it in `.tex` (i.a) contradicts the project axiom "annotations are
  sidecar-owned app-state, `.tex` is document SSOT" (`linked-anchor.ts:10-13` "The
  mark is *app state*, not document state"), creates a second divergeable source of
  truth that survives even card deletion (the exact orphan-tint-without-card class
  we want to *eliminate*), and is a format migration with back-compat burden.
  Variant i.c (parser stops stamping) is highest-blast-radius (flash of unpainted
  anchors) and is rejected for this fix. The sidecar already holds the authoritative
  kind (which array the card lives in), the cardId, and the tint source — reconcile
  from it.

- **Tint is a function of KIND, not a per-card color field.** Add ONE SSOT helper
  `defaultTintForLinkedAnchorKind(kind)` → `"#fbbf24"` for `highlight`, else `null`.
  Route the three create-time literals AND the reload record through it (a highlight
  card whose `highlightColor` is non-null — a future per-card override — prefers
  that). *Rationale:* `HighlightCard.highlightColor` is "v1 always null"
  (`types.ts:486-487`) while create hardcodes `#fbbf24` at three sites; the tint is
  fully derivable from kind, so centralizing it makes reload byte-faithful to create
  and restores the deferred "highlight-tint suppression."

- **Reports are a Mode-B kind and MUST be added to RC-B.** `report-request` creates
  a real Mode-B `linkedAnchor` (`createAnchor(ed,"report-request")`,
  `drag-handle-actions.ts:417`) but `buildModeBReapplyRecords` omits reports — a
  latent BUG1 instance. Add a `reports` array (split report/report-request on the
  per-card `kind`), collected BEFORE highlights (preserve highlights-LAST).

- **Orphan-reap → centralize in the reconciler, made synchronous; do NOT chase
  every delete site.** `useLinkedAnchorReconciler` is the documented SSOT for "every
  mark backs a live card." Replace its `setTimeout(0)` macrotask (which races the
  1500ms autosave) with a synchronous sweep inside the `useLayoutEffect` (the new
  card is already committed into the alive-set arrays by the time the layout effect
  runs), and ALSO invoke the same pure reap once from the EditorPane load pass so a
  parser-resurrected orphan `\vlid` is reaped in the same load frame. Keep
  `deleteMarginItem`'s inline strip as redundant-but-cheap (comment it as such).

- **Orphan-event routing → drop the kind gate in all 5 listeners; rely on the
  anchorId self-filter.** After reload the `virgil-anchor-orphaned` event carries the
  parser-default `note`, so each panel's kind gate makes it ignore its own orphaned
  non-note mark. Every `clearCardAnchor` already self-filters by anchorId membership
  with a no-match early-return (verified `useRevisions:512-516`, `useReports:438-440`,
  `useNotes`, `useTodos:246`), so the kind gate is redundant-and-harmful. Drop it
  uniformly — the OWNING panel decides, never the stale event kind. *Rationale:* the
  `LinkedAnchorGuard` plugin is editor-side with no access to React card stores, so
  making the event self-describing would need a ref bridge; dropping the gate is
  simpler, deeper, and default-independent.

- **`reanchorByText` → uuid-scope the text search + make it atom-aware.** Add an
  optional `paragraphUuid` param; when supplied and resolvable, search only that
  node's `textContent` and map hits to doc positions with a per-text-node offset
  walk (advancing doc pos by nodeSize for ALL children incl. atoms, char-offset only
  for text). Fall back to the legacy doc-wide `getText().indexOf` when absent.
  *Rationale:* today's doc-wide first-match displaces co-located/duplicate text, and
  the `to`-reconstruction (`:985-988`) drifts by an inline atom's nodeSize. The
  card's stored paragraph uuid disambiguates and bounds the math.

- **Two map-completeness fixes owned by ONE part (Chip 1).** Make
  `cardKindToLegacyAnchorKind` (`links.ts:421`, lossy `default:"note"`) exhaustive
  and export `legacyKindToCardKindString` (`links.ts:813`, module-private) — both
  needed by the reconcile re-stamp and the kind-aware glue. Landed in the foundation
  chip so later chips share one switch.

**Where the parts disagreed / ties broken:**

- Part (ii) recommended Path A; Part (iii) was written tolerant of either Path A or
  a CursorRef. **Tie → Path A** (above).
- Part (i) wrote its edits for variant i.b; Part (iv) asked the lead to pick the
  variant. **Tie → i.b** (above).
- Parts (i) and (iii) BOTH grow `ModeBReapplyRecord` and BOTH change
  `reanchorByText`'s signature and BOTH touch `Editor.tsx:1517-1535` and
  `EditorPane.tsx:1337-1364`. **Resolved by one combined record shape + one combined
  signature + one combined effect body** (see §3 Conflicts). Part (i) owns the
  reconcile rewrite; Part (iii) layers paragraphId/uuid-scoping onto the same
  writer; they are sequenced so they never stomp.
- Part (i) and Part (iv) both worried the test mirror of `applyLinkedAnchors`
  (`reapply-mode-b-anchors.test.ts:132-150` hand-copies the production handle) could
  pass against a stale mirror. **Resolved → extract the handle body into a shared
  importable `applyLinkedAnchorsImpl(editor, records)` in
  `src/links/_shared/apply-linked-anchors.ts`** so production and tests share ONE
  implementation (an app improvement; removes a documented copy-paste invariant).
  This is Chip 3's first edit.

---

## 2. CHIP SEQUENCE (ordered, each independently verifiable)

Sequenced so the suite stays green between chips. Chips 1-2 are pure foundation
(no behavior change). Chip 3 is the BUG1 reconcile core. Chip 4 is BUG2. Chip 5 is
the kind-aware glue + orphan reap. Chip 6 is the reanchor uuid-scoping. Chip 7 is
the end-to-end test + verification surface.

| Chip | Title | One-line scope |
|---|---|---|
| 1 | Crosswalk + map SSOT foundation | Add `defaultTintForLinkedAnchorKind`; make `cardKindToLegacyAnchorKind` exhaustive; export `legacyKindToCardKindString`. No behavior change. |
| 2 | Route create-time tint through the SSOT | Replace the three `"#fbbf24"` literals with `defaultTintForLinkedAnchorKind("highlight")`. Pure refactor. |
| 3 | BUG1 reconcile-not-skip + reports + shared handle | Grow `ModeBReapplyRecord` (cardId/tintColor/paragraphId); add `reports`; extract `applyLinkedAnchorsImpl`; reconcile present marks; thread tint into `reanchorByText`; fix stale header. |
| 4 | BUG2 resolve-target policy (Path A) | Resolve `{uuid,kind}` once at menu-open; thread kind through `ActionsMenuPanel`; `runAction` emits the real node kind; dev-warn on silent annotation bail. |
| 5 | Kind-aware orphan routing + synchronous reaper | Drop the 5 kind gates; expose sidecar card kind; make the reconciler sweep synchronous + reuse it from the load pass. |
| 6 | uuid-scoped, atom-aware `reanchorByText` | Add `paragraphUuid` param scoping the text search to the card's stored paragraph; thread `rec.paragraphId` from the load pass. |
| 7 | End-to-end BUG1/BUG2 tests + verification | The missing serialize→parse→RC-B round-trip test; BUG2 dispatch + negative tests; orphan-reap test. |

---

## 3. CROSS-PART CONFLICTS — the single coherent change for each shared seam

These files are touched by multiple parts. To avoid chips stomping each other, each
shared artifact has ONE final shape, owned by ONE chip, that later chips extend
without rewriting.

### 3.1 `ModeBReapplyRecord` (reapply-mode-b-anchors.ts:51-55)

Final shape (Chip 3 lands all fields at once; Chip 6 only *reads* `paragraphId`):

```ts
export interface ModeBReapplyRecord {
  anchorId: string;
  kind: LinkedAnchorKind;
  text: string;
  cardId?: string;          // Chip 3 — for the self-describing linkCard token
  tintColor?: string | null;// Chip 3 — kind-derived persistent tint
  paragraphId?: string;     // Chip 3 declares; Chip 6 consumes (uuid-scoped search)
}
```

`collectModeBRecords` (Chip 3) populates all three optional fields in its single
`out.push`. Optional so existing record-literals and the CONTROL tests still
type-check.

### 3.2 `reanchorByText` signature (links.ts:964-970)

Final signature — Chip 3 adds `tintColor`, Chip 6 adds `paragraphUuid`. Land BOTH
positionally in Chip 3 (param declared but unused until Chip 6) so the signature is
stable from Chip 3 onward:

```ts
export function reanchorByText(
  editor: Editor,
  kind: LinkedAnchorKind,
  snapshot: string,
  preferredAnchorId?: string,
  cardId?: string,
  tintColor?: string | null,   // Chip 3 — added to the setMark attrs (was absent)
  paragraphUuid?: string,      // Chip 6 — scopes the text search
): LinkedAnchorRecord | null
```

Chip 3 adds `tintColor: tintColor ?? null` to the `.setMark("linkedAnchor", {…})`
attrs (today there is NO tintColor attr there, `:1001-1007`). Chip 6 adds the
uuid-scoping branch at the top + the fallback.

### 3.3 The `applyLinkedAnchors` handle (Editor.tsx:1517-1535)

Extract the body into `src/links/_shared/apply-linked-anchors.ts`
(`applyLinkedAnchorsImpl(editor, records)`) in **Chip 3**, before rewriting it to
reconcile. The production handle (`Editor.tsx`) and the test mirror
(`reapply-mode-b-anchors.test.ts:132-150` + the new Chip 7 file) both import this
ONE function, so the tests can never pass against a stale copy.

`applyLinkedAnchorsImpl` final behavior (Chip 3 writes reconcile; Chip 6 threads
`rec.paragraphId` into the absent-branch `reanchorByText` call):

- Build a `Map<anchorId, {kind, linkCard, tintColor}>` of present marks (was a
  `Set<anchorId>`).
- For each record: **absent** → `reanchorByText(editor, rec.kind, rec.text,
  rec.anchorId, rec.cardId, rec.tintColor, rec.paragraphId)`; **present &
  disagrees** (live.kind !== rec.kind, OR live.linkCard !== expected
  `<legacyToken>:<cardId>`, OR live.tintColor !== (rec.tintColor ?? null)) →
  re-stamp in place over the range from `resolveTextRangeByAnchorId` via
  `editor.chain().setTextSelection(range).setMark("linkedAnchor", {authoritative
  attrs}).setTextSelection(range.from).run()` with `tr.setMeta("addToHistory",false)`;
  **present & agrees** → skip (idempotent). Build the `linkCard` token via the
  exported `legacyKindToCardKindString(rec.kind)` (Chip 1) so it is byte-identical to
  create-time.

### 3.4 The EditorPane load-reconcile effect (EditorPane.tsx:1337-1385)

ONE combined effect body, explicit ordering:

1. `reapplyModeBAnchors(...)` — add `reports: reportsHookRaw.cards` to the arrays
   (Chip 3) and `reportsHookRaw.cards` to the dep array.
2. the six `*.reconcileAnchors(editor)` calls (unchanged).
3. **LAST:** `reapOrphanLinkedAnchors(editor, aliveIds)` (Chip 5), aliveIds built
   from the now-reconciled collections (must run after step 2 so a just-re-applied
   healthy mark is in the alive-set and not reaped).

### 3.5 `drag-handle-actions.ts`

Two non-overlapping edits: Chip 2 touches ONLY the highlight tint literal (`:342`);
Chip 4 touches ONLY the `!resolved` dev-warn (`:193-204`). No collision (different
line regions) — but sequence Chip 2 before Chip 4 for a clean diff.

### 3.6 CardKind↔LinkedAnchorKind maps

Chip 1 owns making both `cardKindToLegacyAnchorKind` (`:421`) exhaustive and
exporting `legacyKindToCardKindString` (`:813`). No other chip edits these
switches.

---

## 4. CHIP DETAILS

### CHIP 1 — Crosswalk + map SSOT foundation

**Files:** `src/cards/legacy-token-crosswalk.ts`, `src/links/links.ts`.
**Depends on:** nothing. **No behavior change** (suite must stay green).

- `legacy-token-crosswalk.ts`, after `dataLinkCardTokenForLegacyMarkKind` (~:196):
  add `export function defaultTintForLinkedAnchorKind(kind: string): string | null {
  return kind === "highlight" ? "#fbbf24" : null; }`. Single SSOT for "what
  persistent tint does a linkedAnchor kind paint."
- `links.ts:421-438` `cardKindToLegacyAnchorKind`: change return type to
  `LinkedAnchorKind`, add the missing cases (`revision-suggestion`→`revision`,
  `report`→`report`, `report-request`→`report-request`,
  `cutter-suggestion`→`cutter-suggestion`), remove the lossy `default:return "note"`
  (fall back to null/dev-throw for non-anchor kinds). It is the inverse of
  `linkedAnchorKindToCardKind` (`:795-806`, exhaustive) and must match it. Export it
  (currently module-private). **Verify callers first:** it feeds `makeAnchorLink`'s
  mark kind at `:385` — tightening it makes report/revision-suggestion stamp the
  CORRECT kind (today mislabeled `note`); confirm no test pins the old wrong value.
- `links.ts:813` `legacyKindToCardKindString`: add `export` (used by the Chip 3
  re-stamp to build a byte-identical `linkCard` token).

**Tests:** `src/links/__tests__/get-text-anchor-card-kind.test.ts` (new, also used
by Chip 5) is deferred to Chip 5; for Chip 1 add a tiny unit asserting
`defaultTintForLinkedAnchorKind("highlight")==="#fbbf24"` and `(...)("note")===null`,
and that `cardKindToLegacyAnchorKind("revision-suggestion")==="revision"` /
`("report-request")==="report-request"`.

**Verify:** `npx vitest run src/cards/__tests__ src/links/__tests__` then
`npm run typecheck`.

---

### CHIP 2 — Route create-time tint through the SSOT

**Files:** `src/components/editor-layout/card-actions/drag-handle-actions.ts:342`,
`src/components/EditorPane.tsx:3057`,
`src/components/editor-layout/panels/notes-host.tsx:73`.
**Depends on:** Chip 1. **Pure refactor** (helper returns `#fbbf24`).

Replace each `tintColor: "#fbbf24"` / `{ tintColor: "#fbbf24" }` literal with
`defaultTintForLinkedAnchorKind("highlight")` (import from
`@/cards/legacy-token-crosswalk`). After this, the `#fbbf24` constant lives in
exactly one place.

**Tests:** none new (covered by existing highlight-create tests; behavior
identical). **Verify:** `npm run typecheck` + `npx vitest run` for the touched
components' suites.

---

### CHIP 3 — BUG1 reconcile-not-skip + reports + shared handle (the BUG1 core)

**Files:** `src/links/_shared/apply-linked-anchors.ts` (NEW),
`src/links/_shared/reapply-mode-b-anchors.ts`, `src/links/links.ts`,
`src/components/Editor.tsx`, `src/components/EditorPane.tsx`.
**Depends on:** Chip 1 (exhaustive maps + exported `legacyKindToCardKindString` +
`defaultTintForLinkedAnchorKind`).

1. **NEW `src/links/_shared/apply-linked-anchors.ts`:** export
   `applyLinkedAnchorsImpl(editor, records: ModeBReapplyRecord[]): void` with the
   reconcile logic (§3.3). Imports `reanchorByText`, `resolveTextRangeByAnchorId`
   (export it from `links.ts` if not already — it is module-private at `:732`),
   `legacyKindToCardKindString`. This is the ONE implementation both production and
   tests import.

2. **`reapply-mode-b-anchors.ts`:**
   - Grow `ModeBReapplyRecord` to the final shape (§3.1).
   - `collectModeBRecords`: push `cardId: card.id`,
     `tintColor: defaultTintForLinkedAnchorKind(kindFor(card))` (prefer a non-null
     `(card as HighlightCard).highlightColor` for highlights),
     `paragraphId: <card's Mode-B link textObjectIds[0]>` (the containing-paragraph
     uuid the Mode-B link already carries, `types.ts:54-57`). Import
     `defaultTintForLinkedAnchorKind`.
   - `ModeBCardArrays`: add `reports: readonly CardWithLinks[]`.
   - `buildModeBReapplyRecords`: after cutters, BEFORE highlights, add
     `collectModeBRecords(arrays.reports, (c) => (c as {kind?:string}).kind ===
     "report-request" ? "report-request" : "report", records)`. Highlights stay
     strictly LAST.
   - Fix the stale header (`:1-44`, esp. `:3-4`): the parse does NOT drop the mark —
     it RESURRECTS every `\vlid` as a hardcoded `kind:"note"` mark; RC-B now
     RECONCILES present marks (re-stamps kind/linkCard/tintColor) rather than
     skipping, idempotent via the agree-check.

3. **`links.ts`:** `reanchorByText` final signature (§3.2) — add `tintColor` param
   and `tintColor: tintColor ?? null` in the setMark attrs (the `paragraphUuid` param
   is declared here too but its body lands in Chip 6). Export
   `resolveTextRangeByAnchorId` if `apply-linked-anchors.ts` needs it.

4. **`Editor.tsx:1517-1535`:** replace the inline handle body with a call to
   `applyLinkedAnchorsImpl(editor, records)`. Widen the `EditorHandle.applyLinkedAnchors`
   record type (`:307-309`) to reference `ModeBReapplyRecord` directly (no inline
   literal) so it stays in lockstep.

5. **`EditorPane.tsx:1351-1357`:** add `reports: reportsHookRaw.cards` to the arrays
   object; add `reportsHookRaw.cards` to the dep array (`:1380-1384`).

**Keystroke sanctity:** untouched — `applyLinkedAnchorsImpl` runs ONLY from the
once-per-doc latched effect (`modeAReconciledDocRef`); the Map-vs-Set capture is
O(marks) at load, not per-keystroke. The re-stamp transactions carry
`addToHistory:false`.

**Tests (new, in `reapply-mode-b-anchors.test.ts`):**
- present note-kind mark over a REVISION anchorId is re-stamped to `kind:"revision"`
  (range/text unchanged, no duplicate mark).
- present highlight mark missing tintColor gets `#fbbf24` restored.
- in-agreement present mark is a no-op (idempotency; bus emitCount flat).
- RC-B builds + restamps a `report-request` range anchor (reports now included,
  ordered before highlights).
Update the test mirror to import `applyLinkedAnchorsImpl` instead of hand-copying
the handle. If the ordering assert (`:549 records.map(r=>r.kind)`) exists, extend it
for the new `reports` entry.

**Verify:** `npx vitest run src/links/_shared/__tests__/reapply-mode-b-anchors.test.ts
src/links/__tests__ src/components/editor-layout/card-actions/__tests__/todo-mode-b-reconciler.test.tsx`
then `npm run typecheck`.

---

### CHIP 4 — BUG2 resolve-target policy (Path A)

**Files:** `src/lib/anchor-uuid.ts`, `src/components/SelectionActionsMenu.tsx`,
`src/components/ActionsMenuPanel.tsx`,
`src/components/editor-layout/card-actions/drag-handle-actions.ts`.
**Depends on:** nothing (independent of Chips 1-3; can land in parallel, sequenced
here for a clean suite).

1. **`anchor-uuid.ts`** (after `ensureAnchorUuid`, ends `:97`): add
   `export function resolveAnchorUuidAndKind(view, pos): { uuid: string; kind:
   TextObjectKind } | null`. Resolve the anchorable node ONCE via
   `resolveAnchorableNode`; mint the uuid if missing exactly as `ensureAnchorUuid`
   does (preserve `markAnchorMint` fast-clock; factor the mint so it returns the
   freshly-minted uuid + the node it resolved — avoid a stale re-read after
   `setNodeMarkup`); return `{ uuid, kind: isTextObjectKind(node.type.name) ?
   node.type.name : "paragraph" }`. **Import-cycle guard:** `anchor-uuid.ts` →
   `text-object-registry.ts` for `isTextObjectKind`; verify `text-object-registry`
   does not import `anchor-uuid` (it does not today). If a cycle surfaces, narrow
   the kind via a string-set check instead of importing the registry.

2. **`SelectionActionsMenu.tsx`:** widen `menuTarget` state (`:145-149`) to carry
   `kind: TextObjectKind`. In the Cmd-/ keydown builder (`:326-333`) and `openMenu`
   (`:347-356`), replace `ensureAnchorUuid(...)` with `resolveAnchorUuidAndKind(...)`
   (early-return on null, matching the old `if (!uuid) return;` menu-open gating).
   Pass `nodeKind={menuTarget.kind}` into `<ActionsMenuPanel>` (`:397-411`).

3. **`ActionsMenuPanel.tsx`:** add `nodeKind: TextObjectKind` to
   `ActionsMenuPanelProps` (`:117-137`) + destructure (`:156-163`), with a doc
   comment. In `runAction` (`:204-217`) replace the cursor branch
   `{ kind:"paragraph" as const, id: paragraphUuid }` with `{ kind: nodeKind, id:
   paragraphUuid }`. **Leave the applicability probe `applyRef` (`:397-408`)
   expressing cursor mode as `{kind:"cursor", ...}` AS-IS** — it must stay a cursor
   ref so `refHasLiveRange`/`kindAllowsCardAction` correctly greys highlight at a
   caret; the probe and dispatch now derive from ONE `menuTarget` so they cannot
   diverge on identity. Add a code comment tying the two together (the asymmetry is
   intentional, not a bug to "fix").

4. **`drag-handle-actions.ts:193-204`:** inside the `!resolved` bail, before the
   `LIFECYCLE_ACTIONS` check, add a dev-only warn for the annotation class:
   `if (!LIFECYCLE_ACTIONS.has(action) && process.env.NODE_ENV !== "production")
   console.warn(...annotation action ${action} could not resolve ref..., ref);`.
   Keep the lifecycle `notifyStaleRef` + `return` unchanged. No production behavior
   change — pure visibility (the silent bail is what hid BUG2 for a release).

**Atom-block-at-caret resolution (lead decision):** with the real-kind ref, a
note/todo/report on a `displayMath`/`texBlock`/`latexComment`/`graphicsBlock` caret
now resolves to a NodeSelection (`resolveRefRange:1030-1036`) and lands a block-level
Mode-A card instead of silently no-oping. **This is strictly better — allow it.** No
defensive guard. (Footnote/citation/highlight on an atom block remain possibly
degenerate but are not crashy; the new behavior resolves rather than swallows.)
Chip 7's listItem test asserts `setTextSelection` does not throw on the container's
inner content range.

**Keystroke sanctity:** untouched — all work is at menu-open (gesture time).

**Tests:** see Chip 7 (the dispatch + negative tests live there with the full
harness). A small `ActionsMenuPanel` unit asserting `runAction` in cursor mode emits
`{kind:nodeKind, id}` (heading + listItem cases) may also live here.

**Verify:** `npx vitest run src/components/__tests__/menus-render-from-registry.test.tsx
src/components/editor-layout/card-actions/__tests__/drag-handle-dispatch-nits.test.tsx`
then `npm run typecheck`.

---

### CHIP 5 — Kind-aware orphan routing + synchronous reaper

**Files:** `src/links/links.ts`, `src/links/_shared/useLinkedAnchorReconciler.ts`,
`src/components/EditorPane.tsx`, `src/hooks/useRevisions.ts`,
`src/hooks/useCutter.ts`, `src/hooks/useReports.ts`, `src/hooks/useNotes.ts`,
`src/hooks/useTodos.ts`.
**Depends on:** Chip 1 (exported maps), Chip 3 (the load-pass effect body already
combined).

1. **`links.ts`** (after `getTextAnchor`): add
   `export function getTextAnchorCardKind(card): CardKind | null` returning the same
   Mode-B link's `link.target.ref.kind` (the sidecar-persisted SSOT, `types.ts:85`).

2. **`useLinkedAnchorReconciler.ts:69-90`:** extract the sweep into
   `export function reapOrphanLinkedAnchors(editor, aliveAnchorIds): void` (pure, no
   React). In the hook, replace the `setTimeout(0)`+`clearTimeout` with a SYNCHRONOUS
   call to `reapOrphanLinkedAnchors` inside the `useLayoutEffect` (guard
   `editor.isInitialized && !editor.isDestroyed`). Keep `deps = [editor,
   aliveAnchorIds]` (memoized on the six collection identities — never per-keystroke).

3. **`EditorPane.tsx`** (the combined load effect, §3.4 step 3): after the six
   `reconcileAnchors`, build `aliveIds` from the reconciled collections (via
   `getTextAnchor`) and call `reapOrphanLinkedAnchors(editor, aliveIds)` ONCE, LAST.

4. **The 5 orphan listeners** — drop the kind gate, keep `if (!anchorId) return;`:
   - `useRevisions.ts:538-543` — remove the revision/comment/revision-suggestion gate.
   - `useCutter.ts:561-565` — remove the cut/cutter-comment/cutter-suggestion gate.
   - `useReports.ts:459` — remove the report/report-request gate.
   - `useNotes.ts:214` — remove the note/highlight gate.
   - `useTodos.ts:244` — change `if (!anchorId || kind !== "todo")` to
     `if (!anchorId)`.
   Each `clearCardAnchor` already self-filters by anchorId with a no-match
   early-return (verified). **Pre-flight:** confirm `useNotes.clearCardAnchor` and
   `useTodos`' body early-return on no match (the other three are verified) before
   removing the gate.

**Keystroke sanctity:** the reaper is keyed on `aliveAnchorIds` (structural-change
memo), never a per-transaction subscriber. Dropping the gate runs each panel's
`clearCardAnchor` per orphan event (event-driven, O(panel-cards), with a no-match
early-return) — not a doc walk.

**Tests (new):**
- `getTextAnchorCardKind` returns the sidecar card kind (Chip 1's deferred unit
  lands here).
- `reapOrphanLinkedAnchors` strips a mark with no owning card synchronously
  (alive-set `{}` → mark gone immediately; alive-set with the id → survives).
- a removed revision mark that reloaded as `kind:"note"` still clears the revision
  card's textRange (repeat for cutter/reports/todos with `kind:"note"`).

**Verify:** `npx vitest run src/hooks/__tests__ src/links/__tests__
src/links/_shared/__tests__/useLinkedAnchorReconciler*.test.*` then
`npm run typecheck`. **Regression guard:** add a test that creating a note (mark +
card in one gesture) does NOT reap the mark — if a create path splits the mark/card
across two React commits, fall back to `queueMicrotask` (still beats the autosave
macrotask). The preview masks this; confirm on a live FSA create-then-idle
post-merge.

---

### CHIP 6 — uuid-scoped, atom-aware `reanchorByText`

**Files:** `src/links/links.ts`, `src/links/_shared/apply-linked-anchors.ts`.
**Depends on:** Chip 3 (the `paragraphUuid` param + `applyLinkedAnchorsImpl` already
exist; `rec.paragraphId` is on the record).

1. **`links.ts` `reanchorByText`:** implement the `paragraphUuid` branch. When
   supplied and `findParagraphByUuid(editor, paragraphUuid)` (`:719-730`) resolves to
   a live node at `nodePos`, search ONLY `node.textContent.indexOf(snapshot)` and map
   the hit to doc positions with a per-text-node offset accumulator that advances doc
   pos by `nodeSize` for ALL children (incl. atoms) but the char-offset only for
   text — so `from`/`to` are correct across inline atoms. Fall back to the legacy
   doc-wide `getText().indexOf` path when `paragraphUuid` is absent/unresolved (keep
   the legacy round-trip test green). Set `paragraphId` from the resolved uuid.

2. **`apply-linked-anchors.ts`:** the absent-branch `reanchorByText` call already
   threads `rec.paragraphId` (signature stable from Chip 3); no further change unless
   the positional arg needs filling.

**Keystroke sanctity:** load/gesture-time only (called from `applyLinkedAnchorsImpl`,
the once-per-doc pass). **Back-compat:** the doc-wide fallback preserves the legacy
no-uuid callers.

**Tests (new, `src/links/__tests__/reanchor-uuid-scoped.test.ts`):**
- with `paragraphUuid`, scopes to the stored paragraph (two paragraphs with the SAME
  snapshot → lands in P2, not the doc-wide first match P1).
- resolves a correct range when the snapshot spans an inline atom (footnote/citation
  between words → `to` not off by the atom nodeSize).

**Verify:** `npx vitest run src/links/__tests__/reanchor-uuid-scoped.test.ts
src/lib/__tests__/linked-anchor-roundtrip.test.ts` then `npm run typecheck`.

---

### CHIP 7 — End-to-end BUG1/BUG2 tests + verification surface

**Files:** `src/links/_shared/__tests__/linked-anchor-kind-roundtrip.test.ts` (NEW),
`src/components/editor-layout/card-actions/__tests__/drag-handle-dispatch-nits.test.tsx`.
**Depends on:** Chips 3, 4, 5 (the behaviors they assert).

1. **NEW `linked-anchor-kind-roundtrip.test.ts`** (`// @vitest-environment jsdom` +
   the `vi.mock("@/lib/storage", …)` block copied from
   `reapply-mode-b-anchors.test.ts:28-46`). Drives the REAL parser + RC-B + the
   shared `applyLinkedAnchorsImpl`:
   - **BUG1 (revision, headline):** serialize a doc whose run carries
     `kind:"revision"` → assert `\vlid{rev1}the span\vlidend{rev1}` present and no
     "revision"/"comment" token (serializer drops kind) → `parseLatex` → load into a
     real `new Editor` → PRECONDITION assert the parsed mark `kind==="note"` (the
     corruption) → run `applyLinkedAnchorsImpl` with the revision record → POST-FIX
     assert mark `kind==="revision"` AND
     `linkedAnchorRenderAttrs(attrs)["data-link-card"]==="comment:"` (purple, not
     green "note:") AND `markedTextFor==="the span"`. Parametrize over
     todo→`todo:`, cutter-comment→`cut:`, report→`report:`, highlight→tinted.
   - **BUG1/iii orphan reap:** serialize+parse an orphan `\vlid` with no owning card;
     render `useLinkedAnchorReconciler` with all six collections empty; assert
     `countLinkedAnchors` 1→0 (synchronous after Chip 5; add a same-frame variant
     asserting 0 WITHOUT the setTimeout await, with a comment that the async variant
     is the legacy timing).

2. **`drag-handle-dispatch-nits.test.tsx`** (extend `makeHarness` to capture
   `targetKind` on the createNote/createRevisionComment/createFootnote stubs +
   add a `createRevisionCalls` array). New BUG2 describe block:
   - **Test A (heading success):** dispatch `("suggest-edit", {kind:"heading",
     id:"head-A"})` → createRevision called once, `paragraphId==="head-A"`,
     `targetKind==="heading"`, anchor falsy, `hasAnyLinkedAnchor===false` (Mode-A).
   - **Test B (listItem success, user-confirmed):** bulletList>listItem{uuid:"li-A"}
     >paragraph; dispatch `("note", {kind:"listItem", id:"li-A"})` → createNote once,
     `paragraphId==="li-A"`, `targetKind==="listItem"`, anchor falsy. Verify
     `setTextSelection` over the container's inner content range does not throw.
   - **Test C (footnote-at-heading):** dispatch `("footnote", {kind:"heading",
     id:"head-A"})` → createFootnote once, selection collapse at the heading-line
     range.to (not a no-op).
   - **Negative test (RED-lock):** dispatch the PRE-FIX flattened `{kind:"paragraph",
     id:"head-A"}` → createRevision/createNote NOT called, notify NOT called (the
     silent annotation bail), `hasAnyLinkedAnchor===false`. Comment: documents the
     no-op the flattening produced; the fix is upstream in `runAction`, so this
     dispatcher-level no-op for a genuinely-mislabeled ref stays GREEN before and
     after.

**RED-FIRST PROTOCOL:** run the Chip 7 targeted vitest BEFORE applying Chips 3-5 and
capture the RED on the new BUG1 asserts + BUG2 Tests A/B/C (the negative test and
orphan-reap should already be GREEN), to prove the tests have teeth.

**Verify:** `npx vitest run src/links/_shared/__tests__/linked-anchor-kind-roundtrip.test.ts
src/components/editor-layout/card-actions/__tests__/drag-handle-dispatch-nits.test.tsx`.

---

## 5. GLOBAL VERIFICATION GATES

Run after each chip (targeted) and once at the end (full):

1. **typecheck:** `npm run typecheck` (`tsc --noEmit`) — after every chip.
2. **lint:** `npm run lint` (eslint) — after every chip; scope to touched files for
   speed.
3. **targeted vitest (fast iteration), the full BUG1/BUG2 surface:**
   ```
   npx vitest run \
     src/links/_shared/__tests__/linked-anchor-kind-roundtrip.test.ts \
     src/links/_shared/__tests__/reapply-mode-b-anchors.test.ts \
     src/links/__tests__/reanchor-uuid-scoped.test.ts \
     src/links/__tests__/get-text-anchor-card-kind.test.ts \
     src/components/editor-layout/card-actions/__tests__/drag-handle-dispatch-nits.test.tsx \
     src/components/editor-layout/card-actions/__tests__/todo-mode-b-reconciler.test.tsx \
     src/links/__tests__/resolve-card-anchor.test.ts \
     src/lib/__tests__/linked-anchor-roundtrip.test.ts \
     src/hooks/__tests__
   ```
4. **full suite (final gate, memory convention):** `npx vitest run --maxWorkers=4`.

**Existing tests that may need updating:**
- `reapply-mode-b-anchors.test.ts` — the `applyLinkedAnchors` mirror (`:132-150`)
  becomes an import of `applyLinkedAnchorsImpl` (Chip 3); the ordering assert
  (`:549`) gains the `reports` entry.
- `src/lib/__tests__/linked-anchor-roundtrip.test.ts` — stays green (we keep the
  bare `\vlid{X}` serializer; NOT encoding kind in the marker, so its
  `[{anchorId,text}]` assertion is unchanged).
- `Editor.tsx:307-309` `EditorHandle.applyLinkedAnchors` record type → reference
  `ModeBReapplyRecord` (Chip 3); any test typing that shape follows.

**Live-preview checks — which are faithful vs which must be unit-tested:**
- **BUG2 (create-time) gestures ARE faithful in the preview.** After Chip 4+7, in
  the dev preview (load `virgil-data/doc_devtest`, set `virgil:force-dev-storage`):
  cursor-on-heading → lightning → Comment must create a card; cursor-on-listItem →
  Note must create a card. Drive the REAL gesture (the menu-open resolution +
  dispatch are synchronous, not RAF-gated). Optionally open the menu headlessly via
  `preview_eval` per the `preview_editor_internals_access` memory.
- **BUG1 (reload persistence) is MASKED in the preview** — `storage-dev` writes
  load-minted UUIDs back to `.tex`, so the kind-corruption reload path does NOT
  reproduce faithfully (memory `anchor_persistence_dev_masks_fsa`). **Do NOT rely on
  the preview to validate BUG1** — the `linked-anchor-kind-roundtrip.test.ts`
  serialize→parse→RC-B unit test IS the validation. A production-FSA reload smoke
  (real `.tex` round-trip on disk) should still be run post-merge to confirm no
  production-only snapshot-drop race bypasses the reconcile.

---

## 6. KEYSTROKE-SANCTITY & BACK-COMPAT GUARDRAILS

- **No per-keystroke doc walks.** Every new doc walk is load/gesture-time:
  `applyLinkedAnchorsImpl` + `reapOrphanLinkedAnchors` run only from the once-per-doc
  latched EditorPane effect (`modeAReconciledDocRef`) and the `useLinkedAnchorReconciler`
  `useLayoutEffect` keyed on `aliveAnchorIds` (a structural-change memo, silent on a
  plain keystroke). `resolveAnchorUuidAndKind` runs at menu-open. None subscribe to
  `editor.on('update'|'transaction')`. Verify with `window.__virgilBusStats()` —
  typing N plain chars must leave `emitCount` flat.
- **Synchronous reaper must not regress create.** A just-created mark+card is
  committed into the alive-set arrays by the time the `useLayoutEffect` runs, so the
  synchronous sweep does not reap it. Chip 5's regression test pins this; if a live
  FSA create-then-idle shows a split-commit reap, fall back to `queueMicrotask`.
- **Back-compat: old `\vlid{X}` must keep parsing.** We are NOT changing the marker
  shape (variant i.b, not i.a), so the serializer/parser format is untouched and
  every existing `.tex` round-trips identically. `linked-anchor-roundtrip.test.ts`
  stays green unchanged. The reconcile is purely a sidecar-driven attr correction on
  the parsed doc.
- **Re-stamp transactions carry `addToHistory:false`** so the load-time correction
  is not an undoable user edit. Chip 3 sets this explicitly on the in-place re-stamp
  chain; verify `reanchorByText`'s absent-branch chain does too (a pre-existing
  latent concern — set it if absent).
- **Token byte-identity:** the reconcile builds `linkCard` via the exported
  `legacyKindToCardKindString` (Chip 1), the SAME function create uses (`links.ts:852,
  996`), so the re-stamped token is byte-identical to create-time.

---

## 7. VERIFICATION LOG (claims re-checked against HEAD 932251c)

All load-bearing `file:line`s in the diagnosis and the 4 plans were confirmed:

- `ensureAnchorUuid` resolves the node + kind via `resolveAnchorableNode` and
  discards the kind, returning only the uuid string — `anchor-uuid.ts:73-76`. ✓
- `ActionsMenuPanel.runAction` flattens cursor→`{kind:"paragraph"}` (`:206-217`,
  esp. 207-208); the probe `applyRef` uses `{kind:"cursor"}` (`:397-408`). ✓
- `resolveRefRange`: selection short-circuit `:988-993`; `isTextObjectKind` early
  null `:996`; heading branch `:1011-1020`; generic walk requires
  `node.type.name===ref.kind` `:1024-1028`. A real heading/listItem ref resolves
  correctly. ✓
- `applyLinkedAnchors` builds a present-`Set` and `if (present.has(rec.anchorId))
  continue;` — `Editor.tsx:1519-1534` (skip at `:1532`). ✓
- Parser stamps `kind:"note"` for every `\vlid` pair — `latex-parser.ts:858-860`. ✓
- `reanchorByText` sets anchorId/kind/linkId/linkKind/linkCard but **NO tintColor**
  in the setMark attrs — `links.ts:1001-1007`; doc-wide `getText().indexOf` at
  `:972`; `to`-reconstruction `:985-988`. ✓
- `useLinkedAnchorReconciler` reaps via `setTimeout(0)` — `:69-90`. ✓
- `cardKindToLegacyAnchorKind` is module-private with lossy `default:"note"` —
  `links.ts:421-438`. ✓
- `legacyKindToCardKindString` is module-private — `links.ts:813`. ✓
- All 5 orphan listeners gate on `kind` — `useRevisions:538-543`, `useCutter:561-565`,
  `useReports:459`, `useNotes:214`, `useTodos:244`; each `clearCardAnchor` has the
  no-match early-return (verified `useRevisions:512-516`, `useReports:438-440`). ✓
- `buildModeBReapplyRecords` omits reports (notes/todo/comments/cutter/highlights
  only) — `reapply-mode-b-anchors.ts:120-140`; `report-request` creates a Mode-B
  anchor — `drag-handle-actions.ts:417`. ✓
- EditorPane load pass: `reapplyModeBAnchors` then the six `reconcileAnchors`, latched
  on `modeAReconciledDocRef` — `EditorPane.tsx:1337-1385`; `reportsHookRaw` in scope. ✓
- Three create-site `#fbbf24` literals — `drag-handle-actions.ts:342`,
  `EditorPane.tsx:3057`, `notes-host.tsx:73`. ✓
- `dataLinkCardTokenForLegacyMarkKind` covers the legacy kind→token crosswalk —
  `legacy-token-crosswalk.ts:191-196`. ✓

No diagnosis line was found to be wrong.
