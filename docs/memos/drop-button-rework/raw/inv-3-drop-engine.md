# INV-3 — The drop-mode engine, and whether it can be driven from a DOCKED card button

Read-only investigation. Every load-bearing claim cites `file:line` against the working tree at the time of the audit.

---

## 0. TL;DR verdict

1. **CAN the button start a session from a docked card?** — **YES, with a small, well-scoped generalization.** `beginDropSession` (`src/components/drop-mode/controller.ts:90`) requires only **(a) a `cardKey`, (b) an `origin: {x,y}` point, (c) a registered `DropCtx`**, and **(d) a registered `DropSpec` for the kind**. It does **NOT** require a pre-existing float. The only float-coupled thing it does is the optional `markSourceFloat(cardKey,true)` dimming (`controller.ts:124`), and that is *already* skippable via `inPlace: true` (`controller.ts:108`). Every drop **spec** resolves its source by **entity id / captured position / doc scan** — never by reading a float. So a docked `PanelCard` that already knows its `cardKey` (it sets `data-card-key={cardKey}`, `panel-primitives.tsx:1913`) and has a live DOM box (`innerRef`, `panel-primitives.tsx:1789`) has everything `beginDropSession` needs. The shift-mousedown-on-FloatingPanel-header coupling is *incidental to the producer*, not a contract of the engine.

2. **Unanchored-anchor case** — **already supported for paragraph-side kinds, missing for inline-atom kinds.** The generic side-reanchor spec `text-object-side-reanchor.ts:44` returns `{kind:"apply"}` when `current.length === 0` (no existing anchor) and `{kind:"confirm"}` when it is anchored elsewhere — so notes/todos/reports/cutter/revisions/archive/highlights handle BOTH anchor-the-unanchored AND re-anchor TODAY. The inline-atom kinds (footnote/citation) do **NOT**: their spec scans the doc for an *existing* atom by id (`inline-atom-move.ts:204 locateAtom`), so a draft/unanchored card with no atom → `locateAtom` returns null → `classifyDrop` → `no-op`. This is the real gap.

3. **Draft-atom-create case (c)** — **NOT handled anywhere.** No spec or util CREATES a `\cite`/`\footnote` atom at an in-text drop point. `inlineAtomMoveSpec` only ever *moves* an existing atom (delete+insert preserving node identity, `inline-atom-move.ts:142`). Creating an atom for an atomless card is a genuinely new capability.

4. **Deepest generalization:** retire the shift-mousedown producer; add ONE `beginDropSession`-from-docked-card producer behind a new `DropButton` rendered from card chrome; extend the inline-atom spec with a **create-if-absent** branch so footnote/citation drops materialize the atom when the card has none. Both changes are derivations of existing SSOTs (the per-kind `dropSpec` facet, the `inlineAtomMoveSpec` factory, the `float-key` grammar) — no parallel switch.

---

## 1. `beginDropSession` — exact required inputs

`src/components/drop-mode/controller.ts:90-128`:

```ts
export function beginDropSession(opts: {
  cardKey: string;
  origin: { x: number; y: number };
  inPlace?: boolean;
  externalCommit?: boolean;
}): boolean {
  if (session) return false;                 // (controller.ts:96) first gesture wins
  if (!activeCtx) return false;              // (controller.ts:97) needs a registered DropCtx
  const parsed = parseAnyKey(opts.cardKey);  // (controller.ts:99)
  if (!parsed) return false;                 // (controller.ts:100) key must parse
  const kind = parsed.kind;
  const spec = lookupSpec(opts.cardKey);     // (controller.ts:105)
  if (!spec) return false;                   // (controller.ts:106) needs a DropSpec for the kind
  ...
  installListeners({ attachMouseUp: opts.externalCommit !== true }); // (controller.ts:117)
  if (typeof document !== "undefined") {
    document.body.setAttribute("data-drop-mode-active", "true");     // (controller.ts:122)
    document.body.style.cursor = "crosshair";
    if (!inPlace) markSourceFloat(opts.cardKey, true);               // (controller.ts:124) ← ONLY float touch
  }
  ...
}
```

