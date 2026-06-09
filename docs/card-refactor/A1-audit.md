# A1-audit — Gardening — dead/vestigial removal

> Read-only audit for the **A1** (Wave-2) arena of the card-system refactor.
> Scope is **dead / vestigial code removal** — mostly leaf-file deletions that can land early.
> This chip writes **only this file**; it proposes no code edits.
>
> Re-pinned to **HEAD = `588ae7e`** on 2026-06-09 (post-A0 + post-AF merge). The tree moved
> substantially through A0 + AF, so **every `file:line` here was re-verified against the current
> tree**; the §9 punch-list in `CARD-SYSTEM-REFACTOR.md` and the older audits' line refs are stale
> and several of the named "dead" surfaces turn out to be **alive** or **already gardened** — see
> §0 and the Stale-ref corrections at the bottom.

---

## 0. TL;DR

The §9 gardening punch-list is materially out of date. After re-pinning, the picture splits three
ways:

- **Genuinely dead, safe to delete now (5 surfaces):**
  1. `useComments` / `comments.json` — the whole hook (`src/hooks/useComments.ts`) + its `UserComment`
     / `CommentsState` types: **zero live callers** anywhere. (Distinct from the live
     `revisionsHook.addComment` / `cutterHook.addComment` — do not conflate.)
  2. The **`menuLocation` pref model** — `MenuLocation` type, the `menuLocation` field,
     `setMenuLocation`, and the unreachable `kind: "free"` variant: `setMenuLocation` has **zero
     callers** and `menuLocation` is **never read to render** the menu. The docked menu uses the
     *detach-toolbar* mechanism instead (a second generation of the same feature); the
     `menuLocation` generation lost and is now pure dead weight (a persisted pref key + a writer).
  3. `AttachedPopover` (`MenuBar.tsx:671`) — **defined but never rendered**.
  4. The two **grip-redesign DISABLED drags** — the commented-out `handleDragStart` blocks in
     `TodoRow.tsx:99-109` and `ErrorCard.tsx:118-140` (the only two left; `QuotationGroupCard` is
     already gone).
  5. The **inert `autoFitBody` grow-burst** in `FloatWindow.tsx:67-118` — **no `Floatable` anywhere
     sets `autoFitBody`** (card floats and text-object floats both omit it), so the ~50-line effect,
     the `autoFittedKeys` set, and the `autoFitBody?` field are dead. (AF Session-6 hand-off #1,
     confirmed.)
  6. The dead **ErrorCard popout/lift wiring** — `usePoppedCards` + `popKey` import, `cardKey`,
     `onToggleFromCtx`, the `onTogglePopout` prop, and the unused `MIME_TEXT_INSERT` import: error is
     ratified not-poppable and neither call site (`ErrorsPanel.tsx:143`, `omni.tsx:41`) passes
     `isPoppedOut`/`onTogglePopout`. (AF Session-6 hand-off #2, confirmed.)

- **Already gardened / moot (the punch-list is stale, no action or a tiny relocation):**
  - **`QuotationGroupCard` / Quotations** — fully deleted; zero `src/` refs. (Closed by A0 §3.3.)
  - **`FloatCard` / `FloatingCards.tsx` / `TextObjectFloat.tsx`** — deleted by AF; only stale
    *doc-comment* mentions remain.
  - **`renderPoppedCard` 14-case switch** — already stripped from `floating-cards.tsx` by AF; the
    file is now just the `PoppedCardDeps` type. The only A1 move here is a **relocation** (rename the
    type's home into `src/cards/card-float-ctx.ts` and delete the residual misnamed file).
  - **`legacySpawn`** — the §9 item is a **mislabel**: the only `legacySpawn` in the tree is a *live*
    local variable in the text-object lift fallback (`TextObjectGrabHandle.tsx:796`). Nothing to garden.
  - **Dual example key** — A0 §3.4 / AF §10-Q4 left the *collapse* call to A1. **Ruling: do NOT
    collapse.** `float:card:example:` (panel Card) and `float:textobject:exampleBlock:` (the block
    TextObject) are two surfaces of two ontologies; the AF `float:` grammar already disambiguates
    them. Collapsing would merge a Card with a TextObject — a direct violation of "two kinds, never
    merge."

- **NOT actually dead — needs Gabriel's ratification before any removal (1 surface):**
  - **The three detached toolbars** (`DetachedActionsToolbar` / `DetachedFormattingToolbar` /
    `DetachedMenuToolbar`) are **live and reachable**: wired to the docked MenuBar at
    `EditorPane.tsx:3723-3725` (and re-grip at `:3207-3210`), rendered via `createPortal` at
    `:3104/:3139/:3165`, driven by live state + the `handleActionsDetach`/`handleFormatDetach`/
    `handleMenuGrabStart` handlers. The §9 punch-list calls these "vestigial"; the code says
    otherwise. **Open question O1.**

- **Type-tightening (not deletion, but A1-shaped):**
  - `popCardAtAnchor(kind: string, …)` (`EditorPane.tsx:1117`, `card-creation.ts:124`) — the param is
    a **legacy popout-prefix** string, not a `CardKind` (callers pass `"revision"`, which is the
    `revision-comment` keyPrefix, **not** a `CardKind`). The task brief's "should be `CardKind`" is
    half-right: tightening naively to `CardKind` would break `"revision"`. The **deep** fix is to make
    callers pass the canonical `CardKind` and route `popCardAtAnchor` through `cardPopKey(kind, id)`
    directly, retiring the `migrateLegacyKeyToFloat(`${cardKind}:${cardId}`)` string-building hack.

- **Stale doc-comments (3, all confirmed):** `OmniViewPanel.tsx:32`, `text-object-registry.ts:1034`,
  `EditorLayout.tsx:2412` (the example key shapes predate the canonical `float:card:<kind>:<id>` /
  `cardPopKey` SSOT).

- **Gated (do NOT delete in A1):** the legacy stack path (`cardKeyPrefixToStackKind` /
  `resolveCardData` at `EditorPane.tsx:887-909` + `resolve-card.ts`) is **gated on AF's deferred
  `snapshotForStack`** — every card/text-object `Floatable.snapshotForStack` returns `null` today, so
  this path is the only working stack-drop serialization. Flag, do not remove. (AF Session-6
  hand-off #3, respected.)

Net: **6 safe-now deletions**, **1 safe-now relocation**, **1 type-tightening**, **3 stale-comment
fixes**, **1 gated path (no-op)**, **1 not-dead surface needing ratification**.

---

## 1. Current reality (code-derived, EXACT file:line) — against the finished foundations

### 1.1 grip-redesign DISABLED drags (2 left; Quotations gone)
- `src/panels/Todo/TodoRow.tsx:96-109` — `// TODO(grip-redesign): drop-into-document via the grip is
  disabled …` + a fully commented-out `handleDragStart` (`MIME_TODO`).
- `src/panels/Errors/ErrorCard.tsx:115-140` — same TODO + a commented-out `handleDragStart`
  (`MIME_TEXT_INSERT`, plain-text doc fragment). The `MIME_TEXT_INSERT` *import*
  (`ErrorCard.tsx:13`) is now used **only** by this dead comment.
- `QuotationGroupCard` — **gone** (`find src -iname '*quotation*'` empty; zero `Quotations` refs).
  The §9 / AF §1.2 listing of it is moot (A0 §3.3 closed this).

### 1.2 Vestigial detached toolbars + AttachedPopover + menuLocation:"free"
- **Detached toolbars — DEFINED + LIVE.** `DetachedActionsToolbar` (`MenuBar.tsx:1015`),
  `DetachedFormattingToolbar` (`:1047`), `DetachedMenuToolbar` (`:1524`), shared shell
  `DetachedToolbar` (`floating-toolbar-shell.tsx:236`). State + handlers in `EditorPane.tsx`:
  `detachedActions/Formatting/Menus` (`:2025-2027`), `handleActionsDetach` (`:2213`),
  `handleFormatDetach` (`:2225`), `handleMenuGrabStart` (`:2237`); render portals at `:3104`, `:3139`,
  `:3165`; **wired to the docked MenuBar** at `:3723-3725` (`onActionsDetach`/`onFormatDetach`/
  `onGrabStart`) and to each detached copy's re-grip at `:3207-3210`. **Reachable → not dead.**
- **AttachedPopover — DEFINED, NEVER RENDERED.** `MenuBar.tsx:671` `function AttachedPopover(...)`;
  zero `<AttachedPopover` usages. Dead.
- **`menuLocation` / `MenuLocation` / `kind:"free"` — DEAD.**
  - Type: `useViewPrefs.ts:66-68` (`{kind:"home"} | {kind:"free"; left; top}`).
  - Field: `useViewPrefs.ts:135` (`ViewPrefs.menuLocation`).
  - Default: `useViewPrefs.defaults.json:85`; reader default `reader-view-prefs.ts:213`
    (`{kind:"home"}`).
  - Writer: `setMenuLocation` (`useViewPrefs.ts:1211`, exported `:1521`) — **zero callers**.
  - **Never read to render** — no `menuLocation.kind === "free"` consumer exists (the one
    `pen.status === "free"` at `CollabStatusPill.tsx:110` is unrelated). The whole pref is a dangling
    writer + an unreachable union arm.

### 1.3 Legacy `comments.json` / `useComments`
- `src/hooks/useComments.ts` — full hook (`useComments`, `addComment`, `updateComment`,
  `resolveComment`, `deleteComment`); `comments.json` sidecar.
- Types: `src/lib/types.ts:65` `UserComment`, `:73-74` `CommentsState`.
- **Callers: NONE.** Every `addComment` / `*Comment` in `src/` is `revisionsHook.addComment`
  (`useRevisions.ts:160`), `cutterHook.addComment` (`useCutter.ts:193`), or the AIWindow prop
  (`AIWindow.tsx:371` → wired to cutter at `EditorPane.tsx:3080`). The dead `useComments` is an
  orphaned generation of the comment feature, fully superseded by Revisions + Cutter.

### 1.4 `legacySpawn` (mislabel — already not a target)
- Only occurrence: `TextObjectGrabHandle.tsx:796-802` — a **live** local `const legacySpawn = {...}`
  in the text-object lift gesture's fallback path (fires when a lift rect can't be resolved). Plus
  doc-comment mentions of "the legacy spawn" at `LiftedTextOverlay.tsx:201`,
  `text-object-registry.ts:799/903/966`. Nothing to remove.

### 1.5 Dual example-block popout key
- Panel Card: `float:card:example:<id>` — registered `cards/floats/index.tsx:487`
  (`ctx.examples.find(e => e.exampleId === id)`), `origin:"derived"` in `CARD_REGISTRY`.
- Block TextObject: `float:textobject:exampleBlock:<uuid>` — `textObjectFloatable`
  (`text-object-floatable.tsx`), registry entry `text-object-registry.ts:643`.
- The legacy ambiguity (a bare `example:<id>` could be either) is documented at
  `float-key.ts:74-78` and resolved only by the doc-aware leg in `post-load-migrations.ts:59`. Under
  the `float:` grammar the two are **fully disambiguated by domain**. FloatHost dispatches each
  through its own registry (`FloatHost.tsx:55` textobject vs `:63` card).

### 1.6 `kind: string` → `CardKind` tightening
- `popCardAtAnchor` definition: `EditorPane.tsx:1116-1134` — signature `(cardKind: string, cardId,
  anchorRect)`; body builds `migrateLegacyKeyToFloat(`${cardKind}:${cardId}`)`.
- `CardCreationDeps.popCardAtAnchor`: `card-creation.ts:124` — same `(kind: string, …)` shape.
- Literal callers (14): `EditorPane.tsx:2297` `"revision"`, `:2378` `"archive"`; `card-creation.ts`
  `:333` `"note"`, `:347` `"highlight"`, `:402` `"cutter-comment"`, `:428` `"cutter-suggestion"`,
  `:452` `"report"`, `:471` `"report-request"`, `:498` `"revision"`, `:524` `"revision-suggestion"`,
  `:545` `"todo"`, `:566` `"footnote"`, `:588` `"archive"`, `:613` `"citation"`.
- **The hazard:** `"revision"` is the legacy keyPrefix for `revision-comment` — **not** a member of
  the canonical `CardKind` union (A0 dropped the bare `revision`/`comment` collision). 13 of 14
  literals happen to equal a `CardKind`; `"revision"` does not. So the param is a
  prefix-or-kind hybrid, and `migrateLegacyKeyToFloat` exists precisely to absorb that.

### 1.7 AF Session-6 hand-offs
- **(1) Inert `autoFitBody` grow-burst.** `FloatWindow.tsx:67-118` (effect), `:18` (`autoFittedKeys`
  Set), `:96` `types.ts` (`autoFitBody?: boolean`). **Producers: ZERO** — exhaustive grep finds only
  the consumer (FloatWindow), the type def, and a comment. `text-object-floatable.tsx:67-69`
  explicitly documents "nothing opts in now"; `cardFloatable` (`cards/floats/index.tsx:60-88`) never
  sets it. Fully inert.
- **(2) Dead ErrorCard residual lift-wiring.** `ErrorCard.tsx`: `usePoppedCards` import (`:10`),
  `popKey` import (`:11`), `cardKey = popKey("errors", err.id)` (`:107`), `popped`/`onToggleFromCtx`
  (`:106-111`), `onTogglePopout` prop (`:86,101,150`), `data-card-key`/`cardKey` props on PanelCard
  (`:145,151`). Neither caller (`ErrorsPanel.tsx:143`, `Errors/omni.tsx:41`) passes
  `isPoppedOut`/`onTogglePopout`, and `error` has no `toFloatable` registration → the whole popout
  branch is unreachable. The self-documenting comment at `ErrorCard.tsx:248-250` already flags this
  for "Stage 6" gardening.
- **(3) Legacy stack path — GATED, do not delete.** `EditorPane.tsx:887-909` (`cardKeyPrefixToStackKind`
  + `resolveCardData` + `snapshotCard`), defs in `resolve-card.ts:26` / `:74`. Every
  `Floatable.snapshotForStack` returns `null` today (`cards/floats/index.tsx:85`,
  `text-object-floatable.tsx:66`), so this prefix path is the ONLY working stack-drop serialization.
  The comment at `EditorPane.tsx:876` ("Stage 5 retires this prefix path in favor of
  `Floatable.snapshotForStack`") states the gate. **Blocked on the AF `snapshotForStack` thread.**

### 1.8 Residual: `floating-cards.tsx` reduced to a type
- `src/components/editor-layout/floating-cards.tsx` (179 lines) — the `renderPoppedCard` switch is
  already removed (comment `:175-179`); the file now exports **only** `PoppedCardDeps`
  (`:33-173`). That type is the live `CardFloatCtx` (re-export `card-float-ctx.ts:14`; imported
  `EditorPane.tsx:126`, `cards/floats/index.tsx`). So the file is misnamed and mis-homed — pure
  relocation opportunity.

---

## 2. Wart — `useComments` / `comments.json` orphan

- **WHAT:** A complete, persisted comment subsystem with no consumers.
- **WHERE:** `src/hooks/useComments.ts` (whole file); `src/lib/types.ts:65-74` (`UserComment`,
  `CommentsState`).
- **WHY wrong:** Superseded by Revisions (`useRevisions`) and Cutter (`useCutter`) comment models.
  Keeping it invites accidental revival of a dead `comments.json` sidecar and clutters the type
  surface. Classified **safe-now**.
- **DEEPEST fix:** delete `useComments.ts`; delete `UserComment` + `CommentsState` from
  `src/lib/types.ts`. No prefs/sidecar migration needed (nothing ever read `comments.json` in the
  shipped app; if any dev doc has one on disk it's simply ignored — note in the impl chip to confirm
  `samples/annotation-history/` carries no `comments.json`).

## 3. Wart — the `menuLocation` pref model (dangling writer + unreachable union)

- **WHAT:** A persisted `menuLocation: {kind:"home"} | {kind:"free";…}` pref with a writer
  (`setMenuLocation`) and no reader and no caller. A fossil of an earlier "drag the menu out to a free
  coordinate" design that the *detached-toolbar* mechanism replaced.
- **WHERE:** `useViewPrefs.ts:66-68` (type), `:135` (field), `:1211/:1214` (`setMenuLocation`), `:1521`
  (export); `useViewPrefs.defaults.json:85`; `reader-view-prefs.ts:213`.
- **WHY wrong:** Dead state in the persisted prefs envelope; the `kind:"free"` arm is unreachable
  (no writer sets it, no reader honors it). This is the §9 "unreachable `menuLocation:'free'`"
  item — and the whole pref, not just the arm, is dead.
- **DEEPEST fix:** remove the `MenuLocation` type, the `menuLocation` field, `setMenuLocation`, and
  the default. Because it's a **persisted pref**, add a one-line drop in the `useViewPrefs` read-time
  migration (strip a stale `menuLocation` key from loaded prefs) so no schema-validation noise on
  upgrade — same pattern AF used for `selection:`. (Cross-cutting constraint §8: migrate any
  pref-schema change.)

## 4. Wart — `AttachedPopover` defined-but-unrendered

- **WHAT / WHERE:** `MenuBar.tsx:671` `function AttachedPopover(...)`; never instantiated. The
  doc-comment at `:871-873` ("popover (in MenuBar) and the detached floating toolbar … no-op when
  rendered detached") references the *concept* but the component itself is dead.
- **WHY wrong:** Dead component; its presence implies a docked-popover affordance that isn't wired.
- **DEEPEST fix:** delete `AttachedPopover` and reconcile the `:871-873` comment to describe only the
  live detached path. Verify no `onGrabStart`-shaped prop only existed to feed it (the detached
  toolbars use their own grab handlers, so this is isolated).

## 5. Wart — grip-redesign DISABLED drags (dead commented code)

- **WHAT / WHERE:** `TodoRow.tsx:96-109`, `ErrorCard.tsx:115-140` — commented-out `handleDragStart`
  blocks behind a `TODO(grip-redesign)`.
- **WHY wrong:** Dead commented code; the `MIME_TEXT_INSERT` import in `ErrorCard.tsx:13` survives
  only to satisfy the comment.
- **DEEPEST fix:** remove both comment blocks and the now-orphaned `MIME_TEXT_INSERT` import. The
  re-introduction intent ("via a separate body-level affordance, not the grip") is a real future
  feature — preserve it as a one-line note in `STYLE_GUIDE.md` or a tracked issue rather than
  dead-code-in-place, so the grip stays clean. (A6 marginalia / A4 owns any actual re-introduction.)

## 6. Wart — inert `autoFitBody` grow-burst (AF hand-off #1)

- **WHAT / WHERE:** `FloatWindow.tsx:67-118` (the ~50-line auto-fit `useEffect`), `:18`
  (`autoFittedKeys`), `:19-20` (`TEXT_FLOAT_HEADER_H`/`TEXT_FLOAT_BORDERS`), `types.ts:96`
  (`autoFitBody?: boolean`), and the `capPopoutHeight` import insofar as it's used only here.
- **WHY wrong:** No `Floatable` sets `autoFitBody` (exhaustive grep: zero producers). AF's text-object
  rebuild made text floats spawn at the lift's captured height, so the grow-burst lost its only
  consumer. Dead by construction.
- **DEEPEST fix:** delete the effect + `autoFittedKeys` + the two header/border consts + the
  `autoFitBody?` field from `Floatable`. Keep `capPopoutHeight` (still used by the lift-capture site
  in `TextObjectGrabHandle`); only its FloatWindow use goes. **Verify `capPopoutHeight` retains
  another importer before removing the import line.** Confirm keystroke sanctity unaffected (the
  effect was mount-time, not per-keystroke — removing it is pure subtraction).

## 7. Wart — dead ErrorCard popout/lift wiring (AF hand-off #2)

- **WHAT / WHERE:** `ErrorCard.tsx` — `usePoppedCards` (`:10`) + `popKey` (`:11`) imports, `cardKey`
  (`:107`), `popped`/`onToggleFromCtx` (`:106-111`), the `onTogglePopout` prop (`:86,101`) and its
  PanelCard wiring (`:150`), the `data-card-key`/`cardKey` PanelCard props (`:145,151`), and the dead
  `MIME_TEXT_INSERT` import (shared with §5).
- **WHY wrong:** `error` is ratified not-poppable (A0 §3.5; no `toFloatable` registration). Neither
  call site passes `isPoppedOut`/`onTogglePopout`, so the entire popout branch is unreachable. The
  card still needs its `data-card-key` for hover/selection seams? **Verify:** `ErrorCard` is rendered
  in a panel and omni; its `data-card-key` may still feed the entity-hover bridge. If the hover/select
  highlight for errors relies on `data-card-key`, KEEP that attribute (compute the key without the
  popout machinery) and only remove the `usePoppedCards`/`onToggleFromCtx`/`onTogglePopout` popout
  path. If errors have no in-text hover seam (system kind, ephemeral ids), remove the attribute too.
  This is the one ErrorCard nuance to settle in impl (see O3).
- **DEEPEST fix:** strip the popout path; reduce `ErrorCard` to its docked/omni rendering. Drop the
  `onTogglePopout` from `ErrorCardProps`. Remove `usePoppedCards`/`popKey` imports.

## 8. Relocation — `floating-cards.tsx` → `card-float-ctx.ts`

- **WHAT / WHERE:** `floating-cards.tsx` is now only the `PoppedCardDeps` interface (`:33-173`); the
  dispatcher is gone. `card-float-ctx.ts:14` re-exports it as `CardFloatCtx`.
- **WHY wrong:** The filename and location lie about the contents (no floating-card rendering lives
  there anymore); the canonical home for this type per A0 §4.1 is `src/cards/card-float-ctx.ts`.
- **DEEPEST fix:** move the `PoppedCardDeps` interface body into `src/cards/card-float-ctx.ts` (rename
  to `CardFloatCtx` as the primary export, keep a `PoppedCardDeps` alias for ripple-min if needed),
  update the two importers (`EditorPane.tsx:126`, the re-export), and delete
  `editor-layout/floating-cards.tsx`. Coordinate with A0-impl's `card-float-ctx.ts` (already created)
  — this is the natural completion of the A0 re-home that AF left half-done. **Cross-arena seam with
  A0/A3** (they own `CardFloatCtx`'s field set).

## 9. Type-tightening — `popCardAtAnchor(kind: string)` → canonical `CardKind`

- **WHAT / WHERE:** `EditorPane.tsx:1116-1134` (def), `card-creation.ts:124` (deps type), 14 literal
  callers (§1.6). The body builds the float key via `migrateLegacyKeyToFloat(`${cardKind}:${cardId}`)`.
- **WHY wrong:** A `string` param invites the legacy-prefix/kind ambiguity the rest of the spine just
  eliminated; `"revision"` is a non-`CardKind` keyPrefix smuggled through. The string-concat +
  legacy-migrate dance re-implements `cardPopKey` indirectly.
- **DEEPEST fix (deeper than the brief's literal "make it `CardKind`"):** change both signatures to
  `(kind: CardKind, id, anchorRect)`; change the two `"revision"` literals to `"revision-comment"`
  (`EditorPane.tsx:2297`, `card-creation.ts:498`); replace the body's
  `migrateLegacyKeyToFloat(`${cardKind}:${cardId}`)` with the SSOT `cardPopKey(kind, id)`
  (`panel-registry.ts`, delegating to `buildFloatKey`). This removes a second consumer of the legacy
  string grammar and makes `tsc` enforce the kind at every call site. **Cross-arena seam with A3**
  (creation pipeline owns these call sites).

## 10. Stale doc-comments (3)

- **(a) `OmniViewPanel.tsx:32-35`** — "Card ids follow `${cardKindPrefix}:${id}` (e.g. `note:abc`,
  `cutter-comment:xyz`)". **Stale**: the canonical key is `float:card:<kind>:<id>` and the AF-fix
  invariant is `omniKey === data-omni-entry === cardPopKey(kind,id)`. Fix to describe the `float:`
  grammar + the `cardPopKey` SSOT.
- **(b) `text-object-registry.ts:1034-1037`** — the `textObjectPopoutKey` docstring ("Construct the
  canonical popout key … `textobject:<kind>:<id>` … Phase D10 migrates legacy `paragraph:`/`heading:`/
  `list:`/`texBlock:`/`example:`/`selection:` keys to this shape"). **Stale**: the function now
  delegates to `buildFloatKey` (`:1043`) → emits `float:textobject:<kind>:<id>`; the D10 legacy-key
  list predates the AF `float:<domain>:<kind>:<id>` unification. Fix to reference `buildFloatKey` +
  the `float:` grammar.
- **(c) `EditorLayout.tsx:2412-2424`** — the `tryScrollOmniEntry` block, specifically the inline
  example at `:2422-2423` (`"nt:id@0"` / `"nt:id"`). **Stale**: the `nt:` legacy prefix is gone;
  `data-omni-entry` is now `cardPopKey(kind,id)` = `float:card:<kind>:<id>` (the `@N`
  multi-paragraph suffix logic is still valid). Fix the example key shape to the `float:` form.

---

## Target design — the deepest-fix shape; how it consumes the foundations

A1 is *subtractive*, so the "design" is a disposition policy keyed to the foundations:

1. **Delete on the dead side; relocate on the type side.** Six dead surfaces (§2–§7) are pure
   subtraction. The one residual structural debt (§8) completes A0's `card-float-ctx.ts` re-home:
   `PoppedCardDeps` → `CardFloatCtx` in `src/cards/`, `floating-cards.tsx` deleted.
2. **Lean on the AF/A0 SSOTs instead of legacy string-building.** §9 routes `popCardAtAnchor` through
   `cardPopKey` (the `buildFloatKey` SSOT) and `CardKind`, deleting a legacy-grammar consumer. The
   stale comments (§10) are re-pointed at `buildFloatKey` / `cardPopKey` / the
   `omniKey===data-omni-entry===cardPopKey` invariant.
3. **Registry-derive nothing new here** — A1 doesn't add predicates; it removes hand-kept fossils.
   The `autoFitBody?` field leaves the `Floatable` contract (it was never a real capability).
4. **The dual example key stays two keys** (registry-derived by domain via the two `toFloatable`
   factories) — no collapse, because the two kinds never merge.
5. **The not-dead detached toolbars are out of scope for deletion** pending O1; if Gabriel rules them
   keepable, A1 touches none of that machinery (and the `menuLocation` pref still dies independently,
   since it's a *separate, unreachable* generation).

DoD-relevant ordering: every A1 deletion is independent and can land in small commits, each `tsc`-green
and 570-tests-green. The §8 relocation and §9 tightening touch shared files
(`EditorPane.tsx`, `card-creation.ts`) so they sequence after / alongside A3 to limit conflicts.

---

## Keystroke sanctity

**No per-keystroke risk introduced — every change is pure subtraction or a static-key swap.**

- §6 (`autoFitBody`) removes a **mount-time** effect, not an `editor.on()` subscriber — it never ran
  per keystroke; deleting it cannot regress emitCount.
- §9 routes `popCardAtAnchor` through `cardPopKey` (O(1) string build) at *creation* time, not on
  typing.
- §10 is comments only.
- A1 touches **none** of the sanctioned `editor.on('update'|'transaction')` subscribers
  (`useDocument`, `useWordCount`, `useLatexLint`, `useEditorUIState`, `EditorLayout` presence/PDF,
  `LinkConnector`, `SlashCommandPopup`, `TextObjectGrabHandle`, `EditorMirror`, `Marginalia`,
  `float-sync`). The one file A1 edits that *contains* a sanctioned subscriber is `EditorLayout.tsx`
  (§10c comment, §1.2 detached-toolbar state) and `EditorPane.tsx` (§8/§9) — but the edits are to
  comments, a creation helper, and a type import, never to the subscriber bodies.
- **Verify (impl):** `window.__virgilBusStats().emitCount` flat typing N plain chars with a card float
  open, before/after each deletion — a trivially-passing check given the subtractive nature.

---

## Fragmentation table

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| `useComments` hook | `src/hooks/useComments.ts` (whole) | **DELETE** (zero callers) — safe-now |
| `UserComment` / `CommentsState` types | `src/lib/types.ts:65-74` | **DELETE** with the hook — safe-now |
| `MenuLocation` type + `menuLocation` field | `useViewPrefs.ts:66-68,135` | **DELETE** + read-time prefs drop — safe-now |
| `setMenuLocation` (no callers) | `useViewPrefs.ts:1211-1214,1521` | **DELETE** — safe-now |
| `menuLocation` defaults | `useViewPrefs.defaults.json:85`; `reader-view-prefs.ts:213` | **DELETE** — safe-now |
| `AttachedPopover` (unrendered) | `MenuBar.tsx:671`; comment `:871-873` | **DELETE** + reconcile comment — safe-now |
| grip-redesign dead drag (Todo) | `TodoRow.tsx:96-109` | **DELETE** comment block — safe-now |
| grip-redesign dead drag (Error) | `ErrorCard.tsx:115-140`; `MIME_TEXT_INSERT` import `:13` | **DELETE** block + orphaned import — safe-now |
| inert `autoFitBody` burst | `FloatWindow.tsx:18-20,67-118`; `types.ts:96` | **DELETE** effect + field (no producers) — safe-now |
| dead ErrorCard popout wiring | `ErrorCard.tsx:10,11,86,101,106-111,145,150,151` | **DELETE** popout path (verify `data-card-key` hover seam — O3) — safe-now |
| `floating-cards.tsx` (type-only residual) | `editor-layout/floating-cards.tsx` (whole); re-export `card-float-ctx.ts:14`; import `EditorPane.tsx:126` | **RELOCATE** `PoppedCardDeps`→`src/cards/card-float-ctx.ts`; delete file — safe-now (A0/A3 seam) |
| `popCardAtAnchor(kind: string)` | `EditorPane.tsx:1116-1134,2297,2378`; `card-creation.ts:124` + 12 callers | **TIGHTEN** to `CardKind` + route via `cardPopKey`; `"revision"`→`"revision-comment"` — safe-now (A3 seam) |
| stale omni-key comment | `OmniViewPanel.tsx:32-35` | **FIX** comment → `float:`/`cardPopKey` SSOT — safe-now |
| stale `textObjectPopoutKey` doc | `text-object-registry.ts:1034-1037` | **FIX** comment → `buildFloatKey`/`float:` grammar — safe-now |
| stale `tryScrollOmniEntry` example | `EditorLayout.tsx:2412-2424` | **FIX** `nt:id` example → `float:card:<kind>:<id>` — safe-now |
| dual example key | `cards/floats/index.tsx:487`; `text-object-registry.ts:643`; `float-key.ts:74-78` | **KEEP** two keys (two ontologies) — ruling, no change |
| legacy stack path | `EditorPane.tsx:876,887-909`; `resolve-card.ts:26,74` | **GATED** on AF `snapshotForStack` — DO NOT DELETE |
| detached toolbars (live) | `MenuBar.tsx:1015,1047,1524`; `EditorPane.tsx:2213-2249,3104-3221,3723-3725` | **NOT DEAD** — needs ratification (O1) |
| `legacySpawn` (live local) | `TextObjectGrabHandle.tsx:796-802` | **KEEP** — mislabel, not a target |

---

## Definition of Done for this arena

1. **Dead code gone:** `useComments`/`comments.json` (+ types), the `menuLocation` pref model
   (+ prefs migration drop), `AttachedPopover`, both grip-redesign dead-drag comments, the inert
   `autoFitBody` burst (+ `Floatable.autoFitBody` field), the dead ErrorCard popout wiring.
2. **Residual relocated:** `PoppedCardDeps` lives in `src/cards/card-float-ctx.ts` as `CardFloatCtx`;
   `editor-layout/floating-cards.tsx` deleted; importers updated.
3. **Type-tightened:** `popCardAtAnchor` takes `CardKind`, routes via `cardPopKey`; no `"revision"`
   keyPrefix literal survives; legacy `migrateLegacyKeyToFloat(`${k}:${id}`)` consumer in
   `popCardAtAnchor` removed.
4. **Comments accurate:** the 3 stale doc-comments describe the `float:`/`cardPopKey`/`buildFloatKey`
   SSOT.
5. **Gated path untouched:** `cardKeyPrefixToStackKind`/`resolveCardData` remain until AF's
   `snapshotForStack` lands (tracked, not removed).
6. **Ratified scope honored:** detached toolbars kept (or removed) per O1; nothing removed on a guess.
7. **Green:** `tsc` clean; 570 tests green; `__virgilBusStats().emitCount` flat on plain typing with a
   float open; no new lint problems. Dev-preview walk: errors render docked + omni with no popout
   affordance; a card float still spawns at its anchor (popCardAtAnchor path); the detached toolbars
   (if kept) still tear off.
8. **No silent data loss:** the `menuLocation` and `comments.json` removals carry the read-time prefs/
   sidecar handling so upgraded users see no schema error.

---

## Open questions for the human

- **O1 — Detached toolbars: keep or kill?** The §9 punch-list calls
  `DetachedActionsToolbar`/`DetachedFormattingToolbar`/`DetachedMenuToolbar` "vestigial," but they are
  **live and reachable** (wired to the docked MenuBar at `EditorPane.tsx:3723-3725`, rendered at
  `:3104/:3139/:3165`). Are these a real shipping feature (keep, A1 touches nothing) or a
  to-be-retired experiment (then A1 can delete the three components + handlers + state + the
  `floating-toolbar-shell` detached path)? **Default recommendation: KEEP** — they're functional;
  removing a working tear-off feature exceeds "gardening." The dead `menuLocation` pref dies
  regardless (separate, unreachable generation).
- **O2 — `menuLocation` removal is a persisted-pref deletion.** Confirm A1 may drop the `menuLocation`
  field from the prefs schema (with a read-time strip), or should it stay as a reserved field for a
  future free-floating-menu design? (Recommendation: drop — the detached-toolbar path supersedes it;
  reserve nothing dead.)
- **O3 — ErrorCard `data-card-key` after de-popping.** Does the error card's `data-card-key` still
  feed an in-text hover/selection seam (entity-hover bridge), or is it only the popout key? If the
  former, KEEP the attribute (computed via `cardPopKey("error", id)`) and remove only the
  `usePoppedCards`/`toggleAtAnchor` machinery; if the latter, remove the attribute too. (A2 owns the
  hover seam — coordinate.)
- **O4 — Dual example key collapse.** A0/AF deferred the call to A1. **Recommendation: do NOT
  collapse** (two ontologies; merging violates the two-kinds rule). Confirm so the impl chip records
  "kept by design" and closes the §9 line item.
- **O5 — grip re-introduction note.** The grip-redesign TODOs say "re-introduce via a body-level
  affordance." Should A1 file that intent somewhere durable (issue / STYLE_GUIDE note) before deleting
  the dead comments, or just delete? (Recommendation: one-line note in the bug backlog
  `MEMO_BUG_BACKLOG.md`, then delete.)

---

## Cross-arena seams

- **A0 (spine) + A3 (creation/lifecycle)** — `floating-cards.tsx`'s `PoppedCardDeps` IS the
  `CardFloatCtx` A0 created (`card-float-ctx.ts:14`). The §8 relocation completes A0's re-home and
  edits the ctx type A3's creation pipeline consumes. Shared file: `src/cards/card-float-ctx.ts`,
  `EditorPane.tsx:126`. **Sequence A1's §8 with/after A3** to avoid `CardFloatCtx` churn.
- **A3 (creation)** — `popCardAtAnchor` (§9) is a creation-path helper; its 14 callers live in
  `card-creation.ts` (A3's file). Shared file: `src/components/editor-layout/card-actions/
  card-creation.ts:124,333-613`, `EditorPane.tsx:1116-1134`. **The `CardKind` tightening should land
  with or just after A3's creation-pipeline unification.**
- **A2 (anchoring/hover)** — ErrorCard `data-card-key` (§7 / O3) may participate in the entity-hover
  bridge (`src/links/_shared/entity-hover.ts`). Shared surface: `ErrorCard.tsx:145`. **Confirm with A2
  before removing the attribute.**
- **A5 (omni)** — the stale `OmniViewPanel.tsx:32` comment (§10a) and the `data-omni-entry` invariant
  it now mis-describes are A5's surface. Shared file: `src/panels/Omni/OmniViewPanel.tsx`. A1 fixes
  the comment; A5 owns the omni-key behavior.
- **A6 (marginalia)** — the grip-redesign drags (§5) were marginalia-gutter / drop-into-document
  affordances; the future re-introduction (O5) belongs to A6/A4. A1 only deletes the dead comments.
  Shared files: `TodoRow.tsx`, `ErrorCard.tsx`, `MIME_*` in `src/lib/marginalia.ts`.
- **AF (floats)** — §6 (`autoFitBody`) and §7 (ErrorCard popout) edit AF's `src/floats/FloatWindow.tsx`
  + `types.ts` and the popout machinery AF owns; the gated stack path (§1.7) is blocked on AF's
  `snapshotForStack`. Shared files: `src/floats/FloatWindow.tsx`, `src/floats/types.ts`,
  `src/lib/stack/resolve-card.ts`. **Coordinate the `autoFitBody` field removal with any in-flight AF
  follow-up.**
- **A10 (cross-cutting / persistence)** — the `menuLocation` (§3) and `comments.json` (§2) removals are
  pref/sidecar-schema deletions; A10 owns persistence integrity + migrations. Shared file:
  `src/hooks/useViewPrefs.ts` (+ `.defaults.json`). **Confirm the migration pattern with A10.**

---

## Stale-ref corrections (SSOT / older-audit refs vs current tree @ `588ae7e`)

| Stated in | Said | Reality now |
|---|---|---|
| `CARD-SYSTEM-REFACTOR.md` §9 / §7-A1 | "grip-redesign disabled drags (TodoRow/**QuotationGroupCard**/ErrorCard)" | `QuotationGroupCard` **deleted**; only `TodoRow.tsx:96` + `ErrorCard.tsx:115` remain |
| §9 / §7-A1 | "vestigial detached toolbars" | **LIVE + reachable** (`EditorPane.tsx:3723-3725`); not dead — O1 |
| §9 / §7-A1 | "`legacySpawn`" | mislabel — only a **live local** `TextObjectGrabHandle.tsx:796`; nothing to garden |
| §9 / §7-A1 | "the dual example-block key" left to A1 | both keys now domain-disambiguated by AF (`float:card:example:` vs `float:textobject:exampleBlock:`); **keep** (O4) |
| AF audit §1.2 | 15 inline `<FloatCard>` sites incl. `QuotationGroupCard.tsx` | `FloatingCards.tsx` + `TextObjectFloat.tsx` **deleted** by AF; all inline early-returns gone; only doc-comment mentions of `FloatCard` survive |
| AF audit §1.5 / §1.10 | `renderPoppedCard` 14-case switch in `floating-cards.tsx:200-540` | switch **already stripped**; `floating-cards.tsx` is now 179 lines = only `PoppedCardDeps` (`:33-173`) → relocate (§8) |
| AF Session-6 hand-off | "remove the inert FloatWindow auto-fit grow-burst" | confirmed inert; effect at `FloatWindow.tsx:67-118` (line refs were never pinned — now exact) |
| Task brief | `popCardAtAnchor` at `card-creation.ts:124` "callers pass `revision`/`archive`/`note`" + "should be `CardKind`" | confirmed `:124`; but `"revision"` is a **keyPrefix, not a `CardKind`** — naive `CardKind` tightening breaks it; deep fix maps `"revision"`→`"revision-comment"` + routes via `cardPopKey` |
| Task brief | stale comments at `OmniViewPanel.tsx:32`, `text-object-registry.ts:1035`, `EditorLayout.tsx:2412` | confirmed: `OmniViewPanel.tsx:32`, `text-object-registry.ts:1034-1037` (off by ~1), `EditorLayout.tsx:2412-2424` (example at `:2422`) |
| A0 audit §3.5 | ErrorCard popout dead | confirmed; ErrorCard now carries the self-flagging comment `:248-250` and no `toFloatable` registration — A1 strips the residual wiring |