**Required, full list:**
- `cardKey` — must satisfy `parseAnyKey` (`float:<domain>:<kind>:<id>` or a legacy/transient key). `parseAnyKey` lives at `src/floats/float-key.ts`; the canonical builder is `buildFloatKey` (`float-key.ts:42`).
- `origin: {x,y}` — only used for ESC/leave logic (`DropSession.origin`, `types.ts:251`); the hit-test is driven purely by the live `mousemove` (`controller.ts:162,209`). Any point works; a docked button can pass the mousedown `clientX/clientY`.
- A registered `DropCtx` (`activeCtx`) — set ONCE by `DropModeProvider` via `setDropCtx` (`DropModeProvider.tsx:127`). Already present per-doc; nothing per-card.
- A registered `DropSpec` — `lookupSpec(cardKey)` (`registry.ts:49`); resolves through `CARD_REGISTRY[kind].dropSpec` (`registry.ts:60`) for card kinds.

**Notably NOT required:** any float, any popout, any `data-floating-panel`/`data-pristine-card-id` DOM. The `markSourceFloat` dimming (`controller.ts:338`) is the *only* code path that queries float DOM, and it is gated `if (!inPlace)` (`controller.ts:124`). Pass `inPlace: true` and the engine never looks for a float.

The controller's own doc-comment ("from `shift-mousedown on FloatingPanel header` to drop or cancel", `controller.ts:2-3`) describes the *current sole producer*, not an engine precondition — confirmed by the two OTHER existing producers that are NOT float headers: the in-text `InlineAtomGrab` PM plugin (`src/lib/tiptap/inline-atom-grab.ts:145`) and the `StackThumbnail` (`src/components/stack/StackThumbnail.tsx:36`), both of which begin sessions with no FloatingPanel involved.

---

## 2. What FloatingPanel supplies vs. what a docked PanelCard already has

**FloatingPanel begin site** (`src/components/FloatingPanel.tsx:428-441`):
```ts
if (e.shiftKey && cardKey && mode === "floating") {
  const started = beginDropSession({
    cardKey,
    origin: { x: e.clientX, y: e.clientY },
  });
  if (started) { e.preventDefault(); return; }
}
```
It supplies **only `cardKey` + the mousedown point**. It does NOT pass `inPlace`, so the controller runs `markSourceFloat` to dim the source float (`controller.ts:124`). It does NOT pass `externalCommit`, so the controller installs its OWN mouseup → `commitDropSession` (`controller.ts:176-181`). That's the whole producer.

**A docked PanelCard already has the identical inputs:**
- `cardKey` — `PanelCard` takes it as a prop and stamps `data-card-key={cardKey}` (`panel-primitives.tsx:1699,1913`). Every card host builds the key via the registry's `cardPopKey`/`popKey` which delegate to `buildFloatKey` (`float-key.ts` header). Citation card already passes `cardKey` (`CitationCard.tsx:690,698`).
- A source rect — `innerRef` points at the card root; the existing lift gesture reads `cardEl.getBoundingClientRect()` (`panel-primitives.tsx:1838`). A drop button can read the same.
- The ghost — for a docked source the "ghost" is the card-side blue Indicator (`Indicator.tsx`), which is **viewport-relative and source-agnostic** ("works regardless of which editor (main or card body) is under the cursor", `Indicator.tsx:6-8`). The only float-shaped visual feedback is the `markSourceFloat` dimming, which is correctly skipped for an in-place gesture.

**Conclusion:** a docked card can call `beginDropSession({ cardKey, origin, inPlace: true, externalCommit: true })` and the engine will drive the full hit-test + Indicator with no float anywhere. `inPlace:true` skips the (nonexistent) float dimming; `externalCommit:true` lets the button's own mousedown→mousemove→mouseup gesture own the commit (mirrors `inline-atom-grab.ts:145-150` and `TextObjectGrabHandle.tsx:868-873`, both `inPlace:true, externalCommit:true`). If the button instead does a plain mousedown-and-release-the-DOM (button stays pressed, controller owns mouseup), it can omit `externalCommit` and let the controller's own mouseup fire `commitDropSession` (`controller.ts:177`). Either works; the existing in-place producers favor `externalCommit:true`.

---

## 3. `DropSpec` contract & the three commit cases

`DropSpec` (`src/components/drop-mode/types.ts:209-236`):
- `allowedPlacements: ReadonlyArray<PlacementKind>` — priority-ordered geometry filter (`types.ts:211`), consumed in `hit-test.ts:101-111`.
- `targetScope: "main-only" | "any-editor"` (`types.ts:219`) — `main-only` rejects card-body editors in the hit-test (`hit-test.ts:49`).
- `classifyDrop(placement, cardKey, ctx) => DropDecision` (`types.ts:226`) — runs at mouseup; returns `no-op` | `apply` | `confirm` (`types.ts:71-80`).
- `applyDrop(placement, cardKey, ctx)` (`types.ts:233`) — carries out the move/anchor.
- `postDrop: "close" | "keep"` (`types.ts:235`) — close-the-float behavior after success (`controller.ts:330`).

Commit routing is in `commitDropSession` (`controller.ts:279-315`) → `classifyDrop` → `finishApply` (`controller.ts:317-334`).

### Case (a) — RE-ANCHOR an already-anchored card → **SUPPORTED**

- Paragraph-side kinds: `text-object-side-reanchor.ts:47` returns `{kind:"confirm", title:"Re-anchor this <kind>?"}` when `current.length > 0` and the target differs; on confirm, `applyDrop` removes the old link(s) and adds the new (`text-object-side-reanchor.ts:76-84`). Mode-B textRange anchors are snapshotted to `card.originalAnchor` and the stale mark stripped first (`text-object-side-reanchor.ts:68-75`).
- Inline-atom kinds (footnote/citation): re-anchor == moving the existing marker. `inlineAtomMoveSpec` deletes+reinserts the atom preserving node identity (`inline-atom-move.ts:142-167`). Supported *as long as an atom exists*.
- Block kinds (paragraph/example): `blockMoveSpec` / `textObjectDropSpec` move the block node (`block-move.ts`, `textobject.ts`).

### Case (b) — ANCHOR a currently-UNANCHORED card → **SUPPORTED for paragraph-side, NOT for inline-atom**

- Paragraph-side: `text-object-side-reanchor.ts:44` — `if (current.length === 0) return { kind: "apply" };` → straight anchor, no confirm. This is exactly requirement (4)'s "anchor an unanchored card." The underlying `ParagraphAnchorApi` setters operate by entity id on the panel hook (`EditorPane.tsx:1277-1358` wiring `addNoteTextObjectId`, `addParagraphId`, `addCardParagraphId`, …) — **no float dependency**, so this already works from any source.
- **Inline-atom: BROKEN.** `footnoteDropSpec`/`citationDropSpec` are `inlineAtomMoveSpec({nodeName,idAttr})` (`Footnotes/drop-spec.ts:11`, `Citations/drop-spec.ts:10`). Their source resolver is `locateAtom` (`inline-atom-move.ts:204-229`), which scans the doc for a node whose `idAttr` matches the card id. An unanchored citation has a `CitationRef` in the panel but **no atom** in the doc (created via `onCreateCitation` WITHOUT `onInsertCitation`, `CitationsPanel.tsx:222-226`; `isAnchored = anchoredIds.has(cit.id)` where `anchoredIds` = the in-text `citationOrder` set, `CitationsPanel.tsx:133,331`). So `locateAtom` → null → `classifyDrop` → `no-op` (`inline-atom-move.ts:71-72`). The card cannot be anchored by drop today.

### Case (c) — CREATE the `\cite`/`\footnote` atom for a draft/atomless card → **NOT HANDLED**

No spec or util creates an atom. `inlineAtomMoveSpec` is a *move*-only factory by design (jsdoc: "move its inline marker from its current position … to the chosen inline cursor position", `inline-atom-move.ts:7-8`). The doc-level create paths exist but live OUTSIDE drop-mode:
- footnote atom create: `commands.ts:198-201` (`state.tr.replaceSelectionWith(footnoteNodeType.create({footnoteId,…}))`).
- citation atom create: `onInsertCitation` (`CitationsPanel.tsx:34` type; wired to `handleToolbarInsertCitation`, `EditorPane.tsx:2602,3828`); `Citation` node at `src/lib/tiptap/citation.ts:37`.

A draft-atom-create drop would need to `insert(node.create({<idAttr>: cardId, …}), placement.pos)` at the chosen inline-cursor instead of move-by-scan. This is the second real gap.

---

## 4. The ghost / indicator — does it need a float source?

- `DropModeIndicator` (`Indicator.tsx:14-49`): subscribes to `useDropSession()`, renders a body-portaled fixed-position blue bar from `session.placement.rect` (viewport coords). Three shapes keyed on `placement.kind` (`Indicator.tsx:24-31`). **No float dependency** — explicitly "works regardless of which editor … is under the cursor" (`Indicator.tsx:6-8`). A docked-card session paints the same bar.
- `InlineAtomGhost` (`InlineAtomGhost.tsx`): the translucent atom clone that follows the cursor during an `InlineAtomGrab` drag. Gated on BOTH the `inline-atom-ghost` module store AND a live `useDropSession()` (`InlineAtomGhost.tsx:48-49`). Only the in-text grab plugin writes that store (`inline-atom-grab.ts:167 setGhost`); a float-header or docked-button drop does NOT, so the ghost simply stays absent — which is the current behavior for float-header footnote/citation drops too. For a docked inline-atom DROP button we'd likely WANT a small ghost (optional polish), populated the same way via `setGhost` (`inline-atom-ghost.ts:91`).
- `markSourceFloat` dimming (`controller.ts:338-355`) is the ONLY float-shaped visual; skipped on `inPlace` sessions. For a docked source there is no float to dim — correct to skip.

**Conclusion:** the user-visible drag feedback (blue Indicator bar) is entirely source-agnostic. No float needed.

---

## 5. `postDrop:"close"` from a docked card — is it safe?

`finishApply` calls `ctx.closePopout(cardKey)` when `spec.postDrop === "close"` (`controller.ts:330-332`). `closePopout` is wired to `viewPrefs.closeCardPopout` (`EditorPane.tsx:3283`), which is a pure filter over `poppedOutCards` (`useViewPrefs.ts:1375-1384`). Calling it with a key that is NOT popped removes nothing and the missing-key destructure is benign → **harmless no-op**. So `blockMoveSpec`/`textObjectDropSpec`/`exampleDropSpec` (`postDrop:"close"`) are safe to drive from a docked card. The paragraph-side and inline-atom specs are `postDrop:"keep"` anyway (`text-object-side-reanchor.ts:86`, `inline-atom-move.ts:119`).

---

## 6. Per-kind placement matrix (requirement 5) — drawn straight from the registered specs

| Card kind | dropSpec (registration: `src/cards/drop-specs/index.ts`) | `allowedPlacements` | targetScope | Anchors… | postDrop |
|---|---|---|---|---|---|
| note / highlight | `noteDropSpec`/`highlightDropSpec` → `textObjectSideReanchorSpec` (`Notes/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN (paragraph) | keep |
| todo | `todoDropSpec` (`Todo/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN | keep |
| archive | `archiveDropSpec` (`Archive/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN | keep |
| cutter-comment / cutter-suggestion | `cutter*DropSpec` (`Cutter/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN | keep |
| revision-comment / revision-suggestion | `revisionDropSpec` (`Revisions/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN | keep |
| report / report-request | `report*DropSpec` (`Reports/drop-spec.ts`) | `["paragraph-side"]` | main-only | MARGIN | keep |
| footnote | `footnoteDropSpec` → `inlineAtomMoveSpec` (`Footnotes/drop-spec.ts`) | `["inline-cursor"]` (default) | any-editor | IN-TEXT (atom) | keep |
| citation | `citationDropSpec` → `inlineAtomMoveSpec` (`Citations/drop-spec.ts`) | `["inline-cursor"]` (default) | any-editor | IN-TEXT (atom) | keep |
| example | `exampleDropSpec` → `blockMoveSpec` (`Examples/drop-spec.ts`) | `["between-blocks"]` | any-editor | BLOCK position | close |
| bib / ai / error | none (`dropSpec: null`, `card-registry.tsx:287` etc.) | — | — | — (no anchor) | — |

`allowedPlacements` default for the atom specs is `["inline-cursor"]` (`inline-atom-move.ts:66`). The placement geometry (paragraph-side gutter vs inline caret vs between-blocks) is fully resolved by `hit-test.ts` from the spec's allowed list, so **requirement (5)'s per-kind judgement is ALREADY encoded in each kind's `dropSpec` facet** — no new switch needed. Requirement (6)'s "anywhere in the paragraph's horizontal band, including the margins" is satisfied by `makeParagraphSidePlacement` (`hit-test.ts:622`), which fires for any cursor X (`paragraph-side` is unconditional in the priority loop, `hit-test.ts:108-110`) — the band is the block's full vertical extent and X chooses the side (`hit-test.ts:628`). NOTE: the hit-test resolves the block via `posAtCoords` (`hit-test.ts:54`); for a cursor in the wide left/right margin OUTSIDE the text column, `posAtCoords` still resolves to the nearest in-block position in practice, and `resolveAnchorableBlock` has a depth-0 nearest-child fallback (`hit-test.ts:168-203`) — but **verify** the far-margin band resolves cleanly (open-verification O-1).

`bib` is the expected exception in requirement (1): `dropSpec: null` (`card-registry.tsx:287` "intentional: bib entries don't anchor to text"). So NO drop button on bib cards.

---

## 7. The three existing producers (proof the engine is producer-agnostic)

1. **FloatingPanel header shift-mousedown** — `FloatingPanel.tsx:432`. `{cardKey, origin}`. Controller owns dim + commit.
2. **In-text `InlineAtomGrab` PM plugin** — `inline-atom-grab.ts:145`. `{cardKey:"atom-grab:<token>", origin, inPlace:true, externalCommit:true}`. Captures source node at mousedown (`inline-atom-source.ts`), drives `<InlineAtomGhost>` (`inline-atom-grab.ts:167`), owns commit (`inline-atom-grab.ts:185-193`).
3. **StackThumbnail mousedown** — `StackThumbnail.tsx:36`. `{cardKey:"stack-pull:<id>", origin}`.
4. **`TextObjectGrabHandle` lifted-overlay** — `TextObjectGrabHandle.tsx:868`. `{cardKey, origin, inPlace:true, externalCommit:true}`.

A docked-card DROP button would be a 5th producer in exactly the same shape as #2/#4.

---

## 8. Minimal deep generalization (the recommended shape)

**A. New producer — a single `DropButton` rendered from card chrome (SSOT: the per-kind `dropSpec` facet).**
- Render the double-chevron button in the card header trailing slot. Today that slot only renders the jump chevron + X **when `isPoppedOut`** (`panel-primitives.tsx:2010-2020`); a docked card renders NO trailing chrome there. So requirement (1)'s "to the LEFT of the X when the X is showing" needs the button added to BOTH the docked header path AND the popped `FloatChrome` trailing slot (`FloatChrome.tsx:94` `{trailing}` … `:117` X). Gate visibility on `CARD_REGISTRY[kind].dropSpec != null` (bib auto-excluded) — that single registry read replaces any per-kind list.
- On mousedown the button reads `cardEl.getBoundingClientRect()` (mirror `panel-primitives.tsx:1838`) and calls `beginDropSession({ cardKey, origin:{x:e.clientX,y:e.clientY}, inPlace:true, externalCommit:true })`, then installs its own `mousemove`(noop)/`mouseup`→`commitDropSession` (mirror `inline-atom-grab.ts:185-193`). Per the central design principle, factor this into one reusable gesture helper so the float-header, in-text-grab, and docked-button producers share it.
- Retire the shift-mousedown branch (`FloatingPanel.tsx:428-441`) per requirement (7). Net: the engine keeps its existing producers and gains ONE generalized button producer.

**B. Extend `inlineAtomMoveSpec` with a create-if-absent branch (SSOT: the factory at `inline-atom-move.ts:59`).** Add an optional `createAtom?: (cardId, ctx) => PMNode | null` (or a `nodeFactory`) to `InlineAtomMoveOptions`. In `classifyDrop`, when `resolve()` returns null AND a `createAtom` is configured, return `{kind:"apply"}` instead of `no-op`; in `applyDrop`, insert the freshly-created atom at `placement.pos`. Wire `footnoteDropSpec`/`citationDropSpec` to build a `footnote`/`citation` node carrying the card's id (reuse the create logic at `commands.ts:198` / `citation.ts`), so:
   - case (b) anchor-unanchored-inline becomes: no atom found → create + insert (rather than no-op),
   - case (c) draft-atom-create is the SAME branch.
   This collapses (b)+(c) into one capability and keeps the move (a) path untouched. It does NOT add a parallel spec — it deepens the one factory both inline kinds already share.

**C. Paragraph-side kinds need ZERO spec changes** — `text-object-side-reanchor.ts` already covers anchor (len 0 → apply) and re-anchor (len>0 → confirm). They only need the new producer (A).

**D. One contract knob to consider:** the `inTextAtomGrab` invariant forbids `confirm` decisions on the inline path because the ghost/selection-suppression would freeze across an async modal (`in-text-atom-grab.ts:38-43`). A docked inline DROP button that uses `externalCommit` + the controller's `confirm`-aware `commitDropSession` is fine for footnote/citation re-anchor *if* those specs never return `confirm` (they don't today — they're `no-op`/`apply` only). Keep it that way, or if a "move existing atom?" confirm is ever desired, the button must NOT hold a frozen ghost. Design-call D-1.

---

## 9. Open-verifications / design-calls surfaced

- **O-1 (verify):** far-margin band resolution. Requirement (6) wants the paragraph's horizontal band INCLUDING the wide left/right editor margins. `hit-test.ts:54 posAtCoords` + `resolveAnchorableBlock` fallback (`hit-test.ts:168-203`) should resolve a margin point to the row's block, but this is unverified for points well outside the text column. Confirm live before relying on it.
- **D-1 (design-call):** should a docked inline DROP onto an ALREADY-anchored footnote/citation MOVE the marker (re-anchor, possibly with a confirm) or be disallowed? The paragraph-side kinds confirm on re-anchor; the inline kinds currently move silently with no confirm. Pick a consistent UX.
- **D-2 (design-call):** for an atomless citation that is a *draft* (pinned-open, `CitationCard.tsx:249 isDraft`), should the DROP button even be enabled before the user has typed a valid `\cite{key}`? An empty draft has no command to materialize.
- **D-3 (design-call):** highlight cards are Mode-B (text-range) by nature; the side-reanchor factory degrades a highlight to a paragraph-side anchor and snapshots the lost range (`text-object-side-reanchor.ts:60-75`). Confirm a margin-only drop is the intended UX for highlights (it likely is, per requirement 5's "make per-kind judgement calls").
- **D-4 (design-call):** where exactly does the docked button mount? The unified header trailing slot (`panel-primitives.tsx:2010`) currently has NO docked-state chrome; adding the button there is the clean SSOT, but a few cards render bespoke headers (e.g. bib) — those are excluded anyway (`dropSpec:null`).

---

## 10. Key file inventory (for the synthesis agent)

- Engine: `src/components/drop-mode/controller.ts` (begin/commit/cancel, listeners, `markSourceFloat`).
- Types/contract: `src/components/drop-mode/types.ts` (`DropSpec`, `DropCtx`, `Placement`, `ParagraphAnchorApi`).
- Spec dispatch: `src/components/drop-mode/registry.ts` (→ `CARD_REGISTRY[kind].dropSpec`).
- Hit-test/geometry: `src/components/drop-mode/hit-test.ts` (placement constructors, paragraph-side band).
- Indicator/ghost: `src/components/drop-mode/Indicator.tsx`, `InlineAtomGhost.tsx`, `inline-atom-ghost.ts`, `target-registry.ts`.
- Generic spec factories: `util/text-object-side-reanchor.ts` (paragraph-side, has anchor+reanchor), `util/inline-atom-move.ts` (atom move, MISSING create), `util/block-move.ts` (block).
- Per-kind specs: `src/panels/*/drop-spec.ts` + `src/cards/drop-specs/index.ts` (registration).
- Producers: `src/components/FloatingPanel.tsx:432` (to retire), `src/lib/tiptap/inline-atom-grab.ts:145`, `src/text-objects/TextObjectGrabHandle.tsx:868`, `src/components/stack/StackThumbnail.tsx:36`.
- Card chrome (button mount): `src/components/panel-primitives.tsx` (`PanelCard` ~`:1687`, trailing slot `:2010`), `src/floats/FloatChrome.tsx:94-123`.
- Atom presence / unanchored: `src/panels/Citations/CitationsPanel.tsx:133,222-226,331`, `CitationCard.tsx:665` (`isAnchored`).
- DropCtx wiring: `src/components/EditorPane.tsx:1277-1358` (paragraph-anchor APIs), `:3280-3293` (`DropModeProvider`).
- Float-key SSOT: `src/floats/float-key.ts`.
